// Phone-to-TV pairing. The TV shows a QR code holding a one-time channel name
// and an encryption key; the phone page encrypts what the viewer pastes and
// posts it to a public relay; the TV picks it up and decrypts it.
//
// The relay (ntfy.sh) only ever carries ciphertext: the key travels in the
// URL fragment of the QR code, which browsers never send to any server.
// Add-on links often embed personal API keys, so this matters.

export const RELAY = 'https://ntfy.sh';

export type PairMessage =
  | { t: 'add'; url: string }
  | { t: 'ack'; ok: boolean; name?: string };

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toB64Url(buf);
}

export interface Channel {
  topic: string;
  key: string;
}

export function newChannel(): Channel {
  return { topic: 'thalco-' + randomToken(15), key: randomToken(16) };
}

/** `#t=<topic>&k=<key>[&c=<configure url>]`, appended to the phone page address. */
export function channelFragment(ch: Channel, configureUrl?: string): string {
  const p = new URLSearchParams();
  p.set('t', ch.topic);
  p.set('k', ch.key);
  if (configureUrl) p.set('c', configureUrl);
  return '#' + p.toString();
}

export function parseFragment(hash: string): { channel: Channel; configureUrl: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const topic = p.get('t') ?? '';
  const key = p.get('k') ?? '';
  if (!/^thalco-[A-Za-z0-9_-]{16,40}$/.test(topic) || !/^[A-Za-z0-9_-]{20,30}$/.test(key)) return null;
  const c = p.get('c') ?? '';
  return { channel: { topic, key }, configureUrl: /^https?:\/\//i.test(c) ? c : '' };
}

function importKey(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64Url(key) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(ch: Channel, message: PairMessage): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = new TextEncoder().encode(JSON.stringify(message));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(ch.key), data));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return toB64Url(packed);
}

/** Returns null for anything that was not sealed with this channel's key. */
export async function open(ch: Channel, sealed: string): Promise<PairMessage | null> {
  try {
    const packed = fromB64Url(sealed.trim());
    if (packed.length < 13) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, await importKey(ch.key), packed.slice(12));
    const msg = JSON.parse(new TextDecoder().decode(plain)) as PairMessage;
    if (msg && msg.t === 'add' && typeof msg.url === 'string' && msg.url.length < 3000) return msg;
    if (msg && msg.t === 'ack' && typeof msg.ok === 'boolean') return msg;
    return null;
  } catch {
    return null;
  }
}

export async function send(ch: Channel, message: PairMessage): Promise<void> {
  const body = await seal(ch, message);
  // The relay rate-limits by address; a short wait usually clears it.
  for (const waitMs of [0, 2500, 6000]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    const res = await fetch(`${RELAY}/${ch.topic}`, { method: 'POST', body });
    if (res.ok) return;
    if (res.status !== 429) throw new Error('relay answered ' + res.status);
  }
  throw new Error('relay is busy');
}

/**
 * Listen on the channel over one streaming connection (server-sent events)
 * and hand every message of the wanted kind to `onMessage`. A single stream
 * stays well inside the relay's limits, where repeated polling would not.
 * Returns a function that stops listening.
 */
export function listen<K extends PairMessage['t']>(
  ch: Channel,
  kind: K,
  onMessage: (msg: Extract<PairMessage, { t: K }>) => void,
  onState?: (online: boolean) => void,
): () => void {
  let stopped = false;
  let since = String(Math.floor(Date.now() / 1000) - 2);
  const seen = new Set<string>();
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 4000;

  const connect = () => {
    if (stopped) return;
    const es = new EventSource(`${RELAY}/${ch.topic}/sse?since=${encodeURIComponent(since)}`);
    source = es;
    es.onopen = () => {
      backoff = 4000;
      if (onState) onState(true);
    };
    es.onmessage = (e) => {
      let event: { id?: string; event?: string; message?: string };
      try {
        event = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (event.event !== 'message' || !event.id || !event.message || seen.has(event.id)) return;
      seen.add(event.id);
      since = event.id;
      void open(ch, event.message).then((msg) => {
        if (!stopped && msg && msg.t === kind) onMessage(msg as Extract<PairMessage, { t: K }>);
      });
    };
    es.onerror = () => {
      // Reconnect ourselves, slowly, instead of letting the browser hammer the relay.
      es.close();
      if (source === es) source = null;
      if (onState) onState(false);
      if (!stopped) {
        timer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    };
  };
  connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (source) source.close();
  };
}
