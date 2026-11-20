import { describe, expect, it } from 'vitest';
import { allKeys, getLang, setLang, t, translation } from '../i18n';

describe('interface text', () => {
  it('has Arabic and English for every string', () => {
    for (const key of allKeys()) {
      expect(translation(key, 'ar').trim().length, key).toBeGreaterThan(0);
      expect(translation(key, 'en').trim().length, key).toBeGreaterThan(0);
    }
  });

  it('uses Arabic script for the Arabic text', () => {
    for (const key of allKeys()) {
      // The language switch is labelled in the *other* language on purpose.
      if (key === 'language' || key === 'languageShort') continue;
      expect(translation(key, 'ar'), key).toMatch(/[؀-ۿ]/);
    }
  });

  it('switches language', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('brake')).toBe('Brake');
    setLang('ar');
    expect(t('brake')).toBe('الفرامل');
  });
});
