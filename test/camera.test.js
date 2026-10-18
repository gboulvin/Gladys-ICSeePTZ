import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DvripClient } from '../src/dvrip/client.js';
import { MESSAGES, PTZ_START, PTZ_STOP } from '../src/dvrip/protocol.js';
import {
  CAMERA_MOVE,
  Camera,
  CameraManager,
  LENSES,
  MAX_MOVE_SECONDS,
  detectionKind,
  platformIdOf,
} from '../src/camera.js';
import { normalizeConfig } from '../src/config.js';
import { TINY_JPEG, createFakeCamera, flush, jpegOfSize, waitFor } from './helpers/fakeCamera.js';

const baseConfig = (overrides = {}) =>
  normalizeConfig({
    hosts: '192.168.1.50',
    snapshot_interval: 0,
    move_duration: 0.2,
    ...overrides,
  });

function depsFor(fake, extra = {}) {
  return {
    clientFactory: (options) =>
      new DvripClient({ ...options, socketFactory: fake.socketFactory, timeoutMs: 500 }),
    runFfmpeg: async () => {
      throw new Error('ffmpeg must not run in this test');
    },
    ...extra,
  };
}

async function onlineCamera(fake, config = baseConfig(), extra = {}) {
  const camera = new Camera({ host: '192.168.1.50', port: 34567 }, config, depsFor(fake, extra));
  camera.start();
  await waitFor(() => camera.online);
  return camera;
}

const ptzLog = (fake) => fake.ptz.map((ptz) => [ptz.Command, ptz.Parameter.Preset]);

test('detectionKind tells persons from motions, and ignores the other alarms', () => {
  assert.equal(detectionKind('VideoMotion'), 'motion');
  assert.equal(detectionKind('HumanDetect'), 'person');
  assert.equal(detectionKind('appEventHumanDetectAlarm'), 'person');
  assert.equal(detectionKind('VideoLoss'), null);
});

test('platformIdOf keeps the serial readable and safe in an external id', () => {
  assert.equal(platformIdOf('A1B2C3D4E5F60718'), 'a1b2c3d4e5f60718');
  assert.equal(platformIdOf(' AB:CD/12 '), 'ab-cd-12');
});

test('a camera connects, learns its identity and subscribes to the alarms', async () => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake);
  try {
    assert.equal(camera.serial, 'A1B2C3D4E5F60718');
    assert.equal(camera.model, 'IPC-PTZ-3MP');
    assert.equal(fake.received(MESSAGES.ALARM_SUBSCRIBE).length, 1);
  } finally {
    camera.stop();
  }
});

test('no alarm subscription when the motion events are disabled', async () => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake, baseConfig({ motion_events: false }));
  try {
    assert.equal(fake.received(MESSAGES.ALARM_SUBSCRIBE).length, 0);
  } finally {
    camera.stop();
  }
});

test('a lone direction is stopped by the watchdog (safety rule)', async () => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake);
  try {
    const { done } = await camera.move(CAMERA_MOVE.PAN_LEFT);
    assert.deepEqual(ptzLog(fake), [['DirectionLeft', PTZ_START]]);
    await done;
    assert.deepEqual(ptzLog(fake), [
      ['DirectionLeft', PTZ_START],
      ['DirectionLeft', PTZ_STOP],
    ]);
    assert.equal(camera.activeMove, null);
  } finally {
    camera.stop();
  }
});

test('a stop (value 0) ends the move before the watchdog', async () => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake, baseConfig({ move_duration: 5 }));
  try {
    await camera.move(CAMERA_MOVE.TILT_UP);
    await camera.move(CAMERA_MOVE.STOP);
    assert.deepEqual(ptzLog(fake), [
      ['DirectionUp', PTZ_START],
      ['DirectionUp', PTZ_STOP],
    ]);
  } finally {
    camera.stop();
  }
});

test('a new direction while moving stops the previous one first', async () => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake, baseConfig({ move_duration: 5 }));
  try {
    await camera.move(CAMERA_MOVE.PAN_LEFT);
    await camera.move(CAMERA_MOVE.PAN_RIGHT);
    await camera.stopMove();
    assert.deepEqual(ptzLog(fake), [
      ['DirectionLeft', PTZ_START],
      ['DirectionLeft', PTZ_STOP],
      ['DirectionRight', PTZ_START],
      ['DirectionRight', PTZ_STOP],
    ]);
  } finally {
    camera.stop();
  }
});

test('no move ever exceeds the hard ceiling', async (t) => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await camera.move(CAMERA_MOVE.PAN_LEFT, 60);
    t.mock.timers.tick(MAX_MOVE_SECONDS * 1000);
    t.mock.timers.reset();
    await waitFor(() => fake.ptz.length === 2);
    assert.deepEqual(ptzLog(fake)[1], ['DirectionLeft', PTZ_STOP]);
  } finally {
    t.mock.timers.reset();
    camera.stop();
  }
});

test('presets are recalled and saved with their slot', async () => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake);
  try {
    await camera.gotoPreset(3);
    await camera.savePreset(4);
    assert.deepEqual(ptzLog(fake), [
      ['GotoPreset', 3],
      ['SetPreset', 4],
    ]);
  } finally {
    camera.stop();
  }
});

test('commands on an offline camera fail with a clear error', async () => {
  const camera = new Camera(
    { host: '192.168.1.99', port: 34567 },
    baseConfig(),
    depsFor(createFakeCamera()),
  );
  await assert.rejects(camera.move(CAMERA_MOVE.PAN_LEFT), /offline/);
});

test('detections: one new event per detection, cleared by the Stop', async () => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake);
  const detections = [];
  camera.on('detection', (detection) => detections.push(detection));
  try {
    fake.sendAlarm('VideoMotion', 'Start');
    fake.sendAlarm('VideoMotion', 'Start');
    fake.sendAlarm('HumanDetect', 'Start');
    fake.sendAlarm('VideoLoss', 'Start');
    fake.sendAlarm('VideoMotion', 'Stop');
    await waitFor(() => detections.length === 4);
    assert.deepEqual(detections, [
      { kind: 'motion', active: true, isNew: true },
      { kind: 'motion', active: true, isNew: false },
      { kind: 'person', active: true, isNew: true },
      { kind: 'person', active: false, isNew: false },
    ]);
  } finally {
    camera.stop();
  }
});

test('the camera reconnects after the session drops', async (t) => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake);
  const events = [];
  camera.on('offline', () => events.push('offline'));
  camera.on('online', () => events.push('online'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    fake.drop();
    await waitForMocked(() => !camera.online);
    t.mock.timers.tick(5_000);
    t.mock.timers.reset();
    await waitFor(() => camera.online);
    assert.deepEqual(events, ['offline', 'online']);
    assert.equal(fake.connections, 2);
  } finally {
    t.mock.timers.reset();
    camera.stop();
  }
});

// waitFor polls with setTimeout: with mocked timers, poll on setImmediate.
async function waitForMocked(predicate) {
  for (let i = 0; i < 200 && !predicate(); i += 1) {
    await flush(1);
  }
  assert.ok(predicate(), 'condition not met');
}

test('captureJpeg uses the firmware snapshot', async () => {
  const fake = createFakeCamera();
  const camera = await onlineCamera(fake);
  try {
    const jpeg = await camera.captureJpeg();
    assert.deepEqual(jpeg, TINY_JPEG);
    assert.equal(camera.lastImage.hash.length, 10);
  } finally {
    camera.stop();
  }
});

test('captureJpeg falls back to RTSP when the firmware has no snapshot, and remembers it', async () => {
  const fake = createFakeCamera({ snapshot: null, password: 'p@ss' });
  const calls = [];
  const runFfmpeg = async (args) => {
    calls.push(args);
    return TINY_JPEG;
  };
  const camera = await onlineCamera(fake, baseConfig({ password: 'p@ss' }), { runFfmpeg });
  try {
    assert.deepEqual(await camera.captureJpeg(), TINY_JPEG);
    assert.deepEqual(await camera.captureJpeg(), TINY_JPEG);
    assert.equal(fake.received(MESSAGES.SNAPSHOT).length, 1, 'OPSNAP is not retried');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].some((arg) => arg.startsWith('rtsp://192.168.1.50:554/')));
  } finally {
    camera.stop();
  }
});

test('the snapshot loop pushes an image right away, then at the interval', async () => {
  const fake = createFakeCamera();
  const camera = new Camera(
    { host: '192.168.1.50', port: 34567 },
    baseConfig({ snapshot_interval: 3600 }),
    depsFor(fake),
  );
  const images = [];
  camera.on('image', (jpeg) => images.push(jpeg));
  camera.start();
  try {
    await waitFor(() => images.length === 1);
    assert.deepEqual(images[0], TINY_JPEG);
  } finally {
    camera.stop();
  }
});

test('the manager remembers the cameras and publishes the known ones even offline', async () => {
  const saved = [];
  const fake = createFakeCamera();
  const manager = new CameraManager({
    ...depsFor(fake),
    loadKnown: async () => ({}),
    saveKnown: async (known) => saved.push(structuredClone(known)),
  });
  const identified = [];
  manager.on('identified', (camera) => identified.push(camera.serial));
  try {
    await manager.apply(baseConfig());
    await waitFor(() => identified.length === 1);
    assert.deepEqual(saved.at(-1), {
      '192.168.1.50:34567': { serial: 'A1B2C3D4E5F60718', model: 'IPC-PTZ-3MP' },
    });
    assert.equal(manager.identified().length, 1);
  } finally {
    manager.stop();
  }

  // Next start, the camera unreachable: still published, from the store.
  const offline = new CameraManager({
    ...depsFor(createFakeCamera({ reachable: false })),
    loadKnown: async () => saved.at(-1),
    saveKnown: async () => {},
  });
  try {
    await offline.apply(baseConfig());
    const [camera] = offline.identified();
    assert.equal(camera.platformId, 'a1b2c3d4e5f60718');
    assert.equal(camera.online, false);
  } finally {
    offline.stop();
  }
});

test('the manager follows a camera whose address changed', async () => {
  const saved = [];
  const manager = new CameraManager({
    ...depsFor(createFakeCamera()),
    loadKnown: async () => ({ '192.168.1.20:34567': { serial: 'A1B2C3D4E5F60718' } }),
    saveKnown: async (known) => saved.push(structuredClone(known)),
  });
  try {
    await manager.apply(baseConfig());
    await waitFor(() => saved.length === 1);
    assert.deepEqual(Object.keys(saved[0]), ['192.168.1.50:34567']);
  } finally {
    manager.stop();
  }
});

test('the manager stops the cameras removed from the config', async () => {
  const manager = new CameraManager({
    ...depsFor(createFakeCamera()),
    loadKnown: async () => ({}),
    saveKnown: async () => {},
  });
  try {
    await manager.apply(baseConfig({ hosts: '192.168.1.50, 192.168.1.51' }));
    assert.equal(manager.all().length, 2);
    await manager.apply(baseConfig({ hosts: '192.168.1.51' }));
    assert.deepEqual(
      manager.all().map((camera) => camera.host),
      ['192.168.1.51'],
    );
  } finally {
    manager.stop();
  }
});

// ffmpeg stand-in: answers which half it was asked for.
async function cropEcho(args) {
  const filter = args[args.indexOf('-vf') + 1];
  return Buffer.from(filter.startsWith('crop=iw:ih/2:0:ih/2') ? 'BOTTOM' : 'TOP');
}

test('a stacked dual-lens frame is split: PTZ lens at the bottom, fixed on top', async () => {
  const fake = createFakeCamera({ snapshot: jpegOfSize(2304, 2592) });
  const camera = await onlineCamera(fake, baseConfig(), { runFfmpeg: cropEcho });
  const layouts = [];
  camera.on('layout', () => layouts.push(camera.dual));
  try {
    assert.equal(camera.dual, false, 'unknown until the first frame');
    const images = await camera.captureAll();
    assert.deepEqual(
      Object.fromEntries(Object.entries(images).map(([lens, jpeg]) => [lens, String(jpeg)])),
      { [LENSES.MAIN]: 'BOTTOM', [LENSES.FIXED]: 'TOP' },
    );
    assert.equal(camera.dual, true);
    assert.deepEqual(camera.lenses, [LENSES.MAIN, LENSES.FIXED]);
    assert.deepEqual(layouts, [true], 'the layout change is announced once');
    await camera.captureAll();
    assert.deepEqual(layouts, [true]);
    assert.equal(String(await camera.captureJpeg(LENSES.FIXED)), 'TOP');
    assert.equal(fake.received(MESSAGES.SNAPSHOT).length, 3, 'one frame per capture');
  } finally {
    camera.stop();
  }
});

test('the PTZ-on-top layout swaps the halves, and "off" keeps one image', async () => {
  const fake = createFakeCamera({ snapshot: jpegOfSize(2304, 2592) });
  const swapped = await onlineCamera(fake, baseConfig({ dual_lens: 'ptz_top' }), {
    runFfmpeg: cropEcho,
  });
  try {
    const images = await swapped.captureAll();
    assert.equal(String(images[LENSES.MAIN]), 'TOP');
    assert.equal(String(images[LENSES.FIXED]), 'BOTTOM');
  } finally {
    swapped.stop();
  }

  const single = await onlineCamera(fake, baseConfig({ dual_lens: 'off' }), {
    runFfmpeg: async () => assert.fail('a small uncropped image needs no ffmpeg'),
  });
  try {
    const images = await single.captureAll();
    assert.deepEqual(Object.keys(images), [LENSES.MAIN]);
    assert.equal(single.dual, false);
    await assert.rejects(single.captureJpeg(LENSES.FIXED), /no fixed lens/);
  } finally {
    single.stop();
  }
});

test('a single-lens frame stays one image', async () => {
  const fake = createFakeCamera({ snapshot: jpegOfSize(2560, 1440) });
  const camera = await onlineCamera(fake);
  try {
    const images = await camera.captureAll();
    assert.deepEqual(Object.keys(images), [LENSES.MAIN]);
    assert.equal(camera.dual, false);
  } finally {
    camera.stop();
  }
});

test('the manager remembers a dual-lens camera, so it keeps both devices offline', async () => {
  const saved = [];
  const fake = createFakeCamera({ snapshot: jpegOfSize(2304, 2592) });
  const manager = new CameraManager({
    ...depsFor(fake, { runFfmpeg: cropEcho }),
    loadKnown: async () => ({}),
    saveKnown: async (known) => saved.push(structuredClone(known)),
  });
  let identified = 0;
  manager.on('identified', () => {
    identified += 1;
  });
  try {
    await manager.apply(baseConfig());
    await waitFor(() => identified === 1);
    await manager.all()[0].captureAll();
    assert.equal(identified, 2, 'the new lens layout re-publishes the devices');
    assert.equal(saved.at(-1)['192.168.1.50:34567'].dual, true);
  } finally {
    manager.stop();
  }

  const offline = new CameraManager({
    ...depsFor(createFakeCamera({ reachable: false })),
    loadKnown: async () => saved.at(-1),
    saveKnown: async () => {},
  });
  try {
    await offline.apply(baseConfig());
    assert.equal(offline.identified()[0].dual, true);
  } finally {
    offline.stop();
  }
});
