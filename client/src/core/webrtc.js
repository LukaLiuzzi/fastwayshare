/**
 * FastWayShare — webrtc.js
 * WebRTC connection manager.
 * Handles ICE negotiation, DataChannel creation, and connection type detection.
 */

import { ICE_SERVERS, DATACHANNEL_LABEL, MSG } from '../utils/constants.js';

export class WebRTCManager extends EventTarget {
  /** @type {RTCPeerConnection|null} */
  #pc = null;
  /** @type {RTCDataChannel|null} */
  #dc = null;
  #isSender = false;
  #connectionType = 'unknown'; // 'direct' | 'relay' | 'unknown'

  constructor() {
    super();
  }

  /**
   * Initialize the peer connection with the given signaling client.
   * @param {import('./signaling.js').SignalingClient} signalingClient
   * @param {boolean} isSender  true if this peer initiates the offer
   */
  async init(signalingClient, isSender) {
    this.#isSender = isSender;
    this.#pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // ICE candidate handling
    this.#pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        signalingClient.send({
          type: MSG.ICE,
          candidate: event.candidate.toJSON(),
        });
      }
    });

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

    // ICE connection state for relay detection
    this.#pc.addEventListener('iceconnectionstatechange', () => {
      if (this.#pc.iceConnectionState === 'connected') {
        this.#detectConnectionType();
      }
    });

    if (isSender) {
      // Sender creates data channel
      this.#dc = this.#pc.createDataChannel(DATACHANNEL_LABEL, {
        ordered: true,
      });
      this.#setupDataChannel(this.#dc);

      // Create offer
      const offer = await this.#pc.createOffer();
      await this.#pc.setLocalDescription(offer);
      signalingClient.send({ type: MSG.OFFER, sdp: offer });
    } else {
      // Receiver waits for data channel
      this.#pc.addEventListener('datachannel', (event) => {
        this.#dc = event.channel;
        this.#setupDataChannel(this.#dc);
      });
    }
  }

  /**
   * Handle incoming SDP offer (receiver side).
   * @param {RTCSessionDescriptionInit} offer
   * @param {import('./signaling.js').SignalingClient} signalingClient
   */
  async handleOffer(offer, signalingClient) {
    await this.#pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.#pc.createAnswer();
    await this.#pc.setLocalDescription(answer);
    signalingClient.send({ type: MSG.ANSWER, sdp: answer });
  }

  /**
   * Handle incoming SDP answer (sender side).
   * @param {RTCSessionDescriptionInit} answer
   */
  async handleAnswer(answer) {
    await this.#pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Add an ICE candidate received from the peer.
   * @param {RTCIceCandidateInit} candidate
   */
  async addIceCandidate(candidate) {
    try {
      await this.#pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Benign: candidate may arrive before remote description
    }
  }

  /**
   * Wait for the DataChannel buffer to be below the threshold if needed (flow control).
   * @returns {Promise<void>}
   */
  async waitForBuffer() {
    if (!this.#dc || this.#dc.readyState !== 'open') return;

    const THRESHOLD = 1024 * 1024; // 1 MB buffer threshold
    this.#dc.bufferedAmountLowThreshold = THRESHOLD;

    if (this.#dc.bufferedAmount > THRESHOLD) {
      await new Promise((resolve) => {
        const onLow = () => {
          cleanup();
          resolve();
        };
        const onClose = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          this.#dc?.removeEventListener('bufferedamountlow', onLow);
          this.#dc?.removeEventListener('close', onClose);
          this.#dc?.removeEventListener('error', onClose);
        };
        this.#dc.addEventListener('bufferedamountlow', onLow);
        this.#dc.addEventListener('close', onClose);
        this.#dc.addEventListener('error', onClose);
      });
    }
  }

  /**
   * Send binary data over the DataChannel.
   * @param {ArrayBuffer} data
   */
  sendData(data) {
    if (this.#dc?.readyState === 'open') {
      this.#dc.send(data);
    }
  }

  /**
   * Send a JSON message over the DataChannel.
   * @param {object} msg
   */
  sendMessage(msg) {
    if (this.#dc?.readyState === 'open') {
      this.#dc.send(JSON.stringify(msg));
    }
  }

  #setupDataChannel(dc) {
    dc.binaryType = 'arraybuffer';

    dc.addEventListener('open', () => {
      this.#emit('datachannel_open');
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
      this.#emit('datachannel_close');
    });

    dc.addEventListener('error', (e) => {
      this.#emit('datachannel_error', { error: e });
    });
  }

  async #detectConnectionType() {
    if (!this.#pc) return;
    try {
      const stats = await this.#pc.getStats();
      for (const report of stats.values()) {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const localCandidate = stats.get(report.localCandidateId);
          const remoteCandidate = stats.get(report.remoteCandidateId);
          if (localCandidate?.candidateType === 'relay' || remoteCandidate?.candidateType === 'relay') {
            this.#connectionType = 'relay';
          } else {
            this.#connectionType = 'direct';
          }
          this.#emit('connectiontype', { type: this.#connectionType });
          break;
        }
      }
    } catch {
      // Stats not available in all browsers
    }
  }

  close() {
    this.#dc?.close();
    this.#pc?.close();
    this.#dc = null;
    this.#pc = null;
  }

  get connectionType() { return this.#connectionType; }
  get isOpen() { return this.#dc?.readyState === 'open'; }

  #emit(type, detail = null) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
