// Collects streams from every installed add-on and ranks them so that the
// first entry is the one most likely to start quickly and play cleanly on
// this device. The player walks down the same list when a source fails.

import type { Addon, LibraryItem, RankedStream, Stream } from './types';
import { addons, fetchJSON, resourceUrl, supportsResource } from './addons';
import { caps, type Caps } from './caps';
import { detectStreamLanguages, normLang } from './langs';
import { settings, type Settings } from './settings';

export function streamText(s: Stream): string {
  return [s.name, s.title, s.description, s.behaviorHints?.filename].filter(Boolean).join('\n');
}

export function parseQuality(text: string): number {
  if (/\b(2160p?|4k|uhd)\b/i.test(text)) return 2160;
  if (/\b1440p?\b|\b2k\b/i.test(text)) return 1440;
  if (/\b(1080[pi]?|fhd|full\s?hd)\b/i.test(text)) return 1080;
  if (/\b(720p?|hd(?:rip|tv)?)\b/i.test(text)) return 720;
  if (/\b(480p?|sd|dvd(?:rip)?)\b/i.test(text)) return 480;
  if (/\b360p?\b/i.test(text)) return 360;
  return 0;
}

export function parseSize(text: string): number {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb|gib|mib)\b/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  const mult = unit.startsWith('t') ? 1024 ** 4 : unit.startsWith('g') ? 1024 ** 3 : 1024 ** 2;
  return Math.round(n * mult);
}

export function parseSeeders(text: string): number {
  const m = text.match(/(?:👤|seeders?:?|\bS:)\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function parseCodec(text: string): RankedStream['codec'] {
  if (/\b(hevc|[xh]\.?265)\b/i.test(text)) return 'hevc';
  if (/\bav1\b/i.test(text)) return 'av1';
  if (/\b(avc|[xh]\.?264)\b/i.test(text)) return 'h264';
  if (/\bvp9\b/i.test(text)) return 'vp9';
  return '';
}

function parseAudio(text: string): string {
  if (/\batmos\b/i.test(text)) return 'Atmos';
  if (/\btrue-?hd\b/i.test(text)) return 'TrueHD';
  if (/\bdts(?:-?(?:hd|x|ma))?\b/i.test(text)) return 'DTS';
  if (/\b(e-?ac-?3|ddp|dd\+|dolby\s?digital\s?plus)\b/i.test(text)) return 'DD+';
  if (/\b(ac-?3|dd\s?5\.1|dolby\s?digital)\b/i.test(text)) return 'DD';
  if (/\baac\b/i.test(text)) return 'AAC';
  if (/\bopus\b/i.test(text)) return 'Opus';
  return '';
}

function parseContainer(s: Stream, text: string): RankedStream['container'] {
  const candidates = [s.behaviorHints?.filename ?? '', s.url ?? ''];
  for (const c of candidates) {
    const clean = c.split(/[?#]/)[0].toLowerCase();
    if (clean.endsWith('.m3u8')) return 'hls';
    if (clean.endsWith('.mpd')) return 'dash';
    if (clean.endsWith('.mp4') || clean.endsWith('.m4v') || clean.endsWith('.mov')) return 'mp4';
    if (clean.endsWith('.mkv')) return 'mkv';
    if (clean.endsWith('.webm')) return 'webm';
    if (clean.endsWith('.avi')) return 'avi';
  }
  if (/\.m3u8\b/i.test(s.url ?? '')) return 'hls';
  if (/\bmkv\b/i.test(text)) return 'mkv';
  if (/\bmp4\b/i.test(text)) return 'mp4';
  return '';
}

function kindOf(s: Stream): RankedStream['kind'] {
  if (typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) return 'http';
  if (typeof s.url === 'string' && /^magnet:/i.test(s.url)) return 'torrent';
  if (s.infoHash) return 'torrent';
  if (s.ytId) return 'youtube';
  if (s.externalUrl) return 'external';
  return 'unknown';
}

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return (gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)) + ' GB';
  return Math.round(bytes / 1024 ** 2) + ' MB';
}

export function qualityLabel(q: number): string {
  if (q >= 2160) return '4K';
  if (q >= 1440) return '1440p';
  if (q >= 1080) return 'HD 1080p';
  if (q >= 720) return 'HD 720p';
  if (q > 0) return q + 'p';
  return '';
}

export interface RankContext {
  caps: Caps;
  settings: Pick<Settings, 'maxQuality' | 'audioLanguage' | 'streamingServerUrl'>;
  last?: LibraryItem['lastStream'];
  /** Add-on order: lower index = higher priority. */
  addonOrder: string[];
  /** https page cannot load http media unless the shell allows mixed content. */
  pageIsSecure: boolean;
}

export function analyzeStream(s: Stream, addon: Pick<Addon, 'transportUrl'> & { name: string }, ctx: RankContext): RankedStream {
  const text = streamText(s);
  const kind = kindOf(s);
  const quality = parseQuality(text);
  const dolbyVision = /\b(dv|dovi|dolby\s?vision)\b/i.test(text);
  const hdr = dolbyVision || /\bhdr(?:10)?\+?\b/i.test(text);
  const size = s.behaviorHints?.videoSize || parseSize(text);
  const seeders = parseSeeders(text);
  const codec = parseCodec(text);
  const audio = parseAudio(text);
  const container = parseContainer(s, text);
  const languages = detectStreamLanguages(text);
  const hasServer = !!ctx.settings.streamingServerUrl;
  const c = ctx.caps;

  let playable = false;
  let blockedReason: string | undefined;
  switch (kind) {
    case 'http':
      playable = true;
      break;
    case 'torrent':
      playable = hasServer;
      if (!playable) blockedReason = 'streams.needsServer';
      break;
    case 'youtube':
      blockedReason = 'streams.youtube';
      break;
    case 'external':
      blockedReason = 'streams.external';
      break;
    default:
      blockedReason = 'streams.unsupported';
  }

  let score = 0;
  if (playable) score += 10000;

  // Resolution: higher is better up to the user's cap.
  const cap = ctx.settings.maxQuality;
  const q = quality || 700; // unknown sits between 720p and 1080p
  if (cap && quality > cap) score -= 600;
  else score += q >= 2160 ? 420 : q >= 1440 ? 380 : q >= 1080 ? 340 : q >= 720 ? 240 : q >= 700 ? 200 : 100;
  if (hdr && (!cap || quality <= cap)) score += 15;

  // Prefer what the video element decodes without help.
  let needsHelp = false;
  if (kind === 'http' || kind === 'torrent') {
    if (codec === 'hevc' && !c.hevc) needsHelp = true;
    if (codec === 'av1' && !c.av1) needsHelp = true;
    if (container === 'mkv' && !c.mkv) needsHelp = true;
    if (container === 'avi') needsHelp = true;
    if (container === 'dash') needsHelp = true;
    if (container === 'hls' && !c.nativeHls && !c.mse) needsHelp = true;
    if ((audio === 'DTS' || audio === 'TrueHD') && container !== 'hls') needsHelp = true;
    if ((audio === 'DD+' || audio === 'Atmos') && !c.eac3 && container !== 'hls') needsHelp = true;
    if (audio === 'DD' && !c.ac3 && container !== 'hls') needsHelp = true;
    if (s.behaviorHints?.notWebReady && container !== 'mp4' && container !== 'hls') needsHelp = true;
    if (s.behaviorHints?.proxyHeaders?.request) needsHelp = true;
  }
  if (needsHelp) score -= hasServer ? 120 : 450;
  if (container === 'mp4' || container === 'hls') score += 40;
  // Dolby Vision profile 5 has no HDR10 fallback layer; colours break on non-DV sets.
  if (dolbyVision && !/\bhdr/i.test(text)) score -= 60;

  if (kind === 'http' && /^http:/i.test(s.url ?? '') && ctx.pageIsSecure && !hasServer) score -= 80;

  // Instantly available (debrid cached) beats "will download first".
  if (/⚡|\bcached\b|\binstant\b|\[(?:RD|AD|PM|TB|DL|ED|OC|PKP)\+\]/i.test(text)) score += 150;
  if (/⏳|\bdownload\b|\buncached\b|\[(?:RD|AD|PM|TB|DL|ED|OC|PKP) download\]/i.test(text)) score -= 300;

  // Very large files stall on Wi-Fi sticks; very small ones look poor.
  const gb = size / 1024 ** 3;
  if (gb > 0) {
    if (quality >= 2160) score += gb > 45 ? -160 : gb > 25 ? -60 : gb >= 6 ? 30 : 0;
    else if (quality >= 1080) score += gb > 20 ? -120 : gb > 10 ? -30 : gb >= 1.5 ? 30 : -20;
    else score += gb > 8 ? -60 : 0;
  }

  if (kind === 'torrent') score += Math.min(seeders, 200) / 4 - (seeders === 0 ? 40 : 0);

  // Audio language preference.
  const want = normLang(ctx.settings.audioLanguage);
  if (want && languages.length) {
    if (languages.includes(want)) score += 140;
    else if (languages.includes('multi')) score += 60;
    else score -= 90;
  }

  // Continuity: stay with the release the previous episode used.
  const group = s.behaviorHints?.bingeGroup;
  if (ctx.last) {
    if (group && ctx.last.bingeGroup && group === ctx.last.bingeGroup) score += 1200;
    else if (ctx.last.addonUrl === addon.transportUrl) {
      score += 40;
      if (ctx.last.quality && ctx.last.quality === quality) score += 60;
    }
  }

  const order = ctx.addonOrder.indexOf(addon.transportUrl);
  if (order > 0) score -= order * 6;

  const badges = [
    qualityLabel(quality),
    dolbyVision ? 'Dolby Vision' : hdr ? 'HDR' : '',
    audio,
    formatSize(size),
  ].filter(Boolean);
  const firstLine = (s.name || addon.name || '').split('\n')[0].trim();
  const detailSource = (s.title || s.description || s.behaviorHints?.filename || '').trim();

  return {
    stream: s,
    addonName: addon.name,
    addonUrl: addon.transportUrl,
    quality,
    hdr,
    dolbyVision,
    size,
    seeders,
    codec,
    audio,
    container,
    languages,
    kind,
    needsHelp,
    playable,
    blockedReason,
    score,
    label: badges.length ? badges.join(' · ') : firstLine,
    detail: detailSource.split('\n').slice(0, 3).join('\n'),
  };
}

export function rankStreams(list: RankedStream[]): RankedStream[] {
  return list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.score - a.r.score || a.i - b.i)
    .map((x) => x.r);
}

export function defaultRankContext(last?: LibraryItem['lastStream']): RankContext {
  return {
    caps: caps(),
    settings: settings.value,
    last,
    addonOrder: addons.value.map((a) => a.transportUrl),
    pageIsSecure: typeof location !== 'undefined' && location.protocol === 'https:',
  };
}

export interface StreamLoad {
  /** Resolves when every add-on has answered or timed out. */
  done: Promise<RankedStream[]>;
  cancel(): void;
}

/**
 * Ask every capable add-on for streams in parallel. `onUpdate` fires as each
 * add-on answers so the list can fill in progressively.
 */
export function loadStreams(
  type: string,
  videoId: string,
  last: LibraryItem['lastStream'] | undefined,
  onUpdate: (ranked: RankedStream[], pending: number, sources: number) => void,
  embedded?: Stream[],
): StreamLoad {
  const ctrl = new AbortController();
  const ctx = defaultRankContext(last);
  const providers = addons.value.filter((a) => supportsResource(a.manifest, 'stream', type, videoId));
  let pending = providers.length;
  let all: RankedStream[] = [];

  if (embedded && embedded.length) {
    all = embedded.map((s) => analyzeStream(s, { transportUrl: 'embedded', name: s.name || 'Video' }, ctx));
  }
  const emit = () => onUpdate(rankStreams(all), pending, providers.length);
  emit();

  const done = Promise.all(
    providers.map((addon) =>
      fetchJSON<{ streams?: Stream[] }>(resourceUrl(addon, 'stream', type, videoId), 20000, ctrl.signal)
        .then((res) => {
          const streams = Array.isArray(res?.streams) ? res.streams : [];
          all = all.concat(
            streams
              .filter((s) => s && typeof s === 'object')
              .map((s) => analyzeStream(s, { transportUrl: addon.transportUrl, name: addon.manifest.name }, ctx)),
          );
        })
        .catch(() => undefined)
        .then(() => {
          pending--;
          if (!ctrl.signal.aborted) emit();
        }),
    ),
  ).then(() => rankStreams(all));

  return { done, cancel: () => ctrl.abort() };
}

export function hasStreamAddons(type: string, videoId: string): boolean {
  return addons.value.some((a) => supportsResource(a.manifest, 'stream', type, videoId));
}
