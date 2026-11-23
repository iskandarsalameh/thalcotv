// Wraps the <video> element. Progressive files play directly; HLS goes through
// hls.js (loaded on demand) with buffer settings tuned for a 1 GB stick.

import type Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';
import { caps } from '../core/caps';
import { normLang } from '../core/langs';
import { settings } from '../core/settings';

export interface AudioTrackInfo {
  id: number;
  label: string;
  lang: string;
  active: boolean;
}

export interface EmbeddedTextTrack {
  id: number;
  label: string;
  lang: string;
}

export interface LoadOptions {
  /** Seconds. */
  startAt: number;
  /** Treat the URL as HLS regardless of its extension. */
  hls?: boolean;
  timeoutMs?: number;
}

export class PlaybackError extends Error {
  constructor(
    message: string,
    /** 'unsupported' means another decoder could still play it. */
    public kind: 'unsupported' | 'network' | 'timeout' | 'aborted' | 'unknown',
  ) {
    super(message);
  }
}

function looksLikeHls(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url) || /\/hlsv2\//.test(url) || /[?&]format=m3u8/i.test(url);
}

interface NativeAudioTrack {
  enabled: boolean;
  id: string;
  label: string;
  language: string;
}

export class Engine {
  private hls: Hls | null = null;
  private loadToken = 0;
  /** Called when playback fails after it had started. */
  onFatal: ((err: PlaybackError) => void) | null = null;

  constructor(public readonly video: HTMLVideoElement) {}

  private hlsConfig(startAt: number): Partial<HlsConfig> {
    const buffer = Math.max(20, Math.min(180, settings.value.bufferSeconds));
    return {
      enableWorker: true,
      lowLatencyMode: false,
      startPosition: startAt > 0 ? startAt : -1,
      // Forward buffer: enough to ride out Wi-Fi dips without exhausting memory.
      maxBufferLength: buffer,
      maxMaxBufferLength: buffer * 2,
      maxBufferSize: 48 * 1000 * 1000,
      backBufferLength: 30,
      maxBufferHole: 0.5,
      // Start on a sensible rung instead of the lowest, then adapt.
      abrEwmaDefaultEstimate: 4_000_000,
      testBandwidth: true,
      capLevelToPlayerSize: false,
      nudgeMaxRetry: 10,
      manifestLoadingMaxRetry: 4,
      manifestLoadingTimeOut: 20000,
      levelLoadingMaxRetry: 6,
      fragLoadingMaxRetry: 8,
      fragLoadingTimeOut: 30000,
    };
  }

  async load(url: string, opts: LoadOptions): Promise<void> {
    const token = ++this.loadToken;
    this.teardown();
    const video = this.video;
    const useHls = opts.hls || looksLikeHls(url);
    const c = caps();

    const ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new PlaybackError('timed out', 'timeout')), opts.timeoutMs ?? 25000);
      const finish = (err?: PlaybackError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('error', onError);
        if (token !== this.loadToken) reject(new PlaybackError('superseded', 'aborted'));
        else if (err) reject(err);
        else resolve();
      };
      const onMeta = () => finish();
      const onError = () => {
        const code = video.error?.code;
        // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED, 3 = MEDIA_ERR_DECODE, 2 = MEDIA_ERR_NETWORK
        finish(new PlaybackError(video.error?.message || 'media error ' + code, code === 2 ? 'network' : code === 3 || code === 4 ? 'unsupported' : 'unknown'));
      };
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('error', onError);
      this.failLoad = finish;
    });

    if (useHls && c.mse) {
      const mod = await import('hls.js');
      if (token !== this.loadToken) throw new PlaybackError('superseded', 'aborted');
      const HlsCtor = mod.default;
      if (HlsCtor.isSupported()) {
        const hls = new HlsCtor(this.hlsConfig(opts.startAt));
        this.hls = hls;
        let networkRetries = 0;
        let mediaRetries = 0;
        hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
          const cap = settings.value.maxQuality;
          if (cap) {
            let best = -1;
            hls.levels.forEach((l, i) => {
              if ((l.height || 0) <= cap) best = i;
            });
            if (best >= 0) hls.autoLevelCapping = best;
          }
        });
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && networkRetries < 3 && video.readyState > 0) {
            networkRetries++;
            hls.startLoad();
            return;
          }
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
            mediaRetries++;
            hls.recoverMediaError();
            return;
          }
          const err = new PlaybackError(
            data.details || 'hls error',
            data.type === HlsCtor.ErrorTypes.NETWORK_ERROR ? 'network' : 'unsupported',
          );
          if (this.failLoad) this.failLoad(err);
          if (this.onFatal) this.onFatal(err);
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        await ready;
        this.failLoad = null;
        return;
      }
    }

    video.src = url;
    video.load();
    await ready;
    this.failLoad = null;
    if (opts.startAt > 0) {
      try {
        video.currentTime = opts.startAt;
      } catch {
        /* not seekable yet; the caller retries on canplay */
      }
    }
  }

  private failLoad: ((err?: PlaybackError) => void) | null = null;

  audioTracks(): AudioTrackInfo[] {
    if (this.hls && this.hls.audioTracks.length > 1) {
      const current = this.hls.audioTrack;
      return this.hls.audioTracks.map((tr, i) => ({
        id: i,
        label: tr.name || '',
        lang: normLang(tr.lang || ''),
        active: i === current,
      }));
    }
    const list = (this.video as unknown as { audioTracks?: ArrayLike<NativeAudioTrack> }).audioTracks;
    if (list && list.length > 1) {
      const out: AudioTrackInfo[] = [];
      for (let i = 0; i < list.length; i++) {
        out.push({ id: i, label: list[i].label || '', lang: normLang(list[i].language || ''), active: !!list[i].enabled });
      }
      return out;
    }
    return [];
  }

  setAudioTrack(id: number): void {
    if (this.hls && this.hls.audioTracks.length > 1) {
      this.hls.audioTrack = id;
      return;
    }
    const list = (this.video as unknown as { audioTracks?: ArrayLike<NativeAudioTrack> }).audioTracks;
    if (!list) return;
    const t = this.video.currentTime;
    for (let i = 0; i < list.length; i++) list[i].enabled = i === id;
    // Some engines need a nudge to switch decoders.
    try {
      this.video.currentTime = Math.max(0, t - 0.01);
    } catch {
      /* ignore */
    }
  }

  /** Subtitle tracks carried inside the stream itself. */
  embeddedTextTracks(): EmbeddedTextTrack[] {
    const out: EmbeddedTextTrack[] = [];
    if (this.hls && this.hls.subtitleTracks.length) {
      this.hls.subtitleTracks.forEach((tr, i) => out.push({ id: i, label: tr.name || '', lang: normLang(tr.lang || '') }));
      return out;
    }
    const tracks = this.video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      if (tr.kind === 'subtitles' || tr.kind === 'captions') out.push({ id: i, label: tr.label || '', lang: normLang(tr.language || '') });
    }
    return out;
  }

  /** Show one embedded track (rendered by the engine), or none with -1. */
  setEmbeddedTextTrack(id: number): void {
    if (this.hls && this.hls.subtitleTracks.length) {
      this.hls.subtitleDisplay = id >= 0;
      this.hls.subtitleTrack = id;
      return;
    }
    const tracks = this.video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      if (tr.kind === 'subtitles' || tr.kind === 'captions') tr.mode = i === id ? 'showing' : 'disabled';
    }
  }

  bufferedAhead(): number {
    const v = this.video;
    const b = v.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= v.currentTime + 0.25 && b.end(i) >= v.currentTime) return b.end(i) - v.currentTime;
    }
    return 0;
  }

  private teardown(): void {
    if (this.failLoad) {
      const f = this.failLoad;
      this.failLoad = null;
      f(new PlaybackError('superseded', 'aborted'));
    }
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch {
        /* ignore */
      }
      this.hls = null;
    }
    const video = this.video;
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    if (video.getAttribute('src')) {
      video.removeAttribute('src');
      // Releases the hardware decoder, which the stick has exactly one of.
      video.load();
    }
  }

  destroy(): void {
    this.loadToken++;
    this.onFatal = null;
    this.teardown();
  }
}
