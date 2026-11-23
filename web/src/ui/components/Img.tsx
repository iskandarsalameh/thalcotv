import { useState } from 'preact/hooks';

/** Image that fades in when decoded and quietly disappears when it fails. */
export function Img({ src, class: cls, alt }: { src?: string; class?: string; alt?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [seen, setSeen] = useState(src);
  // Wordmark-style artwork (much wider than tall) gets its own class so tiles can crop to the mark.
  const [wide, setWide] = useState(false);
  if (seen !== src) {
    setSeen(src);
    setState('loading');
  }
  if (!src || state === 'error') return null;
  return (
    <img
      class={'img ' + (cls ?? '') + (state === 'ok' ? ' img-ok' : '') + (wide ? ' img-wide' : '')}
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={(e) => {
        const el = e.currentTarget as HTMLImageElement;
        setWide(el.naturalWidth > el.naturalHeight * 1.8);
        setState('ok');
      }}
      onError={() => setState('error')}
    />
  );
}
