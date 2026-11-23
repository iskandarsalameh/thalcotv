import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { settings, updateSettings, resetSettings, type Settings } from '../../core/settings';
import { applyLocale, LOCALES, t } from '../../core/i18n';
import { langName, languageChoices } from '../../core/langs';
import { caps } from '../../core/caps';
import { normalizeServerUrl, probeServer } from '../../core/server';
import { clearByPrefix } from '../../core/storage';
import { clearResourceCache, resetAddons, initAddons } from '../../core/addons';
import { clearLibrary, library } from '../../core/library';
import { CURRENT, applyUpdate, updateAvailable } from '../../core/update';
import { nativeBridge } from '../../core/bridge';
import { Scroller } from '../components/Scroller';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { alert, confirm, openMenu, promptText, showToast, type MenuOption } from '../overlay';
import { ensureFocus } from '../../nav/spatial';

function Item({ label, value, hint, onSelect, isDefault }: { label: string; value?: string; hint?: string; onSelect: () => void; isDefault?: boolean }) {
  return (
    <Focusable class="setting" onSelect={onSelect} isDefault={isDefault}>
      <div class="setting-text">
        <div class="setting-label">{label}</div>
        {hint && <div class="setting-hint">{hint}</div>}
      </div>
      {value !== undefined && <div class="setting-value">{value}</div>}
      <Icon name="chevronRight" class="setting-chevron" />
    </Focusable>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="settings-section" data-anchor="">
      <h2 class="section-label">{title}</h2>
      <div class="settings-group" data-focus-group="">
        {children}
      </div>
    </section>
  );
}

async function choose<K extends keyof Settings>(key: K, title: string, options: MenuOption<Settings[K]>[]): Promise<void> {
  const current = settings.value[key];
  const v = await openMenu(title, options.map((o) => ({ ...o, selected: o.value === current })));
  if (v !== null) updateSettings({ [key]: v } as Partial<Settings>);
}

const onOff = (v: boolean) => (v ? t('common.on') : t('common.off'));

export function SettingsScreen({ active }: { active: boolean }) {
  const s = settings.value;
  const rootRef = useRef<HTMLDivElement>(null);
  const [serverState, setServerState] = useState<'unknown' | 'ok' | 'down'>('unknown');

  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [active]);

  useEffect(() => {
    if (!s.streamingServerUrl) {
      setServerState('unknown');
      return;
    }
    let alive = true;
    probeServer(s.streamingServerUrl).then((r) => alive && setServerState(r.ok ? 'ok' : 'down'));
    return () => {
      alive = false;
    };
  }, [s.streamingServerUrl]);

  const langOptions = (offLabel: string): MenuOption<string>[] => [{ value: '', label: offLabel }, ...languageChoices().map((l) => ({ value: l.code, label: l.name }))];
  const toggle = (key: 'autoPlayBest' | 'autoFailover' | 'autoPlayNext' | 'hideAdult' | 'reduceMotion') => updateSettings({ [key]: !s[key] } as Partial<Settings>);

  const pickUiLanguage = async () => {
    const v = await openMenu(t('settings.appLanguage'), [
      { value: 'auto', label: t('settings.auto'), selected: s.uiLanguage === 'auto' },
      ...LOCALES.map((l) => ({ value: l.code, label: l.name, selected: s.uiLanguage === l.code })),
    ]);
    if (v === null) return;
    updateSettings({ uiLanguage: v });
    await applyLocale();
  };

  const editServer = async () => {
    const input = await promptText(t('settings.server'), { layout: 'url', initial: s.streamingServerUrl, placeholder: 'http://192.168.1.10:11470', message: t('settings.server.message') });
    if (input === null) {
      if (s.streamingServerUrl && (await confirm(t('settings.server.remove.title'), t('settings.server.remove.message'), t('settings.server.remove'), t('common.cancel'), true))) {
        updateSettings({ streamingServerUrl: '' });
      }
      return;
    }
    let url: string;
    try {
      url = normalizeServerUrl(input);
    } catch {
      await alert(t('settings.server.invalid.title'), t('settings.server.invalid.message'), t('common.ok'));
      return;
    }
    showToast(t('settings.server.testing'), 'refresh');
    const r = await probeServer(url);
    if (!r.ok && !(await confirm(t('settings.server.unreachable.title'), t('settings.server.unreachable.message', { url }), t('settings.server.saveAnyway'), t('common.cancel')))) return;
    updateSettings({ streamingServerUrl: url });
    if (r.ok) showToast(t('settings.server.connected'), 'check');
  };

  const checkUpdate = async () => {
    showToast(t('settings.update.checking'), 'refresh');
    if (await updateAvailable()) {
      if (await confirm(t('settings.update.available.title'), t('settings.update.available.message'), t('settings.update.apply'), t('common.later'))) applyUpdate();
    } else {
      showToast(t('settings.update.latest'), 'check');
    }
  };

  const showDiagnostics = async () => {
    const c = caps();
    const yes = (b: boolean) => (b ? '✓' : '✕');
    const lines = [
      `H.264 ${yes(c.h264)}   HEVC ${yes(c.hevc)}   AV1 ${yes(c.av1)}   VP9 ${yes(c.vp9)}`,
      `MP4 ${yes(c.mp4)}   MKV ${yes(c.mkv)}   WebM ${yes(c.webm)}   HLS ${yes(c.nativeHls || c.mse)}`,
      `AAC ${yes(c.aac)}   Dolby Digital ${yes(c.ac3)}   DD+ ${yes(c.eac3)}   Opus ${yes(c.opus)}`,
      t('settings.diag.native', { state: yes(nativeBridge.nativePlayer) }),
      `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
      navigator.userAgent,
    ];
    await alert(t('settings.diagnostics'), lines.join('\n'), t('common.ok'));
  };

  const clearHistory = async () => {
    if (!(await confirm(t('settings.clearHistory.title'), t('settings.clearHistory.message'), t('settings.clearHistory.action'), t('common.cancel'), true))) return;
    clearLibrary();
    showToast(t('settings.cleared'), 'check');
  };
  const clearCache = () => {
    clearByPrefix('cache:');
    clearResourceCache();
    showToast(t('settings.cleared'), 'check');
  };
  const resetAll = async () => {
    if (!(await confirm(t('settings.reset.title'), t('settings.reset.message'), t('settings.reset.action'), t('common.cancel'), true))) return;
    resetSettings();
    resetAddons();
    clearByPrefix('cache:');
    clearResourceCache();
    await initAddons();
    await applyLocale();
    showToast(t('settings.cleared'), 'check');
  };

  const qualityLabel = (q: number) => (q === 0 ? t('settings.quality.best') : q >= 2160 ? '4K' : q + 'p');
  const libraryCount = Object.keys(library.value).length;

  return (
    <div class="screen screen-settings" data-focus-group="" ref={rootRef}>
      <Scroller inset={12}>
        <header class="page-header page-header-flow" data-anchor="top">
          <h1 class="page-title">{t('tab.settings')}</h1>
        </header>

        <Section title={t('settings.section.playback')}>
          <Item isDefault label={t('settings.autoPlayBest')} hint={t('settings.autoPlayBest.hint')} value={onOff(s.autoPlayBest)} onSelect={() => toggle('autoPlayBest')} />
          <Item label={t('settings.autoFailover')} hint={t('settings.autoFailover.hint')} value={onOff(s.autoFailover)} onSelect={() => toggle('autoFailover')} />
          <Item label={t('settings.autoPlayNext')} value={onOff(s.autoPlayNext)} onSelect={() => toggle('autoPlayNext')} />
          <Item
            label={t('settings.maxQuality')}
            hint={t('settings.maxQuality.hint')}
            value={qualityLabel(s.maxQuality)}
            onSelect={() => void choose('maxQuality', t('settings.maxQuality'), [0, 2160, 1080, 720, 480].map((q) => ({ value: q, label: qualityLabel(q) })))}
          />
          <Item
            label={t('settings.seekStep')}
            value={t('settings.seconds', { n: s.seekStep })}
            onSelect={() => void choose('seekStep', t('settings.seekStep'), [5, 10, 15, 30].map((n) => ({ value: n, label: t('settings.seconds', { n }) })))}
          />
          <Item
            label={t('settings.buffer')}
            hint={t('settings.buffer.hint')}
            value={t('settings.seconds', { n: s.bufferSeconds })}
            onSelect={() => void choose('bufferSeconds', t('settings.buffer'), [30, 60, 90, 120].map((n) => ({ value: n, label: t('settings.seconds', { n }) })))}
          />
        </Section>

        <Section title={t('settings.section.languages')}>
          <Item label={t('settings.appLanguage')} value={s.uiLanguage === 'auto' ? t('settings.auto') : (LOCALES.find((l) => l.code === s.uiLanguage)?.name ?? s.uiLanguage)} onSelect={() => void pickUiLanguage()} />
          <Item
            label={t('settings.audioLanguage')}
            hint={t('settings.audioLanguage.hint')}
            value={s.audioLanguage ? langName(s.audioLanguage) : t('settings.original')}
            onSelect={() => void choose('audioLanguage', t('settings.audioLanguage'), langOptions(t('settings.original')))}
          />
          <Item
            label={t('settings.subtitleLanguage')}
            value={s.subtitleLanguage ? langName(s.subtitleLanguage) : t('common.off')}
            onSelect={() => void choose('subtitleLanguage', t('settings.subtitleLanguage'), langOptions(t('common.off')))}
          />
          <Item
            label={t('settings.secondarySubtitle')}
            hint={t('settings.secondarySubtitle.hint')}
            value={s.secondarySubtitleLanguage ? langName(s.secondarySubtitleLanguage) : t('common.none')}
            onSelect={() => void choose('secondarySubtitleLanguage', t('settings.secondarySubtitle'), langOptions(t('common.none')))}
          />
        </Section>

        <Section title={t('settings.section.subtitles')}>
          <Item
            label={t('settings.subtitleSize')}
            value={s.subtitleSize + '%'}
            onSelect={() => void choose('subtitleSize', t('settings.subtitleSize'), [80, 100, 120, 140, 160].map((n) => ({ value: n, label: n + '%' })))}
          />
          <Item
            label={t('settings.subtitleColor')}
            value={t('color.' + s.subtitleColor)}
            onSelect={() => void choose('subtitleColor', t('settings.subtitleColor'), ['#ffffff', '#ffe14d', '#7dd3fc', '#c8c8c8'].map((c) => ({ value: c, label: t('color.' + c) })))}
          />
          <Item
            label={t('settings.subtitleBackground')}
            value={t('settings.subtitleBackground.' + s.subtitleBackground)}
            onSelect={() =>
              void choose(
                'subtitleBackground',
                t('settings.subtitleBackground'),
                (['shadow', 'box', 'none'] as const).map((b) => ({ value: b, label: t('settings.subtitleBackground.' + b) })),
              )
            }
          />
          <Item
            label={t('settings.subtitlePosition')}
            value={t('settings.subtitlePosition.' + s.subtitleOffset)}
            onSelect={() => void choose('subtitleOffset', t('settings.subtitlePosition'), [4, 8, 14].map((n) => ({ value: n, label: t('settings.subtitlePosition.' + n) })))}
          />
        </Section>

        <Section title={t('settings.section.server')}>
          <Item
            label={t('settings.server')}
            hint={t('settings.server.hint')}
            value={s.streamingServerUrl ? (serverState === 'ok' ? t('settings.server.online') : serverState === 'down' ? t('settings.server.offline') : s.streamingServerUrl) : t('settings.server.notSet')}
            onSelect={() => void editServer()}
          />
        </Section>

        <Section title={t('settings.section.general')}>
          <Item label={t('settings.hideAdult')} value={onOff(s.hideAdult)} onSelect={() => toggle('hideAdult')} />
          <Item label={t('settings.reduceMotion')} value={onOff(s.reduceMotion)} onSelect={() => toggle('reduceMotion')} />
          <Item label={t('settings.clearCache')} hint={t('settings.clearCache.hint')} onSelect={clearCache} />
          <Item label={t('settings.clearHistory')} hint={t('settings.clearHistory.hint', { n: libraryCount })} onSelect={() => void clearHistory()} />
          <Item label={t('settings.reset')} hint={t('settings.reset.hint')} onSelect={() => void resetAll()} />
        </Section>

        <Section title={t('settings.section.about')}>
          <Item label={t('settings.update')} hint={t('settings.update.hint')} value={`${CURRENT.version} (${CURRENT.build})`} onSelect={() => void checkUpdate()} />
          <Item label={t('settings.diagnostics')} hint={t('settings.diagnostics.hint')} onSelect={() => void showDiagnostics()} />
        </Section>
        <p class="settings-footnote">{t('settings.footnote')}</p>
        <div class="page-end" />
      </Scroller>
    </div>
  );
}
