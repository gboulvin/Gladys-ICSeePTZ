import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CAMERA_IMAGE_SIZE,
  MAX_JPEG_BYTES,
  captureRtspFrame,
  fitJpeg,
  isStackedDualLens,
  jpegSize,
  redact,
  rtspUrl,
  toCameraImage,
} from '../src/image.js';
import { TINY_JPEG, jpegOfSize } from './helpers/fakeCamera.js';

test('a JPEG of MAX_JPEG_BYTES makes a camera image within the 150 KB limit', () => {
  const image = toCameraImage(Buffer.alloc(MAX_JPEG_BYTES));
  assert.ok(image.startsWith('image/jpg;base64,'));
  assert.ok(image.length <= MAX_CAMERA_IMAGE_SIZE);
  assert.ok(toCameraImage(Buffer.alloc(MAX_JPEG_BYTES + 3)).length > MAX_CAMERA_IMAGE_SIZE);
});

test('fitJpeg leaves a small image alone', async () => {
  const runFfmpeg = async () => assert.fail('no re-encoding needed');
  assert.equal(await fitJpeg(TINY_JPEG, { runFfmpeg }), TINY_JPEG);
});

test('fitJpeg re-encodes smaller until the image fits', async () => {
  const sizes = [200_000, 150_000, 90_000];
  const calls = [];
  const runFfmpeg = async (args, input) => {
    calls.push(args);
    assert.equal(input.length, 300_000);
    return Buffer.alloc(sizes.shift());
  };
  const fitted = await fitJpeg(Buffer.alloc(300_000), { maxBytes: 100_000, runFfmpeg });
  assert.equal(fitted.length, 90_000);
  assert.equal(calls.length, 3);
});

test('fitJpeg gives up when nothing fits', async () => {
  const runFfmpeg = async () => Buffer.alloc(500_000);
  await assert.rejects(fitJpeg(Buffer.alloc(500_000), { runFfmpeg }), /does not fit/);
});

test('the RTSP URL escapes the credentials, and redact hides them', () => {
  const url = rtspUrl({ host: '192.168.1.50', username: 'admin', password: 'p&ss word' });
  assert.equal(
    url,
    'rtsp://192.168.1.50:554/user=admin&password=p%26ss%20word&channel=1&stream=1.sdp?real_stream',
  );
  assert.ok(!redact(`failed to open ${url}`).includes('p%26ss'));
  assert.equal(redact('rtsp://u:p@host/x'), 'rtsp://***@host/x');
});

test('captureRtspFrame asks ffmpeg for one frame of the sub-stream', async () => {
  let received;
  const jpeg = await captureRtspFrame(
    { host: '10.0.0.2', username: 'admin', password: '' },
    {
      runFfmpeg: async (args) => {
        received = args;
        return TINY_JPEG;
      },
    },
  );
  assert.equal(jpeg, TINY_JPEG);
  assert.ok(received.includes('-frames:v'));
  assert.ok(received.some((arg) => arg.includes('stream=1.sdp')));
});

test('jpegSize reads the frame size without decoding, and spots a stacked dual-lens frame', () => {
  assert.deepEqual(jpegSize(jpegOfSize(2304, 2592)), { width: 2304, height: 2592 });
  assert.deepEqual(jpegSize(TINY_JPEG), { width: 1, height: 1 });
  assert.equal(jpegSize(Buffer.from('not a jpeg')), null);
  assert.equal(isStackedDualLens({ width: 2304, height: 2592 }), true);
  assert.equal(isStackedDualLens({ width: 2560, height: 1440 }), false);
  assert.equal(isStackedDualLens(null), false);
});

test('fitJpeg crops one half in the same ffmpeg pass, even for a small image', async () => {
  const calls = [];
  const runFfmpeg = async (args) => {
    calls.push(args[args.indexOf('-vf') + 1]);
    return TINY_JPEG;
  };
  await fitJpeg(TINY_JPEG, { crop: 'top', runFfmpeg });
  await fitJpeg(TINY_JPEG, { crop: 'bottom', runFfmpeg });
  assert.equal(calls.length, 2, 'one ffmpeg run per half');
  assert.match(calls[0], /^crop=iw:ih\/2:0:0,scale=/);
  assert.match(calls[1], /^crop=iw:ih\/2:0:ih\/2,scale=/);
  await assert.rejects(fitJpeg(TINY_JPEG, { crop: 'left', runFfmpeg }), /Unknown crop/);
});
