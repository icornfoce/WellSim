/**
 * WellSim — Playback of one stored recording.
 *
 * Both the clinician dashboard and the patient portal had their own
 * copy of this, and both copies carried the same defect: every press
 * of play built a fresh `new Audio(url)`, so pausing halfway through a
 * lung recording and pressing play again restarted it from zero. There
 * was no way to stop, think, and carry on from the same second.
 *
 * This owns one element per URL and reuses it, which is what makes
 * pause/resume and seeking possible at all.
 *
 * It plays the stored file and nothing else. An earlier version of the
 * dashboard fell back to a Web Audio synthesiser when the file failed
 * to load — it played a generated "heartbeat" and ran the progress bar
 * as though the patient's own audio were playing. A clinician
 * listening to that would have been auscultating an oscillator. A
 * failed load says so and stops.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useAudioPlayback({ url, t }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [playDuration, setPlayDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState('');

  const progress = playDuration > 0 ? Math.round((playTime / playDuration) * 100) : 0;

  /** Tear down whatever is loaded and return to a resting state. */
  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setIsPlaying(false);
    setPlayTime(0);
    setPlayDuration(0);
    setPlaybackError('');
  }, []);

  // Moving to another patient or another recording resets the player.
  useEffect(() => {
    stop();
  }, [url, stop]);

  // Leaving the screen must not leave audio playing behind it.
  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  /** The element for the current URL, built once and then reused. */
  const ensureAudio = useCallback(() => {
    if (!url) return null;
    const existing = audioRef.current;
    if (existing && existing.dataset?.src === url) return existing;

    existing?.pause();

    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous'; // Required for cross-origin audio playback
    audio.preload = 'metadata';
    audio.dataset.src = url;

    const syncDuration = () => {
      if (isFinite(audio.duration)) setPlayDuration(audio.duration);
    };
    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('durationchange', syncDuration);
    audio.addEventListener('timeupdate', () => setPlayTime(audio.currentTime));
    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      setPlayTime(0);
    });
    audio.addEventListener('pause', () => setIsPlaying(false));
    audio.addEventListener('error', () => {
      console.warn('Audio file failed to load:', url);
      audioRef.current = null;
      setIsPlaying(false);
      setPlayTime(0);
      setPlayDuration(0);
      setPlaybackError(t('audio.playbackFailed'));
    });

    audioRef.current = audio;
    return audio;
  }, [url, t]);

  const toggle = useCallback(() => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    if (!url) {
      setPlaybackError(t('audio.playbackMissing'));
      return;
    }

    setPlaybackError('');
    const audio = ensureAudio();
    if (!audio) return;

    audio.play()
      .then(() => setIsPlaying(true))
      .catch((err) => {
        console.error('Audio playback failed:', err);
        setIsPlaying(false);
        setPlaybackError(t('audio.playbackFailed'));
      });
  }, [isPlaying, url, ensureAudio, t]);

  /**
   * Jump to a fraction (0–1) of the recording.
   *
   * The waveform already draws the segments the screening engine
   * flagged; until this existed it was a picture. Being able to seek is
   * what turns "wheeze at 3.2 s" into something a doctor can go and
   * listen to.
   */
  const seekToFraction = useCallback((fraction) => {
    if (!url) return;
    const clamped = Math.min(Math.max(fraction, 0), 1);
    const audio = ensureAudio();
    if (!audio) return;

    const applySeek = () => {
      if (!isFinite(audio.duration)) return;
      audio.currentTime = clamped * audio.duration;
      setPlayTime(audio.currentTime);
    };

    if (isFinite(audio.duration) && audio.duration > 0) {
      applySeek();
    } else {
      // Metadata has not arrived yet on the very first interaction.
      audio.addEventListener('loadedmetadata', applySeek, { once: true });
    }
  }, [url, ensureAudio]);

  /** Keyboard equivalent of dragging the playhead. */
  const nudge = useCallback((deltaSec) => {
    const total = playDuration || audioRef.current?.duration || 0;
    if (!total) return;
    seekToFraction(Math.min(Math.max(playTime + deltaSec, 0), total) / total);
  }, [playDuration, playTime, seekToFraction]);

  return {
    isPlaying,
    progress,
    playTime,
    playDuration,
    playbackError,
    setPlaybackError,
    toggle,
    seekToFraction,
    nudge,
    stop,
  };
}

export default useAudioPlayback;
