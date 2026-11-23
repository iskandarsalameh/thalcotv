// Language code helpers. Add-ons and media files mix ISO 639-1 ("en"),
// 639-2/B ("fre"), 639-2/T ("fra"), BCP 47 ("pt-BR") and plain names, so
// everything is normalised to a 639-2/T style three letter code.

interface Lang {
  /** 639-2/T */
  code: string;
  /** 639-1 */
  two: string;
  /** Alternative codes (639-2/B, common variants). */
  alt?: string[];
  name: string;
  native: string;
}

const LANGS: Lang[] = [
  { code: 'eng', two: 'en', name: 'English', native: 'English' },
  { code: 'ara', two: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'spa', two: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fra', two: 'fr', alt: ['fre'], name: 'French', native: 'Français' },
  { code: 'deu', two: 'de', alt: ['ger'], name: 'German', native: 'Deutsch' },
  { code: 'ita', two: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'por', two: 'pt', alt: ['pob', 'pt-br', 'pt-pt'], name: 'Portuguese', native: 'Português' },
  { code: 'rus', two: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'tur', two: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'hin', two: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'urd', two: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'fas', two: 'fa', alt: ['per'], name: 'Persian', native: 'فارسی' },
  { code: 'heb', two: 'he', alt: ['iw'], name: 'Hebrew', native: 'עברית' },
  { code: 'zho', two: 'zh', alt: ['chi', 'zht', 'zhe', 'zh-cn', 'zh-tw', 'cmn'], name: 'Chinese', native: '中文' },
  { code: 'jpn', two: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'kor', two: 'ko', name: 'Korean', native: '한국어' },
  { code: 'nld', two: 'nl', alt: ['dut'], name: 'Dutch', native: 'Nederlands' },
  { code: 'pol', two: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'swe', two: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'nor', two: 'no', alt: ['nob', 'nno', 'nb'], name: 'Norwegian', native: 'Norsk' },
  { code: 'dan', two: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'fin', two: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'ell', two: 'el', alt: ['gre'], name: 'Greek', native: 'Ελληνικά' },
  { code: 'ces', two: 'cs', alt: ['cze'], name: 'Czech', native: 'Čeština' },
  { code: 'slk', two: 'sk', alt: ['slo'], name: 'Slovak', native: 'Slovenčina' },
  { code: 'hun', two: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'ron', two: 'ro', alt: ['rum'], name: 'Romanian', native: 'Română' },
  { code: 'bul', two: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'ukr', two: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'srp', two: 'sr', alt: ['scc'], name: 'Serbian', native: 'Српски' },
  { code: 'hrv', two: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'slv', two: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'bos', two: 'bs', name: 'Bosnian', native: 'Bosanski' },
  { code: 'mkd', two: 'mk', alt: ['mac'], name: 'Macedonian', native: 'Македонски' },
  { code: 'sqi', two: 'sq', alt: ['alb'], name: 'Albanian', native: 'Shqip' },
  { code: 'lit', two: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lav', two: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'est', two: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'ind', two: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'msa', two: 'ms', alt: ['may'], name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'tha', two: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'vie', two: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'fil', two: 'tl', alt: ['tgl'], name: 'Filipino', native: 'Filipino' },
  { code: 'ben', two: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'tam', two: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'tel', two: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'mal', two: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'kan', two: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'mar', two: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'pan', two: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'cat', two: 'ca', name: 'Catalan', native: 'Català' },
  { code: 'eus', two: 'eu', alt: ['baq'], name: 'Basque', native: 'Euskara' },
  { code: 'glg', two: 'gl', name: 'Galician', native: 'Galego' },
  { code: 'isl', two: 'is', alt: ['ice'], name: 'Icelandic', native: 'Íslenska' },
  { code: 'kur', two: 'ku', name: 'Kurdish', native: 'Kurdî' },
  { code: 'hye', two: 'hy', alt: ['arm'], name: 'Armenian', native: 'Հայերեն' },
  { code: 'kat', two: 'ka', alt: ['geo'], name: 'Georgian', native: 'ქართული' },
  { code: 'aze', two: 'az', name: 'Azerbaijani', native: 'Azərbaycanca' },
  { code: 'swa', two: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'afr', two: 'af', name: 'Afrikaans', native: 'Afrikaans' },
];

const INDEX = new Map<string, Lang>();
for (const l of LANGS) {
  INDEX.set(l.code, l);
  INDEX.set(l.two, l);
  INDEX.set(l.name.toLowerCase(), l);
  INDEX.set(l.native.toLowerCase(), l);
  (l.alt ?? []).forEach((a) => INDEX.set(a, l));
}

function lookup(input: string | null | undefined): Lang | undefined {
  if (!input) return undefined;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return undefined;
  return INDEX.get(raw) ?? INDEX.get(raw.split(/[-_ ]/)[0]);
}

/** Normalise any language tag to a three letter code. Unknown tags pass through lowercased. */
export function normLang(input: string | null | undefined): string {
  const l = lookup(input);
  if (l) return l.code;
  return input ? String(input).trim().toLowerCase() : '';
}

export function langName(input: string | null | undefined, native = true): string {
  const l = lookup(input);
  if (l) return native ? l.native : l.name;
  if (!input) return '';
  const s = String(input).trim();
  return s.length <= 3 ? s.toUpperCase() : s;
}

export function langTwo(input: string | null | undefined): string {
  return lookup(input)?.two ?? '';
}

export function sameLang(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normLang(a);
  return na !== '' && na === normLang(b);
}

/** Languages offered in pickers, most widely spoken first. */
export function languageChoices(): { code: string; name: string }[] {
  return LANGS.map((l) => ({ code: l.code, name: l.native }));
}

/** Countries' flag emoji and words that stream add-ons use to advertise audio languages. */
const STREAM_HINTS: [RegExp, string][] = [
  [/🇬🇧|🇺🇸|\benglish\b|\beng\b/i, 'eng'],
  [/🇸🇦|🇪🇬|🇦🇪|\barabic\b/i, 'ara'],
  [/🇪🇸|🇲🇽|\bspanish\b|\bespa[nñ]ol\b|\blatino\b|\bcastellano\b/i, 'spa'],
  [/🇫🇷|\bfrench\b|\bfran[cç]ais\b|\bvff?\b|\btruefrench\b/i, 'fra'],
  [/🇩🇪|\bgerman\b|\bdeutsch\b/i, 'deu'],
  [/🇮🇹|\bitalian[o]?\b/i, 'ita'],
  [/🇵🇹|🇧🇷|\bportuguese\b|\bdublado\b|\bpt-br\b/i, 'por'],
  [/🇷🇺|\brussian\b|\brus\b/i, 'rus'],
  [/🇹🇷|\bturkish\b|\bt[uü]rk[cç]e\b/i, 'tur'],
  [/🇮🇳|\bhindi\b/i, 'hin'],
  [/🇯🇵|\bjapanese\b|\bjpn\b/i, 'jpn'],
  [/🇰🇷|\bkorean\b|\bkor\b/i, 'kor'],
  [/🇨🇳|🇹🇼|\bchinese\b|\bmandarin\b/i, 'zho'],
  [/🇳🇱|\bdutch\b/i, 'nld'],
  [/🇵🇱|\bpolish\b|\blektor\b/i, 'pol'],
  [/🇺🇦|\bukrainian\b/i, 'ukr'],
  [/🇮🇷|\bpersian\b|\bfarsi\b/i, 'fas'],
];

/** Languages a stream's free text claims to carry. 'multi' marks multi-audio releases. */
export function detectStreamLanguages(text: string): string[] {
  const out: string[] = [];
  for (const [re, code] of STREAM_HINTS) if (re.test(text)) out.push(code);
  if (/\bmulti\b|\bdual[ .-]?audio\b/i.test(text)) out.push('multi');
  return out;
}
