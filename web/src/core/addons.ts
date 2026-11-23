// Add-on registry and transport. An add-on is nothing more than an HTTP
// endpoint that answers /{resource}/{type}/{id}/{extra}.json, exactly as in
// Stremio, so any Stremio add-on works here unchanged.

import { signal } from '@preact/signals';
import type {
  Addon,
  Manifest,
  ManifestCatalog,
  ManifestExtra,
  ManifestResource,
} from './types';
import { readJSON, readRaw, writeJSON, writeRaw, removeRaw } from './storage';

export const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
export const OPENSUBTITLES_URL = 'https://opensubtitles-v3.strem.io/manifest.json';
export const ADDON_CATALOG_URL = 'https://api.strem.io/addonscollection.json';

/** Installed out of the box. Metadata and subtitles only: no stream sources. */
export const DEFAULT_ADDON_URLS = [CINEMETA_URL, OPENSUBTITLES_URL];

const ADDONS_KEY = 'addons';
const DEFAULT_TIMEOUT = 12000;

export const addons = signal<Addon[]>([]);
/** Bumped whenever the installed set changes, so screens can refetch. */
export const addonsRevision = signal(0);

function persist(): void {
  writeJSON(ADDONS_KEY, addons.value);
  addonsRevision.value++;
}

export function normalizeManifestUrl(input: string): string {
  let url = input.trim();
  if (!url) throw new Error('empty');
  url = url.replace(/^stremio:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  // People paste configure pages or bare hosts as often as manifest links.
  const parsed = new URL(url);
  if (!/\/manifest\.json$/i.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/\/(configure)?\/?$/i, '') + '/manifest.json';
  }
  return parsed.toString();
}

export function baseUrlOf(addon: Addon | string): string {
  const url = typeof addon === 'string' ? addon : addon.transportUrl;
  return url.replace(/\/manifest\.json(\?.*)?$/i, '');
}

export async function fetchJSON<T>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT,
  signalIn?: AbortSignal,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signalIn) {
    if (signalIn.aborted) ctrl.abort();
    else signalIn.addEventListener('abort', onAbort);
  }
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    if (signalIn) signalIn.removeEventListener('abort', onAbort);
  }
}

export function validateManifest(m: unknown): Manifest {
  const man = m as Manifest;
  if (!man || typeof man !== 'object') throw new Error('not a manifest');
  if (typeof man.id !== 'string' || typeof man.name !== 'string') {
    throw new Error('manifest is missing id or name');
  }
  return {
    ...man,
    version: typeof man.version === 'string' ? man.version : '0.0.0',
    resources: Array.isArray(man.resources) ? man.resources : [],
    types: Array.isArray(man.types) ? man.types : [],
    catalogs: Array.isArray(man.catalogs) ? man.catalogs : [],
  };
}

export async function fetchManifest(url: string): Promise<Addon> {
  const transportUrl = normalizeManifestUrl(url);
  const manifest = validateManifest(await fetchJSON<Manifest>(transportUrl, 15000));
  return { transportUrl, manifest };
}

export function isInstalled(transportUrl: string): boolean {
  return addons.value.some((a) => a.transportUrl === transportUrl);
}

export function findInstalledById(id: string): Addon | undefined {
  return addons.value.find((a) => a.manifest.id === id);
}

export function installAddon(addon: Addon): void {
  const next = addons.value.filter(
    (a) => a.transportUrl !== addon.transportUrl && a.manifest.id !== addon.manifest.id,
  );
  next.push({ ...addon, installedAt: Date.now() });
  addons.value = next;
  persist();
}

export function uninstallAddon(transportUrl: string): void {
  addons.value = addons.value.filter((a) => a.transportUrl !== transportUrl);
  persist();
}

export function moveAddon(transportUrl: string, delta: number): void {
  const list = addons.value.slice();
  const i = list.findIndex((a) => a.transportUrl === transportUrl);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  const [item] = list.splice(i, 1);
  list.splice(j, 0, item);
  addons.value = list;
  persist();
}

/**
 * Load installed add-ons. On first run the defaults are installed; their
 * manifests are fetched in the background so launch never waits on the network.
 */
export async function initAddons(): Promise<void> {
  const stored = readJSON<Addon[] | null>(ADDONS_KEY, null);
  if (stored && Array.isArray(stored)) {
    addons.value = stored.filter((a) => a && a.transportUrl && a.manifest);
    void refreshManifests();
    return;
  }
  const results = await Promise.all(
    DEFAULT_ADDON_URLS.map((u) =>
      fetchManifest(u)
        .then((a) => ({ ...a, builtin: true, installedAt: Date.now() }) as Addon)
        .catch(() => null),
    ),
  );
  const ok = results.filter((a): a is Addon => a !== null);
  addons.value = ok;
  // Only remember the set when everything arrived, otherwise retry next launch.
  if (ok.length === DEFAULT_ADDON_URLS.length) persist();
  else addonsRevision.value++;
}

/** Re-read every manifest so new catalogs/resources show up without reinstalling. */
export async function refreshManifests(): Promise<void> {
  const last = Number(readRaw('addons:refreshed') || 0);
  if (Date.now() - last < 6 * 3600 * 1000) return;
  const current = addons.value;
  const updated = await Promise.all(
    current.map((a) =>
      fetchJSON<Manifest>(a.transportUrl, 10000)
        .then((m) => ({ ...a, manifest: validateManifest(m) }))
        .catch(() => a),
    ),
  );
  // The user may have changed the list while we were fetching.
  const byUrl = new Map(updated.map((a) => [a.transportUrl, a]));
  let changed = false;
  const merged = addons.value.map((a) => {
    const fresh = byUrl.get(a.transportUrl);
    if (fresh && JSON.stringify(fresh.manifest) !== JSON.stringify(a.manifest)) {
      changed = true;
      return fresh;
    }
    return a;
  });
  writeRaw('addons:refreshed', String(Date.now()));
  if (changed) {
    addons.value = merged;
    persist();
  }
}

export function resetAddons(): void {
  removeRaw(ADDONS_KEY);
  removeRaw('addons:refreshed');
  addons.value = [];
}

// ---- capability checks ----------------------------------------------------

function resourceEntry(m: Manifest, resource: string): ManifestResource | undefined {
  return (m.resources ?? []).find((r) => (typeof r === 'string' ? r : r.name) === resource);
}

/** Does this add-on claim to serve `resource` for the given type and id? */
export function supportsResource(m: Manifest, resource: string, type: string, id: string): boolean {
  const entry = resourceEntry(m, resource);
  if (!entry) return false;
  const types = typeof entry === 'string' ? m.types : (entry.types ?? m.types);
  const prefixes = typeof entry === 'string' ? m.idPrefixes : (entry.idPrefixes ?? m.idPrefixes);
  if (types && types.length && !types.includes(type)) return false;
  if (prefixes && prefixes.length && !prefixes.some((p) => id.startsWith(p))) return false;
  return true;
}

export function catalogExtras(c: ManifestCatalog): ManifestExtra[] {
  if (Array.isArray(c.extra)) return c.extra;
  const supported = c.extraSupported ?? [];
  const required = c.extraRequired ?? [];
  return supported.map((name) => ({ name, isRequired: required.includes(name) }));
}

export function catalogSupports(c: ManifestCatalog, extra: string): boolean {
  return catalogExtras(c).some((e) => e.name === extra);
}

/** A catalog that can be listed without the user supplying anything. */
export function catalogIsBrowsable(c: ManifestCatalog): boolean {
  return !catalogExtras(c).some((e) => e.isRequired);
}

/** Catalogs that need only a genre (e.g. Cinemeta "New" by year) are still usable in Discover. */
export function catalogRequiredExtras(c: ManifestCatalog): ManifestExtra[] {
  return catalogExtras(c).filter((e) => e.isRequired);
}

// ---- resource transport with a small cache --------------------------------

interface CacheEntry {
  t: number;
  ttl: number;
  data: unknown;
}

const memCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const MEM_LIMIT = 120;

function encodeExtra(extra: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.join('&');
}

export function resourceUrl(
  addon: Addon | string,
  resource: string,
  type: string,
  id: string,
  extra?: Record<string, string | number | undefined>,
): string {
  const extraStr = extra ? encodeExtra(extra) : '';
  return (
    baseUrlOf(addon) +
    '/' +
    resource +
    '/' +
    encodeURIComponent(type) +
    '/' +
    encodeURIComponent(id) +
    (extraStr ? '/' + extraStr : '') +
    '.json'
  );
}

export interface FetchOptions {
  /** Milliseconds a cached answer stays fresh. */
  ttl?: number;
  timeout?: number;
  /** Also keep the answer on disk so the next launch paints instantly. */
  persist?: boolean;
  signal?: AbortSignal;
  /** Skip caches. */
  force?: boolean;
}

/**
 * Fetch an add-on resource. Fresh cache hits return immediately; on a network
 * failure a stale copy is better than an empty screen, so it is used instead.
 */
export async function fetchResource<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const ttl = opts.ttl ?? 5 * 60 * 1000;
  const now = Date.now();
  if (!opts.force) {
    const hit = memCache.get(url);
    if (hit && now - hit.t < hit.ttl) return hit.data as T;
    if (opts.persist) {
      const disk = readJSON<CacheEntry | null>('cache:' + url, null);
      if (disk && now - disk.t < disk.ttl) {
        memCache.set(url, disk);
        return disk.data as T;
      }
    }
    const pending = inflight.get(url);
    if (pending) return pending as Promise<T>;
  }
  const p = fetchJSON<T>(url, opts.timeout ?? DEFAULT_TIMEOUT, opts.signal)
    .then((data) => {
      const entry: CacheEntry = { t: Date.now(), ttl, data };
      memCache.set(url, entry);
      if (memCache.size > MEM_LIMIT) {
        const first = memCache.keys().next().value;
        if (first !== undefined) memCache.delete(first);
      }
      if (opts.persist) writeJSON('cache:' + url, entry);
      return data;
    })
    .catch((err) => {
      const stale = memCache.get(url) ?? (opts.persist ? readJSON<CacheEntry | null>('cache:' + url, null) : null);
      if (stale) return stale.data as T;
      throw err;
    })
    .finally(() => {
      inflight.delete(url);
    });
  inflight.set(url, p);
  return p;
}

/** Synchronous peek used to paint a screen before the network answers. */
export function peekResource<T>(url: string, persisted = false): T | null {
  const hit = memCache.get(url);
  if (hit) return hit.data as T;
  if (persisted) {
    const disk = readJSON<CacheEntry | null>('cache:' + url, null);
    if (disk) return disk.data as T;
  }
  return null;
}

export function clearResourceCache(): void {
  memCache.clear();
}
