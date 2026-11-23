import { signal } from '@preact/signals';
import { readJSON, writeJSON } from './storage';

export interface Settings {
  /** UI language (BCP 47 short code). 'auto' follows the device. */
  uiLanguage: string;
  /** Preferred audio language, ISO 639-2 (e.g. 'eng'), or '' for the stream default. */
  audioLanguage: string;
  /** Preferred subtitle language, ISO 639-2, or '' for off. */
  subtitleLanguage: string;
  secondarySubtitleLanguage: string;
  /** Percent of the default size. */
  subtitleSize: number;
  subtitleColor: string;
  subtitleBackground: 'none' | 'shadow' | 'box';
  /** Percent from the bottom edge. */
  subtitleOffset: number;
  /** 0 = best available, otherwise cap vertical resolution (2160/1080/720/480). */
  maxQuality: number;
  /** Play the best source immediately instead of showing the source list. */
  autoPlayBest: boolean;
  /** Jump to another source automatically when the current one fails or stalls. */
  autoFailover: boolean;
  autoPlayNext: boolean;
  /** Seconds skipped by a single left/right press. */
  seekStep: number;
  /** Base URL of a Stremio streaming server on the network ('' = none). */
  streamingServerUrl: string;
  /** Hide catalogs flagged as adult by their add-on. */
  hideAdult: boolean;
  reduceMotion: boolean;
  /** Replace blurred glass with plain translucent surfaces (lighter on the GPU). */
  reduceTransparency: boolean;
  /** Target forward buffer in seconds for adaptive (HLS) streams. */
  bufferSeconds: number;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  uiLanguage: 'auto',
  audioLanguage: '',
  subtitleLanguage: '',
  secondarySubtitleLanguage: '',
  subtitleSize: 100,
  subtitleColor: '#ffffff',
  subtitleBackground: 'shadow',
  subtitleOffset: 8,
  maxQuality: 0,
  autoPlayBest: true,
  autoFailover: true,
  autoPlayNext: true,
  seekStep: 10,
  streamingServerUrl: '',
  hideAdult: true,
  reduceMotion: false,
  reduceTransparency: false,
  bufferSeconds: 60,
  onboarded: false,
};

const KEY = 'settings';

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS });

export function initSettings(): void {
  const stored = readJSON<Partial<Settings>>(KEY, {});
  settings.value = { ...DEFAULT_SETTINGS, ...stored };
}

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  writeJSON(KEY, settings.value);
}

export function resetSettings(): void {
  settings.value = { ...DEFAULT_SETTINGS, onboarded: true };
  writeJSON(KEY, settings.value);
}
