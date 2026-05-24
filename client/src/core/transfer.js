/**
 * FastWayShare — transfer.js
 * Transfer orchestrator.
 * Manages the full lifecycle of sending/receiving files:
 * - File offer/accept handshake
 * - Encrypted chunk sending with ACK-based flow control
 * - Progress tracking (speed, ETA)
 * - Resumable transfers
 * - Multi-file queue
 */

import { MSG, CHUNK_SIZE } from '../utils/constants.js';
import { encryptChunk, decryptChunk, hashSHA256 } from './crypto.js';
import { FileChunker, FileStreamWriter, compressToZip } from './chunker.js';
import { formatBytes } from '../utils/helpers.js';
import { saveTransferMeta, getSavedChunkCount, deleteTransfer, getAllChunks } from '../utils/db.js';

const SPEED_WINDOW = 3000; // 3s rolling average for speed calculation

class ChunkPipeline {
  #chunker;
  #sharedKey;
  #bufferSize;
  #queue = [];
  #error = null;
  #running = true;
  #fillPromise = null;
  #waiters = [];
  #spaceWaiters = [];

  constructor(chunker, sharedKey, bufferSize = 8) {
    this.#chunker = chunker;
    this.#sharedKey = sharedKey;
    this.#bufferSize = bufferSize;
  }

  start() {
    this.#fillPromise = this.#fillBuffer();
  }

  async #fillBuffer() {
    try {
      while (this.#running && !this.#chunker.done) {
        if (this.#queue.length >= this.#bufferSize) {
          await new Promise(resolve => this.#spaceWaiters.push(resolve));
          continue;
        }

        const chunk = await this.#chunker.nextChunk();
        if (!chunk) break;

        const encryptPromise = (async () => {
          const encrypted = await encryptChunk(chunk.data, this.#sharedKey);
          return {
            data: encrypted,
            isLast: chunk.isLast,
            offset: chunk.offset,
            length: chunk.data.byteLength
          };
        })();

        this.#queue.push(encryptPromise);
        
        if (this.#waiters.length > 0) {
          this.#waiters.shift()();
        }
      }
      
      while (this.#waiters.length > 0) {
        this.#waiters.shift()();
      }
    } catch (err) {
      this.#error = err;
      while (this.#waiters.length > 0) {
        this.#waiters.shift()();
      }
    }
  }

  async next() {
    if (this.#error) {
      throw this.#error;
    }
    while (this.#queue.length === 0) {
      if (this.#chunker.done) {
        return null;
      }
      if (this.#error) {
        throw this.#error;
      }
      await new Promise(resolve => this.#waiters.push(resolve));
    }
    
    const item = this.#queue.shift();
    
    if (this.#spaceWaiters.length > 0) {
      this.#spaceWaiters.shift()();
    }
    
    return item;
  }

  cancel() {
    this.#running = false;
    while (this.#waiters.length > 0) {
      this.#waiters.shift()();
    }
    while (this.#spaceWaiters.length > 0) {
      this.#spaceWaiters.shift()();
    }
  }
}

export class TransferManager extends EventTarget {
  /** @type {import('./webrtc.js').WebRTCManager} */
  #rtc;
  /** @type {CryptoKey|null} */
  #sharedKey = null;

  // Sender state
  #sendQueue = []; // Array<File>
  #currentSender = null; // { chunker, meta, startTime, bytesSent, speedSamples }

  // Receiver state
  #currentReceiver = null; // { writer, meta, bytesReceived, speedSamples }

  // Completed hashes in current session
  #completedHashes = new Set();

  // Pause/cancel flags
  #paused = false;
  #cancelled = false;

  /**
   * @param {import('./webrtc.js').WebRTCManager} rtcManager
   */
  constructor(rtcManager) {
    super();
    this.#rtc = rtcManager;
    this.#setupListeners();
  }

  /** Set the shared AES key derived from ECDH */
  setSharedKey(key) {
    this.#sharedKey = key;
  }

  #setupListeners() {
    // Listen for control messages from the peer (via DataChannel)
    this.#rtc.addEventListener('message', (e) => this.#handleMessage(e.detail));
    // Listen for binary chunks
    this.#rtc.addEventListener('chunk', (e) => this.#handleChunk(e.detail));
    // Re-offer active file when data channel opens
    this.#rtc.addEventListener('datachannel_open', () => this.#handleDataChannelOpen());
    // Listen for WebRTC connection disconnect
    this.#rtc.addEventListener('disconnected', () => this.#handleDisconnect());
  }

  #handleDataChannelOpen() {
    if (this.#currentSender) {
      // Re-offer the file to the newly connected receiver
      this.#rtc.sendMessage({ type: MSG.FILE_OFFER, meta: this.#currentSender.meta });
      this.#emit('offer_sent', { meta: this.#currentSender.meta });
    }
  }

  #handleDisconnect() {
    if (this.#currentSender) {
      this.#emit('progress', {
        filename: this.#currentSender.meta.filename,
        progress: this.#currentSender.bytesSent / this.#currentSender.meta.size,
        speed: 0,
        eta: Infinity,
        bytesSent: this.#currentSender.bytesSent,
        totalSize: this.#currentSender.meta.size,
        status: 'disconnected',
        direction: 'send',
      });
    } else if (this.#currentReceiver) {
      this.#emit('progress', {
        filename: this.#currentReceiver.meta.filename,
        progress: this.#currentReceiver.bytesReceived / this.#currentReceiver.meta.size,
        speed: 0,
        eta: Infinity,
        bytesReceived: this.#currentReceiver.bytesReceived,
        totalSize: this.#currentReceiver.meta.size,
        status: 'disconnected',
        direction: 'receive',
      });
    }
  }

  // ─── SENDER ────────────────────────────────────────────────────────────────

  /**
   * Queue files for sending.
   * @param {File[]} files
   */
  async send(files) {
    if (files.length > 1) {
      // Emit zipping status to notify the UI
      this.#emit('progress', {
        filename: 'fastwayshare.zip',
        progress: 0,
        speed: 0,
        eta: Infinity,
        bytesSent: 0,
        totalSize: 0,
        status: 'zipping',
        direction: 'send',
      });

      try {
        const zipResult = await compressToZip(files, 'fastwayshare');
        const zipFile = new File([zipResult.data], 'fastwayshare.zip', { type: 'application/zip' });
        this.#sendQueue.push(zipFile);
      } catch (err) {
        console.error('Failed to zip files, sending individually:', err);
        this.#sendQueue.push(...files);
      }
    } else {
      this.#sendQueue.push(...files);
    }

    if (!this.#currentSender) {
      await this.#sendNext();
    }
  }

  async #sendNext() {
    if (this.#sendQueue.length === 0) {
      this.#emit('queue_complete');
      return;
    }
    const file = this.#sendQueue.shift();
    const chunker = new FileChunker(file);

    // Compute SHA-256 hash before sending (for integrity check)
    this.#emit('hashing', { filename: file.name });
    this.#emit('progress', {
      filename: file.name,
      progress: 0,
      speed: 0,
      eta: Infinity,
      bytesSent: 0,
      totalSize: file.size,
      status: 'hashing',
      direction: 'send',
    });
    const hash = await chunker.computeHash();

    const meta = {
      filename: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      totalChunks: chunker.totalChunks,
      hash,
    };

    this.#currentSender = {
      chunker,
      meta,
      file,
      startTime: Date.now(),
      bytesSent: 0,
      lastSpeedUpdate: Date.now(),
      bytesAtLastUpdate: 0,
      speed: 0,
    };

    // Send FILE_OFFER to receiver
    this.#rtc.sendMessage({ type: MSG.FILE_OFFER, meta });
    this.#emit('offer_sent', { meta });
  }

  async #sendChunks(resumeOffset = 0) {
    const s = this.#currentSender;
    if (!s) return;

    s.chunker.seek(resumeOffset);
    s.bytesSent = resumeOffset;
    this.#cancelled = false;
    this.#paused = false;

    // Create and start pipeline for pre-reading and encrypting chunks
    const pipeline = new ChunkPipeline(s.chunker, this.#sharedKey, 16);
    s.pipeline = pipeline;
    pipeline.start();

    try {
      while (!this.#cancelled) {
        if (!this.#rtc.isOpen) {
          break;
        }

        // Pause support
        if (this.#paused) {
          await new Promise(resolve => {
            const handler = () => { resolve(); this.removeEventListener('resume', handler); };
            this.addEventListener('resume', handler);
          });
        }

        const chunkPromise = await pipeline.next();
        if (!chunkPromise) break;

        const chunk = await chunkPromise;

        if (!this.#rtc.isOpen) {
          break;
        }

        // Wait for DataChannel backpressure to clear (flow control)
        await this.#rtc.waitForBuffer();

        if (!this.#rtc.isOpen) {
          break;
        }

        // Send raw encrypted binary
        this.#rtc.sendData(chunk.data);

        s.bytesSent = chunk.offset + chunk.length;

        // Update speed (rolling window)
        const now = Date.now();
        const elapsed = (now - s.lastSpeedUpdate) / 1000;
        if (elapsed >= 0.5) {
          const bytesDelta = s.bytesSent - s.bytesAtLastUpdate;
          s.speed = bytesDelta / elapsed;
          s.lastSpeedUpdate = now;
          s.bytesAtLastUpdate = s.bytesSent;
        }

        const progress = s.bytesSent / s.meta.size;
        const eta = s.speed > 0 ? (s.meta.size - s.bytesSent) / s.speed : Infinity;
        this.#emit('progress', {
          filename: s.meta.filename,
          bytesSent: s.bytesSent,
          totalSize: s.meta.size,
          progress,
          speed: s.speed,
          eta,
          direction: 'send',
          status: 'transferring',
        });

        if (chunk.isLast) {
          // Notify transfer complete with hash
          this.#rtc.sendMessage({
            type: MSG.TRANSFER_COMPLETE,
            hash: s.meta.hash,
            filename: s.meta.filename,
          });
          // Do NOT clear currentSender or emit send_complete yet.
          // We will do that once we receive TRANSFER_COMPLETE_ACK.
          break;
        }
      }
    } catch (err) {
      console.error('Error in sendChunks pipeline:', err);
      this.#emit('error', { error: err.message });
    } finally {
      pipeline.cancel();
    }
  }

  // ─── RECEIVER ──────────────────────────────────────────────────────────────

  async #handleMessage(msg) {
    switch (msg.type) {
      case MSG.FILE_OFFER:
        await this.#handleFileOffer(msg.meta);
        break;
      case MSG.TRANSFER_COMPLETE:
        await this.#handleTransferComplete(msg);
        break;
      case MSG.RESUME_REQUEST:
        await this.#sendChunks(msg.offset);
        break;
      case MSG.TRANSFER_COMPLETE_ACK:
        await this.#handleTransferCompleteAck(msg.hash);
        break;
      case MSG.CANCEL:
        this.#cancelled = true;
        if (this.#currentReceiver) {
          deleteTransfer(this.#currentReceiver.meta.hash).catch(err => console.error(err));
          this.#currentReceiver = null;
        }
        this.#emit('cancelled');
        break;
    }
  }

  async #handleTransferCompleteAck(hash) {
    try {
      const s = this.#currentSender;
      if (s && s.meta.hash === hash) {
        this.#emit('send_complete', { meta: s.meta, duration: (Date.now() - s.startTime) / 1000 });
        this.#currentSender = null;
        await this.#sendNext();
      }
    } catch (err) {
      this.#emit('error', { error: err.message });
      this.#currentSender = null;
    }
  }

  async #handleFileOffer(meta) {
    // If we already successfully completed this file in this session, ACK it immediately
    if (this.#completedHashes.has(meta.hash)) {
      this.#rtc.sendMessage({ type: MSG.TRANSFER_COMPLETE_ACK, hash: meta.hash });
      return;
    }

    this.#emit('file_offered', { meta });

    // Save transfer metadata
    await saveTransferMeta(meta);

    // writer.init() internally calls getContiguousChunkCount() and returns
    // the safe resume offset so we use a single DB query for both.
    const writer = new FileStreamWriter(meta.filename, meta.size, meta.hash);
    const savedChunks = await writer.init();
    const isResuming = savedChunks > 0;
    // Clamp so initialBytes never exceeds file size (last chunk may be < CHUNK_SIZE)
    const initialBytes = Math.min(savedChunks * CHUNK_SIZE, meta.size);

    this.#currentReceiver = {
      writer,
      meta,
      bytesReceived: initialBytes,
      startTime: Date.now(),
      lastSpeedUpdate: Date.now(),
      bytesAtLastUpdate: initialBytes,
      speed: 0,
      chunks: [],
      chunksProcessed: savedChunks,
      transferCompleteMessageReceived: null,
    };

    if (isResuming) {
      this.#rtc.sendMessage({ type: MSG.RESUME_REQUEST, offset: initialBytes });
      this.#emit('receive_started', { meta, isResuming: true, bytesReceived: initialBytes });
    } else {
      // Accept the transfer
      this.#rtc.sendMessage({ type: MSG.FILE_ACCEPT, filename: meta.filename });
      this.#emit('receive_started', { meta, isResuming: false, bytesReceived: 0 });
    }
  }

  async #handleChunk(encryptedData) {
    const r = this.#currentReceiver;
    if (!r) return;

    try {
      const decrypted = await decryptChunk(encryptedData, this.#sharedKey);
      await r.writer.write(decrypted);
      r.bytesReceived += decrypted.byteLength;

      // Speed tracking
      const now = Date.now();
      const elapsed = (now - r.lastSpeedUpdate) / 1000;
      if (elapsed >= 0.5) {
        const delta = r.bytesReceived - r.bytesAtLastUpdate;
        r.speed = delta / elapsed;
        r.lastSpeedUpdate = now;
        r.bytesAtLastUpdate = r.bytesReceived;
      }

      const progress = r.bytesReceived / r.meta.size;
      const eta = r.speed > 0 ? (r.meta.size - r.bytesReceived) / r.speed : Infinity;
      this.#emit('progress', {
        filename: r.meta.filename,
        bytesReceived: r.bytesReceived,
        totalSize: r.meta.size,
        progress,
        speed: r.speed,
        meta: r.meta,
        eta,
        direction: 'receive',
        status: 'transferring',
      });

      r.chunksProcessed++;
      if (r.transferCompleteMessageReceived && r.chunksProcessed === r.meta.totalChunks) {
        await this.#finalizeReceiver(r, r.transferCompleteMessageReceived);
      }
    } catch (e) {
      console.error('Decryption error in handleChunk:', e);
      this.#emit('decryption_error', { error: e.message });
      this.cancel();
    }
  }

  async #handleTransferComplete(msg) {
    const r = this.#currentReceiver;
    if (!r) return;

    r.transferCompleteMessageReceived = msg;

    if (r.chunksProcessed === r.meta.totalChunks) {
      await this.#finalizeReceiver(r, msg);
    }
  }

  async #finalizeReceiver(r, msg) {
    try {
      // Finalize file write (which will trigger download, wait for background writes, verify hash, and delete from IndexedDB)
      const { receivedHash, hashMatch, blob } = await r.writer.finalize(r.meta.mimeType, msg.hash);

      // Save completed hash to avoid re-downloading if connection drops right now
      this.#completedHashes.add(r.meta.hash);

      // Send complete ACK to the sender
      this.#rtc.sendMessage({ type: MSG.TRANSFER_COMPLETE_ACK, hash: r.meta.hash });

      this.#emit('receive_complete', {
        meta: r.meta,
        hashMatch,
        receivedHash,
        expectedHash: msg.hash,
        duration: (Date.now() - r.startTime) / 1000,
        blob,
      });
    } catch (err) {
      this.#emit('error', { error: `Finalization error: ${err.message}` });
    } finally {
      this.#currentReceiver = null;
    }
  }

  // ─── CONTROLS ──────────────────────────────────────────────────────────────

  /** Called when sender receives FILE_ACCEPT — start sending chunks */
  onAccepted() {
    this.#sendChunks(0);
  }

  pause() {
    this.#paused = true;
    this.#emit('paused');
  }

  resume() {
    this.#paused = false;
    this.dispatchEvent(new Event('resume'));
    this.#emit('resumed');
  }

  cancel() {
    this.#cancelled = true;
    if (this.#currentSender?.pipeline) {
      this.#currentSender.pipeline.cancel();
    }
    if (this.#currentReceiver) {
      deleteTransfer(this.#currentReceiver.meta.hash).catch(err => console.error(err));
      this.#currentReceiver = null;
    }
    this.#rtc.sendMessage({ type: MSG.CANCEL });
    this.#emit('cancelled');
  }

  #emit(type, detail = null) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
