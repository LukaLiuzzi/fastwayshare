/**
 * FastWayShare — signaling.js
 * WebSocket signaling client for WebRTC peer discovery.
 * Handles connection to the Cloudflare Worker + Durable Object.
 * Features: auto-reconnect with exponential backoff, heartbeat, typed messages.
 */

import { SIGNALING_URL, MSG } from '../utils/constants.js';

const HEARTBEAT_INTERVAL = 25_000; // 25s keep-alive ping
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;

export class SignalingClient extends EventTarget {
  /** @type {WebSocket|null} */
  #ws = null;
  #roomCode = null;
  #role = null;
  #heartbeatTimer = null;
  #reconnectAttempts = 0;
  #manualClose = false;

  /**
   * Connect to a signaling room.
   * @param {string} roomCode  e.g. 'ABC-1234'
   * @param {'sender'|'receiver'} role
   */
  async connect(roomCode, role) {
    this.#roomCode = roomCode;
    this.#role = role;
    this.#manualClose = false;
    this.#reconnectAttempts = 0;
    await this.#openSocket();
  }

  async #openSocket() {
    const url = `${SIGNALING_URL}/room/${this.#roomCode}/ws`;
    this.#ws = new WebSocket(url);
    this.#ws.binaryType = 'arraybuffer';

    this.#ws.addEventListener('open', () => {
      this.#reconnectAttempts = 0;
      this.#startHeartbeat();
      // Join the room
      this.#send({ type: MSG.JOIN, role: this.#role });
      this.#emit('open');
    });

    this.#ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.#emit('message', msg);
        // Dispatch specific event types for convenience
        this.#emit(msg.type, msg);
      } catch {
        // ignore malformed messages
      }
    });

    this.#ws.addEventListener('close', (event) => {
      this.#stopHeartbeat();
      this.#emit('close', { code: event.code, reason: event.reason });
      if (!this.#manualClose) this.#scheduleReconnect();
    });

    this.#ws.addEventListener('error', () => {
      this.#emit('error');
    });
  }

  #scheduleReconnect() {
    if (this.#reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.#emit('reconnect_failed');
      return;
    }
    const delay = RECONNECT_BASE_DELAY * Math.pow(2, this.#reconnectAttempts);
    this.#reconnectAttempts++;
    this.#emit('reconnecting', { attempt: this.#reconnectAttempts, delay });
    setTimeout(() => this.#openSocket(), delay);
  }

  #startHeartbeat() {
    this.#heartbeatTimer = setInterval(() => {
      if (this.#ws?.readyState === WebSocket.OPEN) {
        this.#ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, HEARTBEAT_INTERVAL);
  }

  #stopHeartbeat() {
    clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
  }

  /**
   * Send a signaling message to the server (which relays to the peer).
   * @param {object} msg
   */
  send(msg) {
    this.#send(msg);
  }

  #send(msg) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Close the WebSocket connection.
   */
  close() {
    this.#manualClose = true;
    this.#stopHeartbeat();
    this.#ws?.close(1000, 'user_close');
    this.#ws = null;
  }

  /** Emit a CustomEvent on this EventTarget */
  #emit(type, detail = null) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get isConnected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Create a new signaling room via REST API.
 * @returns {Promise<{roomCode: string, roomId: string}>}
 */
export async function createRoom() {
  const baseUrl = SIGNALING_URL.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  const res = await fetch(`${baseUrl}/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return res.json();
}
