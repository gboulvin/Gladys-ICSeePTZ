# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the camera model and firmware version, when the problem involves one;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the cameras themselves: the weaknesses of the iCSee / XMEye firmwares
(DVRIP protocol, default credentials...) belong to their manufacturer. Keep
the cameras on your local network, never expose their ports (34567, 554) to
the internet, and set a device password in the iCSee app.

## How the integration handles your credentials

- The camera password is a `secret` field: Gladys stores it and never sends
  it back to the browser.
- It travels to the cameras as the DVRIP login hash, over your local network
  only, and in the RTSP URL when the image comes from the stream (the
  firmware protocol offers nothing better). It is never logged.
- The only file the integration writes is `/data/cameras.json` (the address,
  serial number and model of each camera): no credential.
