/**
 * FastWayShare — constants.js
 * Application-wide configuration constants.
 */

// Signaling server URL — update after deploying the Cloudflare Worker
export const SIGNALING_URL =
	import.meta.env.VITE_SIGNALING_URL || 'wss://fastwayshare.workers.dev';

// WebRTC configuration — default ICE servers (overridable via settings)
export const DEFAULT_ICE_SERVERS = [
	// Free STUN servers (Google + Cloudflare)
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun1.l.google.com:19302' },
	{ urls: 'stun:stun.cloudflare.com:3478' },
	// Optional TURN servers — users can override via env/config
	...(import.meta.env.VITE_TURN_URLS
		? [
				{
					urls: import.meta.env.VITE_TURN_URLS.split(','),
					username: import.meta.env.VITE_TURN_USERNAME || '',
					credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
				},
			]
		: []),
];

// Keep legacy export alias for backward compat
export const ICE_SERVERS = DEFAULT_ICE_SERVERS;

// WebRTC data channel config
export const DATACHANNEL_LABEL = 'fastwayshare-data';
export const DATACHANNEL_COUNT_DEFAULT = 4; // parallel DataChannels

// Chunk sizes
export const CHUNK_SIZE = 64 * 1024;        // default 64KB
export const MIN_CHUNK_SIZE = 32 * 1024;    // 32KB — high jitter / slow links
export const MAX_CHUNK_SIZE = 256 * 1024;   // 256KB — LAN / low latency

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

	// Data channel (P2P) — existing
	FILE_OFFER: 'FILE_OFFER',
	FILE_ACCEPT: 'FILE_ACCEPT',
	FILE_REJECT: 'FILE_REJECT',
	CHUNK: 'CHUNK',
	CHUNK_ACK: 'CHUNK_ACK',
	TRANSFER_COMPLETE: 'TRANSFER_COMPLETE',
	TRANSFER_COMPLETE_ACK: 'TRANSFER_COMPLETE_ACK',
	RESUME_REQUEST: 'RESUME_REQUEST',
	CANCEL: 'CANCEL',

	// Data channel (P2P) — new
	PAUSE: 'PAUSE',                     // receiver → sender: pause sending
	RESUME: 'RESUME',                   // receiver → sender: resume sending
	ENCRYPTION_MODE: 'ENCRYPTION_MODE', // negotiate AES on/off + passphrase salt
	ENCRYPTION_ACK: 'ENCRYPTION_ACK',   // ack encryption negotiation
	RTT_PING: 'RTT_PING',               // RTT measurement ping
	RTT_PONG: 'RTT_PONG',               // RTT measurement pong
	CHUNK_MAP: 'CHUNK_MAP',             // receiver sends chunk map for dedup
	CHANNEL_CONFIG: 'CHANNEL_CONFIG',   // negotiate parallel channel count
};

// Supported image preview types
export const IMAGE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/svg+xml',
	'image/bmp',
];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];

// Room code format: 3 letters + dash + 4 digits e.g. "ABC-1234"
export const ROOM_CODE_REGEX = /^[A-Z]{3}-\d{4}$/;

// Max rooms auto-destroy TTL (matches server-side 30 min)
export const ROOM_TTL_MS = 30 * 60 * 1000;
