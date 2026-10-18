// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// Each handler is keyed by the action `key` declared in the manifest
// `actions` field and resolves the multi-language message displayed under the
// button (index.js registers them with `gladys.onAction`).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { DvripClient } from './dvrip/client.js';
import {
  DEFAULT_PORT,
  DISCOVERY_PORT,
  buildDiscoveryRequest,
  parseDiscoveryReply,
} from './dvrip/protocol.js';
import { findCamera } from './devices.js';
import { expandSubnet, subnetsOf, sweep } from './discovery.js';
import { joinMessages, t, truncateMessage } from './i18n.js';

const logger = createLogger({ name: 'actions' });

// The message under a button is short-lived text, not a report.
const MAX_MESSAGE_LENGTH = 1000;

/**
 * Try a fresh session with every configured camera (independent of the
 * running ones, so it also validates new credentials before saving them).
 */
async function testConnection(gladys, { config, deps }) {
  if (config.cameras.length === 0) {
    return t('no_camera_configured');
  }
  const clientFactory = deps.clientFactory ?? ((options) => new DvripClient(options));
  const results = await Promise.all(
    config.cameras.map(async ({ host, port }) => {
      const client = clientFactory({
        host,
        port,
        username: config.username,
        password: config.password,
        timeoutMs: 6_000,
      });
      try {
        const { channels } = await client.connect();
        const info = await client.getSystemInfo();
        return {
          ok: true,
          message: t('camera_ok', {
            host,
            model: info.DeviceModel ?? info.HardWare ?? '?',
            serial: info.SerialNo ?? '?',
            channels,
          }),
        };
      } catch (err) {
        return { ok: false, message: t('camera_error', { host, error: err.message }) };
      } finally {
        client.close();
      }
    }),
  );
  const online = results.filter((result) => result.ok).length;
  const parts = [
    t('test_summary', {
      online,
      total: results.length,
      details: joinMessages(
        results.map((result) => result.message),
        ' · ',
      ),
    }),
  ];
  if (config.invalidHosts.length > 0) {
    parts.push(t('invalid_hosts', { hosts: config.invalidHosts.join(', ') }));
  }
  return truncateMessage(joinMessages(parts), MAX_MESSAGE_LENGTH);
}

// Answers of the DVRIP UDP search relayed by the Gladys core, by address.
async function udpSearch(gladys) {
  const found = new Map();
  let replies;
  try {
    replies = await gladys.scanNetwork('udp-active-broadcast', {
      port: DISCOVERY_PORT,
      payload: buildDiscoveryRequest(),
      timeoutSeconds: 5,
    });
  } catch (err) {
    // Not fatal: the TCP sweep does not depend on it.
    logger.warn(`UDP network search failed: ${err.message}`);
    return found;
  }
  for (const reply of replies ?? []) {
    const camera = parseDiscoveryReply(
      Buffer.from(reply.payload_base64 ?? '', 'base64'),
      reply.source_ip,
    );
    if (camera) {
      found.set(
        camera.port === DEFAULT_PORT ? camera.host : `${camera.host}:${camera.port}`,
        camera,
      );
    }
  }
  return found;
}

// Model of a found camera, when the configured credentials open it.
async function identify(address, config, clientFactory) {
  const [host, port] = address.split(':');
  const client = clientFactory({
    host,
    port: port ? Number(port) : DEFAULT_PORT,
    username: config.username,
    password: config.password,
    timeoutMs: 4_000,
  });
  try {
    await client.connect();
    const info = await client.getSystemInfo();
    return info.DeviceModel ?? info.HardWare ?? null;
  } catch {
    return null;
  } finally {
    client.close();
  }
}

/**
 * Find the cameras of the local network: the DVRIP UDP search through the
 * core, plus a TCP sweep of port 34567 over the subnet the user typed (or
 * the subnets of the configured cameras). See src/discovery.js for why both.
 */
async function discoverCameras(gladys, { fields = {}, config, deps = {} }) {
  const typed = String(fields.subnet ?? '').trim();
  let subnets;
  if (typed) {
    if (!expandSubnet(typed)) {
      return t('discovery_invalid_subnet', { subnet: typed });
    }
    subnets = [typed];
  } else {
    subnets = subnetsOf(config?.cameras ?? []);
  }

  const found = await udpSearch(gladys);
  for (const subnet of subnets) {
    for (const host of await sweep(expandSubnet(subnet), { probe: deps.probe })) {
      if (!found.has(host)) {
        found.set(host, { host, port: DEFAULT_PORT });
      }
    }
  }
  if (found.size === 0) {
    return subnets.length > 0
      ? t('discovery_none_subnet', { subnets: subnets.join(', ') })
      : t('discovery_need_subnet');
  }

  const clientFactory = deps.clientFactory ?? ((options) => new DvripClient(options));
  const configured = new Set(
    (config?.cameras ?? []).map(({ host, port }) =>
      port === DEFAULT_PORT ? host : `${host}:${port}`,
    ),
  );
  const entries = await Promise.all(
    [...found.keys()].map(async (address) => {
      const model = config ? await identify(address, config, clientFactory) : null;
      const parts = [model ? `${address} (${model})` : address];
      if (configured.has(address)) {
        parts.push(t('discovery_configured'));
      }
      return joinMessages(parts);
    }),
  );
  return truncateMessage(
    t('discovery_found', { count: found.size, hosts: joinMessages(entries, ', ') }),
    MAX_MESSAGE_LENGTH,
  );
}

async function rebootCamera(gladys, { fields, manager }) {
  const camera = findCamera(gladys, manager, fields.device);
  if (!camera) {
    return t('unknown_camera');
  }
  if (!camera.online) {
    return t('camera_offline', { name: camera.host });
  }
  try {
    await camera.reboot();
  } catch (err) {
    return t('action_failed', { error: err.message });
  }
  return t('reboot_sent', { name: camera.host });
}

export const ACTIONS = {
  test_connection: testConnection,
  discover_cameras: discoverCameras,
  reboot_camera: rebootCamera,
};
