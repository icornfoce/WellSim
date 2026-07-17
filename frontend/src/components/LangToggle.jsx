/**
 * WellSim — Language Toggle (UI v3)
 *
 * Sits beside ThemeToggle: same quiet 28px footprint.
 * Shows the language you would switch TO.
 */

'use client';

import { useLang } from '../i18n/LanguageContext';

export default function LangToggle({ className = '' }) {
  const { lang, setLang, t } = useLang();
  const next = lang === 'th' ? 'en' : 'th';

  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      title={t('lang.switch')}
      aria-label={t('lang.switch')}
      className={`h-7 px-2 rounded border border-hairline-strong dark:border-coal-600
                  font-mono text-[10px] uppercase tracking-wider
                  text-muted hover:text-ink hover:border-ink/50
                  dark:text-chalk-muted dark:hover:text-chalk dark:hover:border-chalk/50
                  transition-colors duration-200 flex items-center justify-center ${className}`}
    >
      {next === 'th' ? 'ไทย' : 'EN'}
    </button>
  );
}
