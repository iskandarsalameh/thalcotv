import { useEffect, useRef, useState } from 'preact/hooks';
import { locale, t } from '../core/i18n';
import { Focusable } from '../ui/components/Focusable';
import { Icon } from '../ui/components/Icon';
import { overlays } from '../ui/overlay';
import { addKeyHandler, focusFirst, type Action } from '../nav/spatial';
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

/** YouTube's own player API, loaded the first time a trailer is opened. */
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
  if (/^https?:$/.test(location.protocol)) p.set('origin', location.origin);
  return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
}

const CONTROLS_MS = 4000;
const START_TIMEOUT_MS = 15000;

interface Props {
  active: boolean;
  title: string;
  ids: string[];
}

/**
 * Full-screen trailer. The video is YouTube's embedded player with its own
 * controls switched off; the remote drives it through YouTube's player API.
 * If a trailer refuses to play embedded, the next one for the title is tried.
 */
export function TrailerScreen({ active, title, ids }: Props) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'playing' | 'paused' | 'error'>('loading');
  const [controls, setControls] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const S = useRef({ started: false, muted: false, hideTimer: null as ReturnType<typeof setTimeout> | null, phase: 'loading' }).current;

  const wake = () => {
    setControls(true);
    if (S.hideTimer) clearTimeout(S.hideTimer);
    S.hideTimer = setTimeout(() => {
      if (S.phase === 'playing') setControls(false);
    }, CONTROLS_MS);
  };
  const setPhaseBoth = (p: 'loading' | 'playing' | 'paused' | 'error') => {
    S.phase = p;
    setPhase(p);
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
              // Browsers that refuse sound without a key press still allow a muted start.
              nudge = setTimeout(() => {
                if (alive && !S.started) {
                  S.muted = true;
                  p.mute();
                  p.playVideo();
                }
              }, 2500);
            },
            onStateChange: (e) => {
              if (!alive) return;
              if (e.data === 1) {
                S.started = true;
                setPhaseBoth('playing');
                wake();
              } else if (e.data === 2) {
                setPhaseBoth('paused');
                setControls(true);
              } else if (e.data === 0) {
                pop();
              }
            },
            // 2 bad id, 5 player error, 100 removed, 101/150 embedding not allowed, 153 no referrer.
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

  // Clock for the progress bar.
  useEffect(() => {
    const tick = setInterval(() => {
      const p = player.current;
      if (!p || !S.started) return;
      try {
        setTime(p.getCurrentTime() || 0);
        setDuration(p.getDuration() || 0);
      } catch {
        /* player not ready */
      }
    }, 500);
    return () => {
      clearInterval(tick);
      if (S.hideTimer) clearTimeout(S.hideTimer);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    focusFirst(rootRef.current);
    return addKeyHandler((_e: KeyboardEvent, action: Action) => {
      if (overlays.value.length > 0 || action === 'back') return false;
      const p = player.current;
      if (S.phase === 'error') return false;
      wake();
      if (!p || !S.started) return action !== 'select';
      switch (action) {
        case 'select':
        case 'playpause':
          if (S.muted) {
            S.muted = false;
            p.unMute();
          } else if (p.getPlayerState() === 1) p.pauseVideo();
          else p.playVideo();
          return true;
        case 'play':
          p.playVideo();
          return true;
        case 'pause':
          p.pauseVideo();
          return true;
        case 'left':
        case 'rewind':
          p.seekTo(Math.max(0, p.getCurrentTime() - 10), true);
          return true;
        case 'right':
        case 'forward':
          p.seekTo(p.getCurrentTime() + 10, true);
          return true;
        case 'up':
        case 'down':
          return true;
      }
      return false;
    });
  }, [active]);

  const id = ids[index];
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const visible = controls || phase !== 'playing';

  return (
    <div class={'screen screen-player screen-trailer' + (visible ? ' controls-on' : '')} data-focus-group="" ref={rootRef}>
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
      <div class="trailer-shield" />

      {phase === 'loading' && (
        <div class="player-center">
          <div class="spinner spinner-lg" />
          <div class="player-status">{t('trailer.loading')}</div>
        </div>
      )}

      {phase === 'error' && (
        <div class="player-center player-error">
          <Icon name="warn" class="empty-icon" />
          <div class="empty-title">{t('trailer.unavailable.title')}</div>
          <div class="empty-message">{t('trailer.unavailable.message')}</div>
        </div>
      )}

      <div class="player-top">
        <Focusable class="side-pill side-pill-back player-back" label={t('common.back')} isDefault onSelect={() => pop()}>
          <span class="side-pill-icon">
            <Icon name="chevronLeft" class="side-pill-arrow" />
          </span>
          <span class="side-pill-label">{t('common.back')}</span>
        </Focusable>
        <div class="player-title">{title}</div>
        <div class="player-subtitle">{t('trailer.label')}</div>
      </div>

      {phase !== 'error' && (
        <div class="player-bottom">
          <div class="scrub-row">
            <span class="scrub-time">{clock(time)}</span>
            <div class="scrub">
              <div class="scrub-fill" style={{ width: pct + '%' }} />
            </div>
            <span class="scrub-time">{duration > 0 ? '-' + clock(duration - time) : '--:--'}</span>
          </div>
          {S.muted && phase === 'playing' && <div class="trailer-hint">{t('trailer.unmute')}</div>}
        </div>
      )}
    </div>
  );
}
