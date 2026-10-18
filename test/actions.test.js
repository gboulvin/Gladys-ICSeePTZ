import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS } from '../src/actions.js';
import { normalizeConfig } from '../src/config.js';
import { DvripClient } from '../src/dvrip/client.js';
import { DISCOVERY_PORT, MESSAGES, encodePacket } from '../src/dvrip/protocol.js';
import { idsOf } from '../src/devices.js';
import { createFakeCamera } from './helpers/fakeCamera.js';
import { stubCamera, stubManager } from './helpers/stubs.js';

test('test_connection reports every camera, reachable or not', async () => {
  const good = createFakeCamera();
  const bad = createFakeCamera({ reachable: false });
  const clientFactory = (options) =>
    new DvripClient({
      ...options,
      socketFactory: options.host === '192.168.1.50' ? good.socketFactory : bad.socketFactory,
    });
  const message = await ACTIONS.test_connection(createFakeGladys(), {
    config: normalizeConfig({ hosts: '192.168.1.50, 192.168.1.51, bad/host' }),
    deps: { clientFactory },
  });
  assert.match(message.en, /^1 of 2 camera\(s\) reachable\./);
  assert.match(
    message.en,
    /192\.168\.1\.50: OK \(IPC-PTZ-3MP, serial A1B2C3D4E5F60718, 1 video channel\(s\)\)/,
  );
  assert.match(message.en, /192\.168\.1\.51: unreachable/);
  assert.match(message.en, /Ignored invalid addresses: bad\/host/);
  assert.match(message.fr, /caméra\(s\) joignable\(s\)/);
});

test('test_connection without camera explains what to do', async () => {
  const message = await ACTIONS.test_connection(createFakeGladys(), {
    config: normalizeConfig({}),
    deps: {},
  });
  assert.match(message.en, /No camera configured/);
});

test('discover_cameras merges the UDP answers and the TCP sweep, and names the models', async () => {
  const reply = (ip) =>
    encodePacket({
      messageId: MESSAGES.DISCOVERY_REPLY,
      payload: { 'NetWork.NetCommon': { HostIP: ip, TCPPort: 34567, SN: 'X' }, Ret: 100 },
    }).toString('base64');
  const gladys = createFakeGladys({
    scanResults: {
      'udp-active-broadcast': [
        {
          source_ip: '192.168.1.50',
          source_port: DISCOVERY_PORT,
          payload_base64: reply('0x3201A8C0'),
        },
        { source_ip: '192.168.1.7', source_port: DISCOVERY_PORT, payload_base64: 'Z2FyYmFnZQ==' },
      ],
    },
  });
  // The TCP sweep finds the UDP camera again, plus one the UDP search missed.
  const probe = async (host) => host === '192.168.1.50' || host === '192.168.1.61';
  const camera = createFakeCamera({ model: 'X6E-WEQ' });
  const clientFactory = (options) =>
    new DvripClient({ ...options, socketFactory: camera.socketFactory });
  const message = await ACTIONS.discover_cameras(gladys, {
    fields: {},
    config: normalizeConfig({ hosts: '192.168.1.50' }),
    deps: { probe, clientFactory },
  });
  assert.equal(
    message.en,
    'Found 2 camera(s): 192.168.1.50 (X6E-WEQ) (already configured), 192.168.1.61 (X6E-WEQ). ' +
      'Copy the new ones into the "Camera addresses" field and save.',
  );
  assert.match(message.fr, /\(déjà configurée\)/);
  const [scan] = gladys.fake.scans;
  assert.equal(scan.type, 'udp-active-broadcast');
  assert.equal(scan.port, DISCOVERY_PORT);
});

test('discover_cameras scans the network the user typed', async () => {
  const probed = new Set();
  const probe = async (host) => {
    probed.add(host);
    return false;
  };
  const message = await ACTIONS.discover_cameras(createFakeGladys(), {
    fields: { subnet: '10.0.0.0/24' },
    config: normalizeConfig({ hosts: '192.168.1.50' }),
    deps: { probe },
  });
  assert.ok(probed.has('10.0.0.1') && !probed.has('192.168.1.1'));
  assert.match(message.en, /No camera answers on port 34567 in 10\.0\.0\.0\/24/);
});

test('discover_cameras without camera nor network asks for the network', async () => {
  const message = await ACTIONS.discover_cameras(createFakeGladys(), {
    fields: {},
    config: normalizeConfig({}),
    deps: {},
  });
  assert.match(message.en, /Network to scan/);
  const invalid = await ACTIONS.discover_cameras(createFakeGladys(), {
    fields: { subnet: '10.0.0.0/8' },
    config: normalizeConfig({}),
    deps: {},
  });
  assert.match(invalid.en, /is not a network the search can scan/);
});

test('test_connection tells how many video channels the camera has', async () => {
  const camera = createFakeCamera({ channels: 2 });
  const message = await ACTIONS.test_connection(createFakeGladys(), {
    config: normalizeConfig({ hosts: '192.168.1.50' }),
    deps: {
      clientFactory: (options) =>
        new DvripClient({ ...options, socketFactory: camera.socketFactory }),
    },
  });
  assert.match(message.en, /2 video channel\(s\)/);
});

test('reboot_camera restarts the chosen camera', async () => {
  const gladys = createFakeGladys();
  const camera = stubCamera();
  const manager = stubManager([camera]);
  const message = await ACTIONS.reboot_camera(gladys, {
    fields: { device: idsOf(gladys, camera).device },
    manager,
  });
  assert.match(message.en, /restarting/);
  assert.deepEqual(camera.calls, [['reboot']]);

  const offline = stubCamera({ online: false });
  const answer = await ACTIONS.reboot_camera(gladys, {
    fields: { device: idsOf(gladys, offline).device },
    manager: stubManager([offline]),
  });
  assert.match(answer.en, /offline/);
});
