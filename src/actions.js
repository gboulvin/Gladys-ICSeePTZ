// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// Each handler is keyed by the action `key` declared in the manifest
// `actions` field and resolves the multi-language message displayed under the
// button (index.js registers them with `gladys.onAction`).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { DvripClient } from './dvrip/client.js';
import { DISCOVERY_PORT, buildDiscoveryRequest, parseDiscoveryReply } from './dvrip/protocol.js';
import { findCamera } from './devices.js';
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
        await client.connect();
        const info = await client.getSystemInfo();
        return {
          ok: true,
          message: t('camera_ok', {
            host,
            model: info.DeviceModel ?? info.HardWare ?? '?',
            serial: info.SerialNo ?? '?',
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

/**
 * Broadcast the DVRIP search request (through the Gladys core, the container
 * cannot broadcast on the LAN) and list the cameras that answered.
 */
async function discoverCameras(gladys) {
  let replies;
  try {
    replies = await gladys.scanNetwork('udp-active-broadcast', {
      port: DISCOVERY_PORT,
      payload: buildDiscoveryRequest(),
      timeoutSeconds: 5,
    });
  } catch (err) {
    logger.warn(`Network search failed: ${err.message}`);
    return t('discovery_failed', { error: err.message });
  }
  const found = new Map();
  for (const reply of replies ?? []) {
    const camera = parseDiscoveryReply(
      Buffer.from(reply.payload_base64 ?? '', 'base64'),
      reply.source_ip,
    );
    if (camera) {
      const address = camera.port === 34567 ? camera.host : `${camera.host}:${camera.port}`;
      found.set(address, camera);
    }
  }
  if (found.size === 0) {
    return t('discovery_none');
  }
  return t('discovery_found', { count: found.size, hosts: [...found.keys()].join(', ') });
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
