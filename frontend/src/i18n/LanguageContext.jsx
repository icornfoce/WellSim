/**
 * WellSim — Language Context (EN / TH)
 *
 * Lightweight i18n: a React context with a `t(key, vars)` resolver.
 * The choice persists to localStorage (`wellsim_lang`); first visit
 * follows the browser language. No external dependencies.
 */

'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations } from './translations';

const LanguageContext = createContext({
  lang: 'en',
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('en');

  // Restore saved choice (or follow the browser) after mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wellsim_lang');
      if (saved === 'th' || saved === 'en') {
        setLangState(saved);
      } else if (typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('th')) {
        setLangState('th');
      }
    } catch {
      /* storage unavailable — default stays 'en' */
    }
  }, []);

  // Keep <html lang> in sync for accessibility / screen readers
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    setLangState(next);
    try {
      localStorage.setItem('wellsim_lang', next);
    } catch {
      /* non-fatal */
    }
  }, []);

  const t = useCallback(
    (key, vars) => {
      const resolve = (locale) =>
        key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), translations[locale]);

      let text = resolve(lang);
      if (text === undefined) text = resolve('en'); // fallback
      if (text === undefined) return key;           // last resort: show the key

      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.split(`{${k}}`).join(String(v));
        }
      }
      return text;
    },
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLang = () => useContext(LanguageContext);
