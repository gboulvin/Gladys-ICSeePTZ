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
  assert.match(message.en, /192\.168\.1\.50: OK \(IPC-PTZ-3MP, serial A1B2C3D4E5F60718\)/);
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

test('discover_cameras broadcasts the DVRIP search and lists the answers', async () => {
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
        {
          source_ip: '192.168.1.50',
          source_port: DISCOVERY_PORT,
          payload_base64: reply('0x3201A8C0'),
        },
        { source_ip: '192.168.1.7', source_port: DISCOVERY_PORT, payload_base64: 'Z2FyYmFnZQ==' },
      ],
    },
  });
  const message = await ACTIONS.discover_cameras(gladys, { config: normalizeConfig({}) });
  assert.match(message.en, /Found 1 camera\(s\): 192\.168\.1\.50\./);
  const [scan] = gladys.fake.scans;
  assert.equal(scan.type, 'udp-active-broadcast');
  assert.equal(scan.port, DISCOVERY_PORT);
});

test('discover_cameras without answer points to the iCSee app', async () => {
  const message = await ACTIONS.discover_cameras(createFakeGladys(), {});
  assert.match(message.en, /No camera answered/);
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
