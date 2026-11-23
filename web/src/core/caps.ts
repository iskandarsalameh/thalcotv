// What can this device's video element actually decode? Asked once, cached.
// The answers drive stream ranking (prefer what plays natively) and decide
// when a streaming server has to convert a file.

export interface Caps {
  mse: boolean;
  nativeHls: boolean;
  mp4: boolean;
  mkv: boolean;
  webm: boolean;
  h264: boolean;
  hevc: boolean;
  av1: boolean;
  vp9: boolean;
  aac: boolean;
  ac3: boolean;
  eac3: boolean;
  opus: boolean;
  audioTracksApi: boolean;
}

let cached: Caps | null = null;

function can(el: HTMLVideoElement, type: string): boolean {
  try {
    return el.canPlayType(type) !== '';
  } catch {
    return false;
  }
}

function mseCan(type: string): boolean {
  try {
    const MS = (window as unknown as { MediaSource?: typeof MediaSource; ManagedMediaSource?: typeof MediaSource })
      .MediaSource ?? (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource;
    return !!MS && MS.isTypeSupported(type);
  } catch {
    return false;
  }
}

export function caps(): Caps {
  if (cached) return cached;
  if (typeof document === 'undefined') {
    cached = {
      mse: false, nativeHls: false, mp4: true, mkv: false, webm: false, h264: true, hevc: false,
      av1: false, vp9: false, aac: true, ac3: false, eac3: false, opus: false, audioTracksApi: false,
    };
    return cached;
  }
  const v = document.createElement('video');
  const hevc =
    can(v, 'video/mp4; codecs="hvc1.1.6.L120.90"') ||
    can(v, 'video/mp4; codecs="hev1.1.6.L120.90"') ||
    mseCan('video/mp4; codecs="hvc1.1.6.L120.90"');
  cached = {
    mse: mseCan('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),
    nativeHls: can(v, 'application/vnd.apple.mpegurl') || can(v, 'application/x-mpegURL'),
    mp4: can(v, 'video/mp4'),
    // Chromium reports Matroska through the WebM demuxer.
    mkv: can(v, 'video/x-matroska; codecs="avc1.640028"') || can(v, 'video/x-matroska'),
    webm: can(v, 'video/webm; codecs="vp9"') || can(v, 'video/webm'),
    h264: can(v, 'video/mp4; codecs="avc1.640028"'),
    hevc,
    av1: can(v, 'video/mp4; codecs="av01.0.08M.08"'),
    vp9: can(v, 'video/webm; codecs="vp9"') || can(v, 'video/mp4; codecs="vp09.00.40.08"'),
    aac: can(v, 'audio/mp4; codecs="mp4a.40.2"'),
    ac3: can(v, 'audio/mp4; codecs="ac-3"'),
    eac3: can(v, 'audio/mp4; codecs="ec-3"'),
    opus: can(v, 'audio/webm; codecs="opus"') || can(v, 'audio/mp4; codecs="opus"'),
    audioTracksApi: 'audioTracks' in v,
  };
  return cached;
}

/** Overridable in tests. */
export function setCapsForTest(c: Caps | null): void {
  cached = c;
}
