import { signal } from '@preact/signals';
import en from '../locales/en';
import { settings } from './settings';

export interface LocaleInfo {
  code: string;
  name: string;
  rtl?: boolean;
  load: () => Promise<{ default: Record<string, string> }>;
}

export const LOCALES: LocaleInfo[] = [
  { code: 'en', name: 'English', load: () => Promise.resolve({ default: en }) },
  { code: 'ar', name: 'العربية', rtl: true, load: () => import('../locales/ar') },
  { code: 'es', name: 'Español', load: () => import('../locales/es') },
  { code: 'fr', name: 'Français', load: () => import('../locales/fr') },
  { code: 'de', name: 'Deutsch', load: () => import('../locales/de') },
  { code: 'it', name: 'Italiano', load: () => import('../locales/it') },
  { code: 'pt', name: 'Português', load: () => import('../locales/pt') },
  { code: 'tr', name: 'Türkçe', load: () => import('../locales/tr') },
  { code: 'ru', name: 'Русский', load: () => import('../locales/ru') },
];

export const locale = signal('en');
const dict = signal<Record<string, string>>(en);

export function detectLocale(): string {
  const langs = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  for (const l of langs) {
    const short = String(l).toLowerCase().split('-')[0];
    if (LOCALES.some((x) => x.code === short)) return short;
  }
  return 'en';
}

export async function applyLocale(): Promise<void> {
  const wanted = settings.value.uiLanguage === 'auto' ? detectLocale() : settings.value.uiLanguage;
  const info = LOCALES.find((l) => l.code === wanted) ?? LOCALES[0];
  try {
    const mod = await info.load();
    dict.value = mod.default;
    locale.value = info.code;
  } catch {
    dict.value = en;
    locale.value = 'en';
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale.value;
    document.documentElement.dir = LOCALES.find((l) => l.code === locale.value)?.rtl ? 'rtl' : 'ltr';
  }
}

export function isRtl(): boolean {
  return !!LOCALES.find((l) => l.code === locale.value)?.rtl;
}

/** Translate. `{name}` placeholders are filled from `params`. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dict.value[key] ?? (en as Record<string, string>)[key] ?? key;
  if (params) {
    for (const k of Object.keys(params)) s = s.split('{' + k + '}').join(String(params[k]));
  }
  return s;
}

/** Friendly label for a content type. */
export function typeLabel(type: string, plural = true): string {
  const key = 'type.' + type + (plural ? '.plural' : '');
  const s = t(key);
  if (s !== key) return s;
  return type.charAt(0).toUpperCase() + type.slice(1);
}
