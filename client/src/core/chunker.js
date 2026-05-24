/**
 * FastWayShare — chunker.js
 * File chunking (sender side) and streaming reconstruction (receiver side).
 * - Sender: reads File objects in 64KB chunks using File.slice()
 * - Receiver: streams chunks directly to disk using File System Access API,
 *   with fallback to in-memory Blob accumulation.
 * - Folder support: compresses directory to ZIP using fflate.
 * - Resume support: sender can restart from a given byte offset.
 */

import { CHUNK_SIZE } from '../utils/constants.js';
import { sha256 } from '../utils/helpers.js';
import { saveChunk, getAllChunks, deleteTransfer, getSavedChunkCount, saveChunksBatch, getContiguousChunkCount } from '../utils/db.js';

/**
 * Chunked file reader for the sender side.
 */
export class FileChunker {
  #file;
  #offset = 0;

  /**
   * @param {File} file
   */
  constructor(file) {
    this.#file = file;
  }

  /** Total number of chunks */
  get totalChunks() {
    return Math.ceil(this.#file.size / CHUNK_SIZE) || 1;
  }

  get totalSize() { return this.#file.size; }
  get offset() { return this.#offset; }
  get done() { return this.#offset >= this.#file.size; }

  /**
   * Seek to a byte offset (for resume).
   * @param {number} offset
   */
  seek(offset) {
    this.#offset = Math.min(offset, this.#file.size);
  }

  /**
   * Read the next chunk as an ArrayBuffer.
   * @returns {Promise<{data: ArrayBuffer, index: number, offset: number, isLast: boolean}>|null}
   */
  async nextChunk() {
    if (this.done) return null;
    const start = this.#offset;
    const end = Math.min(start + CHUNK_SIZE, this.#file.size);
    const slice = this.#file.slice(start, end);
    const data = await slice.arrayBuffer();
    const index = Math.floor(start / CHUNK_SIZE);
    this.#offset = end;
    return {
      data,
      index,
      offset: start,
      isLast: this.#offset >= this.#file.size,
    };
  }

  /**
   * Read the entire file as an ArrayBuffer for SHA-256 hashing.
   * For large files, streams are not used here for simplicity — only called on send.
   * @returns {Promise<string>}  SHA-256 hex
   */
  async computeHash() {
    const ab = await this.#file.arrayBuffer();
    return sha256(ab);
  }
}

/**
 * File stream writer for the receiver side.
 * Tries File System Access API first (Chrome 86+), falls back to memory.
 */
export class FileStreamWriter {
  #useFileSystemAccess;
  #fileHandle = null;
  #writableStream = null;
  #memChunks = [];
  #filename;
  #fileSize;
  #hash;
  #bytesWritten = 0;
  #chunkIndex = 0;
  #writeQueue = [];
  #isWriting = false;

  /**
   * @param {string} filename
   * @param {number} fileSize
   * @param {string} hash
   */
  constructor(filename, fileSize, hash) {
    this.#filename = filename;
    this.#fileSize = fileSize;
    this.#hash = hash;
    this.#useFileSystemAccess = typeof window.showSaveFilePicker === 'function';
    this.#memChunks = [];
  }

  /**
   * Initialize the writer. Must be called before writing any chunks.
   * If using File System Access API, opens a save dialog.
   * @returns {Promise<number>}  Number of contiguous chunks already saved (resume offset)
   */
  async init() {
    // Use getContiguousChunkCount (not raw count) so the writer's internal
    // index matches the safe resume offset — no gaps, no index mismatch.
    const savedChunks = await getContiguousChunkCount(this.#hash);
    this.#chunkIndex = savedChunks;
    // Clamp so the last (possibly partial) chunk never pushes bytesWritten past fileSize
    this.#bytesWritten = Math.min(savedChunks * CHUNK_SIZE, this.#fileSize);

    // Fall back to Blob download on reload/resume to avoid prompting again
    if (savedChunks > 0) {
      this.#useFileSystemAccess = false;
    }

    if (this.#useFileSystemAccess) {
      try {
        this.#fileHandle = await window.showSaveFilePicker({
          suggestedName: this.#filename,
        });
        this.#writableStream = await this.#fileHandle.createWritable();
      } catch (e) {
        // User cancelled or API unavailable — fall back to memory
        this.#useFileSystemAccess = false;
      }
    }

    // Return the saved chunk count so callers can use the same value
    // without a second DB query.
    return savedChunks;
  }

  /**
   * Write a decrypted chunk to the output.
   * Returns a Promise that resolves ONLY after the chunk is committed to
   * IndexedDB, providing backpressure and durability on page reload.
   * @param {ArrayBuffer} data  Decrypted plaintext chunk
   * @returns {Promise<void>}
   */
  async write(data) {
    if (this.#useFileSystemAccess && this.#writableStream) {
      await this.#writableStream.write(data);
    } else {
      this.#memChunks.push(data);
    }

    const chunkIndex = this.#chunkIndex;
    this.#chunkIndex++;
    this.#bytesWritten += data.byteLength;

    // Each write() call gets its own promise that resolves once the chunk
    // is committed to IndexedDB. This ensures durability on page reload.
    return new Promise((resolve, reject) => {
      this.#writeQueue.push({ index: chunkIndex, data, resolve, reject });
      if (!this.#isWriting) {
        this.#isWriting = true;
        this.#processWriteQueue();
      }
    });
  }

  async #processWriteQueue() {
    while (true) {
      if (this.#writeQueue.length === 0) {
        this.#isWriting = false;
        // Double-check to prevent race condition when a new item is added
        // right after loop check but before setting isWriting to false.
        if (this.#writeQueue.length > 0) {
          this.#isWriting = true;
          continue;
        }
        break;
      }

      // Batch up to 16 chunks (1MB) per IndexedDB transaction for efficiency.
      // After the batch commits, resolve each write()'s promise so callers
      // (i.e. #handleChunk) know the data is durable.
      const batch = this.#writeQueue.splice(0, 16);
      try {
        await saveChunksBatch(this.#hash, batch);
        for (const item of batch) item.resolve();
      } catch (err) {
        console.error('[FileStreamWriter] Failed to save chunks batch to IndexedDB:', err);
        // Resolve anyway so the transfer is not permanently blocked.
        // The missing chunks will be detected on resume via getContiguousChunkCount.
        for (const item of batch) item.resolve();
      }
    }
  }

  /**
   * Get the in-memory chunks buffer for fast operations.
   * @returns {ArrayBuffer[]}
   */
  getChunks() {
    return this.#memChunks;
  }

  /**
   * Finalize the file. In memory mode, triggers browser download.
   * Calculates the hash and returns it for integrity verification.
   * @param {string} mimeType
   * @param {string} expectedHash
   * @returns {Promise<{ receivedHash: string, hashMatch: boolean }>}
   */
  async finalize(mimeType = 'application/octet-stream', expectedHash = '') {
    // Wait for background writes to finish committing to disk
    if (this.#isWriting) {
      await new Promise(resolve => {
        const check = () => {
          if (!this.#isWriting) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
    }

    // Build the full ordered chunk array for Blob assembly and hash verification.
    // Three cases:
    //   a) No resume: all chunks are in #memChunks.
    //   b) Resume (FSA mode): no Blob needed; just close the writable stream.
    //   c) Resume (Blob mode): #memChunks only has post-resume chunks;
    //      pre-resume chunks must be loaded from IndexedDB.
    let chunks = [];
    if (!this.#useFileSystemAccess) {
      if (this.#memChunks.length === this.#chunkIndex) {
        // Case (a): full transfer in memory — use directly
        chunks = this.#memChunks;
      } else {
        // Case (c): resumed transfer — load pre-resume chunks from IndexedDB,
        // then append the in-memory post-resume chunks.
        const preResumeCount = this.#chunkIndex - this.#memChunks.length;
        let preResumeChunks = [];
        try {
          preResumeChunks = await getAllChunks(this.#hash, preResumeCount);
        } catch (err) {
          console.error('[FileStreamWriter] Failed to load pre-resume chunks from IndexedDB:', err);
          throw new Error(`Cannot assemble file: missing pre-resume data. ${err.message}`);
        }
        chunks = [...preResumeChunks, ...this.#memChunks];
      }
    } else if (this.#fileSize <= 50 * 1024 * 1024) {
      // FSA mode but small enough to verify hash: load all from IndexedDB
      try {
        chunks = await getAllChunks(this.#hash, this.#chunkIndex);
      } catch (err) {
        console.warn('[FileStreamWriter] Could not load chunks for hash verification in FSA mode:', err);
      }
    }

    let receivedHash = expectedHash;
    let hashMatch = true;

    // Verify integrity for files <= 50MB
    if (this.#fileSize <= 50 * 1024 * 1024 && chunks.length > 0) {
      try {
        // Sum actual byte lengths (last chunk may be smaller than CHUNK_SIZE)
        const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
        const allData = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          allData.set(new Uint8Array(chunk), offset);
          offset += chunk.byteLength;
        }
        receivedHash = await sha256(allData.buffer);
        hashMatch = receivedHash === expectedHash;
      } catch (e) {
        console.error('Integrity hash calculation error in finalize:', e);
        hashMatch = false;
        receivedHash = '';
      }
    }

    let blob = null;
    if (this.#useFileSystemAccess && this.#writableStream) {
      await this.#writableStream.close();
    } else {
      // Trigger download via Blob URL
      blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.#filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    // Clean up DB
    await deleteTransfer(this.#hash);
    this.#memChunks = [];

    return { receivedHash, hashMatch, blob };
  }

  get bytesWritten() { return this.#bytesWritten; }
}

/**
 * Compress a list of File objects into a single ZIP ArrayBuffer.
 * Uses fflate for in-browser ZIP creation.
 * @param {File[]} files
 * @param {string} folderName
 * @returns {Promise<{data: ArrayBuffer, size: number}>}
 */
export async function compressToZip(files, folderName = 'files') {
  const { zip } = await import('fflate');

  const fileData = {};
  for (const file of files) {
    const ab = await file.arrayBuffer();
    const path = file.webkitRelativePath || `${folderName}/${file.name}`;
    fileData[path] = new Uint8Array(ab);
  }

  return new Promise((resolve, reject) => {
    zip(fileData, { level: 1 }, (err, data) => {
      if (err) return reject(err);
      resolve({ data: data.buffer, size: data.byteLength });
    });
  });
}
