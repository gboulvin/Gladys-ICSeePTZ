import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts, parsePresets } from '../src/config.js';

test('parseHosts reads addresses with optional ports, any separator, no duplicates', () => {
  assert.deepEqual(parseHosts('192.168.1.50, 192.168.1.51:8000;cam-garage\n192.168.1.50'), {
    cameras: [
      { host: '192.168.1.50', port: 34567 },
      { host: '192.168.1.51', port: 8000 },
      { host: 'cam-garage', port: 34567 },
    ],
    invalid: [],
  });
  assert.deepEqual(parseHosts('http://x, 1.2.3.4:99999').invalid, ['http://x', '1.2.3.4:99999']);
  assert.deepEqual(parseHosts('').cameras, []);
});

test('parsePresets reads slot:name pairs, sorted, unique, bounded', () => {
  assert.deepEqual(parsePresets('2:Garden, 1: Entrance; 3\n2:Dup, 0:Zero, 300:Big, junk'), [
    { value: 1, label: 'Entrance' },
    { value: 2, label: 'Garden' },
    { value: 3, label: 'Preset 3' },
  ]);
  assert.deepEqual(parsePresets(''), []);
});

test('normalizeConfig applies the defaults and the bounds', () => {
  const config = normalizeConfig();
  assert.equal(config.username, DEFAULT_CONFIG.username);
  assert.equal(config.snapshot_interval, 60);
  assert.deepEqual(config.cameras, []);

  const custom = normalizeConfig({
    hosts: '10.0.0.2',
    username: '',
    snapshot_interval: '2',
    move_duration: 50,
    ptz_speed: '0',
    snapshot_source: 'bogus',
    motion_events: false,
    zoom: true,
    presets: '1:Door',
  });
  assert.equal(custom.username, 'admin', 'an empty username falls back to admin');
  assert.equal(custom.snapshot_interval, 5, 'at most 12 images a minute');
  assert.equal(custom.move_duration, 5, 'never more than the 5 s ceiling');
  assert.equal(custom.ptz_speed, 1);
  assert.equal(custom.snapshot_source, 'auto');
  assert.equal(custom.motion_events, false);
  assert.equal(custom.zoom, true);
  assert.deepEqual(custom.presetList, [{ value: 1, label: 'Door' }]);
  assert.equal(
    normalizeConfig({ snapshot_interval: 0 }).snapshot_interval,
    0,
    '0 disables the push',
  );
});
