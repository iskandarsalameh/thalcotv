import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export interface GridProps<T> {
  items: T[];
  columns: number;
  /** Height of one row including its bottom gap, rem. */
  rowHeight: number;
  /** rem */
  itemWidth: number;
  /** rem */
  gap?: number;
  render: (item: T, index: number) => ComponentChildren;
  keyOf: (item: T, index: number) => string;
  onEndReached?: () => void;
  /** How much of the previous row stays visible above the focused one, rem. */
  peek?: number;
}

/** Vertical poster wall that only keeps a few rows in the DOM. */
export function Grid<T>(props: GridProps<T>) {
  const { items, columns, rowHeight, itemWidth, render, keyOf } = props;
  const gap = props.gap ?? 2;
  const peek = props.peek ?? 3;
  const rows = Math.ceil(items.length / columns);
  const [row, setRow] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef(props.onEndReached);
  endRef.current = props.onEndReached;

  useEffect(() => {
    if (row > Math.max(0, rows - 1)) setRow(Math.max(0, rows - 1));
  }, [rows]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (e: FocusEvent) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.grid-cell');
      if (!cell || !root.contains(cell)) return;
      const r = Math.floor(Number(cell.dataset.i) / columns);
      setRow(r);
      if (endRef.current && r >= Number(root.dataset.rows) - 3) endRef.current();
    };
    const pin = () => {
      if (root.scrollTop !== 0) root.scrollTop = 0;
    };
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('scroll', pin);
    return () => {
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('scroll', pin);
    };
  }, [columns]);

  const startRow = Math.max(0, row - 2);
  const endRow = Math.min(rows, row + 4);
  const y = row === 0 ? 0 : row * rowHeight - peek;
  const out = [];
  for (let r = startRow; r < endRow; r++) {
    const cells = [];
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i >= items.length) break;
      cells.push(
        <div class="grid-cell" key={keyOf(items[i], i)} data-i={i} style={{ width: itemWidth + 'rem', marginInlineEnd: gap + 'rem' }}>
          {render(items[i], i)}
        </div>,
      );
    }
    out.push(
      <div class="grid-row" key={r} style={{ height: rowHeight + 'rem', top: r * rowHeight + 'rem' }}>
        {cells}
      </div>,
    );
  }

  return (
    <div class="grid" ref={rootRef} data-focus-group="" data-rows={rows}>
      <div class="grid-track" style={{ transform: `translate3d(0,${-y}rem,0)`, height: rows * rowHeight + 'rem' }}>
        {out}
      </div>
    </div>
  );
}
