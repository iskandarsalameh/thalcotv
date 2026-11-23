import { describe, expect, it } from 'vitest';
import en from '../src/locales/en';
import { LOCALES } from '../src/core/i18n';

const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');

describe('translations', () => {
  for (const info of LOCALES) {
    it(`${info.code} has every string with matching placeholders`, async () => {
      const dict = (await info.load()).default;
      const missing = Object.keys(en).filter((k) => typeof dict[k] !== 'string' || dict[k] === '');
      expect(missing).toEqual([]);
      const extra = Object.keys(dict).filter((k) => !(k in en));
      expect(extra).toEqual([]);
      const mismatched = Object.keys(en).filter((k) => placeholders(en[k]) !== placeholders(dict[k]));
      expect(mismatched).toEqual([]);
    });
  }
});
