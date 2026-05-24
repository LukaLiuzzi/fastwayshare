/**
 * FastWayShare — helpers.js
 * Utility functions used across the app.
 */

/**
 * Format bytes into human-readable string.
 * @param {number} bytes
 * @param {number} decimals
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Format transfer speed.
 * @param {number} bytesPerSecond
 * @returns {string}
 */
export function formatSpeed(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond, 1)}/s`;
}

/**
 * Format ETA in seconds to a human-readable string.
 * @param {number} seconds
 * @returns {string}
 */
export function formatETA(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * Copy text to clipboard with fallback.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:absolute;left:-9999px;top:-9999px';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically random hex string.
 * @param {number} length  number of bytes
 * @returns {string}
 */
export function randomHex(length = 16) {
  const arr = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert ArrayBuffer to base64 string.
 */
export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer.
 */
export function base64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Get file type icon emoji.
 */
export function getFileIcon(mimeType = '', filename = '') {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('zip') || mimeType.includes('archive') || ['zip','rar','7z','tar','gz'].includes(ext)) return '📦';
  if (mimeType.includes('word') || ['doc','docx'].includes(ext)) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || ['xls','xlsx','csv'].includes(ext)) return '📊';
  if (['js','ts','py','go','rs','java','cpp','c','html','css','json'].includes(ext)) return '💻';
  return '📁';
}

/**
 * Debounce a function.
 */
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Sleep for ms milliseconds.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate SHA-256 hash of an ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} hex digest
 */
export async function sha256(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Detect browser language (en or es).
 * @returns {'en'|'es'}
 */
export function detectLanguage() {
  const lang = navigator.language || navigator.userLanguage || 'en';
  return lang.startsWith('es') ? 'es' : 'en';
}

/**
 * Detect system color scheme preference.
 * @returns {'dark'|'light'}
 */
export function detectTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Add ripple effect to a button click.
 */
export function addRipple(btn, event) {
  const ripple = document.createElement('span');
  ripple.classList.add('btn-ripple');
  const rect = btn.getBoundingClientRect();
  ripple.style.left = `${event.clientX - rect.left}px`;
  ripple.style.top = `${event.clientY - rect.top}px`;
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}
