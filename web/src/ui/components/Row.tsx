import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isRtl } from '../../core/i18n';
import { SAFE_X } from '../metrics';

export interface RowProps<T> {
  items: T[];
  /** rem */
  itemWidth: number;
  /** rem */
  gap?: number;
  render: (item: T, index: number) => ComponentChildren;
  keyOf: (item: T, index: number) => string;
  /** Fired when focus gets close to the last item (paging). */
  onEndReached?: () => void;
  class?: string;
  /** Item to show first and to enter on. */
  initialIndex?: number;
  /** Width available for fully visible items, rem. Defaults to the safe area. */
  span?: number;
}

const CANVAS = 120; // rem

/**
 * Horizontal shelf. Only the cells near the viewport exist in the DOM, the
 * track moves with a GPU transform, and focus never leaves sideways.
 */
export function Row<T>(props: RowProps<T>) {
  const { items, itemWidth, render, keyOf, onEndReached } = props;
  const gap = props.gap ?? 2;
  const step = itemWidth + gap;
  const visible = Math.max(1, Math.floor(((props.span ?? CANVAS - 2 * SAFE_X) + gap) / step));
  const maxFirst = Math.max(0, items.length - visible);
  const [first, setFirst] = useState(() => Math.min(maxFirst, Math.max(0, props.initialIndex ?? 0)));
  const firstRef = useRef(first);
  firstRef.current = first;
  const endRef = useRef(onEndReached);
  endRef.current = onEndReached;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (first > maxFirst) setFirst(maxFirst);
  }, [maxFirst]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (e: FocusEvent) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.row-cell');
      if (!cell || !root.contains(cell)) return;
      const i = Number(cell.dataset.i);
      const f = firstRef.current;
      if (i < f) setFirst(i);
      else if (i > f + visible - 1) setFirst(i - visible + 1);
      if (endRef.current && i >= Number(root.dataset.count) - visible - 2) endRef.current();
    };
    root.addEventListener('focusin', onFocusIn);
    return () => root.removeEventListener('focusin', onFocusIn);
  }, [visible]);

  const start = Math.max(0, first - 2);
  const end = Math.min(items.length, first + visible + 3);
  const shift = first * step * (isRtl() ? 1 : -1);
  const cells = [];
  for (let i = start; i < end; i++) {
    cells.push(
      <div
        class="row-cell"
        key={keyOf(items[i], i)}
        data-i={i}
        data-focus-default={i === first ? '' : undefined}
        style={{ width: itemWidth + 'rem', marginInlineEnd: gap + 'rem' }}
      >
        {render(items[i], i)}
      </div>,
    );
  }

  return (
    <div class={'row ' + (props.class ?? '')} ref={rootRef} data-focus-group="" data-focus-lock="x" data-count={items.length}>
      <div class="row-track" style={{ transform: `translate3d(${shift}rem,0,0)` }}>
        <div class="row-spacer" style={{ width: start * step + 'rem' }} />
        {cells}
      </div>
    </div>
  );
}
