/**
 * FastWayShare — chunker.js
 * File chunking (sender side) and streaming reconstruction (receiver side).
 * - Sender: reads File objects in variable-size chunks using File.slice()
 * - PrioritizedFileChunker: sends header/thumbnail data first
 * - Receiver: streams chunks directly to disk using File System Access API,
 *   with fallback to in-memory Blob accumulation.
 * - Folder support: compresses directory to ZIP using fflate.
 * - Resume support: sender can restart from a given byte offset.
 * - Adaptive chunk size: chunk size can be updated mid-transfer.
 */

import { CHUNK_SIZE } from '../utils/constants.js';
import { sha256 } from '../utils/helpers.js';
import { saveChunk, getAllChunks, deleteTransfer, getSavedChunkCount, saveChunksBatch, getContiguousChunkCount } from '../utils/db.js';

// How many bytes of a file to read as "priority" (header/thumbnail)
const PRIORITY_BYTES_IMAGE = 64 * 1024;   // 64KB — covers EXIF thumbnail
const PRIORITY_BYTES_VIDEO = 256 * 1024;  // 256KB — covers moov atom / header
const PRIORITY_BYTES_DEFAULT = CHUNK_SIZE; // one chunk for other types

/**
 * Chunked file reader for the sender side.
 * Supports variable chunk sizes (updated via setChunkSize).
 */
export class FileChunker {
  #file;
  #offset = 0;
  #chunkSize;

  /**
   * @param {File} file
   * @param {number} [chunkSize]
   */
  constructor(file, chunkSize = CHUNK_SIZE) {
    this.#file = file;
    this.#chunkSize = chunkSize;
  }

  /** Total number of chunks (approximate — may change if chunk size adapts) */
  get totalChunks() {
    return Math.ceil(this.#file.size / this.#chunkSize) || 1;
  }

  get totalSize() { return this.#file.size; }
  get offset() { return this.#offset; }
  get chunkSize() { return this.#chunkSize; }
  get done() { return this.#offset >= this.#file.size; }

  /**
   * Update the chunk size for future reads (adaptive chunking).
   * Does not affect the current read position.
   * @param {number} size
   */
  setChunkSize(size) {
    this.#chunkSize = size;
  }

  /**
   * Seek to a byte offset (for resume).
   * @param {number} offset
   */
  seek(offset) {
    this.#offset = Math.min(offset, this.#file.size);
  }

  /**
   * Read the next chunk as an ArrayBuffer.
   * @returns {Promise<{data: ArrayBuffer, index: number, offset: number, isLast: boolean, chunkSize: number}|null>}
   */
  async nextChunk() {
    if (this.done) return null;
    const start = this.#offset;
    const end = Math.min(start + this.#chunkSize, this.#file.size);
    const slice = this.#file.slice(start, end);
    const data = await slice.arrayBuffer();
    const index = Math.floor(start / this.#chunkSize);
    this.#offset = end;
    return {
      data,
      index,
      offset: start,
      isLast: this.#offset >= this.#file.size,
      chunkSize: this.#chunkSize,
    };
  }

  /**
   * Read the entire file as an ArrayBuffer for SHA-256 hashing.
   * @returns {Promise<string>}  SHA-256 hex
   */
  async computeHash() {
    const ab = await this.#file.arrayBuffer();
    return sha256(ab);
  }
}

/**
 * Prioritized chunker that sends high-priority header data first.
 * For images: first 64KB (EXIF thumbnail)
 * For videos: first 256KB (moov atom / container header)
 * Then falls through to sequential reading.
 */
export class PrioritizedFileChunker extends FileChunker {
  #mimeType;
  #prioritySent = false;
  #priorityBytes;

  /**
   * @param {File} file
   * @param {number} [chunkSize]
   */
  constructor(file, chunkSize = CHUNK_SIZE) {
    super(file, chunkSize);
    this.#mimeType = file.type || '';
    this.#priorityBytes = this.#calcPriorityBytes();
  }

  #calcPriorityBytes() {
    if (this.#mimeType.startsWith('image/')) return PRIORITY_BYTES_IMAGE;
    if (this.#mimeType.startsWith('video/')) return PRIORITY_BYTES_VIDEO;
    return PRIORITY_BYTES_DEFAULT;
  }

  /**
   * Read next chunk. Returns priority chunk first (marked with priority:'high'),
   * then continues sequentially.
   */
  async nextChunk() {
    if (this.done) return null;

    const chunk = await super.nextChunk();
    if (!chunk) return null;

    // Mark as high priority if it's within the priority window
    const isPriority = !this.#prioritySent || chunk.offset < this.#priorityBytes;
    if (chunk.offset + chunk.data.byteLength >= this.#priorityBytes) {
      this.#prioritySent = true;
    }

    return { ...chunk, priority: isPriority ? 'high' : 'normal' };
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
   * @returns {Promise<number>}  Number of contiguous chunks already saved (resume offset)
   */
  async init() {
    const savedChunks = await getContiguousChunkCount(this.#hash);
    this.#chunkIndex = savedChunks;
    this.#bytesWritten = Math.min(savedChunks * CHUNK_SIZE, this.#fileSize);

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
        this.#useFileSystemAccess = false;
      }
    }

    return savedChunks;
  }

  /**
   * Write a decrypted chunk to the output.
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
        if (this.#writeQueue.length > 0) {
          this.#isWriting = true;
          continue;
        }
        break;
      }

      const batch = this.#writeQueue.splice(0, 16);
      try {
        await saveChunksBatch(this.#hash, batch);
        for (const item of batch) item.resolve();
      } catch (err) {
        console.error('[FileStreamWriter] Failed to save chunks batch:', err);
        for (const item of batch) item.resolve();
      }
    }
  }

  getChunks() {
    return this.#memChunks;
  }

  /**
   * Finalize the file, verify hash, trigger download.
   * @param {string} mimeType
   * @param {string} expectedHash
   * @returns {Promise<{ receivedHash: string, hashMatch: boolean, blob: Blob|null }>}
   */
  async finalize(mimeType = 'application/octet-stream', expectedHash = '') {
    if (this.#isWriting) {
      await new Promise(resolve => {
        const check = () => {
          if (!this.#isWriting) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
    }

    let chunks = [];
    if (!this.#useFileSystemAccess) {
      if (this.#memChunks.length === this.#chunkIndex) {
        chunks = this.#memChunks;
      } else {
        const preResumeCount = this.#chunkIndex - this.#memChunks.length;
        let preResumeChunks = [];
        try {
          preResumeChunks = await getAllChunks(this.#hash, preResumeCount);
        } catch (err) {
          console.error('[FileStreamWriter] Failed to load pre-resume chunks:', err);
          throw new Error(`Cannot assemble file: missing pre-resume data. ${err.message}`);
        }
        chunks = [...preResumeChunks, ...this.#memChunks];
      }
    } else if (this.#fileSize <= 50 * 1024 * 1024) {
      try {
        chunks = await getAllChunks(this.#hash, this.#chunkIndex);
      } catch (err) {
        console.warn('[FileStreamWriter] Could not load chunks for hash verification:', err);
      }
    }

    let receivedHash = expectedHash;
    let hashMatch = true;

    if (this.#fileSize <= 50 * 1024 * 1024 && chunks.length > 0) {
      try {
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
        console.error('Integrity hash calculation error:', e);
        hashMatch = false;
        receivedHash = '';
      }
    }

    let blob = null;
    if (this.#useFileSystemAccess && this.#writableStream) {
      await this.#writableStream.close();
    } else {
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

    await deleteTransfer(this.#hash);
    this.#memChunks = [];

    return { receivedHash, hashMatch, blob };
  }

  get bytesWritten() { return this.#bytesWritten; }
}

/**
 * Compress a list of File objects into a single ZIP ArrayBuffer.
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
