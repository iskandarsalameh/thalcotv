import { Focusable } from './Focusable';
import { Icon } from './Icon';
import { t } from '../../core/i18n';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '1234567890'.split('');
const URL_KEYS = ['.', '/', ':', '-', '_', '?', '=', '&', '%', '@', '~', '+', '#'];
const URL_SNIPPETS = ['https://', '.com', '.org', '.io', '/manifest.json'];

interface Props {
  value: string;
  onChange: (v: string) => void;
  layout?: 'text' | 'url';
  /** Narrow keyboard for the search column. */
  compact?: boolean;
  onSubmit?: () => void;
  submitLabel?: string;
}

/**
 * Grid keyboard for the remote. The system keyboard is avoided on purpose:
 * a fixed grid keeps focus predictable and the results visible while typing.
 */
export function Keyboard({ value, onChange, layout = 'text', compact, onSubmit, submitLabel }: Props) {
  const add = (s: string) => onChange(value + s);
  const key = (k: string, wide = false) => (
    <Focusable key={k} class={'key' + (wide ? ' key-wide' : '')} onSelect={() => add(k)} isDefault={k === 'a'}>
      {k}
    </Focusable>
  );
  return (
    <div class={'keyboard' + (compact ? ' keyboard-compact' : '') + (layout === 'url' ? ' keyboard-url' : '')} data-focus-group="" dir="ltr">
      {layout === 'url' && <div class="key-row">{URL_SNIPPETS.map((k) => key(k, true))}</div>}
      <div class="key-grid">{LETTERS.map((k) => key(k))}</div>
      <div class="key-grid">{DIGITS.map((k) => key(k))}</div>
      {layout === 'url' && <div class="key-grid">{URL_KEYS.map((k) => key(k))}</div>}
      <div class="key-row">
        {layout !== 'url' && (
          <Focusable class="key key-wide" onSelect={() => add(' ')} label={t('kb.space')}>
            {t('kb.space')}
          </Focusable>
        )}
        <Focusable class="key key-wide" onSelect={() => onChange(value.slice(0, -1))} onLongPress={() => onChange('')} label={t('kb.delete')}>
          <Icon name="backspace" />
        </Focusable>
        <Focusable class="key key-wide" onSelect={() => onChange('')} label={t('kb.clear')}>
          {t('kb.clear')}
        </Focusable>
        {onSubmit && (
          <Focusable class="key key-wide key-submit" onSelect={onSubmit}>
            {submitLabel ?? t('common.done')}
          </Focusable>
        )}
      </div>
    </div>
  );
}
