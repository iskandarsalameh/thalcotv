import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MetaPreview } from '../../core/types';
import { addonsRevision } from '../../core/addons';
import { availableTypes, catalogsForType, fetchCatalog, genreIsRequired, genreOptions, type CatalogRef } from '../../core/catalogs';
import { t, typeLabel } from '../../core/i18n';
import { Grid } from '../components/Grid';
import { PosterCard } from '../components/Cards';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { EmptyState, Loading } from '../components/Overlays';
import { openDetails, posterMenu } from '../actions';
import { openMenu } from '../overlay';
import { ensureFocus } from '../../nav/spatial';
import { push } from '../../nav/router';

function refName(ref: CatalogRef): string {
  const raw = ref.catalog.name || ref.catalog.id;
  const key = 'catalog.' + raw.toLowerCase();
  const tr = t(key);
  return tr === key ? raw : tr;
}

interface Props {
  active: boolean;
  /** Content type this tab opens with. */
  type: string;
  /** Preselected catalog (when opened from "See all"). */
  initial?: { ref: CatalogRef; genre?: string };
  title?: string;
}

/** Sortable, filterable wall of everything a catalog offers. */
export function BrowseScreen({ active, type: initialType, initial, title }: Props) {
  const rev = addonsRevision.value;
  const [type, setType] = useState(initial?.ref.catalog.type ?? initialType);
  const refs = useMemo(() => catalogsForType(type), [type, rev]);
  const [refKey, setRefKey] = useState<string | null>(initial?.ref.key ?? null);
  const ref = refs.find((r) => r.key === refKey) ?? refs[0];
  const [genre, setGenre] = useState<string | null>(initial?.genre ?? null);
  const [items, setItems] = useState<MetaPreview[] | null>(null);
  const [error, setError] = useState(false);
  const paging = useRef({ hasMore: false, loading: false, token: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  const genres = ref ? genreOptions(ref) : [];
  const required = ref ? genreIsRequired(ref) : false;
  const activeGenre = genre && genres.includes(genre) ? genre : required ? (genres[0] ?? null) : null;

  useEffect(() => {
    if (!ref) {
      setItems([]);
      return;
    }
    const token = ++paging.current.token;
    setItems(null);
    setError(false);
    fetchCatalog(ref, activeGenre ? { genre: activeGenre } : {})
      .then((page) => {
        if (paging.current.token !== token) return;
        paging.current.hasMore = page.hasMore;
        setItems(page.items);
      })
      .catch(() => {
        if (paging.current.token !== token) return;
        setError(true);
        setItems([]);
      });
  }, [ref?.key, activeGenre]);

  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [active, items !== null]);

  const loadMore = () => {
    const p = paging.current;
    if (!ref || !items || p.loading || !p.hasMore || items.length >= 600) return;
    p.loading = true;
    const token = p.token;
    fetchCatalog(ref, { ...(activeGenre ? { genre: activeGenre } : {}), skip: items.length })
      .then((page) => {
        if (p.token !== token) return;
        p.hasMore = page.hasMore && page.items.length > 0;
        const seen = new Set(items.map((x) => x.id));
        setItems(items.concat(page.items.filter((x) => !seen.has(x.id))));
      })
      .catch(() => {
        p.hasMore = false;
      })
      .then(() => {
        p.loading = false;
      });
  };

  const pickType = async () => {
    const types = availableTypes();
    const v = await openMenu(t('browse.type'), types.map((x) => ({ value: x, label: typeLabel(x), selected: x === type })));
    if (v) {
      setType(v);
      setRefKey(null);
      setGenre(null);
    }
  };
  const pickCatalog = async () => {
    const v = await openMenu(
      t('browse.catalog'),
      refs.map((r) => ({ value: r.key, label: refName(r), detail: r.addon.manifest.name, selected: r.key === ref?.key })),
    );
    if (v) {
      setRefKey(v);
      setGenre(null);
    }
  };
  const pickGenre = async () => {
    const opts = genres.map((g) => ({ value: g, label: g, selected: g === activeGenre }));
    if (!required) opts.unshift({ value: '', label: t('browse.allGenres'), selected: !activeGenre });
    const v = await openMenu(t('browse.genre'), opts);
    if (v !== null) setGenre(v || null);
  };

  const types = availableTypes();
  return (
    <div class="screen screen-browse" data-focus-group="" ref={rootRef}>
      <header class="page-header">
        <h1 class="page-title">{title ?? typeLabel(type)}</h1>
        <div class="chip-row" data-focus-group="">
          {types.length > 2 && !initial && (
            <Focusable class="chip" onSelect={() => void pickType()}>
              {typeLabel(type)} <Icon name="chevronDown" />
            </Focusable>
          )}
          {refs.length > 0 && (
            <Focusable class="chip" isDefault onSelect={() => void pickCatalog()}>
              {ref ? refName(ref) : t('browse.catalog')} <Icon name="chevronDown" />
            </Focusable>
          )}
          {genres.length > 0 && (
            <Focusable class="chip" onSelect={() => void pickGenre()}>
              {activeGenre ?? t('browse.allGenres')} <Icon name="chevronDown" />
            </Focusable>
          )}
        </div>
      </header>
      <div class="page-body">
        {items === null ? (
          <Loading />
        ) : items.length === 0 ? (
          refs.length === 0 ? (
            <EmptyState icon="puzzle" title={t('browse.noCatalogs.title')} message={t('browse.noCatalogs.message')}>
              <Focusable class="btn btn-primary" onSelect={() => push({ name: 'addons' })}>
                {t('home.empty.action')}
              </Focusable>
            </EmptyState>
          ) : (
            <EmptyState icon={error ? 'warn' : 'search'} title={error ? t('error.loadFailed') : t('browse.empty')} message={error ? t('error.checkConnection') : undefined} />
          )
        ) : (
          <Grid
            items={items}
            columns={7}
            itemWidth={14}
            rowHeight={26.5}
            keyOf={(m) => m.id}
            onEndReached={loadMore}
            render={(m, i) => <PosterCard meta={m} index={i} onSelect={() => openDetails(m)} onLongPress={() => void posterMenu(m)} />}
          />
        )}
      </div>
    </div>
  );
}
