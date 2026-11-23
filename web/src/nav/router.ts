// Navigation model: a set of top-level tabs plus a stack of screens pushed on
// top (details, sources, player...). Back pops the stack; at the root it
// returns to the tab bar, then to Home, and finally asks before leaving.

import { signal, computed } from '@preact/signals';
import type { Meta, MetaPreview, RankedStream, Video } from '../core/types';
import type { CatalogRef } from '../core/catalogs';

export type TabId = 'search' | 'home' | 'movie' | 'series' | 'library' | 'settings';

export type Route =
  | { name: 'details'; type: string; id: string; preview?: MetaPreview; autoFocusVideoId?: string }
  | { name: 'streams'; meta: Meta; video: Video | null; /** Start the best source as soon as it is known. */ auto?: boolean; startAt?: number }
  | {
      name: 'player';
      meta: Meta;
      video: Video | null;
      /** Ranked candidates; playback starts at `index` and fails over down the list. */
      streams: RankedStream[];
      index: number;
      /** Start position in ms; undefined = resume point. */
      startAt?: number;
    }
  | { name: 'catalog'; ref: CatalogRef; title: string; genre?: string }
  | { name: 'trailer'; title: string; ids: string[]; art?: string; logo?: string }
  | { name: 'addons' }
  | { name: 'pair'; configureUrl?: string }
  | { name: 'addon'; transportUrl: string };

export interface StackEntry {
  key: number;
  route: Route;
}

let nextKey = 1;

export const tab = signal<TabId>('home');
export const stack = signal<StackEntry[]>([]);
export const top = computed<StackEntry | null>(() => {
  const s = stack.value;
  return s.length ? s[s.length - 1] : null;
});
/** Incremented when the visible screen changes, so it can restore focus. */
export const navTick = signal(0);

export function push(route: Route): void {
  stack.value = stack.value.concat({ key: nextKey++, route });
  navTick.value++;
}

/** Replace the top screen (e.g. sources -> player, or next episode). */
export function replace(route: Route): void {
  const s = stack.value.slice(0, -1);
  stack.value = s.concat({ key: nextKey++, route });
  navTick.value++;
}

export function pop(): boolean {
  if (!stack.value.length) return false;
  stack.value = stack.value.slice(0, -1);
  navTick.value++;
  return true;
}

export function popToRoot(): void {
  if (!stack.value.length) return;
  stack.value = [];
  navTick.value++;
}

export function switchTab(id: TabId): void {
  if (tab.value === id && !stack.value.length) return;
  stack.value = [];
  tab.value = id;
  navTick.value++;
}
