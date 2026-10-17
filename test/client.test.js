import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DvripClient, DvripError } from '../src/dvrip/client.js';
import { MESSAGES, PTZ_COMMANDS, PTZ_START, PTZ_STOP } from '../src/dvrip/protocol.js';
import { TINY_JPEG, createFakeCamera, flush } from './helpers/fakeCamera.js';

function clientFor(camera, options = {}) {
  return new DvripClient({
    host: '192.168.1.50',
    socketFactory: camera.socketFactory,
    timeoutMs: 500,
    ...options,
  });
}

test('connect logs in with the Sofia hash and reads the session', async () => {
  const camera = createFakeCamera({ password: 'secret' });
  const client = clientFor(camera, { password: 'secret' });
  try {
    const { aliveInterval } = await client.connect();
    assert.equal(aliveInterval, 20);
    assert.equal(client.session, 0x1a);
    const [login] = camera.received(MESSAGES.LOGIN);
    assert.equal(login.body.UserName, 'admin');
    assert.equal(login.body.EncryptType, 'MD5');
    assert.notEqual(login.body.PassWord, 'secret', 'the password never travels in clear');
  } finally {
    client.close();
  }
});

test('a wrong password is refused with the reason, and closes the session', async () => {
  const camera = createFakeCamera({ password: 'secret' });
  const client = clientFor(camera, { password: 'wrong' });
  await assert.rejects(client.connect(), (err) => {
    assert.ok(err instanceof DvripError);
    assert.match(err.message, /wrong password/);
    return true;
  });
  assert.equal(client.connected, false);
});

test('an unreachable camera fails the connection', async () => {
  const client = clientFor(createFakeCamera({ reachable: false }));
  await assert.rejects(client.connect(), /ECONNREFUSED/);
});

test('getSystemInfo returns the serial number', async () => {
  const camera = createFakeCamera({ serial: 'XYZ' });
  const client = clientFor(camera);
  try {
    await client.connect();
    const info = await client.getSystemInfo();
    assert.equal(info.SerialNo, 'XYZ');
  } finally {
    client.close();
  }
});

test('a move is a start then a stop of the same OPPTZControl command', async () => {
  const camera = createFakeCamera();
  const client = clientFor(camera);
  try {
    await client.connect();
    await client.startMove(PTZ_COMMANDS.LEFT, { speed: 3 });
    await client.stopMove(PTZ_COMMANDS.LEFT, { speed: 3 });
    assert.deepEqual(
      camera.ptz.map((ptz) => [ptz.Command, ptz.Parameter.Preset, ptz.Parameter.Step]),
      [
        ['DirectionLeft', PTZ_START, 3],
        ['DirectionLeft', PTZ_STOP, 3],
      ],
    );
  } finally {
    client.close();
  }
});

test('concurrent requests are serialized, each gets its own answer', async () => {
  const camera = createFakeCamera();
  const client = clientFor(camera);
  try {
    await client.connect();
    const [info, ptz] = await Promise.all([
      client.getSystemInfo(),
      client.ptz(PTZ_COMMANDS.GOTO_PRESET, { preset: 2 }),
    ]);
    assert.equal(info.SerialNo, 'A1B2C3D4E5F60718');
    assert.equal(ptz.Name, 'OPPTZControl');
    assert.equal(camera.ptz[0].Parameter.Preset, 2);
  } finally {
    client.close();
  }
});

test('snapshot returns the JPEG, or a DvripError when the firmware has none', async () => {
  const withSnap = createFakeCamera();
  const client = clientFor(withSnap);
  try {
    await client.connect();
    assert.deepEqual(await client.snapshot(), TINY_JPEG);
  } finally {
    client.close();
  }

  const withoutSnap = createFakeCamera({ snapshot: null });
  const other = clientFor(withoutSnap);
  try {
    await other.connect();
    await assert.rejects(other.snapshot(), DvripError);
    // The session survives a refused command.
    assert.equal((await other.getSystemInfo()).SerialNo, 'A1B2C3D4E5F60718');
  } finally {
    other.close();
  }
});

test('alarm events are emitted, and do not disturb the pending request', async () => {
  const camera = createFakeCamera();
  const client = clientFor(camera);
  const alarms = [];
  client.on('alarm', (alarm) => alarms.push(alarm));
  try {
    await client.connect();
    await client.subscribeAlarms();
    camera.sendAlarm('VideoMotion', 'Start');
    const info = await client.getSystemInfo();
    await flush();
    assert.equal(info.SerialNo, 'A1B2C3D4E5F60718');
    assert.deepEqual(alarms, [
      { channel: 0, event: 'VideoMotion', status: 'Start', startTime: '2026-10-17 10:00:00' },
    ]);
  } finally {
    client.close();
  }
});

test('a request without answer times out and closes the session', async () => {
  const camera = createFakeCamera({ silent: true });
  const client = clientFor(camera, { timeoutMs: 50 });
  let closed = false;
  client.on('close', () => {
    closed = true;
  });
  await client.connect();
  await assert.rejects(client.getSystemInfo(), /did not answer/);
  assert.ok(closed);
  await assert.rejects(client.getSystemInfo(), /Not connected/);
});

test('a connection dropped by the camera rejects the pending request', async () => {
  const camera = createFakeCamera({ silent: true });
  const client = clientFor(camera, { timeoutMs: 1000 });
  await client.connect();
  const pending = client.getSystemInfo();
  camera.drop();
  await assert.rejects(pending, /closed/);
  assert.equal(client.connected, false);
});
