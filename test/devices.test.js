import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CAMERA_MOVE } from '../src/camera.js';
import { normalizeConfig } from '../src/config.js';
import {
  FEATURES,
  buildDevice,
  buildDiscoveredDevices,
  buildTransportEntries,
  findCamera,
  idsOf,
  platformIdFromExternalId,
  setValue,
} from '../src/devices.js';
import { stubCamera, stubManager } from './helpers/stubs.js';

const config = normalizeConfig({ hosts: '192.168.1.50', presets: '1:Entrance, 4:Garden' });

const featureOf = (device, type) => device.features.find((feature) => feature.type === type);

test('Gladys accepts the discovered cameras', async () => {
  const gladys = createFakeGladys();
  const manager = stubManager([stubCamera(), stubCamera({ host: '192.168.1.51', serial: 'B2' })]);
  // The fake Gladys refuses what the host API refuses (categories, types, ids).
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, manager, config));
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('the device id is the serial number, stable whatever the address', () => {
  const gladys = createFakeGladys();
  const here = buildDevice(gladys, stubCamera({ host: '192.168.1.50' }), config);
  const there = buildDevice(gladys, stubCamera({ host: '10.0.0.9' }), config);
  assert.equal(here.external_id, there.external_id);
  assert.match(here.external_id, /:camera:a1b2c3d4e5f60718$/);
  assert.equal(platformIdFromExternalId(gladys, here.external_id), 'a1b2c3d4e5f60718');
  assert.equal(platformIdFromExternalId(gladys, 'ext:other:camera:x'), null);
});

test('the move feature declares the pan/tilt movements, zoom only when enabled', () => {
  const gladys = createFakeGladys();
  const move = featureOf(
    buildDevice(gladys, stubCamera(), config),
    DEVICE_FEATURE_TYPES.CAMERA.MOVE,
  );
  assert.equal(move.category, DEVICE_FEATURE_CATEGORIES.CAMERA);
  assert.equal(move.read_only, false);
  assert.deepEqual(
    move.supported_options.map((option) => option.value),
    [CAMERA_MOVE.PAN_LEFT, CAMERA_MOVE.PAN_RIGHT, CAMERA_MOVE.TILT_UP, CAMERA_MOVE.TILT_DOWN],
  );
  assert.ok(!move.supported_options.some((option) => option.value === CAMERA_MOVE.STOP));

  const zoomed = featureOf(
    buildDevice(gladys, stubCamera(), normalizeConfig({ ...config, zoom: true })),
    DEVICE_FEATURE_TYPES.CAMERA.MOVE,
  );
  assert.equal(zoomed.supported_options.length, 6);
});

test('the preset feature lists the configured presets, and disappears without them', () => {
  const gladys = createFakeGladys();
  const preset = featureOf(
    buildDevice(gladys, stubCamera(), config),
    DEVICE_FEATURE_TYPES.CAMERA.PRESET,
  );
  assert.deepEqual(preset.supported_options, [
    { value: 1, label: 'Entrance', sort_order: 0 },
    { value: 4, label: 'Garden', sort_order: 1 },
  ]);
  assert.equal(preset.max, 4);

  const none = buildDevice(gladys, stubCamera(), normalizeConfig({ hosts: 'x' }));
  assert.equal(featureOf(none, DEVICE_FEATURE_TYPES.CAMERA.PRESET), undefined);
});

test('the motion feature follows the motion events setting', () => {
  const gladys = createFakeGladys();
  const withMotion = buildDevice(gladys, stubCamera(), config);
  assert.ok(
    withMotion.features.some((f) => f.category === DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR),
  );
  const without = buildDevice(gladys, stubCamera(), normalizeConfig({ motion_events: false }));
  assert.ok(!without.features.some((f) => f.category === DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR));
});

test('the transport badge is local while the session is up', () => {
  const gladys = createFakeGladys();
  const manager = stubManager([stubCamera(), stubCamera({ serial: 'B2', online: false })]);
  assert.deepEqual(
    buildTransportEntries(gladys, manager).map((entry) => entry.transport),
    ['local', 'unreachable'],
  );
});

test('setValue routes the move and preset commands to the camera', async () => {
  const gladys = createFakeGladys();
  const camera = stubCamera();
  const manager = stubManager([camera]);
  const ids = idsOf(gladys, camera);
  const device = { external_id: ids.device };
  assert.equal(findCamera(gladys, manager, device), camera);

  await setValue(gladys, manager, {
    device,
    feature: { external_id: ids.feature(FEATURES.MOVE) },
    value: CAMERA_MOVE.TILT_DOWN,
  });
  await setValue(gladys, manager, {
    device,
    feature: { external_id: ids.feature(FEATURES.MOVE) },
    value: CAMERA_MOVE.STOP,
  });
  await setValue(gladys, manager, {
    device,
    feature: { external_id: ids.feature(FEATURES.PRESET) },
    value: 4,
  });
  assert.deepEqual(camera.calls, [
    ['move', CAMERA_MOVE.TILT_DOWN, undefined],
    ['move', CAMERA_MOVE.STOP, undefined],
    ['gotoPreset', 4],
  ]);

  await assert.rejects(
    setValue(gladys, manager, {
      device,
      feature: { external_id: ids.feature(FEATURES.IMAGE) },
      value: 1,
    }),
    /cannot be controlled/,
  );
  await assert.rejects(
    setValue(gladys, manager, {
      device: { external_id: gladys.externalId('camera:unknown') },
      feature: { external_id: 'x' },
      value: 1,
    }),
    /Unknown camera/,
  );
});
