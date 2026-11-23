// Thin, optional link to the native Vega shell that hosts this page in a
// WebView. Everything degrades to a no-op in a regular browser.

type NativeMessage =
  | { type: 'ready'; build: string }
  | { type: 'persist'; key: string; value: string | null }
  | { type: 'exit' }
  | { type: 'playing'; active: boolean }
  | { type: 'log'; level: string; message: string }
  | { type: 'nativePlay'; payload: NativePlayRequest }
  | { type: 'nativeStop' };

export interface NativePlayRequest {
  url: string;
  title: string;
  subtitle?: string;
  /** Seconds. */
  startAt: number;
  /** Subtitle cues already decoded and parsed: [startMs, endMs, plain text]. */
  cues: { s: number; e: number; t: string }[];
  subtitlesOn: boolean;
  hasNext: boolean;
  seekStep: number;
}

interface ShellInfo {
  /** The shell has a native video player for formats the WebView cannot decode. */
  nativePlayer?: boolean;
  shell?: string;
  shellVersion?: string;
  platform?: string;
  store?: Record<string, string>;
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
    __THALCO_SHELL__?: ShellInfo;
  }
}

type Listener = (msg: { type: string; [k: string]: unknown }) => void;
const listeners = new Set<Listener>();

function post(msg: NativeMessage): boolean {
  try {
    const rn = window.ReactNativeWebView;
    if (rn && typeof rn.postMessage === 'function') {
      rn.postMessage(JSON.stringify(msg));
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function onIncoming(ev: MessageEvent | Event): void {
  const data = (ev as MessageEvent).data;
  if (typeof data !== 'string' || data.charAt(0) !== '{') return;
  try {
    const msg = JSON.parse(data);
    if (msg && typeof msg.type === 'string' && msg.__thalco === true) {
      listeners.forEach((l) => l(msg));
    }
  } catch {
    /* not ours */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', onIncoming);
  // react-native-webview delivers to `document` on some platforms.
  document.addEventListener('message', onIncoming as EventListener);
}

export const nativeBridge = {
  get available(): boolean {
    return typeof window !== 'undefined' && !!window.ReactNativeWebView;
  },
  get info(): ShellInfo {
    return (typeof window !== 'undefined' && window.__THALCO_SHELL__) || {};
  },
  ready(build: string): void {
    post({ type: 'ready', build });
  },
  persist(key: string, value: string | null): void {
    post({ type: 'persist', key, value });
  },
  /** Ask the shell to close the app. Returns false when there is no shell. */
  exit(): boolean {
    return post({ type: 'exit' });
  },
  /** Lets the shell keep the screen awake while video is playing. */
  playing(active: boolean): void {
    post({ type: 'playing', active });
  },
  get nativePlayer(): boolean {
    return this.available && !!this.info.nativePlayer;
  },
  playNative(payload: NativePlayRequest): boolean {
    return post({ type: 'nativePlay', payload });
  },
  stopNative(): void {
    post({ type: 'nativeStop' });
  },
  log(level: string, message: string): void {
    post({ type: 'log', level, message });
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
