// Persistence layer. On the stick everything lives in the WebView's
// localStorage, and (when running inside the Vega shell) every write is also
// mirrored to the native side so data survives a WebView cache wipe.

import { nativeBridge } from './bridge';

const PREFIX = 'thalco:';
const memory = new Map<string, string>();
let localOk: boolean | null = null;

function hasLocal(): boolean {
  if (localOk !== null) return localOk;
  try {
    const probe = PREFIX + '__probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    localOk = true;
  } catch {
    localOk = false;
  }
  return localOk;
}

export function readRaw(key: string): string | null {
  const k = PREFIX + key;
  if (memory.has(k)) return memory.get(k)!;
  if (hasLocal()) {
    try {
      const v = window.localStorage.getItem(k);
      if (v !== null) memory.set(k, v);
      return v;
    } catch {
      return null;
    }
  }
  return null;
}

export function writeRaw(key: string, value: string): void {
  const k = PREFIX + key;
  memory.set(k, value);
  if (hasLocal()) {
    try {
      window.localStorage.setItem(k, value);
    } catch {
      // Quota exceeded: drop the response cache and retry once.
      try {
        clearByPrefix('cache:');
        window.localStorage.setItem(k, value);
      } catch {
        /* keep the in-memory copy */
      }
    }
  }
  if (!key.startsWith('cache:')) nativeBridge.persist(k, value);
}

export function removeRaw(key: string): void {
  const k = PREFIX + key;
  memory.delete(k);
  if (hasLocal()) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  if (!key.startsWith('cache:')) nativeBridge.persist(k, null);
}

export function clearByPrefix(prefix: string): void {
  const full = PREFIX + prefix;
  for (const k of Array.from(memory.keys())) if (k.startsWith(full)) memory.delete(k);
  if (!hasLocal()) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(full)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  writeRaw(key, JSON.stringify(value));
}

/**
 * Restore keys handed over by the native shell on startup. Only fills holes:
 * whatever the WebView already has is newer or equal.
 */
export function hydrateFromNative(snapshot: Record<string, string> | null | undefined): number {
  if (!snapshot) return 0;
  let restored = 0;
  for (const k of Object.keys(snapshot)) {
    if (!k.startsWith(PREFIX)) continue;
    const short = k.slice(PREFIX.length);
    if (readRaw(short) === null && typeof snapshot[k] === 'string') {
      memory.set(k, snapshot[k]);
      if (hasLocal()) {
        try {
          window.localStorage.setItem(k, snapshot[k]);
        } catch {
          /* ignore */
        }
      }
      restored++;
    }
  }
  return restored;
}

/** Everything worth backing up, for export and for the native mirror. */
export function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  if (hasLocal()) {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(PREFIX) && !k.startsWith(PREFIX + 'cache:')) {
          out[k] = window.localStorage.getItem(k) ?? '';
        }
      }
    } catch {
      /* ignore */
    }
  }
  memory.forEach((v, k) => {
    if (!k.startsWith(PREFIX + 'cache:')) out[k] = v;
  });
  return out;
}
