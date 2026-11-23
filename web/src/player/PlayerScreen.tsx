import { useEffect, useRef, useState } from 'preact/hooks';
import type { Meta, RankedStream, SubtitleTrack, Video } from '../core/types';
import { Engine, PlaybackError, type AudioTrackInfo, type EmbeddedTextTrack } from './engine';
import { nativeBridge } from '../core/bridge';
import { proxyUrl, resolveTorrent, serverUrl, transcodeUrl } from '../core/server';
import { settings, updateSettings } from '../core/settings';
import {
  episodeNumber,
  finishPlayback,
  flushLibrary,
  getItem,
  isSeriesLike,
  nextVideo,
  rememberPrefs,
  rememberStream,
  reportProgress,
  resumePoint,
  videoTitle,
} from '../core/library';
import { activeCues, fetchCues, loadSubtitleTracks, orderTracks, type Cue } from '../core/subtitles';
import { langName, normLang } from '../core/langs';
import { t } from '../core/i18n';
import { Focusable } from '../ui/components/Focusable';
import { Icon } from '../ui/components/Icon';
import { Img } from '../ui/components/Img';
import { overlays, openMenu, showToast, type MenuOption } from '../ui/overlay';
import { addBackHandler, addKeyHandler, focusEl, focusFirst, getFocused, type Action } from '../nav/spatial';
import { pop, replace } from '../nav/router';
import { streamIdOf } from '../ui/actions';

type Mode = 'direct' | 'native' | 'transcode';
type Phase = 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error' | 'native';
type SubChoice = { kind: 'off' } | { kind: 'addon'; track: SubtitleTrack } | { kind: 'embedded'; id: number; lang: string };

interface Props {
  active: boolean;
  meta: Meta;
  video: Video | null;
  streams: RankedStream[];
  index: number;
  startAt?: number;
}

const CONTROLS_TIMEOUT = 5000;
const STALL_LIMIT_MS = 30000;
const UP_NEXT_SECONDS = 10;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function clock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}

/** Which decoders to try for a source, in order. */
function modesFor(s: RankedStream): Mode[] {
  const native = nativeBridge.nativePlayer;
  const server = !!serverUrl();
  const modes: Mode[] = [];
  if (s.needsHelp) {
    if (native) modes.push('native');
    if (server) modes.push('transcode');
    modes.push('direct');
  } else {
    modes.push('direct');
    if (native) modes.push('native');
    if (server) modes.push('transcode');
  }
  return modes;
}

export function PlayerScreen({ active, meta, video, streams, index, startAt }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const subsRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [candidate, setCandidate] = useState(index);
  const [controls, setControls] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  const [subTracks, setSubTracks] = useState<SubtitleTrack[]>([]);
  const [embedded, setEmbedded] = useState<EmbeddedTextTrack[]>([]);
  const [audio, setAudio] = useState<AudioTrackInfo[]>([]);
  const [sub, setSub] = useState<SubChoice>({ kind: 'off' });
  const [speed, setSpeed] = useState(1);
  const [upNext, setUpNext] = useState<number | null>(null);
  const [errorText, setErrorText] = useState('');

  const videoId = streamIdOf(meta, video);
  const next = isSeriesLike(meta) && video ? nextVideo(meta, video.id) : null;

  // Mutable state shared by the long-lived listeners below.
  const S = useRef({
    token: 0,
    candidate: index,
    mode: 'direct' as Mode,
    phase: 'loading' as Phase,
    started: false,
    lastReport: 0,
    stallSince: 0,
    retriedSame: false,
    cues: [] as Cue[],
    cueHtml: '',
    subDelay: getItem(meta.id)?.prefs?.subtitleDelay ?? 0,
    pendingSeek: null as number | null,
    seekTimer: null as ReturnType<typeof setTimeout> | null,
    seekStreak: 0,
    lastSeekKey: 0,
    controlsTimer: null as ReturnType<typeof setTimeout> | null,
    controls: true,
    nativeTime: 0,
    nativeDuration: 0,
    exited: false,
    subToken: 0,
    autoSubDone: false,
    userChoseSub: false,
  }).current;

  const setPhaseBoth = (p: Phase) => {
    S.phase = p;
    setPhase(p);
  };

  // ---- controls visibility --------------------------------------------------

  const armHide = () => {
    if (S.controlsTimer) clearTimeout(S.controlsTimer);
    S.controlsTimer = setTimeout(() => {
      if (S.phase === 'playing' && S.pendingSeek === null && overlays.value.length === 0) {
        S.controls = false;
        setControls(false);
        focusEl(scrubRef.current);
      }
    }, CONTROLS_TIMEOUT);
  };
  const showControls = (focusScrub = false) => {
    if (!S.controls) {
      S.controls = true;
      setControls(true);
    }
    if (focusScrub || !getFocused()) focusEl(scrubRef.current);
    armHide();
  };

  // ---- progress bookkeeping -------------------------------------------------

  const position = (): { time: number; duration: number } => {
    if (S.mode === 'native') return { time: S.nativeTime, duration: S.nativeDuration };
    const v = videoRef.current;
    return { time: v?.currentTime ?? 0, duration: v && isFinite(v.duration) ? v.duration : 0 };
  };
  const report = (immediate: boolean) => {
    const p = position();
    if (!S.started || !(p.duration > 0)) return;
    S.lastReport = Date.now();
    reportProgress({ meta, videoId, timeMs: p.time * 1000, durationMs: p.duration * 1000, immediate });
  };

  // ---- loading and failover -------------------------------------------------

  const resolveUrl = async (s: RankedStream): Promise<string> => {
    if (s.kind === 'torrent') return resolveTorrent(s.stream, video);
    const url = s.stream.url ?? '';
    const headers = s.stream.behaviorHints?.proxyHeaders?.request;
    if (headers && serverUrl()) return proxyUrl(url, headers);
    return url;
  };

  const fail = (message: string) => {
    setErrorText(message);
    setPhaseBoth('error');
  };

  /** Move on after a failed attempt: next decoder for this source, then the next source. */
  const escalate = (i: number, mode: Mode, atSec: number, reason: PlaybackError | Error) => {
    const modes = modesFor(streams[i]);
    const nextMode = modes[modes.indexOf(mode) + 1];
    if (nextMode) {
      void attempt(i, nextMode, atSec);
      return;
    }
    if (settings.value.autoFailover && i + 1 < streams.length) {
      showToast(t('player.tryingNext'), 'refresh');
      void attempt(i + 1, modesFor(streams[i + 1])[0], atSec);
      return;
    }
    fail(reason instanceof PlaybackError && reason.kind === 'unsupported' ? t('player.error.unsupported') : t('player.error.generic'));
  };

  const attempt = async (i: number, mode: Mode, atSec: number): Promise<void> => {
    const token = ++S.token;
    const s = streams[i];
    if (!s) {
      fail(t('player.error.generic'));
      return;
    }
    S.candidate = i;
    S.mode = mode;
    S.stallSince = 0;
    setCandidate(i);
    setPhaseBoth('loading');
    setErrorText('');
    try {
      let url = await resolveUrl(s);
      if (token !== S.token) return;
      if (mode === 'native') {
        engineRef.current?.destroy();
        engineRef.current = null;
        const cues = await nativeCues();
        if (token !== S.token) return;
        const ok = nativeBridge.playNative({
          url,
          title: meta.name,
          subtitle: video ? t('episode.full', { s: video.season ?? 1, e: episodeNumber(video), title: videoTitle(video) }) : '',
          startAt: atSec,
          cues,
          subtitlesOn: cues.length > 0,
          hasNext: !!next,
          seekStep: settings.value.seekStep,
        });
        if (!ok) throw new PlaybackError('native player unavailable', 'unsupported');
        S.nativeTime = atSec;
        setPhaseBoth('native');
        return;
      }
      if (mode === 'transcode') url = transcodeUrl(url);
      if (!engineRef.current && videoRef.current) {
        engineRef.current = new Engine(videoRef.current);
      }
      const engine = engineRef.current!;
      engine.onFatal = (err) => {
        if (token !== S.token || !S.started) return;
        const v = videoRef.current;
        escalate(S.candidate, S.mode, v ? v.currentTime : atSec, err);
      };
      await engine.load(url, { startAt: atSec, hls: mode === 'transcode' || s.container === 'hls' });
      if (token !== S.token) return;
      const v = videoRef.current!;
      v.playbackRate = speedRef.current;
      try {
        await v.play();
      } catch {
        // Autoplay refused: stay paused with the controls up.
      }
      if (token !== S.token) return;
      onStarted(i);
    } catch (e) {
      if (token !== S.token) return;
      const err = e instanceof Error ? e : new Error(String(e));
      if (err instanceof PlaybackError && err.kind === 'aborted') return;
      escalate(i, mode, atSec, err);
    }
  };

  const subTracksRef = useRef<SubtitleTrack[]>([]);
  const subTracksReady = useRef<Promise<SubtitleTrack[]> | null>(null);
  const speedRef = useRef(1);

  /** Subtitles for the native player: it renders plain cues, so pick and parse here. */
  const nativeCues = async (): Promise<{ s: number; e: number; t: string }[]> => {
    const pref = getItem(meta.id)?.prefs?.subtitleLang;
    if (pref === null) return [];
    const wanted = [pref ?? settings.value.subtitleLanguage, settings.value.secondarySubtitleLanguage].map((l) => normLang(l)).filter(Boolean);
    if (!wanted.length) return [];
    const wait = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
    const tracks = await wait(subTracksReady.current ?? Promise.resolve([] as SubtitleTrack[]), 6000, subTracksRef.current);
    for (const lang of wanted) {
      for (const track of tracks.filter((x) => x.lang === lang).slice(0, 2)) {
        const cues = await wait(fetchCues(track).catch(() => [] as Cue[]), 7000, [] as Cue[]);
        if (cues.length) {
          return cues.map((c) => ({
            s: c.start,
            e: c.end,
            t: c.html.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
          }));
        }
      }
    }
    return [];
  };

  const onStarted = (i: number) => {
    const s = streams[i];
    S.started = true;
    S.retriedSame = false;
    rememberStream(meta.id, {
      bingeGroup: s.stream.behaviorHints?.bingeGroup,
      addonUrl: s.addonUrl,
      quality: s.quality,
      label: s.label,
    });
    nativeBridge.playing(true);
    const engine = engineRef.current;
    if (engine) {
      const tracks = engine.audioTracks();
      setAudio(tracks);
      const want = normLang(getItem(meta.id)?.prefs?.audioLang ?? settings.value.audioLanguage);
      if (want && tracks.length > 1) {
        const match = tracks.find((a) => a.lang === want);
        if (match && !match.active) {
          engine.setAudioTrack(match.id);
          setAudio(engine.audioTracks());
        }
      }
      setEmbedded(engine.embeddedTextTracks());
    }
    autoSelectSubtitle();
    armHide();
  };

  // ---- subtitles ------------------------------------------------------------

  const applySub = (choice: SubChoice) => {
    const token = ++S.subToken;
    setSub(choice);
    S.cues = [];
    S.cueHtml = '';
    if (subsRef.current) subsRef.current.innerHTML = '';
    const engine = engineRef.current;
    if (choice.kind === 'embedded') {
      engine?.setEmbeddedTextTrack(choice.id);
      return;
    }
    engine?.setEmbeddedTextTrack(-1);
    if (choice.kind === 'addon') {
      fetchCues(choice.track)
        .then((cues) => {
          if (token === S.subToken) S.cues = cues;
        })
        .catch(() => {
          if (token !== S.subToken) return;
          showToast(t('player.subtitleFailed'), 'warn');
          setSub({ kind: 'off' });
        });
    }
  };

  const autoSelectSubtitle = () => {
    if (S.userChoseSub || S.mode === 'native') return;
    const pref = getItem(meta.id)?.prefs?.subtitleLang;
    if (pref === null) return; // explicitly turned off for this title
    const wanted = [pref ?? settings.value.subtitleLanguage, settings.value.secondarySubtitleLanguage].map((l) => normLang(l)).filter(Boolean);
    if (!wanted.length) return;
    const emb = engineRef.current?.embeddedTextTracks() ?? [];
    for (const lang of wanted) {
      const e = emb.find((x) => x.lang === lang);
      if (e) {
        if (!S.autoSubDone) applySub({ kind: 'embedded', id: e.id, lang: e.lang });
        S.autoSubDone = true;
        return;
      }
      const a = subTracksRef.current.find((x) => x.lang === lang);
      if (a) {
        if (!S.autoSubDone) applySub({ kind: 'addon', track: a });
        S.autoSubDone = true;
        return;
      }
    }
  };

  // ---- seeking --------------------------------------------------------------

  const commitSeek = () => {
    S.seekTimer = null;
    const target = S.pendingSeek;
    S.pendingSeek = null;
    setScrubTo(null);
    const v = videoRef.current;
    if (target === null || !v) return;
    try {
      v.currentTime = target;
    } catch {
      /* ignore */
    }
    setTime(target);
    report(true);
    armHide();
  };

  const seekBy = (dir: -1 | 1) => {
    const v = videoRef.current;
    if (!v || S.mode === 'native' || !isFinite(v.duration) || v.duration <= 0) return;
    const now = Date.now();
    S.seekStreak = now - S.lastSeekKey < 600 ? S.seekStreak + 1 : 0;
    S.lastSeekKey = now;
    // Holding the key accelerates, like scrubbing on a touch remote.
    const mult = S.seekStreak > 24 ? 12 : S.seekStreak > 12 ? 6 : S.seekStreak > 5 ? 3 : 1;
    const base = S.pendingSeek ?? v.currentTime;
    const target = Math.max(0, Math.min(v.duration - 2, base + dir * settings.value.seekStep * mult));
    S.pendingSeek = target;
    setScrubTo(target);
    if (S.seekTimer) clearTimeout(S.seekTimer);
    S.seekTimer = setTimeout(commitSeek, 450);
    showControls();
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || S.mode === 'native') return;
    if (S.phase === 'error' || S.phase === 'loading') return;
    if (v.paused || v.ended) void v.play().catch(() => undefined);
    else v.pause();
    showControls();
  };

  // ---- leaving --------------------------------------------------------------

  const cleanupPlayback = () => {
    report(true);
    S.token++;
    if (S.seekTimer) clearTimeout(S.seekTimer);
    if (S.controlsTimer) clearTimeout(S.controlsTimer);
    if (S.mode === 'native') nativeBridge.stopNative();
    engineRef.current?.destroy();
    engineRef.current = null;
    nativeBridge.playing(false);
  };

  const exit = () => {
    if (S.exited) return;
    S.exited = true;
    cleanupPlayback();
    finishPlayback(meta, videoId);
    flushLibrary();
    pop();
  };

  const goNext = () => {
    if (!next || S.exited) return;
    S.exited = true;
    cleanupPlayback();
    finishPlayback(meta, videoId);
    flushLibrary();
    replace({ name: 'streams', meta, video: next, auto: true });
  };

  const onEnded = () => {
    report(true);
    if (next && settings.value.autoPlayNext) {
      setPhaseBoth('ended');
      setUpNext(UP_NEXT_SECONDS);
    } else if (next) {
      setPhaseBoth('ended');
      setUpNext(-1);
    } else {
      exit();
    }
  };

  // ---- lifecycle ------------------------------------------------------------

  useEffect(() => {
    const v = videoRef.current!;
    const initial = startAt !== undefined ? startAt / 1000 : resumePoint(getItem(meta.id), videoId) / 1000;

    // Subtitle list arrives in the background; playback never waits for it.
    const ctrl = new AbortController();
    subTracksReady.current = loadSubtitleTracks(meta.type, videoId, streams[index]?.stream, ctrl.signal).then((tracks) => {
      const ordered = orderTracks(tracks, [settings.value.subtitleLanguage, settings.value.secondarySubtitleLanguage]);
      if (ctrl.signal.aborted) return ordered;
      subTracksRef.current = ordered;
      setSubTracks(ordered);
      if (S.started) autoSelectSubtitle();
      return ordered;
    });

    void attempt(index, modesFor(streams[index] ?? streams[0])[0], initial);

    const onPlaying = () => {
      S.stallSince = 0;
      setPhaseBoth('playing');
      armHide();
    };
    const onPause = () => {
      if (S.phase === 'loading' || S.phase === 'error' || v.ended) return;
      setPhaseBoth('paused');
      report(true);
      showControls();
    };
    const onWaiting = () => {
      if (S.phase === 'loading' || S.phase === 'error') return;
      if (!S.stallSince) S.stallSince = Date.now();
      setPhaseBoth('buffering');
    };
    const onDuration = () => setDuration(isFinite(v.duration) ? v.duration : 0);
    const onCanPlay = () => {
      if (S.phase === 'buffering') S.stallSince = 0;
    };
    const onVideoError = () => {
      // Errors before start are handled by the load promise.
      if (!S.started || S.phase === 'loading') return;
      const at = v.currentTime;
      const err = new PlaybackError(v.error?.message ?? 'media error', v.error?.code === 2 ? 'network' : 'unsupported');
      if (err.kind === 'network' && !S.retriedSame) {
        S.retriedSame = true;
        void attempt(S.candidate, S.mode, at);
      } else {
        escalate(S.candidate, S.mode, at, err);
      }
    };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('durationchange', onDuration);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onVideoError);

    // One light ticker drives the clock, subtitles, progress saves and stall detection.
    const tick = setInterval(() => {
      if (S.mode === 'native') {
        if (S.started && Date.now() - S.lastReport > 5000) report(false);
        return;
      }
      const now = Date.now();
      const cur = v.currentTime;
      if (S.controls) {
        setTime(cur);
        setBuffered(cur + (engineRef.current?.bufferedAhead() ?? 0));
      }
      if (S.cues.length && subsRef.current) {
        const html = activeCues(S.cues, cur * 1000 - S.subDelay)
          .map((c) => '<div class="cue">' + c.html + '</div>')
          .join('');
        if (html !== S.cueHtml) {
          S.cueHtml = html;
          subsRef.current.innerHTML = html;
        }
      }
      if (S.phase === 'playing' && now - S.lastReport > 5000) report(false);
      if (S.phase === 'buffering' && S.stallSince && now - S.stallSince > STALL_LIMIT_MS && settings.value.autoFailover) {
        S.stallSince = 0;
        if (!S.retriedSame) {
          S.retriedSame = true;
          void attempt(S.candidate, S.mode, cur);
        } else if (S.candidate + 1 < streams.length) {
          showToast(t('player.stalled'), 'refresh');
          void attempt(S.candidate + 1, modesFor(streams[S.candidate + 1])[0], cur);
        }
      }
    }, 200);

    const offNative = nativeBridge.subscribe((msg) => {
      if (S.mode !== 'native') return;
      switch (msg.type) {
        case 'nativeProgress':
          S.nativeTime = Number(msg.time) || 0;
          S.nativeDuration = Number(msg.duration) || 0;
          if (!S.started && S.nativeDuration > 0) onStarted(S.candidate);
          break;
        case 'nativeEnded':
          S.nativeTime = S.nativeDuration;
          if (next && settings.value.autoPlayNext) goNext();
          else exit();
          break;
        case 'nativeNext':
          S.nativeTime = S.nativeDuration;
          if (settings.value.autoPlayNext) goNext();
          else exit();
          break;
        case 'nativeClosed':
          exit();
          break;
        case 'nativeError':
          escalate(S.candidate, 'native', S.nativeTime, new PlaybackError(String(msg.message ?? 'native error'), 'unsupported'));
          break;
      }
    });

    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        report(true);
        flushLibrary();
        // The hardware decoder is taken away in the background.
        if (S.mode !== 'native') v.pause();
      }
    };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      clearInterval(tick);
      ctrl.abort();
      offNative();
      document.removeEventListener('visibilitychange', onHide);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('durationchange', onDuration);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', onVideoError);
      if (!S.exited) {
        // Unmounted by navigation rather than by exit(): still save where we were.
        S.exited = true;
        cleanupPlayback();
        finishPlayback(meta, videoId);
        flushLibrary();
      }
    };
  }, []);

  // "Up Next" countdown after the credits.
  useEffect(() => {
    if (upNext === null || upNext < 0) return;
    if (upNext === 0) {
      goNext();
      return;
    }
    const id = setTimeout(() => setUpNext((n) => (n === null || n < 0 ? n : n - 1)), 1000);
    return () => clearTimeout(id);
  }, [upNext]);

  // Remote handling while the player is on screen.
  useEffect(() => {
    if (!active) return;
    const offKey = addKeyHandler((_e: KeyboardEvent, action: Action) => {
      if (overlays.value.length > 0) return false;
      // The native player owns the remote; only Back is ours (it closes the player).
      if (S.mode === 'native' && S.phase === 'native') return action !== 'back';
      if (S.phase === 'ended' || S.phase === 'error') return false;
      const onScrub = getFocused() === scrubRef.current;
      switch (action) {
        case 'playpause':
          togglePlay();
          return true;
        case 'play':
          void videoRef.current?.play().catch(() => undefined);
          return true;
        case 'pause':
          videoRef.current?.pause();
          return true;
        case 'rewind':
          seekBy(-1);
          return true;
        case 'forward':
          seekBy(1);
          return true;
        case 'left':
        case 'right':
          if (!S.controls || onScrub) {
            seekBy(action === 'left' ? -1 : 1);
            return true;
          }
          armHide();
          return false;
        case 'select':
          if (!S.controls || onScrub) {
            if (S.pendingSeek !== null) {
              if (S.seekTimer) clearTimeout(S.seekTimer);
              commitSeek();
            } else togglePlay();
            return true;
          }
          armHide();
          return false;
        case 'up':
        case 'down':
          if (!S.controls) {
            showControls(true);
            return true;
          }
          armHide();
          return false;
      }
      return false;
    });
    const offBack = addBackHandler(() => {
      if (S.controls && S.phase === 'playing') {
        S.controls = false;
        setControls(false);
        focusEl(scrubRef.current);
        return true;
      }
      exit();
      return true;
    });
    focusEl(scrubRef.current);
    return () => {
      offKey();
      offBack();
    };
  }, [active]);

  // Voice / system transport controls.
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      ms.metadata = new MediaMetadata({
        title: video ? videoTitle(video) || meta.name : meta.name,
        artist: video ? meta.name : '',
        artwork: meta.poster ? [{ src: meta.poster }] : [],
      });
      ms.setActionHandler('play', () => void videoRef.current?.play());
      ms.setActionHandler('pause', () => videoRef.current?.pause());
      ms.setActionHandler('seekbackward', () => seekBy(-1));
      ms.setActionHandler('seekforward', () => seekBy(1));
      ms.setActionHandler('nexttrack', next ? () => goNext() : null);
    } catch {
      /* optional API */
    }
    return () => {
      try {
        ms.metadata = null;
        (['play', 'pause', 'seekbackward', 'seekforward', 'nexttrack'] as MediaSessionAction[]).forEach((a) => ms.setActionHandler(a, null));
      } catch {
        /* ignore */
      }
    };
  }, []);

  // ---- menus ----------------------------------------------------------------

  const subtitleMenu = async () => {
    type V = { k: 'off' } | { k: 'e'; id: number; lang: string } | { k: 'lang'; lang: string } | { k: 'delay'; d: number } | { k: 'size'; d: number };
    const options: MenuOption<V>[] = [{ value: { k: 'off' }, label: t('player.subtitlesOff'), selected: sub.kind === 'off' }];
    embedded.forEach((e) =>
      options.push({
        value: { k: 'e', id: e.id, lang: e.lang },
        label: langName(e.lang) || e.label || t('player.track', { n: e.id + 1 }),
        detail: [e.label, t('player.embedded')].filter(Boolean).join(' · '),
        selected: sub.kind === 'embedded' && sub.id === e.id,
      }),
    );
    // One entry per language; several files for a language open a second list.
    const byLang = new Map<string, number[]>();
    subTracks.forEach((tr, i) => {
      const list = byLang.get(tr.lang) ?? [];
      if (list.length < 8) list.push(i);
      byLang.set(tr.lang, list);
    });
    byLang.forEach((list, lang) => {
      options.push({
        value: { k: 'lang', lang },
        label: langName(lang) || lang || t('player.unknownLanguage'),
        detail: list.length > 1 ? t('player.subtitleChoices', { n: list.length }) : subTracks[list[0]].origin === 'stream' ? t('player.fromSource') : subTracks[list[0]].origin,
        selected: sub.kind === 'addon' && sub.track.lang === lang,
      });
    });
    if (sub.kind === 'addon') {
      const d = (S.subDelay / 1000).toFixed(1);
      options.push({ value: { k: 'delay', d: -250 }, label: t('player.subtitleEarlier'), detail: t('player.delayValue', { s: d }), icon: 'chevronLeft' });
      options.push({ value: { k: 'delay', d: 250 }, label: t('player.subtitleLater'), detail: t('player.delayValue', { s: d }), icon: 'chevronRight' });
    }
    options.push({ value: { k: 'size', d: 10 }, label: t('player.subtitleBigger'), detail: settings.value.subtitleSize + '%', icon: 'plus' });
    const v = await openMenu(t('player.subtitles'), options, subTracks.length === 0 && embedded.length === 0 ? t('player.noSubtitles') : undefined);
    armHide();
    if (!v) return;
    S.userChoseSub = true;
    if (v.k === 'off') {
      applySub({ kind: 'off' });
      rememberPrefs(meta.id, { subtitleLang: null });
    } else if (v.k === 'e') {
      applySub({ kind: 'embedded', id: v.id, lang: v.lang });
      rememberPrefs(meta.id, { subtitleLang: v.lang });
    } else if (v.k === 'lang') {
      const list = byLang.get(v.lang) ?? [];
      let pick: number | null = list[0] ?? null;
      if (list.length > 1) {
        pick = await openMenu(
          langName(v.lang) || v.lang,
          list.map((i, n) => ({
            value: i,
            label: t('player.subtitleOption', { n: n + 1 }),
            detail: subTracks[i].origin === 'stream' ? t('player.fromSource') : subTracks[i].origin,
            selected: sub.kind === 'addon' && sub.track.url === subTracks[i].url,
          })),
          t('player.subtitleChoicesHint'),
        );
        armHide();
      }
      if (pick === null) return;
      applySub({ kind: 'addon', track: subTracks[pick] });
      rememberPrefs(meta.id, { subtitleLang: v.lang });
    } else if (v.k === 'delay') {
      S.subDelay += v.d;
      rememberPrefs(meta.id, { subtitleDelay: S.subDelay });
      showToast(t('player.delayValue', { s: (S.subDelay / 1000).toFixed(2) }));
    } else if (v.k === 'size') {
      const sizes = [80, 100, 120, 140, 160];
      const cur = sizes.indexOf(settings.value.subtitleSize);
      updateSettings({ subtitleSize: sizes[(cur + 1) % sizes.length] });
    }
  };

  const audioMenu = async () => {
    const engine = engineRef.current;
    const tracks = engine?.audioTracks() ?? [];
    if (tracks.length < 2) {
      showToast(t('player.oneAudio'));
      return;
    }
    const v = await openMenu(
      t('player.audio'),
      tracks.map((a) => ({
        value: a.id,
        label: langName(a.lang) || a.label || t('player.track', { n: a.id + 1 }),
        detail: a.label && langName(a.lang) ? a.label : undefined,
        selected: a.active,
      })),
    );
    armHide();
    if (v === null || !engine) return;
    engine.setAudioTrack(v);
    setAudio(engine.audioTracks());
    const chosen = tracks.find((a) => a.id === v);
    if (chosen?.lang) rememberPrefs(meta.id, { audioLang: chosen.lang });
  };

  const speedMenu = async () => {
    const v = await openMenu(
      t('player.speed'),
      SPEEDS.map((s) => ({ value: s, label: s === 1 ? t('player.speedNormal') : s + '×', selected: s === speed })),
    );
    armHide();
    if (v === null) return;
    speedRef.current = v;
    setSpeed(v);
    if (videoRef.current) videoRef.current.playbackRate = v;
  };

  const sourcesMenu = async () => {
    const v = await openMenu(
      t('player.sources'),
      streams.map((s, i) => ({
        value: i,
        label: s.label,
        detail: [s.addonName, s.detail.split('\n')[0]].filter(Boolean).join(' · '),
        selected: i === candidate,
      })),
    );
    armHide();
    if (v === null || v === candidate) return;
    const at = position().time;
    if (S.mode === 'native') nativeBridge.stopNative();
    void attempt(v, modesFor(streams[v])[0], at);
  };

  // ---- render ---------------------------------------------------------------

  const current = streams[candidate];
  const shownTime = scrubTo ?? time;
  const pct = duration > 0 ? Math.min(100, (shownTime / duration) * 100) : 0;
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const episodeLine = video ? t('episode.full', { s: video.season ?? 1, e: episodeNumber(video), title: videoTitle(video) }) : '';
  const st = settings.value;
  const busy = phase === 'loading' || phase === 'buffering';
  const visible = controls || phase === 'paused' || phase === 'error' || phase === 'loading';

  return (
    <div class={'screen screen-player' + (visible ? ' controls-on' : '')} data-focus-group="">
      <video ref={videoRef} class="video" playsInline preload="auto" />
      <div
        ref={subsRef}
        class={'subs subs-' + st.subtitleBackground}
        style={{ fontSize: (2.6 * st.subtitleSize) / 100 + 'rem', color: st.subtitleColor, bottom: (visible ? Math.max(st.subtitleOffset, 24) : st.subtitleOffset) + '%' }}
      />

      {phase === 'native' && (
        <div class="player-cover">
          <Img src={meta.background || meta.poster} />
        </div>
      )}

      {busy && (
        <div class="player-center">
          <div class="spinner spinner-lg" />
          {phase === 'loading' && (
            <div class="player-status">
              {t('player.loading')}
              {current ? ' · ' + current.addonName : ''}
            </div>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div class="player-center player-error" data-focus-group="" ref={(el) => {
          if (el && !el.contains(getFocused())) focusFirst(el);
        }}>
          <Icon name="warn" class="empty-icon" />
          <div class="empty-title">{t('player.error.title')}</div>
          <div class="empty-message">{errorText}</div>
          <div class="button-row">
            {streams.length > 1 && (
              <Focusable class="btn btn-primary" isDefault onSelect={() => void sourcesMenu()}>
                <Icon name="list" /> {t('player.sources')}
              </Focusable>
            )}
            <Focusable class="btn" onSelect={() => void attempt(candidate, modesFor(streams[candidate])[0], position().time)}>
              <Icon name="refresh" /> {t('common.retry')}
            </Focusable>
            <Focusable class="btn" onSelect={exit}>
              {t('common.back')}
            </Focusable>
          </div>
        </div>
      )}

      {phase === 'ended' && next && (
        <div class="upnext" data-focus-group="" ref={(el) => {
          if (el && !el.contains(getFocused())) focusFirst(el);
        }}>
          <div class="upnext-label">{t('player.upNext')}</div>
          <div class="upnext-title">
            {t('episode.full', { s: next.season ?? 1, e: episodeNumber(next), title: videoTitle(next) })}
          </div>
          <div class="button-row">
            <Focusable class="btn btn-primary" isDefault onSelect={goNext}>
              <Icon name="play" /> {upNext !== null && upNext > 0 ? t('player.playingIn', { n: upNext }) : t('player.playNext')}
            </Focusable>
            <Focusable class="btn" onSelect={exit}>
              {t('common.close')}
            </Focusable>
          </div>
        </div>
      )}

      <div class="player-top">
        <div class="player-title">{meta.name}</div>
        {episodeLine && <div class="player-subtitle">{episodeLine}</div>}
        {current && <div class="player-source">{[current.label, current.addonName].filter(Boolean).join(' · ')}</div>}
      </div>

      <div class="player-bottom" style={{ display: phase === 'ended' || phase === 'native' || phase === 'error' ? 'none' : undefined }}>
        <div class="scrub-row">
          <span class="scrub-time">{clock(shownTime)}</span>
          <Focusable class="scrub" elRef={(el) => ((scrubRef as { current: HTMLDivElement | null }).current = el)} role="slider" label={t('player.seek')} isDefault>
            <div class="scrub-buffer" style={{ width: bufPct + '%' }} />
            <div class="scrub-fill" style={{ width: pct + '%' }} />
            <div class="scrub-knob" style={{ insetInlineStart: pct + '%' }} />
          </Focusable>
          <span class="scrub-time">{duration > 0 ? '-' + clock(duration - shownTime) : '--:--'}</span>
        </div>
        <div class="player-buttons" data-focus-group="">
          <Focusable class="pbtn" onSelect={togglePlay} label={t('common.play')}>
            <Icon name={phase === 'paused' ? 'play' : 'pause'} />
          </Focusable>
          <Focusable
            class="pbtn"
            label={t('details.startOver')}
            onSelect={() => {
              const v = videoRef.current;
              if (v) v.currentTime = 0;
              armHide();
            }}
          >
            <Icon name="restart" />
          </Focusable>
          {next && (
            <Focusable class="pbtn" onSelect={goNext} label={t('player.playNext')}>
              <Icon name="next" />
            </Focusable>
          )}
          <span class="pbtn-gap" />
          <Focusable class={'pbtn pbtn-text' + (sub.kind !== 'off' ? ' pbtn-on' : '')} onSelect={() => void subtitleMenu()}>
            <Icon name="captions" />
            {sub.kind === 'off' ? t('player.subtitles') : langName(sub.kind === 'addon' ? sub.track.lang : sub.lang) || t('player.subtitles')}
          </Focusable>
          {audio.length > 1 && (
            <Focusable class="pbtn pbtn-text" onSelect={() => void audioMenu()}>
              <Icon name="audio" />
              {langName(audio.find((a) => a.active)?.lang) || t('player.audio')}
            </Focusable>
          )}
          <Focusable class="pbtn pbtn-text" onSelect={() => void speedMenu()}>
            <Icon name="speed" />
            {speed === 1 ? t('player.speed') : speed + '×'}
          </Focusable>
          {streams.length > 1 && (
            <Focusable class="pbtn pbtn-text" onSelect={() => void sourcesMenu()}>
              <Icon name="list" />
              {t('player.sources')}
            </Focusable>
          )}
        </div>
      </div>
    </div>
  );
}
