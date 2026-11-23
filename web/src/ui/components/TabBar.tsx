import { useEffect, useRef } from 'preact/hooks';
import { stack, switchTab, tab, type TabId } from '../../nav/router';
import { isRtl, t } from '../../core/i18n';
import { chromeHidden, sidebarOpen, updateReady } from '../state';
import { overlays } from '../overlay';
import { addKeyHandler, focusEl, focusFirst } from '../../nav/spatial';
import { Focusable } from './Focusable';
import { Icon } from './Icon';

const SECTIONS: { id: TabId; icon: string }[] = [
  { id: 'search', icon: 'search' },
  { id: 'home', icon: 'home' },
  { id: 'movie', icon: 'movie' },
  { id: 'series', icon: 'series' },
  { id: 'library', icon: 'library' },
];
const SETTINGS: { id: TabId; icon: string } = { id: 'settings', icon: 'gear' };

/**
 * Section navigation in the manner of the tvOS sidebar. At rest it is a small
 * pill in the top corner naming the current section. Moving onto it (Up from
 * the top of a page, Left from its edge, or Back) opens the sidebar; resting
 * on a section shows it behind, and Right or Select goes into it.
 */
export function TabBar() {
  const current = tab.value;
  const stacked = stack.value.length > 0;
  const open = sidebarOpen.value && !stacked;
  const hidden = stacked || (chromeHidden.value && !open);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resting = useRef<TabId | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  /** Close the sidebar and hand focus to the section's content. */
  const close = () => {
    // If the viewer left before the section they rested on had switched, switch now.
    if (timer.current && resting.current) switchTab(resting.current);
    clearTimer();
    sidebarOpen.value = false;
    setTimeout(() => focusFirst(document.querySelector('.layer-top .screen')), 0);
  };

  useEffect(() => {
    if (open) focusEl(panelRef.current?.querySelector<HTMLElement>(`[data-tab="${tab.value}"]`));
  }, [open]);

  useEffect(() => {
    if (stacked && sidebarOpen.value) sidebarOpen.value = false;
  }, [stacked]);

  useEffect(() => {
    // Pushing against the leading edge of a page opens the sidebar.
    const onEdge = (e: Event) => {
      const dir = (e as CustomEvent<{ dir: string }>).detail?.dir;
      if (stack.value.length || sidebarOpen.value || overlays.value.length) return;
      if (dir === (isRtl() ? 'right' : 'left') && (e.target as HTMLElement).closest('.layer-root')) sidebarOpen.value = true;
    };
    document.addEventListener('focusedge', onEdge);
    // The sidebar never stays open once focus is somewhere else.
    const onFocusIn = (e: FocusEvent) => {
      if (sidebarOpen.value && !(e.target as HTMLElement).closest('#tabbar')) {
        clearTimer();
        sidebarOpen.value = false;
      }
    };
    document.addEventListener('focusin', onFocusIn);
    const offKey = addKeyHandler((_e, action) => {
      if (!sidebarOpen.value || stack.value.length || overlays.value.length) return false;
      if (action === (isRtl() ? 'left' : 'right')) {
        close();
        return true;
      }
      return false;
    });
    return () => {
      document.removeEventListener('focusedge', onEdge);
      document.removeEventListener('focusin', onFocusIn);
      offKey();
      clearTimer();
    };
  }, []);

  const rest = (id: TabId) => {
    resting.current = id;
    clearTimer();
    if (id === tab.value) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      switchTab(id);
    }, 260);
  };

  const item = (x: { id: TabId; icon: string }) => (
    <Focusable
      key={x.id}
      class={'side-item' + (x.id === current ? ' side-item-on' : '')}
      isDefault={x.id === current}
      data-tab={x.id}
      label={t('tab.' + x.id)}
      role="tab"
      onFocus={() => rest(x.id)}
      onSelect={() => {
        clearTimer();
        switchTab(x.id);
        close();
      }}
    >
      <Icon name={x.icon} />
      <span>{t('tab.' + x.id)}</span>
    </Focusable>
  );

  const currentSection = SECTIONS.find((s) => s.id === current) ?? SETTINGS;
  return (
    <nav class={'sidebar' + (open ? ' sidebar-open' : '') + (hidden ? ' sidebar-hidden' : '')} id="tabbar" data-inert={stacked ? '' : undefined}>
      <div class="sidebar-scrim" />
      <div class="side-pill-wrap" data-inert={open ? '' : undefined}>
        <Focusable class="side-pill" label={t('tab.' + current)} onFocus={() => (sidebarOpen.value = true)} onSelect={() => (sidebarOpen.value = true)}>
          <Icon name="chevronLeft" class="side-pill-chevron" />
          <span class="side-pill-icon">
            <Icon name={currentSection.icon} />
          </span>
          <span class="side-pill-label">{t('tab.' + current)}</span>
        </Focusable>
      </div>
      <div class="sidebar-panel" ref={panelRef} data-focus-group="" data-focus-lock="y" data-inert={open ? undefined : ''}>
        <div class="brand sidebar-brand" aria-hidden="true">
          thalco<span>tv</span>
        </div>
        <div class="sidebar-list">{SECTIONS.map(item)}</div>
        <div class="sidebar-foot">{item(SETTINGS)}</div>
      </div>
      {updateReady.value && !open && <span class="update-pill">{t('update.ready')}</span>}
    </nav>
  );
}
