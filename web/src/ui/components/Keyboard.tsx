import { useEffect, useRef, useState } from 'preact/hooks';
import { Focusable } from './Focusable';
import { Icon } from './Icon';
import { locale, t } from '../../core/i18n';
import { addKeyHandler, focusEl } from '../../nav/spatial';

/** Search: a 6 x 6 block, letters then digits, so every row is full. */
const GRID = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');
/** Dialogs: a familiar QWERTY block, ten keys to a row. */
const QWERTY = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm./:'].map((r) => r.split(''));
const URL_SYMBOLS = ['_', '?', '=', '&', '%', '@', '~', '+', '#', ','];
const URL_SNIPPETS = ['https://', '.com', '.org', '.net', '/manifest.json'];

interface Props {
  value: string;
  onChange: (v: string) => void;
  layout?: 'text' | 'url';
  /** Narrow keyboard for the search column. */
  compact?: boolean;
  onSubmit?: () => void;
  submitLabel?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * On-screen keyboard for the remote. A fixed grid keeps focus predictable and
 * the results visible while typing. Dictate hands over to voice input: the
 * browser's speech recognition where the engine has it, otherwise the system
 * keyboard, which listens when the remote's microphone button is held.
 * Typing on a connected physical keyboard works as well.
 */
export function Keyboard({ value, onChange, layout = 'text', compact, onSubmit, submitLabel }: Props) {
  const [mode, setMode] = useState<'idle' | 'listening' | 'system'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const micRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  const add = (s: string) => latest.current.onChange(latest.current.value + s);
  const backspace = () => latest.current.onChange(latest.current.value.slice(0, -1));

  const openSystemKeyboard = () => {
    const el = inputRef.current;
    if (!el) return;
    el.value = latest.current.value;
    setMode('system');
    el.focus();
  };

  const dictate = () => {
    if (mode === 'listening') {
      recognition.current?.abort();
      return;
    }
    const SR = speechRecognition();
    if (SR) {
      try {
        const r = new SR();
        let heard = false;
        r.lang = locale.value;
        r.interimResults = false;
        r.onresult = (e) => {
          const text = e.results[0]?.[0]?.transcript ?? '';
          if (!text) return;
          heard = true;
          const cur = latest.current.value;
          latest.current.onChange(cur && !cur.endsWith(' ') ? cur + ' ' + text : cur + text);
        };
        r.onerror = () => {
          // No speech service on this device: fall back to the system keyboard's voice input.
          if (!heard) openSystemKeyboard();
        };
        r.onend = () => {
          recognition.current = null;
          setMode((m) => (m === 'listening' ? 'idle' : m));
        };
        recognition.current = r;
        setMode('listening');
        r.start();
        // Some engines expose the API without a speech service behind it and never answer.
        setTimeout(() => {
          if (recognition.current === r && !heard) {
            r.onerror = null;
            r.abort();
            openSystemKeyboard();
          }
        }, 8000);
        return;
      } catch {
        recognition.current = null;
      }
    }
    openSystemKeyboard();
  };

  useEffect(() => {
    // Physical keyboards (and phone remote apps) type straight into the field.
    const onType = (e: KeyboardEvent) => {
      if (e.target === inputRef.current) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
        e.preventDefault();
        e.stopPropagation();
        add(e.key);
      }
    };
    window.addEventListener('keydown', onType, true);
    const offKey = addKeyHandler((e, action) => {
      if (action === 'back' && e.key === 'Backspace' && e.target !== inputRef.current) {
        backspace();
        return true;
      }
      return false;
    });
    return () => {
      window.removeEventListener('keydown', onType, true);
      offKey();
      recognition.current?.abort();
    };
  }, []);

  const closeSystemKeyboard = () => {
    setMode('idle');
    focusEl(micRef.current);
  };

  const key = (k: string, cls = '') => (
    <Focusable key={k} class={'key ' + cls} onSelect={() => add(k)} isDefault={k === (compact ? 'a' : 'q')}>
      {k}
    </Focusable>
  );

  const micKey = (
    <Focusable class={'key key-action' + (mode !== 'idle' ? ' key-live' : '')} onSelect={dictate} label={t('kb.dictate')} elRef={(el) => (micRef.current = el)}>
      <Icon name="mic" />
      <span>{mode === 'listening' ? t('kb.listening') : t('kb.dictate')}</span>
    </Focusable>
  );
  const spaceKey = (
    <Focusable class="key key-action" onSelect={() => add(' ')} label={t('kb.space')}>
      <span>{t('kb.space')}</span>
    </Focusable>
  );
  const deleteKey = (
    <Focusable class="key key-action" onSelect={backspace} onLongPress={() => latest.current.onChange('')} label={t('kb.delete')}>
      <Icon name="backspace" />
      <span>{t('kb.delete')}</span>
    </Focusable>
  );
  const clearKey = (
    <Focusable class="key key-action" onSelect={() => latest.current.onChange('')} label={t('kb.clear')}>
      <span>{t('kb.clear')}</span>
    </Focusable>
  );

  return (
    <div class={'keyboard' + (compact ? ' keyboard-compact' : ' keyboard-wide')} data-focus-group="" dir="ltr">
      {compact ? (
        <>
          <div class="key-grid key-grid-6">{GRID.map((k) => key(k))}</div>
          <div class="key-grid key-grid-2">
            {micKey}
            {spaceKey}
            {deleteKey}
            {clearKey}
          </div>
        </>
      ) : (
        <>
          {layout === 'url' && <div class="key-grid key-grid-5">{URL_SNIPPETS.map((k) => key(k, 'key-snippet'))}</div>}
          {QWERTY.map((row, i) => (
            <div class="key-grid key-grid-10" key={i}>
              {row.map((k) => key(k))}
            </div>
          ))}
          {layout === 'url' && <div class="key-grid key-grid-10">{URL_SYMBOLS.map((k) => key(k))}</div>}
          <div class={'key-grid ' + (onSubmit ? 'key-grid-5' : 'key-grid-4')}>
            {micKey}
            {spaceKey}
            {deleteKey}
            {clearKey}
            {onSubmit && (
              <Focusable class="key key-action key-submit" onSelect={onSubmit}>
                <Icon name="check" />
                <span>{submitLabel ?? t('common.done')}</span>
              </Focusable>
            )}
          </div>
        </>
      )}
      {mode === 'system' && <div class="key-hint">{t('kb.dictateHint')}</div>}
      <input
        ref={inputRef}
        class="ime-input"
        type="text"
        tabIndex={-1}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        aria-label={t('kb.dictate')}
        onInput={(e) => latest.current.onChange((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            closeSystemKeyboard();
          }
        }}
        onBlur={() => setMode((m) => (m === 'system' ? 'idle' : m))}
      />
    </div>
  );
}
