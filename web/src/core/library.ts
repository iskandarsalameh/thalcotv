// Library and watch tracking. The rules mirror Stremio's core so behaviour
// feels familiar:
//   * a video counts as watched once 70% of it has actually been played
//     (or playback reached the credits),
//   * finishing an episode moves "Continue Watching" on to the next one,
//   * finishing a movie removes it from "Continue Watching".
// Everything is local to the device; no account is involved.

import { signal } from '@preact/signals';
import type { LibraryItem, LibraryState, Meta, MetaPreview, Video } from './types';
import { readJSON, readRaw, removeRaw, writeJSON } from './storage';

export const WATCHED_THRESHOLD = 0.7;
export const CREDITS_THRESHOLD = 0.9;
/** Below this many ms there is nothing worth resuming. */
const MIN_RESUME_MS = 15000;

const INDEX_KEY = 'lib:index';
const itemKey = (id: string) => 'lib:item:' + id;

export const library = signal<Record<string, LibraryItem>>({});

function emptyState(): LibraryState {
  return {
    timeOffset: 0,
    duration: 0,
    videoId: null,
    lastWatched: 0,
    timesWatched: 0,
    timeWatched: 0,
    overallTimeWatched: 0,
    flaggedWatched: false,
    watched: [],
    offsets: {},
  };
}

export function initLibrary(): void {
  const ids = readJSON<string[]>(INDEX_KEY, []);
  const map: Record<string, LibraryItem> = {};
  for (const id of ids) {
    const item = readJSON<LibraryItem | null>(itemKey(id), null);
    if (item && item.id) {
      item.state = { ...emptyState(), ...item.state };
      if (!Array.isArray(item.state.watched)) item.state.watched = [];
      if (!item.state.offsets || typeof item.state.offsets !== 'object') item.state.offsets = {};
      map[id] = item;
    }
  }
  library.value = map;
}

const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty.size) return;
  const map = library.value;
  dirty.forEach((id) => {
    if (map[id]) writeJSON(itemKey(id), map[id]);
    else removeRaw(itemKey(id));
  });
  dirty.clear();
  writeJSON(INDEX_KEY, Object.keys(map));
}

/** Write pending changes now. Call when playback stops or the app is hidden. */
export function flushLibrary(): void {
  flush();
}

function commit(item: LibraryItem, immediate: boolean): void {
  item.modifiedAt = Date.now();
  library.value = { ...library.value, [item.id]: item };
  dirty.add(item.id);
  if (immediate) flush();
  else if (!flushTimer) flushTimer = setTimeout(flush, 4000);
}

export function getItem(id: string): LibraryItem | undefined {
  return library.value[id];
}

function fromMeta(meta: MetaPreview): LibraryItem {
  const now = Date.now();
  return {
    id: meta.id,
    type: meta.type,
    name: meta.name,
    poster: meta.poster,
    posterShape: meta.posterShape,
    background: meta.background,
    logo: meta.logo,
    year: yearOf(meta),
    saved: false,
    dismissed: false,
    addedAt: now,
    modifiedAt: now,
    state: emptyState(),
  };
}

export function yearOf(meta: MetaPreview): string {
  const raw = String(meta.releaseInfo ?? meta.year ?? '');
  const m = raw.match(/\d{4}/);
  return m ? m[0] : '';
}

/** Get the item for a title, creating a hidden ("temp") one if needed. */
function ensure(meta: MetaPreview): LibraryItem {
  const existing = library.value[meta.id];
  if (existing) {
    // Keep artwork fresh; add-ons improve their metadata over time.
    return {
      ...existing,
      name: meta.name || existing.name,
      poster: meta.poster ?? existing.poster,
      background: meta.background ?? existing.background,
      logo: meta.logo ?? existing.logo,
      state: { ...existing.state },
    };
  }
  return fromMeta(meta);
}

export function isSaved(id: string): boolean {
  return !!library.value[id]?.saved;
}

export function toggleSaved(meta: MetaPreview): boolean {
  const item = ensure(meta);
  item.saved = !item.saved;
  if (item.saved) item.addedAt = Date.now();
  commit(item, true);
  return item.saved;
}

export function removeItem(id: string): void {
  const map = { ...library.value };
  delete map[id];
  library.value = map;
  dirty.add(id);
  flush();
}

export function dismissFromContinue(id: string): void {
  const existing = library.value[id];
  if (!existing) return;
  commit({ ...existing, dismissed: true }, true);
}

export function clearLibrary(): void {
  const ids = Object.keys(library.value);
  library.value = {};
  ids.forEach((id) => removeRaw(itemKey(id)));
  writeJSON(INDEX_KEY, []);
  dirty.clear();
}

// ---- episode ordering ------------------------------------------------------

function seasonRank(v: Video): number {
  // Specials (season 0) sort after the regular seasons, as in Stremio.
  const s = typeof v.season === 'number' ? v.season : 1;
  return s === 0 ? Number.MAX_SAFE_INTEGER : s;
}

export function episodeNumber(v: Video): number {
  return typeof v.episode === 'number' ? v.episode : typeof v.number === 'number' ? v.number : 0;
}

export function sortVideos(videos: Video[] | undefined): Video[] {
  if (!videos) return [];
  return videos.slice().sort((a, b) => {
    const sa = seasonRank(a);
    const sb = seasonRank(b);
    if (sa !== sb) return sa - sb;
    const ea = episodeNumber(a);
    const eb = episodeNumber(b);
    if (ea !== eb) return ea - eb;
    return (Date.parse(a.released ?? '') || 0) - (Date.parse(b.released ?? '') || 0);
  });
}

export function isReleased(v: Video, now = Date.now()): boolean {
  if (!v.released) return true;
  const t = Date.parse(v.released);
  return isNaN(t) || t <= now;
}

export function seasonsOf(meta: Meta): number[] {
  const set = new Set<number>();
  (meta.videos ?? []).forEach((v) => set.add(typeof v.season === 'number' ? v.season : 1));
  return Array.from(set).sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
}

/** The episode that follows `videoId`, if it exists and has aired. */
export function nextVideo(meta: Meta, videoId: string | null, now = Date.now()): Video | null {
  if (!videoId) return null;
  const videos = sortVideos(meta.videos);
  const i = videos.findIndex((v) => v.id === videoId);
  if (i < 0 || i + 1 >= videos.length) return null;
  const current = videos[i];
  const next = videos[i + 1];
  // Don't roll from the last regular episode into the specials.
  if ((next.season ?? 1) === 0 && (current.season ?? 1) !== 0) return null;
  return isReleased(next, now) ? next : null;
}

export function videoTitle(v: Video): string {
  return v.title || v.name || '';
}

export function isSeriesLike(meta: Pick<Meta, 'type' | 'videos' | 'behaviorHints'>): boolean {
  if (meta.behaviorHints?.defaultVideoId) return false;
  return (meta.videos?.length ?? 0) > 1 || (meta.type === 'series' && (meta.videos?.length ?? 0) > 0);
}

// ---- watch state -----------------------------------------------------------

export function isVideoWatched(item: LibraryItem | undefined, videoId: string): boolean {
  return !!item && item.state.watched.includes(videoId);
}

export function isItemWatched(item: LibraryItem | undefined): boolean {
  return !!item && item.state.timesWatched > 0;
}

/** 0..1 progress of a specific video, 0 when never started. */
export function videoProgress(item: LibraryItem | undefined, videoId: string): number {
  if (!item) return 0;
  const st = item.state;
  let offset = 0;
  let duration = 0;
  if (st.videoId === videoId) {
    offset = st.timeOffset;
    duration = st.duration;
  } else if (st.offsets[videoId]) {
    [offset, duration] = st.offsets[videoId];
  }
  if (duration <= 0 || offset <= 1) return 0;
  return Math.min(1, offset / duration);
}

/** 0..1 progress of whatever is in flight for this title. */
export function itemProgress(item: LibraryItem | undefined): number {
  if (!item || !item.state.videoId) return 0;
  return videoProgress(item, item.state.videoId);
}

/** Milliseconds to start at when (re)opening a video. 0 = from the beginning. */
export function resumePoint(item: LibraryItem | undefined, videoId: string): number {
  if (!item) return 0;
  const st = item.state;
  let offset = 0;
  let duration = 0;
  if (st.videoId === videoId) {
    offset = st.timeOffset;
    duration = st.duration;
  } else if (st.offsets[videoId]) {
    [offset, duration] = st.offsets[videoId];
  }
  if (offset < MIN_RESUME_MS) return 0;
  if (duration > 0 && offset >= duration * CREDITS_THRESHOLD) return 0;
  return offset;
}

function markWatchedInState(st: LibraryState, videoId: string): void {
  if (!st.watched.includes(videoId)) st.watched = st.watched.concat(videoId);
}

export interface ProgressReport {
  meta: MetaPreview;
  videoId: string;
  timeMs: number;
  durationMs: number;
  /** Persist right away (pause, seek, stop) instead of on the next timer. */
  immediate?: boolean;
}

/** Called by the player every few seconds while a video plays. */
export function reportProgress(r: ProgressReport): void {
  if (!(r.durationMs > 0) || r.timeMs < 0) return;
  const item = ensure(r.meta);
  const st = item.state;
  const now = Date.now();

  if (st.videoId !== r.videoId) {
    // Park the previous video's position so it can be resumed later.
    if (st.videoId && st.timeOffset > MIN_RESUME_MS && st.duration > 0) {
      st.offsets = { ...st.offsets, [st.videoId]: [st.timeOffset, st.duration] };
    }
    st.videoId = r.videoId;
    st.overallTimeWatched += st.timeWatched;
    st.timeWatched = 0;
    st.flaggedWatched = st.watched.includes(r.videoId);
  } else {
    // Only steady playback counts as watch time: seeks are ignored.
    const delta = r.timeMs - st.timeOffset;
    if (delta > 0 && delta < 15000) {
      st.timeWatched += delta;
      st.overallTimeWatched += delta;
    }
  }

  st.timeOffset = Math.max(1, Math.floor(r.timeMs));
  st.duration = Math.floor(r.durationMs);
  st.lastWatched = now;
  if (st.offsets[r.videoId]) {
    const rest = { ...st.offsets };
    delete rest[r.videoId];
    st.offsets = rest;
  }
  item.dismissed = false;

  const watchedEnough = st.timeWatched > st.duration * WATCHED_THRESHOLD;
  const reachedCredits = st.timeOffset > st.duration * CREDITS_THRESHOLD;
  if (!st.flaggedWatched && (watchedEnough || reachedCredits)) {
    st.flaggedWatched = true;
    st.timesWatched += 1;
    markWatchedInState(st, r.videoId);
  }
  commit(item, !!r.immediate);
}

/**
 * Called when playback of a video ends or the player closes. If the viewer
 * reached the credits, line up the next episode (or clear the resume point).
 * Returns the next video when there is one to continue with.
 */
export function finishPlayback(meta: Meta, videoId: string): Video | null {
  const existing = library.value[meta.id];
  if (!existing) return null;
  const item: LibraryItem = { ...existing, state: { ...existing.state } };
  const st = item.state;
  let next: Video | null = null;
  if (st.videoId === videoId && st.duration > 0 && st.timeOffset > st.duration * CREDITS_THRESHOLD) {
    markWatchedInState(st, videoId);
    if (st.timesWatched === 0) st.timesWatched = 1;
    next = isSeriesLike(meta) ? nextVideo(meta, videoId) : null;
    st.overallTimeWatched += st.timeWatched;
    st.timeWatched = 0;
    st.flaggedWatched = false;
    if (next) {
      // timeOffset 1 keeps the title in Continue Watching, pointing at the next episode.
      st.videoId = next.id;
      st.timeOffset = 1;
      st.duration = 0;
      if (st.watched.includes(next.id)) st.flaggedWatched = true;
    } else {
      st.timeOffset = 0;
    }
  }
  commit(item, true);
  return next;
}

export function setVideoWatched(meta: Meta, videoId: string, watched: boolean): void {
  const item = ensure(meta);
  const st = item.state;
  if (watched) {
    markWatchedInState(st, videoId);
    st.lastWatched = st.lastWatched || Date.now();
  } else {
    st.watched = st.watched.filter((id) => id !== videoId);
  }
  if (st.offsets[videoId]) {
    const rest = { ...st.offsets };
    delete rest[videoId];
    st.offsets = rest;
  }
  reconcile(item, meta);
  commit(item, true);
}

export function setVideosWatched(meta: Meta, videoIds: string[], watched: boolean): void {
  const item = ensure(meta);
  const st = item.state;
  if (watched) {
    const set = new Set(st.watched);
    videoIds.forEach((id) => set.add(id));
    st.watched = Array.from(set);
    st.lastWatched = st.lastWatched || Date.now();
  } else {
    const drop = new Set(videoIds);
    st.watched = st.watched.filter((id) => !drop.has(id));
  }
  reconcile(item, meta);
  commit(item, true);
}

/** Mark a whole title watched/unwatched (movies, or every aired episode). */
export function setItemWatched(meta: Meta, watched: boolean): void {
  const item = ensure(meta);
  const st = item.state;
  if (isSeriesLike(meta)) {
    const aired = sortVideos(meta.videos).filter((v) => isReleased(v));
    if (watched) {
      st.watched = Array.from(new Set(st.watched.concat(aired.map((v) => v.id))));
    } else {
      st.watched = [];
      st.offsets = {};
    }
  } else if (watched) {
    markWatchedInState(st, videoIdForMovie(meta));
  } else {
    st.watched = [];
  }
  if (watched) {
    st.timesWatched = Math.max(1, st.timesWatched);
    st.lastWatched = Date.now();
    st.timeOffset = 0;
  } else {
    st.timesWatched = 0;
    st.timeOffset = 0;
    st.flaggedWatched = false;
  }
  commit(item, true);
}

export function videoIdForMovie(meta: Pick<Meta, 'id' | 'behaviorHints' | 'videos'>): string {
  return meta.behaviorHints?.defaultVideoId || (meta.videos?.length === 1 ? meta.videos[0].id : meta.id);
}

/** After a manual watched change, keep the resume pointer on the first unwatched episode. */
function reconcile(item: LibraryItem, meta: Meta): void {
  const st = item.state;
  if (!isSeriesLike(meta)) {
    st.timesWatched = st.watched.length ? Math.max(1, st.timesWatched) : 0;
    if (st.watched.length) st.timeOffset = 0;
    return;
  }
  st.timesWatched = st.watched.length ? Math.max(1, st.timesWatched) : 0;
  if (!st.videoId || !st.watched.includes(st.videoId)) return;
  let cursor: string | null = st.videoId;
  for (let guard = 0; guard < 5000 && cursor; guard++) {
    const next: Video | null = nextVideo(meta, cursor);
    if (!next) {
      st.timeOffset = 0;
      return;
    }
    if (!st.watched.includes(next.id)) {
      st.videoId = next.id;
      st.timeOffset = 1;
      st.duration = 0;
      st.timeWatched = 0;
      st.flaggedWatched = false;
      return;
    }
    cursor = next.id;
  }
}

/** The episode to offer when the user presses Play on a series. */
export function videoToPlay(meta: Meta, item: LibraryItem | undefined): Video | null {
  const videos = sortVideos(meta.videos);
  if (!videos.length) return null;
  if (item?.state.videoId && item.state.timeOffset > 0) {
    const current = videos.find((v) => v.id === item.state.videoId);
    if (current) return current;
  }
  const regular = videos.filter((v) => (v.season ?? 1) !== 0 && isReleased(v));
  const pool = regular.length ? regular : videos.filter((v) => isReleased(v));
  if (!pool.length) return videos[0];
  if (item && item.state.watched.length) {
    const firstUnwatched = pool.find((v) => !item.state.watched.includes(v.id));
    if (firstUnwatched) return firstUnwatched;
  }
  return pool[0];
}

export function rememberStream(id: string, lastStream: LibraryItem['lastStream']): void {
  const existing = library.value[id];
  if (!existing) return;
  commit({ ...existing, lastStream }, false);
}

export function rememberPrefs(id: string, prefs: LibraryItem['prefs']): void {
  const existing = library.value[id];
  if (!existing) return;
  commit({ ...existing, prefs: { ...existing.prefs, ...prefs } }, false);
}

// ---- lists -----------------------------------------------------------------

export function continueWatching(map = library.value): LibraryItem[] {
  return Object.keys(map)
    .map((id) => map[id])
    .filter((i) => i.type !== 'other' && !i.dismissed && i.state.timeOffset > 0)
    .sort((a, b) => b.state.lastWatched - a.state.lastWatched)
    .slice(0, 40);
}

export type LibrarySort = 'recent' | 'added' | 'name' | 'nameDesc' | 'year' | 'mostWatched';
export type LibraryFilter = 'all' | 'watched' | 'unwatched' | 'inProgress';

export function libraryList(
  opts: { type?: string; sort?: LibrarySort; filter?: LibraryFilter } = {},
  map = library.value,
): LibraryItem[] {
  let list = Object.keys(map)
    .map((id) => map[id])
    .filter((i) => i.saved);
  if (opts.type && opts.type !== 'all') list = list.filter((i) => i.type === opts.type);
  switch (opts.filter) {
    case 'watched':
      list = list.filter((i) => i.state.timesWatched > 0);
      break;
    case 'unwatched':
      list = list.filter((i) => i.state.timesWatched === 0 && i.state.timeOffset === 0);
      break;
    case 'inProgress':
      list = list.filter((i) => i.state.timeOffset > 0);
      break;
  }
  const byName = (a: LibraryItem, b: LibraryItem) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  switch (opts.sort ?? 'recent') {
    case 'name':
      list.sort(byName);
      break;
    case 'nameDesc':
      list.sort((a, b) => byName(b, a));
      break;
    case 'year':
      list.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || byName(a, b));
      break;
    case 'added':
      list.sort((a, b) => b.addedAt - a.addedAt);
      break;
    case 'mostWatched':
      list.sort(
        (a, b) =>
          b.state.overallTimeWatched + b.state.timeWatched - (a.state.overallTimeWatched + a.state.timeWatched) ||
          b.state.timesWatched - a.state.timesWatched,
      );
      break;
    default:
      list.sort(
        (a, b) => Math.max(b.state.lastWatched, b.addedAt) - Math.max(a.state.lastWatched, a.addedAt),
      );
  }
  return list;
}

export function libraryTypes(map = library.value): string[] {
  const set = new Set<string>();
  Object.keys(map).forEach((id) => {
    if (map[id].saved) set.add(map[id].type);
  });
  return Array.from(set);
}

export function exportLibrary(): string {
  return JSON.stringify({ v: 1, exportedAt: Date.now(), items: Object.values(library.value) });
}

/** For diagnostics only. */
export function libraryStorageBytes(): number {
  let total = 0;
  Object.keys(library.value).forEach((id) => {
    total += (readRaw(itemKey(id)) ?? '').length;
  });
  return total;
}
