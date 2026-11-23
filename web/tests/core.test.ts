import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeStream, cleanStreamText, parseQuality, parseSize, rankStreams, type RankContext } from '../src/core/streams';
import { activeCues, decodeSubtitleBytes, parseSubtitles, sanitizeCueText } from '../src/core/subtitles';
import { normalizeManifestUrl, resourceUrl, supportsResource } from '../src/core/addons';
import { detectStreamLanguages, langName, normLang } from '../src/core/langs';
import {
  clearLibrary,
  continueWatching,
  finishPlayback,
  getItem,
  isVideoWatched,
  libraryList,
  nextVideo,
  reportProgress,
  resumePoint,
  setVideoWatched,
  toggleSaved,
  videoToPlay,
} from '../src/core/library';
import type { Caps } from '../src/core/caps';
import type { Manifest, Meta, Stream } from '../src/core/types';

const stickCaps: Caps = {
  mse: true, nativeHls: false, mp4: true, mkv: false, webm: true, h264: true, hevc: true,
  av1: false, vp9: true, aac: true, ac3: false, eac3: false, opus: true, audioTracksApi: false,
};

function ctx(over: Partial<RankContext> = {}): RankContext {
  return {
    caps: stickCaps,
    settings: { maxQuality: 0, audioLanguage: '', streamingServerUrl: '' },
    addonOrder: ['a', 'b'],
    pageIsSecure: true,
    ...over,
  };
}
const A = { transportUrl: 'a', name: 'Addon A' };

describe('stream analysis', () => {
  it('reads quality and size from release names', () => {
    expect(parseQuality('Movie.2023.2160p.WEB-DL')).toBe(2160);
    expect(parseQuality('Movie 4K HDR')).toBe(2160);
    expect(parseQuality('Show.S01E02.1080p.x264')).toBe(1080);
    expect(parseQuality('something 720p')).toBe(720);
    expect(parseQuality('no hints here')).toBe(0);
    expect(parseSize('💾 2.5 GB')).toBe(Math.round(2.5 * 1024 ** 3));
    expect(parseSize('700 MB')).toBe(700 * 1024 ** 2);
  });

  it('marks torrents unplayable without a streaming server and playable with one', () => {
    const s: Stream = { infoHash: 'abc', title: 'Movie 1080p' };
    expect(analyzeStream(s, A, ctx()).playable).toBe(false);
    expect(analyzeStream(s, A, ctx({ settings: { maxQuality: 0, audioLanguage: '', streamingServerUrl: 'http://x:11470' } })).playable).toBe(true);
  });

  it('prefers a file the device decodes natively over a higher resolution it cannot', () => {
    const mkvDts: Stream = { url: 'https://h/a.mkv', title: 'Movie.2160p.HEVC.DTS-HD.mkv 40 GB' };
    const mp4: Stream = { url: 'https://h/b.mp4', title: 'Movie.1080p.H264.AAC.mp4 3 GB' };
    const ranked = rankStreams([analyzeStream(mkvDts, A, ctx()), analyzeStream(mp4, A, ctx())]);
    expect(ranked[0].stream).toBe(mp4);
    expect(ranked[1].needsHelp).toBe(true);
  });

  it('prefers higher quality when both are natively playable', () => {
    const uhd: Stream = { url: 'https://h/a.mp4', title: 'Movie.2160p.HEVC.AAC.mp4 12 GB' };
    const hd: Stream = { url: 'https://h/b.mp4', title: 'Movie.1080p.H264.AAC.mp4 3 GB' };
    expect(rankStreams([analyzeStream(hd, A, ctx()), analyzeStream(uhd, A, ctx())])[0].stream).toBe(uhd);
  });

  it('respects the quality cap', () => {
    const uhd: Stream = { url: 'https://h/a.mp4', title: 'Movie.2160p.mp4' };
    const hd: Stream = { url: 'https://h/b.mp4', title: 'Movie.1080p.mp4' };
    const c = ctx({ settings: { maxQuality: 1080, audioLanguage: '', streamingServerUrl: '' } });
    expect(rankStreams([analyzeStream(uhd, A, c), analyzeStream(hd, A, c)])[0].stream).toBe(hd);
  });

  it('stays with the release used for the previous episode', () => {
    const same: Stream = { url: 'https://h/a.mp4', title: '720p', behaviorHints: { bingeGroup: 'g1' } };
    const better: Stream = { url: 'https://h/b.mp4', title: '1080p', behaviorHints: { bingeGroup: 'g2' } };
    const c = ctx({ last: { bingeGroup: 'g1' } });
    expect(rankStreams([analyzeStream(better, A, c), analyzeStream(same, A, c)])[0].stream).toBe(same);
  });

  it('boosts sources in the preferred audio language', () => {
    const fr: Stream = { url: 'https://h/a.mp4', title: 'Film 1080p FRENCH' };
    const en: Stream = { url: 'https://h/b.mp4', title: 'Film 1080p ENGLISH' };
    const c = ctx({ settings: { maxQuality: 0, audioLanguage: 'fra', streamingServerUrl: '' } });
    expect(rankStreams([analyzeStream(en, A, c), analyzeStream(fr, A, c)])[0].stream).toBe(fr);
  });

  it('shows stream facts as text badges without emoji', () => {
    const s: Stream = { url: 'https://h/a.mp4', name: 'Addon\n4k', title: 'Movie.2023.2160p.WEB-DL.DDP5.1.H265\n\u{1F464} 12 \u{1F4BE} 15.2 GB \u2699\uFE0F Site\n\u{1F1EB}\u{1F1F7} / \u{1F1EC}\u{1F1E7}' };
    const r = analyzeStream(s, A, ctx());
    expect(r.detail).toBe('Movie.2023.2160p.WEB-DL.DDP5.1.H265');
    expect(r.label).toBe('4K · DD+ · 15 GB · EN FR');
    expect(r.seeders).toBe(12);
    expect(cleanStreamText('\u26A1 Cached release from a long provider name')).toBe('Cached release from a long provider name');
  });

  it('never ranks an unplayable source above a playable one', () => {
    const yt: Stream = { ytId: 'x', title: '2160p' };
    const ok: Stream = { url: 'https://h/b.mp4', title: '480p' };
    expect(rankStreams([analyzeStream(yt, A, ctx()), analyzeStream(ok, A, ctx())])[0].stream).toBe(ok);
  });
});

describe('subtitles', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,500\n<i>Hello</i>\nworld\n\n2\n00:00:04,000 --> 00:00:05,000\n{\\an8}<font color="red">Top</font>\n';
  it('parses SRT and strips unsafe markup', () => {
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1000, end: 3500, html: '<i>Hello</i><br>world' });
    expect(cues[1].html).toBe('Top');
  });
  it('parses WebVTT', () => {
    const cues = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000 align:center\nHi\n\n01:00:00.000 --> 01:00:01.000\nLate');
    expect(cues.map((c) => c.start)).toEqual([1000, 3600000]);
  });
  it('parses ASS dialogue lines', () => {
    const ass = '[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Hi{\\i0}, there\\Nfriend';
    expect(parseSubtitles(ass)[0]).toEqual({ start: 1000, end: 2500, html: 'Hi, there<br>friend' });
  });
  it('escapes script injection', () => {
    expect(sanitizeCueText('<script>alert(1)</script><b>ok</b> a < b')).toBe('alert(1)<b>ok</b> a &lt; b');
    expect(sanitizeCueText('<i>unclosed')).toBe('<i>unclosed</i>');
  });
  it('finds the cues active at a time', () => {
    const cues = parseSubtitles(srt);
    expect(activeCues(cues, 500)).toHaveLength(0);
    expect(activeCues(cues, 2000)[0].html).toContain('Hello');
    expect(activeCues(cues, 3800)).toHaveLength(0);
    expect(activeCues(cues, 4500)[0].html).toBe('Top');
  });
  it('decodes legacy Arabic and UTF-16 files', () => {
    // "مرحبا" in windows-1256
    const cp1256 = new Uint8Array([0xe3, 0xd1, 0xcd, 0xc8, 0xc7]);
    expect(decodeSubtitleBytes(cp1256.buffer, 'ara')).toBe('مرحبا');
    const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    expect(decodeSubtitleBytes(utf16.buffer, 'eng')).toBe('Hi');
    expect(decodeSubtitleBytes(new TextEncoder().encode('مرحبا').buffer as ArrayBuffer, 'ara')).toBe('مرحبا');
  });
});

describe('add-on helpers', () => {
  it('normalises what people paste', () => {
    expect(normalizeManifestUrl('stremio://example.com/manifest.json')).toBe('https://example.com/manifest.json');
    expect(normalizeManifestUrl('example.com/abc')).toBe('https://example.com/abc/manifest.json');
    expect(normalizeManifestUrl('https://example.com/cfg123/configure')).toBe('https://example.com/cfg123/manifest.json');
  });
  it('builds resource URLs with encoded extras', () => {
    expect(resourceUrl('https://a.b/manifest.json', 'catalog', 'movie', 'top', { genre: 'Sci-Fi & Fantasy', skip: 100 })).toBe(
      'https://a.b/catalog/movie/top/genre=Sci-Fi%20%26%20Fantasy&skip=100.json',
    );
    expect(resourceUrl('https://a.b/manifest.json', 'stream', 'series', 'tt1:1:2')).toBe('https://a.b/stream/series/tt1%3A1%3A2.json');
  });
  it('honours types and id prefixes', () => {
    const m: Manifest = { id: 'x', version: '1', name: 'X', types: ['movie'], idPrefixes: ['tt'], resources: ['stream', { name: 'meta', types: ['series'], idPrefixes: ['kitsu:'] }] };
    expect(supportsResource(m, 'stream', 'movie', 'tt1')).toBe(true);
    expect(supportsResource(m, 'stream', 'series', 'tt1')).toBe(false);
    expect(supportsResource(m, 'stream', 'movie', 'kitsu:1')).toBe(false);
    expect(supportsResource(m, 'meta', 'series', 'kitsu:1')).toBe(true);
    expect(supportsResource(m, 'subtitles', 'movie', 'tt1')).toBe(false);
  });
  it('understands language tags', () => {
    expect(normLang('en')).toBe('eng');
    expect(normLang('fre')).toBe('fra');
    expect(normLang('pt-BR')).toBe('por');
    expect(normLang('Arabic')).toBe('ara');
    expect(langName('ara')).toBe('العربية');
    expect(detectStreamLanguages('Movie 1080p 🇫🇷 MULTI')).toEqual(['fra', 'multi']);
  });
});

describe('library and watch tracking', () => {
  const movie: Meta = { id: 'tt1', type: 'movie', name: 'Movie' };
  const series: Meta = {
    id: 'tt2',
    type: 'series',
    name: 'Show',
    videos: [
      { id: 'tt2:1:2', season: 1, episode: 2, released: '2020-01-08T00:00:00.000Z' },
      { id: 'tt2:0:1', season: 0, episode: 1, released: '2019-01-01T00:00:00.000Z' },
      { id: 'tt2:1:1', season: 1, episode: 1, released: '2020-01-01T00:00:00.000Z' },
      { id: 'tt2:2:1', season: 2, episode: 1, released: '2021-01-01T00:00:00.000Z' },
      { id: 'tt2:2:2', season: 2, episode: 2, released: '2999-01-01T00:00:00.000Z' },
    ],
  };
  const MIN = 60000;
  beforeEach(() => clearLibrary());

  it('remembers where a movie was left and lists it under Continue Watching', () => {
    reportProgress({ meta: movie, videoId: 'tt1', timeMs: 10 * MIN, durationMs: 100 * MIN });
    expect(resumePoint(getItem('tt1'), 'tt1')).toBe(10 * MIN);
    expect(continueWatching().map((i) => i.id)).toEqual(['tt1']);
    expect(getItem('tt1')!.saved).toBe(false);
  });

  it('does not offer to resume the first seconds', () => {
    reportProgress({ meta: movie, videoId: 'tt1', timeMs: 5000, durationMs: 100 * MIN });
    expect(resumePoint(getItem('tt1'), 'tt1')).toBe(0);
  });

  it('counts a movie as watched after 70% of real playback, not after a seek', () => {
    reportProgress({ meta: movie, videoId: 'tt1', timeMs: 1000, durationMs: 100 * MIN });
    reportProgress({ meta: movie, videoId: 'tt1', timeMs: 80 * MIN, durationMs: 100 * MIN }); // a seek
    expect(getItem('tt1')!.state.timesWatched).toBe(0);
    for (let t = 1000; t <= 72 * MIN; t += 5000) reportProgress({ meta: movie, videoId: 'tt1', timeMs: t, durationMs: 100 * MIN });
    expect(getItem('tt1')!.state.timesWatched).toBe(1);
  });

  it('clears the resume point when a movie reaches the credits', () => {
    reportProgress({ meta: movie, videoId: 'tt1', timeMs: 95 * MIN, durationMs: 100 * MIN });
    finishPlayback(movie, 'tt1');
    expect(continueWatching()).toHaveLength(0);
    expect(getItem('tt1')!.state.timesWatched).toBe(1);
    expect(isVideoWatched(getItem('tt1'), 'tt1')).toBe(true);
  });

  it('keeps an unfinished movie in Continue Watching after leaving the player', () => {
    reportProgress({ meta: movie, videoId: 'tt1', timeMs: 30 * MIN, durationMs: 100 * MIN });
    expect(finishPlayback(movie, 'tt1')).toBeNull();
    expect(continueWatching()).toHaveLength(1);
  });

  it('orders episodes and skips specials and unaired ones when moving on', () => {
    expect(nextVideo(series, 'tt2:1:1')!.id).toBe('tt2:1:2');
    expect(nextVideo(series, 'tt2:1:2')!.id).toBe('tt2:2:1');
    expect(nextVideo(series, 'tt2:2:1')).toBeNull(); // 2x02 has not aired
  });

  it('moves a series on to the next episode when one finishes', () => {
    reportProgress({ meta: series, videoId: 'tt2:1:1', timeMs: 42 * MIN, durationMs: 45 * MIN });
    const next = finishPlayback(series, 'tt2:1:1');
    expect(next!.id).toBe('tt2:1:2');
    const item = getItem('tt2')!;
    expect(item.state.videoId).toBe('tt2:1:2');
    expect(isVideoWatched(item, 'tt2:1:1')).toBe(true);
    expect(continueWatching().map((i) => i.id)).toEqual(['tt2']);
    expect(videoToPlay(series, item)!.id).toBe('tt2:1:2');
    expect(resumePoint(item, 'tt2:1:2')).toBe(0);
  });

  it('remembers a separate resume point for each episode', () => {
    reportProgress({ meta: series, videoId: 'tt2:1:1', timeMs: 10 * MIN, durationMs: 45 * MIN });
    reportProgress({ meta: series, videoId: 'tt2:1:2', timeMs: 20 * MIN, durationMs: 45 * MIN });
    const item = getItem('tt2')!;
    expect(resumePoint(item, 'tt2:1:1')).toBe(10 * MIN);
    expect(resumePoint(item, 'tt2:1:2')).toBe(20 * MIN);
  });

  it('starts a new series at the first regular episode and continues after marks', () => {
    expect(videoToPlay(series, undefined)!.id).toBe('tt2:1:1');
    setVideoWatched(series, 'tt2:1:1', true);
    expect(videoToPlay(series, getItem('tt2'))!.id).toBe('tt2:1:2');
  });

  it('sorts and filters the saved library', () => {
    toggleSaved({ id: 'b', type: 'movie', name: 'Beta', releaseInfo: '1999' });
    toggleSaved({ id: 'a', type: 'series', name: 'alpha', releaseInfo: '2020-2022' });
    expect(libraryList({ sort: 'name' }).map((i) => i.id)).toEqual(['a', 'b']);
    expect(libraryList({ sort: 'year' }).map((i) => i.id)).toEqual(['a', 'b']);
    expect(libraryList({ type: 'movie' }).map((i) => i.id)).toEqual(['b']);
    expect(libraryList({ filter: 'watched' })).toHaveLength(0);
    toggleSaved({ id: 'b', type: 'movie', name: 'Beta' });
    expect(libraryList().map((i) => i.id)).toEqual(['a']);
  });
});
