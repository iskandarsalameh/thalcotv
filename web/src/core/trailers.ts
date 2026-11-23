// Trailers. Metadata add-ons (Cinemeta first among them) list a title's
// official trailers as YouTube video ids, which is as dependable a source as
// exists without an API key of our own. They are played with YouTube's
// embedded player.

import type { Meta } from './types';
import { CINEMETA_URL, baseUrlOf, fetchResource } from './addons';

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** YouTube ids found on a title, proper trailers first, without duplicates. */
export function trailerIds(meta: Pick<Meta, 'trailers' | 'trailerStreams'> | null | undefined): string[] {
  if (!meta) return [];
  const first: string[] = [];
  const rest: string[] = [];
  for (const t of meta.trailers ?? []) {
    if (!t || typeof t.source !== 'string' || !YT_ID.test(t.source)) continue;
    (/trailer/i.test(t.type ?? '') ? first : rest).push(t.source);
  }
  for (const t of meta.trailerStreams ?? []) {
    if (t && typeof t.ytId === 'string' && YT_ID.test(t.ytId)) rest.push(t.ytId);
  }
  return Array.from(new Set(first.concat(rest))).slice(0, 5);
}

/**
 * Trailers for a title. When the add-on that described it has none and the
 * title has an IMDb id, Cinemeta is asked directly.
 */
export async function findTrailers(meta: Meta, signal?: AbortSignal): Promise<string[]> {
  const own = trailerIds(meta);
  if (own.length || !/^tt\d+/.test(meta.id)) return own;
  try {
    const url = `${baseUrlOf(CINEMETA_URL)}/meta/${encodeURIComponent(meta.type)}/${encodeURIComponent(meta.id)}.json`;
    const res = await fetchResource<{ meta?: Meta }>(url, { ttl: 60 * 60 * 1000, signal, timeout: 8000 });
    return trailerIds(res?.meta);
  } catch {
    return [];
  }
}
