import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CAMERA_MOVE } from '../src/camera.js';
import { normalizeConfig } from '../src/config.js';
import { idsOf } from '../src/devices.js';
import { SCENE_ACTIONS, TRIGGERS, connectionEventData, motionEventData } from '../src/scenes.js';
import { stubCamera, stubManager } from './helpers/stubs.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const config = normalizeConfig({ hosts: '192.168.1.50' });

const declarationOf = (list, key) => manifest[list].find((entry) => entry.key === key);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function setup(cameraOptions) {
  const gladys = createFakeGladys();
  const camera = stubCamera(cameraOptions);
  const manager = stubManager([camera]);
  const published = [];
  const publishImage = async (cam, jpeg) => published.push([cam, jpeg]);
  const run = (key, fields) =>
    SCENE_ACTIONS[key](gladys, {
      fields: { device: idsOf(gladys, camera).device, ...fields },
      config,
      manager,
      publishImage,
    });
  return { gladys, camera, published, run };
}

function assertDeclaredOutputs(key, outputs) {
  const declared = keysOf(declarationOf('scene_actions', key).outputs);
  assert.deepEqual(Object.keys(outputs).sort(), [...declared].sort(), `outputs of ${key}`);
  for (const value of Object.values(outputs)) {
    assert.notEqual(typeof value, 'object', 'outputs are scalars');
  }
}

function assertDeclaredData(key, data) {
  const trigger = declarationOf('scene_triggers', key);
  const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
  for (const [field, value] of Object.entries(data)) {
    assert.ok(declared.includes(field), `data.${field} is not declared, the core would drop it`);
    assert.ok(value === null || typeof value !== 'object', `data.${field} must be a primitive`);
  }
  // Filter values must be among the options the scene author picks from.
  for (const field of trigger.fields) {
    if (field.options) {
      assert.ok(
        field.options.some((option) => option.value === data[field.key]),
        `data.${field.key} "${data[field.key]}" is not an option of the filter`,
      );
    }
  }
}

test('move_camera moves for the asked duration, capped', async () => {
  const { camera, run } = setup();
  const outputs = await run('move_camera', { direction: 'up', duration: 2 });
  assertDeclaredOutputs('move_camera', outputs);
  assert.deepEqual(outputs, { moved: true });
  await run('move_camera', { direction: 'left', duration: 99 });
  assert.deepEqual(camera.calls, [
    ['moveFor', CAMERA_MOVE.TILT_UP, 2],
    ['moveFor', CAMERA_MOVE.PAN_LEFT, 5],
  ]);
  assert.deepEqual(await run('move_camera', { direction: 'sideways' }), { moved: false });
});

test('goto_preset and save_preset send the slot', async () => {
  const { camera, run } = setup();
  const goto = await run('goto_preset', { preset: 2 });
  const save = await run('save_preset', { preset: 3 });
  assertDeclaredOutputs('goto_preset', goto);
  assertDeclaredOutputs('save_preset', save);
  assert.deepEqual([goto, save], [{ done: true }, { saved: true }]);
  assert.deepEqual(camera.calls, [
    ['gotoPreset', 2],
    ['savePreset', 3],
  ]);
  assert.deepEqual(await run('goto_preset', { preset: 0 }), { done: false });
});

test('take_snapshot captures and pushes the image to the camera device', async () => {
  const { camera, published, run } = setup();
  const outputs = await run('take_snapshot', {});
  assertDeclaredOutputs('take_snapshot', outputs);
  assert.deepEqual(outputs, { captured: true });
  assert.equal(published.length, 1);
  assert.equal(published[0][0], camera);
});

test('reboot_camera reboots', async () => {
  const { camera, run } = setup();
  const outputs = await run('reboot_camera', {});
  assertDeclaredOutputs('reboot_camera', outputs);
  assert.deepEqual(camera.calls, [['reboot']]);
});

test('an offline or unknown camera is an output, not a failure', async () => {
  const { camera, run } = setup({ online: false });
  assert.deepEqual(await run('move_camera', { direction: 'up' }), { moved: false });
  assert.deepEqual(await run('reboot_camera', {}), { rebooting: false });
  assert.deepEqual(camera.calls, []);
  assert.deepEqual(await run('goto_preset', { device: 'ext:x:camera:nope', preset: 1 }), {
    done: false,
  });
});

test('a camera refusing the command is an output too', async () => {
  const { camera, run } = setup();
  camera.gotoPreset = async () => {
    throw new Error('refused');
  };
  assert.deepEqual(await run('goto_preset', { preset: 1 }), { done: false });
});

test('the trigger data only carries declared keys and valid filter values', () => {
  const gladys = createFakeGladys();
  const camera = stubCamera();
  const device = idsOf(gladys, camera).device;
  for (const detection of ['motion', 'person']) {
    assertDeclaredData(TRIGGERS.MOTION_DETECTED, motionEventData(device, camera, detection));
  }
  assertDeclaredData(TRIGGERS.CONNECTION_CHANGED, connectionEventData(device, camera));
  assertDeclaredData(
    TRIGGERS.CONNECTION_CHANGED,
    connectionEventData(device, { ...camera, online: false }),
  );
  assert.equal(motionEventData(device, camera, 'person').device, device);
});

test('Gladys accepts the trigger events', async () => {
  const gladys = createFakeGladys();
  const camera = stubCamera();
  const device = idsOf(gladys, camera).device;
  await gladys.publishSceneEvent(
    TRIGGERS.MOTION_DETECTED,
    motionEventData(device, camera, 'motion'),
  );
  await gladys.publishSceneEvent(TRIGGERS.CONNECTION_CHANGED, connectionEventData(device, camera));
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.MOTION_DETECTED, TRIGGERS.CONNECTION_CHANGED],
  );
});
