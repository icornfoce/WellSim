/**
 * WellSim — The sticky top bar.
 */

'use client';

import React from 'react';
import { LogOut, Printer, Activity } from 'lucide-react';
import PulseMark from './ui/PulseMark';
import ThemeToggle from './ThemeToggle';
import LangToggle from './LangToggle';

const ICON_BUTTON =
  `tap-target w-7 h-7 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
   transition-colors duration-200`;

export default function TopBar({
  kicker,
  width = 'max-w-7xl',
  telemetry = null,
  user = null,
  showRole = false,
  onPrint = null,
  onLogout,
  t,
}) {
  return (
    <header className="sticky top-0 z-50 bg-surface/95 dark:bg-coal-900/95 backdrop-blur-sm border-b border-hairline dark:border-coal-700 px-4 sm:px-6 print-hidden">
      <div className={`${width} mx-auto flex items-center justify-between h-14 gap-4`}>

        {/* Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 rounded bg-ink dark:bg-chalk flex items-center justify-center">
            <PulseMark className="w-4 h-4 text-white dark:text-coal-950" />
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-[15px] font-semibold tracking-tight text-ink dark:text-chalk">WellSim</span>
            {kicker && <span className="microlabel hidden sm:inline">{kicker}</span>}
          </div>
        </div>

        {telemetry}

        <div className="flex items-center gap-3">
          <LangToggle />
          <ThemeToggle />

          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              title={t('header.print')}
              aria-label={t('header.print')}
              className={`${ICON_BUTTON} text-muted hover:text-ink hover:border-ink/50
                          dark:text-chalk-muted dark:hover:text-chalk dark:hover:border-chalk/50`}
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
          )}

          <span className="w-px h-5 bg-hairline dark:bg-coal-700" />

          {showRole ? (
            <div className="text-right hidden sm:block leading-tight">
              <p className="text-xs font-semibold text-ink dark:text-chalk">{user?.name || 'Staff'}</p>
              <p className="font-mono text-[10px] text-muted dark:text-chalk-muted uppercase">
                {['nurse', 'doctor', 'patient'].includes(user?.role) ? t('role.' + user.role) : t('role.unknown')}
                {' · '}{user?.station || '—'}
              </p>
            </div>
          ) : (
            <p className="text-xs font-semibold text-ink dark:text-chalk hidden sm:block">{user?.name}</p>
          )}

          <button
            type="button"
            onClick={onLogout}
            title={t('header.signOut')}
            aria-label={t('header.signOut')}
            className={`${ICON_BUTTON} text-muted hover:text-risk-high hover:border-risk-high/50
                        dark:text-chalk-muted dark:hover:text-risk-highd dark:hover:border-risk-highd/50`}
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * The dashboard's telemetry strip: system status, live clock.
 */
export function TelemetryStrip({ currentTime, locale, lang, t }) {
  return (
    <div className="hidden md:flex items-center gap-6 font-mono text-[11px] text-muted dark:text-chalk-muted">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-[1px] bg-med-500 dark:bg-med-300 animate-blink"
        />
        <span className="text-med-700 dark:text-med-300 font-medium">
          {lang === 'th' ? 'ระบบคัดกรองพร้อมใช้งาน' : 'SYSTEM ONLINE'}
        </span>
      </span>
      <span className="tabular-nums text-ink dark:text-chalk">
        {currentTime ? currentTime.toLocaleTimeString(locale, { hour12: false }) : ''}
      </span>
    </div>
  );
}
