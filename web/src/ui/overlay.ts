// Imperative dialogs, menus and toasts. Screens call these and await a result;
// the single <Overlays/> host renders whatever is open.

import { signal } from '@preact/signals';

export interface MenuOption<T = string> {
  value: T;
  label: string;
  detail?: string;
  icon?: string;
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

export interface MenuRequest {
  id: number;
  kind: 'menu' | 'alert' | 'input';
  title?: string;
  message?: string;
  options: MenuOption<unknown>[];
  /** For kind 'input'. */
  initial?: string;
  placeholder?: string;
  layout?: 'url' | 'text';
  resolve: (value: unknown) => void;
}

export const overlays = signal<MenuRequest[]>([]);
export const toast = signal<{ id: number; text: string; icon?: string } | null>(null);

let seq = 1;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function open<T>(req: Omit<MenuRequest, 'id' | 'resolve'>): Promise<T | null> {
  return new Promise((resolve) => {
    const id = seq++;
    const entry: MenuRequest = {
      ...req,
      id,
      resolve: (v) => {
        overlays.value = overlays.value.filter((o) => o.id !== id);
        resolve(v as T | null);
      },
    };
    overlays.value = overlays.value.concat(entry);
  });
}

/** A list of choices. Resolves with the chosen value, or null when dismissed. */
export function openMenu<T>(title: string, options: MenuOption<T>[], message?: string): Promise<T | null> {
  return open<T>({ kind: 'menu', title, message, options: options as MenuOption<unknown>[] });
}

export function confirm(title: string, message: string, okLabel: string, cancelLabel: string, destructive = false): Promise<boolean> {
  return open<string>({
    kind: 'alert',
    title,
    message,
    options: [
      { value: 'ok', label: okLabel, destructive },
      { value: 'cancel', label: cancelLabel },
    ],
  }).then((v) => v === 'ok');
}

export function alert(title: string, message: string, okLabel: string): Promise<void> {
  return open<string>({ kind: 'alert', title, message, options: [{ value: 'ok', label: okLabel }] }).then(() => undefined);
}

/** On-screen keyboard entry. Resolves with the text, or null when cancelled. */
export function promptText(title: string, opts: { initial?: string; placeholder?: string; layout?: 'url' | 'text'; message?: string } = {}): Promise<string | null> {
  return open<string>({ kind: 'input', title, options: [], ...opts });
}

export function showToast(text: string, icon?: string, ms = 2600): void {
  const id = seq++;
  toast.value = { id, text, icon };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toast.value?.id === id) toast.value = null;
  }, ms);
}
