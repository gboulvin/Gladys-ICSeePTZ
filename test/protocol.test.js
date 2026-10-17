import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADER_LENGTH,
  MESSAGES,
  PacketDecoder,
  buildDiscoveryRequest,
  decodeHeader,
  encodePacket,
  formatSession,
  isJpeg,
  parseDiscoveryReply,
  parseHexIp,
  parseJsonPayload,
  sofiaHash,
} from '../src/dvrip/protocol.js';
import { TINY_JPEG } from './helpers/fakeCamera.js';

test('sofiaHash matches the known hashes of the DVRIP login', () => {
  // The empty password, the factory default of most cameras.
  assert.equal(sofiaHash(''), 'tlJwpbo6');
  assert.equal(sofiaHash('admin').length, 8);
  assert.match(sofiaHash('a password'), /^[0-9A-Za-z]{8}$/);
});

test('encodePacket writes the 20-byte little-endian header and the terminated JSON', () => {
  const packet = encodePacket({
    messageId: MESSAGES.LOGIN,
    session: 0x1a,
    sequence: 3,
    payload: { A: 1 },
  });
  assert.equal(packet[0], 0xff);
  assert.equal(packet.readUInt32LE(4), 0x1a);
  assert.equal(packet.readUInt32LE(8), 3);
  assert.equal(packet.readUInt16LE(14), 1000);
  const body = packet.subarray(HEADER_LENGTH);
  assert.equal(packet.readUInt32LE(16), body.length);
  assert.equal(body.toString('utf8'), '{"A":1}\n\0');
});

test('decodeHeader refuses a stream that lost its framing', () => {
  assert.throws(() => decodeHeader(Buffer.alloc(HEADER_LENGTH)), /invalid packet head/);
});

test('PacketDecoder reassembles packets split and merged across chunks', () => {
  const first = encodePacket({ messageId: 1001, payload: { Ret: 100 } });
  const second = encodePacket({ messageId: 1561, payload: TINY_JPEG });
  const stream = Buffer.concat([first, second]);
  const decoder = new PacketDecoder();
  assert.deepEqual(decoder.push(stream.subarray(0, 7)), []);
  const packets = [
    ...decoder.push(stream.subarray(7, first.length + 5)),
    ...decoder.push(stream.subarray(first.length + 5)),
  ];
  assert.equal(packets.length, 2);
  assert.equal(packets[0].messageId, 1001);
  assert.deepEqual(parseJsonPayload(packets[0].payload), { Ret: 100 });
  assert.equal(packets[1].messageId, 1561);
  assert.ok(isJpeg(packets[1].payload));
});

test('formatSession and parseHexIp speak the JSON spelling', () => {
  assert.equal(formatSession(0x1a), '0x0000001A');
  assert.equal(parseHexIp('0x6401A8C0'), '192.168.1.100');
  assert.equal(parseHexIp('nope'), null);
});

test('the discovery request is a bare header, and the reply gives the address', () => {
  const request = buildDiscoveryRequest();
  assert.equal(request.length, HEADER_LENGTH);
  assert.equal(request.readUInt16LE(14), MESSAGES.DISCOVERY);

  const reply = encodePacket({
    messageId: MESSAGES.DISCOVERY_REPLY,
    payload: {
      'NetWork.NetCommon': {
        HostIP: '0x3201A8C0',
        HostName: 'IPC',
        MAC: '00:12:31:AB:CD:EF',
        SN: 'A1B2C3D4E5F60718',
        TCPPort: 34567,
      },
      Ret: 100,
    },
  });
  assert.deepEqual(parseDiscoveryReply(reply, '192.168.1.50'), {
    host: '192.168.1.50',
    port: 34567,
    mac: '00:12:31:ab:cd:ef',
    serial: 'A1B2C3D4E5F60718',
    name: 'IPC',
  });
  assert.equal(parseDiscoveryReply(Buffer.from('garbage')), null);
  assert.equal(parseDiscoveryReply(encodePacket({ messageId: 1001, payload: { Ret: 100 } })), null);
});
