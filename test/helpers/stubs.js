// -----------------------------------------------------------------------------
// Stand-ins for the camera runtime, for the tests of the Gladys-facing modules
// (devices, scenes, widgets, actions): they record the calls instead of
// talking DVRIP.
// -----------------------------------------------------------------------------

import { platformIdOf } from '../../src/camera.js';
import { TINY_JPEG } from './fakeCamera.js';

export function stubCamera({
  host = '192.168.1.50',
  serial = 'A1B2C3D4E5F60718',
  model = 'IPC-PTZ-3MP',
  online = true,
  withImage = true,
} = {}) {
  const calls = [];
  return {
    host,
    port: 34567,
    serial,
    model,
    online,
    platformId: platformIdOf(serial),
    info: { serial, model, firmware: 'V5.00' },
    detection: { active: false, kind: null, at: null },
    lastImage: withImage ? { jpeg: TINY_JPEG, hash: '0123456789', at: new Date() } : null,
    calls,
    async move(move, seconds) {
      calls.push(['move', move, seconds]);
      return { done: Promise.resolve() };
    },
    async moveFor(move, seconds) {
      calls.push(['moveFor', move, seconds]);
    },
    async gotoPreset(slot) {
      calls.push(['gotoPreset', slot]);
    },
    async savePreset(slot) {
      calls.push(['savePreset', slot]);
    },
    async reboot() {
      calls.push(['reboot']);
    },
    async captureJpeg() {
      calls.push(['captureJpeg']);
      return TINY_JPEG;
    },
  };
}

export function stubManager(cameras) {
  return {
    identified: () => cameras,
    all: () => cameras,
    findByPlatformId: (platformId) =>
      cameras.find((camera) => camera.platformId === platformId) ?? null,
  };
}
