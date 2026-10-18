// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys 5.1+).
//
// TRIGGERS ("this happened") are fired by index.js from the camera events with
// `gladys.publishSceneEvent(key, data)`: one event per transition, flat
// `data` restricted to the keys the manifest trigger declares in its `fields`
// (the filters) and `variables` (exposed as {{triggerEvent.data.<key>}}).
//
// ACTIONS ("do this") are handled here, keyed by the manifest `scene_actions`
// key. Their `fields` arrive resolved (a `"source": "devices"` field is the
// chosen device external_id); they resolve the declared scalar `outputs`. A
// camera that is offline or refuses the command is reported through the
// outputs, never thrown: a scene action is not a condition, the scene author
// gates the next actions on the output.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { DIRECTIONS, MAX_MOVE_SECONDS } from './camera.js';
import { findCamera } from './devices.js';

const logger = createLogger({ name: 'scenes' });

// Trigger keys, as declared in the manifest `scene_triggers` field. Keys are
// forever: scenes store them.
export const TRIGGERS = {
  MOTION_DETECTED: 'motion_detected',
  CONNECTION_CHANGED: 'camera_connection_changed',
};

/**
 * Event data of the motion_detected trigger.
 * @param {string} deviceExternalId
 * @param {object} camera
 * @param {'motion'|'person'} detection
 */
export function motionEventData(deviceExternalId, camera, detection) {
  return { device: deviceExternalId, detection, camera_host: camera.host };
}

/**
 * Event data of the camera_connection_changed trigger.
 */
export function connectionEventData(deviceExternalId, camera) {
  return {
    device: deviceExternalId,
    status: camera.online ? 'online' : 'offline',
    camera_host: camera.host,
  };
}

function presetSlot(value) {
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 1 && slot <= 255 ? slot : null;
}

// Run an operation on the chosen camera: false when it is unknown, offline or
// refuses (logged), true once done.
async function onCamera(gladys, manager, deviceExternalId, label, operation) {
  const camera = findCamera(gladys, manager, deviceExternalId);
  if (!camera || !camera.online) {
    logger.info(`Scene action ${label}: camera ${deviceExternalId} unavailable`);
    return false;
  }
  try {
    await operation(camera);
    return true;
  } catch (err) {
    logger.warn(`Scene action ${label} failed on ${camera.host}: ${err.message}`);
    return false;
  }
}

export const SCENE_ACTIONS = {
  async move_camera(gladys, { fields, manager }) {
    const move = DIRECTIONS[fields.direction];
    const seconds = Math.min(Math.max(Number(fields.duration) || 1, 0.2), MAX_MOVE_SECONDS);
    if (!move) {
      return { moved: false };
    }
    const moved = await onCamera(gladys, manager, fields.device, 'move_camera', (camera) =>
      camera.moveFor(move, seconds),
    );
    return { moved };
  },

  async goto_preset(gladys, { fields, manager }) {
    const slot = presetSlot(fields.preset);
    if (slot === null) {
      return { done: false };
    }
    const done = await onCamera(gladys, manager, fields.device, 'goto_preset', (camera) =>
      camera.gotoPreset(slot),
    );
    return { done };
  },

  async save_preset(gladys, { fields, manager }) {
    const slot = presetSlot(fields.preset);
    if (slot === null) {
      return { saved: false };
    }
    const saved = await onCamera(gladys, manager, fields.device, 'save_preset', (camera) =>
      camera.savePreset(slot),
    );
    return { saved };
  },

  // A fresh image, pushed to the camera device: the scene can then send it
  // with the core "send a camera image" action.
  async take_snapshot(gladys, { fields, manager, publishImage }) {
    const captured = await onCamera(
      gladys,
      manager,
      fields.device,
      'take_snapshot',
      async (camera) => {
        // Every lens of a dual-lens model, from the same frame.
        const images = await camera.captureAll();
        for (const [lens, jpeg] of Object.entries(images)) {
          await publishImage(camera, jpeg, lens);
        }
      },
    );
    return { captured };
  },

  async reboot_camera(gladys, { fields, manager }) {
    const rebooting = await onCamera(gladys, manager, fields.device, 'reboot_camera', (camera) =>
      camera.reboot(),
    );
    return { rebooting };
  },
};
