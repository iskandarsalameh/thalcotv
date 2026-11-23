import { useEffect, useRef, useState } from 'preact/hooks';
import { locale, t } from '../core/i18n';
import { langTwo } from '../core/langs';
import { settings } from '../core/settings';
import { Focusable } from '../ui/components/Focusable';
import { Icon } from '../ui/components/Icon';
import { Img } from '../ui/components/Img';
import { overlays } from '../ui/overlay';
import { addBackHandler, addKeyHandler, focusEl, getFocused, type Action } from '../nav/spatial';
import { pop } from '../nav/router';
import { clock } from './PlayerScreen';

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTApi {
  Player: new (
    el: HTMLElement,
    opts: { events: { onReady?: () => void; onStateChange?: (e: { data: number }) => void; onError?: (e: { data: number }) => void } },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoading: Promise<YTApi> | null = null;

/** The video service's player API, loaded the first time a trailer is opened. */
function loadApi(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiLoading) return apiLoading;
  apiLoading = new Promise<YTApi>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 12000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('no api'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('blocked'));
    };
    document.head.appendChild(script);
  });
  apiLoading.catch(() => {
    apiLoading = null;
  });
  return apiLoading;
}

function embedUrl(id: string): string {
  const p = new URLSearchParams({
    enablejsapi: '1',
    autoplay: '1',
    controls: '0',
    disablekb: '1',
    fs: '0',
    rel: '0',
    iv_load_policy: '3',
    playsinline: '1',
    hl: locale.value,
  });
  // Captions follow the viewer's subtitle language, when one is set.
  const subs = langTwo(settings.value.subtitleLanguage);
  if (subs) {
    p.set('cc_load_policy', '1');
    p.set('cc_lang_pref', subs);
  }
  if (/^https?:$/.test(location.protocol)) p.set('origin', location.origin);
  return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
}

const CONTROLS_MS = 4500;
const START_TIMEOUT_MS = 15000;

type Phase = 'loading' | 'playing' | 'paused' | 'ending' | 'error';

interface Props {
  active: boolean;
  title: string;
  ids: string[];
  /** Artwork of the title: what the trailer grows out of and returns to. */
  art?: string;
  logo?: string;
}

/**
 * Full-screen trailer, presented as part of this app.
 *
 * The picture comes from an embedded video player, but none of that player's
 * own interface is ever on screen: its frame is made far taller than the
 * display so its title bar, logo and suggestions sit off screen while the
 * 16:9 picture stays exactly full screen, and the title's own artwork covers
 * it until the first frame plays and again as it ends. Everything the viewer
 * sees and touches (the cover, the scrubber, the glass controls, the Back
 * pill) is the same as in the main player.
 */
export function TrailerScreen({ active, title, ids, art, logo }: Props) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [controls, setControls] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLDivElement | null>(null);
  const player = useRef<YTPlayer | null>(null);
  const S = useRef({
    started: false,
    muted: false,
    phase: 'loading' as Phase,
    controls: false,
    hideTimer: null as ReturnType<typeof setTimeout> | null,
    pendingSeek: null as number | null,
    seekTimer: null as ReturnType<typeof setTimeout> | null,
    seekStreak: 0,
    lastSeekKey: 0,
    closing: false,
  }).current;

  const setPhaseBoth = (p: Phase) => {
    S.phase = p;
    setPhase(p);
  };

  const hide = () => {
    S.controls = false;
    setControls(false);
    focusEl(scrubRef.current);
  };
  const wake = (focusScrub = false) => {
    if (!S.controls) {
      S.controls = true;
      setControls(true);
    }
    if (focusScrub || !getFocused()) focusEl(scrubRef.current);
    if (S.hideTimer) clearTimeout(S.hideTimer);
    S.hideTimer = setTimeout(() => {
      if (S.phase === 'playing' && S.pendingSeek === null) hide();
    }, CONTROLS_MS);
  };

  /** Let the artwork return over the picture, then leave. */
  const finish = () => {
    if (S.closing) return;
    S.closing = true;
    setPhaseBoth('ending');
    try {
      player.current?.pauseVideo();
    } catch {
      /* already gone */
    }
    setTimeout(() => pop(), 420);
  };

  useEffect(() => {
    const frame = frameRef.current;
    const id = ids[index];
    if (!frame || !id) {
      setPhaseBoth('error');
      return;
    }
    let alive = true;
    S.started = false;
    S.muted = false;
    setMuted(false);
    setPhaseBoth('loading');
    setTime(0);
    setDuration(0);

    const next = () => {
      if (!alive) return;
      if (index + 1 < ids.length) setIndex(index + 1);
      else setPhaseBoth('error');
    };
    const startTimer = setTimeout(() => {
      if (!S.started) next();
    }, START_TIMEOUT_MS);
    let nudge: ReturnType<typeof setTimeout> | null = null;

    loadApi()
      .then((YT) => {
        if (!alive) return;
        const p = new YT.Player(frame, {
          events: {
            onReady: () => {
              if (!alive) return;
              p.playVideo();
              // Engines that refuse sound without a key press still allow a muted start.
              nudge = setTimeout(() => {
                if (alive && !S.started) {
                  S.muted = true;
                  setMuted(true);
                  p.mute();
                  p.playVideo();
                }
              }, 2500);
            },
            onStateChange: (e) => {
              if (!alive || S.closing) return;
              if (e.data === 1) {
                S.started = true;
                setPhaseBoth('playing');
                if (S.controls) wake();
              } else if (e.data === 2 && S.started) {
                setPhaseBoth('paused');
                wake();
              } else if (e.data === 0) {
                finish();
              }
            },
            // Not found, removed, or not allowed to play embedded: try the title's next trailer.
            onError: () => next(),
          },
        });
        player.current = p;
      })
      .catch(() => {
        if (alive) setPhaseBoth('error');
      });

    return () => {
      alive = false;
      clearTimeout(startTimer);
      if (nudge) clearTimeout(nudge);
      try {
        player.current?.destroy();
      } catch {
        /* the frame is already gone */
      }
      player.current = null;
    };
  }, [index]);

  // Clock, and leaving a moment before the very end so no end screen is ever shown.
  useEffect(() => {
    const tick = setInterval(() => {
      const p = player.current;
      if (!p || !S.started || S.closing) return;
      try {
        const cur = p.getCurrentTime() || 0;
        const dur = p.getDuration() || 0;
        if (S.controls) {
          setTime(cur);
          setDuration(dur);
        }
        if (dur > 0 && cur >= dur - 0.7) finish();
      } catch {
        /* player not ready */
      }
    }, 250);
    return () => {
      clearInterval(tick);
      if (S.hideTimer) clearTimeout(S.hideTimer);
      if (S.seekTimer) clearTimeout(S.seekTimer);
    };
  }, []);

  // With nothing to play, the only thing to do is leave: put focus there.
  useEffect(() => {
    if (phase === 'error') focusEl(backRef.current);
  }, [phase]);

  const commitSeek = () => {
    S.seekTimer = null;
    const target = S.pendingSeek;
    S.pendingSeek = null;
    setScrubTo(null);
    if (target === null || !player.current) return;
    player.current.seekTo(target, true);
    setTime(target);
    wake();
  };

  const seekBy = (dir: -1 | 1) => {
    const p = player.current;
    if (!p || !S.started) return;
    const dur = p.getDuration() || 0;
    if (dur <= 0) return;
    const now = Date.now();
    S.seekStreak = now - S.lastSeekKey < 600 ? S.seekStreak + 1 : 0;
    S.lastSeekKey = now;
    const mult = S.seekStreak > 10 ? 3 : 1;
    const base = S.pendingSeek ?? p.getCurrentTime();
    const target = Math.max(0, Math.min(dur - 2, base + dir * 10 * mult));
    S.pendingSeek = target;
    setScrubTo(target);
    setDuration(dur);
    if (S.seekTimer) clearTimeout(S.seekTimer);
    S.seekTimer = setTimeout(commitSeek, 420);
    wake();
  };

  const togglePlay = () => {
    const p = player.current;
    if (!p || !S.started) return;
    if (S.muted) {
      S.muted = false;
      setMuted(false);
      p.unMute();
    } else if (p.getPlayerState() === 1) p.pauseVideo();
    else p.playVideo();
    wake();
  };

  useEffect(() => {
    if (!active) return;
    focusEl(scrubRef.current);
    const offKey = addKeyHandler((_e: KeyboardEvent, action: Action) => {
      if (overlays.value.length > 0 || action === 'back') return false;
      if (S.phase === 'error') return false;
      if (S.phase === 'ending') return true;
      const onScrub = getFocused() === scrubRef.current;
      switch (action) {
        case 'playpause':
          togglePlay();
          return true;
        case 'play':
          player.current?.playVideo();
          return true;
        case 'pause':
          player.current?.pauseVideo();
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
          wake();
          return false;
        case 'select':
          if (!S.controls || onScrub) {
            if (S.pendingSeek !== null) {
              if (S.seekTimer) clearTimeout(S.seekTimer);
              commitSeek();
            } else togglePlay();
            return true;
          }
          wake();
          return false;
        case 'up':
        case 'down':
          if (!S.controls) {
            wake(true);
            return true;
          }
          wake();
          return false;
      }
      return false;
    });
    const offBack = addBackHandler(() => {
      if (S.controls && S.phase === 'playing') {
        hide();
        return true;
      }
      finish();
      return true;
    });
    return () => {
      offKey();
      offBack();
    };
  }, [active]);

  const id = ids[index];
  const shown = scrubTo ?? time;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;
  const covered = phase === 'loading' || phase === 'ending' || phase === 'error';
  const visible = (controls || phase === 'paused') && !covered;

  return (
    <div class={'screen screen-player screen-trailer' + (visible ? ' controls-on' : '')} data-focus-group="">
      {id && phase !== 'error' && (
        <iframe
          key={id}
          ref={frameRef}
          class="trailer-frame"
          src={embedUrl(id)}
          title={title}
          tabIndex={-1}
          allow="autoplay; encrypted-media"
          referrerpolicy="strict-origin-when-cross-origin"
        />
      )}
      {/* Keeps the remote's focus (and any pointer) on our layer rather than inside the embed. */}
      <div class={'trailer-shield' + (phase === 'paused' ? ' trailer-shield-dim' : '')} />

      {/* The title's artwork: the trailer fades in out of it and back into it. */}
      <div class={'trailer-cover' + (covered ? ' trailer-cover-on' : '')}>
        <div class="trailer-cover-art">
          <Img src={art} />
        </div>
        <div class="trailer-cover-shade" />
        <div class="trailer-cover-body">
          {logo ? <Img class="details-logo" src={logo} alt={title} /> : null}
          <h1 class={'details-title' + (logo ? ' hero-title-backup' : '')}>{title}</h1>
          <div class="trailer-cover-label">{t('trailer.label')}</div>
          {phase === 'loading' && <div class="spinner trailer-spinner" />}
          {phase === 'error' && (
            <>
              <div class="trailer-cover-error">{t('trailer.unavailable.title')}</div>
              <div class="trailer-cover-note">{t('trailer.unavailable.message')}</div>
            </>
          )}
        </div>
      </div>

      <div class={'player-top' + (covered ? ' player-top-show' : '')} data-inert={visible || covered ? undefined : ''}>
        <Focusable class="side-pill side-pill-back player-back" label={t('common.back')} elRef={(el) => (backRef.current = el)} onSelect={finish}>
          <span class="side-pill-icon">
            <Icon name="chevronLeft" class="side-pill-arrow" />
          </span>
          <span class="side-pill-label">{t('common.back')}</span>
        </Focusable>
        {!covered && (
          <>
            <div class="player-title">{title}</div>
            <div class="player-subtitle">{t('trailer.label')}</div>
          </>
        )}
      </div>

      <div class="player-bottom" style={{ display: phase === 'error' ? 'none' : undefined }} data-inert={covered ? '' : undefined}>
        <div class="scrub-row">
          <span class="scrub-time">{clock(shown)}</span>
          <Focusable class="scrub" elRef={(el) => (scrubRef.current = el)} role="slider" label={t('player.seek')} isDefault>
            <div class="scrub-fill" style={{ width: pct + '%' }} />
            <div class="scrub-knob" style={{ insetInlineStart: pct + '%' }} />
          </Focusable>
          <span class="scrub-time">{duration > 0 ? '-' + clock(duration - shown) : '--:--'}</span>
        </div>
        <div class="player-buttons" data-focus-group="">
          <Focusable class="pbtn" onSelect={togglePlay} label={t('common.play')}>
            <Icon name={phase === 'paused' ? 'play' : 'pause'} />
          </Focusable>
          <Focusable
            class="pbtn"
            label={t('details.startOver')}
            onSelect={() => {
              player.current?.seekTo(0, true);
              wake();
            }}
          >
            <Icon name="restart" />
          </Focusable>
          <span class="pbtn-gap" />
          {muted && <span class="trailer-hint">{t('trailer.unmute')}</span>}
        </div>
      </div>
    </div>
  );
}
