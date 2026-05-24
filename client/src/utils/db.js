/**
 * FastWayShare — db.js
 * IndexedDB helper for managing resumable file transfer chunks and metadata.
 */

import { CHUNK_SIZE } from './constants.js';

const DB_NAME = 'FastWayShareDB';
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('transfers')) {
        db.createObjectStore('transfers', { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks');
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });

  return dbPromise;
}

export async function saveTransferMeta(meta) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transfers', 'readwrite');
    const store = tx.objectStore('transfers');
    const req = store.put({
      hash: meta.hash,
      filename: meta.filename,
      size: meta.size,
      mimeType: meta.mimeType || 'application/octet-stream',
      totalChunks: meta.totalChunks
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getTransferMeta(hash) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transfers', 'readonly');
    const store = tx.objectStore('transfers');
    const req = store.get(hash);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveChunk(hash, index, data) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    store.put(data, `${hash}_${index}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction error'));
    tx.onabort = () => reject(new Error('Transaction aborted'));
  });
}

export async function getChunk(hash, index) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const req = store.get(`${hash}_${index}`);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllChunks(hash, totalChunks) {
  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunk = await getChunk(hash, i);
    if (!chunk) {
      throw new Error(`Missing chunk at index ${i}`);
    }
    chunks.push(chunk);
  }
  return chunks;
}

export async function saveChunksBatch(hash, batch) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    for (const item of batch) {
      try {
        store.put(item.data, `${hash}_${item.index}`);
      } catch (e) {
        // Handle synchronous put error if any
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction error'));
    tx.onabort = () => reject(new Error('Transaction aborted'));
  });
}

export async function deleteTransfer(hash) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['transfers', 'chunks'], 'readwrite');
    tx.objectStore('transfers').delete(hash);

    const chunkStore = tx.objectStore('chunks');
    const keyRange = IDBKeyRange.bound(`${hash}_`, `${hash}_\uffff`);
    const cursorReq = chunkStore.openKeyCursor(keyRange);
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        chunkStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction error'));
    tx.onabort = () => reject(new Error('Transaction aborted'));
  });
}

/**
 * Count saved chunks using a raw count (used for cleanup/debug only).
 * @param {string} hash
 * @returns {Promise<number>}
 */
export async function getSavedChunkCount(hash) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const keyRange = IDBKeyRange.bound(`${hash}_`, `${hash}_\uffff`);
    const req = store.count(keyRange);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Find the number of contiguously-saved chunks from index 0 onwards.
 * Unlike getSavedChunkCount(), this stops at the first gap so we never
 * resume from an offset that has a hole in the middle.
 *
 * Example: chunks 0-50 saved, 51 missing, 52-53 saved → returns 51
 *
 * @param {string} hash
 * @returns {Promise<number>}  Number of safely-saved contiguous chunks
 */
export async function getContiguousChunkCount(hash) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const keyRange = IDBKeyRange.bound(`${hash}_`, `${hash}_\uffff`);
    const req = store.getAllKeys(keyRange);
    req.onsuccess = () => {
      const keys = req.result;
      if (!keys || keys.length === 0) {
        resolve(0);
        return;
      }
      const prefix = `${hash}_`;
      const indices = keys
        .map(k => parseInt(k.slice(prefix.length), 10))
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);

      let count = 0;
      for (let i = 0; i < indices.length; i++) {
        if (indices[i] !== i) break;
        count = i + 1;
      }
      resolve(count);
    };
    req.onerror = () => reject(req.error);
  });
}


