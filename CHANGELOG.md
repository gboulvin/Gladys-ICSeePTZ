# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Dual-lens cameras (X6E-WEQ...): the image holding both lenses, one above
  the other, is detected and split. The camera device becomes the PTZ lens,
  and a new "fixed lens" device carries the image of the fixed lens. The
  "Dual-lens cameras" setting says where the fixed lens is, or turns the split
  off. One capture feeds both images.

## [1.1.0] - 2026-10-18

### Fixed

- "Search the network" missed the cameras that answer the iCSee broadcast
  search by broadcast: it now also tries the camera port (34567) on every
  address of the network, the one typed in the new "Network to scan" field or
  the network of the configured cameras, and names the model of each camera
  found.

### Added

- "Test the cameras" tells how many video channels each camera has (2 on the
  dual-lens models).

## [1.0.0] - 2026-10-17

### Added

- Local control of the iCSee / XMEye cameras through their native DVRIP
  protocol (TCP 34567): no cloud account needed.
- Camera image in Gladys, pushed at a configurable interval and captured on
  demand; firmware snapshot with an automatic fallback to the RTSP stream,
  re-encoded to fit the 150 KB Gladys accepts.
- Pan / tilt (and optional zoom) through the Gladys camera `move` feature,
  every movement bounded by a watchdog (5 s at most).
- Presets: recall from the device, the dashboard and the scenes; save from a
  scene.
- Motion and person detection: a motion sensor feature and the
  "iCSee camera: detection" scene trigger.
- "iCSee camera: online / offline" scene trigger.
- Scene actions: move a camera, go to a preset, save a preset, refresh the
  image, restart a camera.
- Dashboard widgets "iCSee PTZ control" (image, status, arrows) and
  "iCSee presets".
- Configuration buttons: test the cameras, search the network (DVRIP
  broadcast through Gladys), restart a camera.
- Cloud / local transport badge: local while the session is up, unreachable
  otherwise.
- English, French, German and Spanish texts and user documentation.
- `SECURITY.md`, `CLAUDE.md`, CI on Node 22 and 24, release workflows.

[Unreleased]: https://github.com/gboulvin/Gladys-ICSeePTZ/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/gboulvin/Gladys-ICSeePTZ/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/gboulvin/Gladys-ICSeePTZ/releases/tag/v1.0.0
