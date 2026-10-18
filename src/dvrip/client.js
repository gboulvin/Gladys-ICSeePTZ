// -----------------------------------------------------------------------------
// DVRIP client: one authenticated TCP session with one camera.
//
// The firmware answers requests in order and has no request id we could match
// answers on, so requests are serialized: one in flight at a time. The only
// unsolicited packets are the alarm events (motion, person...), told apart by
// their message id and emitted as 'alarm'.
//
// A request that times out leaves the stream in an unknown state: the session
// is closed rather than risk reading the next answer as this one. The camera
// manager (src/camera.js) reconnects.
//
// Events:
//   'alarm' ({ channel, event, status, startTime }) a camera alarm
//   'close' (Error|undefined)                       the session ended
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';
import {
  DEFAULT_PORT,
  MESSAGES,
  PTZ_START,
  PTZ_STOP,
  PacketDecoder,
  RET_OK,
  describeRet,
  encodePacket,
  formatSession,
  isJpeg,
  parseJsonPayload,
  sofiaHash,
} from './protocol.js';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_ALIVE_INTERVAL_S = 20;

export class DvripError extends Error {
  constructor(message, ret) {
    super(message);
    this.name = 'DvripError';
    this.ret = ret;
  }
}

function defaultSocketFactory({ host, port }) {
  const socket = net.connect({ host, port });
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30_000);
  return socket;
}

export class DvripClient extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} [options.port]
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {number} [options.timeoutMs] answer timeout of every request
   * @param {Function} [options.socketFactory] ({ host, port }) => Duplex that
   *   emits 'connect' (tests inject an in-memory camera here)
   */
  constructor({
    host,
    port = DEFAULT_PORT,
    username = 'admin',
    password = '',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    socketFactory = defaultSocketFactory,
  }) {
    super();
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.socketFactory = socketFactory;
    this.socket = null;
    this.session = 0;
    // Video channels of the device, from the login answer: 2 on the
    // dual-lens models (a fixed lens and a PTZ one).
    this.channels = 1;
    this.sequence = 0;
    this.pending = null;
    this.queue = Promise.resolve();
    this.keepAliveTimer = null;
    this.closed = false;
  }

  get connected() {
    return this.socket !== null && !this.closed;
  }

  /**
   * Open the TCP session and log in.
   * @returns {Promise<{ aliveInterval: number, channels: number }>}
   */
  async connect() {
    await this.openSocket();
    let answer;
    try {
      answer = await this.request(MESSAGES.LOGIN, {
        EncryptType: 'MD5',
        LoginType: 'DVRIP-Web',
        PassWord: sofiaHash(this.password),
        UserName: this.username,
      });
    } catch (err) {
      this.close(err);
      throw err;
    }
    const { body, session } = answer;
    if (!RET_OK.has(body.Ret)) {
      const error = new DvripError(`Login refused: ${describeRet(body.Ret)}`, body.Ret);
      this.close(error);
      throw error;
    }
    const fromBody = Number.parseInt(body.SessionID, 16);
    this.session = Number.isNaN(fromBody) ? session : fromBody;
    const aliveInterval = Number(body.AliveInterval) > 0 ? Number(body.AliveInterval) : 0;
    this.channels = Number.isInteger(body.ChannelNum) && body.ChannelNum > 0 ? body.ChannelNum : 1;
    this.startKeepAlive(aliveInterval || DEFAULT_ALIVE_INTERVAL_S);
    return { aliveInterval: aliveInterval || DEFAULT_ALIVE_INTERVAL_S, channels: this.channels };
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      const decoder = new PacketDecoder();
      const socket = this.socketFactory({ host: this.host, port: this.port });
      this.socket = socket;
      this.closed = false;
      const timer = setTimeout(() => {
        fail(new Error(`Connection to ${this.host}:${this.port} timed out`));
      }, this.timeoutMs);
      const fail = (err) => {
        clearTimeout(timer);
        reject(err);
        this.close(err);
      };
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.off('error', fail);
        socket.on('error', (err) => this.close(err));
        resolve();
      });
      socket.once('error', fail);
      socket.on('data', (chunk) => {
        let packets;
        try {
          packets = decoder.push(chunk);
        } catch (err) {
          this.close(err);
          return;
        }
        for (const packet of packets) {
          this.onPacket(packet);
        }
      });
      // 'end': the camera closed its side (a TCP FIN), the session is over.
      socket.on('end', () => this.close(new Error('Connection closed by the camera')));
      socket.on('close', () => this.close(new Error('Connection closed by the camera')));
    });
  }

  onPacket(packet) {
    if (packet.messageId === MESSAGES.ALARM_EVENT) {
      this.onAlarm(packet);
      return;
    }
    const pending = this.pending;
    if (!pending) {
      // An answer nobody waits for (the request timed out): ignore it.
      return;
    }
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(packet);
  }

  onAlarm(packet) {
    let info;
    try {
      const body = parseJsonPayload(packet.payload);
      info = body.AlarmInfo ?? body[body.Name];
    } catch {
      return;
    }
    if (!info || typeof info !== 'object') {
      return;
    }
    this.emit('alarm', {
      channel: Number(info.Channel) || 0,
      event: String(info.Event ?? ''),
      status: String(info.Status ?? 'Start'),
      startTime: info.StartTime ?? null,
    });
  }

  /**
   * Send a request and wait for its answer. Requests are serialized.
   * @param {number} messageId
   * @param {object} payload
   * @param {object} [options]
   * @param {boolean} [options.raw] resolve the raw payload instead of JSON
   * @param {number} [options.timeoutMs]
   * @returns {Promise<{ body: object, payload: Buffer, session: number, messageId: number }>}
   */
  request(messageId, payload, { raw = false, timeoutMs = this.timeoutMs } = {}) {
    const run = () =>
      new Promise((resolve, reject) => {
        if (!this.connected) {
          reject(new Error('Not connected to the camera'));
          return;
        }
        const timer = setTimeout(() => {
          this.pending = null;
          const error = new Error(`The camera did not answer request ${messageId} in time`);
          reject(error);
          this.close(error);
        }, timeoutMs);
        this.pending = {
          timer,
          reject,
          resolve: (packet) => {
            try {
              resolve({
                body: raw ? {} : parseJsonPayload(packet.payload),
                payload: packet.payload,
                session: packet.session,
                messageId: packet.messageId,
              });
            } catch (err) {
              reject(new Error(`Unreadable answer to request ${messageId}: ${err.message}`));
            }
          },
        };
        this.sequence += 1;
        this.socket.write(
          encodePacket({ messageId, session: this.session, sequence: this.sequence, payload }),
        );
      });
    const result = this.queue.then(run, run);
    // The queue only orders requests: a failure must not poison the next one.
    this.queue = result.catch(() => {});
    return result;
  }

  /**
   * Named command: `{ Name, SessionID, [Name]: params }`, answer checked.
   * @param {number} messageId
   * @param {string} name
   * @param {object} [params]
   */
  async command(messageId, name, params) {
    const payload = { Name: name, SessionID: formatSession(this.session) };
    if (params !== undefined) {
      payload[name] = params;
    }
    const { body } = await this.request(messageId, payload);
    if (body.Ret !== undefined && !RET_OK.has(body.Ret)) {
      throw new DvripError(`${name} refused: ${describeRet(body.Ret)}`, body.Ret);
    }
    return body;
  }

  /**
   * Hardware and firmware description. `SerialNo` is the stable identity of
   * the camera.
   */
  async getSystemInfo() {
    const body = await this.command(MESSAGES.SYSTEM_INFO, 'SystemInfo');
    return body.SystemInfo ?? {};
  }

  /**
   * One OPPTZControl command.
   * @param {string} command one of PTZ_COMMANDS
   * @param {object} [options]
   * @param {number} [options.preset] PTZ_START / PTZ_STOP for a direction,
   *   the preset slot for the preset commands
   * @param {number} [options.speed] 1 (slow) to 8 (fast)
   * @param {number} [options.channel]
   */
  ptz(command, { preset = PTZ_START, speed = 5, channel = 0 } = {}) {
    return this.command(MESSAGES.PTZ, 'OPPTZControl', {
      Command: command,
      Parameter: {
        AUX: { Number: 0, Status: 'On' },
        Channel: channel,
        MenuOpts: 'Enter',
        POINT: { bottom: 0, left: 0, right: 0, top: 0 },
        Pattern: 'SetBegin',
        Preset: preset,
        Step: speed,
        Tour: 0,
      },
    });
  }

  startMove(command, options = {}) {
    return this.ptz(command, { ...options, preset: PTZ_START });
  }

  stopMove(command, options = {}) {
    return this.ptz(command, { ...options, preset: PTZ_STOP });
  }

  /**
   * Capture a JPEG through the firmware (OPSNAP). Not every firmware
   * implements it: a DvripError is thrown then, and the caller falls back to
   * the RTSP stream.
   * @returns {Promise<Buffer>}
   */
  async snapshot(channel = 0) {
    const { payload } = await this.request(
      MESSAGES.SNAPSHOT,
      { Name: 'OPSNAP', SessionID: formatSession(this.session), OPSNAP: { Channel: channel } },
      { raw: true },
    );
    if (isJpeg(payload)) {
      return payload;
    }
    let ret;
    try {
      ret = parseJsonPayload(payload).Ret;
    } catch {
      ret = undefined;
    }
    throw new DvripError(
      `Snapshot not supported by this firmware${ret ? ` (${describeRet(ret)})` : ''}`,
      ret,
    );
  }

  /** Ask the camera to push its alarm events on this session. */
  async subscribeAlarms() {
    const { body } = await this.request(MESSAGES.ALARM_SUBSCRIBE, {
      Name: '',
      SessionID: formatSession(this.session),
    });
    if (body.Ret !== undefined && !RET_OK.has(body.Ret)) {
      throw new DvripError(`Alarm subscription refused: ${describeRet(body.Ret)}`, body.Ret);
    }
  }

  /** Reboot the camera: the session ends with it. */
  reboot() {
    return this.command(MESSAGES.SYSTEM_MANAGER, 'OPMachine', { Action: 'Reboot' });
  }

  startKeepAlive(intervalSeconds) {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      this.request(MESSAGES.KEEPALIVE, {
        Name: 'KeepAlive',
        SessionID: formatSession(this.session),
      }).catch((err) => this.close(err));
    }, intervalSeconds * 1000);
    this.keepAliveTimer.unref?.();
  }

  stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * End the session. Idempotent; 'close' is emitted once.
   * @param {Error} [reason]
   */
  close(reason) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stopKeepAlive();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(reason ?? new Error('Connection closed'));
      this.pending = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners('data');
      this.socket.on('error', () => {});
      this.socket.destroy();
    }
    this.emit('close', reason);
  }
}
