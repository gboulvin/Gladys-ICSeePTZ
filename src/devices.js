// -----------------------------------------------------------------------------
// Gladys devices: one device per identified camera, two for a dual-lens
// model (see LENSES in src/camera.js).
//
// Features (Gladys PTZ spec, docs/specs/camera-ptz-control.md of the core):
//   - camera/image   the image channel (publishCameraImage / onGetImage);
//   - camera/move    one command for every movement, CAMERA_MOVE values, the
//                    supported subset in `supported_options`;
//   - camera/preset  recall a saved position, the labeled slots in
//                    `supported_options` (only when presets are configured);
//   - motion-sensor  the detections of the camera (when events are enabled).
//
// A dual-lens model streams its two lenses stacked in one frame. The main
// device keeps the id of the camera and becomes the PTZ lens (move, presets,
// motion: existing scenes keep working); the fixed lens is a second device,
// `<serial>-fixed`, carrying only its image.
//
// External ids derive from the camera serial number: they survive restarts,
// address changes and re-installs. Feature keys are forever too.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_TRANSPORTS,
} from '@gladysassistant/integration-sdk';
import { CAMERA_MOVE, LENSES } from './camera.js';

export const DEVICE_TYPE = 'camera';

export const FEATURES = {
  IMAGE: 'image',
  MOVE: 'move',
  PRESET: 'preset',
  MOTION: 'motion',
};

// Labels of the movement options: the Gladys UI renders arrows from the
// values, the labels only show in the scene editor.
const MOVE_OPTIONS = [
  { value: CAMERA_MOVE.PAN_LEFT, label: 'Pan left' },
  { value: CAMERA_MOVE.PAN_RIGHT, label: 'Pan right' },
  { value: CAMERA_MOVE.TILT_UP, label: 'Tilt up' },
  { value: CAMERA_MOVE.TILT_DOWN, label: 'Tilt down' },
];
const ZOOM_OPTIONS = [
  { value: CAMERA_MOVE.ZOOM_IN, label: 'Zoom in' },
  { value: CAMERA_MOVE.ZOOM_OUT, label: 'Zoom out' },
];

// Suffix of the platform id of the fixed-lens device.
const FIXED_SUFFIX = `-${LENSES.FIXED}`;

/**
 * External ids of the device of one lens of a camera.
 * @param {object} gladys
 * @param {object} camera
 * @param {string} [lens] one of LENSES
 */
export function idsOf(gladys, camera, lens = LENSES.MAIN) {
  const suffix = lens === LENSES.FIXED ? FIXED_SUFFIX : '';
  return gladys.externalIds(DEVICE_TYPE, `${camera.platformId}${suffix}`);
}

/**
 * Platform id (serial) of one of our device external ids, or null.
 * @param {object} gladys
 * @param {string} externalId
 */
export function platformIdFromExternalId(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

/**
 * The camera a device (or a device external id) designates, or null.
 * @param {object} gladys
 * @param {object} manager CameraManager
 * @param {object|string} device device or external id
 */
export function findCamera(gladys, manager, device) {
  return resolveDevice(gladys, manager, device)?.camera ?? null;
}

/**
 * The camera AND the lens a device designates, or null.
 * @returns {{ camera: object, lens: string }|null}
 */
export function resolveDevice(gladys, manager, device) {
  const externalId = typeof device === 'string' ? device : device?.external_id;
  const platformId = platformIdFromExternalId(gladys, externalId);
  if (!platformId) {
    return null;
  }
  const fixed = platformId.endsWith(FIXED_SUFFIX);
  const camera = manager.findByPlatformId(
    fixed ? platformId.slice(0, -FIXED_SUFFIX.length) : platformId,
  );
  if (!camera || (fixed && !camera.dual)) {
    return null;
  }
  return { camera, lens: fixed ? LENSES.FIXED : LENSES.MAIN };
}

function withOrder(options) {
  return options.map((option, index) => ({ ...option, sort_order: index }));
}

/**
 * Discovery payload of one camera.
 * @param {object} gladys
 * @param {object} camera Camera (identified)
 * @param {object} config normalized config
 */
export function buildDevice(gladys, camera, config) {
  const ids = idsOf(gladys, camera);
  const model = camera.model ? ` ${camera.model}` : '';
  const features = [
    {
      name: 'Image',
      external_id: ids.feature(FEATURES.IMAGE),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
      read_only: true,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 0,
    },
    {
      name: 'PTZ',
      external_id: ids.feature(FEATURES.MOVE),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.MOVE,
      read_only: false,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 6,
      supported_options: withOrder(config.zoom ? [...MOVE_OPTIONS, ...ZOOM_OPTIONS] : MOVE_OPTIONS),
    },
  ];
  if (config.presetList.length > 0) {
    features.push({
      name: 'Presets',
      external_id: ids.feature(FEATURES.PRESET),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.PRESET,
      read_only: false,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: Math.max(...config.presetList.map((preset) => preset.value)),
      supported_options: withOrder(config.presetList),
    });
  }
  if (config.motion_events) {
    features.push({
      name: 'Motion',
      external_id: ids.feature(FEATURES.MOTION),
      category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 1,
    });
  }
  return {
    name: `iCSee${model} (${camera.host})`,
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'HOST', value: camera.host },
      { name: 'PORT', value: String(camera.port) },
      ...(camera.model ? [{ name: 'MODEL', value: camera.model }] : []),
      ...(camera.info?.firmware ? [{ name: 'FIRMWARE', value: camera.info.firmware }] : []),
    ],
    features,
  };
}

/**
 * Discovery payload of the fixed lens of a dual-lens camera: its image.
 */
export function buildFixedLensDevice(gladys, camera) {
  const ids = idsOf(gladys, camera, LENSES.FIXED);
  const model = camera.model ? ` ${camera.model}` : '';
  return {
    name: `iCSee${model} fixed lens (${camera.host})`,
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'HOST', value: camera.host },
      { name: 'PORT', value: String(camera.port) },
      { name: 'LENS', value: LENSES.FIXED },
    ],
    features: [
      {
        name: 'Image',
        external_id: ids.feature(FEATURES.IMAGE),
        category: DEVICE_FEATURE_CATEGORIES.CAMERA,
        type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
        read_only: true,
        has_feedback: false,
        keep_history: false,
        min: 0,
        max: 0,
      },
    ],
  };
}

export function buildDiscoveredDevices(gladys, manager, config) {
  return manager
    .identified()
    .flatMap((camera) => [
      buildDevice(gladys, camera, config),
      ...(camera.dual ? [buildFixedLensDevice(gladys, camera)] : []),
    ]);
}

/**
 * Transport badge of every published camera: local while the session is up.
 */
export function buildTransportEntries(gladys, manager) {
  return manager.identified().flatMap((camera) =>
    camera.lenses.map((lens) => ({
      external_id: idsOf(gladys, camera, lens).device,
      transport: camera.online ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
    })),
  );
}

/**
 * Run a device command (onSetValue).
 * @param {object} gladys
 * @param {object} manager
 * @param {object} args { device, feature, value }
 */
export async function setValue(gladys, manager, { device, feature, value }) {
  const camera = findCamera(gladys, manager, device);
  if (!camera) {
    throw new Error(`Unknown camera ${device.external_id}`);
  }
  const ids = idsOf(gladys, camera);
  const number = Number(value);
  if (feature.external_id === ids.feature(FEATURES.MOVE)) {
    await camera.move(number);
    return;
  }
  if (feature.external_id === ids.feature(FEATURES.PRESET)) {
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`Invalid preset ${value}`);
    }
    await camera.gotoPreset(number);
    return;
  }
  throw new Error(`Feature ${feature.external_id} cannot be controlled`);
}
