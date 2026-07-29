/**
 * WellSim Backend — Digital Signal Processing Core
 *
 * Dependency-free DSP primitives used by the bio-acoustic analysis
 * pipeline. Everything here is real signal processing computed from the
 * actual audio samples — no simulated or randomised values.
 *
 *   WAV decode  →  resample  →  pre-emphasis  →  STFT  →  Mel filterbank
 *
 * Kept in plain JavaScript (no native modules) so the service runs
 * unchanged on Render's free tier and on a student laptop.
 */

// ─── WAV Decoding ────────────────────────────────────────────────────

/**
 * Decode a RIFF/WAVE buffer into mono float samples in [-1, 1].
 * Supports 8/16/24/32-bit PCM and 32-bit IEEE float.
 *
 * @param {Buffer} buffer - Raw file contents
 * @returns {{ sampleRate: number, samples: Float32Array, duration: number }}
 * @throws {Error} If the buffer is not a decodable WAV file
 */
function decodeWav(buffer) {
  if (buffer.length < 44) throw new Error('File too short to be a WAV');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }

  let pos = 12;
  let fmt = null;
  let dataStart = -1;
  let dataLength = 0;

  // Walk the chunk list — WAV files may carry LIST/fact chunks before data
  while (pos + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', pos, pos + 4);
    const chunkSize = buffer.readUInt32LE(pos + 4);
    const body = pos + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (chunkId === 'data') {
      dataStart = body;
      // Some encoders write 0 or an over-long size; clamp to what we have
      dataLength = Math.min(chunkSize || buffer.length - body, buffer.length - body);
    }

    pos = body + chunkSize + (chunkSize % 2); // chunks are word-aligned
    if (chunkSize === 0) break;
  }

  if (!fmt) throw new Error('WAV is missing its "fmt " chunk');
  if (dataStart < 0) throw new Error('WAV is missing its "data" chunk');

  const { channels, sampleRate, bitsPerSample, audioFormat } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * channels));
  if (frameCount <= 0) throw new Error('WAV contains no audio frames');

  const samples = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const off = dataStart + (i * channels + c) * bytesPerSample;
      let value = 0;

      if (audioFormat === 3 && bitsPerSample === 32) {
        value = buffer.readFloatLE(off);
      } else if (bitsPerSample === 8) {
        value = (buffer.readUInt8(off) - 128) / 128;        // 8-bit PCM is unsigned
      } else if (bitsPerSample === 16) {
        value = buffer.readInt16LE(off) / 32768;
      } else if (bitsPerSample === 24) {
        const raw = buffer.readUInt8(off) |
                    (buffer.readUInt8(off + 1) << 8) |
                    (buffer.readInt8(off + 2) << 16);
        value = raw / 8388608;
      } else if (bitsPerSample === 32) {
        value = buffer.readInt32LE(off) / 2147483648;
      } else {
        throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
      }
      sum += value;
    }
    samples[i] = sum / channels; // downmix to mono
  }

  return { sampleRate, samples, duration: frameCount / sampleRate };
}

// ─── Resampling ──────────────────────────────────────────────────────

/**
 * Linear-interpolation resampler. Adequate here because we always
 * downsample to 8 kHz and pre-filter with the STFT window afterwards.
 */
function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
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

// ─── Normalisation & Pre-emphasis ────────────────────────────────────

/** Scale peak amplitude to 0.95 so quiet recordings analyse consistently. */
function normalize(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-6) return samples;
  const gain = 0.95 / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

/** First-order high-pass. Lifts the higher partials where crackles live. */
function preEmphasis(samples, coeff = 0.97) {
  const out = new Float32Array(samples.length);
  out[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    out[i] = samples[i] - coeff * samples[i - 1];
  }
  return out;
}

/** Remove DC offset — ESP32 ADC/I2S captures often sit off-centre. */
function removeDC(samples) {
  let mean = 0;
  for (let i = 0; i < samples.length; i++) mean += samples[i];
  mean /= samples.length || 1;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - mean;
  return out;
}

// ─── FFT ─────────────────────────────────────────────────────────────

/**
 * In-place iterative radix-2 Cooley–Tukey FFT.
 * `re` and `im` must be Float64Array of identical power-of-two length.
 */
function fftInPlace(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error('FFT length must be a power of two');

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Periodic Hann window of length n. */
function hannWindow(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  }
  return w;
}

/**
 * Short-Time Fourier Transform.
 *
 * @returns {{ frames: Float64Array[], frameCount: number, binCount: number,
 *             hopSize: number, frameSize: number }}
 *          `frames[t][k]` is the magnitude of bin k in frame t.
 */
function stft(samples, frameSize = 512, hopSize = 128) {
  const window = hannWindow(frameSize);
  const binCount = frameSize / 2 + 1;
  const frames = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const re = new Float64Array(frameSize);
    const im = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      re[i] = samples[start + i] * window[i];
    }
    fftInPlace(re, im);

    const mag = new Float64Array(binCount);
    for (let k = 0; k < binCount; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    frames.push(mag);
  }

  return { frames, frameCount: frames.length, binCount, hopSize, frameSize };
}

// ─── Mel Filterbank ──────────────────────────────────────────────────

const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel) => 700 * (Math.pow(10, mel / 2595) - 1);

/**
 * Build a triangular Mel filterbank matrix.
 * @returns {Float64Array[]} filters[m][k] — weight of FFT bin k in mel band m
 */
function melFilterbank(nMels, frameSize, sampleRate, fMin = 50, fMax = null) {
  const binCount = frameSize / 2 + 1;
  const top = fMax || sampleRate / 2;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(top);

  // nMels + 2 equally-spaced points on the mel scale
  const points = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    const mel = melMin + ((melMax - melMin) * i) / (nMels + 1);
    points[i] = Math.floor(((frameSize + 1) * melToHz(mel)) / sampleRate);
  }

  const filters = [];
  for (let m = 1; m <= nMels; m++) {
    const filter = new Float64Array(binCount);
    const left = points[m - 1];
    const center = points[m];
    const right = points[m + 1];

    for (let k = left; k < center; k++) {
      if (k >= 0 && k < binCount && center > left) filter[k] = (k - left) / (center - left);
    }
    for (let k = center; k < right; k++) {
      if (k >= 0 && k < binCount && right > center) filter[k] = (right - k) / (right - center);
    }
    filters.push(filter);
  }
  return filters;
}

/**
 * Log-Mel spectrogram — the standard input representation for
 * respiratory-sound CNNs, and what the dashboard renders as a heatmap.
 *
 * @returns {{ matrix: number[][], nMels: number, frameCount: number }}
 *          `matrix[t][m]` normalised to [0, 1] for display.
 */
function logMelSpectrogram(stftResult, sampleRate, nMels = 40) {
  const filters = melFilterbank(nMels, stftResult.frameSize, sampleRate);
  const matrix = [];
  let min = Infinity;
  let max = -Infinity;

  for (const frame of stftResult.frames) {
    const row = new Array(nMels);
    for (let m = 0; m < nMels; m++) {
      let energy = 0;
      const filter = filters[m];
      for (let k = 0; k < filter.length; k++) {
        if (filter[k] > 0) energy += filter[k] * frame[k] * frame[k];
      }
      const db = 10 * Math.log10(energy + 1e-10);
      row[m] = db;
      if (db < min) min = db;
      if (db > max) max = db;
    }
    matrix.push(row);
  }

  // Normalise to [0, 1] with a 60 dB floor below the peak (standard practice)
  const floor = Math.max(min, max - 60);
  const range = max - floor || 1;
  for (const row of matrix) {
    for (let m = 0; m < nMels; m++) {
      row[m] = Math.max(0, Math.min(1, (row[m] - floor) / range));
    }
  }

  return { matrix, nMels, frameCount: matrix.length };
}

// ─── Envelope & Peak Utilities ───────────────────────────────────────

/** Short-time RMS envelope, one value per hop. */
function rmsEnvelope(samples, frameSize = 256, hopSize = 128) {
  const out = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let sum = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    out.push(Math.sqrt(sum / frameSize));
  }
  return out;
}

/** Moving-average smoother. */
function smooth(series, radius = 2) {
  const out = new Array(series.length);
  for (let i = 0; i < series.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(series.length - 1, i + radius); j++) {
      sum += series[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/**
 * Peak picking with an amplitude threshold and a refractory distance.
 * @returns {number[]} indices of detected peaks
 */
function findPeaks(series, threshold, minDistance) {
  const peaks = [];
  let last = -Infinity;
  for (let i = 1; i < series.length - 1; i++) {
    if (
      series[i] > threshold &&
      series[i] >= series[i - 1] &&
      series[i] > series[i + 1] &&
      i - last >= minDistance
    ) {
      peaks.push(i);
      last = i;
    }
  }
  return peaks;
}

/** Zero-crossing rate over the whole signal. */
function zeroCrossingRate(samples) {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
  }
  return crossings / (samples.length || 1);
}

// ─── Statistics ──────────────────────────────────────────────────────

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function stdDev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

function median(a) {
  if (!a.length) return 0;
  const sorted = [...a].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Robust spread estimate: 1.4826 × median absolute deviation.
 *
 * Standard deviation is the wrong tool for onset detection — the very
 * transients we want to find inflate it, pushing the threshold above
 * the events themselves. MAD ignores outliers, so the threshold tracks
 * the background floor instead of the spikes.
 */
function medianAbsoluteDeviation(a) {
  if (a.length < 2) return 0;
  const med = median(a);
  return 1.4826 * median(a.map((x) => Math.abs(x - med)));
}

module.exports = {
  decodeWav,
  resample,
  normalize,
  preEmphasis,
  removeDC,
  fftInPlace,
  hannWindow,
  stft,
  melFilterbank,
  logMelSpectrogram,
  hzToMel,
  melToHz,
  rmsEnvelope,
  smooth,
  findPeaks,
  zeroCrossingRate,
  mean,
  stdDev,
  median,
  medianAbsoluteDeviation,
};
