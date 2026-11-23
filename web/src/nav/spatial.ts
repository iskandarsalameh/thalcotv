// Directional (D-pad) focus engine, modelled on the tvOS focus system:
// every interactive element is reachable with the four arrows, exactly one
// element is focused at a time, and focus only moves when the viewer moves it.
//
// Markup contract
//   [data-focus]            focusable element (also needs tabindex="-1")
//   [data-focus-group]      a row/column that remembers its last focused child
//   [data-focus-default]    preferred entry point of a group or scope
//   [data-focus-lock="x|y"] focus may not leave the group along that axis
//   [data-focus-scope]      registered through pushScope(); traps focus (dialogs)

export type Direction = 'up' | 'down' | 'left' | 'right';

type KeyHandler = (e: KeyboardEvent, action: Action) => boolean | void;

export type Action =
  | Direction
  | 'select'
  | 'back'
  | 'playpause'
  | 'play'
  | 'pause'
  | 'rewind'
  | 'forward'
  | 'menu'
  | 'other';

const FOCUSABLE = '[data-focus]:not([data-disabled])';
const REPEAT_INTERVAL = 105;
const LONG_PRESS_MS = 600;

const scopes: HTMLElement[] = [];
const keyHandlers: KeyHandler[] = [];
const backHandlers: (() => boolean | void)[] = [];
const groupMemory = new WeakMap<Element, HTMLElement>();

let lastMove = 0;
let selectDownAt = 0;
let selectTarget: HTMLElement | null = null;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressFired = false;
let lastFocused: HTMLElement | null = null;

export function actionOf(e: KeyboardEvent): Action {
  switch (e.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
    case ' ':
    case 'Select':
      return 'select';
    case 'GoBack':
    case 'Escape':
    case 'BrowserBack':
    case 'Backspace':
      return 'back';
    case 'MediaPlayPause':
      return 'playpause';
    case 'MediaPlay':
      return 'play';
    case 'MediaPause':
      return 'pause';
    case 'MediaRewind':
    case 'MediaTrackPrevious':
      return 'rewind';
    case 'MediaFastForward':
    case 'MediaTrackNext':
      return 'forward';
    case 'ContextMenu':
      return 'menu';
  }
  // Remotes on some engines only fill in keyCode.
  switch (e.keyCode) {
    case 38:
      return 'up';
    case 40:
      return 'down';
    case 37:
      return 'left';
    case 39:
      return 'right';
    case 13:
      return 'select';
    case 27:
    case 461:
    case 10009:
      return 'back';
    case 179:
      return 'playpause';
    case 227:
      return 'rewind';
    case 228:
      return 'forward';
    case 93:
      return 'menu';
  }
  return 'other';
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  // offsetParent is null for display:none subtrees (and for position:fixed, handled below).
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  return true;
}

function currentScope(): HTMLElement {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i].isConnected) return scopes[i];
  }
  return document.body;
}

export function getFocused(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && a.hasAttribute && a.hasAttribute('data-focus')) return a;
  return null;
}

function groupOf(el: Element | null): Element | null {
  return el ? el.closest('[data-focus-group]') : null;
}

export function focusEl(el: HTMLElement | null | undefined): boolean {
  if (!el || !el.isConnected) return false;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  if (document.activeElement !== el) return false;
  lastFocused = el;
  // Remember the element in every enclosing group.
  let g = groupOf(el);
  while (g) {
    groupMemory.set(g, el);
    g = groupOf(g.parentElement);
  }
  return true;
}

function candidatesIn(root: ParentNode): HTMLElement[] {
  const list = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  return list.filter(isVisible);
}

/** Entry point of a container: remembered child, declared default, then first focusable. */
export function entryOf(container: Element): HTMLElement | null {
  const remembered = groupMemory.get(container);
  if (remembered && remembered.isConnected && container.contains(remembered) && isVisible(remembered)) {
    return remembered;
  }
  // An explicitly preferred focusable wins over a preferred wrapper (row cell).
  const preferred =
    container.querySelector<HTMLElement>('[data-focus][data-focus-default]:not([data-disabled])') ??
    container.querySelector<HTMLElement>('[data-focus-default]');
  if (preferred) {
    if (preferred.matches(FOCUSABLE)) {
      if (isVisible(preferred)) return preferred;
    } else {
      const inner = candidatesIn(preferred)[0];
      if (inner) return inner;
    }
  }
  if (container instanceof HTMLElement && container.matches(FOCUSABLE) && isVisible(container)) return container;
  return candidatesIn(container)[0] ?? null;
}

export function focusFirst(container: Element | null | undefined): boolean {
  if (!container) return false;
  return focusEl(entryOf(container));
}

export function forgetGroup(container: Element): void {
  groupMemory.delete(container);
}

interface Scored {
  el: HTMLElement;
  score: number;
  overlaps: boolean;
}

function findNext(from: HTMLElement, dir: Direction, scope: HTMLElement): HTMLElement | null {
  const r = from.getBoundingClientRect();
  const horizontal = dir === 'left' || dir === 'right';
  const fromGroup = groupOf(from);
  const lock = fromGroup?.getAttribute('data-focus-lock');
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const scored: Scored[] = [];

  for (const el of candidatesIn(scope)) {
    if (el === from) continue;
    const c = el.getBoundingClientRect();
    if (c.width === 0 && c.height === 0) continue;
    const ccx = c.left + c.width / 2;
    const ccy = c.top + c.height / 2;

    let primary: number;
    switch (dir) {
      case 'right':
        if (ccx <= cx + 1 || c.left < r.left + 1) continue;
        primary = Math.max(0, c.left - r.right);
        break;
      case 'left':
        if (ccx >= cx - 1 || c.right > r.right - 1) continue;
        primary = Math.max(0, r.left - c.right);
        break;
      case 'down':
        if (ccy <= cy + 1 || c.top < r.top + 1) continue;
        primary = Math.max(0, c.top - r.bottom);
        break;
      default:
        if (ccy >= cy - 1 || c.bottom > r.bottom - 1) continue;
        primary = Math.max(0, r.top - c.bottom);
    }

    let cross: number;
    let overlaps: boolean;
    if (horizontal) {
      overlaps = c.top < r.bottom - 1 && c.bottom > r.top + 1;
      cross = overlaps ? 0 : Math.min(Math.abs(c.top - r.bottom), Math.abs(r.top - c.bottom));
    } else {
      overlaps = c.left < r.right - 1 && c.right > r.left + 1;
      cross = overlaps ? 0 : Math.min(Math.abs(c.left - r.right), Math.abs(r.left - c.right));
    }

    const sameGroup = fromGroup !== null && groupOf(el) === fromGroup;
    if (lock && !sameGroup && ((lock === 'x' && horizontal) || (lock === 'y' && !horizontal))) continue;
    // Sideways moves never jump diagonally into another row.
    if (horizontal && !overlaps && !sameGroup && fromGroup) continue;

    // Centre distance breaks ties between equally near candidates.
    const centre = horizontal ? Math.abs(ccy - cy) : Math.abs(ccx - cx);
    const score = primary + cross * 4 + centre * 0.05 + (overlaps ? 0 : 400);
    scored.push({ el, score, overlaps });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => a.score - b.score);
  let target = scored[0].el;

  // Crossing into another group lands on that group's remembered element.
  const targetGroup = groupOf(target);
  if (targetGroup && targetGroup !== fromGroup && !targetGroup.contains(from)) {
    // Use the outermost group that does not contain the origin.
    let outer: Element = targetGroup;
    for (let p = groupOf(outer.parentElement); p && !p.contains(from); p = groupOf(p.parentElement)) outer = p;
    const entry = entryOf(outer);
    if (entry && scope.contains(entry)) target = entry;
  }
  return target;
}

export function moveFocus(dir: Direction): boolean {
  const scope = currentScope();
  let from = getFocused();
  if (!from || !scope.contains(from) || !isVisible(from)) {
    // Focus was lost (element removed, dialog opened): recover instead of moving.
    const back = lastFocused && lastFocused.isConnected && scope.contains(lastFocused) && isVisible(lastFocused)
      ? lastFocused
      : entryOf(scope);
    return focusEl(back);
  }
  const next = findNext(from, dir, scope);
  if (!next) {
    from.dispatchEvent(new CustomEvent('focusedge', { bubbles: true, detail: { dir } }));
    return false;
  }
  return focusEl(next);
}

export function pushScope(el: HTMLElement): () => void {
  const previous = getFocused();
  scopes.push(el);
  return () => {
    const i = scopes.lastIndexOf(el);
    if (i >= 0) scopes.splice(i, 1);
    if (previous && previous.isConnected && isVisible(previous)) focusEl(previous);
    else focusFirst(currentScope());
  };
}

/** Intercept keys before focus movement. Return true to consume. Last added wins. */
export function addKeyHandler(h: KeyHandler): () => void {
  keyHandlers.push(h);
  return () => {
    const i = keyHandlers.lastIndexOf(h);
    if (i >= 0) keyHandlers.splice(i, 1);
  };
}

/** Handle Back. Return true to consume. Last added wins. */
export function addBackHandler(h: () => boolean | void): () => void {
  backHandlers.push(h);
  return () => {
    const i = backHandlers.lastIndexOf(h);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

function runBack(): void {
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    if (backHandlers[i]() === true) return;
  }
}

function clearLongPress(): void {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function onKeyDown(e: KeyboardEvent): void {
  const action = actionOf(e);
  if (action === 'other') return;
  // Text typed on a physical keyboard into a real input is left alone.
  const tag = (e.target as HTMLElement | null)?.tagName;
  if ((tag === 'INPUT' || tag === 'TEXTAREA') && (action === 'back' ? e.key === 'Backspace' : e.key === ' ')) return;

  // The WebView has its own spatial navigation and scroll-on-arrow; ours replaces both.
  e.preventDefault();

  for (let i = keyHandlers.length - 1; i >= 0; i--) {
    if (keyHandlers[i](e, action) === true) return;
  }

  switch (action) {
    case 'up':
    case 'down':
    case 'left':
    case 'right': {
      const now = Date.now();
      if (e.repeat && now - lastMove < REPEAT_INTERVAL) return;
      lastMove = now;
      moveFocus(action);
      return;
    }
    case 'select': {
      if (e.repeat) return;
      const el = getFocused();
      if (!el) {
        moveFocus('down');
        return;
      }
      selectDownAt = Date.now();
      selectTarget = el;
      longPressFired = false;
      el.setAttribute('data-pressed', '');
      clearLongPress();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (selectTarget !== el || !el.isConnected) return;
        const ev = new CustomEvent('longpress', { bubbles: true, cancelable: true });
        // dispatchEvent returns false when a listener called preventDefault (= handled).
        if (!el.dispatchEvent(ev)) {
          longPressFired = true;
          el.removeAttribute('data-pressed');
        }
      }, LONG_PRESS_MS);
      return;
    }
    case 'back':
      if (e.repeat) return;
      runBack();
      return;
    case 'menu': {
      if (e.repeat) return;
      const el = getFocused();
      if (el) el.dispatchEvent(new CustomEvent('longpress', { bubbles: true, cancelable: true }));
      return;
    }
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (actionOf(e) !== 'select') return;
  e.preventDefault();
  clearLongPress();
  const el = selectTarget;
  selectTarget = null;
  if (!el) return;
  el.removeAttribute('data-pressed');
  if (longPressFired) {
    longPressFired = false;
    return;
  }
  // Activate on release, like a remote click. Ignore if focus moved away meanwhile.
  if (el.isConnected && getFocused() === el && Date.now() - selectDownAt < 5000) el.click();
}

let installed = false;

export function initSpatial(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  // Pointer support keeps the app usable in a desktop browser during development.
  document.addEventListener('mousedown', (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(FOCUSABLE);
    if (el) focusEl(el);
    e.preventDefault();
  });
}

/** Give focus a sensible home whenever nothing is focused (after a re-render, for instance). */
export function ensureFocus(container?: Element | null): void {
  const scope = currentScope();
  const f = getFocused();
  if (f && scope.contains(f) && isVisible(f)) return;
  if (container && scope.contains(container) && focusFirst(container)) return;
  focusFirst(scope);
}
