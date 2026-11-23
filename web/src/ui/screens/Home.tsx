import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MetaPreview } from '../../core/types';
import { addonsRevision } from '../../core/addons';
import { fetchCatalog, formatRuntime, genresOf, homeCatalogs, peekCatalog, ratingOf, type CatalogRef } from '../../core/catalogs';
import { continueWatching, itemProgress, library } from '../../core/library';
import { t, typeLabel } from '../../core/i18n';
import { Row } from '../components/Row';
import { Scroller } from '../components/Scroller';
import { PosterCard, WideCard, libraryItemToPreview } from '../components/Cards';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { Img } from '../components/Img';
import { EmptyState, Loading } from '../components/Overlays';
import { openDetails, playFromPreview, posterMenu } from '../actions';
import { chromeHidden } from '../state';
import { switchTab } from '../../nav/router';
import { ensureFocus, focusFirst, getFocused, hasInteracted } from '../../nav/spatial';

export function catalogTitle(ref: CatalogRef): string {
  const raw = ref.catalog.name || ref.addon.manifest.name;
  const key = 'catalog.' + raw.toLowerCase();
  const translated = t(key);
  const name = translated === key ? raw : translated;
  return t('row.title', { name, type: typeLabel(ref.catalog.type) });
}

function Hero({ items, active }: { items: MetaPreview[]; active: boolean }) {
  const [i, setI] = useState(0);
  const [focused, setFocused] = useState(false);
  const count = Math.min(items.length, 6);
  useEffect(() => {
    if (!active || count < 2) return;
    // Rotate slowly; pause while the viewer is on the buttons so nothing changes under their thumb.
    if (focused) return;
    const id = setInterval(() => setI((x) => (x + 1) % count), 12000);
    return () => clearInterval(id);
  }, [active, count, focused]);
  const m = items[Math.min(i, count - 1)];
  if (!m) return null;
  const facts = [m.releaseInfo ?? '', formatRuntime(m.runtime), genresOf(m).slice(0, 2).join(' · ')].filter(Boolean);
  const rating = ratingOf(m);
  return (
    <section class="hero" data-anchor="top">
      <div class="hero-art" key={m.id}>
        <Img src={m.background} />
      </div>
      <div class="hero-shade" />
      <div class="hero-body">
        <div class="hero-eyebrow">{t('home.featured')}</div>
        {m.logo ? <Img class="hero-logo" src={m.logo} alt={m.name} /> : null}
        <h1 class={'hero-title' + (m.logo ? ' hero-title-backup' : '')}>{m.name}</h1>
        <div class="facts">
          {rating && (
            <span class="fact fact-rating">
              <Icon name="star" /> {rating}
            </span>
          )}
          {facts.map((f) => (
            <span class="fact" key={f}>
              {f}
            </span>
          ))}
        </div>
        {m.description && <p class="hero-desc">{m.description}</p>}
        <div class="button-row" data-focus-group="" onFocusIn={() => setFocused(true)} onFocusOut={() => setFocused(false)}>
          <Focusable class="btn btn-primary" isDefault onSelect={() => void playFromPreview(m)}>
            <Icon name="play" /> {t('common.play')}
          </Focusable>
          <Focusable class="btn" onSelect={() => openDetails(m)}>
            <Icon name="info" /> {t('common.moreInfo')}
          </Focusable>
        </div>
      </div>
      {count > 1 && (
        <div class="hero-dots">
          {items.slice(0, count).map((x, k) => (
            <span key={x.id} class={'dot' + (k === i ? ' dot-on' : '')} />
          ))}
        </div>
      )}
    </section>
  );
}

function CatalogRow({ cref, load, onItems }: { cref: CatalogRef; load: boolean; onItems?: (items: MetaPreview[]) => void }) {
  const [items, setItems] = useState<MetaPreview[] | null>(() => peekCatalog(cref));
  const [failed, setFailed] = useState(false);
  const more = useRef({ hasMore: true, loading: false });

  useEffect(() => {
    if (!load) return;
    let alive = true;
    fetchCatalog(cref)
      .then((page) => {
        if (!alive) return;
        more.current.hasMore = page.hasMore;
        setItems(page.items);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [load, cref.key]);

  useEffect(() => {
    if (items && onItems) onItems(items);
  }, [items]);

  const loadMore = () => {
    const m = more.current;
    if (!items || m.loading || !m.hasMore || items.length >= 300) return;
    m.loading = true;
    fetchCatalog(cref, { skip: items.length })
      .then((page) => {
        m.hasMore = page.hasMore && page.items.length > 0;
        const seen = new Set(items.map((x) => x.id));
        setItems(items.concat(page.items.filter((x) => !seen.has(x.id))));
      })
      .catch(() => {
        m.hasMore = false;
      })
      .then(() => {
        m.loading = false;
      });
  };

  if (items && items.length === 0) return null;
  if (!items && failed) return null;
  const wide = items?.[0]?.posterShape === 'landscape';
  return (
    <section class="shelf" data-anchor="">
      <h2 class="shelf-title">{catalogTitle(cref)}</h2>
      {items ? (
        <Row
          items={items}
          itemWidth={wide ? 26 : 14}
          keyOf={(m) => m.id}
          onEndReached={loadMore}
          render={(m, i) => <PosterCard meta={m} index={i} onSelect={() => openDetails(m)} onLongPress={() => void posterMenu(m)} />}
        />
      ) : (
        <div class="shelf-skeleton">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
            <div class="skeleton-poster" key={k} />
          ))}
        </div>
      )}
    </section>
  );
}

export function HomeScreen({ active }: { active: boolean }) {
  // Re-evaluate when add-ons change.
  const rev = addonsRevision.value;
  const refs = useMemo(() => homeCatalogs(), [rev]);
  const [reach, setReach] = useState(3);
  const [featured, setFeatured] = useState<MetaPreview[]>(() => (refs[0] ? (peekCatalog(refs[0]) ?? []) : []));
  const rootRef = useRef<HTMLDivElement>(null);
  const cw = continueWatching(library.value);
  const withArt = featured.filter((m) => m.background);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (e: FocusEvent) => {
      const shelf = (e.target as HTMLElement).closest<HTMLElement>('[data-shelf]');
      if (shelf) setReach((r) => Math.max(r, Number(shelf.dataset.shelf) + 4));
    };
    root.addEventListener('focusin', onFocusIn);
    return () => root.removeEventListener('focusin', onFocusIn);
  }, []);

  useEffect(() => {
    if (!active) return;
    // On launch focus belongs on the content, not the tab bar.
    if (!hasInteracted() && withArt.length > 0 && !rootRef.current?.contains(getFocused())) focusFirst(rootRef.current);
    else ensureFocus(rootRef.current);
  }, [active, featured.length > 0, refs.length]);

  return (
    <div class="screen screen-home" data-focus-group="" ref={rootRef}>
      <Scroller onScrolled={(s) => (chromeHidden.value = s)} inset={3}>
        {withArt.length > 0 ? (
          <Hero items={withArt} active={active} />
        ) : refs.length > 0 ? (
          <div class="hero hero-loading" data-anchor="top">
            <Loading />
          </div>
        ) : null}
        {cw.length > 0 && (
          <section class="shelf" data-anchor="">
            <h2 class="shelf-title">{t('home.continueWatching')}</h2>
            <Row
              items={cw}
              itemWidth={26}
              keyOf={(it) => it.id}
              render={(it, i) => (
                <WideCard
                  index={i}
                  title={it.name}
                  image={it.background || it.poster}
                  progress={itemProgress(it) || 0.02}
                  onSelect={() => void playFromPreview(libraryItemToPreview(it))}
                  onLongPress={() => void posterMenu(libraryItemToPreview(it), { continueWatching: true })}
                />
              )}
            />
          </section>
        )}
        {refs.map((r, i) => (
          <div data-shelf={i} key={r.key}>
            <CatalogRow cref={r} load={i < reach} onItems={i === 0 ? setFeatured : undefined} />
          </div>
        ))}
        {refs.length === 0 && (
          <EmptyState icon="puzzle" title={t('home.empty.title')} message={t('home.empty.message')}>
            <Focusable class="btn btn-primary" onSelect={() => switchTab('addons')}>
              {t('home.empty.action')}
            </Focusable>
          </EmptyState>
        )}
        <div class="page-end" />
      </Scroller>
      <div class={'top-fade' + (chromeHidden.value ? ' top-fade-on' : '')} />
    </div>
  );
}
