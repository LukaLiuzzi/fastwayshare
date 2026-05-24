/**
 * FastWayShare – Signaling Worker (src/index.js)
 *
 * Responsibilities:
 *   1. Add CORS headers so the Cloudflare Pages frontend can call this worker.
 *   2. Route REST endpoints:
 *        GET  /health          → health check
 *        POST /room            → create a new signaling room
 *        GET  /room/:code/ws   → upgrade to WebSocket, hand off to SignalingRoom DO
 *   3. Enforce a simple in-memory rate limit (10 room creates / IP / minute).
 *      Because Workers can run on many isolates this is best-effort, not
 *      a hard guarantee — but it's cheap and slows down casual abuse.
 *
 * The Worker itself is stateless. All per-room state lives in the
 * SignalingRoom Durable Object (see src/room.js).
 */

// Re-export the Durable Object class so Wrangler can bind it.
export { SignalingRoom } from './room.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const VERSION = '1.0.0';

/** Characters used when generating the letter part of a room code (A-Z). */
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Maximum room creation requests per IP per rate-limit window. */
const RATE_LIMIT_MAX = 10;

/** Duration of the rate-limit window in milliseconds (1 minute). */
const RATE_LIMIT_WINDOW_MS = 60_000;

// ─── In-memory rate-limit store ──────────────────────────────────────────────
// Keys are IP addresses; values are { count, windowStart }.
// This map is per-isolate and resets whenever the Worker restarts.
// For a production hard limit, replace with Cloudflare Rate Limiting or KV.
/** @type {Map<string, { count: number, windowStart: number }>} */
const rateLimitMap = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a random room code in the format 'ABC-1234'.
 * Three random uppercase letters, a dash, then four random digits.
 * The search space is 26^3 × 10^4 = ~175 million codes — sufficient for
 * short-lived rooms where codes are shared out-of-band.
 *
 * @returns {string}
 */
function generateRoomCode() {
  let letters = '';
  for (let i = 0; i < 3; i++) {
    letters += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  const digits = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
  return `${letters}-${digits}`;
}

/**
 * Build CORS headers that allow any origin.
 * We need permissive CORS because the frontend is served from a Cloudflare
 * Pages subdomain (or a custom domain) which differs from the Worker's URL.
 *
 * @param {Request} request
 * @returns {Headers}
 */
function buildCorsHeaders(request) {
  const origin = request.headers.get('Origin') ?? '*';
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
}

/**
 * Return a JSON response with CORS and optional extra headers.
 *
 * @param {unknown} body     – Value to serialize as JSON
 * @param {number}  status   – HTTP status code
 * @param {Request} request  – Original request (needed for CORS origin)
 * @returns {Response}
 */
function jsonResponse(body, status, request) {
  const corsHeaders = buildCorsHeaders(request);
  corsHeaders.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

/**
 * Check whether the given IP is within its rate-limit budget.
 * Returns true if the request should be allowed; false if it must be rejected.
 *
 * @param {string} ip
 * @returns {boolean}
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window: reset the counter.
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count += 1;
  return true;
}

// ─── Route handlers ──────────────────────────────────────────────────────────

/**
 * GET /health
 * Simple liveness probe used by uptime monitors and the frontend to verify
 * the signaling server is reachable before attempting to create a room.
 */
function handleHealth(request) {
  return jsonResponse({ ok: true, version: VERSION }, 200, request);
}

/**
 * POST /room
 * Creates a new SignalingRoom Durable Object, keyed by the generated room
 * code, and returns both the human-readable code and the DO's opaque ID.
 *
 * The Durable Object is NOT initialised here — it wakes up on the first
 * WebSocket connection. We simply allocate the stable identifier so that
 * both peers can be routed to the exact same DO instance.
 *
 * @param {Request} request
 * @param {object}  env
 * @returns {Response}
 */
function handleCreateRoom(request, env) {
  // Rate-limit by connecting IP (Cloudflare sets CF-Connecting-IP).
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!checkRateLimit(ip)) {
    return jsonResponse(
      { error: 'Too many room creation requests. Please wait a minute.' },
      429,
      request,
    );
  }

  const roomCode = generateRoomCode();

  // getByName() gives us a deterministic, stable DO instance for this code.
  // If the code already exists (collision), the existing DO is reused, which
  // is fine — the room TTL alarm will clean it up within 30 minutes.
  const doId = env.ROOM.idFromName(roomCode);
  const roomId = doId.toString();

  return jsonResponse({ roomCode, roomId }, 201, request);
}

/**
 * GET /room/:code/ws
 * Validates that the code looks reasonable, resolves the matching Durable
 * Object, and forwards the WebSocket upgrade request to it.
 *
 * @param {Request} request
 * @param {object}  env
 * @param {string}  code   – Room code extracted from the URL
 * @returns {Promise<Response>}
 */
async function handleWebSocket(request, env, code) {
  // Validate the Upgrade header before paying the DO round-trip cost.
  if (request.headers.get('Upgrade') !== 'websocket') {
    return jsonResponse({ error: 'Expected a WebSocket upgrade request.' }, 426, request);
  }

  // Validate room code format: exactly 'AAA-1234'.
  const codePattern = /^[A-Z]{3}-\d{4}$/;
  if (!codePattern.test(code)) {
    return jsonResponse({ error: 'Invalid room code format.' }, 400, request);
  }

  // Route the request to the matching Durable Object.
  const doId = env.ROOM.idFromName(code);
  const stub = env.ROOM.get(doId);

  // Forward the raw WebSocket upgrade to the DO's fetch() handler.
  // The DO will call ctx.acceptWebSocket() and return the 101 response.
  return stub.fetch(request);
}

// ─── Default export (Worker fetch handler) ───────────────────────────────────

export default {
  /**
   * Main fetch handler.
   *
   * @param {Request} request
   * @param {object}  env       – Bindings declared in wrangler.jsonc
   * @param {object}  ctx       – ExecutionContext
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { method, pathname } = { method: request.method, pathname: url.pathname };

    // ── CORS pre-flight ──────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
    }

    // ── Routing ──────────────────────────────────────────────────────────────

    // GET /health
    if (method === 'GET' && pathname === '/health') {
      return handleHealth(request);
    }

    // POST /room  → create a new room
    if (method === 'POST' && pathname === '/room') {
      return handleCreateRoom(request, env);
    }

    // GET /room/:code/ws  → WebSocket upgrade
    // Matches paths like /room/ABC-1234/ws
    const wsMatch = pathname.match(/^\/room\/([^/]+)\/ws$/);
    if (method === 'GET' && wsMatch) {
      return handleWebSocket(request, env, wsMatch[1]);
    }

    // 404 for everything else
    return jsonResponse({ error: 'Not found.' }, 404, request);
  },
};
