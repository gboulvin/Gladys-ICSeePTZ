// -----------------------------------------------------------------------------
// An in-memory iCSee camera speaking DVRIP, for the tests: no network, the
// client socket is one end of a stream pair, the camera answers on the other.
// -----------------------------------------------------------------------------

import { duplexPair } from 'node:stream';
import {
  MESSAGES,
  PacketDecoder,
  encodePacket,
  parseJsonPayload,
  sofiaHash,
} from '../../src/dvrip/protocol.js';

// A tiny valid JPEG (1x1 pixel).
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
    'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
    'CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
    'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
    'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG' +
    'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
    '5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCwooor8/P3E//Z',
  'base64',
);

/**
 * A JPEG header announcing a given size (enough for jpegSize, never decoded):
 * the fake firmware snapshot of a dual-lens model is 2304x2592.
 */
export function jpegOfSize(width, height) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    sof,
    Buffer.alloc(9),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const SESSION = 0x1a;

/**
 * @param {object} [options]
 * @param {string} [options.password] the password the camera accepts
 * @param {string} [options.serial]
 * @param {string} [options.model]
 * @param {Buffer|null} [options.snapshot] JPEG answered to OPSNAP, null: unsupported
 * @param {boolean} [options.reachable] false: the connection never opens
 * @param {boolean} [options.silent] true: logged in, then never answers
 * @param {number} [options.channels] video channels (2 on the dual-lens models)
 */
export function createFakeCamera({
  password = '',
  serial = 'A1B2C3D4E5F60718',
  model = 'IPC-PTZ-3MP',
  snapshot = TINY_JPEG,
  reachable = true,
  silent = false,
  channels = 1,
} = {}) {
  const camera = {
    requests: [],
    ptz: [],
    connections: 0,
    server: null,
    reachable,
    silent,

    socketFactory() {
      const [client, server] = duplexPair();
      camera.server = server;
      camera.connections += 1;
      const decoder = new PacketDecoder();
      server.on('data', (chunk) => {
        for (const packet of decoder.push(chunk)) {
          handle(server, packet);
        }
      });
      server.on('error', () => {});
      client.on('error', () => {});
      setImmediate(() => {
        if (camera.reachable) {
          client.emit('connect');
        } else {
          client.emit('error', new Error('connect ECONNREFUSED'));
        }
      });
      return client;
    },

    /** Push an alarm event, as the firmware does after ALARM_SUBSCRIBE. */
    sendAlarm(event, status = 'Start') {
      camera.server.write(
        encodePacket({
          messageId: MESSAGES.ALARM_EVENT,
          session: SESSION,
          payload: {
            AlarmInfo: {
              Channel: 0,
              Event: event,
              StartTime: '2026-10-17 10:00:00',
              Status: status,
            },
            Name: 'AlarmInfo',
            SessionID: '0x0000001A',
          },
        }),
      );
    },

    /** The camera closes the connection (reboot, Wi-Fi loss...). */
    drop() {
      const server = camera.server;
      server?.end();
      setImmediate(() => server?.destroy());
    },

    /** Requests received with a given message id. */
    received(messageId) {
      return camera.requests.filter((request) => request.messageId === messageId);
    },
  };

  function reply(server, packet, body) {
    server.write(
      encodePacket({
        messageId: packet.messageId + 1,
        session: SESSION,
        sequence: packet.sequence,
        payload: body,
      }),
    );
  }

  function handle(server, packet) {
    const body = parseJsonPayload(packet.payload);
    camera.requests.push({ messageId: packet.messageId, body });
    if (camera.silent && packet.messageId !== MESSAGES.LOGIN) {
      return;
    }
    switch (packet.messageId) {
      case MESSAGES.LOGIN:
        if (body.PassWord === sofiaHash(password) && body.UserName === 'admin') {
          reply(server, packet, {
            AliveInterval: 20,
            ChannelNum: channels,
            DeviceType: 'IPC',
            Ret: 100,
            SessionID: '0x0000001A',
          });
        } else {
          reply(server, packet, { Ret: 203, SessionID: '0x00000000' });
        }
        break;
      case MESSAGES.SYSTEM_INFO:
        reply(server, packet, {
          Name: 'SystemInfo',
          Ret: 100,
          SessionID: '0x0000001A',
          SystemInfo: {
            SerialNo: serial,
            HardWare: model,
            DeviceModel: model,
            SoftWareVersion: 'V5.00.R02.000529B6.10010.346732.0000000',
          },
        });
        break;
      case MESSAGES.PTZ:
        camera.ptz.push(body.OPPTZControl);
        reply(server, packet, { Name: 'OPPTZControl', Ret: 100, SessionID: '0x0000001A' });
        break;
      case MESSAGES.SNAPSHOT:
        if (snapshot) {
          server.write(
            encodePacket({
              messageId: packet.messageId + 1,
              session: SESSION,
              sequence: packet.sequence,
              payload: snapshot,
            }),
          );
        } else {
          reply(server, packet, { Name: 'OPSNAP', Ret: 607, SessionID: '0x0000001A' });
        }
        break;
      default:
        reply(server, packet, { Name: body.Name ?? '', Ret: 100, SessionID: '0x0000001A' });
    }
  }

  return camera;
}

/** Let the in-memory streams deliver what is pending. */
export async function flush(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Wait until `predicate()` holds (real timers), or fail after `timeoutMs`. */
export async function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
