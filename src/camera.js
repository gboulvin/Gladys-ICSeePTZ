// -----------------------------------------------------------------------------
// Camera runtime: one `Camera` per configured address, held by the
// `CameraManager`.
//
// A camera keeps one DVRIP session open (commands, alarm events), reconnects
// with a backoff when it drops, pushes a periodic image when asked to, and
// bounds every movement with a watchdog: a lost "stop" (network drop, browser
// tab closed mid-press, a scene sending a lone direction) must never leave the
// motor running against its mechanical stop (Gladys PTZ spec, safety rule).
//
// Manager events:
//   'online'    (camera)                     session (re)opened
//   'offline'   (camera, error)              session lost
//   'identified'(camera)                     serial learnt, address or lens layout changed
//   'detection' (camera, { kind, active, isNew })
//   'image'     (camera, jpeg, lens)         periodic image captured, per lens
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { DvripClient, DvripError } from './dvrip/client.js';
import { PTZ_COMMANDS } from './dvrip/protocol.js';
import { captureRtspFrame, fitJpeg, isStackedDualLens, jpegSize, spawnFfmpeg } from './image.js';
import { loadKnownCameras, saveKnownCameras } from './store.js';

const logger = createLogger({ name: 'camera' });

// The Gladys CAMERA_MOVE values (PTZ spec A.2) and their DVRIP command.
export const CAMERA_MOVE = {
  STOP: 0,
  PAN_LEFT: 1,
  PAN_RIGHT: 2,
  TILT_UP: 3,
  TILT_DOWN: 4,
  ZOOM_IN: 5,
  ZOOM_OUT: 6,
};

export const MOVE_COMMANDS = {
  [CAMERA_MOVE.PAN_LEFT]: PTZ_COMMANDS.LEFT,
  [CAMERA_MOVE.PAN_RIGHT]: PTZ_COMMANDS.RIGHT,
  [CAMERA_MOVE.TILT_UP]: PTZ_COMMANDS.UP,
  [CAMERA_MOVE.TILT_DOWN]: PTZ_COMMANDS.DOWN,
  [CAMERA_MOVE.ZOOM_IN]: PTZ_COMMANDS.ZOOM_IN,
  [CAMERA_MOVE.ZOOM_OUT]: PTZ_COMMANDS.ZOOM_OUT,
};

// Directions by name: scene action and widget button values.
export const DIRECTIONS = {
  left: CAMERA_MOVE.PAN_LEFT,
  right: CAMERA_MOVE.PAN_RIGHT,
  up: CAMERA_MOVE.TILT_UP,
  down: CAMERA_MOVE.TILT_DOWN,
  zoom_in: CAMERA_MOVE.ZOOM_IN,
  zoom_out: CAMERA_MOVE.ZOOM_OUT,
};

// The lenses of a camera. Every camera has the main one (the whole frame, or
// the PTZ half of a dual-lens frame); the dual-lens models add the fixed one.
export const LENSES = { MAIN: 'main', FIXED: 'fixed' };

// Hard ceiling of any move, whatever asks for it (PTZ spec: ~5 s).
export const MAX_MOVE_SECONDS = 5;

// Reconnection backoff.
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60_000;

// Some firmwares send the "Start" of an alarm and never its "Stop": a
// detection clears on its own after this delay without a new "Start".
export const DETECTION_CLEAR_MS = 30_000;

/**
 * What an alarm event reports: 'person', 'motion', or null for the alarms the
 * integration does not handle (video loss, blind, disk...).
 * @param {string} event e.g. "VideoMotion", "HumanDetect", "appEventHumanDetectAlarm"
 */
export function detectionKind(event) {
  const name = String(event).toLowerCase();
  if (/human|person|people|body|face/.test(name)) {
    return 'person';
  }
  if (/motion/.test(name)) {
    return 'motion';
  }
  return null;
}

/**
 * Stable platform id of a camera: its serial number, lowercased, restricted to
 * the characters an external id carries well.
 * @param {string} serial
 */
export function platformIdOf(serial) {
  return String(serial)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export class Camera extends EventEmitter {
  /**
   * @param {object} address { host, port }
   * @param {object} config normalized config
   * @param {object} [deps]
   * @param {Function} [deps.clientFactory] (options) => DvripClient
   * @param {Function} [deps.runFfmpeg]
   */
  constructor({ host, port }, config, deps = {}) {
    super();
    this.host = host;
    this.port = port;
    this.config = config;
    this.clientFactory = deps.clientFactory ?? ((options) => new DvripClient(options));
    this.runFfmpeg = deps.runFfmpeg ?? spawnFfmpeg;
    this.client = null;
    this.online = false;
    this.lastError = null;
    this.info = null; // { serial, model, firmware, hardware }
    this.known = null; // identity remembered in /data
    this.lastImages = {}; // by lens: { jpeg, hash, at }
    this.dualDetected = null; // null until the first frame tells
    this.detection = { active: false, kind: null, at: null };
    this.detectionTimer = null;
    this.activeMove = null; // { command, timer, done }
    this.snapshotTimer = null;
    this.reconnectTimer = null;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.stopped = true;
    this.snapshotUnsupported = false;
    this.capturing = null;
  }

  get key() {
    return `${this.host}:${this.port}`;
  }

  /** Serial number, live or remembered: null until the camera was seen once. */
  get serial() {
    return this.info?.serial ?? this.known?.serial ?? null;
  }

  get model() {
    return this.info?.model ?? this.known?.model ?? null;
  }

  get platformId() {
    return this.serial ? platformIdOf(this.serial) : null;
  }

  /** Is the frame split into a fixed lens and a PTZ lens? */
  get dual() {
    if (this.config.dual_lens === 'off') {
      return false;
    }
    return this.dualDetected ?? this.known?.dual === true;
  }

  /** The lenses published to Gladys. */
  get lenses() {
    return this.dual ? [LENSES.MAIN, LENSES.FIXED] : [LENSES.MAIN];
  }

  /** Latest image of the main lens. */
  get lastImage() {
    return this.lastImages[LENSES.MAIN] ?? null;
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.connect();
  }

  async connect() {
    if (this.stopped) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.clientFactory({
      host: this.host,
      port: this.port,
      username: this.config.username,
      password: this.config.password,
    });
    this.client = client;
    client.on('alarm', (alarm) => this.onAlarm(alarm));
    client.once('close', (reason) => this.onClose(client, reason));
    try {
      await client.connect();
      const info = await client.getSystemInfo();
      if (client !== this.client) {
        return;
      }
      this.info = {
        serial: info.SerialNo ? String(info.SerialNo) : null,
        model: info.DeviceModel ?? info.HardWare ?? null,
        hardware: info.HardWare ?? null,
        firmware: info.SoftWareVersion ?? null,
      };
      if (!this.info.serial) {
        throw new Error('The camera did not give its serial number');
      }
      if (this.config.motion_events) {
        await client.subscribeAlarms().catch((err) => {
          logger.warn(`${this.host}: no alarm events (${err.message})`);
        });
      }
      this.online = true;
      this.lastError = null;
      this.reconnectDelay = RECONNECT_MIN_MS;
      logger.info(`${this.host}: connected (${this.info.model ?? 'unknown model'})`);
      this.emit('online');
      this.startSnapshotLoop();
    } catch (err) {
      if (client === this.client) {
        this.lastError = err.message;
        logger.warn(`${this.host}: connection failed (${err.message})`);
        client.close(err);
      }
    }
  }

  onClose(client, reason) {
    if (client !== this.client) {
      return;
    }
    this.client = null;
    this.abandonMove();
    this.stopSnapshotLoop();
    const wasOnline = this.online;
    this.online = false;
    if (reason?.message && !this.lastError) {
      this.lastError = reason.message;
    }
    if (wasOnline) {
      logger.warn(`${this.host}: disconnected (${reason?.message ?? 'closed'})`);
      this.emit('offline', reason);
    }
    if (!this.stopped) {
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
      this.reconnectTimer.unref?.();
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopSnapshotLoop();
    clearTimeout(this.detectionTimer);
    if (this.activeMove) {
      // Best effort: try to stop the motor before closing the session.
      const { command } = this.activeMove;
      this.abandonMove();
      this.client?.stopMove(command, { speed: this.config.ptz_speed }).catch(() => {});
    }
    const client = this.client;
    this.client = null;
    if (client) {
      client.close();
    }
    if (this.online) {
      this.online = false;
      this.emit('offline');
    }
  }

  requireClient() {
    if (!this.online || !this.client) {
      throw new Error(`${this.host} is offline`);
    }
    return this.client;
  }

  // --- Movements ------------------------------------------------------------

  /**
   * Start moving; stops by itself after `seconds` (capped at MAX_MOVE_SECONDS)
   * unless `stopMove` comes first. Resolves once the move has started; the
   * returned `done` promise resolves when it has stopped.
   * @param {number} move a CAMERA_MOVE value (1-6)
   * @param {number} [seconds] defaults to the configured move duration
   * @returns {Promise<{ done: Promise<void> }>}
   */
  async move(move, seconds = this.config.move_duration) {
    if (move === CAMERA_MOVE.STOP) {
      await this.stopMove();
      return { done: Promise.resolve() };
    }
    const command = MOVE_COMMANDS[move];
    if (!command) {
      throw new Error(`Unsupported movement ${move}`);
    }
    const client = this.requireClient();
    // A new direction while moving switches direction: stop the previous one.
    await this.stopMove();
    const duration = Math.min(Math.max(Number(seconds) || 0, 0.1), MAX_MOVE_SECONDS) * 1000;
    let resolveDone;
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    // Arm the watchdog BEFORE sending the start: even a start whose answer is
    // lost gets its stop.
    const activeMove = { command, done: resolveDone, timer: null };
    activeMove.timer = setTimeout(() => {
      this.stopMove(activeMove).catch((err) => {
        logger.error(`${this.host}: watchdog stop failed`, err);
      });
    }, duration);
    this.activeMove = activeMove;
    try {
      await client.startMove(command, { speed: this.config.ptz_speed });
    } catch (err) {
      await this.stopMove(activeMove).catch(() => {});
      throw err;
    }
    return { done };
  }

  /**
   * Stop the ongoing movement (all of them: one at a time). No-op when idle.
   * @param {object} [only] stop this move only (the watchdog of an old move
   *   must not stop a newer one)
   */
  async stopMove(only) {
    const current = this.activeMove;
    if (!current || (only && current !== only)) {
      return;
    }
    this.activeMove = null;
    clearTimeout(current.timer);
    try {
      if (this.client) {
        await this.client.stopMove(current.command, { speed: this.config.ptz_speed });
      }
    } finally {
      current.done();
    }
  }

  // The session is gone: nothing to send the stop on (the firmware stops the
  // motor itself when its session drops).
  abandonMove() {
    if (this.activeMove) {
      clearTimeout(this.activeMove.timer);
      this.activeMove.done();
      this.activeMove = null;
    }
  }

  /**
   * Move for a given time, then stop: resolves once stopped.
   * @param {number} move
   * @param {number} seconds
   */
  async moveFor(move, seconds) {
    const { done } = await this.move(move, seconds);
    await done;
  }

  async gotoPreset(slot) {
    await this.stopMove();
    await this.requireClient().ptz(PTZ_COMMANDS.GOTO_PRESET, {
      preset: slot,
      speed: this.config.ptz_speed,
    });
  }

  async savePreset(slot) {
    await this.stopMove();
    await this.requireClient().ptz(PTZ_COMMANDS.SET_PRESET, {
      preset: slot,
      speed: this.config.ptz_speed,
    });
  }

  async reboot() {
    await this.requireClient().reboot();
  }

  // --- Images ---------------------------------------------------------------

  /**
   * Capture a JPEG of one lens that fits the Gladys camera image limit.
   * Concurrent calls share the same capture: one frame from the camera feeds
   * both lenses of a dual-lens model.
   * @param {string} [lens] one of LENSES
   * @returns {Promise<Buffer>}
   */
  async captureJpeg(lens = LENSES.MAIN) {
    const images = await this.captureAll();
    if (!images[lens]) {
      throw new Error(`${this.host} has no ${lens} lens`);
    }
    return images[lens];
  }

  /**
   * Capture every lens from one frame.
   * @returns {Promise<Record<string, Buffer>>} by lens
   */
  captureAll() {
    if (!this.capturing) {
      this.capturing = this.doCapture().finally(() => {
        this.capturing = null;
      });
    }
    return this.capturing;
  }

  async doCapture() {
    const frame = await this.captureFrame();
    const stacked = isStackedDualLens(jpegSize(frame));
    if (this.config.dual_lens !== 'off' && stacked !== this.dualDetected) {
      const changed = stacked !== this.dual;
      this.dualDetected = stacked;
      if (changed) {
        logger.info(`${this.host}: ${stacked ? 'dual-lens frame, split in two' : 'single lens'}`);
        this.emit('layout');
      }
    }
    const crops = {};
    if (this.dual) {
      const ptzOnTop = this.config.dual_lens === 'ptz_top';
      crops[LENSES.MAIN] = ptzOnTop ? 'top' : 'bottom';
      crops[LENSES.FIXED] = ptzOnTop ? 'bottom' : 'top';
    } else {
      crops[LENSES.MAIN] = undefined;
    }
    const images = {};
    for (const [lens, crop] of Object.entries(crops)) {
      const jpeg = await fitJpeg(frame, { crop, runFfmpeg: this.runFfmpeg });
      images[lens] = jpeg;
      this.lastImages[lens] = {
        jpeg,
        hash: createHash('sha1').update(jpeg).digest('hex').slice(0, 10),
        at: new Date(),
      };
    }
    return images;
  }

  // One raw frame: firmware snapshot, or the RTSP stream.
  async captureFrame() {
    const source = this.config.snapshot_source;
    if (source === 'rtsp' || (source === 'auto' && this.snapshotUnsupported)) {
      return this.captureRtsp();
    }
    try {
      return await this.requireClient().snapshot();
    } catch (err) {
      if (source !== 'auto' || !(err instanceof DvripError)) {
        throw err;
      }
      // The firmware has no snapshot command: RTSP from now on.
      logger.info(`${this.host}: ${err.message}, using the RTSP stream`);
      this.snapshotUnsupported = true;
      return this.captureRtsp();
    }
  }

  captureRtsp() {
    return captureRtspFrame(
      { host: this.host, username: this.config.username, password: this.config.password },
      { runFfmpeg: this.runFfmpeg },
    );
  }

  startSnapshotLoop() {
    this.stopSnapshotLoop();
    const seconds = this.config.snapshot_interval;
    if (!seconds) {
      return;
    }
    const tick = async () => {
      try {
        const images = await this.captureAll();
        for (const [lens, jpeg] of Object.entries(images)) {
          this.emit('image', jpeg, lens);
        }
      } catch (err) {
        logger.warn(`${this.host}: image capture failed (${err.message})`);
      }
    };
    // A first image right away, so a new camera does not stay blank.
    tick();
    this.snapshotTimer = setInterval(tick, seconds * 1000);
    this.snapshotTimer.unref?.();
  }

  stopSnapshotLoop() {
    clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
  }

  // --- Detections -----------------------------------------------------------

  onAlarm({ event, status }) {
    const kind = detectionKind(event);
    if (!kind) {
      logger.debug(`${this.host}: alarm ${event} ${status} ignored`);
      return;
    }
    if (String(status).toLowerCase() === 'stop') {
      this.clearDetection();
      return;
    }
    // A person outranks a motion within the same detection.
    const isNew = !this.detection.active || (kind === 'person' && this.detection.kind !== 'person');
    this.detection = { active: true, kind, at: new Date() };
    clearTimeout(this.detectionTimer);
    this.detectionTimer = setTimeout(() => this.clearDetection(), DETECTION_CLEAR_MS);
    this.detectionTimer.unref?.();
    this.emit('detection', { kind, active: true, isNew });
  }

  clearDetection() {
    clearTimeout(this.detectionTimer);
    this.detectionTimer = null;
    if (!this.detection.active) {
      return;
    }
    this.detection = { ...this.detection, active: false };
    this.emit('detection', { kind: this.detection.kind, active: false, isNew: false });
  }
}

// Settings whose change needs a new session.
const SESSION_KEYS = ['username', 'password', 'motion_events'];

export class CameraManager extends EventEmitter {
  /**
   * @param {object} [deps] passed to every Camera (tests inject fakes)
   * @param {Function} [deps.loadKnown]
   * @param {Function} [deps.saveKnown]
   */
  constructor(deps = {}) {
    super();
    this.deps = deps;
    this.loadKnown = deps.loadKnown ?? loadKnownCameras;
    this.saveKnown = deps.saveKnown ?? saveKnownCameras;
    this.cameras = new Map();
    this.known = null;
    this.config = null;
  }

  /**
   * Start, update or stop the cameras to match the config.
   * @param {object} config normalized config
   */
  async apply(config) {
    this.known ??= await this.loadKnown();
    const previous = this.config;
    this.config = config;
    const wanted = new Map(
      config.cameras.map((address) => [`${address.host}:${address.port}`, address]),
    );
    for (const [key, camera] of this.cameras) {
      if (!wanted.has(key)) {
        camera.stop();
        camera.removeAllListeners();
        this.cameras.delete(key);
      }
    }
    const sessionChanged =
      previous !== null && SESSION_KEYS.some((key) => previous[key] !== config[key]);
    for (const [key, address] of wanted) {
      let camera = this.cameras.get(key);
      if (camera) {
        camera.config = config;
        if (sessionChanged) {
          camera.stop();
          camera.start();
        } else if (camera.online) {
          camera.startSnapshotLoop();
        }
        continue;
      }
      camera = new Camera(address, config, this.deps);
      camera.known = this.known[key] ?? null;
      this.wire(camera);
      this.cameras.set(key, camera);
      camera.start();
    }
  }

  wire(camera) {
    camera.on('online', () => {
      this.remember(camera);
      this.emit('online', camera);
    });
    camera.on('offline', (reason) => this.emit('offline', camera, reason));
    camera.on('detection', (detection) => this.emit('detection', camera, detection));
    camera.on('image', (jpeg, lens) => this.emit('image', camera, jpeg, lens));
    // A dual-lens frame (or its end) adds or removes the fixed-lens device.
    camera.on('layout', () => this.remember(camera));
  }

  remember(camera) {
    if (!camera.serial) {
      return;
    }
    const previous = this.known[camera.key];
    const dual = camera.dualDetected ?? previous?.dual === true;
    const entry = { serial: camera.serial, model: camera.model ?? undefined };
    if (dual) {
      entry.dual = true;
    }
    if (
      previous?.serial === entry.serial &&
      previous?.model === entry.model &&
      (previous?.dual === true) === dual
    ) {
      return;
    }
    // The same camera at a new address (DHCP): forget the old one.
    for (const [key, value] of Object.entries(this.known)) {
      if (key !== camera.key && value.serial === entry.serial) {
        delete this.known[key];
      }
    }
    this.known[camera.key] = entry;
    camera.known = entry;
    this.saveKnown(this.known);
    this.emit('identified', camera);
  }

  /** Cameras with a known identity (the ones published to Gladys). */
  identified() {
    // Two addresses can briefly claim the same serial (address changed
    // while the old one is still configured): publish the live one.
    const bySerial = new Map();
    for (const camera of this.cameras.values()) {
      if (!camera.platformId) {
        continue;
      }
      const other = bySerial.get(camera.platformId);
      if (!other || (camera.online && !other.online)) {
        bySerial.set(camera.platformId, camera);
      }
    }
    return [...bySerial.values()];
  }

  all() {
    return [...this.cameras.values()];
  }

  findByPlatformId(platformId) {
    return this.identified().find((camera) => camera.platformId === platformId) ?? null;
  }

  stop() {
    for (const camera of this.cameras.values()) {
      camera.stop();
      camera.removeAllListeners();
    }
    this.cameras.clear();
  }
}
