/**
 * FastWayShare — mobile.js
 * Mobile optimizations:
 *   - Screen Wake Lock (prevents sleep during transfer)
 *   - Background transfer handling (Page Visibility API)
 *   - Battery-aware performance tuning
 *   - Auto-reconnect state tracking
 */

/**
 * Wake Lock manager — keeps the screen on during file transfers.
 */
export class WakeLockManager {
  #wakeLock = null;
  #supported = 'wakeLock' in navigator;

  get supported() { return this.#supported; }
  get active() { return this.#wakeLock !== null && !this.#wakeLock.released; }

  async acquire() {
    if (!this.#supported) return false;
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen');
      this.#wakeLock.addEventListener('release', () => {
        this.#wakeLock = null;
      });
      return true;
    } catch {
      return false;
    }
  }

  async release() {
    if (this.#wakeLock && !this.#wakeLock.released) {
      try {
        await this.#wakeLock.release();
      } catch {
        // ignore
      }
      this.#wakeLock = null;
    }
  }

  /**
   * Re-acquire when page becomes visible again (e.g. user switches back).
   * Call this on 'visibilitychange' events.
   */
  async reacquireIfNeeded() {
    if (this.#supported && document.visibilityState === 'visible' && !this.active) {
      await this.acquire();
    }
  }
}

/**
 * Background transfer tracker.
 * Listens to Page Visibility API and reports when the app goes to background.
 */
export class BackgroundTransferManager extends EventTarget {
  #isBackground = false;
  #onVisibilityChange = null;

  constructor() {
    super();
  }

  start() {
    this.#onVisibilityChange = () => {
      const isHidden = document.visibilityState === 'hidden';
      if (isHidden !== this.#isBackground) {
        this.#isBackground = isHidden;
        this.dispatchEvent(new CustomEvent(isHidden ? 'background' : 'foreground'));
      }
    };
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
  }

  stop() {
    if (this.#onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.#onVisibilityChange);
      this.#onVisibilityChange = null;
    }
  }

  get isBackground() { return this.#isBackground; }
}

/**
 * Get battery information if available.
 * @returns {Promise<{level: number, charging: boolean}|null>}
 */
export async function getBatteryInfo() {
  try {
    if ('getBattery' in navigator) {
      const battery = await navigator.getBattery();
      return { level: battery.level, charging: battery.charging };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Check if battery is critically low (< 15%).
 * @returns {Promise<boolean>}
 */
export async function isBatteryLow() {
  const info = await getBatteryInfo();
  if (!info) return false;
  return !info.charging && info.level < 0.15;
}

/**
 * Check if the device is likely a mobile device.
 * @returns {boolean}
 */
export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)); // iPad with desktop mode
}

/**
 * Get recommended parallel channel count based on device and battery.
 * @param {number} requested - user-requested parallel channel count
 * @returns {Promise<number>}
 */
export async function getRecommendedChannelCount(requested) {
  const battery = await getBatteryInfo();
  // If battery critically low and not charging, limit to 1 channel
  if (battery && !battery.charging && battery.level < 0.15) {
    return 1;
  }
  return requested;
}
