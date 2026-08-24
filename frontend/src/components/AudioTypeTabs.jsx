/**
 * WellSim — The lung / heart / cough selector.
 *
 * A real tablist: arrow keys move between the three recordings, and
 * each tab carries a filled dot when a file exists behind it. Without
 * that marker the only way to find out which of the three was actually
 * captured is to click all three.
 */

'use client';

import { AUDIO_TYPES } from '../lib/audioTypes';

export default function AudioTypeTabs({ active, onChange, audioLogs, t, gap = 'gap-4' }) {
  const move = (step) => {
    const next = AUDIO_TYPES[(AUDIO_TYPES.indexOf(active) + step + AUDIO_TYPES.length) % AUDIO_TYPES.length];
    onChange(next);
  };

  return (
    <div className={`flex ${gap}`} role="tablist" aria-label={t('a11y.recordingType')}>
      {AUDIO_TYPES.map((type) => {
        const recorded = !!audioLogs?.[type]?.available;
        const selected = active === type;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={recorded ? t('audio.hasRecording') : t('audio.noRecording')}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              move(step);
            }}
            onClick={() => onChange(type)}
            // py-2.5 is not decoration: at pb-0.5 these tabs were a
            // 19px-tall tap target on a phone.
            className={`flex items-center gap-1.5 text-[13px] capitalize text-center min-w-[2.75rem] px-1 py-2.5 border-b-2 transition-colors duration-200 ${
              selected
                ? 'font-semibold text-ink dark:text-chalk border-med-600 dark:border-med-300'
                : 'font-medium text-muted dark:text-chalk-muted border-transparent hover:text-ink dark:hover:text-chalk'
            }`}
          >
            {t('audio.' + type)}
            <span
              aria-hidden="true"
              className={`w-1.5 h-1.5 rounded-[1px] shrink-0 ${
                recorded ? 'bg-med-600 dark:bg-med-300' : 'border border-hairline-strong dark:border-coal-600'
              }`}
            />
            <span className="sr-only">
              {recorded ? t('audio.hasRecording') : t('audio.noRecording')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
