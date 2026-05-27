/**
 * FastWayShare – SignalingRoom Durable Object (src/room.js)
 *
 * Each SignalingRoom instance mediates a single file-transfer session between
 * exactly two peers: a "sender" and a "receiver".  Its only job is to relay
 * WebRTC signaling messages (offer/answer/ICE candidates) and ECDH public keys
 * so the peers can establish a direct, end-to-end encrypted data channel.
 *
 * Design decisions:
 *   • WebSocket Hibernation API  – the DO sleeps between messages and does NOT
 *     accrue Duration (GB-s) charges while idle.
 *   • Zero persistent storage    – peer identities live only in memory.  After a
 *     Worker restart the in-memory state is rebuilt from the WebSocket
 *     attachment blobs (see serializeAttachment / deserializeAttachment usage).
 *   • SQLite-backed DO (free tier) – required by new_sqlite_classes migration,
 *     but we only use the storage layer for the room-TTL alarm.
 *   • Room TTL                   – an alarm fires 30 minutes after first
 *     connection; the DO closes all sockets and lets itself expire.
 *
 * ─── Message protocol ─────────────────────────────────────────────────────────
 *
 *  Client → Server
 *    { type: 'JOIN',     role: 'sender'|'receiver' }
 *    { type: 'OFFER',    sdp: string }          sender  → (relayed) → receiver
 *    { type: 'ANSWER',   sdp: string }          receiver → (relayed) → sender
 *    { type: 'ICE',      candidate: object }    both directions
 *    { type: 'ECDH_KEY', publicKey: string }    both directions
 *
 *  Server → Client
 *    { type: 'JOINED',           peerId: '0'|'1', roomCode: string }
 *    { type: 'PEER_JOINED' }     (sent to first peer when the second joins)
 *    { type: 'PEER_DISCONNECTED' }
 *    { type: 'ROOM_FULL' }       (third+ client tries to join)
 *    { type: 'ERROR',            message: string }
 */

import { DurableObject } from 'cloudflare:workers';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Room TTL: 30 minutes from the moment the alarm is first set. */
const ROOM_TTL_MS = 30 * 60 * 1_000;

/**
 * Keys used in the WebSocket attachment blob.
 * The attachment is serialised with each WebSocket so we can recover peer
 * metadata after the DO hibernates and its in-memory state is reset.
 *
 * Stored per-socket: { peerId, role, roomCode }
 */
const ATTACH_PEER_ID   = 'peerId';   // '0' or '1'
const ATTACH_ROLE      = 'role';     // 'sender' | 'receiver'
const ATTACH_ROOM_CODE = 'roomCode'; // e.g. 'ABC-1234'

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Send a JSON message to a WebSocket.  Swallows errors if the socket is
 * already closed (safe to call at any time).
 *
 * @param {WebSocket} ws
 * @param {object}    payload
 */
function safeSend(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Socket already closed — nothing to do.
  }
}

/**
 * Extract the room code from the incoming WebSocket upgrade URL.
 * URL pattern: /room/:code/ws
 *
 * @param {Request} request
 * @returns {string}
 */
function roomCodeFromRequest(request) {
  const url = new URL(request.url);
  // pathname looks like /room/ABC-1234/ws
  const match = url.pathname.match(/^\/room\/([^/]+)\/ws$/);
  return match ? match[1] : 'unknown';
}

// ─── Durable Object ──────────────────────────────────────────────────────────

export class SignalingRoom extends DurableObject {
  /**
   * @param {DurableObjectState} ctx
   * @param {object}             env
   */
  constructor(ctx, env) {
    super(ctx, env);

    /**
     * In-memory peer registry.  Keyed by peerId ('0' or '1').
     * Each entry: { ws: WebSocket, role: string }
     *
     * This map is rebuilt from WebSocket attachments after hibernation
     * (see _rebuildPeers).  It is intentionally NOT written to storage —
     * if the DO is evicted while both sockets are open the Hibernation API
     * will fire webSocketMessage / webSocketClose handlers which call
     * _rebuildPeers() to restore context.
     *
     * @type {Map<string, { ws: WebSocket, role: string }>}
     */
    this.peers = new Map();

    /**
     * Whether the 30-minute TTL alarm has been scheduled.
     * Stored only in memory; if the DO is evicted and restarted we simply
     * skip re-scheduling (the alarm already exists in the storage layer).
     */
    this.alarmScheduled = false;
  }

  // ─── fetch() ── WebSocket upgrade ────────────────────────────────────────

  /**
   * Accept an incoming WebSocket upgrade from the Worker.
   * The Worker has already validated the Upgrade header before proxying here.
   *
   * @param {Request} request
   * @returns {Response}
   */
  async fetch(request) {
    const roomCode = roomCodeFromRequest(request);

    // Rebuild in-memory peer state (no-op if not hibernated).
    this._rebuildPeers();

    // Reject a third peer immediately.
    if (this.peers.size >= 2) {
      // We still need to accept the WebSocket to send the ROOM_FULL message
      // before closing, otherwise the client gets a generic network error.
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Use standard accept (not Hibernation) — this socket will close right away.
      server.accept();
      safeSend(server, { type: 'ROOM_FULL' });
      server.close(4000, 'Room is full');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Assign a peer ID: '0' for the first peer, '1' for the second.
    const peerId = this.peers.size === 0 ? '0' : '1';

    // Create the WebSocket pair and hand the server end to the DO.
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // acceptWebSocket() ← Hibernation API.  The DO can now sleep between
    // messages without disconnecting the client.
    this.ctx.acceptWebSocket(server);

    // Persist peer metadata in the attachment so it survives hibernation.
    // The attachment is a plain JSON-serialisable object.
    server.serializeAttachment({ [ATTACH_PEER_ID]: peerId, [ATTACH_ROOM_CODE]: roomCode });

    // Register in the in-memory map (fast path for the active session).
    // Role is set once the client sends JOIN; default to null for now.
    this.peers.set(peerId, { ws: server, role: null });

    // Schedule the room-TTL alarm on the first connection.
    if (!this.alarmScheduled) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      this.alarmScheduled = true;
    }

    // Tell the peer what slot they occupy and what room they're in.
    safeSend(server, { type: 'JOINED', peerId, roomCode });

    // If this is the second peer, notify the first that their partner arrived.
    if (peerId === '1') {
      const firstPeer = this.peers.get('0');
      if (firstPeer) {
        safeSend(firstPeer.ws, { type: 'PEER_JOINED' });
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Hibernation API handlers ────────────────────────────────────────────

  /**
   * Called when a message is received on any managed WebSocket.
   * The DO may have hibernated since the last event, so we always call
   * _rebuildPeers() first to restore the in-memory registry.
   *
   * @param {WebSocket} ws
   * @param {string | ArrayBuffer} message
   */
  async webSocketMessage(ws, message) {
    // Restore in-memory state if the DO was hibernated.
    this._rebuildPeers();

    // Parse the message; send an error and return on bad JSON.
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      safeSend(ws, { type: 'ERROR', message: 'Invalid JSON.' });
      return;
    }

    const { type } = data;

    // Identify the sender from the WebSocket attachment.
    const attachment = ws.deserializeAttachment();
    const senderPeerId = attachment?.[ATTACH_PEER_ID];

    // ── JOIN ─────────────────────────────────────────────────────────────
    // The client declares its role (sender / receiver) after connecting.
    if (type === 'JOIN') {
      const { role } = data;
      if (role !== 'sender' && role !== 'receiver') {
        safeSend(ws, { type: 'ERROR', message: "role must be 'sender' or 'receiver'." });
        return;
      }

      // Store role in both the attachment (survives hibernation) and in-memory.
      ws.serializeAttachment({
        ...(attachment ?? {}),
        [ATTACH_ROLE]: role,
      });

      const peer = this.peers.get(senderPeerId);
      if (peer) peer.role = role;

      // JOIN is acknowledged by the initial JOINED message; nothing more to do.
      return;
    }

    // ── Relay messages ───────────────────────────────────────────────────
    // OFFER, ANSWER, ICE, ECDH_KEY are forwarded verbatim to the OTHER peer.
    const RELAY_TYPES = new Set(['OFFER', 'ANSWER', 'ICE', 'ECDH_KEY', 'ICE_RESTART_REQUEST']);
    if (RELAY_TYPES.has(type)) {
      const otherPeerId = senderPeerId === '0' ? '1' : '0';
      const otherPeer = this.peers.get(otherPeerId);

      if (!otherPeer) {
        // Other peer hasn't joined yet — the client should wait for PEER_JOINED.
        safeSend(ws, { type: 'ERROR', message: 'Other peer is not connected yet.' });
        return;
      }

      // Forward the whole message payload to the other peer.
      safeSend(otherPeer.ws, data);
      return;
    }

    // Unknown message type.
    safeSend(ws, { type: 'ERROR', message: `Unknown message type: ${type}` });
  }

  /**
   * Called when a WebSocket is closed (by the client or by the server).
   * Notifies the remaining peer that their partner has left.
   *
   * @param {WebSocket} ws
   * @param {number}    code
   * @param {string}    reason
   * @param {boolean}   wasClean
   */
  async webSocketClose(ws, code, reason, wasClean) {
    this._rebuildPeers();

    const attachment = ws.deserializeAttachment();
    const peerId = attachment?.[ATTACH_PEER_ID];

    // Remove the disconnected peer from the registry.
    this.peers.delete(peerId);

    // Notify the remaining peer.
    const otherPeerId = peerId === '0' ? '1' : '0';
    const otherPeer = this.peers.get(otherPeerId);
    if (otherPeer) {
      safeSend(otherPeer.ws, { type: 'PEER_DISCONNECTED' });
    }

    // Compatibility: with compat date >= 2026-01-01 the runtime auto-replies
    // to Close frames, so close() is a no-op here but safe to call.
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  /**
   * Called on WebSocket errors.  We remove the broken socket and inform the
   * other peer.
   *
   * @param {WebSocket} ws
   * @param {Error}     error
   */
  async webSocketError(ws, error) {
    console.error('[SignalingRoom] webSocketError:', error?.message ?? error);
    // Delegate to the close handler for cleanup logic.
    await this.webSocketClose(ws, 1011, 'Internal error', false);
  }

  // ─── Alarm handler ───────────────────────────────────────────────────────

  /**
   * Room TTL: close all sockets and allow the DO to expire naturally.
   * Called 30 minutes after the first peer connects.
   */
  async alarm() {
    console.log('[SignalingRoom] TTL alarm fired — closing room.');

    // Rebuild peer state in case we were hibernated.
    this._rebuildPeers();

    // Gracefully close every open WebSocket with a "going away" status.
    for (const ws of this.ctx.getWebSockets()) {
      try {
        safeSend(ws, { type: 'ERROR', message: 'Room has expired (30-minute TTL).' });
        ws.close(1001, 'Room expired');
      } catch { /* ignore */ }
    }

    // Clear in-memory state.
    this.peers.clear();

    // The DO will expire on its own once it has no active connections or
    // pending alarms.  No further action needed.
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Rebuild the in-memory `peers` map from the attachment blobs that are
   * serialized with each WebSocket managed by the Hibernation API.
   *
   * This is called at the top of every Hibernation handler so that the DO can
   * immediately act on peer context even after being evicted from memory.
   *
   * No-op if the map is already populated (i.e., we were not hibernated).
   */
  _rebuildPeers() {
    // If we already have peers in memory the DO was not hibernated — skip.
    if (this.peers.size > 0) return;

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment();
      if (!attachment) continue;

      const peerId = attachment[ATTACH_PEER_ID];
      const role   = attachment[ATTACH_ROLE] ?? null;

      if (peerId !== undefined) {
        this.peers.set(peerId, { ws, role });
      }
    }
  }
}
