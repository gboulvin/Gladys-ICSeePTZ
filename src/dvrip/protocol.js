// -----------------------------------------------------------------------------
// DVRIP ("Sofia", NetSurveillance) wire protocol, spoken by the Xiongmai
// firmwares behind the iCSee / XMEye cameras on TCP port 34567.
//
// Every message is a 20-byte little-endian header followed by a payload:
//
//   offset size  field
//   0      1     head        always 0xFF
//   1      1     version     0x00 (0x01 on some firmwares, ignored on read)
//   2      2     reserved
//   4      4     session id  0 until the login answer gives one
//   8      4     sequence    incremented by the client at each request
//   12     2     reserved    (total packets / current packet, unused here)
//   14     2     message id  e.g. 1000 login, 1400 PTZ, 1560 snapshot
//   16     4     payload length
//
// Requests carry a JSON payload terminated by "\n\0"; the answers to JSON
// requests do too. The snapshot answer is the raw JPEG instead.
//
// This module is pure (no I/O): encoding, decoding and the small helpers the
// protocol needs, so it is tested byte for byte.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const HEADER_LENGTH = 20;
export const DEFAULT_PORT = 34567;
export const DISCOVERY_PORT = 34569;

// Message ids used by the integration (answers are id + 1).
export const MESSAGES = {
  LOGIN: 1000,
  KEEPALIVE: 1006,
  SYSTEM_INFO: 1020,
  CONFIG_GET: 1042,
  PTZ: 1400,
  SYSTEM_MANAGER: 1450,
  ALARM_SUBSCRIBE: 1500,
  ALARM_EVENT: 1504,
  DISCOVERY: 1530,
  DISCOVERY_REPLY: 1531,
  SNAPSHOT: 1560,
};

// `Ret` codes of the JSON answers. Anything else is an error.
export const RET_OK = new Set([100, 515]);
export const RET_MESSAGES = {
  101: 'unknown error',
  102: 'unsupported version',
  103: 'request not permitted',
  104: 'user already logged in',
  105: 'user not logged in',
  106: 'wrong username or password',
  107: 'no permission',
  108: 'timeout',
  109: 'search failed',
  117: 'unsupported command',
  203: 'wrong password',
  205: 'user does not exist',
  206: 'user locked',
  207: 'user in blacklist',
  208: 'user already in use',
  515: 'upgrade successful',
  607: 'unsupported command',
};

// PTZ commands of OPPTZControl.
export const PTZ_COMMANDS = {
  UP: 'DirectionUp',
  DOWN: 'DirectionDown',
  LEFT: 'DirectionLeft',
  RIGHT: 'DirectionRight',
  ZOOM_IN: 'ZoomTile',
  ZOOM_OUT: 'ZoomWide',
  SET_PRESET: 'SetPreset',
  GOTO_PRESET: 'GotoPreset',
  CLEAR_PRESET: 'ClearPreset',
};

// The Preset value of a direction command tells "start" from "stop": the
// firmware keeps moving after a start until it receives the stop.
export const PTZ_START = 65535;
export const PTZ_STOP = -1;

const PAYLOAD_TERMINATOR = Buffer.from([0x0a, 0x00]);
const HASH_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Password hash of the DVRIP login ("Sofia hash"): MD5, then every pair of
 * bytes folded into one alphanumeric character. An empty password (the
 * factory default of many cameras) hashes too.
 * @param {string} password
 * @returns {string} 8 characters.
 */
export function sofiaHash(password = '') {
  const md5 = createHash('md5').update(password, 'utf8').digest();
  let hash = '';
  for (let i = 0; i < md5.length; i += 2) {
    hash += HASH_ALPHABET[(md5[i] + md5[i + 1]) % HASH_ALPHABET.length];
  }
  return hash;
}

/**
 * The session id as the JSON payloads spell it: "0x0000001A".
 * @param {number} session
 */
export function formatSession(session) {
  return `0x${(session >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

/**
 * Encode a request.
 * @param {object} message
 * @param {number} message.messageId
 * @param {number} [message.session]
 * @param {number} [message.sequence]
 * @param {object|string|Buffer} [message.payload] JSON object, or raw bytes
 * @returns {Buffer}
 */
export function encodePacket({ messageId, session = 0, sequence = 0, payload = '' }) {
  let body;
  if (Buffer.isBuffer(payload)) {
    body = payload;
  } else {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    body =
      text.length > 0
        ? Buffer.concat([Buffer.from(text, 'utf8'), PAYLOAD_TERMINATOR])
        : Buffer.alloc(0);
  }
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt8(0xff, 0);
  header.writeUInt8(0x00, 1);
  header.writeUInt32LE(session >>> 0, 4);
  header.writeUInt32LE(sequence >>> 0, 8);
  header.writeUInt16LE(messageId, 14);
  header.writeUInt32LE(body.length, 16);
  return Buffer.concat([header, body]);
}

/**
 * Decode one header.
 * @param {Buffer} header at least HEADER_LENGTH bytes
 */
export function decodeHeader(header) {
  if (header.readUInt8(0) !== 0xff) {
    throw new Error('DVRIP: invalid packet head');
  }
  return {
    session: header.readUInt32LE(4),
    sequence: header.readUInt32LE(8),
    messageId: header.readUInt16LE(14),
    length: header.readUInt32LE(16),
  };
}

// A camera never sends more than a snapshot in one packet: anything bigger is
// a desynchronized stream, not a message.
const MAX_PAYLOAD_LENGTH = 8 * 1024 * 1024;

/**
 * Incremental decoder: feed it the TCP chunks, it returns the complete
 * packets (`{ session, sequence, messageId, payload }`) in order.
 */
export class PacketDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const packets = [];
    while (this.buffer.length >= HEADER_LENGTH) {
      const header = decodeHeader(this.buffer);
      if (header.length > MAX_PAYLOAD_LENGTH) {
        throw new Error(`DVRIP: payload of ${header.length} bytes refused`);
      }
      if (this.buffer.length < HEADER_LENGTH + header.length) {
        break;
      }
      const payload = this.buffer.subarray(HEADER_LENGTH, HEADER_LENGTH + header.length);
      this.buffer = this.buffer.subarray(HEADER_LENGTH + header.length);
      packets.push({ ...header, payload: Buffer.from(payload) });
    }
    return packets;
  }
}

/**
 * Parse a JSON payload (trailing "\n\0" and stray NULs stripped).
 * @param {Buffer} payload
 * @returns {object}
 */
export function parseJsonPayload(payload) {
  const text = payload.toString('utf8').replace(/[\0\s]+$/u, '');
  if (text.length === 0) {
    return {};
  }
  return JSON.parse(text);
}

/**
 * Is this payload a JPEG image (SOI marker)?
 * @param {Buffer} payload
 */
export function isJpeg(payload) {
  return payload.length > 3 && payload[0] === 0xff && payload[1] === 0xd8 && payload[2] === 0xff;
}

/**
 * Human readable reason of a `Ret` code.
 * @param {number} ret
 */
export function describeRet(ret) {
  return RET_MESSAGES[ret] ?? `error code ${ret}`;
}

/**
 * Decode an IPv4 address as the DVRIP JSON spells it: a little-endian hex
 * word, "0x6401A8C0" -> "192.168.1.100".
 * @param {string} hex
 * @returns {string|null}
 */
export function parseHexIp(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-f]{1,8}$/i.test(hex)) {
    return null;
  }
  const value = Number.parseInt(hex, 16);
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff].join(
    '.',
  );
}

/**
 * The discovery request, broadcast on UDP DISCOVERY_PORT: a bare header.
 */
export function buildDiscoveryRequest() {
  return encodePacket({ messageId: MESSAGES.DISCOVERY });
}

/**
 * Parse a discovery reply into `{ host, port, mac, serial, name }`, or null
 * when the datagram is not one.
 * @param {Buffer} datagram
 * @param {string} [sourceIp] fallback when the reply carries no HostIP
 */
export function parseDiscoveryReply(datagram, sourceIp) {
  try {
    const [packet] = new PacketDecoder().push(datagram);
    if (!packet || packet.messageId !== MESSAGES.DISCOVERY_REPLY) {
      return null;
    }
    const body = parseJsonPayload(packet.payload);
    const net = body['NetWork.NetCommon'];
    if (!net) {
      return null;
    }
    const host = parseHexIp(net.HostIP) ?? sourceIp ?? null;
    if (!host) {
      return null;
    }
    return {
      host,
      port: Number.isInteger(net.TCPPort) ? net.TCPPort : DEFAULT_PORT,
      mac: typeof net.MAC === 'string' ? net.MAC.toLowerCase() : null,
      serial: typeof net.SN === 'string' && net.SN.length > 0 ? net.SN : null,
      name: typeof net.HostName === 'string' ? net.HostName : null,
    };
  } catch {
    return null;
  }
}
