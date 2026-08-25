/**
 * WellSim — The sticky top bar.
 *
 * Three near-copies of this existed: the clinician dashboard, the
 * dashboard's own empty state, and the patient portal. They had
 * already drifted — the empty-state copy still printed its clock in
 * `en-US` under a Thai UI, and never got the device indicator the
 * other one carries on a phone.
 *
 * The parts that genuinely differ between screens come in as props:
 * the kicker beside the wordmark, the content width, whether there is
 * a telemetry strip, and how much of the signed-in user to show.
 */

'use client';

import { LogOut, Printer } from 'lucide-react';
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
  deviceStatus = null,
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
          {/* Phone-sized stand-in for the telemetry strip, which is
              hidden below md. Whether the device is reachable at all is
              the one fact worth keeping on the screen people are most
              likely to check it from. */}
          {deviceStatus && (
            <span
              className="md:hidden flex items-center"
              title={deviceStatus.status === 'online' ? t('header.iotOnline') : t('header.iotOffline')}
            >
              <span
                aria-hidden="true"
                className={`w-1.5 h-1.5 rounded-[1px] ${
                  deviceStatus.status === 'online'
                    ? 'bg-med-500 dark:bg-med-300 animate-blink'
                    : 'bg-risk-high dark:bg-risk-highd'
                }`}
              />
              <span className="sr-only">
                {deviceStatus.status === 'online' ? t('header.iotOnline') : t('header.iotOffline')}
              </span>
            </span>
          )}

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
 * The dashboard's telemetry strip: device link, signal, clock.
 * Hidden below `md`, where the dot in the bar stands in for it.
 */
export function TelemetryStrip({ deviceStatus, currentTime, locale, lang, t }) {
  const lastSeenMs = deviceStatus?.last_seen_ago_ms;
  const recentlySeen = lastSeenMs > 0 && lastSeenMs < 3_600_000;
  const mins = Math.floor((lastSeenMs || 0) / 60_000);

  let linkLabel;
  if (deviceStatus?.status === 'online') {
    linkLabel = t('header.iotOnline');
  } else if (recentlySeen) {
    linkLabel = lang === 'th'
      ? `IOT · เห็นล่าสุด ${mins > 0 ? `${mins}น.` : '<1น.'} ที่แล้ว`
      : `IOT · last seen ${mins > 0 ? `${mins}m` : '<1m'} ago`;
  } else {
    linkLabel = t('header.iotOffline');
  }

  return (
    <div className="hidden md:flex items-center gap-6 font-mono text-[11px] text-muted dark:text-chalk-muted">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-[1px] ${
            deviceStatus?.status === 'online'
              ? 'bg-med-500 dark:bg-med-300 animate-blink'
              : 'bg-risk-high dark:bg-risk-highd'
          }`}
        />
        {linkLabel}
      </span>
      <span>RSSI {deviceStatus?.wifi_strength ? `${deviceStatus.wifi_strength} dBm` : '—'}</span>
      <span className="tabular-nums text-ink dark:text-chalk">
        {currentTime.toLocaleTimeString(locale, { hour12: false })}
      </span>
    </div>
  );
}
