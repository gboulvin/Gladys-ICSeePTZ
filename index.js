// -----------------------------------------------------------------------------
// Entry point of the iCSee PTZ integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the camera manager. It holds no protocol
// logic (src/dvrip/), no device modeling (src/devices.js): it
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects, starts the cameras and publishes them.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { ACTIONS } from './src/actions.js';
import { CameraManager } from './src/camera.js';
import { normalizeConfig } from './src/config.js';
import {
  FEATURES,
  buildDiscoveredDevices,
  buildTransportEntries,
  resolveDevice,
  idsOf,
  setValue,
} from './src/devices.js';
import { t } from './src/i18n.js';
import { toCameraImage } from './src/image.js';
import { SCENE_ACTIONS, TRIGGERS, connectionEventData, motionEventData } from './src/scenes.js';
import { WIDGETS, refreshWidgets, resetWidgetNudges, widgetImage } from './src/widgets.js';

const gladys = new GladysIntegration();
const manager = new CameraManager();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();
let connected = false;

// --- Helpers -----------------------------------------------------------------

async function publishDevices() {
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, manager, config));
}

async function publishTransports() {
  const entries = buildTransportEntries(gladys, manager);
  if (entries.length > 0) {
    await gladys.publishTransports(entries);
  }
}

async function publishImage(camera, jpeg, lens) {
  await gladys.publishCameraImage(idsOf(gladys, camera, lens).device, toCameraImage(jpeg));
}

// Application-level status of the Configuration screen: connected when every
// camera answers, with the list of the silent ones otherwise.
async function publishConnectionStatus() {
  const cameras = manager.all();
  if (cameras.length === 0) {
    await gladys.setConnectionStatus(false, t('no_camera_configured'));
    return;
  }
  const offline = cameras.filter((camera) => !camera.online);
  if (offline.length === 0) {
    await gladys.setConnectionStatus(true);
    return;
  }
  await gladys.setConnectionStatus(
    offline.length < cameras.length,
    t('connection_partial', {
      offline: offline.length,
      total: cameras.length,
      hosts: offline.map((camera) => camera.host).join(', '),
    }),
  );
}

// Fire-and-forget wrapper for the event handlers: a failed publication is
// logged, never an unhandled rejection.
function background(label, promise) {
  promise.catch((err) => logger.error(`${label} failed`, err));
}

// --- Camera events -------------------------------------------------------------

manager.on('identified', () => {
  // A new camera (or a new address): it joins the Discovery tab.
  if (connected) {
    background('publishDiscoveredDevices', publishDevices());
  }
});

function onConnectionChange(camera) {
  if (!connected) {
    return;
  }
  background('publishTransports', publishTransports());
  background('setConnectionStatus', publishConnectionStatus());
  refreshWidgets(gladys);
  if (camera.platformId) {
    background(
      'publishSceneEvent',
      gladys.publishSceneEvent(
        TRIGGERS.CONNECTION_CHANGED,
        connectionEventData(idsOf(gladys, camera).device, camera),
      ),
    );
  }
}

manager.on('online', onConnectionChange);
manager.on('offline', onConnectionChange);

manager.on('detection', (camera, { kind, active, isNew }) => {
  if (!connected || !camera.platformId || !config.motion_events) {
    return;
  }
  const ids = idsOf(gladys, camera);
  background('publishState', gladys.publishState(ids.feature(FEATURES.MOTION), active ? 1 : 0));
  if (isNew) {
    // One event per detection (the 0 -> 1 edge, or motion -> person), never
    // one per alarm frame: the core admits 300 events/minute.
    background(
      'publishSceneEvent',
      gladys.publishSceneEvent(TRIGGERS.MOTION_DETECTED, motionEventData(ids.device, camera, kind)),
    );
  }
  refreshWidgets(gladys);
});

manager.on('image', (camera, jpeg, lens) => {
  if (!connected || !camera.platformId) {
    return;
  }
  background('publishCameraImage', publishImage(camera, jpeg, lens));
  refreshWidgets(gladys);
});

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing the cameras');
  await publishDevices();
});

// --- Command: move / preset ----------------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await setValue(gladys, manager, { device, feature, value });
});

// --- Camera: Gladys needs a FRESH image (dashboard, chat) --------------------
// The ack is awaited under 15 s: enough for a firmware snapshot, or an RTSP
// frame plus a re-encoding.
gladys.onGetImage(async (device) => {
  logger.info(`onGetImage <- ${device.external_id}`);
  const resolved = resolveDevice(gladys, manager, device);
  if (!resolved) {
    throw new Error(`Unknown camera ${device.external_id}`);
  }
  return toCameraImage(await resolved.camera.captureJpeg(resolved.lens));
});

// --- Manifest actions: buttons of the Configuration screen -------------------
for (const [actionKey, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(actionKey, (fields) => handler(gladys, { fields, config, manager, deps: {} }));
}

// --- Scene actions -------------------------------------------------------------
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) =>
    handler(gladys, { fields, config, manager, publishImage }),
  );
}

// --- Dashboard widgets -------------------------------------------------------
for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(gladys, { ...request, manager, config }));
  gladys.onWidgetAction(widgetKey, (actionKey, params, { settings, values }) =>
    widget.action(gladys, { actionKey, params, values, settings, manager, config }),
  );
}
gladys.onWidgetGetImage(async (imageKey) => widgetImage(manager, imageKey));

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  await manager.apply(config);
  // Presets, zoom and motion change the features: re-publish (idempotent,
  // the supported options of created devices are upserted).
  await publishDevices();
  await publishTransports();
  await publishConnectionStatus();
  refreshWidgets(gladys);
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    if (config.invalidHosts.length > 0) {
      logger.warn(`Ignored invalid addresses: ${config.invalidHosts.join(', ')}`);
    }
    await manager.apply(config);
    connected = true;
    // Cameras remembered from a previous run are published right away; the
    // others join as soon as their first session tells their serial number.
    await publishDevices();
    await publishTransports();
    resetWidgetNudges();
    refreshWidgets(gladys);
    await publishConnectionStatus();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys.setConnectionStatus(false, t('initialization_failed')).catch(() => {});
  }
});

gladys.on('disconnected', () => {
  // The cameras keep their sessions: only the publications pause.
  connected = false;
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  manager.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the iCSee PTZ integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
