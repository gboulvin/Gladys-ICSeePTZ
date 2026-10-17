// -----------------------------------------------------------------------------
// Known cameras, persisted in /data (the only writable path of the container).
//
// A device external id is built from the camera serial number, which only a
// logged-in session reveals. Remembering "address -> serial, model" lets the
// integration keep publishing a camera that is offline at startup (Gladys
// then shows it unreachable instead of losing it from the discovery list),
// and recognize a camera whose DHCP address changed.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export function dataDir() {
  return process.env.ICSEE_DATA_DIR ?? '/data';
}

function storePath() {
  return join(dataDir(), 'cameras.json');
}

/**
 * @returns {Promise<Record<string, { serial: string, model?: string, name?: string }>>}
 *   keyed by "host:port"
 */
export async function loadKnownCameras() {
  try {
    const parsed = JSON.parse(await readFile(storePath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(`Cannot read ${storePath()}, starting from scratch: ${err.message}`);
    }
    return {};
  }
}

/**
 * Write atomically (temp file + rename): a crash never leaves half a file.
 * @param {Record<string, object>} cameras
 */
export async function saveKnownCameras(cameras) {
  try {
    await mkdir(dataDir(), { recursive: true });
    const tmp = `${storePath()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(cameras, null, 2)}\n`, 'utf8');
    await rename(tmp, storePath());
  } catch (err) {
    // Not fatal: the cameras are re-identified at the next connection.
    logger.warn(`Cannot write ${storePath()}: ${err.message}`);
  }
}
