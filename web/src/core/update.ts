// Update flow. The app shell on the stick loads this page from the network on
// every launch, so a push to the repository is live at the next start. While
// the app stays open we also poll version.json and reload at a quiet moment.

export interface VersionInfo {
  build: string;
  version: string;
  builtAt: string;
}

export const CURRENT: VersionInfo = {
  build: __APP_BUILD__,
  version: __APP_VERSION__,
  builtAt: __APP_BUILT_AT__,
};

export async function fetchLatest(): Promise<VersionInfo | null> {
  try {
    const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as VersionInfo;
    return json && typeof json.build === 'string' ? json : null;
  } catch {
    return null;
  }
}

export async function updateAvailable(): Promise<boolean> {
  if (CURRENT.build === 'dev') return false;
  const latest = await fetchLatest();
  return !!latest && latest.build !== CURRENT.build;
}

export function applyUpdate(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('v', String(Date.now()));
  window.location.replace(url.toString());
}
