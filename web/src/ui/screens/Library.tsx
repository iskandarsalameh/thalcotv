import { useEffect, useRef, useState } from 'preact/hooks';
import { library, libraryList, libraryTypes, type LibraryFilter, type LibrarySort } from '../../core/library';
import { readJSON, writeJSON } from '../../core/storage';
import { t, typeLabel } from '../../core/i18n';
import { Grid } from '../components/Grid';
import { PosterCard, libraryItemToPreview } from '../components/Cards';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/Overlays';
import { openDetails, posterMenu } from '../actions';
import { openMenu } from '../overlay';
import { ensureFocus } from '../../nav/spatial';
import { switchTab } from '../../nav/router';

const SORTS: LibrarySort[] = ['recent', 'added', 'name', 'nameDesc', 'year', 'mostWatched'];
const FILTERS: LibraryFilter[] = ['all', 'inProgress', 'unwatched', 'watched'];

interface View {
  type: string;
  sort: LibrarySort;
  filter: LibraryFilter;
}

export function LibraryScreen({ active }: { active: boolean }) {
  const [view, setViewState] = useState<View>(() => ({ type: 'all', sort: 'recent', filter: 'all', ...readJSON<Partial<View>>('libraryView', {}) }));
  const setView = (patch: Partial<View>) => {
    const next = { ...view, ...patch };
    setViewState(next);
    writeJSON('libraryView', next);
  };
  const map = library.value;
  const types = libraryTypes(map);
  const type = view.type !== 'all' && !types.includes(view.type) ? 'all' : view.type;
  const items = libraryList({ type, sort: view.sort, filter: view.filter }, map);
  const anySaved = types.length > 0;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [active, items.length === 0]);

  const pickType = async () => {
    const v = await openMenu(t('browse.type'), [
      { value: 'all', label: t('library.allTypes'), selected: type === 'all' },
      ...types.map((x) => ({ value: x, label: typeLabel(x), selected: x === type })),
    ]);
    if (v) setView({ type: v });
  };
  const pickSort = async () => {
    const v = await openMenu(t('library.sort'), SORTS.map((s) => ({ value: s, label: t('library.sort.' + s), selected: s === view.sort })));
    if (v) setView({ sort: v });
  };
  const pickFilter = async () => {
    const v = await openMenu(t('library.filter'), FILTERS.map((f) => ({ value: f, label: t('library.filter.' + f), selected: f === view.filter })));
    if (v) setView({ filter: v });
  };

  return (
    <div class="screen screen-browse" data-focus-group="" ref={rootRef}>
      <header class="page-header">
        <h1 class="page-title">{t('tab.library')}</h1>
        {anySaved && (
          <div class="chip-row" data-focus-group="">
            <Focusable class="chip" onSelect={() => void pickType()}>
              {type === 'all' ? t('library.allTypes') : typeLabel(type)} <Icon name="chevronDown" />
            </Focusable>
            <Focusable class="chip" isDefault onSelect={() => void pickSort()}>
              {t('library.sort.' + view.sort)} <Icon name="chevronDown" />
            </Focusable>
            <Focusable class="chip" onSelect={() => void pickFilter()}>
              {t('library.filter.' + view.filter)} <Icon name="chevronDown" />
            </Focusable>
          </div>
        )}
      </header>
      <div class="page-body">
        {!anySaved ? (
          <EmptyState icon="plus" title={t('library.empty.title')} message={t('library.empty.message')}>
            <Focusable class="btn btn-primary" onSelect={() => switchTab('home')}>
              {t('library.empty.action')}
            </Focusable>
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState icon="search" title={t('library.noMatch')} />
        ) : (
          <Grid
            items={items}
            columns={7}
            itemWidth={14}
            rowHeight={26.5}
            keyOf={(it) => it.id}
            render={(it, i) => {
              const p = libraryItemToPreview(it);
              return <PosterCard meta={p} index={i} onSelect={() => openDetails(p)} onLongPress={() => void posterMenu(p)} />;
            }}
          />
        )}
      </div>
    </div>
  );
}
