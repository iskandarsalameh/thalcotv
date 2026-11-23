import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { remPx } from '../metrics';

interface Props {
  class?: string;
  children?: ComponentChildren;
  /** Called with true once the content has moved away from the top. */
  onScrolled?: (scrolled: boolean) => void;
  /** Default distance (rem) kept between the top edge and the focused section. */
  inset?: number;
}

function offsetWithin(el: HTMLElement, ancestor: HTMLElement): number {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
    if (node && !ancestor.contains(node)) break;
  }
  return y;
}

/**
 * Vertical page that follows focus. Sections marked [data-anchor] are brought
 * to a fixed line below the top edge; [data-anchor="top"] returns to the top.
 */
export function Scroller({ class: cls, children, onScrolled, inset = 9 }: Props) {
  const viewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const yRef = useRef(0);
  const cbRef = useRef(onScrolled);
  cbRef.current = onScrolled;

  useEffect(() => {
    const view = viewRef.current!;
    const content = contentRef.current!;
    const apply = (target: HTMLElement) => {
      const anchor = target.closest<HTMLElement>('[data-anchor]') ?? target;
      if (!content.contains(anchor)) return;
      const mode = anchor.getAttribute('data-anchor');
      let y: number;
      if (mode === 'top') y = 0;
      else {
        const custom = mode ? parseFloat(mode) : NaN;
        const pad = (isNaN(custom) ? inset : custom) * remPx.value;
        y = offsetWithin(anchor, content) - pad;
      }
      const max = Math.max(0, content.scrollHeight - view.clientHeight);
      y = Math.max(0, Math.min(max, Math.round(y)));
      if (y !== yRef.current) {
        yRef.current = y;
        content.style.transform = `translate3d(0,${-y}px,0)`;
        if (cbRef.current) cbRef.current(y > 4);
      }
    };
    const onFocusIn = (e: FocusEvent) => apply(e.target as HTMLElement);
    view.addEventListener('focusin', onFocusIn);
    // The engine may scroll the clipped viewport natively on focus(); keep it pinned.
    const pin = () => {
      if (view.scrollTop !== 0) view.scrollTop = 0;
      if (view.scrollLeft !== 0) view.scrollLeft = 0;
    };
    view.addEventListener('scroll', pin);
    return () => {
      view.removeEventListener('focusin', onFocusIn);
      view.removeEventListener('scroll', pin);
    };
  }, [inset]);

  return (
    <div class={'scroller ' + (cls ?? '')} ref={viewRef}>
      <div class="scroller-content" ref={contentRef}>
        {children}
      </div>
    </div>
  );
}
