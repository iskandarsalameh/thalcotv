import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { focusEl, getFocused } from '../../nav/spatial';

export interface FocusableProps {
  class?: string;
  onSelect?: () => void;
  /** Long press of Select (or the Menu button). */
  onLongPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** Take focus on mount when nothing else holds it. */
  autoFocus?: boolean;
  /** Preferred entry point of the enclosing group. */
  isDefault?: boolean;
  index?: number;
  style?: string | Record<string, string | number>;
  label?: string;
  role?: 'button' | 'tab' | 'slider' | 'group';
  children?: ComponentChildren;
  elRef?: (el: HTMLDivElement | null) => void;
  [dataAttr: `data-${string}`]: string | number | undefined;
}

/** The single building block for anything the remote can land on. */
export function Focusable(props: FocusableProps) {
  const { class: cls, onSelect, onLongPress, onFocus, onBlur, disabled, autoFocus, isDefault, index, style, label, role, children, elRef, ...rest } = props;
  const ref = useRef<HTMLDivElement>(null);
  const longRef = useRef(onLongPress);
  longRef.current = onLongPress;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => {
      if (longRef.current) {
        e.preventDefault();
        e.stopPropagation();
        longRef.current();
      }
    };
    el.addEventListener('longpress', handler);
    return () => el.removeEventListener('longpress', handler);
  }, []);

  useEffect(() => {
    if (autoFocus && !getFocused()) focusEl(ref.current);
  }, [autoFocus]);

  return (
    <div
      {...rest}
      ref={(el) => {
        (ref as { current: HTMLDivElement | null }).current = el;
        if (elRef) elRef(el);
      }}
      class={'f ' + (cls ?? '')}
      tabIndex={-1}
      data-focus=""
      data-disabled={disabled ? '' : undefined}
      data-focus-default={isDefault ? '' : undefined}
      data-index={index}
      role={role ?? 'button'}
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      style={style}
      onClick={disabled ? undefined : onSelect}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
    </div>
  );
}
