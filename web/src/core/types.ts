// Data shapes of the Stremio add-on protocol (https://github.com/Stremio/stremio-addon-sdk)
// plus Thalco TV's own persisted models. Add-ons are third-party HTTP services,
// so every field that comes from the network is treated as optional.

export type ContentType = 'movie' | 'series' | 'channel' | 'tv' | 'anime' | 'other' | string;

export interface ManifestExtra {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

export interface ManifestCatalog {
  type: ContentType;
  id: string;
  name?: string;
  extra?: ManifestExtra[];
  /** Legacy short notation. */
  extraSupported?: string[];
  extraRequired?: string[];
}

export type ManifestResource =
  | string
  | { name: string; types?: string[]; idPrefixes?: string[] };

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  background?: string;
  types?: string[];
  resources?: ManifestResource[];
  idPrefixes?: string[];
  catalogs?: ManifestCatalog[];
  behaviorHints?: {
    adult?: boolean;
    p2p?: boolean;
    configurable?: boolean;
    configurationRequired?: boolean;
  };
}

export interface Addon {
  /** URL of manifest.json. Doubles as the identity of the installation. */
  transportUrl: string;
  manifest: Manifest;
  /** Built-in add-ons can be disabled but not accidentally lost on reset. */
  builtin?: boolean;
  installedAt?: number;
}

export interface MetaLink {
  name: string;
  category: string;
  url?: string;
}

export interface Video {
  id: string;
  title?: string;
  name?: string;
  released?: string;
  season?: number;
  episode?: number;
  number?: number;
  thumbnail?: string;
  overview?: string;
  description?: string;
  streams?: Stream[];
  firstAired?: string;
}

export interface MetaPreview {
  id: string;
  type: ContentType;
  name: string;
  poster?: string;
  posterShape?: 'poster' | 'landscape' | 'square';
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string | number;
  genres?: string[];
  genre?: string[];
  runtime?: string;
  year?: string | number;
}

export interface Meta extends MetaPreview {
  cast?: string[];
  director?: string[];
  writer?: string[];
  country?: string;
  language?: string;
  awards?: string;
  links?: MetaLink[];
  videos?: Video[];
  trailers?: { source: string; type: string }[];
  trailerStreams?: { title?: string; ytId: string }[];
  behaviorHints?: {
    defaultVideoId?: string | null;
    hasScheduledVideos?: boolean;
  };
}

export interface SubtitleTrack {
  id: string;
  url: string;
  lang: string;
  /** Where the track came from (add-on name, "Embedded", ...). */
  origin?: string;
  label?: string;
}

export interface Stream {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  subtitles?: { id?: string; url: string; lang: string }[];
  sources?: string[];
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    countryWhitelist?: string[];
    proxyHeaders?: { request?: Record<string, string>; response?: Record<string, string> };
    videoHash?: string;
    videoSize?: number;
    filename?: string;
  };
}

/** A stream annotated with what we could learn about it for ranking and display. */
export interface RankedStream {
  stream: Stream;
  addonName: string;
  addonUrl: string;
  /** Vertical resolution guess: 2160, 1440, 1080, 720, 480, 360 or 0 when unknown. */
  quality: number;
  hdr: boolean;
  dolbyVision: boolean;
  /** Bytes, 0 when unknown. */
  size: number;
  seeders: number;
  codec: 'hevc' | 'h264' | 'av1' | 'vp9' | '';
  audio: string;
  container: 'mp4' | 'mkv' | 'webm' | 'hls' | 'dash' | 'avi' | '';
  /** Languages advertised in the stream text (ISO 639-1 codes). */
  languages: string[];
  kind: 'http' | 'torrent' | 'youtube' | 'external' | 'unknown';
  /** The video element probably cannot decode this without the native player or a transcoding server. */
  needsHelp: boolean;
  /** True when this device can attempt playback right now. */
  playable: boolean;
  /** Why it cannot play, as an i18n key. */
  blockedReason?: string;
  score: number;
  /** Lines to show on the card. */
  label: string;
  detail: string;
}

export interface LibraryState {
  /** Milliseconds into the current video. 0 means "nothing to resume". */
  timeOffset: number;
  /** Milliseconds; 0 when not known yet. */
  duration: number;
  /** Video currently being watched (episode id for series, meta id for movies). */
  videoId: string | null;
  /** Epoch ms of the last playback tick. */
  lastWatched: number;
  timesWatched: number;
  /** Accumulated ms actually played for the current video. */
  timeWatched: number;
  overallTimeWatched: number;
  /** Whether the current video already crossed the "watched" threshold. */
  flaggedWatched: boolean;
  /** Ids of watched videos (episodes). For movies this holds the meta id once watched. */
  watched: string[];
  /** Per-video resume points so every episode remembers where you left it. */
  offsets: Record<string, [offsetMs: number, durationMs: number]>;
}

export interface LibraryItem {
  id: string;
  type: ContentType;
  name: string;
  poster?: string;
  posterShape?: MetaPreview['posterShape'];
  background?: string;
  logo?: string;
  year?: string;
  /** True once the user explicitly added it to "My Library". */
  saved: boolean;
  /** Hidden from Continue Watching until it is played again. */
  dismissed: boolean;
  addedAt: number;
  modifiedAt: number;
  state: LibraryState;
  /** Remembered source so the next episode can reuse the same release. */
  lastStream?: { bingeGroup?: string; addonUrl?: string; quality?: number; label?: string };
  /** Remembered per-title choices. */
  prefs?: { audioLang?: string; subtitleLang?: string | null; subtitleDelay?: number };
}

export interface ResourceResponse<T> {
  data: T;
  /** Seconds the add-on allows us to cache. */
  cacheMaxAge?: number;
}
