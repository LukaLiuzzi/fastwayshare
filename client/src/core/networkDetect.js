/**
 * FastWayShare — networkDetect.js
 * Local network / Wi-Fi detection and ICE server filtering.
 * Enables "Ultra Local Mode" — skip TURN relay when on same network.
 */

/**
 * Check if an IP address is a local/private address.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIP(ip) {
  if (!ip) return false;
  // IPv6 link-local
  if (ip.startsWith('fe80:') || ip === '::1') return true;
  // IPv4 private ranges
  return (
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.') ||
    ip === '127.0.0.1'
  );
}

/**
 * Extract local IP candidates from an SDP string.
 * @param {string} sdp
 * @returns {string[]}
 */
export function extractLocalIPs(sdp) {
  if (!sdp) return [];
  const ips = [];
  const re = /a=candidate:[^\r\n]+typ host[^\r\n]*/g;
  let m;
  while ((m = re.exec(sdp)) !== null) {
    // candidate format: a=candidate:<foundation> <component> <protocol> <priority> <ip> <port> typ host
    const parts = m[0].split(' ');
    if (parts.length >= 6) {
      ips.push(parts[4]);
    }
  }
  return ips;
}

/**
 * Detect if both peers appear to be on the same local network
 * by checking if the active candidate pair uses private IPs.
 *
 * @param {RTCPeerConnection} pc
 * @returns {Promise<'local' | 'direct' | 'relay' | 'unknown'>}
 */
export async function detectConnectionLocality(pc) {
  if (!pc) return 'unknown';
  try {
    const stats = await pc.getStats();
    for (const report of stats.values()) {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        const local = stats.get(report.localCandidateId);
        const remote = stats.get(report.remoteCandidateId);

        if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') {
          return 'relay';
        }
        if (isPrivateIP(local?.address) && isPrivateIP(remote?.address)) {
          return 'local'; // both on same LAN
        }
        return 'direct';
      }
    }
  } catch {
    // stats not available
  }
  return 'unknown';
}

/**
 * Filter ICE servers for ultra-local mode.
 * In ultra-local mode we first try with STUN only (no TURN).
 * This avoids relay overhead when both peers are on the same Wi-Fi.
 *
 * @param {RTCIceServer[]} servers
 * @param {boolean} includeTurn
 * @returns {RTCIceServer[]}
 */
export function filterICEServers(servers, includeTurn = true) {
  if (includeTurn) return servers;
  return servers.filter(s => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.every(u => u.startsWith('stun:'));
  });
}

/**
 * Get the current connection's RTT from WebRTC stats.
 * @param {RTCPeerConnection} pc
 * @returns {Promise<number|null>} RTT in milliseconds, or null
 */
export async function getConnectionRTT(pc) {
  if (!pc) return null;
  try {
    const stats = await pc.getStats();
    for (const report of stats.values()) {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        if (typeof report.currentRoundTripTime === 'number') {
          return report.currentRoundTripTime * 1000; // convert to ms
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}
