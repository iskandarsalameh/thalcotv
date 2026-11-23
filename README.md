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
- **Sidebar navigation** in the tvOS manner: the current section rests as a
  small pill in the top corner and opens into a sidebar (Search, Home, Movies,
  Series, Library, Settings) when you move onto it, press Left at a page's
  edge, or press Back. On every screen opened on top of a section (title
  pages, sources, add-ons, the player) the same corner holds a Back pill.
- **Add-ons** like Stremio, under Settings: browse the community catalog,
  install by URL, reorder by priority, uninstall.
- **Add from your phone.** The TV shows a QR code; scan it, paste an add-on
  link on the page that opens, confirm on the TV. Add-ons that need setting up
  send the phone to their setup page first. The link is encrypted on the phone
  and decrypted on the TV, so the relay in between never sees it.
- **Keyboard with Dictate.** Letters and numbers on separate pages, bare keys
  that only light up under focus, plus a Dictate key that hands over to voice
  input (the system keyboard listens while the remote's microphone button is
  held).
- **Liquid glass, used sparingly.** Only the control layer that floats above
  content is glass: the navigation pill and sidebar, Back, action buttons,
  filters, player controls, menus and alerts. They blur and brighten what is
  behind them and carry a specular rim and soft shadow. Content (rows, cards,
  lists, fields, keys) stays plain, and nothing inside a glass panel is glass.
  Settings > Reduce Transparency switches the blur off if the stick's GPU
  finds it heavy.
- **Motion.** Screens dissolve forward and settle back, the tab selection
  glides, content fades in as it arrives. Everything animates on the GPU
  (transform and opacity only), lasts under a third of a second, and never
  blocks input: the next screen is live from its first frame. Reduce Motion in
  Settings turns it off.
- **Smart source selection.** Streams from all add-ons are ranked for this
  device (formats it decodes natively first, then quality, your audio language,
  file size, the release used for the previous episode). Play starts the best
  one; if it fails or stalls the next one takes over at the same position.
- **Watch tracking.** Automatic: resume points per movie and per episode,
  Continue Watching, watched marks (70% rule, as in Stremio), next episode
  lined up, Up Next countdown. Manual corrections live in the hold-Select menu.
- **Trailers.** A Trailer button on title pages plays the official trailer
  inside Thalco TV's own player: it opens on the title's artwork, fades into
  the trailer, uses the same scrubber, buttons and Back pill as films, and
  fades back to the title page just before the end. Trailer ids come from the
  title's metadata (Cinemeta). The picture is YouTube's embedded player with
  all of its own interface kept off screen; if a trailer refuses to play
  embedded, the next one for that title is tried.
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
- Trailers need the published interface: YouTube's embedded player does not
  run from the copy packaged inside the app. "Open in browser" sources are
  listed but cannot be played.
- Adding from a phone needs the interface to be published (the phone page is
  part of it) and uses the public relay ntfy.sh to carry the encrypted link.
  If either is unavailable, Add by URL still works.
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
