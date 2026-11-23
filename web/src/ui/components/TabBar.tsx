import { useEffect, useRef } from 'preact/hooks';
import { stack, switchTab, tab, type TabId } from '../../nav/router';
import { t } from '../../core/i18n';
import { chromeHidden, updateReady } from '../state';
import { Focusable } from './Focusable';
import { Icon } from './Icon';

const TABS: { id: TabId; icon?: string }[] = [
  { id: 'home' },
  { id: 'movie' },
  { id: 'series' },
  { id: 'library' },
  { id: 'search', icon: 'search' },
  { id: 'addons' },
  { id: 'settings', icon: 'gear' },
];

/**
 * Top tab bar in the tvOS manner: resting on a tab switches to it, and the
 * bar slides away once the content below has scrolled.
 */
export function TabBar() {
  const current = tab.value;
  const hidden = chromeHidden.value || stack.value.length > 0;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const rest = (id: TabId) => {
    if (timer.current) clearTimeout(timer.current);
    if (id === tab.value) return;
    timer.current = setTimeout(() => switchTab(id), 240);
  };
  return (
    <nav class={'tabbar' + (hidden ? ' tabbar-hidden' : '')} id="tabbar" data-focus-group="" style={{ display: stack.value.length > 0 ? 'none' : undefined }}>
      <div class="brand" aria-hidden="true">
        thalco<span>tv</span>
      </div>
      <div class="tabs">
        {TABS.map((x) => (
          <Focusable
            key={x.id}
            class={'tab' + (x.id === current ? ' tab-on' : '') + (x.icon ? ' tab-icon' : '')}
            isDefault={x.id === current}
            data-tab={x.id}
            label={t('tab.' + x.id)}
            role="tab"
            onFocus={() => rest(x.id)}
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
