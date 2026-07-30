/**
 * WellSim — Browser Audio → WAV Encoder
 *
 * MediaRecorder gives us WebM/Opus or MP4/AAC depending on the browser.
 * The analysis engine reads PCM WAV, so a browser-captured recording
 * would otherwise be stored but never screened.
 *
 * We decode the compressed blob with the Web Audio API — which every
 * target browser can do for its own output format — and re-encode it as
 * 16-bit mono PCM WAV at 16 kHz. That matches what the ESP32 firmware
 * sends, so both capture paths reach the engine in the same shape.
 */

const TARGET_SAMPLE_RATE = 16000;

/** Longest recording we will send. 16 kHz mono ≈ 32 kB/s, so 120 s ≈ 3.8 MB. */
export const MAX_DURATION_SEC = 120;

/** Reject huge files before spending time decoding them. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Extensions the file picker advertises. Anything the browser decodes works. */
export const ACCEPTED_AUDIO = '.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.webm,.flac,audio/*';

/**
 * Decode any audio blob — a MediaRecorder capture or a file the user
 * picked — and re-encode it as mono 16-bit PCM WAV.
 *
 * Both capture paths converge here so the analysis engine always
 * receives the same format, whatever the source was.
 *
 * @param {Blob|File} blob
 * @param {Object} [options]
 * @param {number} [options.maxDurationSec] - Trim anything longer
 * @returns {Promise<{ blob, base64, durationSec, sampleRate, sourceSampleRate, sourceChannels, trimmed }>}
 * @throws {Error} If the browser cannot decode the file
 */
export async function encodeWavFromBlob(blob, options = {}) {
  const maxDuration = options.maxDurationSec ?? MAX_DURATION_SEC;

  if (blob.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is ${(blob.size / 1024 / 1024).toFixed(1)} MB — the limit is ` +
      `${MAX_FILE_BYTES / 1024 / 1024} MB.`
    );
  }

  const arrayBuffer = await blob.arrayBuffer();

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('This browser does not support the Web Audio API.');

  const ctx = new Ctx();
  let audioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch (e) {
    throw new Error(
      'This file could not be decoded as audio. Try WAV, MP3, M4A, OGG, or FLAC.'
    );
  } finally {
    // Safari keeps contexts alive; close explicitly to free the hardware
    if (ctx.state !== 'closed') ctx.close().catch(() => {});
  }

  // Downmix to mono
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  // Resample to the target rate (linear interpolation is sufficient —
  // the engine band-limits to 8 kHz internally anyway)
  const from = audioBuffer.sampleRate;
  let resampled = from === TARGET_SAMPLE_RATE ? mono : resampleLinear(mono, from, TARGET_SAMPLE_RATE);

  // Trim to the cap. Auscultation only needs a few breath cycles, and
  // an unbounded upload would blow past the API's body-size limit.
  const maxSamples = Math.floor(maxDuration * TARGET_SAMPLE_RATE);
  const trimmed = resampled.length > maxSamples;
  if (trimmed) resampled = resampled.subarray(0, maxSamples);

  if (resampled.length < TARGET_SAMPLE_RATE * 3) {
    throw new Error(
      `Recording is only ${(resampled.length / TARGET_SAMPLE_RATE).toFixed(1)}s — ` +
      `the engine needs at least 3 seconds to analyse.`
    );
  }

  const wavBuffer = encodeWav(resampled, TARGET_SAMPLE_RATE);
  const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

  return {
    blob: wavBlob,
    base64: arrayBufferToBase64(wavBuffer),
    durationSec: resampled.length / TARGET_SAMPLE_RATE,
    sampleRate: TARGET_SAMPLE_RATE,
    sourceSampleRate: from,
    sourceChannels: channels,
    trimmed,
  };
}

/** Format seconds as m:ss for the duration label. */
export function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function resampleLinear(samples, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = src - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/** Write a 16-bit PCM mono RIFF/WAVE file. */
function encodeWav(samples, sampleRate) {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // format = PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/** Chunked base64 — avoids blowing the argument limit on long recordings. */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
