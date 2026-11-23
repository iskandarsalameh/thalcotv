// Browsing: home rows, discover (catalog + genre + paging), search and
// metadata lookup, all assembled from whatever add-ons are installed.

import type { Addon, ManifestCatalog, Meta, MetaPreview } from './types';
import {
  addons,
  catalogExtras,
  catalogRequiredExtras,
  catalogSupports,
  fetchResource,
  peekResource,
  resourceUrl,
  supportsResource,
} from './addons';
import { settings } from './settings';

export interface CatalogRef {
  key: string;
  addon: Addon;
  catalog: ManifestCatalog;
  /** Extra args always sent (e.g. the default year for a "New" catalog). */
  baseExtra: Record<string, string>;
}

export interface CatalogPage {
  items: MetaPreview[];
  hasMore: boolean;
}

const TYPE_ORDER = ['movie', 'series', 'anime', 'channel', 'tv'];

function typeRank(t: string): number {
  const i = TYPE_ORDER.indexOf(t);
  return i < 0 ? TYPE_ORDER.length : i;
}

function refKey(addon: Addon, c: ManifestCatalog): string {
  return addon.manifest.id + '|' + c.type + '|' + c.id;
}

function visibleAddons(): Addon[] {
  const hideAdult = settings.value.hideAdult;
  return addons.value.filter((a) => !(hideAdult && a.manifest.behaviorHints?.adult));
}

/**
 * Catalogs that can be shown as a row without asking the user anything.
 * A catalog whose only required extra is a `genre` with options (Cinemeta's
 * "New" is keyed by year) is included using its first option.
 */
export function browsableCatalogs(): CatalogRef[] {
  const out: CatalogRef[] = [];
  for (const addon of visibleAddons()) {
    for (const c of addon.manifest.catalogs ?? []) {
      if (!c || !c.id || !c.type) continue;
      const required = catalogRequiredExtras(c);
      const baseExtra: Record<string, string> = {};
      if (required.length) {
        const only = required[0];
        if (required.length > 1 || only.name !== 'genre' || !only.options?.length) continue;
        baseExtra.genre = only.options[0];
      }
      out.push({ key: refKey(addon, c), addon, catalog: c, baseExtra });
    }
  }
  return out;
}

/** Rows for the home screen, movies and series interleaved by add-on order. */
export function homeCatalogs(): CatalogRef[] {
  return browsableCatalogs();
}

export function catalogsForType(type: string): CatalogRef[] {
  return browsableCatalogs().filter((r) => r.catalog.type === type);
}

export function availableTypes(): string[] {
  const set = new Set<string>();
  browsableCatalogs().forEach((r) => set.add(r.catalog.type));
  return Array.from(set).sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b));
}

export function genreOptions(ref: CatalogRef): string[] {
  return catalogExtras(ref.catalog).find((e) => e.name === 'genre')?.options ?? [];
}

export function genreIsRequired(ref: CatalogRef): boolean {
  return catalogRequiredExtras(ref.catalog).some((e) => e.name === 'genre');
}

function cleanPreviews(metas: unknown): MetaPreview[] {
  if (!Array.isArray(metas)) return [];
  const seen = new Set<string>();
  const out: MetaPreview[] = [];
  for (const m of metas as MetaPreview[]) {
    if (!m || typeof m.id !== 'string' || !m.name || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

function catalogUrl(ref: CatalogRef, extra: Record<string, string | number | undefined>): string {
  return resourceUrl(ref.addon, 'catalog', ref.catalog.type, ref.catalog.id, { ...ref.baseExtra, ...extra });
}

export async function fetchCatalog(
  ref: CatalogRef,
  extra: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<CatalogPage> {
  const firstPage = !extra.skip && !extra.search;
  const res = await fetchResource<{ metas?: MetaPreview[]; hasMore?: boolean }>(catalogUrl(ref, extra), {
    ttl: 20 * 60 * 1000,
    persist: firstPage,
    signal,
  });
  const items = cleanPreviews(res?.metas);
  const pageable = catalogSupports(ref.catalog, 'skip');
  return { items, hasMore: pageable && (res?.hasMore ?? items.length >= 20) };
}

/** Last known first page, for painting the home screen before the network answers. */
export function peekCatalog(ref: CatalogRef): MetaPreview[] | null {
  const res = peekResource<{ metas?: MetaPreview[] }>(catalogUrl(ref, {}), true);
  return res ? cleanPreviews(res.metas) : null;
}

export interface SearchRow {
  ref: CatalogRef;
  items: MetaPreview[];
}

export function searchableCatalogs(): CatalogRef[] {
  const out: CatalogRef[] = [];
  for (const addon of visibleAddons()) {
    for (const c of addon.manifest.catalogs ?? []) {
      if (!c || !c.id || !c.type || !catalogSupports(c, 'search')) continue;
      // Skip catalogs that need something besides the search term.
      if (catalogRequiredExtras(c).some((e) => e.name !== 'search')) continue;
      out.push({ key: refKey(addon, c), addon, catalog: c, baseExtra: {} });
    }
  }
  return out.sort((a, b) => typeRank(a.catalog.type) - typeRank(b.catalog.type));
}

export async function search(
  query: string,
  onRow: (row: SearchRow) => void,
  signal?: AbortSignal,
): Promise<void> {
  const q = query.trim();
  if (!q) return;
  await Promise.all(
    searchableCatalogs().map((ref) =>
      fetchResource<{ metas?: MetaPreview[] }>(catalogUrl(ref, { search: q }), {
        ttl: 10 * 60 * 1000,
        signal,
        timeout: 15000,
      })
        .then((res) => {
          const items = cleanPreviews(res?.metas);
          if (items.length && !signal?.aborted) onRow({ ref, items });
        })
        .catch(() => undefined),
    ),
  );
}

/** Full metadata. Tries each capable add-on in order until one answers. */
export async function fetchMeta(type: string, id: string, signal?: AbortSignal): Promise<Meta> {
  const providers = addons.value.filter((a) => supportsResource(a.manifest, 'meta', type, id));
  let lastError: unknown = new Error('no add-on provides metadata for this title');
  for (const addon of providers) {
    try {
      const res = await fetchResource<{ meta?: Meta }>(resourceUrl(addon, 'meta', type, id), {
        ttl: 30 * 60 * 1000,
        signal,
      });
      if (res?.meta && res.meta.id) return { ...res.meta, type: res.meta.type || type };
    } catch (e) {
      lastError = e;
      if (signal?.aborted) break;
    }
  }
  throw lastError;
}

export function genresOf(m: MetaPreview): string[] {
  const g = m.genres ?? m.genre;
  return Array.isArray(g) ? g.filter((x) => typeof x === 'string') : [];
}

/** "2h 53m" from Cinemeta's "173 min". */
export function formatRuntime(runtime: string | undefined): string {
  if (!runtime) return '';
  const m = runtime.match(/(\d+)\s*min/i);
  if (!m) return runtime;
  const total = parseInt(m[1], 10);
  if (total < 60) return total + 'm';
  const h = Math.floor(total / 60);
  const min = total % 60;
  return min ? h + 'h ' + min + 'm' : h + 'h';
}

export function ratingOf(m: MetaPreview): string {
  const r = typeof m.imdbRating === 'number' ? m.imdbRating : parseFloat(String(m.imdbRating ?? ''));
  return r > 0 ? r.toFixed(1) : '';
}
