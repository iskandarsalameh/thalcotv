// Actions shared by several screens: opening a title, starting playback,
// and the long-press menu on any poster.

import type { Meta, MetaPreview, Video } from '../core/types';
import { push } from '../nav/router';
import { hasStreamAddons } from '../core/streams';
import {
  dismissFromContinue,
  getItem,
  isItemWatched,
  isSaved,
  isSeriesLike,
  removeItem,
  setItemWatched,
  toggleSaved,
  videoIdForMovie,
  videoToPlay,
} from '../core/library';
import { fetchMeta } from '../core/catalogs';
import { confirm, openMenu, showToast, type MenuOption } from './overlay';
import { t } from '../core/i18n';

export function openDetails(preview: MetaPreview): void {
  push({ name: 'details', type: preview.type, id: preview.id, preview });
}

/** The id sent to stream add-ons: the episode id for series, the movie id otherwise. */
export function streamIdOf(meta: Meta, video: Video | null): string {
  return video ? video.id : videoIdForMovie(meta);
}

/**
 * Start playback of a title or episode. With `choose` the source list is
 * shown; otherwise the best source starts on its own when that setting is on.
 */
export async function play(meta: Meta, video: Video | null, opts: { choose?: boolean; startAt?: number; auto?: boolean } = {}): Promise<void> {
  const id = streamIdOf(meta, video);
  const embedded = video?.streams && video.streams.length > 0;
  if (!embedded && !hasStreamAddons(meta.type, id)) {
    const go = await confirm(t('streams.noAddons.title'), t('streams.noAddons.message'), t('streams.noAddons.open'), t('common.cancel'));
    if (go) push({ name: 'addons' });
    return;
  }
  push({ name: 'streams', meta, video, auto: opts.auto ?? !opts.choose, startAt: opts.startAt });
}

/** Play straight from a poster (Continue Watching): resolve metadata, pick the episode, go. */
export async function playFromPreview(preview: MetaPreview): Promise<void> {
  try {
    const meta = await fetchMeta(preview.type, preview.id);
    const video = isSeriesLike(meta) ? videoToPlay(meta, getItem(meta.id)) : null;
    await play(meta, video);
  } catch {
    openDetails(preview);
  }
}

export async function posterMenu(preview: MetaPreview, ctx: { continueWatching?: boolean } = {}): Promise<void> {
  const item = getItem(preview.id);
  const saved = isSaved(preview.id);
  const watched = isItemWatched(item);
  const options: MenuOption<string>[] = [
    { value: 'details', label: t('menu.details'), icon: 'info' },
    { value: 'play', label: t('menu.play'), icon: 'play' },
    { value: 'library', label: saved ? t('details.removeFromLibrary') : t('details.addToLibrary'), icon: saved ? 'check' : 'plus' },
    { value: 'watched', label: watched ? t('details.markUnwatched') : t('details.markWatched'), icon: 'eye' },
  ];
  if (ctx.continueWatching) options.push({ value: 'dismiss', label: t('menu.removeFromContinue'), icon: 'trash', destructive: true });
  const choice = await openMenu(preview.name, options);
  switch (choice) {
    case 'details':
      openDetails(preview);
      break;
    case 'play':
      void playFromPreview(preview);
      break;
    case 'library': {
      const now = toggleSaved(preview);
      showToast(now ? t('toast.added') : t('toast.removed'), now ? 'check' : undefined);
      break;
    }
    case 'watched':
      try {
        const meta = await fetchMeta(preview.type, preview.id);
        setItemWatched(meta, !watched);
        showToast(!watched ? t('toast.markedWatched') : t('toast.markedUnwatched'));
      } catch {
        showToast(t('error.generic'), 'warn');
      }
      break;
    case 'dismiss':
      if (item && !item.saved && item.state.timesWatched === 0) removeItem(preview.id);
      else dismissFromContinue(preview.id);
      break;
  }
}
