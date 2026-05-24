/**
 * FastWayShare — progress.js
 * Progress bar UI component with speed, ETA, and resume indicator.
 */

import { formatBytes, formatSpeed, formatETA } from '../utils/helpers.js';
import { t } from '../i18n/i18n.js';

/**
 * Create a progress bar component.
 * Returns the element and an update function.
 *
 * @returns {{ el: HTMLElement, update: Function, reset: Function }}
 */
export function createProgressBar() {
  const el = document.createElement('div');
  el.className = 'progress-container anim-fade-in';
  el.innerHTML = `
    <div class="progress-header">
      <span class="progress-filename" id="prog-filename">—</span>
      <span class="progress-percent" id="prog-percent">0%</span>
    </div>
    <div class="progress-bar-track">
      <div class="progress-bar-fill" id="prog-fill" style="width:0%"></div>
    </div>
    <div class="progress-meta">
      <span class="progress-speed" id="prog-speed">—</span>
      <span id="prog-eta">—</span>
    </div>
    <div id="prog-hash" class="hash-display" style="display:none"></div>
  `;

  const filenameEl = el.querySelector('#prog-filename');
  const percentEl = el.querySelector('#prog-percent');
  const fillEl = el.querySelector('#prog-fill');
  const speedEl = el.querySelector('#prog-speed');
  const etaEl = el.querySelector('#prog-eta');
  const hashEl = el.querySelector('#prog-hash');

  function update({ filename, progress, speed, eta, bytesReceived, bytesSent, totalSize, isResuming, status }) {
    const pct = Math.round((progress || 0) * 100);
    const transferred = bytesReceived ?? bytesSent ?? 0;

    filenameEl.textContent = filename || '—';
    if (isResuming) filenameEl.textContent += ' (Resuming…)';
    percentEl.textContent = `${pct}%`;
    fillEl.style.width = `${pct}%`;
    
    speedEl.removeAttribute('data-i18n');
    if (status === 'hashing') {
      speedEl.setAttribute('data-i18n', 'transfer.hashing');
      speedEl.textContent = t('transfer.hashing');
    } else if (status === 'zipping') {
      speedEl.setAttribute('data-i18n', 'transfer.zipping');
      speedEl.textContent = t('transfer.zipping') || 'Creating ZIP...';
    } else if (status === 'transferring') {
      speedEl.textContent = speed > 0 ? formatSpeed(speed) : '0 B/s';
    } else if (status === 'disconnected') {
      speedEl.innerHTML = `⚠️ <span data-i18n="connection.connecting">${t('connection.connecting') || 'Connecting...'}</span>`;
    } else {
      speedEl.textContent = '—';
    }

    etaEl.textContent = `${formatBytes(transferred)} / ${formatBytes(totalSize)}  •  ETA: ${formatETA(eta)}`;
  }

  function showHash(hash, isMatch) {
    hashEl.style.display = 'block';
    hashEl.innerHTML = `
      <div style="color:${isMatch ? '#34d399' : '#fc4c4c'};font-size:0.75rem;margin-bottom:4px;font-weight:600;" data-i18n="${isMatch ? 'transfer.verified' : 'transfer.mismatch'}">
        ${isMatch ? t('transfer.verified') : t('transfer.mismatch')}
      </div>
      <div style="word-break:break-all;">${hash}</div>
    `;
  }

  function reset() {
    filenameEl.textContent = '—';
    percentEl.textContent = '0%';
    fillEl.style.width = '0%';
    speedEl.textContent = '—';
    etaEl.textContent = '—';
    hashEl.style.display = 'none';
  }

  return { el, update, showHash, reset };
}
