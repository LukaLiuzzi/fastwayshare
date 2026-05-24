/**
 * FastWayShare — constants.js
 * Application-wide configuration constants.
 * The SIGNALING_URL is updated to point to your deployed Cloudflare Worker.
 */

// Signaling server URL — update after deploying the Cloudflare Worker
export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'wss://fastwayshare-signaling.workers.dev';

// WebRTC configuration
export const ICE_SERVERS = [
  // Free STUN servers (Google + Cloudflare)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Optional TURN servers — users can override via env/config
  ...(import.meta.env.VITE_TURN_URLS ? [{
    urls: import.meta.env.VITE_TURN_URLS.split(','),
    username: import.meta.env.VITE_TURN_USERNAME || '',
    credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
  }] : []),
];

// WebRTC data channel config
export const DATACHANNEL_LABEL = 'fastwayshare-data';
export const CHUNK_SIZE = 64 * 1024; // 64KB per chunk (safer compatibility for WebRTC)

// Crypto constants
export const CRYPTO_CURVE = 'P-256';
export const CRYPTO_ALGO = 'AES-GCM';
export const CRYPTO_KEY_LENGTH = 256;
export const CRYPTO_IV_LENGTH = 12; // 12 bytes for GCM

// Transfer protocol message types
export const MSG = {
  // Signaling
  JOIN: 'JOIN',
  JOINED: 'JOINED',
  PEER_JOINED: 'PEER_JOINED',
  PEER_DISCONNECTED: 'PEER_DISCONNECTED',
  ROOM_FULL: 'ROOM_FULL',
  OFFER: 'OFFER',
  ANSWER: 'ANSWER',
  ICE: 'ICE',
  ECDH_KEY: 'ECDH_KEY',
  ERROR: 'ERROR',

  // Data channel (P2P)
  FILE_OFFER: 'FILE_OFFER',
  FILE_ACCEPT: 'FILE_ACCEPT',
  FILE_REJECT: 'FILE_REJECT',
  CHUNK: 'CHUNK',
  CHUNK_ACK: 'CHUNK_ACK',
  TRANSFER_COMPLETE: 'TRANSFER_COMPLETE',
  TRANSFER_COMPLETE_ACK: 'TRANSFER_COMPLETE_ACK',
  RESUME_REQUEST: 'RESUME_REQUEST',
  CANCEL: 'CANCEL',
};

// Supported image preview types
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];

// Room code format: 3 letters + dash + 4 digits e.g. "ABC-1234"
export const ROOM_CODE_REGEX = /^[A-Z]{3}-\d{4}$/;

// Max rooms auto-destroy TTL (matches server-side 30 min)
export const ROOM_TTL_MS = 30 * 60 * 1000;
