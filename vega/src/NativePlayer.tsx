/**
 * Full-screen player built on the platform media pipeline. The web interface
 * hands a stream over to it when the WebView's own <video> cannot decode the
 * file (Matroska containers, Dolby audio and similar), and gets progress
 * reports back so resume points and watched marks keep working.
 *
 * Remote: Select or Play/Pause toggles playback, Left/Right (or the skip
 * keys) seek, Down turns subtitles on or off, Up shows the time bar and
 * Back returns to the app.
 */
import * as React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  KeplerVideoSurfaceView,
  VideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';

export interface NativeCue {
  /** Milliseconds. */
  s: number;
  e: number;
  /** Plain text, lines separated by \n. */
  t: string;
}

export interface NativePlayRequest {
  url: string;
  title: string;
  subtitle?: string;
  /** Seconds. */
  startAt: number;
  cues?: NativeCue[];
  subtitlesOn?: boolean;
  hasNext?: boolean;
  seekStep?: number;
}

interface Props {
  request: NativePlayRequest;
  onProgress: (time: number, duration: number) => void;
  onClose: (reason: 'closed' | 'ended' | 'next' | 'error', detail?: string) => void;
}

const START_TIMEOUT_MS = 30000;
const OVERLAY_MS = 4500;

function clock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) {
    seconds = 0;
  }
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function cueAt(cues: NativeCue[], ms: number): string {
  // Cues are sorted by start time; binary search for the last one that began.
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].s <= ms) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const lines: string[] = [];
  for (let i = Math.max(0, idx - 3); i <= idx; i++) {
    if (cues[i].e > ms) {
      lines.push(cues[i].t);
    }
  }
  return lines.join('\n');
}

export const NativePlayer = ({request, onProgress, onClose}: Props) => {
  const video = useRef<any>(null);
  const [time, setTime] = useState(request.startAt || 0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [subsOn, setSubsOn] = useState(request.subtitlesOn !== false);
  const [cue, setCue] = useState('');

  const state = useRef({
    started: false,
    seeked: !(request.startAt > 0),
    closed: false,
    lastReport: 0,
    lastTime: -1,
    stalledSince: 0,
    overlayTimer: null as ReturnType<typeof setTimeout> | null,
    createdAt: Date.now(),
    subsOn: request.subtitlesOn !== false,
  }).current;

  const close = useCallback(
    (reason: 'closed' | 'ended' | 'next' | 'error', detail?: string) => {
      if (state.closed) {
        return;
      }
      state.closed = true;
      onClose(reason, detail);
    },
    [onClose, state],
  );

  const wake = useCallback(() => {
    setOverlay(true);
    if (state.overlayTimer) {
      clearTimeout(state.overlayTimer);
    }
    state.overlayTimer = setTimeout(() => setOverlay(false), OVERLAY_MS);
  }, [state]);

  const onSurfaceViewCreated = useCallback(
    async (surfaceHandle: string) => {
      try {
        const player: any = new VideoPlayer();
        video.current = player;
        await player.initialize();
        if (state.closed) {
          return;
        }
        player.addEventListener?.('ended', () => close(request.hasNext ? 'next' : 'ended'));
        player.addEventListener?.('error', () =>
          close('error', String(player.error?.message ?? 'media error')),
        );
        player.setSurfaceHandle(surfaceHandle);
        player.autoplay = true;
        player.src = request.url;
      } catch (e) {
        close('error', String(e));
      }
    },
    [close, request.hasNext, request.url, state],
  );

  const onSurfaceViewDestroyed = useCallback(async (surfaceHandle: string) => {
    const player = video.current;
    video.current = null;
    try {
      player?.clearSurfaceHandle(surfaceHandle);
      await player?.deinitialize();
    } catch (e) {
      console.warn('[thalco] player teardown', e);
    }
  }, []);

  // One ticker: clock, subtitles, progress reports, start timeout and end detection.
  useEffect(() => {
    wake();
    const tick = setInterval(() => {
      const player = video.current;
      if (!player || state.closed) {
        return;
      }
      const now = Date.now();
      const t = Number(player.currentTime) || 0;
      const d = Number(player.duration);
      const dur = isFinite(d) && d > 0 ? d : 0;

      if (!state.started) {
        if (t > 0 || dur > 0) {
          state.started = true;
          setStarted(true);
        } else if (now - state.createdAt > START_TIMEOUT_MS) {
          close('error', 'playback did not start');
          return;
        }
      }
      // Resume point: seek once the stream is seekable.
      if (state.started && !state.seeked && dur > 0) {
        state.seeked = true;
        try {
          player.currentTime = Math.min(request.startAt, Math.max(0, dur - 5));
        } catch (e) {
          console.warn('[thalco] resume seek failed', e);
        }
        return;
      }
      if (!state.seeked) {
        return;
      }

      setTime(t);
      if (dur) {
        setDuration(dur);
      }
      setPaused(!!player.paused);

      if (state.subsOn && request.cues && request.cues.length) {
        setCue(cueAt(request.cues, t * 1000));
      }
      if (dur > 0 && now - state.lastReport > 2000) {
        state.lastReport = now;
        onProgress(t, dur);
      }
      // Some pipelines never fire "ended" in URL mode.
      if (dur > 0 && t >= dur - 0.75 && !player.paused) {
        if (t === state.lastTime) {
          if (!state.stalledSince) {
            state.stalledSince = now;
          } else if (now - state.stalledSince > 1500) {
            onProgress(dur, dur);
            close(request.hasNext ? 'next' : 'ended');
          }
        } else {
          state.stalledSince = 0;
        }
      }
      state.lastTime = t;
    }, 250);
    return () => {
      clearInterval(tick);
      if (state.overlayTimer) {
        clearTimeout(state.overlayTimer);
      }
      const player = video.current;
      if (player) {
        const t = Number(player.currentTime) || 0;
        const d = Number(player.duration);
        if (isFinite(d) && d > 0) {
          onProgress(t, d);
        }
      }
    };
    // The request is fixed for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTVEventHandler((evt: any) => {
    if (!evt || evt.eventKeyAction === 1 || state.closed) {
      return;
    }
    const player = video.current;
    if (!player) {
      return;
    }
    const step = request.seekStep || 10;
    const seek = (delta: number) => {
      const d = Number(player.duration);
      if (!isFinite(d) || d <= 0) {
        return;
      }
      try {
        player.currentTime = Math.max(0, Math.min(d - 2, (Number(player.currentTime) || 0) + delta));
      } catch (e) {
        console.warn('[thalco] seek failed', e);
      }
    };
    switch (evt.eventType) {
      case 'select':
      case 'playpause':
        if (player.paused) {
          player.play?.();
        } else {
          player.pause?.();
        }
        break;
      case 'play':
        player.play?.();
        break;
      case 'pause':
        player.pause?.();
        break;
      case 'left':
      case 'skip_backward':
      case 'rewind':
        seek(-step);
        break;
      case 'right':
      case 'skip_forward':
      case 'fast_forward':
        seek(step);
        break;
      case 'down':
        state.subsOn = !state.subsOn;
        setSubsOn(state.subsOn);
        if (!state.subsOn) {
          setCue('');
        }
        break;
      default:
        break;
    }
    wake();
  });

  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const hasCues = !!(request.cues && request.cues.length);
  const showOverlay = overlay || paused || !started;

  return (
    <View style={styles.root}>
      <KeplerVideoSurfaceView
        style={styles.surface}
        onSurfaceViewCreated={onSurfaceViewCreated}
        onSurfaceViewDestroyed={onSurfaceViewDestroyed}
      />
      {subsOn && cue !== '' && (
        <View style={[styles.cueWrap, showOverlay && styles.cueWrapRaised]} pointerEvents="none">
          <Text style={styles.cue}>{cue}</Text>
        </View>
      )}
      {showOverlay && (
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.top}>
            <Text style={styles.title} numberOfLines={1}>
              {request.title}
            </Text>
            {!!request.subtitle && (
              <Text style={styles.subtitle} numberOfLines={1}>
                {request.subtitle}
              </Text>
            )}
          </View>
          <View style={styles.bottom}>
            <Text style={styles.status}>
              {!started ? 'Starting…' : paused ? 'Paused' : ''}
            </Text>
            <View style={styles.barRow}>
              <Text style={styles.time}>{clock(time)}</Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, {width: `${pct}%`}]} />
              </View>
              <Text style={[styles.time, styles.timeEnd]}>
                {duration > 0 ? '-' + clock(duration - time) : '--:--'}
              </Text>
            </View>
            <Text style={styles.hint}>
              {hasCues ? `Subtitles ${subsOn ? 'on' : 'off'}: press Down   ·   ` : ''}
              Back to leave
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {...StyleSheet.absoluteFillObject, backgroundColor: '#000000'},
  surface: {flex: 1},
  overlay: {...StyleSheet.absoluteFillObject, justifyContent: 'space-between'},
  top: {
    paddingHorizontal: 80,
    paddingTop: 60,
    paddingBottom: 60,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  title: {color: '#ffffff', fontSize: 42, fontWeight: '800'},
  subtitle: {color: 'rgba(255,255,255,0.85)', fontSize: 28, fontWeight: '600', marginTop: 6},
  bottom: {
    paddingHorizontal: 80,
    paddingTop: 40,
    paddingBottom: 60,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  status: {color: '#ffffff', fontSize: 26, fontWeight: '600', marginBottom: 16},
  barRow: {flexDirection: 'row', alignItems: 'center'},
  time: {color: 'rgba(255,255,255,0.85)', fontSize: 24, fontWeight: '600', width: 120},
  timeEnd: {textAlign: 'right'},
  bar: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  barFill: {height: 10, borderRadius: 5, backgroundColor: '#ffffff'},
  hint: {color: 'rgba(235,235,245,0.6)', fontSize: 22, marginTop: 18},
  cueWrap: {
    position: 'absolute',
    left: 160,
    right: 160,
    bottom: 80,
    alignItems: 'center',
  },
  cueWrapRaised: {bottom: 260},
  cue: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: '#000000',
    textShadowRadius: 8,
    textShadowOffset: {width: 0, height: 2},
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
});
