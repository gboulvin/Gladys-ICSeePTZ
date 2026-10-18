# iCSee PTZ — user guide

This integration controls the motorized **iCSee** cameras (also sold under the
XMEye, Xiongmai, Jennov, Hiseeu, Floureon... brands) from Gladys Assistant,
**locally**: Gladys talks to the cameras on your network with their native
protocol (DVRIP, TCP port 34567). No cloud account, no internet connection
needed.

## What you get

- **The camera image** in Gladys: dashboard camera widget, chat ("show me the
  camera"), scenes ("send a camera image").
- **Pan / tilt** (and zoom on the models that have one) from the dashboard,
  the device rows and the scenes. Every movement stops on its own: a lost
  "stop" never leaves the camera turning.
- **Presets**: one tap to point the camera at a saved position.
- **Motion and person detection**: a motion sensor feature, plus a scene
  trigger telling a motion from a person.
- **Two dashboard widgets**: "iCSee PTZ control" (image, status, arrows) and
  "iCSee presets".
- **Scene actions**: move a camera, go to / save a preset, refresh the image,
  restart a camera.
- **Scene triggers**: detection (motion / person), camera online / offline.

## Before you start

1. Pair every camera with the **iCSee** app, on the same network as Gladys.
2. In your router, give each camera a **fixed IP address** (DHCP reservation).
   The integration also recognizes a camera whose address changed, but a
   fixed address avoids any interruption.
3. Note the **device password** you set in the iCSee app (empty if you never
   set one). The username is `admin`.
4. To receive the detections, enable the motion / human detection alarm of
   the camera in the iCSee app.

## Configuration

Open **Integrations → iCSee PTZ → Configuration**:

| Field             | What to enter                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Camera addresses  | The IP addresses, separated by commas: `192.168.1.50, 192.168.1.51`. Add `:port` if it is not 34567.         |
| Username          | `admin`, unless you created another account.                                                                 |
| Password          | The device password of the iCSee app. Leave empty if there is none. All the cameras share these credentials. |
| Image refresh (s) | Seconds between two images sent to Gladys (60 by default, 5 minimum). `0` = only when an image is asked for. |
| Image capture     | `Automatic` uses the camera snapshot, or the RTSP stream when the firmware has no snapshot command.          |
| Move step (s)     | How long a single move command turns the camera (1 s by default).                                            |
| Motor speed (1-8) | Speed of the PTZ motors.                                                                                     |
| Motorized zoom    | Tick it only if your model has an optical zoom.                                                              |
| Presets           | The positions saved on the cameras, as `slot:name`: `1:Entrance, 2:Garden`.                                  |
| Motion detection  | Receive the detections of the cameras.                                                                       |

Save, then use the buttons:

- **Test the cameras** connects to every address and tells which ones answer
  (model and serial number), or why not (wrong password, unreachable...).
- **Search the network** lists the iCSee cameras of your network. It
  broadcasts the iCSee search, then tries port 34567 on every address of the
  network: the one you type in "Network to scan" (e.g. `192.168.1.0/24`), or
  by default the network of the cameras already configured. For your first
  camera, type your network. The address is also shown in the iCSee app
  (Device settings → Network) and in the device list of your router.
- **Restart a camera** restarts the chosen camera.

Then open the **Discovery** tab of the integration and add your cameras.

## Moving the camera

- **Dashboard**: add the "iCSee PTZ control" widget (or the device to a room
  widget). Each arrow turns the camera for the "Move step" duration.
- **Scenes**: the "Move an iCSee camera" action takes a direction and a
  duration (5 s at most). The standard "control a device" action works too
  on the PTZ feature (1 left, 2 right, 3 up, 4 down, 5 zoom in, 6 zoom out,
  0 stop).

Whatever sends it, a movement always stops by itself after 5 seconds at the
latest.

## Presets

A preset is a position stored **in the camera**. To create one:

1. turn the camera to the position you want (widget, iCSee app);
2. run a scene with the **Save an iCSee preset** action and a slot number
   (1 to 255), or save it from the iCSee app;
3. add `slot:name` to the **Presets** field of the configuration, e.g.
   `1:Entrance`.

The presets then appear on the PTZ feature of the device, in the
"iCSee presets" widget, and the **Go to an iCSee preset** scene action points
the camera at them.

## Scene ideas

- When the alarm turns on, point every camera at the door (go to a preset).
- When a camera detects a person, send its image on Telegram ("Refresh an
  iCSee image", then the core "Send a camera image" action).
- When a camera goes offline for the night, restart it.

## Troubleshooting

- **"wrong password"**: check the device password in the iCSee app; the
  username is `admin`.
- **Unreachable camera**: check the address, that the camera is powered and
  on the same network, and that nothing blocks TCP port 34567.
- **No image**: some firmwares have no snapshot command; the integration then
  uses the RTSP stream (port 554). Force "RTSP stream" in "Image capture" if
  needed.
- **No detection**: enable the detection alarm in the iCSee app, and keep
  "Motion detection" ticked.
- The integration logs are in **Settings → System → Containers** (or
  `docker logs`).

The source code, the issue tracker and the changelog are on
[GitHub](https://github.com/gboulvin/Gladys-ICSeePTZ).
