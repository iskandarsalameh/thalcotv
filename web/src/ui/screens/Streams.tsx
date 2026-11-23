import { useEffect, useRef, useState } from 'preact/hooks';
import type { Meta, RankedStream, Video } from '../../core/types';
import { loadStreams } from '../../core/streams';
import { episodeNumber, getItem, videoTitle } from '../../core/library';
import { settings } from '../../core/settings';
import { t } from '../../core/i18n';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { Img } from '../components/Img';
import { EmptyState, Spinner } from '../components/Overlays';
import { streamIdOf } from '../actions';
import { ensureFocus } from '../../nav/spatial';
import { pop, replace, switchTab } from '../../nav/router';

interface Props {
  active: boolean;
  meta: Meta;
  video: Video | null;
  auto?: boolean;
  startAt?: number;
}

/** How long to keep collecting after the first playable source shows up (auto mode). */
const AUTO_GRACE_MS = 3500;

export function StreamsScreen({ active, meta, video, auto, startAt }: Props) {
  const [streams, setStreams] = useState<RankedStream[]>([]);
  const [pending, setPending] = useState(1);
  const [sources, setSources] = useState(0);
  const [manual, setManual] = useState(!auto || !settings.value.autoPlayBest);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const latest = useRef<RankedStream[]>([]);

  const start = (list: RankedStream[], index: number) => {
    if (started.current) return;
    started.current = true;
    const playable = list.filter((s) => s.playable);
    const chosen = list[index];
    const at = Math.max(0, playable.indexOf(chosen));
    replace({ name: 'player', meta, video, streams: playable, index: at, startAt });
  };

  useEffect(() => {
    const id = streamIdOf(meta, video);
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const load = loadStreams(
      meta.type,
      id,
      getItem(meta.id)?.lastStream,
      (ranked, left, total) => {
        latest.current = ranked;
        setStreams(ranked);
        setPending(left);
        setSources(total);
        if (!manual && !graceTimer && ranked.some((s) => s.playable) && left > 0) {
          // Don't wait for slow add-ons forever once something good is in hand.
          graceTimer = setTimeout(() => {
            const first = latest.current.findIndex((s) => s.playable);
            if (first >= 0) start(latest.current, first);
          }, AUTO_GRACE_MS);
        }
      },
      video?.streams,
    );
    load.done.then((ranked) => {
      if (graceTimer) clearTimeout(graceTimer);
      if (manual || started.current) return;
      const first = ranked.findIndex((s) => s.playable);
      if (first >= 0) start(ranked, first);
      else setManual(true);
    });
    return () => {
      if (graceTimer) clearTimeout(graceTimer);
      load.cancel();
    };
  }, []);

  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [active, manual, streams.length > 0]);

  // Follow focus inside the scrolling list.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.stream');
      if (!el) return;
      const target = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
      list.scrollTop = Math.max(0, target);
    };
    list.addEventListener('focusin', onFocusIn);
    return () => list.removeEventListener('focusin', onFocusIn);
  }, [manual]);

  const heading = video
    ? t('episode.full', { s: video.season ?? 1, e: episodeNumber(video), title: videoTitle(video) })
    : (meta.releaseInfo ?? '');

  if (!manual) {
    return (
      <div class="screen screen-streams screen-center" data-focus-group="" ref={rootRef}>
        <div class="backdrop">
          <Img src={meta.background || meta.poster} />
          <div class="backdrop-shade backdrop-shade-strong" />
        </div>
        <div class="finding">
          <Spinner />
          <div class="finding-title">{t('streams.finding')}</div>
          <div class="finding-sub">{meta.name}{heading ? ' · ' + heading : ''}</div>
          <Focusable class="btn" autoFocus onSelect={() => setManual(true)}>
            <Icon name="list" /> {t('streams.showAll')}
          </Focusable>
        </div>
      </div>
    );
  }

  const playableCount = streams.filter((s) => s.playable).length;
  return (
    <div class="screen screen-streams" data-focus-group="" ref={rootRef}>
      <div class="backdrop">
        <Img src={meta.background || meta.poster} />
        <div class="backdrop-shade backdrop-shade-strong" />
      </div>
      <div class="streams-side">
        {meta.logo ? <Img class="details-logo" src={meta.logo} alt={meta.name} /> : null}
        <h1 class={'details-title' + (meta.logo ? ' hero-title-backup' : '')}>{meta.name}</h1>
        {heading && <div class="streams-sub">{heading}</div>}
        <div class="streams-count">
          {pending > 0 ? t('streams.searching', { done: sources - pending, total: sources }) : t('streams.count', { n: playableCount })}
        </div>
        <p class="streams-hint">{t('streams.hint')}</p>
      </div>
      <div class="streams-list" ref={listRef} data-focus-group="">
        {streams.length === 0 && pending > 0 && <Spinner label={t('streams.finding')} />}
        {streams.length === 0 && pending === 0 && (
          <EmptyState icon="warn" title={t('streams.none.title')} message={t('streams.none.message')}>
            <Focusable class="btn btn-primary" onSelect={() => switchTab('addons')}>
              {t('home.empty.action')}
            </Focusable>
            <Focusable class="btn" onSelect={() => pop()}>
              {t('common.back')}
            </Focusable>
          </EmptyState>
        )}
        {streams.map((s, i) => (
          <Focusable
            key={i}
            class={'stream' + (s.playable ? '' : ' stream-blocked')}
            isDefault={i === 0}
            onSelect={() => (s.playable ? start(streams, i) : undefined)}
          >
            <div class="stream-main">
              <div class="stream-label">
                {i === 0 && s.playable && <span class="tag tag-best">{t('streams.best')}</span>}
                {s.label}
              </div>
              {s.detail && <div class="stream-detail">{s.detail}</div>}
              {!s.playable && s.blockedReason && <div class="stream-blocked-reason">{t(s.blockedReason)}</div>}
            </div>
            <div class="stream-source">{s.addonName}</div>
          </Focusable>
        ))}
      </div>
    </div>
  );
}
