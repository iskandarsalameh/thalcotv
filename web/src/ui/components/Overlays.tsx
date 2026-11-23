import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { overlays, toast, type MenuRequest } from '../overlay';
import { addBackHandler, focusFirst, pushScope } from '../../nav/spatial';
import { Focusable } from './Focusable';
import { Icon } from './Icon';
import { Keyboard } from './Keyboard';
import { t } from '../../core/i18n';

function Sheet({ req }: { req: MenuRequest }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(req.initial ?? '');

  useEffect(() => {
    const el = ref.current!;
    const release = pushScope(el);
    const selected = el.querySelector<HTMLElement>('[data-selected]');
    if (selected) selected.focus({ preventScroll: true });
    else focusFirst(el);
    const offBack = addBackHandler(() => {
      req.resolve(null);
      return true;
    });
    return () => {
      offBack();
      release();
    };
  }, []);

  // Keep the focused option inside the scrolling list.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top - 8;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8;
    };
    list.addEventListener('focusin', onFocusIn);
    const sel = list.querySelector<HTMLElement>('[data-selected]');
    if (sel) list.scrollTop = Math.max(0, sel.offsetTop - list.clientHeight / 2);
    return () => list.removeEventListener('focusin', onFocusIn);
  }, []);

  if (req.kind === 'input') {
    return (
      <div class="overlay" ref={ref}>
        <div class="sheet sheet-input">
          {req.title && <div class="sheet-title">{req.title}</div>}
          {req.message && <div class="sheet-message">{req.message}</div>}
          <div class={'input-field' + (text ? '' : ' input-empty')} dir="ltr">
            {text || req.placeholder || ''}
            <span class="caret" />
          </div>
          <Keyboard value={text} onChange={setText} layout={req.layout ?? 'text'} onSubmit={() => req.resolve(text.trim() || null)} />
        </div>
      </div>
    );
  }

  return (
    <div class="overlay" ref={ref}>
      <div class={'sheet' + (req.kind === 'alert' ? ' sheet-alert' : '')}>
        {req.title && <div class="sheet-title">{req.title}</div>}
        {req.message && <div class="sheet-message">{req.message}</div>}
        <div class="sheet-list" ref={listRef}>
          {req.options.map((o, i) => (
            <Focusable
              key={i}
              class={'option' + (o.destructive ? ' option-destructive' : '')}
              disabled={o.disabled}
              data-selected={o.selected ? '' : undefined}
              onSelect={() => req.resolve(o.value)}
            >
              {o.icon && <Icon name={o.icon} />}
              <span class="option-text">
                <span class="option-label">{o.label}</span>
                {o.detail && <span class="option-detail">{o.detail}</span>}
              </span>
              {o.selected && <Icon name="check" class="option-check" />}
            </Focusable>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Overlays() {
  const list = overlays.value;
  const tst = toast.value;
  return (
    <>
      {list.map((req) => (
        <Sheet key={req.id} req={req} />
      ))}
      {tst && (
        <div class="toast" key={tst.id} role="status">
          {tst.icon && <Icon name={tst.icon} />}
          {tst.text}
        </div>
      )}
    </>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div class="spinner-wrap">
      <div class="spinner" />
      {label && <div class="spinner-label">{label}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, message, children }: { icon?: string; title: string; message?: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      {icon && <Icon name={icon} class="empty-icon" />}
      <div class="empty-title">{title}</div>
      {message && <div class="empty-message">{message}</div>}
      {children && <div class="empty-actions">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <Spinner label={t('common.loading')} />;
}
