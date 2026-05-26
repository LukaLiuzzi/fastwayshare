/**
 * FastWayShare — settings.js
 * Centralized reactive settings store for all user-configurable options.
 * Persists to localStorage. Uses EventTarget for reactive updates.
 */

import { DEFAULT_ICE_SERVERS, DATACHANNEL_COUNT_DEFAULT } from '../utils/constants.js';

const STORAGE_KEY = 'fws-settings-v1';

const DEFAULTS = {
  // Encryption
  aesEnabled: false,          // optional AES-256-GCM on top of DTLS
  aesPassphrase: '',          // user passphrase (PBKDF2 key derivation)

  // Network
  stunServers: [],            // custom STUN URLs (array of strings)
  turnUrls: '',               // custom TURN URLs (comma-separated)
  turnUsername: '',
  turnCredential: '',

  // Performance
  parallelChannels: DATACHANNEL_COUNT_DEFAULT,
};

class SettingsStore extends EventTarget {
  #data = { ...DEFAULTS };

  constructor() {
    super();
    this.#load();
  }

  #load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge with defaults so new keys are always present
        this.#data = { ...DEFAULTS, ...parsed };
      }
    } catch {
      this.#data = { ...DEFAULTS };
    }
  }

  #save() {
    try {
      // Don't persist the passphrase for security
      const toSave = { ...this.#data, aesPassphrase: '' };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // ignore storage errors
    }
  }

  get(key) {
    return this.#data[key];
  }

  set(key, value) {
    this.#data[key] = value;
    this.#save();
    this.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
  }

  getAll() {
    return { ...this.#data };
  }

  /**
   * Build the ICE server array for RTCPeerConnection.
   * Merges default STUN servers with any custom STUN/TURN from settings.
   * In ultra-local mode: returns STUN-only first (TURN added on fallback).
   * @param {boolean} includeTurn - whether to include TURN servers
   * @returns {RTCIceServer[]}
   */
  getICEServers(includeTurn = true) {
    const servers = [];

    // Custom STUN servers (if any)
    const customStun = this.#data.stunServers;
    if (Array.isArray(customStun) && customStun.length > 0) {
      for (const url of customStun) {
        if (url.trim()) servers.push({ urls: url.trim() });
      }
    } else {
      // Use defaults
      servers.push(...DEFAULT_ICE_SERVERS.filter(s => !s.username));
    }

    // TURN server (custom or env-based)
    if (includeTurn) {
      const customTurnUrl = this.#data.turnUrls?.trim();
      const customUser = this.#data.turnUsername?.trim();
      const customCred = this.#data.turnCredential?.trim();

      if (customTurnUrl) {
        servers.push({
          urls: customTurnUrl.split(',').map(u => u.trim()).filter(Boolean),
          username: customUser || '',
          credential: customCred || '',
        });
      } else {
        // Fall back to env-based TURN if any
        const envTurn = DEFAULT_ICE_SERVERS.filter(s => s.username);
        servers.push(...envTurn);
      }
    }

    return servers;
  }

  reset() {
    this.#data = { ...DEFAULTS };
    this.#save();
    this.dispatchEvent(new CustomEvent('reset'));
  }
}

// Singleton
export const settings = new SettingsStore();
