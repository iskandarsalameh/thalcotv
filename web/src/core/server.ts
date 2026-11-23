// Optional Stremio streaming server (stremio-server / stremio-service running
// on a computer or NAS on the same network). It adds two things the stick
// cannot do alone: torrent streaming and on-the-fly conversion (HLS) of files
// the video element cannot decode.

import type { Stream, Video } from './types';
import { caps } from './caps';
import { settings } from './settings';

export function serverUrl(): string {
  return settings.value.streamingServerUrl.replace(/\/+$/, '');
}

export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  const u = new URL(url);
  if (!u.port && u.protocol === 'http:') u.port = '11470';
  return u.origin;
}

export async function probeServer(base: string, timeoutMs = 6000): Promise<{ ok: boolean; version?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base.replace(/\/+$/, '') + '/settings', { signal: ctrl.signal });
    if (!res.ok) return { ok: false };
    const json = await res.json();
    return { ok: true, version: json?.values?.serverVersion };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function parseMagnet(uri: string): { infoHash: string; trackers: string[] } | null {
  const m = uri.match(/xt=urn:btih:([a-z0-9]+)/i);
  if (!m) return null;
  const trackers: string[] = [];
  uri.replace(/[?&]tr=([^&]+)/g, (_all, tr: string) => {
    try {
      trackers.push('tracker:' + decodeURIComponent(tr));
    } catch {
      /* ignore */
    }
    return '';
  });
  return { infoHash: m[1].toLowerCase(), trackers };
}

/** Turn a torrent stream into an HTTP URL served by the streaming server. */
export async function resolveTorrent(stream: Stream, video: Video | null, signal?: AbortSignal): Promise<string> {
  const base = serverUrl();
  if (!base) throw new Error('no streaming server');
  let infoHash = stream.infoHash?.toLowerCase() ?? '';
  let sources = stream.sources ?? [];
  if (!infoHash && stream.url) {
    const parsed = parseMagnet(stream.url);
    if (parsed) {
      infoHash = parsed.infoHash;
      sources = parsed.trackers;
    }
  }
  if (!infoHash) throw new Error('no info hash');
  let fileIdx = typeof stream.fileIdx === 'number' ? stream.fileIdx : -1;
  const body: Record<string, unknown> = {
    torrent: { infoHash },
    peerSearch: { sources: ['dht:' + infoHash].concat(sources), min: 40, max: 200 },
  };
  if (fileIdx < 0 && video && typeof video.season === 'number') {
    body.guessFileIdx = { season: video.season, episode: video.episode ?? video.number ?? 1 };
  }
  try {
    const res = await fetch(`${base}/${infoHash}/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) {
      const json = await res.json();
      if (fileIdx < 0 && typeof json?.guessedFileIdx === 'number') fileIdx = json.guessedFileIdx;
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    // The plain URL below still works on servers without /create.
  }
  return `${base}/${infoHash}/${fileIdx < 0 ? 0 : fileIdx}`;
}

let transcodeSeq = 0;

/** URL of an HLS rendition of `mediaUrl` limited to codecs this device decodes. */
export function transcodeUrl(mediaUrl: string): string {
  const base = serverUrl();
  const c = caps();
  const q = new URLSearchParams();
  q.set('mediaURL', mediaUrl);
  q.append('videoCodecs', 'h264');
  if (c.hevc) q.append('videoCodecs', 'h265');
  if (c.vp9) q.append('videoCodecs', 'vp9');
  q.append('audioCodecs', 'aac');
  q.append('audioCodecs', 'mp3');
  if (c.opus) q.append('audioCodecs', 'opus');
  if (c.ac3) q.append('audioCodecs', 'ac3');
  if (c.eac3) q.append('audioCodecs', 'eac3');
  q.set('maxAudioChannels', c.ac3 || c.eac3 ? '6' : '2');
  const id = Date.now().toString(36) + (transcodeSeq++).toString(36);
  return `${base}/hlsv2/${id}/master.m3u8?${q.toString()}`;
}

/** Route a URL through the server when the add-on demands custom request headers. */
export function proxyUrl(mediaUrl: string, headers: Record<string, string>): string {
  const base = serverUrl();
  const u = new URL(mediaUrl);
  const q = new URLSearchParams();
  q.set('d', u.origin);
  Object.keys(headers).forEach((k) => q.append('h', k + ':' + headers[k]));
  return `${base}/proxy/${q.toString()}${u.pathname}${u.search}`;
}
