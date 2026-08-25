/**
 * WellSim — Player for one stored recording.
 *
 * The track is the control, not a picture. Click it, or use the arrow
 * keys, to move the playhead; where the screening engine has run, the
 * segments it flagged are drawn on the same axis, so a finding like
 * "wheeze at 3.2 s" is one tap away from being heard.
 *
 * The readout is elapsed time over total. The bare percentage it
 * replaces could not answer "how far in was that crackle?".
 */

'use client';

import { Play, Pause } from 'lucide-react';
import { formatDuration } from '../lib/audioEncoder';

export default function AudioPlayer({
  player,
  waveform = null,
  segments = null,
  durationSec = 0,
  t,
}) {
  const { isPlaying, progress, playTime, playDuration, playbackError, toggle, seekToFraction, nudge } = player;

  const total = playDuration || durationSec || 0;
  const bars = waveform && waveform.length ? waveform : null;
  const flaggedSegments = (segments || []).filter((s) => s.type !== 'heart_sound');

  const onSeekKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1); }
    else if (e.key === 'Home') { e.preventDefault(); seekToFraction(0); }
    else if (e.key === 'End') { e.preventDefault(); seekToFraction(0.999); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  };

  const onSeekClick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width > 0) seekToFraction((e.clientX - box.left) / box.width);
  };

  const seekProps = {
    role: 'slider',
    tabIndex: 0,
    'aria-label': t('a11y.seek'),
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': progress,
    'aria-valuetext': t('audio.timeOf', {
      cur: formatDuration(playTime),
      total: formatDuration(total),
    }),
    onKeyDown: onSeekKeyDown,
    onClick: onSeekClick,
  };

  return (
    <div>
      <div className="mt-3 bg-ink dark:bg-coal-850 dark:border dark:border-coal-700 rounded-md p-4 flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? t('a11y.pause') : t('a11y.play')}
          className="w-11 h-11 sm:w-10 sm:h-10 rounded bg-med-500 hover:bg-med-400 text-white flex items-center justify-center
                     flex-shrink-0 transition-colors duration-200 active:translate-y-px"
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
        </button>

        {bars ? (
          // h-11 on touch: a 40px strip is a fiddly seek target with a
          // fingertip. The bars keep their height; only the hit area grows.
          <div
            {...seekProps}
            className="relative flex-1 h-11 flex items-center gap-[2px] overflow-hidden cursor-pointer
                       rounded-sm focus-visible:outline-offset-4"
          >
            <div
              className="absolute top-0 bottom-0 left-0 border-r border-white/50 transition-all duration-300 z-10 pointer-events-none"
              style={{ width: `${progress}%` }}
            />
            {bars.map((amp, i) => {
              const played = (i / bars.length) * 100 <= progress;
              // Is this slice inside a flagged segment?
              const tSec = durationSec ? (i / bars.length) * durationSec : -1;
              const flagged = durationSec > 0 && flaggedSegments.some((s) => tSec >= s.start && tSec <= s.end);
              return (
                <div
                  key={i}
                  aria-hidden="true"
                  className={`flex-1 min-w-[1px] rounded-[1px] transition-colors duration-300 pointer-events-none ${
                    flagged
                      ? 'bg-risk-modd'
                      : played
                        ? `bg-med-400 ${isPlaying ? 'eq-bar' : ''}`
                        : 'bg-white/15'
                  }`}
                  style={{
                    height: `${Math.max(3, amp * 34)}px`,
                    animationDelay: `${(i % 6) * 0.11}s`,
                  }}
                />
              );
            })}
          </div>
        ) : (
          // No screening has run yet, so there is no envelope to draw —
          // but the recording is still seekable.
          <div
            {...seekProps}
            className="relative flex-1 h-11 flex items-center cursor-pointer rounded-sm focus-visible:outline-offset-4"
          >
            <div className="relative w-full h-3 bg-white/20 dark:bg-coal-700 rounded overflow-hidden">
              <div
                className="absolute top-0 bottom-0 left-0 bg-med-400 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <span className="font-mono text-[11px] text-chalk-muted tabular-nums text-right shrink-0 leading-tight">
          <span className="text-chalk">{formatDuration(playTime)}</span>
          <span className="block">{formatDuration(total)}</span>
        </span>
      </div>

      {playbackError && (
        <p role="alert" className="note mt-2 !text-risk-high dark:!text-risk-highd">
          {playbackError}
        </p>
      )}

      {/* The waveform's colour coding, stated once rather than left for
          the reader to infer. */}
      {bars && flaggedSegments.length > 0 && (
        <p className="note-sm mt-2 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-[1px] bg-risk-modd shrink-0" aria-hidden="true" />
          {t('audio.flaggedSegment')}
        </p>
      )}
    </div>
  );
}
