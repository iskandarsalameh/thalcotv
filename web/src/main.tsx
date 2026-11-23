import { render } from 'preact';
import './styles.css';
import { App } from './ui/App';
import { initMetrics } from './ui/metrics';
import { initSpatial } from './nav/spatial';
import { initSettings } from './core/settings';
import { initLibrary } from './core/library';
import { applyLocale } from './core/i18n';
import { hydrateFromNative } from './core/storage';
import { nativeBridge } from './core/bridge';

async function boot(): Promise<void> {
  // If the WebView's storage was wiped, the native shell hands back its mirror.
  hydrateFromNative(nativeBridge.info.store);
  initMetrics();
  initSettings();
  initLibrary();
  initSpatial();
  await applyLocale();
  render(<App />, document.getElementById('app')!);
}

void boot();
