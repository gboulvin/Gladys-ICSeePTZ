// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults and
// turns the raw form values into what the code uses: the camera list, the
// preset list, numbers that are numbers.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT } from './dvrip/protocol.js';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  // Camera addresses, "192.168.1.50, 192.168.1.51:34567".
  hosts: '',
  // Credentials shared by the cameras (the iCSee app ones: "admin" and the
  // password set at pairing, empty by default).
  username: 'admin',
  password: '',
  // Seconds between two images pushed to Gladys; 0 disables the push (the
  // image is still captured on demand).
  snapshot_interval: 60,
  // Image capture: 'auto' (firmware snapshot, RTSP when unsupported),
  // 'dvrip' or 'rtsp'.
  snapshot_source: 'auto',
  // Longest move, in seconds, after a direction command: a lone command (a
  // scene, a lost "stop") moves this long, never more.
  move_duration: 1,
  // PTZ motor speed, 1 (slow) to 8 (fast).
  ptz_speed: 5,
  // Offer the zoom in / zoom out movements (motorized zoom models only).
  zoom: false,
  // Preset positions saved on the cameras, "1:Entrance, 2:Garden".
  presets: '',
  // Subscribe to the motion / person detection events of the cameras.
  motion_events: true,
  // Dual-lens models stream both lenses stacked in one frame: split it into
  // a fixed-lens device and the PTZ device. 'fixed_top' (detected by the
  // frame shape, fixed lens on top), 'ptz_top', or 'off' (one device).
  dual_lens: 'fixed_top',
};

export const DUAL_LENS_LAYOUTS = ['fixed_top', 'ptz_top', 'off'];

export const SNAPSHOT_SOURCES = ['auto', 'dvrip', 'rtsp'];

// Bounds of the numeric settings (the manifest declares the same min/max).
const BOUNDS = {
  snapshot_interval: { min: 0, max: 3600 },
  move_duration: { min: 0.2, max: 5 },
  ptz_speed: { min: 1, max: 8 },
};

// Gladys polls nothing here, but publishCameraImage allows 12 images a minute:
// one every 5 s at most, per camera.
const MIN_SNAPSHOT_INTERVAL = 5;

const PRESET_MAX = 255;

function toNumber(value, key) {
  const number = Number(value);
  const { min, max } = BOUNDS[key];
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) {
    return DEFAULT_CONFIG[key];
  }
  return Math.min(max, Math.max(min, number));
}

/**
 * Parse the camera list: addresses separated by commas, semicolons, spaces
 * or new lines, each `host` or `host:port`. Duplicates are dropped.
 * @param {string} text
 * @returns {{ cameras: Array<{ host: string, port: number }>, invalid: string[] }}
 */
export function parseHosts(text = '') {
  const cameras = [];
  const invalid = [];
  const seen = new Set();
  for (const entry of String(text)
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean)) {
    const match = /^([a-z0-9][a-z0-9.-]*[a-z0-9]|\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/i.exec(
      entry,
    );
    const port = match?.[2] ? Number(match[2]) : DEFAULT_PORT;
    if (!match || port < 1 || port > 65535) {
      invalid.push(entry);
      continue;
    }
    const host = match[1].toLowerCase();
    const key = `${host}:${port}`;
    if (!seen.has(key)) {
      seen.add(key);
      cameras.push({ host, port });
    }
  }
  return { cameras, invalid };
}

/**
 * Parse the preset list: `slot:label` entries separated by commas,
 * semicolons or new lines ("1:Entrance, 2:Garden"). A bare slot gets the
 * label "Preset <n>". Slots are 1 to 255, unique, sorted.
 * @param {string} text
 * @returns {Array<{ value: number, label: string }>}
 */
export function parsePresets(text = '') {
  const presets = new Map();
  for (const entry of String(text)
    .split(/[,;\n]+/)
    .map((e) => e.trim())
    .filter(Boolean)) {
    const match = /^(\d{1,3})\s*(?:[:=-]\s*(.*))?$/.exec(entry);
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (value < 1 || value > PRESET_MAX || presets.has(value)) {
      continue;
    }
    const label = (match[2] ?? '').trim().slice(0, 50) || `Preset ${value}`;
    presets.set(value, label);
  }
  return [...presets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([value, label]) => ({ value, label }));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const merged = { ...DEFAULT_CONFIG, ...raw };
  const snapshotInterval = toNumber(merged.snapshot_interval, 'snapshot_interval');
  const { cameras, invalid } = parseHosts(merged.hosts);
  return {
    ...merged,
    username: String(merged.username ?? '').trim() || DEFAULT_CONFIG.username,
    password: typeof merged.password === 'string' ? merged.password : DEFAULT_CONFIG.password,
    snapshot_interval:
      snapshotInterval === 0 ? 0 : Math.max(MIN_SNAPSHOT_INTERVAL, Math.round(snapshotInterval)),
    snapshot_source: SNAPSHOT_SOURCES.includes(merged.snapshot_source)
      ? merged.snapshot_source
      : DEFAULT_CONFIG.snapshot_source,
    move_duration: toNumber(merged.move_duration, 'move_duration'),
    ptz_speed: Math.round(toNumber(merged.ptz_speed, 'ptz_speed')),
    motion_events: merged.motion_events !== false && merged.motion_events !== 'false',
    zoom: merged.zoom === true || merged.zoom === 'true',
    dual_lens: DUAL_LENS_LAYOUTS.includes(merged.dual_lens)
      ? merged.dual_lens
      : DEFAULT_CONFIG.dual_lens,
    // Derived values.
    cameras,
    invalidHosts: invalid,
    presetList: parsePresets(merged.presets),
  };
}
