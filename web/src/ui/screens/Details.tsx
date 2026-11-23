import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Meta, MetaPreview, Video } from '../../core/types';
import { fetchMeta, formatRuntime, genresOf, ratingOf } from '../../core/catalogs';
import {
  episodeNumber,
  isItemWatched,
  isReleased,
  isSeriesLike,
  isVideoWatched,
  library,
  resumePoint,
  seasonsOf,
  setVideoWatched,
  setVideosWatched,
  sortVideos,
  toggleSaved,
  videoIdForMovie,
  videoProgress,
  videoTitle,
  videoToPlay,
} from '../../core/library';
import { locale, t } from '../../core/i18n';
import { Scroller } from '../components/Scroller';
import { Row } from '../components/Row';
import { WideCard } from '../components/Cards';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { Img } from '../components/Img';
import { EmptyState, Loading } from '../components/Overlays';
import { play } from '../actions';
import { openMenu, showToast } from '../overlay';
import { ensureFocus, focusFirst } from '../../nav/spatial';
import { pop, push } from '../../nav/router';
import { findTrailers, trailerIds } from '../../core/trailers';

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? t('time.hm', { h, m }) : t('time.m', { m: Math.max(1, m) });
}

function airDate(v: Video): string {
  if (!v.released) return '';
  const d = new Date(v.released);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

interface Props {
  active: boolean;
  type: string;
  id: string;
  preview?: MetaPreview;
}

export function DetailsScreen({ active, type, id, preview }: Props) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const episodesRef = useRef<HTMLDivElement>(null);
  const item = library.value[id];
  const wanted = useRef<{ choose: boolean; fromStart: boolean } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [trailers, setTrailers] = useState<string[]>(() => trailerIds(preview as Meta | undefined));

  // Trailers come with the metadata; ask Cinemeta when this title's add-on has none.
  useEffect(() => {
    if (!meta) return;
    const ctrl = new AbortController();
    setTrailers(trailerIds(meta));
    findTrailers(meta, ctrl.signal).then((ids) => !ctrl.signal.aborted && setTrailers(ids));
    return () => ctrl.abort();
  }, [meta]);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(false);
    fetchMeta(type, id, ctrl.signal)
      .then((m) => !ctrl.signal.aborted && setMeta(m))
      .catch(() => !ctrl.signal.aborted && setError(true));
    return () => ctrl.abort();
  }, [type, id]);

  const shown: MetaPreview | null = meta ?? preview ?? null;
  const series = meta ? isSeriesLike(meta) : false;
  const videos = useMemo(() => (meta ? sortVideos(meta.videos) : []), [meta]);
  const seasons = useMemo(() => (meta && series ? seasonsOf(meta) : []), [meta, series]);
  const upNext = meta && series ? videoToPlay(meta, item) : null;

  // Open on the season that holds the episode to continue with.
  useEffect(() => {
    if (!series || season !== null) return;
    setSeason(upNext?.season ?? seasons[0] ?? 1);
  }, [series, upNext?.id]);

  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [active, meta !== null, error]);

  if (!shown) {
    return (
      <div class="screen screen-details" data-focus-group="" ref={rootRef}>
        {error ? (
          <EmptyState icon="warn" title={t('error.loadFailed')} message={t('error.checkConnection')}>
            <Focusable class="btn btn-primary" onSelect={() => pop()}>
              {t('common.back')}
            </Focusable>
          </EmptyState>
        ) : (
          <Loading />
        )}
      </div>
    );
  }

  const movieVideoId = meta ? videoIdForMovie(meta) : id;
  const resumeId = series ? upNext?.id : movieVideoId;
  const resumeMs = resumeId ? resumePoint(item, resumeId) : 0;
  const watched = isItemWatched(item);
  const saved = !!item?.saved;
  const rating = ratingOf(shown);
  const facts = [shown.releaseInfo ?? '', formatRuntime(shown.runtime), genresOf(shown).slice(0, 3).join(' · ')].filter(Boolean);

  let playLabel = t('common.play');
  if (series && upNext) {
    const code = t('episode.code', { s: upNext.season ?? 1, e: episodeNumber(upNext) });
    playLabel = resumeMs > 0 ? t('details.resumeEpisode', { code }) : t('details.playEpisode', { code });
  } else if (resumeMs > 0) {
    playLabel = t('details.resume');
  }
  const progress = resumeId ? videoProgress(item, resumeId) : 0;
  const duration = item && resumeId && item.state.videoId === resumeId ? item.state.duration : 0;
  const remaining = resumeMs > 0 && duration > 0 ? formatClock(duration - resumeMs) : '';

  const startPlay = (choose: boolean, fromStart = false) => {
    if (!meta) {
      // Pressed before the details arrived: remember it and go as soon as they do.
      wanted.current = { choose, fromStart };
      return;
    }
    void play(meta, series ? upNext : null, { choose, startAt: fromStart ? 0 : undefined });
  };
  if (meta && wanted.current) {
    const w = wanted.current;
    wanted.current = null;
    setTimeout(() => startPlay(w.choose, w.fromStart), 0);
  }

  const episodeMenu = async (v: Video) => {
    if (!meta) return;
    const isW = isVideoWatched(item, v.id);
    const choice = await openMenu(videoTitle(v) || t('episode.code', { s: v.season ?? 1, e: episodeNumber(v) }), [
      { value: 'play', label: t('menu.play'), icon: 'play' },
      { value: 'sources', label: t('details.chooseSource'), icon: 'list' },
      { value: 'watched', label: isW ? t('details.markUnwatched') : t('details.markWatched'), icon: 'eye' },
      { value: 'previous', label: t('details.markPreviousWatched'), icon: 'check' },
      { value: 'season', label: t('details.markSeasonWatched'), icon: 'check' },
    ]);
    if (choice === 'play') void play(meta, v);
    else if (choice === 'sources') void play(meta, v, { choose: true });
    else if (choice === 'watched') setVideoWatched(meta, v.id, !isW);
    else if (choice === 'previous') {
      const idx = videos.findIndex((x) => x.id === v.id);
      setVideosWatched(meta, videos.slice(0, idx + 1).filter((x) => (x.season ?? 1) !== 0 || (v.season ?? 1) === 0).map((x) => x.id), true);
    } else if (choice === 'season') {
      setVideosWatched(meta, videos.filter((x) => (x.season ?? 1) === (v.season ?? 1) && isReleased(x)).map((x) => x.id), true);
    }
  };

  const seasonVideos = series && season !== null ? videos.filter((v) => (v.season ?? 1) === season) : [];
  const initialEpisode = Math.max(0, seasonVideos.findIndex((v) => v.id === upNext?.id));
  const people = [
    meta?.director?.length ? [t('details.director'), meta.director.slice(0, 3).join(', ')] : null,
    meta?.cast?.length ? [t('details.cast'), meta.cast.slice(0, 6).join(', ')] : null,
    meta?.writer?.length ? [t('details.writer'), meta.writer.slice(0, 3).join(', ')] : null,
    meta?.country ? [t('details.country'), meta.country] : null,
    meta?.awards ? [t('details.awards'), meta.awards] : null,
  ].filter((x): x is string[] => x !== null);

  return (
    <div class="screen screen-details" data-focus-group="" ref={rootRef}>
      <div class="backdrop">
        <Img src={shown.background || shown.poster} />
        <div class="backdrop-shade" />
        <div class={'backdrop-dim' + (scrolled ? ' backdrop-dim-on' : '')} />
      </div>
      <Scroller inset={8} onScrolled={setScrolled}>
        <section class="details-top" data-anchor="top">
          {shown.logo ? <Img class="details-logo" src={shown.logo} alt={shown.name} /> : null}
          <h1 class={'details-title' + (shown.logo ? ' hero-title-backup' : '')}>{shown.name}</h1>
          <div class="facts">
            {rating && (
              <span class="fact fact-rating">
                <Icon name="star" /> {rating}
              </span>
            )}
            {facts.map((f) => (
              <span class="fact" key={f}>
                {f}
              </span>
            ))}
            {watched && (
              <span class="fact fact-watched">
                <Icon name="check" /> {t('details.watched')}
              </span>
            )}
          </div>
          {shown.description && <p class="details-desc">{shown.description}</p>}
          {progress > 0 && resumeMs > 0 && (
            <div class="resume-line">
              <div class="progress progress-inline">
                <div class="progress-fill" style={{ width: Math.round(progress * 100) + '%' }} />
              </div>
              {remaining && <span>{t('details.remaining', { time: remaining })}</span>}
            </div>
          )}
          <div class="button-row" data-focus-group="">
            <Focusable class="btn btn-primary" isDefault onSelect={() => startPlay(false)} onLongPress={() => startPlay(true)}>
              <Icon name="play" /> {playLabel}
            </Focusable>
            {resumeMs > 0 && (
              <Focusable class="btn" onSelect={() => startPlay(false, true)}>
                <Icon name="restart" /> {t('details.startOver')}
              </Focusable>
            )}
            {trailers.length > 0 && (
              <Focusable class="btn" onSelect={() => push({ name: 'trailer', title: shown.name, ids: trailers })}>
                <Icon name="trailer" /> {t('details.trailer')}
              </Focusable>
            )}
            <Focusable class="btn" onSelect={() => startPlay(true)}>
              <Icon name="list" /> {t('details.sources')}
            </Focusable>
            <Focusable
              class="btn"
              onSelect={() => {
                const now = toggleSaved(shown);
                showToast(now ? t('toast.added') : t('toast.removed'), now ? 'check' : undefined);
              }}
            >
              <Icon name={saved ? 'check' : 'plus'} /> {saved ? t('details.inLibrary') : t('details.addToLibrary')}
            </Focusable>
          </div>
        </section>

        {series && seasons.length > 0 && (
          <section class="shelf" data-anchor="6">
            {seasons.length > 1 && (
              <div class="season-row" data-focus-group="">
                <Row
                  items={seasons}
                  itemWidth={11}
                  gap={1}
                  keyOf={(s) => String(s)}
                  initialIndex={Math.max(0, seasons.indexOf(season ?? seasons[0]) - 3)}
                  render={(s) => (
                    <Focusable
                      class={'chip chip-season' + (s === season ? ' chip-on' : '')}
                      isDefault={s === season}
                      onFocus={() => setSeason(s)}
                      onSelect={() => focusFirst(episodesRef.current)}
                    >
                      {s === 0 ? t('details.specials') : t('details.season', { n: s })}
                    </Focusable>
                  )}
                />
              </div>
            )}
            {seasons.length === 1 && <h2 class="shelf-title">{t('details.episodes')}</h2>}
            <div ref={episodesRef} key={season ?? -1}>
              <Row
                items={seasonVideos}
                itemWidth={26}
                keyOf={(v) => v.id}
                initialIndex={initialEpisode}
                render={(v, i) => {
                  const released = isReleased(v);
                  const prog = videoProgress(item, v.id);
                  const date = airDate(v);
                  return (
                    <WideCard
                      index={i}
                      isDefault={v.id === upNext?.id}
                      title={t('episode.numbered', { e: episodeNumber(v), title: videoTitle(v) || t('details.episode', { n: episodeNumber(v) }) })}
                      subtitle={released ? date : t('details.airs', { date: date || '?' })}
                      image={v.thumbnail}
                      fallback={String(episodeNumber(v))}
                      progress={prog}
                      watched={isVideoWatched(item, v.id) && prog === 0}
                      dim={!released}
                      onSelect={() => meta && void play(meta, v)}
                      onLongPress={() => void episodeMenu(v)}
                    />
                  );
                }}
              />
            </div>
          </section>
        )}

        {people.length > 0 && (
          <section class="shelf credits" data-anchor="6">
            <h2 class="shelf-title">{t('details.about')}</h2>
            <Focusable class="credits-card" role="group">
              {meta?.description && <p class="credits-desc">{meta.description}</p>}
              <dl>
                {people.map(([k, v]) => (
                  <div class="credit" key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </Focusable>
          </section>
        )}
        <div class="page-end" />
      </Scroller>
    </div>
  );
}
