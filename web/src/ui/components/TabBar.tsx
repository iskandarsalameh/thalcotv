import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { stack, switchTab, tab, type TabId } from '../../nav/router';
import { locale, t } from '../../core/i18n';
import { remPx } from '../metrics';
import { chromeHidden, updateReady } from '../state';
import { Focusable } from './Focusable';
import { Icon } from './Icon';

// Search opens the bar and Settings closes it, as icons; the places you browse sit between them.
const TABS: { id: TabId; icon?: string }[] = [
  { id: 'search', icon: 'search' },
  { id: 'home' },
  { id: 'movie' },
  { id: 'series' },
  { id: 'library' },
  { id: 'settings', icon: 'gear' },
];

/**
 * Top tab bar in the tvOS manner: resting on a tab switches to it, and the
 * bar slides away once the content below has scrolled.
 */
export function TabBar() {
  const current = tab.value;
  const stacked = stack.value.length > 0;
  const hidden = chromeHidden.value || stacked;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<TabId | null>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    // Tab widths settle once the typeface has loaded.
    void document.fonts?.ready.then(() => setFontsReady(1));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // One pill glides between tabs instead of each tab lighting up on its own.
  const scale = remPx.value;
  const lang = locale.value;
  useLayoutEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${focused ?? current}"]`);
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, [focused, current, scale, lang, fontsReady]);

  const rest = (id: TabId) => {
    setFocused(id);
    if (timer.current) clearTimeout(timer.current);
    if (id === tab.value) return;
    timer.current = setTimeout(() => switchTab(id), 240);
  };
  return (
    <nav class={'tabbar' + (hidden ? ' tabbar-hidden' : '')} id="tabbar" data-focus-group="" data-inert={stacked ? '' : undefined}>
      <div class="brand" aria-hidden="true">
        thalco<span>tv</span>
      </div>
      <div class="tabs" ref={tabsRef}>
        {pill && (
          <div
            class={'tab-pill' + (focused ? ' tab-pill-focus' : '')}
            style={{ transform: `translate3d(${pill.x}px,0,0)`, width: pill.w + 'px' }}
          />
        )}
        {TABS.map((x) => (
          <Focusable
            key={x.id}
            class={'tab' + (x.id === current ? ' tab-on' : '') + (x.icon ? ' tab-icon' : '')}
            isDefault={x.id === current}
            data-tab={x.id}
            label={t('tab.' + x.id)}
            role="tab"
            onFocus={() => rest(x.id)}
            onBlur={() => setFocused((f) => (f === x.id ? null : f))}
            onSelect={() => switchTab(x.id)}
          >
            {x.icon ? <Icon name={x.icon} /> : t('tab.' + x.id)}
          </Focusable>
        ))}
      </div>
      <div class="tabbar-end">{updateReady.value && <span class="update-pill">{t('update.ready')}</span>}</div>
    </nav>
  );
}
