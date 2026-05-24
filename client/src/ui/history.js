/**
 * FastWayShare — history.js
 * Session transfer history (in-memory, never persisted).
 */

import { formatBytes, formatETA } from '../utils/helpers.js';
import { t } from '../i18n/i18n.js';

const history = [];

/**
 * Add an entry to the session history.
 * @param {{ filename, size, direction, duration, speed, hashMatch }} entry
 */
export function addHistoryEntry(entry) {
  history.unshift({
    ...entry,
    timestamp: new Date(),
    id: Date.now(),
  });
}

/**
 * Render the transfer history into a container.
 * @param {HTMLElement} container
 */
export function renderHistory(container) {
  if (history.length === 0) {
    container.innerHTML = `<p class="text-muted text-sm text-center" style="padding: 1rem;">${t('history.empty')}</p>`;
    return;
  }

  container.innerHTML = '';
  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item anim-fade-in';

    const icon = entry.direction === 'send' ? '📤' : '📥';
    const dirLabel = entry.direction === 'send' ? t('history.sent') : t('history.received');
    const avgSpeed = entry.size / entry.duration;
    const hashIcon = entry.hashMatch === true ? '✓' : entry.hashMatch === false ? '⚠' : '';

    item.innerHTML = `
      <span class="history-status">${icon}</span>
      <div class="file-info">
        <div class="file-name">${entry.filename} ${hashIcon}</div>
        <div class="history-meta">
          ${dirLabel} • ${formatBytes(entry.size)} • ${entry.duration.toFixed(1)}s •
          ${formatBytes(avgSpeed)}/s avg
        </div>
      </div>
      <div class="text-muted text-sm">${entry.timestamp.toLocaleTimeString()}</div>
    `;

    container.appendChild(item);
  });
}
