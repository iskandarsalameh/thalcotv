import { useEffect, useRef, useState } from 'preact/hooks';
import { navTick, pop, stack, switchTab, tab, type StackEntry } from '../nav/router';
import { addBackHandler, addKeyHandler, ensureFocus, focusEl, focusFirst, getFocused } from '../nav/spatial';
import { addons, initAddons } from '../core/addons';
import { settings, updateSettings } from '../core/settings';
import { flushLibrary } from '../core/library';
import { nativeBridge } from '../core/bridge';
import { applyUpdate, updateAvailable } from '../core/update';
import { t } from '../core/i18n';
import { TabBar } from './components/TabBar';
import { Overlays, EmptyState, Loading } from './components/Overlays';
import { Focusable } from './components/Focusable';
import { HomeScreen } from './screens/Home';
import { BrowseScreen } from './screens/Browse';
import { LibraryScreen } from './screens/Library';
import { SearchScreen } from './screens/Search';
import { AddonsScreen, AddonScreen } from './screens/Addons';
import { SettingsScreen } from './screens/Settings';
import { PairScreen } from './screens/Pair';
import { DetailsScreen } from './screens/Details';
import { StreamsScreen } from './screens/Streams';
import { PlayerScreen } from '../player/PlayerScreen';
import { alert, confirm, overlays } from './overlay';
import { chromeHidden, sidebarOpen, updateReady } from './state';

function TabRoot({ active }: { active: boolean }) {
  switch (tab.value) {
    case 'home':
      return <HomeScreen active={active} />;
    case 'movie':
      return <BrowseScreen key="movie" active={active} type="movie" />;
    case 'series':
      return <BrowseScreen key="series" active={active} type="series" />;
    case 'library':
      return <LibraryScreen active={active} />;
    case 'search':
      return <SearchScreen active={active} />;
    default:
      return <SettingsScreen active={active} />;
  }
}

function StackScreen({ entry, active }: { entry: StackEntry; active: boolean }) {
  const r = entry.route;
  switch (r.name) {
    case 'details':
      return <DetailsScreen active={active} type={r.type} id={r.id} preview={r.preview} />;
    case 'streams':
      return <StreamsScreen active={active} meta={r.meta} video={r.video} auto={r.auto} startAt={r.startAt} />;
    case 'player':
      return <PlayerScreen active={active} meta={r.meta} video={r.video} streams={r.streams} index={r.index} startAt={r.startAt} />;
    case 'catalog':
      return <BrowseScreen active={active} type={r.ref.catalog.type} initial={{ ref: r.ref, genre: r.genre }} title={r.title} />;
    case 'addons':
      return <AddonsScreen active={active} />;
    case 'pair':
      return <PairScreen active={active} configureUrl={r.configureUrl} />;
    case 'addon':
      return <AddonScreen active={active} transportUrl={r.transportUrl} />;
  }
}

const IDLE_BEFORE_UPDATE_MS = 90 * 1000;

/**
 * A screen change in flight. The new screen is mounted and takes input at
 * once; the animation is decoration layered on top, never a wait.
 */
interface Transition {
  id: number;
  /** forward = going deeper (push/replace), back = returning (pop). */
  kind: 'forward' | 'back';
  /** Layer that animates in. */
  enter: number | 'root';
  /** Layer kept visible underneath while the new one fades in over it. */
  under: number | 'root' | null;
  /** Screen that has left the stack but is still fading out. */
  leaving: StackEntry | null;
}

/** Longest animation plus a frame of slack; after this the extra layers are dropped. */
const TRANSITION_MS = 340;
let transitionSeq = 0;

export function App() {
  const [boot, setBoot] = useState<'loading' | 'ready' | 'offline'>('loading');
  const layers = stack.value;
  const tick = navTick.value;
  const currentTab = tab.value;
  const rootLayer = useRef<HTMLDivElement>(null);
  const lastInput = useRef(Date.now());

  // Work out, during render, what kind of screen change just happened, so the
  // very first frame already carries the right animation classes.
  const prevStack = useRef<StackEntry[]>(layers);
  const transition = useRef<Transition | null>(null);
  const [, rerender] = useState(0);
  if (prevStack.current !== layers) {
    const old = prevStack.current;
    prevStack.current = layers;
    const oldTop = old.length ? old[old.length - 1] : null;
    const newTop = layers.length ? layers[layers.length - 1] : null;
    if ((oldTop?.key ?? 'root') !== (newTop?.key ?? 'root')) {
      if (settings.value.reduceMotion) {
        transition.current = null;
      } else if (newTop && !old.some((e) => e.key === newTop.key)) {
        const oldGone = !!oldTop && !layers.some((e) => e.key === oldTop.key);
        transition.current = {
          id: ++transitionSeq,
          kind: 'forward',
          enter: newTop.key,
          under: oldGone ? null : oldTop ? oldTop.key : 'root',
          leaving: oldGone ? oldTop : null,
        };
      } else {
        transition.current = { id: ++transitionSeq, kind: 'back', enter: newTop ? newTop.key : 'root', under: null, leaving: oldTop };
      }
    }
  }
  const tr = transition.current;
  useEffect(() => {
    if (!tr) return;
    const id = tr.id;
    const timer = setTimeout(() => {
      if (transition.current?.id === id) {
        transition.current = null;
        rerender((n) => n + 1);
      }
    }, TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [tr?.id]);

  const start = () => {
    setBoot('loading');
    initAddons().then(() => setBoot(addons.value.length > 0 ? 'ready' : 'offline'));
  };
  useEffect(start, []);

  // Restore focus whenever the visible screen changes.
  useEffect(() => {
    chromeHidden.value = false;
    const topLayer = document.querySelector<HTMLElement>('.layer-top');
    if (!topLayer) return;
    const f = getFocused();
    if (f && !f.closest('[data-inert]') && (topLayer.contains(f) || f.closest('#tabbar'))) return;
    const screen = topLayer.querySelector('.screen');
    focusFirst(screen ?? topLayer);
  }, [tick, boot]);

  useEffect(() => {
    // Lowest-priority Back: unwind the stack, then return to the tab bar, then offer to quit.
    const offBack = addBackHandler(() => {
      if (stack.value.length > 0) {
        pop();
        return true;
      }
      // First Back opens the sidebar, the next returns to Home, the last offers to leave.
      if (!sidebarOpen.value) {
        sidebarOpen.value = true;
        return true;
      }
      if (tab.value !== 'home') {
        switchTab('home');
        focusEl(document.querySelector<HTMLElement>('#tabbar .sidebar-panel [data-tab="home"]'));
        return true;
      }
      if (overlays.value.length === 0) {
        void confirm(t('exit.title'), t('exit.message'), t('exit.confirm'), t('common.cancel')).then((yes) => {
          if (!yes) return;
          flushLibrary();
          if (!nativeBridge.exit()) window.close();
        });
      }
      return true;
    });
    const offKey = addKeyHandler(() => {
      lastInput.current = Date.now();
      return false;
    });
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushLibrary();
      else if (updateReady.value && stack.value.length === 0) applyUpdate();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushLibrary);

    // Pick up pushes to the repository while the app stays open.
    const check = () => {
      void updateAvailable().then((yes) => {
        if (yes) updateReady.value = true;
      });
    };
    const first = setTimeout(check, 20000);
    const poll = setInterval(check, 20 * 60 * 1000);
    const idle = setInterval(() => {
      const playing = stack.value.some((e) => e.route.name === 'player' || e.route.name === 'streams');
      if (updateReady.value && !playing && overlays.value.length === 0 && Date.now() - lastInput.current > IDLE_BEFORE_UPDATE_MS) {
        flushLibrary();
        applyUpdate();
      }
    }, 15000);
    nativeBridge.ready(__APP_BUILD__);
    return () => {
      offBack();
      offKey();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushLibrary);
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(idle);
    };
  }, []);

  // One-time welcome with the two things worth knowing.
  useEffect(() => {
    if (boot !== 'ready' || settings.value.onboarded) return;
    updateSettings({ onboarded: true });
    void alert(t('welcome.title'), t('welcome.message'), t('welcome.start')).then(() => ensureFocus(rootLayer.current));
  }, [boot]);

  const rootActive = layers.length === 0;
  const top = layers.length ? layers[layers.length - 1] : null;
  const entering = (key: number | 'root') => (tr && tr.enter === key ? (tr.kind === 'forward' ? ' layer-in-forward' : ' layer-in-back') : '');
  // The screen that just left stays in the list (same key, same instance) until its exit animation ends.
  const rendered = tr?.leaving && !layers.some((e) => e.key === tr.leaving!.key) ? layers.concat(tr.leaving) : layers;
  return (
    <div class={'app' + (settings.value.reduceMotion ? ' reduce-motion' : '')}>
      <div
        class={'layer layer-root' + (rootActive ? ' layer-top' : '') + entering('root') + (rootActive || tr?.under === 'root' ? '' : ' layer-hidden')}
        ref={rootLayer}
        data-inert={rootActive ? undefined : ''}
      >
        {boot === 'ready' ? (
          <TabRoot key={currentTab} active={rootActive} />
        ) : boot === 'loading' ? (
          <div class="screen screen-center">
            <div class="splash">
              <div class="brand brand-lg">
                thalco<span>tv</span>
              </div>
              <Loading />
            </div>
          </div>
        ) : (
          <div class="screen screen-center" data-focus-group="">
            <EmptyState icon="warn" title={t('offline.title')} message={t('offline.message')}>
              <Focusable class="btn btn-primary" autoFocus onSelect={start}>
                {t('common.retry')}
              </Focusable>
            </EmptyState>
          </div>
        )}
      </div>
      {rendered.map((entry) => {
        const isTop = entry === top;
        const isLeaving = !!tr && tr.leaving === entry && !isTop;
        const visible = isTop || isLeaving || tr?.under === entry.key;
        const motion = isLeaving ? (tr!.kind === 'back' ? ' layer-out-back' : ' layer-out-forward') : entering(entry.key);
        return (
          <div
            class={'layer layer-stack' + (isTop ? ' layer-top' : '') + motion + (visible ? '' : ' layer-hidden')}
            key={entry.key}
            data-inert={isTop ? undefined : ''}
          >
            <StackScreen entry={entry} active={isTop} />
          </div>
        );
      })}
      {boot === 'ready' && <TabBar />}
      <Overlays />
    </div>
  );
}
