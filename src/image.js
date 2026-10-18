// -----------------------------------------------------------------------------
// Camera images: capture and size limits.
//
// Gladys accepts camera images of at most 150 KB, as an
// `image/jpg;base64,...` string (the base64 text counts, not the JPEG bytes),
// and widget images of at most 300 KB decoded. A 1080p/4 MP iCSee snapshot is
// often bigger: ffmpeg (bundled in the Docker image) re-encodes it smaller,
// lowering the size then the quality until it fits.
//
// ffmpeg is also the fallback capture path for the firmwares without OPSNAP:
// it grabs one frame of the camera RTSP sub-stream.
//
// `runFfmpeg` is injectable so the tests never spawn a process.
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';

export const IMAGE_PREFIX = 'image/jpg;base64,';

// POST /camera/image limit, on the whole string (SDK: MAX_CAMERA_IMAGE_SIZE).
export const MAX_CAMERA_IMAGE_SIZE = 150 * 1024;

// Widget images: at most 300 KB decoded.
export const MAX_WIDGET_IMAGE_BYTES = 300 * 1024;

// Largest JPEG whose base64 string, prefix included, fits the 150 KB limit.
// Base64 turns every started group of 3 bytes into 4 characters.
export const MAX_JPEG_BYTES = Math.floor((MAX_CAMERA_IMAGE_SIZE - IMAGE_PREFIX.length) / 4) * 3;

// Re-encoding attempts, best first: width in pixels, ffmpeg JPEG quality
// (2 = best, 31 = worst).
const ATTEMPTS = [
  { width: 1280, quality: 5 },
  { width: 1280, quality: 9 },
  { width: 960, quality: 9 },
  { width: 800, quality: 12 },
  { width: 640, quality: 14 },
  { width: 480, quality: 18 },
];

const FFMPEG_TIMEOUT_MS = 12_000;

/**
 * Run ffmpeg, feed it `input` on stdin, resolve its stdout.
 * @param {string[]} args
 * @param {Buffer} [input]
 * @returns {Promise<Buffer>}
 */
export function spawnFfmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ffmpeg timed out'));
    }, FFMPEG_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-500);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg could not start: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        // The RTSP URL carries the password: never echo ffmpeg's arguments,
        // and strip credentials from what it printed.
        reject(new Error(`ffmpeg failed (${code}): ${redact(stderr.trim())}`));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? null);
  });
}

/**
 * Hide the credentials of the URLs in a text.
 * @param {string} text
 */
export function redact(text) {
  return text
    .replace(/\/\/[^/@\s]*@/g, '//***@')
    .replace(/password=[^&\s]*/gi, 'password=***')
    .replace(/user=[^&\s]*/gi, 'user=***');
}

// ffmpeg crop filter of each half of a stacked dual-lens frame.
const CROPS = {
  top: 'crop=iw:ih/2:0:0',
  bottom: 'crop=iw:ih/2:0:ih/2',
};

/**
 * Make a JPEG fit `maxBytes`, re-encoding it smaller when needed. With
 * `crop`, keep only one half of a stacked dual-lens frame: the crop and the
 * resize share the same ffmpeg run, so splitting costs no extra pass.
 * @param {Buffer} jpeg
 * @param {object} [options]
 * @param {'top'|'bottom'} [options.crop]
 * @param {number} [options.maxBytes]
 * @param {Function} [options.runFfmpeg]
 * @returns {Promise<Buffer>}
 */
export async function fitJpeg(
  jpeg,
  { crop, maxBytes = MAX_JPEG_BYTES, runFfmpeg = spawnFfmpeg } = {},
) {
  if (!crop && jpeg.length <= maxBytes) {
    return jpeg;
  }
  if (crop && !CROPS[crop]) {
    throw new Error(`Unknown crop ${crop}`);
  }
  for (const { width, quality } of ATTEMPTS) {
    const filters = [...(crop ? [CROPS[crop]] : []), `scale='min(${width},iw)':-2`];
    const resized = await runFfmpeg(
      [
        '-f',
        'image2pipe',
        '-i',
        'pipe:0',
        '-vf',
        filters.join(','),
        '-q:v',
        String(quality),
        '-frames:v',
        '1',
        '-f',
        'image2',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ],
      jpeg,
    );
    if (resized.length <= maxBytes) {
      return resized;
    }
  }
  throw new Error(`The image does not fit in ${Math.round(maxBytes / 1024)} KB`);
}

// JPEG start-of-frame markers (baseline, progressive...): they carry the size.
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Pixel size of a JPEG, read from its start-of-frame segment (no decoding).
 * @param {Buffer} jpeg
 * @returns {{ width: number, height: number }|null}
 */
export function jpegSize(jpeg) {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      return null;
    }
    const marker = jpeg[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    const length = jpeg.readUInt16BE(offset + 2);
    if (SOF_MARKERS.has(marker)) {
      return { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Is this frame two 16:9-ish lenses stacked (taller than wide)? A single
 * lens camera is always wider than tall; the dual-lens iCSee models stream
 * both lenses in one frame, e.g. 2304x2592 = two 2304x1296.
 * @param {{ width: number, height: number }|null} size
 */
export function isStackedDualLens(size) {
  return Boolean(size) && size.height > size.width;
}

/**
 * RTSP URL of an iCSee camera stream (the Xiongmai URL scheme, credentials in
 * the query string). Stream 1 is the sub-stream: smaller, faster to grab.
 * @param {object} camera { host, username, password }
 * @param {number} [stream] 0 main stream, 1 sub-stream
 */
export function rtspUrl({ host, username, password }, stream = 1) {
  const user = encodeURIComponent(username ?? '');
  const pass = encodeURIComponent(password ?? '');
  return `rtsp://${host}:554/user=${user}&password=${pass}&channel=1&stream=${stream}.sdp?real_stream`;
}

/**
 * Grab one frame of the RTSP stream as a JPEG.
 * @param {object} camera { host, username, password }
 * @param {object} [options]
 * @param {Function} [options.runFfmpeg]
 * @returns {Promise<Buffer>}
 */
export function captureRtspFrame(camera, { runFfmpeg = spawnFfmpeg } = {}) {
  return runFfmpeg([
    '-rtsp_transport',
    'tcp',
    '-i',
    rtspUrl(camera),
    '-frames:v',
    '1',
    '-q:v',
    '5',
    '-f',
    'image2',
    '-c:v',
    'mjpeg',
    'pipe:1',
  ]);
}

/**
 * The SDK camera image format.
 * @param {Buffer} jpeg
 */
export function toCameraImage(jpeg) {
  return `${IMAGE_PREFIX}${jpeg.toString('base64')}`;
}
