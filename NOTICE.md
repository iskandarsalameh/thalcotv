# Notices

Thalco TV is an original implementation. It interoperates with third-party
services through the publicly documented Stremio add-on protocol.

## Behavioural references

The following MIT-licensed projects were studied for protocol details and
expected behaviour (watched thresholds, continue-watching rules, streaming
server endpoints). No source code from them is included.

- stremio-core, Copyright (c) Smart Code OOD. https://github.com/Stremio/stremio-core
- stremio-video, Copyright (c) Smart Code OOD. https://github.com/Stremio/stremio-video
- stremio-addon-sdk, Copyright (c) Smart Code OOD. https://github.com/Stremio/stremio-addon-sdk

"Stremio" is a trademark of its owner. Thalco TV is not affiliated with or
endorsed by Stremio or Smart Code OOD.

## Bundled open-source software

- Preact and @preact/signals (MIT)
- Phosphor Icons (MIT), https://phosphoricons.com
- qrcode-generator (MIT)
- Inter typeface (SIL Open Font License 1.1)
- IBM Plex Sans Arabic typeface (SIL Open Font License 1.1)
- hls.js (Apache-2.0)
- React Native for Vega and Amazon's Vega libraries (see their licenses in `vega/node_modules`)

## Default add-ons

On first start two add-ons are installed, both operated by their own
providers: Cinemeta (catalogs and metadata) and OpenSubtitles v3 (subtitles).
Neither provides streams.

## Third-party service

Adding an add-on from a phone passes one small encrypted message through the
public relay at https://ntfy.sh. The encryption key never leaves the phone and
the TV, and nothing is sent unless the pairing screen is used.
