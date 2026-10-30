/**
 * EchoStage · 轻量 DSP 工具
 * 无第三方依赖，可在浏览器 Worker / Node 中运行。
 */

export const TAU = Math.PI * 2;

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(midi) {
  const m = Math.round(midi);
  return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
export function pitchClassName(pc) {
  return NAMES[((Math.round(pc) % 12) + 12) % 12];
}

/** 原地 radix-2 FFT（仅正变换） */
export class FFT {
  constructor(n) {
    if ((n & (n - 1)) !== 0) throw new Error('FFT size must be power of two');
    this.n = n;
    this.levels = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let x = i;
      let r = 0;
      for (let j = 0; j < this.levels; j++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-TAU * i) / n);
      this.sin[i] = Math.sin((-TAU * i) / n);
    }
  }

  transform(re, im) {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * this.cos[k] - im[l] * this.sin[k];
          const tim = re[l] * this.sin[k] + im[l] * this.cos[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  }
}

export function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1));
  return w;
}

/** RBJ biquad，原地处理 */
export function biquad(samples, type, freq, q, sampleRate) {
  const w0 = (TAU * freq) / sampleRate;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - cosw) / 2;
    b1 = 1 - cosw;
    b2 = (1 - cosw) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw;
    a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cosw) / 2;
    b1 = -(1 + cosw);
    b2 = (1 + cosw) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw;
    a2 = 1 - alpha;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cosw;
    a2 = 1 - alpha;
  }
  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = nb0 * x + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    out[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}

/** 简单抽取（先做低通，避免明显混叠） */
export function downsample(samples, factor) {
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0, j = 0; j < out.length; i += factor, j++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += samples[i + k] || 0;
    out[j] = s / factor;
  }
  return out;
}

export function rmsAt(samples, start, end) {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, start); i < Math.min(samples.length, end); i++) {
    s += samples[i] * samples[i];
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
}

export function median(values) {
  if (!values.length) return 0;
  const a = Float32Array.from(values);
  a.sort();
  const m = a.length >> 1;
  return a.length & 1 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * YIN 基频轨迹
 * @returns {{time:number, midi:number, freq:number, confidence:number, rms:number}[]}
 */
export function trackPitch(samples, sampleRate, opts = {}) {
  const {
    fmin = 70,
    fmax = 1200,
    frameSize = 1024,
    hop = 441,
    threshold = 0.15,
    rmsFloor = 0.004,
    maxFrames = Infinity,
  } = opts;

  const maxLag = Math.min(Math.floor(sampleRate / fmin), frameSize - 2);
  const minLag = Math.max(2, Math.floor(sampleRate / fmax));
  const diff = new Float32Array(maxLag + 1);
  const cmnd = new Float32Array(maxLag + 1);
  const frames = [];
  const nFrames = Math.min(Math.ceil((samples.length - frameSize) / hop) + 1, maxFrames);

  for (let fi = 0; fi < nFrames; fi++) {
    const start = fi * hop;
    let energy = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = samples[start + i] || 0;
      energy += v * v;
    }
    const rms = Math.sqrt(energy / frameSize);
    const time = (start + frameSize / 2) / sampleRate;
    if (rms < rmsFloor) {
      frames.push({ time, midi: NaN, freq: 0, confidence: 0, rms });
      continue;
    }

    diff[0] = 0;
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0;
      const limit = frameSize - lag;
      for (let i = 0; i < limit; i++) {
        const d = samples[start + i] - samples[start + i + lag];
        sum += d * d;
      }
      diff[lag] = sum;
    }
    let running = 0;
    cmnd[0] = 1;
    for (let lag = 1; lag <= maxLag; lag++) {
      running += diff[lag];
      cmnd[lag] = running > 0 ? (diff[lag] * lag) / running : 1;
    }

    let bestLag = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (cmnd[lag] < threshold) {
        while (lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag]) lag++;
        bestLag = lag;
        break;
      }
    }
    if (bestLag < 0) {
      let min = 1e9;
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (cmnd[lag] < min) {
          min = cmnd[lag];
          bestLag = lag;
        }
      }
      if (bestLag > 0 && min > 0.32) bestLag = -1;
    }
    if (bestLag < 2) {
      frames.push({ time, midi: NaN, freq: 0, confidence: 0, rms });
      continue;
    }
    let refined = bestLag;
    if (bestLag > 1 && bestLag < maxLag) {
      const a = cmnd[bestLag - 1];
      const b = cmnd[bestLag];
      const c = cmnd[bestLag + 1];
      const denom = 2 * (2 * b - a - c);
      if (Math.abs(denom) > 1e-9) refined = bestLag + (a - c) / denom;
    }
    const freq = sampleRate / refined;
    const confidence = clamp(1 - cmnd[bestLag]);
    frames.push({ time, midi: freqToMidi(freq), freq, confidence, rms });
  }

  // 5 帧中值滤波，抑制八度跳变
  const mids = frames.map((f) => f.midi);
  for (let i = 2; i < frames.length - 2; i++) {
    if (!Number.isFinite(frames[i].midi)) continue;
    const win = [];
    for (let k = -2; k <= 2; k++) if (Number.isFinite(frames[i + k].midi)) win.push(frames[i + k].midi);
    if (win.length >= 3) frames[i].midi = median(win);
  }
  void mids;
  return frames;
}

/** 把逐帧音高变成音符事件 */
export function framesToNotes(frames, opts = {}) {
  const {
    minDuration = 0.09,
    maxGap = 0.075,
    pitchTolerance = 0.75,
    minMidi = 0,
    maxMidi = 127,
    hop = 0.04,
    minConfidence = 0.55,
  } = opts;

  const notes = [];
  let group = null;
  const push = () => {
    if (!group) return;
    const dur = group.end - group.start;
    if (dur >= minDuration && group.midi >= minMidi && group.midi <= maxMidi) {
      const velocity = clamp(0.28 + group.rms * 7, 0.2, 1);
      notes.push({
        t: +group.start.toFixed(3),
        dur: +Math.max(dur, 0.08).toFixed(3),
        midi: Math.round(group.midi),
        velocity,
        confidence: clamp(group.confidence),
      });
    }
    group = null;
  };

  for (const f of frames) {
    if (!Number.isFinite(f.midi) || f.confidence < minConfidence) {
      push();
      continue;
    }
    if (!group) {
      group = { start: f.time, end: f.time + hop, midi: f.midi, confidence: f.confidence, rms: f.rms, sum: f.midi, n: 1 };
      continue;
    }
    const gap = f.time - group.end;
    const drift = Math.abs(f.midi - group.sum / group.n);
    if (gap > maxGap || drift > pitchTolerance) {
      push();
      group = { start: f.time, end: f.time + hop, midi: f.midi, confidence: f.confidence, rms: f.rms, sum: f.midi, n: 1 };
    } else {
      group.end = f.time + hop;
      group.sum += f.midi;
      group.n++;
      group.confidence = Math.max(group.confidence, f.confidence);
      group.rms = Math.max(group.rms, f.rms);
    }
  }
  push();
  return notes;
}

/**
 * 频谱特征：flux / 各频段能量 / chroma / RMS
 * 不保存完整幅度谱，控制内存。
 */
export function computeSpectralFeatures(samples, sampleRate, opts = {}) {
  const { frameSize = 2048, hop = 512, fft = new FFT(frameSize) } = opts;
  const win = hann(frameSize);
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);
  const nFrames = Math.max(0, Math.floor((samples.length - frameSize) / hop) + 1);
  const fps = sampleRate / hop;
  const times = new Float32Array(nFrames);
  const rms = new Float32Array(nFrames);
  const fluxFull = new Float32Array(nFrames);
  const bands = {
    sub: new Float32Array(nFrames),
    kick: new Float32Array(nFrames),
    lowmid: new Float32Array(nFrames),
    snare: new Float32Array(nFrames),
    presence: new Float32Array(nFrames),
    hat: new Float32Array(nFrames),
  };
  const chroma = new Float32Array(nFrames * 12);
  const centroid = new Float32Array(nFrames);
  const flatness = new Float32Array(nFrames);
  const highRatio = new Float32Array(nFrames);
  const prevMag = new Float32Array(frameSize / 2);
  const mag = new Float32Array(frameSize / 2);
  const bandRanges = {
    sub: [25, 70],
    kick: [50, 160],
    lowmid: [160, 400],
    snare: [400, 2500],
    presence: [2500, 6000],
    hat: [6000, 14000],
  };
  const binHz = sampleRate / frameSize;
  const binToPc = new Int8Array(frameSize / 2);
  for (let k = 1; k < frameSize / 2; k++) {
    const f = k * binHz;
    binToPc[k] = f >= 200 && f <= 2500 ? ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12 : -1;
  }

  for (let fi = 0; fi < nFrames; fi++) {
    const start = fi * hop;
    let e = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = samples[start + i] || 0;
      e += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    rms[fi] = Math.sqrt(e / frameSize);
    times[fi] = (start + frameSize / 2) / sampleRate;
    fft.transform(re, im);

    let fullFlux = 0;
    const be = { sub: 0, kick: 0, lowmid: 0, snare: 0, presence: 0, hat: 0 };
    let cNum = 0;
    let cDen = 0;
    let logSum = 0;
    let linSum = 0;
    let flatCount = 0;
    const chromaFloorBins = [];
    for (let k = 1; k < frameSize / 2; k++) {
      const m = Math.hypot(re[k], im[k]) / (frameSize / 4);
      mag[k] = m;
      const f = k * binHz;
      const diff = m - prevMag[k];
      if (diff > 0 && f > 40 && f < 16000) fullFlux += diff;
      if (f >= 25 && f < 16000) {
        const p = m * m;
        if (f < 70) be.sub += p;
        if (f < 160) be.kick += p;
        if (f >= 160 && f < 400) be.lowmid += p;
        if (f >= 400 && f < 2500) be.snare += p;
        if (f >= 2500 && f < 6000) be.presence += p;
        if (f >= 6000 && f < 14000) be.hat += p;
      }
      if (f > 80 && f < 12000) {
        cNum += f * m;
        cDen += m;
      }
      if (f >= 200 && f <= 8000) {
        logSum += Math.log(m + 1e-7);
        linSum += m;
        flatCount++;
      }
      if (f >= 200 && f <= 2000) chromaFloorBins.push(m);
    }
    centroid[fi] = cDen > 1e-9 ? cNum / cDen : 0;
    flatness[fi] = flatCount ? Math.exp(logSum / flatCount) / (linSum / flatCount + 1e-9) : 0;
    highRatio[fi] = (be.presence + be.hat) / (be.snare + be.lowmid + be.presence + be.hat + 1e-9);

    // 二次 chroma：减去本帧噪声底，强调谐波峰；噪声/镲片帧的贡献会显著降低
    if (chromaFloorBins.length) {
      const sorted = Float32Array.from(chromaFloorBins).sort();
      const floor = sorted[Math.floor(sorted.length * 0.55)] * 1.7;
      for (let k = 1; k < frameSize / 2; k++) {
        const pc = binToPc[k];
        if (pc < 0) continue;
        const m = Math.max(0, mag[k] - floor);
        if (m > 0) chroma[fi * 12 + pc] += Math.sqrt(m) * 1.4;
      }
    }
    for (const key of Object.keys(be)) bands[key][fi] = be[key];
    fluxFull[fi] = fullFlux;
    for (let k = 1; k < frameSize / 2; k++) prevMag[k] = mag[k];
  }

  // 归一化 chroma
  for (let fi = 0; fi < nFrames; fi++) {
    let sum = 0;
    for (let pc = 0; pc < 12; pc++) sum += chroma[fi * 12 + pc];
    if (sum > 1e-9) for (let pc = 0; pc < 12; pc++) chroma[fi * 12 + pc] /= sum;
  }

  return { fps, hop, frameSize, times, rms, fluxFull, bands, chroma, nFrames, centroid, flatness, highRatio };
}

/** 自适应峰值检测 */
export function detectOnsets(env, fps, opts = {}) {
  const {
    minSep = 0.08,
    threshold = 0.8,
    window = 0.55,
    minValue = 0.02,
  } = opts;
  const n = env.length;
  if (!n) return [];
  const w = Math.max(3, Math.round(window * fps));
  const peaks = [];
  const gate = new Float32Array(n);
  const scratch = new Float32Array(w);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(n, i + w);
    let m = 0;
    for (let j = a; j < b; j++) {
      scratch[m++] = env[j];
    }
    const arr = scratch.subarray(0, m);
    const med = median(arr);
    let mad = 0;
    for (let j = 0; j < m; j++) mad += Math.abs(arr[j] - med);
    mad /= Math.max(1, m);
    gate[i] = med + threshold * mad + minValue;
  }
  let last = -1e9;
  for (let i = 2; i < n - 2; i++) {
    if (env[i] < gate[i]) continue;
    if (env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
    const t = i / fps;
    if (t - last < minSep) {
      if (peaks.length && env[i] > peaks[peaks.length - 1].strength) {
        peaks[peaks.length - 1] = { time: t, strength: env[i], index: i };
        last = t;
      }
      continue;
    }
    peaks.push({ time: t, strength: env[i], index: i });
    last = t;
  }
  return peaks;
}

export function normalizeEnvelope(env) {
  let max = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > max) max = env[i];
  if (max <= 0) return env;
  const out = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) out[i] = env[i] / max;
  return out;
}

export function movingAverage(env, radius = 1) {
  const n = env.length;
  const out = new Float32Array(n);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n + radius; i++) {
    if (i < n) {
      sum += env[i];
      count++;
    }
    if (i - 2 * radius - 1 >= 0) {
      sum -= env[i - 2 * radius - 1];
      count--;
    }
    const center = i - radius;
    if (center >= 0 && center < n) out[center] = sum / Math.max(1, count);
  }
  return out;
}
