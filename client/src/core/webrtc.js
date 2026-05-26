/**
 * FastWayShare — webrtc.js
 * WebRTC connection manager.
 * Features:
 *   - Multiple parallel DataChannels (configurable count)
 *   - Ultra-local mode (STUN-only first, TURN fallback)
 *   - Connection type + locality detection
 *   - Flow control per-channel
 *   - Trickle ICE (already default WebRTC behavior)
 */

import { DATACHANNEL_LABEL, MSG } from '../utils/constants.js';
import { filterICEServers, detectConnectionLocality } from './networkDetect.js';

const ULTRA_LOCAL_TIMEOUT_MS = 5000; // 5s — if no connection with STUN-only, add TURN

export class WebRTCManager extends EventTarget {
  /** @type {RTCPeerConnection|null} */
  #pc = null;
  /** @type {RTCDataChannel[]} */
  #channels = [];
  #channelCount = 1;
  #openChannels = 0;
  #isSender = false;
  #connectionType = 'unknown'; // 'local' | 'direct' | 'relay' | 'unknown'
  #allIceServers = [];
  #roundRobinIndex = 0;

  constructor() {
    super();
  }

  /**
   * Initialize the peer connection.
   * @param {import('./signaling.js').SignalingClient} signalingClient
   * @param {boolean} isSender
   * @param {object} [options]
   * @param {number} [options.channelCount=1]
   * @param {RTCIceServer[]} [options.iceServers]
   */
  async init(signalingClient, isSender, options = {}) {
    this.#isSender = isSender;
    this.#channelCount = options.channelCount ?? 1;
    this.#allIceServers = options.iceServers ?? [];
    this.#openChannels = 0;
    this.#channels = [];
    this.#roundRobinIndex = 0;

    // We ALWAYS try STUN-only first to prioritize local network (fastest route)
    const initialServers = filterICEServers(this.#allIceServers, false); // STUN only
    this.#pc = new RTCPeerConnection({ iceServers: initialServers });

    // ICE candidate handling (trickle ICE)
    this.#pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        signalingClient.send({
          type: MSG.ICE,
          candidate: event.candidate.toJSON(),
        });
      }
    });

    // Fallback: if no connection after timeout, restart ICE with TURN
    this.#scheduleUltraLocalFallback(signalingClient);

    // Connection state
    this.#pc.addEventListener('connectionstatechange', () => {
      const state = this.#pc.connectionState;
      this.#emit('connectionstate', { state });

      if (state === 'connected') {
        this.#detectConnectionType();
        this.#emit('connected');
      } else if (state === 'disconnected' || state === 'failed') {
        this.#emit('disconnected', { state });
      }
    });

    this.#pc.addEventListener('iceconnectionstatechange', () => {
      if (this.#pc.iceConnectionState === 'connected') {
        this.#detectConnectionType();
      }
    });

    if (isSender) {
      // Sender creates N DataChannels
      for (let i = 0; i < this.#channelCount; i++) {
        const dc = this.#pc.createDataChannel(`${DATACHANNEL_LABEL}-${i}`, {
          ordered: true,
          negotiated: false,
        });
        this.#setupDataChannel(dc, i);
        this.#channels.push(dc);
      }

      const offer = await this.#pc.createOffer();
      await this.#pc.setLocalDescription(offer);
      signalingClient.send({ type: MSG.OFFER, sdp: offer });
    } else {
      // Receiver waits for data channels
      this.#pc.addEventListener('datachannel', (event) => {
        const dc = event.channel;
        // Extract channel index from label
        const match = dc.label.match(/-(\d+)$/);
        const idx = match ? parseInt(match[1], 10) : this.#channels.length;
        this.#channels[idx] = dc;
        this.#setupDataChannel(dc, idx);
      });
    }
  }

  #scheduleUltraLocalFallback(signalingClient) {
    const timer = setTimeout(async () => {
      // If still not connected, add TURN servers and restart ICE
      if (this.#pc && this.#pc.connectionState !== 'connected') {
        console.log('[WebRTC] Ultra-local fallback: adding TURN servers');
        try {
          this.#pc.setConfiguration({ iceServers: this.#allIceServers });
          await this.#pc.restartIce?.();
        } catch (e) {
          console.warn('[WebRTC] ICE restart failed:', e);
        }
      }
    }, ULTRA_LOCAL_TIMEOUT_MS);

    // Cancel if we connect quickly
    this.addEventListener('connected', () => clearTimeout(timer), { once: true });
  }

  /**
   * Handle incoming SDP offer (receiver side).
   */
  async handleOffer(offer, signalingClient) {
    await this.#pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.#pc.createAnswer();
    await this.#pc.setLocalDescription(answer);
    signalingClient.send({ type: MSG.ANSWER, sdp: answer });
  }

  /**
   * Handle incoming SDP answer (sender side).
   */
  async handleAnswer(answer) {
    await this.#pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Add an ICE candidate received from the peer.
   */
  async addIceCandidate(candidate) {
    try {
      await this.#pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Benign: candidate may arrive before remote description
    }
  }

  /**
   * Wait for the DataChannel buffer to be below the threshold (flow control).
   * @param {number} [channelIndex=0]
   */
  async waitForBuffer(channelIndex = 0) {
    const dc = this.#channels[channelIndex] ?? this.#channels[0];
    if (!dc || dc.readyState !== 'open') return;

    const THRESHOLD = 1024 * 1024; // 1MB
    dc.bufferedAmountLowThreshold = THRESHOLD;

    if (dc.bufferedAmount > THRESHOLD) {
      await new Promise((resolve) => {
        const onLow = () => { cleanup(); resolve(); };
        const onClose = () => { cleanup(); resolve(); };
        const cleanup = () => {
          dc?.removeEventListener('bufferedamountlow', onLow);
          dc?.removeEventListener('close', onClose);
          dc?.removeEventListener('error', onClose);
        };
        dc.addEventListener('bufferedamountlow', onLow);
        dc.addEventListener('close', onClose);
        dc.addEventListener('error', onClose);
      });
    }
  }

  /**
   * Send binary data on a specific channel.
   * @param {ArrayBuffer} data
   * @param {number} [channelIndex=0]
   */
  sendData(data, channelIndex = 0) {
    const dc = this.#channels[channelIndex] ?? this.#channels[0];
    if (dc?.readyState === 'open') {
      dc.send(data);
    }
  }

  /**
   * Send binary data round-robin across open channels.
   * @param {ArrayBuffer} data
   * @returns {number} the channel index used
   */
  sendDataRoundRobin(data) {
    const openChannels = this.#channels.filter(dc => dc?.readyState === 'open');
    if (openChannels.length === 0) return -1;

    this.#roundRobinIndex = (this.#roundRobinIndex + 1) % openChannels.length;
    const dc = openChannels[this.#roundRobinIndex];
    if (dc) {
      dc.send(data);
      return this.#roundRobinIndex;
    }
    return -1;
  }

  /**
   * Wait for buffer on the least-busy open channel.
   */
  async waitForAnyBuffer() {
    // Find the channel with lowest bufferedAmount
    let best = null;
    let bestIdx = 0;
    for (let i = 0; i < this.#channels.length; i++) {
      const dc = this.#channels[i];
      if (dc?.readyState === 'open') {
        if (!best || dc.bufferedAmount < best.bufferedAmount) {
          best = dc;
          bestIdx = i;
        }
      }
    }
    if (best) await this.waitForBuffer(bestIdx);
  }

  /**
   * Send a JSON message over the first available DataChannel.
   */
  sendMessage(msg) {
    for (const dc of this.#channels) {
      if (dc?.readyState === 'open') {
        dc.send(JSON.stringify(msg));
        return;
      }
    }
  }

  #setupDataChannel(dc, idx) {
    dc.binaryType = 'arraybuffer';

    dc.addEventListener('open', () => {
      this.#openChannels++;
      this.#emit('datachannel_open', { index: idx, openCount: this.#openChannels });
    });

    dc.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          this.#emit('message', msg);
        } catch (e) {
          console.error('Failed to parse text message:', e);
        }
      } else if (data instanceof ArrayBuffer) {
        this.#emit('chunk', data);
      }
    });

    dc.addEventListener('close', () => {
      this.#openChannels = Math.max(0, this.#openChannels - 1);
      this.#emit('datachannel_close', { index: idx });
    });

    dc.addEventListener('error', (e) => {
      this.#emit('datachannel_error', { error: e, index: idx });
    });
  }

  async #detectConnectionType() {
    const locality = await detectConnectionLocality(this.#pc);
    this.#connectionType = locality;
    this.#emit('connectiontype', { type: locality });
  }

  /** Get the underlying RTCPeerConnection (for RTT monitoring) */
  get pc() { return this.#pc; }

  close() {
    for (const dc of this.#channels) {
      try { dc?.close(); } catch { /* ignore */ }
    }
    this.#channels = [];
    this.#pc?.close();
    this.#pc = null;
    this.#openChannels = 0;
  }

  get connectionType() { return this.#connectionType; }
  get isOpen() { return this.#channels.some(dc => dc?.readyState === 'open'); }
  get allOpen() {
    return this.#channels.length > 0 &&
      this.#channels.every(dc => dc?.readyState === 'open');
  }
  get openChannelCount() { return this.#openChannels; }
  get channelCount() { return this.#channelCount; }

  #emit(type, detail = null) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
