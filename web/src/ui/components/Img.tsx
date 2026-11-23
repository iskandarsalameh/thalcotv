import { useState } from 'preact/hooks';

/** Image that fades in when decoded and quietly disappears when it fails. */
export function Img({ src, class: cls, alt }: { src?: string; class?: string; alt?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [seen, setSeen] = useState(src);
  if (seen !== src) {
    setSeen(src);
    setState('loading');
  }
  if (!src || state === 'error') return null;
  return (
    <img
      class={'img ' + (cls ?? '') + (state === 'ok' ? ' img-ok' : '')}
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setState('ok')}
      onError={() => setState('error')}
    />
  );
}
