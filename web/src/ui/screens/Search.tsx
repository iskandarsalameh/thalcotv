import { useEffect, useRef, useState } from 'preact/hooks';
import { search, type SearchRow } from '../../core/catalogs';
import { readJSON, writeJSON } from '../../core/storage';
import { t, typeLabel } from '../../core/i18n';
import { Keyboard } from '../components/Keyboard';
import { Row } from '../components/Row';
import { Scroller } from '../components/Scroller';
import { PosterCard } from '../components/Cards';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { EmptyState, Spinner } from '../components/Overlays';
import { openDetails, posterMenu } from '../actions';
import { openMenu } from '../overlay';
import { ensureFocus } from '../../nav/spatial';
import type { MetaPreview } from '../../core/types';

const HISTORY_KEY = 'searchHistory';

function remember(q: string): void {
  const list = readJSON<string[]>(HISTORY_KEY, []).filter((x) => x.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  writeJSON(HISTORY_KEY, list.slice(0, 8));
}

export function SearchScreen({ active }: { active: boolean }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(() => readJSON<string[]>(HISTORY_KEY, []));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRows([]);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    setBusy(true);
    // Wait for a pause in typing before hitting the add-ons.
    const timer = setTimeout(() => {
      const collected: SearchRow[] = [];
      search(
        q,
        (row) => {
          collected.push(row);
          setRows(collected.slice());
        },
        ctrl.signal,
      ).then(() => {
        if (ctrl.signal.aborted) return;
        setBusy(false);
        if (!collected.length) setRows([]);
      });
    }, 550);
    setRows([]);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [active]);

  const open = (m: MetaPreview) => {
    remember(query.trim());
    setHistory(readJSON<string[]>(HISTORY_KEY, []));
    openDetails(m);
  };

  const saveHistory = (list: string[]) => {
    writeJSON(HISTORY_KEY, list);
    setHistory(list);
  };
  // Removing a row can remove the focused element; pick focus back up once the list has redrawn.
  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [history.length]);
  // Hold Select on a recent search to remove it.
  const historyMenu = async (h: string) => {
    const v = await openMenu(h, [
      { value: 'remove', label: t('search.remove') },
      { value: 'clear', label: t('search.clearAll') },
    ]);
    if (v === 'remove') saveHistory(history.filter((x) => x !== h));
    if (v === 'clear') saveHistory([]);
  };

  const q = query.trim();
  return (
    <div class="screen screen-search" data-focus-group="" ref={rootRef}>
      <div class="search-side">
        <div class={'input-field' + (query ? '' : ' input-empty')}>
          <Icon name="search" />
          <span class="input-text">{query || t('search.placeholder')}</span>
          {query && <span class="caret" />}
        </div>
        <Keyboard value={query} onChange={setQuery} compact />
        {history.length > 0 && (
          <div class="search-history" data-focus-group="">
            <div class="section-label">{t('search.recent')}</div>
            {history.slice(0, 4).map((h) => (
              <Focusable class="history-item" key={h} onSelect={() => setQuery(h)} onLongPress={() => void historyMenu(h)}>
                {h}
              </Focusable>
            ))}
            <Focusable class="history-item history-clear" onSelect={() => saveHistory([])}>
              <Icon name="trash" /> {t("search.clear")}
            </Focusable>
          </div>
        )}
      </div>
      <div class="search-results">
        {q.length < 2 ? (
          <EmptyState icon="search" title={t('search.hint.title')} message={t('search.hint.message')} />
        ) : rows.length === 0 ? (
          busy ? (
            <Spinner label={t('search.searching')} />
          ) : (
            <EmptyState icon="search" title={t('search.none.title', { query: q })} message={t('search.none.message')} />
          )
        ) : (
          <Scroller inset={3}>
            {rows.map((row) => (
              <section class="shelf shelf-inset" data-anchor="" key={row.ref.key}>
                <h2 class="shelf-title">
                  {typeLabel(row.ref.catalog.type)}
                  <span class="shelf-source"> · {row.ref.addon.manifest.name}</span>
                </h2>
                <Row
                  items={row.items}
                  itemWidth={14}
                  span={74}
                  keyOf={(m) => m.id}
                  render={(m, i) => <PosterCard meta={m} index={i} onSelect={() => open(m)} onLongPress={() => void posterMenu(m)} />}
                />
              </section>
            ))}
            <div class="page-end" />
          </Scroller>
        )}
      </div>
    </div>
  );
}
