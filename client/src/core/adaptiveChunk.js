/**
 * FastWayShare — adaptiveChunk.js
 * Adaptive chunk size based on RTT and jitter measurements.
 * Dynamically adjusts chunk size to balance throughput and latency.
 */

import { MIN_CHUNK_SIZE, MAX_CHUNK_SIZE, CHUNK_SIZE } from '../utils/constants.js';

const MEASURE_INTERVAL_MS = 2000;   // re-evaluate every 2 seconds
const HISTORY_WINDOW = 5;           // keep last 5 RTT samples for jitter calc

/**
 * RTT / jitter monitor using WebRTC stats.
 * Emits 'update' events with { rtt, jitter, optimalChunkSize }.
 */
export class RTTMonitor extends EventTarget {
  #pc = null;
  #timer = null;
  #rttHistory = [];
  #currentChunkSize = CHUNK_SIZE;
  #running = false;

  /**
   * @param {RTCPeerConnection} pc
   */
  constructor(pc) {
    super();
    this.#pc = pc;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#measure();
    this.#timer = setInterval(() => this.#measure(), MEASURE_INTERVAL_MS);
  }

  stop() {
    this.#running = false;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  async #measure() {
    if (!this.#pc || !this.#running) return;
    try {
      const stats = await this.#pc.getStats();
      for (const report of stats.values()) {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const rttMs = typeof report.currentRoundTripTime === 'number'
            ? report.currentRoundTripTime * 1000
            : null;

          if (rttMs !== null) {
            this.#rttHistory.push(rttMs);
            if (this.#rttHistory.length > HISTORY_WINDOW) {
              this.#rttHistory.shift();
            }

            const jitter = this.#calcJitter();
            const optimalChunkSize = this.#calcOptimalChunkSize(rttMs, jitter);
            this.#currentChunkSize = optimalChunkSize;

            this.dispatchEvent(new CustomEvent('update', {
              detail: { rtt: rttMs, jitter, optimalChunkSize }
            }));
          }
          break;
        }
      }
    } catch {
      // stats unavailable — keep current size
    }
  }

  #calcJitter() {
    if (this.#rttHistory.length < 2) return 0;
    const diffs = [];
    for (let i = 1; i < this.#rttHistory.length; i++) {
      diffs.push(Math.abs(this.#rttHistory[i] - this.#rttHistory[i - 1]));
    }
    return diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }

  /**
   * Calculate optimal chunk size based on RTT and jitter.
   * @param {number} rtt  milliseconds
   * @param {number} jitter  milliseconds
   * @returns {number}
   */
  #calcOptimalChunkSize(rtt, jitter) {
    // High jitter → smaller chunks for reliability
    if (jitter > 30) return MIN_CHUNK_SIZE;

    // RTT-based sizing
    if (rtt < 5) return MAX_CHUNK_SIZE;        // LAN: 256KB
    if (rtt < 20) return 192 * 1024;           // Fast WAN: 192KB
    if (rtt < 50) return 128 * 1024;           // Typical WAN: 128KB
    if (rtt < 100) return CHUNK_SIZE;           // Slow WAN: 64KB (default)
    return MIN_CHUNK_SIZE;                      // Very slow: 32KB
  }

  get currentChunkSize() { return this.#currentChunkSize; }
}

/**
 * Standalone chunk size calculator (without a live RTCPeerConnection).
 * @param {number} rtt  milliseconds
 * @param {number} jitter  milliseconds
 * @returns {number}
 */
export function calculateOptimalChunkSize(rtt, jitter = 0) {
  if (jitter > 30) return MIN_CHUNK_SIZE;
  if (rtt < 5) return MAX_CHUNK_SIZE;
  if (rtt < 20) return 192 * 1024;
  if (rtt < 50) return 128 * 1024;
  if (rtt < 100) return CHUNK_SIZE;
  return MIN_CHUNK_SIZE;
}
