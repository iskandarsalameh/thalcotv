import type { LibraryItem, MetaPreview } from '../../core/types';
import { library, itemProgress, isItemWatched } from '../../core/library';
import { Focusable } from './Focusable';
import { Img } from './Img';
import { Icon } from './Icon';

interface PosterProps {
  meta: MetaPreview;
  index?: number;
  onSelect: () => void;
  onLongPress?: () => void;
  onFocus?: () => void;
}

/** 2:3 artwork card. Shows watch state from the library without extra props. */
export function PosterCard({ meta, index, onSelect, onLongPress, onFocus }: PosterProps) {
  const item = library.value[meta.id];
  const progress = itemProgress(item);
  const watched = isItemWatched(item) && progress === 0;
  const shape = meta.posterShape === 'landscape' ? ' card-wide' : meta.posterShape === 'square' ? ' card-square' : '';
  return (
    <Focusable class={'card card-poster' + shape} index={index} onSelect={onSelect} onLongPress={onLongPress} onFocus={onFocus} label={meta.name}>
      <div class="card-art">
        <div class="card-fallback">{meta.name}</div>
        <Img src={meta.poster} />
        {watched && (
          <div class="badge-watched">
            <Icon name="check" />
          </div>
        )}
        {progress > 0 && (
          <div class="progress">
            <div class="progress-fill" style={{ width: Math.round(progress * 100) + '%' }} />
          </div>
        )}
      </div>
      <div class="card-title">{meta.name}</div>
    </Focusable>
  );
}

interface WideProps {
  title: string;
  subtitle?: string;
  image?: string;
  /** Shown when the image is missing. */
  fallback?: string;
  progress?: number;
  watched?: boolean;
  dim?: boolean;
  index?: number;
  isDefault?: boolean;
  onSelect: () => void;
  onLongPress?: () => void;
}

/** 16:9 card used for Continue Watching and episodes. */
export function WideCard(p: WideProps) {
  return (
    <Focusable class={'card card-landscape' + (p.dim ? ' card-dim' : '')} index={p.index} isDefault={p.isDefault} onSelect={p.onSelect} onLongPress={p.onLongPress} label={p.title}>
      <div class="card-art">
        <div class="card-fallback">{p.fallback ?? p.title}</div>
        <Img src={p.image} />
        {p.watched && (
          <div class="badge-watched">
            <Icon name="check" />
          </div>
        )}
        {p.progress !== undefined && p.progress > 0 && (
          <div class="progress">
            <div class="progress-fill" style={{ width: Math.max(2, Math.round(p.progress * 100)) + '%' }} />
          </div>
        )}
      </div>
      <div class="card-title">{p.title}</div>
      {p.subtitle && <div class="card-subtitle">{p.subtitle}</div>}
    </Focusable>
  );
}

export function libraryItemToPreview(item: LibraryItem): MetaPreview {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    poster: item.poster,
    posterShape: item.posterShape,
    background: item.background,
    logo: item.logo,
    releaseInfo: item.year,
  };
}
