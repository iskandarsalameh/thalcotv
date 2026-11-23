# Thalco TV

A media center for the **Amazon Fire TV Stick 4K Select** (Vega OS), built for the
remote and styled after the tvOS design guidelines. It speaks the
[Stremio add-on protocol](https://github.com/Stremio/stremio-addon-sdk), so any
Stremio add-on works in it: catalogs, metadata, streams and subtitles all come
from the add-ons you install. No account or sign-in.

## How it is put together

```
web/    The interface: TypeScript + Preact, about 55 kB gzipped.
        Published to GitHub Pages on every push.
vega/   The Vega OS shell that becomes the .vpkg. A WebView that loads the
        published interface, plus the few things a web page cannot do.
```

The package on the stick is a thin shell. On every launch it loads the
interface from this repository's GitHub Pages site, so **pushing to the
repository updates the app**: no rebuild, no reinstall. While the app stays
open it also checks for a newer build every 20 minutes and reloads when idle.
If the hosted interface cannot be reached, the shell starts the copy that was
packaged inside the `.vpkg`, so the app always opens.

Only changes under `vega/` (the shell itself) need a new `.vpkg`.

## Features

- **Remote first.** Every control is reachable with the D-pad. Focus is shown
  by lift and a light fill, rows remember where you were, Back always goes up
  one level, holding Select opens options.
- **Home, Movies, Series, Library, Search, Add-ons, Settings** in a top tab bar
  that gets out of the way when you scroll.
- **Add-ons** like Stremio: browse the community catalog, install by URL with
  the on-screen keyboard, reorder by priority, uninstall.
- **Smart source selection.** Streams from all add-ons are ranked for this
  device (formats it decodes natively first, then quality, your audio language,
  file size, the release used for the previous episode). Play starts the best
  one; if it fails or stalls the next one takes over at the same position.
- **Watch tracking.** Resume points per movie and per episode, Continue
  Watching, watched marks (70% rule, as in Stremio), next episode lined up
  automatically, Up Next countdown, mark watched/unwatched by episode, season
  or title.
- **Library** with sort (recently watched, added, title, year, most watched)
  and filters (in progress, watched, not watched, by type).
- **Languages.** Interface in English, Arabic (right to left), Spanish, French,
  German and Portuguese. Preferred audio and
  subtitle languages, audio track switching, subtitles from add-ons and from
  the stream, legacy text encodings (Arabic, Cyrillic, Greek and more) decoded
  correctly, adjustable size, colour, style, position and timing offset.
- **Native player fallback.** Files the WebView cannot decode (Matroska,
  Dolby audio) are handed to the platform media player, with progress still
  tracked.
- **Optional streaming server.** Point it at a Stremio streaming server on your
  network to add torrent sources and on-the-fly conversion.

## Install on the stick

See [docs/INSTALL.md](docs/INSTALL.md). In short: download
`thalcotv_armv7.vpkg` from the repository's Releases page (built by the
"Build vpkg" workflow) and sideload it with the Vega developer tools.

## One-time setup for automatic updates

1. Repository **Settings > Pages > Build and deployment > Source: GitHub Actions**.
   (GitHub Pages on a private repository needs a paid GitHub plan; on the free
   plan the repository has to be public.)
2. Push, or run the "Publish interface" workflow. The interface is then served
   at `https://<owner>.github.io/<repo>/`, which is the address in
   `vega/src/config.ts`.

To host the interface elsewhere, set the repository variable `THALCO_APP_URL`
and rebuild the package.

## Development

```bash
cd web
npm install
npm run dev
```

Open the printed address in a desktop browser. Arrow keys are the D-pad, Enter
is Select (hold it for options), Escape is Back, and a mouse works too.

```bash
npm test
npm run build
```

Building the package needs the Vega SDK (Linux or macOS):

```bash
cd web && npm ci && npm run build:embedded
cd ../vega && npm install && npm run build:release
```

The result is `vega/build/armv7-release/thalcotv_armv7.vpkg`.

## What to know

- Thalco TV hosts no content. What you can watch depends entirely on the
  add-ons you install, and you are responsible for using add-ons and sources
  you have the right to use.
- Torrent sources need a streaming server on your network (Settings >
  Streaming Server); the stick cannot run one itself.
- YouTube and "open in browser" sources are listed but cannot be played.
- Configurable add-ons are set up in a browser on a phone or computer; the
  resulting install link is then entered with Add by URL.
- In the native player (used for Matroska and Dolby audio files) subtitles
  follow your preferred subtitle language and can be toggled, but there is no
  audio-track or speed menu yet.
- The shell and native player were built against Amazon's SDK in CI but could
  not be run on hardware from here: the first launch on a real stick is the
  first real test of that layer.

## Credits

Thalco TV is an independent project. It is compatible with the Stremio add-on
protocol and its watch-tracking rules follow the behaviour of Stremio's
open-source core, but it shares no code or branding with Stremio and is not
affiliated with it. See [NOTICE.md](NOTICE.md).
