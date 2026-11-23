// Subtitle discovery (through add-ons) and parsing. Cues are rendered by the
// player itself rather than by the browser's <track> machinery, which gives
// full control over size, position, timing offset and legacy text encodings.

import type { Stream, SubtitleTrack } from './types';
import { addons, fetchJSON, resourceUrl, supportsResource } from './addons';
import { normLang } from './langs';

export interface Cue {
  /** Milliseconds. */
  start: number;
  end: number;
  /** Sanitised HTML: only <i>, <b>, <u> and <br> survive. */
  html: string;
}

export async function loadSubtitleTracks(
  type: string,
  videoId: string,
  stream: Stream | undefined,
  signal?: AbortSignal,
): Promise<SubtitleTrack[]> {
  const out: SubtitleTrack[] = [];
  const seen = new Set<string>();
  const push = (t: SubtitleTrack) => {
    if (!t.url || seen.has(t.url)) return;
    seen.add(t.url);
    out.push(t);
  };

  (stream?.subtitles ?? []).forEach((s, i) => {
    if (s && s.url) push({ id: 'stream-' + (s.id ?? i), url: s.url, lang: normLang(s.lang), origin: 'stream' });
  });

  const extra: Record<string, string | number | undefined> = {};
  const hints = stream?.behaviorHints;
  if (hints?.videoHash) extra.videoHash = hints.videoHash;
  if (hints?.videoSize) extra.videoSize = hints.videoSize;
  if (hints?.filename) extra.filename = hints.filename;

  const providers = addons.value.filter((a) => supportsResource(a.manifest, 'subtitles', type, videoId));
  await Promise.all(
    providers.map((addon) =>
      fetchJSON<{ subtitles?: { id?: string; url: string; lang: string }[] }>(
        resourceUrl(addon, 'subtitles', type, videoId, extra),
        12000,
        signal,
      )
        .then((res) => {
          (res?.subtitles ?? []).forEach((s, i) => {
            if (s && typeof s.url === 'string') {
              push({
                id: addon.manifest.id + '-' + (s.id ?? i),
                url: s.url,
                lang: normLang(s.lang),
                origin: addon.manifest.name,
              });
            }
          });
        })
        .catch(() => undefined),
    ),
  );
  return out;
}

/** Group by language with the preferred languages first. */
export function orderTracks(tracks: SubtitleTrack[], preferred: string[]): SubtitleTrack[] {
  const pref = preferred.map(normLang).filter(Boolean);
  const rank = (t: SubtitleTrack) => {
    const i = pref.indexOf(t.lang);
    return i < 0 ? pref.length : i;
  };
  return tracks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.t.lang.localeCompare(b.t.lang) || a.i - b.i)
    .map((x) => x.t);
}

// ---- decoding ---------------------------------------------------------------

const LEGACY_ENCODINGS: Record<string, string> = {
  ara: 'windows-1256',
  fas: 'windows-1256',
  urd: 'windows-1256',
  heb: 'windows-1255',
  rus: 'windows-1251',
  ukr: 'windows-1251',
  bul: 'windows-1251',
  srp: 'windows-1251',
  mkd: 'windows-1251',
  ell: 'windows-1253',
  tur: 'windows-1254',
  pol: 'windows-1250',
  ces: 'windows-1250',
  slk: 'windows-1250',
  hun: 'windows-1250',
  ron: 'windows-1250',
  hrv: 'windows-1250',
  slv: 'windows-1250',
  bos: 'windows-1250',
  lit: 'windows-1257',
  lav: 'windows-1257',
  est: 'windows-1257',
  tha: 'windows-874',
  vie: 'windows-1258',
  jpn: 'shift_jis',
  kor: 'euc-kr',
  zho: 'gb18030',
};

/** Subtitle files in the wild are often not UTF-8; guess from BOM, validity and language. */
export function decodeSubtitleBytes(buf: ArrayBuffer, lang: string): string {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const enc = LEGACY_ENCODINGS[normLang(lang)] ?? 'windows-1252';
    try {
      return new TextDecoder(enc).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

// ---- parsing ----------------------------------------------------------------

function parseTime(t: string): number {
  // 00:01:02,345 | 01:02.345 | 0:01:02.34
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return NaN;
  const h = parseInt(m[1] ?? '0', 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const frac = m[4] ?? '0';
  const ms = parseInt((frac + '00').slice(0, 3), 10);
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeCueText(raw: string): string {
  let text = raw
    .replace(/\{\\[^}]*\}/g, '') // ASS override blocks like {\an8}
    .replace(/\\N/gi, '\n')
    .replace(/\\h/g, ' ');
  text = escapeHtml(text);
  // Re-enable the harmless inline tags, drop every other tag (font, c.voice, timestamps...).
  text = text
    .replace(/&lt;(\/?)([ibu])&gt;/gi, (_m, slash: string, tag: string) => '<' + slash + tag.toLowerCase() + '>')
    .replace(/&lt;\/?[^&]*?&gt;/g, '');
  // Balance tags so a stray <i> cannot italicise the rest of the page.
  for (const tag of ['i', 'b', 'u']) {
    const open = (text.match(new RegExp('<' + tag + '>', 'g')) ?? []).length;
    const close = (text.match(new RegExp('</' + tag + '>', 'g')) ?? []).length;
    if (open > close) text += ('</' + tag + '>').repeat(open - close);
    else if (close > open) text = ('<' + tag + '>').repeat(close - open) + text;
  }
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('<br>');
}

function parseSrtOrVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r/g, '').replace(/^\uFEFF/, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, bRaw] = lines[ti].split('-->');
    const b = (bRaw ?? '').trim().split(/\s+/)[0];
    const start = parseTime(a);
    const end = parseTime(b);
    if (isNaN(start) || isNaN(end) || end <= start) continue;
    const html = sanitizeCueText(lines.slice(ti + 1).join('\n'));
    if (html) cues.push({ start, end, html });
  }
  return cues;
}

function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  let format: string[] = [];
  let inEvents = false;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^\[events\]/i.test(line)) {
      inEvents = true;
      continue;
    }
    if (/^\[/.test(line)) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;
    if (/^format:/i.test(line)) {
      format = line.slice(7).split(',').map((s) => s.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue:/i.test(line) || !format.length) continue;
    const raw = line.slice(9).trim();
    const parts = raw.split(',');
    const fields = parts.slice(0, format.length - 1);
    fields.push(parts.slice(format.length - 1).join(','));
    const get = (name: string) => fields[format.indexOf(name)] ?? '';
    const start = parseTime(get('start'));
    const end = parseTime(get('end'));
    if (isNaN(start) || isNaN(end) || end <= start) continue;
    const html = sanitizeCueText(get('text'));
    if (html) cues.push({ start, end, html });
  }
  return cues;
}

export function parseSubtitles(text: string): Cue[] {
  const head = text.slice(0, 2000);
  const cues = /\[script info\]|\[events\]/i.test(head) || /^dialogue:/im.test(head) ? parseAss(text) : parseSrtOrVtt(text);
  return cues.sort((a, b) => a.start - b.start);
}

export async function fetchCues(track: SubtitleTrack, signal?: AbortSignal): Promise<Cue[]> {
  const res = await fetch(track.url, { signal, credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = decodeSubtitleBytes(await res.arrayBuffer(), track.lang);
  const cues = parseSubtitles(text);
  if (!cues.length) throw new Error('empty subtitles');
  return cues;
}

/** Cues visible at `timeMs`. Cues are sorted by start; overlapping cues are all returned. */
export function activeCues(cues: Cue[], timeMs: number): Cue[] {
  if (!cues.length) return [];
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= timeMs) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const out: Cue[] = [];
  // Look back a little for long cues that started earlier and still overlap.
  for (let i = Math.max(0, idx - 4); i <= idx; i++) {
    if (cues[i].end > timeMs) out.push(cues[i]);
  }
  return out;
}
