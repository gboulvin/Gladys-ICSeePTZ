import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandSubnet, subnetsOf, sweep } from '../src/discovery.js';

test('expandSubnet accepts the usual spellings of a /24, and no wider', () => {
  for (const text of ['192.168.1.0/24', '192.168.1.*', '192.168.1.x', '192.168.1', '192.168.1.0']) {
    const addresses = expandSubnet(text);
    assert.equal(addresses.length, 254, text);
    assert.equal(addresses[0], '192.168.1.1');
    assert.equal(addresses.at(-1), '192.168.1.254');
  }
  assert.deepEqual(expandSubnet('10.0.0.64/30'), ['10.0.0.65', '10.0.0.66']);
  assert.deepEqual(expandSubnet('10.0.0.7/32'), ['10.0.0.7']);
  assert.equal(expandSubnet('10.0.0.0/16'), null, 'a /16 would take minutes');
  assert.equal(expandSubnet('300.1.1.0/24'), null);
  assert.equal(expandSubnet('my network'), null);
});

test('subnetsOf derives the /24 of the configured IPv4 cameras', () => {
  assert.deepEqual(
    subnetsOf([{ host: '192.168.1.50' }, { host: '192.168.1.51' }, { host: 'cam.local' }]),
    ['192.168.1.0/24'],
  );
});

test('sweep keeps the addresses with the DVRIP port open, in order', async () => {
  const probed = [];
  const probe = async (host, port) => {
    probed.push(port);
    if (host === '192.168.1.9') {
      throw new Error('boom');
    }
    return host === '192.168.1.50' || host === '192.168.1.7';
  };
  const open = await sweep(expandSubnet('192.168.1.0/24'), { probe });
  assert.deepEqual(open, ['192.168.1.7', '192.168.1.50']);
  assert.equal(probed.length, 254);
  assert.ok(probed.every((port) => port === 34567));
});
