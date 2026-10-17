// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+).
//
// The manifest `widgets` field declares their identity; each instance is bound
// to one camera through its `camera` setting (`"source": "devices"`, the
// device external_id). The content is declarative — the core renders it with
// its own theme, dark mode and translations.
//
//   camera_control  latest image + status + four direction buttons
//   camera_presets  one button per preset (a form beyond four)
//
// Each entry of WIDGETS exposes:
//   - get(gladys, { settings, language, manager, config }): the content;
//   - action(gladys, { actionKey, params, values, settings, manager, config }).
// index.js registers them and serves the images (onWidgetGetImage).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, createLogger } from '@gladysassistant/integration-sdk';
import { DIRECTIONS } from './camera.js';
import { findCamera } from './devices.js';
import { t } from './i18n.js';

const logger = createLogger({ name: 'widgets' });

export const CONTROL_WIDGET = 'camera_control';
export const PRESETS_WIDGET = 'camera_presets';

// Button action keys: unique within a content (the core drops duplicates),
// so the direction and the preset slot are part of the key.
const MOVE_ACTION_PREFIX = 'move_';
const PRESET_ACTION_PREFIX = 'goto_preset_';
const OTHER_PRESET_ACTION = 'goto_preset_other';

// Toasts are capped at 200 characters.
const MAX_TOAST = 200;

const MAX_PRESET_BUTTONS = 4;

const DIRECTION_BUTTONS = [
  { direction: 'left', label: 'move_left', icon: 'arrow-left' },
  { direction: 'right', label: 'move_right', icon: 'arrow-right' },
  { direction: 'up', label: 'move_up', icon: 'arrow-up' },
  { direction: 'down', label: 'move_down', icon: 'arrow-down' },
];

// Image keys: `snap-<camera>-<hash of the bytes>`. The core caches an image
// one hour by key, so the key changes with the bytes.
const IMAGE_KEY_PREFIX = 'snap-';

export function imageKeyOf(camera) {
  if (!camera.lastImage || !camera.platformId) {
    return null;
  }
  return `${IMAGE_KEY_PREFIX}${camera.platformId.slice(0, 40)}-${camera.lastImage.hash}`;
}

/**
 * Raw base64 of the image behind a key (onWidgetGetImage).
 * @param {object} manager
 * @param {string} imageKey
 */
export function widgetImage(manager, imageKey) {
  const camera = manager.identified().find((candidate) => imageKeyOf(candidate) === imageKey);
  if (!camera) {
    throw new Error(`Image ${imageKey} is no longer available`);
  }
  return camera.lastImage.jpeg.toString('base64');
}

function cardText(message) {
  return { components: [{ type: 'text', text: message, variant: 'body' }], ttl_seconds: 60 };
}

/**
 * Resolve the camera of a widget instance, or the content explaining why
 * there is none.
 */
function resolveCamera(gladys, manager, settings) {
  if (!settings?.camera) {
    return { content: cardText(t('widget_pick_camera')) };
  }
  const camera = findCamera(gladys, manager, settings.camera);
  if (!camera) {
    return { content: cardText(t('unknown_camera')) };
  }
  return { camera };
}

function lastDetectionText(camera, now = Date.now()) {
  const { kind, at } = camera.detection;
  if (!at) {
    return t('widget_never');
  }
  const kindText = t(kind === 'person' ? 'detection_person' : 'detection_motion');
  const minutes = Math.floor((now - at.getTime()) / 60_000);
  if (minutes < 1) {
    return t('ago_now', { kind: kindText });
  }
  if (minutes < 120) {
    return t('ago_minutes', { kind: kindText, count: minutes });
  }
  return t('ago_hours', { kind: kindText, count: Math.floor(minutes / 60) });
}

function statusItem(camera) {
  return {
    label: t('widget_status'),
    icon: camera.online ? 'wifi' : 'wifi-off',
    value: t(camera.online ? 'widget_online' : 'widget_offline'),
    color: camera.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  };
}

function requireOnline(camera) {
  if (!camera.online) {
    throw new Error(t('camera_offline', { name: camera.host }).en);
  }
}

export const WIDGETS = {
  [CONTROL_WIDGET]: {
    async get(gladys, { settings, manager, config }) {
      const { camera, content } = resolveCamera(gladys, manager, settings);
      if (!camera) {
        return content;
      }
      const components = [];
      const imageKey = imageKeyOf(camera);
      if (imageKey) {
        components.push({
          type: 'image',
          key: imageKey,
          alt: t('widget_image_alt', { name: camera.host }),
          fit: 'contain',
        });
      }
      const items = [statusItem(camera)];
      if (camera.model) {
        items.push({
          label: t('widget_model'),
          icon: 'camera',
          value: camera.model.slice(0, 40),
          color: WIDGET_COLORS.NEUTRAL,
        });
      }
      if (config.motion_events) {
        items.push({
          label: t('widget_last_detection'),
          icon: 'eye',
          value: lastDetectionText(camera),
          color: camera.detection.active ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
        });
      }
      components.push({ type: 'status', items });
      for (const button of DIRECTION_BUTTONS) {
        components.push({
          type: 'button',
          label: t(button.label),
          icon: button.icon,
          style: 'secondary',
          action: {
            key: `${MOVE_ACTION_PREFIX}${button.direction}`,
            params: { direction: button.direction },
          },
        });
      }
      return {
        // New images and detections nudge the widget (index.js); the TTL is
        // the safety net, and keeps the "x min ago" text fresh.
        ttl_seconds: Math.min(Math.max(config.snapshot_interval || 60, 10), 300),
        components,
      };
    },

    async action(gladys, { actionKey, params, settings, manager, config }) {
      logger.info(`onWidgetAction <- ${CONTROL_WIDGET}.${actionKey}`);
      if (!actionKey.startsWith(MOVE_ACTION_PREFIX)) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const { camera } = resolveCamera(gladys, manager, settings);
      const move = DIRECTIONS[params.direction];
      if (!camera || !move) {
        throw new Error(t('unknown_camera').en);
      }
      requireOnline(camera);
      // One tap, one bounded step: the move stops by itself after the
      // configured duration.
      await camera.moveFor(move, config.move_duration);
      return t('moved');
    },
  },

  [PRESETS_WIDGET]: {
    async get(gladys, { settings, manager, config }) {
      const { camera, content } = resolveCamera(gladys, manager, settings);
      if (!camera) {
        return content;
      }
      const presets = config.presetList;
      if (presets.length === 0) {
        return cardText(t('widget_no_presets'));
      }
      const components = [{ type: 'status', items: [statusItem(camera)] }];
      const direct =
        presets.length <= MAX_PRESET_BUTTONS ? presets : presets.slice(0, MAX_PRESET_BUTTONS - 1);
      for (const preset of direct) {
        components.push({
          type: 'button',
          label: preset.label.slice(0, 24),
          icon: 'map-pin',
          style: 'secondary',
          action: {
            key: `${PRESET_ACTION_PREFIX}${preset.value}`,
            params: { preset: preset.value },
          },
        });
      }
      if (direct.length < presets.length) {
        // Beyond four buttons: a form behind the last one lists the others.
        components.push({
          type: 'button',
          label: t('widget_other_preset'),
          icon: 'list',
          style: 'secondary',
          action: {
            key: OTHER_PRESET_ACTION,
            fields: [
              {
                key: 'preset',
                type: 'select',
                required: true,
                label: t('widget_preset'),
                default: String(presets[direct.length].value),
                options: presets.slice(direct.length).map((preset) => ({
                  value: String(preset.value),
                  label: { en: preset.label },
                })),
              },
            ],
          },
        });
      }
      return { ttl_seconds: 300, components };
    },

    async action(gladys, { actionKey, params, values, settings, manager, config }) {
      logger.info(`onWidgetAction <- ${PRESETS_WIDGET}.${actionKey}`);
      if (!actionKey.startsWith(PRESET_ACTION_PREFIX)) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const { camera } = resolveCamera(gladys, manager, settings);
      if (!camera) {
        throw new Error(t('unknown_camera').en);
      }
      const slot = Number(values?.preset ?? params?.preset);
      const preset = config.presetList.find((candidate) => candidate.value === slot);
      if (!preset) {
        throw new Error(`Unknown preset ${slot}`);
      }
      requireOnline(camera);
      await camera.gotoPreset(slot);
      const message = t('preset_reached', { preset: preset.label });
      return Object.fromEntries(
        Object.entries(message).map(([lang, text]) => [lang, text.slice(0, MAX_TOAST)]),
      );
    },
  },
};

// The core rate-limits nudges to 1 per 10 s per widget: coalesce ours.
const NUDGE_INTERVAL_MS = 10_000;
const lastNudges = new Map();
const pendingNudges = new Map();

/**
 * Ask the core to re-pull the widgets now (new image, detection, connection
 * change, config update), at most once per 10 s per widget: a nudge inside
 * the window is delayed to its end, never dropped.
 * @param {object} gladys
 * @param {string[]} [keys]
 */
export function refreshWidgets(gladys, keys = Object.keys(WIDGETS)) {
  const now = Date.now();
  for (const key of keys) {
    if (pendingNudges.has(key)) {
      continue;
    }
    const wait = lastNudges.has(key) ? lastNudges.get(key) + NUDGE_INTERVAL_MS - now : 0;
    if (wait <= 0) {
      lastNudges.set(key, now);
      gladys.requestWidgetRefresh(key);
      continue;
    }
    const timer = setTimeout(() => {
      pendingNudges.delete(key);
      lastNudges.set(key, Date.now());
      gladys.requestWidgetRefresh(key);
    }, wait);
    timer.unref?.();
    pendingNudges.set(key, timer);
  }
}

/** Forget the nudge history (a new connection drops pending nudges anyway). */
export function resetWidgetNudges() {
  for (const timer of pendingNudges.values()) {
    clearTimeout(timer);
  }
  pendingNudges.clear();
  lastNudges.clear();
}
