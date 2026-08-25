/**
 * WellSim — Toast notifications (UI v3 "Instrument")
 *
 * Replaces the native `alert()` calls the app used to report failures
 * with. Three reasons that mattered here:
 *
 *   1. `alert()` text was hard-coded English, so the Thai UI dropped
 *      into English the moment anything went wrong.
 *   2. It blocks the whole tab, and Chrome suppresses repeats — a save
 *      failure could end up reported to nobody.
 *   3. There was no success path at all: saving vitals just went quiet,
 *      which reads exactly like a save that silently failed.
 *
 * Toasts are announced through an aria-live region, so a screen reader
 * hears the outcome instead of watching the button un-disable.
 */

'use client';

import { createContext, useContext, useCallback, useState, useRef, useEffect } from 'react';
import { Check, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext({ toast: () => {} });

const TONES = {
  success: {
    Icon: Check,
    bar: 'bg-med-600 dark:bg-med-300',
    text: 'text-med-700 dark:text-med-300',
  },
  error: {
    Icon: AlertTriangle,
    bar: 'bg-risk-high dark:bg-risk-highd',
    text: 'text-risk-high dark:text-risk-highd',
  },
  info: {
    Icon: Info,
    bar: 'bg-ink dark:bg-chalk',
    text: 'text-ink dark:text-chalk',
  },
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message, { tone = 'info', duration } = {}) => {
      if (!message) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // Failures stay put until dismissed. A message you have to act on
      // should not disappear while you are reading the number it broke.
      const ttl = duration ?? (tone === 'error' ? 0 : 4500);
      setItems((prev) => [...prev.slice(-2), { id, message, tone }]);
      if (ttl > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), ttl));
      }
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {/* Bottom-centre on a phone (thumb reach, clear of the sticky
          header), bottom-right on desktop. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed z-[200] pointer-events-none print-hidden
                   bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm
                   sm:left-auto sm:translate-x-0 sm:right-5 sm:bottom-5
                   flex flex-col gap-2"
      >
        {items.map(({ id, message, tone }) => {
          const { Icon, bar, text } = TONES[tone] || TONES.info;
          return (
            <div
              key={id}
              role={tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto card !bg-surface dark:!bg-coal-850 shadow-sm
                         flex items-start gap-2.5 pl-0 pr-2 py-2.5 overflow-hidden will-fade-up"
            >
              <span className={`w-[3px] self-stretch shrink-0 ${bar}`} aria-hidden="true" />
              <Icon className={`w-3.5 h-3.5 shrink-0 mt-px ${text}`} aria-hidden="true" />
              <p className="prose-clinical flex-1 min-w-0 break-words">{message}</p>
              <button
                type="button"
                onClick={() => dismiss(id)}
                aria-label="Dismiss"
                className="tap-target shrink-0 text-muted hover:text-ink dark:text-chalk-muted dark:hover:text-chalk transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
