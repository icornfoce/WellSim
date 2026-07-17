/**
 * WellSim — Theme Toggle (UI v3)
 *
 * A quiet 28px switch. Persists to localStorage (`wellsim_theme`);
 * the initial class is applied pre-hydration by layout.js.
 */

'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ className = '' }) {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('wellsim_theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable — theme still toggles for this session */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Light mode' : 'Dark mode'}
      aria-label="Toggle color theme"
      className={`relative w-7 h-7 rounded border border-hairline-strong dark:border-coal-600
                  text-muted hover:text-ink hover:border-ink/50
                  dark:text-chalk-muted dark:hover:text-chalk dark:hover:border-chalk/50
                  transition-colors duration-200 flex items-center justify-center ${className}`}
    >
      <Sun
        className={`absolute w-3.5 h-3.5 transition-all duration-300
          ${isDark ? 'opacity-0 -rotate-45 scale-75' : 'opacity-100 rotate-0 scale-100'}`}
      />
      <Moon
        className={`absolute w-3.5 h-3.5 transition-all duration-300
          ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-45 scale-75'}`}
      />
      {!mounted && <span className="sr-only">theme</span>}
    </button>
  );
}
