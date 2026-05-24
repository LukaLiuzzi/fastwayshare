/**
 * FastWayShare — notification.js
 * Browser notifications + completion sound.
 */

import { t } from '../i18n/i18n.js';

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

/**
 * Play a pleasant completion chime using Web Audio API.
 * No external file needed.
 */
export function playCompleteSound() {
  try {
    const ctx = getAudioContext();
    // Resume if suspended (autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    // Play three ascending notes: C5 → E5 → G5
    [[523.25, 0], [659.25, 0.12], [783.99, 0.24]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.18, now + delay + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.4);
      osc.start(now + delay);
      osc.stop(now + delay + 0.5);
    });
  } catch {
    // Silently ignore if audio not supported
  }
}

/**
 * Request browser notification permission.
 * @returns {Promise<boolean>}
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Show a browser notification when a transfer completes (tab not focused).
 * @param {string} filename
 * @param {string} direction 'sent' | 'received'
 */
export function notifyTransferComplete(filename, direction = 'received') {
  playCompleteSound();

  // Only show browser notification if tab is not visible
  if (document.visibilityState === 'visible') return;
  if (Notification.permission !== 'granted') return;

  new Notification(t('notification.complete_title'), {
    body: t('notification.complete_body', { filename }),
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: 'fws-transfer-complete',
  });
}

/**
 * Show a toast message in the app.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} duration  ms
 */
export function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
