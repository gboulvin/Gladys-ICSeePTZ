# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the motorized **iCSee / XMEye**
cameras (Xiongmai firmwares): a Node.js service (Node 22+, ESM, no build step)
running in its own sandboxed Docker container. It talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the cameras **locally** with their DVRIP
protocol (TCP 34567), implemented in `src/dvrip/` with Node built-ins only.
`ffmpeg` (in the Docker image) shrinks the images and reads the RTSP stream.
It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/camera.test.js           # one file
node --test --test-name-pattern "preset"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/dvrip/protocol.js             DVRIP framing, login hash, discovery packets (pure, no I/O)
src/dvrip/client.js               one TCP session: login, serialized requests, alarms, keepalive
src/camera.js                     Camera (reconnection, moves + watchdog, captures, detections)
                                  and CameraManager (config diff, identity store, events)
src/devices.js                    Gladys device model (image, move, preset, motion) + onSetValue
src/image.js                      ffmpeg: fit the 150 KB limit, RTSP fallback capture
src/scenes.js                     scene triggers (keys, event data) and scene actions
src/widgets.js                    dashboard widgets (camera_control, camera_presets)
src/actions.js                    manifest actions (test, network search, restart)
src/discovery.js                  network search: subnet parsing, TCP sweep of port 34567
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + parsing
src/i18n.js                       every user-facing message, in en / fr / de / es
src/store.js                      known cameras (address -> serial) in /data/cameras.json
gladys-assistant-integration.json manifest
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (en + fr mandatory)
test/                             node --test; helpers/fakeCamera.js is an in-memory DVRIP camera
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** A camera device id is
  `gladys.externalIds('camera', <serial number>)`, never the IP address (it
  changes with DHCP). Feature keys (`image`, `move`, `preset`, `motion`),
  manifest `config_schema` / `actions` keys, scene trigger and action keys,
  widget keys and their output / variable keys are stored by users: never
  rename one.
- **PTZ safety (MUST).** Every movement is bounded by the watchdog of
  `Camera.move` (`MAX_MOVE_SECONDS`, 5 s): a lost stop must never leave a
  motor running. Do not add a code path that sends a DVRIP start without it.
  Movement values follow the Gladys `CAMERA_MOVE` enum (0 stop, 1-6).
- **One request in flight per session.** The firmware answers in order with
  no request id: `DvripClient.request` serializes, and a timeout closes the
  session. Keep it that way.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log passwords, tokens or the RTSP URL (it carries
  the credentials): `redact()` in `src/image.js`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all
  three together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the release moves the section.
- **Four languages.** Every user-facing text exists in English, French,
  German and Spanish: manifest texts (`{ "en", "fr", "de", "es" }`, never a
  plain string), messages in `src/i18n.js` (`t(key, vars)`), widget texts,
  and `docs/<lang>.md`. `test/i18n.test.js` fails on a missing language or a
  placeholder mismatch.
- **Manifest.** The catalog `description` holds 10 to 100 characters per
  language; widget labels 3 to 30. `scene_triggers`, `scene_actions` and
  `widgets` require `gladys_version` >= 5.1.0. The manifest declares
  `"transports": ["local"]`: the integration has no cloud path. Change the
  manifest and its handlers together (`test/manifest.test.js`).
- **Widgets.** Validate every content with `validateWidgetContent` in the
  tests (`[]` expected): button action keys must be unique in a content.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network: use `createFakeCamera()` and
  the SDK fake Gladys.
