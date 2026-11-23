import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Addon, ManifestResource } from '../../core/types';
import {
  ADDON_CATALOG_URL,
  addons,
  baseUrlOf,
  fetchJSON,
  fetchManifest,
  installAddon,
  isInstalled,
  moveAddon,
  uninstallAddon,
  validateManifest,
} from '../../core/addons';
import { readJSON, writeJSON } from '../../core/storage';
import { t, typeLabel } from '../../core/i18n';
import { settings } from '../../core/settings';
import { Grid } from '../components/Grid';
import { Scroller } from '../components/Scroller';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { Img } from '../components/Img';
import { EmptyState, Loading } from '../components/Overlays';
import { alert, confirm, openMenu, promptText, showToast } from '../overlay';
import { ensureFocus } from '../../nav/spatial';
import { pop, push } from '../../nav/router';

const CATALOG_CACHE = 'cache:addonCatalog';

function resourceNames(a: Addon): string[] {
  return (a.manifest.resources ?? []).map((r: ManifestResource) => (typeof r === 'string' ? r : r.name));
}

/** Short human summary of what an add-on contributes. */
export function addonProvides(a: Addon): string {
  const names = resourceNames(a);
  const parts: string[] = [];
  if ((a.manifest.catalogs ?? []).length) parts.push(t('addons.provides.catalogs'));
  if (names.includes('meta')) parts.push(t('addons.provides.meta'));
  if (names.includes('stream')) parts.push(t('addons.provides.streams'));
  if (names.includes('subtitles')) parts.push(t('addons.provides.subtitles'));
  return parts.join(' · ');
}

async function loadCatalog(): Promise<Addon[]> {
  const cached = readJSON<{ t: number; list: Addon[] } | null>(CATALOG_CACHE, null);
  if (cached && Date.now() - cached.t < 12 * 3600 * 1000) return cached.list;
  try {
    const raw = await fetchJSON<{ transportUrl: string; manifest: unknown }[]>(ADDON_CATALOG_URL, 20000);
    const list: Addon[] = [];
    for (const entry of raw) {
      try {
        if (!/^https:\/\//i.test(entry.transportUrl)) continue;
        const manifest = validateManifest(entry.manifest);
        // Keep the cached copy small: catalogs are re-read from the live manifest on install.
        list.push({ transportUrl: entry.transportUrl, manifest: { ...manifest, catalogs: (manifest.catalogs ?? []).slice(0, 3) } });
      } catch {
        /* skip malformed entries */
      }
    }
    writeJSON(CATALOG_CACHE, { t: Date.now(), list });
    return list;
  } catch (e) {
    if (cached) return cached.list;
    throw e;
  }
}

export async function addByUrl(): Promise<void> {
  const input = await promptText(t('addons.addByUrl'), { layout: 'url', placeholder: 'https://…/manifest.json', message: t('addons.addByUrl.message') });
  if (!input) return;
  try {
    const addon = await fetchManifest(input);
    const ok = await confirm(addon.manifest.name, addon.manifest.description ?? addon.transportUrl, t('addons.install'), t('common.cancel'));
    if (!ok) return;
    installAddon(addon);
    showToast(t('addons.installed', { name: addon.manifest.name }), 'check');
  } catch {
    await alert(t('addons.addFailed.title'), t('addons.addFailed.message'), t('common.ok'));
  }
}

function AddonCard({ addon, index, installed }: { addon: Addon; index: number; installed: boolean }) {
  const m = addon.manifest;
  return (
    <Focusable class="addon-card" index={index} onSelect={() => push({ name: 'addon', transportUrl: addon.transportUrl })} label={m.name}>
      <div class="addon-logo">
        <div class="addon-logo-fallback">{m.name.charAt(0).toUpperCase()}</div>
        <Img src={m.logo} />
      </div>
      <div class="addon-body">
        <div class="addon-name">
          {m.name}
          {installed && (
            <span class="tag tag-installed">
              <Icon name="check" /> {t('addons.installedTag')}
            </span>
          )}
        </div>
        <div class="addon-desc">{m.description ?? ''}</div>
        <div class="addon-meta">{addonProvides(addon) || (m.types ?? []).map((x) => typeLabel(x)).join(' · ')}</div>
      </div>
    </Focusable>
  );
}

// Looked up by the details screen for add-ons that are not installed yet.
let catalogMemo: Addon[] = [];

export function AddonsScreen({ active }: { active: boolean }) {
  const [view, setView] = useState<'installed' | 'catalog'>('installed');
  const [catalog, setCatalog] = useState<Addon[] | null>(null);
  const [error, setError] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const rootRef = useRef<HTMLDivElement>(null);
  const installed = addons.value;

  useEffect(() => {
    if (view !== 'catalog' || catalog) return;
    let alive = true;
    setError(false);
    loadCatalog()
      .then((list) => {
        catalogMemo = list;
        if (alive) setCatalog(list);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [view]);

  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [active, view, catalog !== null]);

  const types = useMemo(() => {
    const set = new Set<string>();
    (catalog ?? []).forEach((a) => (a.manifest.types ?? []).forEach((x) => set.add(x)));
    return Array.from(set).sort();
  }, [catalog]);

  const hideAdult = settings.value.hideAdult;
  const shown =
    view === 'installed'
      ? installed
      : (catalog ?? []).filter(
          (a) => (typeFilter === 'all' || (a.manifest.types ?? []).includes(typeFilter)) && !(hideAdult && a.manifest.behaviorHints?.adult),
        );

  const pickType = async () => {
    const v = await openMenu(t('browse.type'), [
      { value: 'all', label: t('library.allTypes'), selected: typeFilter === 'all' },
      ...types.map((x) => ({ value: x, label: typeLabel(x), selected: x === typeFilter })),
    ]);
    if (v) setTypeFilter(v);
  };

  return (
    <div class="screen screen-browse" data-focus-group="" ref={rootRef}>
      <header class="page-header">
        <h1 class="page-title">{t('tab.addons')}</h1>
        <div class="chip-row" data-focus-group="">
          <Focusable class={'chip' + (view === 'installed' ? ' chip-on' : '')} isDefault={view === 'installed'} onSelect={() => setView('installed')}>
            {t('addons.tab.installed', { n: installed.length })}
          </Focusable>
          <Focusable class={'chip' + (view === 'catalog' ? ' chip-on' : '')} isDefault={view === 'catalog'} onSelect={() => setView('catalog')}>
            {t('addons.tab.catalog')}
          </Focusable>
          {view === 'catalog' && types.length > 0 && (
            <Focusable class="chip" onSelect={() => void pickType()}>
              {typeFilter === 'all' ? t('library.allTypes') : typeLabel(typeFilter)} <Icon name="chevronDown" />
            </Focusable>
          )}
          <Focusable class="chip" onSelect={() => void addByUrl()}>
            <Icon name="plus" /> {t('addons.addByUrl')}
          </Focusable>
        </div>
      </header>
      <div class="page-body">
        {view === 'catalog' && !catalog ? (
          error ? (
            <EmptyState icon="warn" title={t('error.loadFailed')} message={t('error.checkConnection')} />
          ) : (
            <Loading />
          )
        ) : shown.length === 0 ? (
          <EmptyState icon="puzzle" title={t('addons.none.title')} message={t('addons.none.message')} />
        ) : (
          <Grid
            key={view + typeFilter}
            items={shown}
            columns={2}
            itemWidth={54}
            rowHeight={13}
            peek={2}
            keyOf={(a) => a.transportUrl}
            render={(a, i) => <AddonCard addon={a} index={i} installed={isInstalled(a.transportUrl)} />}
          />
        )}
      </div>
    </div>
  );
}

export function AddonScreen({ active, transportUrl }: { active: boolean; transportUrl: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const installedList = addons.value;
  const installed = installedList.find((a) => a.transportUrl === transportUrl);
  const [fresh, setFresh] = useState<Addon | null>(null);
  const [busy, setBusy] = useState(false);
  const addon = installed ?? fresh ?? catalogMemo.find((a) => a.transportUrl === transportUrl) ?? null;

  useEffect(() => {
    if (installed) return;
    let alive = true;
    // The catalogue copy is trimmed; read the live manifest before installing.
    fetchManifest(transportUrl)
      .then((a) => alive && setFresh(a))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [transportUrl]);

  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [active, addon !== null, !!installed]);

  if (!addon) {
    return (
      <div class="screen screen-addon" data-focus-group="" ref={rootRef}>
        <Loading />
      </div>
    );
  }
  const m = addon.manifest;
  const position = installedList.findIndex((a) => a.transportUrl === transportUrl);
  const configurable = !!m.behaviorHints?.configurable || !!m.behaviorHints?.configurationRequired;

  const install = async () => {
    if (m.behaviorHints?.configurationRequired) {
      await alert(t('addons.configure.title'), t('addons.configure.message', { url: baseUrlOf(addon) + '/configure' }), t('common.ok'));
      return;
    }
    setBusy(true);
    try {
      const live = fresh ?? (await fetchManifest(transportUrl));
      installAddon(live);
      showToast(t('addons.installed', { name: live.manifest.name }), 'check');
    } catch {
      await alert(t('addons.addFailed.title'), t('addons.addFailed.message'), t('common.ok'));
    }
    setBusy(false);
  };
  const uninstall = async () => {
    const ok = await confirm(t('addons.uninstall.title', { name: m.name }), t('addons.uninstall.message'), t('addons.uninstall'), t('common.cancel'), true);
    if (!ok) return;
    uninstallAddon(transportUrl);
    showToast(t('addons.uninstalled', { name: m.name }));
    pop();
  };

  const facts: [string, string][] = [
    [t('addons.version'), m.version],
    [t('addons.provides'), addonProvides(addon) || '-'],
    [t('addons.types'), (m.types ?? []).map((x) => typeLabel(x)).join(', ') || '-'],
    [t('addons.address'), baseUrlOf(addon)],
  ];

  return (
    <div class="screen screen-addon" data-focus-group="" ref={rootRef}>
      <Scroller inset={6}>
        <section class="addon-detail" data-anchor="top">
          <div class="addon-logo addon-logo-lg">
            <div class="addon-logo-fallback">{m.name.charAt(0).toUpperCase()}</div>
            <Img src={m.logo} />
          </div>
          <div class="addon-detail-body">
            <h1 class="page-title">{m.name}</h1>
            <p class="details-desc">{m.description ?? ''}</p>
            {m.behaviorHints?.p2p && <p class="addon-warning">{t('addons.p2p')}</p>}
            <div class="button-row" data-focus-group="">
              {installed ? (
                <>
                  <Focusable class="btn" isDefault disabled={position <= 0} onSelect={() => moveAddon(transportUrl, -1)}>
                    <Icon name="chevronUp" /> {t('addons.moveUp')}
                  </Focusable>
                  <Focusable class="btn" disabled={position >= installedList.length - 1} onSelect={() => moveAddon(transportUrl, 1)}>
                    <Icon name="chevronDown" /> {t('addons.moveDown')}
                  </Focusable>
                  <Focusable class="btn btn-destructive" onSelect={() => void uninstall()}>
                    <Icon name="trash" /> {t('addons.uninstall')}
                  </Focusable>
                </>
              ) : (
                <Focusable class="btn btn-primary" isDefault disabled={busy} onSelect={() => void install()}>
                  <Icon name="plus" /> {t('addons.install')}
                </Focusable>
              )}
              {configurable && (
                <Focusable
                  class="btn"
                  onSelect={() => void alert(t('addons.configure.title'), t('addons.configure.message', { url: baseUrlOf(addon) + '/configure' }), t('common.ok'))}
                >
                  <Icon name="gear" /> {t('addons.configure')}
                </Focusable>
              )}
            </div>
            {installed && <p class="addon-order">{t('addons.priority', { n: position + 1, total: installedList.length })}</p>}
            <dl class="fact-list">
              {facts.map(([k, v]) => (
                <div class="credit" key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </Scroller>
    </div>
  );
}
