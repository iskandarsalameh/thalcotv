import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import qrcode from 'qrcode-generator';
import { channelFragment, listen, newChannel, send } from '../../core/pairing';
import { fetchManifest, installAddon } from '../../core/addons';
import { nativeBridge } from '../../core/bridge';
import { t } from '../../core/i18n';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { EmptyState, Loading } from '../components/Overlays';
import { confirm, showToast } from '../overlay';
import { ensureFocus } from '../../nav/spatial';
import { pop } from '../../nav/router';
import { addByUrl } from './Addons';

/** Address of the published interface, where the phone page lives. */
function hostedBase(): string | null {
  if (/^https?:$/.test(location.protocol)) return new URL('./', location.href).toString();
  const fromShell = nativeBridge.info.appUrl;
  return fromShell && /^https:\/\//.test(fromShell) ? fromShell.replace(/[^/]*$/, '') : null;
}

function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { size: n, path: d };
  }, [text]);
  // Four modules of quiet zone, as the QR specification asks for.
  return (
    <svg class="qr" viewBox={`-4 -4 ${size + 8} ${size + 8}`} shape-rendering="crispEdges" role="img" aria-label="QR">
      <rect x="-4" y="-4" width={size + 8} height={size + 8} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

interface Props {
  active: boolean;
  /** When set, the phone is first sent to this add-on's setup page. */
  configureUrl?: string;
}

export function PairScreen({ active, configureUrl }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const channel = useMemo(() => newChannel(), []);
  const [base, setBase] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<'waiting' | 'offline' | 'received' | 'more'>('waiting');
  const busy = useRef(false);

  // The phone page is part of the published interface; make sure it is really there.
  useEffect(() => {
    const candidate = hostedBase();
    if (!candidate) {
      setBase(null);
      return;
    }
    if (/^https?:$/.test(location.protocol)) {
      setBase(candidate);
      return;
    }
    let alive = true;
    fetch(candidate + 'version.json', { cache: 'no-store' })
      .then((r) => alive && setBase(r.ok ? candidate : null))
      .catch(() => alive && setBase(null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!base) return;
    return listen(
      channel,
      'add',
      async (msg) => {
        if (busy.current) return;
        busy.current = true;
        setStatus('received');
        let installedName = '';
        try {
          const addon = await fetchManifest(msg.url);
          const ok = await confirm(addon.manifest.name, addon.manifest.description ?? addon.transportUrl, t('addons.install'), t('common.cancel'));
          if (ok) {
            installAddon(addon);
            installedName = addon.manifest.name;
            showToast(t('addons.installed', { name: installedName }), 'check');
          }
          void send(channel, { t: 'ack', ok, name: addon.manifest.name }).catch(() => undefined);
        } catch {
          void send(channel, { t: 'ack', ok: false }).catch(() => undefined);
          showToast(t('addons.addFailed.title'), 'warn', 5000);
        }
        busy.current = false;
        setStatus(installedName ? 'more' : 'waiting');
        ensureFocus(rootRef.current);
      },
      (online) => setStatus((s) => (online ? (s === 'offline' ? 'waiting' : s) : s === 'received' ? s : 'offline')),
    );
  }, [base]);

  useEffect(() => {
    if (active) ensureFocus(rootRef.current);
  }, [active, base]);

  if (base === undefined) {
    return (
      <div class="screen screen-pair" data-focus-group="" ref={rootRef}>
        <Loading />
      </div>
    );
  }
  if (base === null) {
    return (
      <div class="screen screen-pair screen-center" data-focus-group="" ref={rootRef}>
        <EmptyState icon="warn" title={t('pair.unavailable.title')} message={t('pair.unavailable.message')}>
          <Focusable class="btn btn-primary" isDefault onSelect={() => void addByUrl()}>
            <Icon name="keyboard" /> {t('addons.addByUrl')}
          </Focusable>
          <Focusable class="btn" onSelect={() => pop()}>
            {t('common.back')}
          </Focusable>
        </EmptyState>
      </div>
    );
  }

  const link = base + 'pair.html' + channelFragment(channel, configureUrl);
  const statusText =
    status === 'offline' ? t('pair.offline') : status === 'received' ? t('pair.received') : status === 'more' ? t('pair.more') : t('pair.waiting');

  return (
    <div class="screen screen-pair" data-focus-group="" ref={rootRef}>
      <div class="pair">
        <div class="pair-code">
          <QrCode text={link} />
        </div>
        <div class="pair-body">
          <h1 class="page-title">{t('pair.title')}</h1>
          <ol class="pair-steps">
            <li>
              <span class="pair-num">1</span>
              {t('pair.step1')}
            </li>
            <li>
              <span class="pair-num">2</span>
              {configureUrl ? t('pair.step2.configure') : t('pair.step2')}
            </li>
            <li>
              <span class="pair-num">3</span>
              {t('pair.step3')}
            </li>
          </ol>
          <div class={'pair-status' + (status === 'offline' ? ' pair-status-bad' : '')}>
            {status !== 'offline' && status !== 'more' && <span class="spinner spinner-sm" />}
            {status === 'more' && <Icon name="check" />}
            {statusText}
          </div>
          <div class="button-row">
            <Focusable class="btn" isDefault onSelect={() => pop()}>
              {t('common.done')}
            </Focusable>
            <Focusable class="btn" onSelect={() => void addByUrl()}>
              <Icon name="keyboard" /> {t('addons.addByUrl')}
            </Focusable>
          </div>
          <p class="pair-note">{t('pair.private')}</p>
        </div>
      </div>
    </div>
  );
}
