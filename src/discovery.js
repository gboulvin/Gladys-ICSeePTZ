// -----------------------------------------------------------------------------
// Camera search on the local network.
//
// Two complementary paths:
//   - the DVRIP UDP search, broadcast by the Gladys core on our behalf. Many
//     firmwares answer it by BROADCAST to port 34569 instead of answering the
//     sender, and the core only relays the unicast replies to its own query:
//     those cameras stay invisible to it;
//   - a TCP sweep of the DVRIP port, run from the container: the bridge
//     network cannot broadcast, but it reaches every LAN address in unicast,
//     exactly like the camera sessions. A camera answering on TCP 34567 is
//     found whatever its firmware does with the UDP search.
//
// `probe` is injectable so the tests never open a socket.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { DEFAULT_PORT } from './dvrip/protocol.js';

const PROBE_TIMEOUT_MS = 800;
const PROBE_CONCURRENCY = 64;

/**
 * Addresses of a subnet, as the user types it: "192.168.1.0/24",
 * "192.168.1.*", "192.168.1.x" or "192.168.1". Only /24 or smaller: a sweep
 * stays a few seconds long.
 * @param {string} text
 * @returns {string[]|null} null when the text is not a usable subnet
 */
export function expandSubnet(text) {
  const value = String(text ?? '').trim();
  let match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\.(?:\*|x|0))?$/i.exec(value);
  let prefix = 24;
  let base;
  if (match) {
    base = match.slice(1, 4).map(Number);
    base.push(0);
  } else {
    match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value);
    if (!match) {
      return null;
    }
    base = match.slice(1, 5).map(Number);
    prefix = Number(match[5]);
  }
  if (base.some((byte) => byte > 255) || prefix < 24 || prefix > 32) {
    return null;
  }
  const size = 2 ** (32 - prefix);
  const start = base[3] & ~(size - 1) & 0xff;
  const addresses = [];
  for (let last = start; last < start + size; last += 1) {
    // Network and broadcast addresses are no hosts (a /31 and /32 have none).
    if (size >= 4 && (last === start || last === start + size - 1)) {
      continue;
    }
    addresses.push(`${base[0]}.${base[1]}.${base[2]}.${last}`);
  }
  return addresses;
}

/**
 * The /24 subnets of the configured camera addresses (IPv4 only).
 * @param {Array<{ host: string }>} cameras
 */
export function subnetsOf(cameras) {
  const subnets = new Set();
  for (const { host } of cameras) {
    const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(host);
    if (match) {
      subnets.add(`${match[1]}.0/24`);
    }
  }
  return [...subnets];
}

/**
 * Is a TCP port open? Resolves false on refusal, timeout or any error.
 */
export function tcpProbe(host, port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * The addresses answering on the DVRIP port.
 * @param {string[]} addresses
 * @param {object} [options]
 * @param {Function} [options.probe] (host, port) => Promise<boolean>
 * @param {number} [options.port]
 * @returns {Promise<string[]>} in the order of `addresses`
 */
export async function sweep(addresses, { probe = tcpProbe, port = DEFAULT_PORT } = {}) {
  const open = new Array(addresses.length).fill(false);
  let next = 0;
  const worker = async () => {
    while (next < addresses.length) {
      const index = next;
      next += 1;
      open[index] = await probe(addresses[index], port).catch(() => false);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, addresses.length) }, worker));
  return addresses.filter((_, index) => open[index]);
}
