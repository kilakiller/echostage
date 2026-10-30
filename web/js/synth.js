/**
 * EchoStage · 原创示例曲合成器
 * 一首 32 秒、120 BPM、A 小调的器乐小品，用于离线演示与算法回归测试。
 * 纯 JS 生成 PCM，不依赖 Web Audio，因此 Node 与浏览器得到完全一致的结果。
 */

import { midiToFreq, clamp } from './dsp.js';

export const DEMO_BPM = 120;
export const DEMO_BEAT = 60 / DEMO_BPM;
export const DEMO_BAR = DEMO_BEAT * 4;
export const DEMO_BARS = 16;
export const DEMO_DURATION = DEMO_BAR * DEMO_BARS;

const CHORDS = [
  { name: 'Am', root: 57, bass: 33, pad: [57, 60, 64, 69], power: [45, 52, 57], melody: [69, 72, 71, 76] },
  { name: 'F', root: 53, bass: 29, pad: [53, 57, 60, 65], power: [41, 48, 53], melody: [69, 72, 77, 76] },
  { name: 'C', root: 48, bass: 36, pad: [52, 55, 60, 64], power: [48, 55, 60], melody: [76, 79, 76, 72] },
  { name: 'G', root: 55, bass: 31, pad: [55, 59, 62, 67], power: [43, 50, 55], melody: [74, 71, 67, 69] },
];

export const DEMO_SECTIONS = [
  { start: 0, end: 8, name: 'INTRO', cn: '拆解' },
  { start: 8, end: 16, name: 'VERSE', cn: '声部' },
  { start: 16, end: 24, name: 'CHORUS', cn: '复制' },
  { start: 24, end: 32, name: 'OUTRO', cn: '回声' },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const polyBlep = (t, dt) => {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
};

class Bus {
  constructor(sampleRate, seconds) {
    this.sr = sampleRate;
    this.n = Math.ceil(seconds * sampleRate);
    this.left = new Float32Array(this.n);
    this.right = new Float32Array(this.n);
    this.revL = new Float32Array(this.n);
    this.revR = new Float32Array(this.n);
    this.dlyL = new Float32Array(this.n);
    this.dlyR = new Float32Array(this.n);
  }

  write(i, value, pan = 0, rev = 0, dly = 0) {
    if (i < 0 || i >= this.n) return;
    const p = clamp(pan, -1, 1);
    const a = ((p + 1) * Math.PI) / 4;
    const gl = Math.cos(a);
    const gr = Math.sin(a);
    this.left[i] += value * gl;
    this.right[i] += value * gr;
    if (rev) {
      this.revL[i] += value * gl * rev;
      this.revR[i] += value * gr * rev;
    }
    if (dly) {
      this.dlyL[i] += value * gl * dly;
      this.dlyR[i] += value * gr * dly;
    }
  }
}

function addTone(bus, opts) {
  const {
    t, dur, midi, type = 'saw', gain = 0.15, pan = 0, attack = 0.008, decay = 0.12,
    sustain = 0.65, release = 0.12, cutoff = 1800, cutoffEnd = 900, q = 0.8,
    vibrato = 0, vibratoRate = 5.2, detune = 0, drive = 0, rev = 0.12, dly = 0,
    octave = 0, sub = 0,
  } = opts;
  const sr = bus.sr;
  const f0 = midiToFreq(midi + octave + detune);
  const total = Math.max(0.02, dur + release);
  const n = Math.floor(total * sr);
  const start = Math.floor(t * sr);
  let phase = 0;
  let phase2 = 0.37;
  let lp = 0;
  let lp2 = 0;
  const f2 = f0 * 1.005;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    let env;
    if (tt < attack) env = tt / attack;
    else if (tt < attack + decay) env = 1 - (1 - sustain) * ((tt - attack) / decay);
    else if (tt < dur) env = sustain;
    else env = sustain * Math.max(0, 1 - (tt - dur) / release);
    if (env <= 0) continue;
    const vib = vibrato ? Math.sin(2 * Math.PI * vibratoRate * tt) * vibrato : 0;
    const f = f0 * Math.pow(2, vib / 12);
    const dt = f / sr;
    phase += dt;
    if (phase >= 1) phase -= 1;
    phase2 += f2 / sr;
    if (phase2 >= 1) phase2 -= 1;
    let s;
    if (type === 'sine') s = Math.sin(phase * Math.PI * 2);
    else if (type === 'triangle') s = 1 - 4 * Math.abs(phase - 0.5);
    else if (type === 'square') s = (phase < 0.5 ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1, dt);
    else s = 2 * phase - 1 - polyBlep(phase, dt);
    if (sub) {
      let p = phase * 0.5;
      s = s * (1 - sub) + Math.sin(p * Math.PI * 2) * sub;
    }
    const cut = cutoff + (cutoffEnd - cutoff) * Math.min(1, tt / 0.25);
    const a = 1 - Math.exp((-2 * Math.PI * cut) / sr);
    lp += a * (s - lp);
    let v = lp;
    if (drive > 0) v = Math.tanh(v * (1 + drive * 6)) / Math.tanh(1 + drive * 6);
    v *= gain * env;
    bus.write(start + i, v, pan, rev, dly);
  }
}

function addNoise(bus, opts) {
  const {
    t, dur, gain = 0.2, pan = 0, hp = 4000, decay = 12, rev = 0.1, metallic = 0,
    band = 0, rng = Math.random,
  } = opts;
  const sr = bus.sr;
  const n = Math.floor(dur * sr);
  const start = Math.floor(t * sr);
  let prevX = 0;
  let prevY = 0;
  const a = 1 - Math.exp((-2 * Math.PI * hp) / sr);
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const env = Math.exp(-tt * decay);
    if (env < 1e-4) break;
    const white = rng() * 2 - 1;
    let x = white;
    if (band > 0) {
      const aa = 1 - Math.exp((-2 * Math.PI * band) / sr);
      prevX += aa * (white - prevX);
      x = white - prevX;
    }
    prevY += a * (x - prevY);
    let v = prevY * env;
    if (metallic) {
      v += Math.sin(2 * Math.PI * 6700 * tt) * env * metallic * 0.3;
      v += Math.sin(2 * Math.PI * 9100 * tt) * env * metallic * 0.2;
    }
    bus.write(start + i, v * gain, pan, rev, 0);
  }
}

function addKick(bus, t, vel, rng) {
  const sr = bus.sr;
  const n = Math.floor(0.5 * sr);
  const start = Math.floor(t * sr);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const f = 48 + 120 * Math.exp(-tt * 38);
    phase += f / sr;
    const env = Math.exp(-tt * 7.5);
    let v = Math.sin(phase * Math.PI * 2) * env * 0.85;
    if (tt < 0.012) v += (rng() * 2 - 1) * 0.18 * (1 - tt / 0.012);
    bus.write(start + i, v * vel, 0, 0.05, 0);
  }
}

function addSnare(bus, t, vel, rng) {
  const sr = bus.sr;
  const n = Math.floor(0.3 * sr);
  const start = Math.floor(t * sr);
  let phase = 0;
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const env = Math.exp(-tt * 19);
    phase += 185 / sr;
    const noise = rng() * 2 - 1;
    hp = 0.86 * (hp + noise - prev);
    prev = noise;
    let v = hp * 0.55 + Math.sin(phase * Math.PI * 2) * 0.3;
    v *= env * vel;
    bus.write(start + i, v, 0, 0.22, 0);
    if (tt > 0.12) break;
  }
}

function addHat(bus, t, vel, open, rng) {
  const sr = bus.sr;
  const dur = open ? 0.42 : 0.075;
  const decay = open ? 7 : 55;
  const n = Math.floor(dur * sr);
  const start = Math.floor(t * sr);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const env = Math.exp(-tt * decay);
    const white = rng() * 2 - 1;
    hp = 0.72 * (hp + white - prev);
    prev = white;
    bus.write(start + i, hp * env * 0.26 * vel, 0.18, 0.06, 0);
  }
}

function addCymbal(bus, t, vel, rng, pan = 0.2) {
  const sr = bus.sr;
  const n = Math.floor(2.0 * sr);
  const start = Math.floor(t * sr);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const env = Math.exp(-tt * 2.1);
    const white = rng() * 2 - 1;
    hp = 0.9 * (hp + white - prev);
    prev = white;
    const shimmer = Math.sin(2 * Math.PI * 5230 * tt) * 0.06 + Math.sin(2 * Math.PI * 7870 * tt) * 0.04;
    bus.write(start + i, (hp * 0.24 + shimmer) * env * vel, pan, 0.4, 0);
  }
}

function addTom(bus, t, midi, vel, rng) {
  const sr = bus.sr;
  const n = Math.floor(0.35 * sr);
  const start = Math.floor(t * sr);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const f = midiToFreq(midi) * (1 + 0.28 * Math.exp(-tt * 24));
    phase += f / sr;
    const env = Math.exp(-tt * 11);
    let v = Math.sin(phase * Math.PI * 2) * env * 0.55 + (rng() * 2 - 1) * env * 0.08;
    bus.write(start + i, v * vel, -0.1, 0.12, 0);
  }
}

function applyReverb(bus) {
  const sr = bus.sr;
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((s) => Math.floor(s * sr));
  const outL = new Float32Array(bus.n);
  const outR = new Float32Array(bus.n);
  const damp = 0.28;
  for (let c = 0; c < combs.length; c++) {
    const delay = combs[c];
    const bufL = new Float32Array(delay);
    const bufR = new Float32Array(Math.max(1, delay + 17));
    let idxL = 0;
    let idxR = 0;
    let lpL = 0;
    let lpR = 0;
    for (let i = 0; i < bus.n; i++) {
      const yL = bufL[idxL];
      const yR = bufR[idxR];
      lpL = yL * (1 - damp) + lpL * damp;
      lpR = yR * (1 - damp) + lpR * damp;
      bufL[idxL] = bus.revL[i] + lpL * 0.78;
      bufR[idxR] = bus.revR[i] + lpR * 0.78;
      idxL = (idxL + 1) % bufL.length;
      idxR = (idxR + 1) % bufR.length;
      outL[i] += yL;
      outR[i] += yR;
    }
  }
  const allpass = (input, delaySamples, g) => {
    const out = new Float32Array(input.length);
    const buf = new Float32Array(Math.max(1, delaySamples));
    let idx = 0;
    for (let i = 0; i < input.length; i++) {
      const bufOut = buf[idx];
      const y = -g * input[i] + bufOut;
      buf[idx] = input[i] + g * y;
      idx = (idx + 1) % buf.length;
      out[i] = y;
    }
    return out;
  };
  const revL = allpass(allpass(outL, Math.floor(0.0051 * sr), 0.5), Math.floor(0.0017 * sr), 0.5);
  const revR = allpass(allpass(outR, Math.floor(0.0057 * sr), 0.5), Math.floor(0.0019 * sr), 0.5);
  for (let i = 0; i < bus.n; i++) {
    bus.left[i] += revL[i] * 0.55;
    bus.right[i] += revR[i] * 0.55;
  }
}

function applyDelay(bus, seconds) {
  const sr = bus.sr;
  const delay = Math.floor(seconds * sr);
  const bufL = new Float32Array(delay);
  const bufR = new Float32Array(delay);
  let idx = 0;
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < bus.n; i++) {
    const yL = bufL[idx];
    const yR = bufR[idx];
    lpL = yL * 0.72 + lpL * 0.28;
    lpR = yR * 0.72 + lpR * 0.28;
    bufL[idx] = bus.dlyL[i] + lpR * 0.36;
    bufR[idx] = bus.dlyR[i] + lpL * 0.36;
    idx = (idx + 1) % delay;
    bus.left[i] += yL * 0.55;
    bus.right[i] += yR * 0.55;
  }
}

function addChord(bus, t, dur, midis, opts = {}) {
  for (const midi of midis) {
    addTone(bus, {
      t, dur, midi, type: 'saw', gain: opts.gain ?? 0.055, pan: opts.pan ?? 0,
      attack: opts.attack ?? 0.012, decay: 0.18, sustain: 0.55, release: 0.18,
      cutoff: opts.cutoff ?? 2100, cutoffEnd: opts.cutoffEnd ?? 900,
      drive: opts.drive ?? 0, rev: opts.rev ?? 0.18,
      vibrato: opts.vibrato ?? 0, detune: (Math.random() - 0.5) * 0.02,
    });
  }
}

/**
 * 生成示例曲。
 * @returns {{left:Float32Array,right:Float32Array,sampleRate:number,duration:number,events:object,meta:object}}
 */
export function renderDemoSong(sampleRate = 44100) {
  const total = DEMO_DURATION + 2.2;
  const bus = new Bus(sampleRate, total);
  const rng = mulberry32(20250522);
  const events = { drums: [], bass: [], keys: [], guitar: [], lead: [] };

  const chordAt = (bar) => CHORDS[bar % 4];
  const sectionOf = (bar) => Math.floor(bar / 4);
  const beatTime = (bar, beat) => bar * DEMO_BAR + beat * DEMO_BEAT;

  // 鼓组
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const sec = sectionOf(bar);
    const lastBar = bar % 4 === 3;
    const b0 = bar * DEMO_BAR;
    const pushDrum = (beat, drum, midi, vel) => {
      const t = b0 + beat * DEMO_BEAT;
      events.drums.push({ t, dur: 0.12, midi, velocity: vel, drum });
    };

    if (sec === 0) {
      if (bar === 0) {
        addKick(bus, b0, 0.65, rng);
        pushDrum(0, 'kick', 36, 0.65);
        addCymbal(bus, b0, 0.35, rng, -0.15);
        pushDrum(0, 'crash', 49, 0.35);
      }
      for (let e = 0; e < 8; e++) {
        addHat(bus, b0 + e * 0.25, e % 2 ? 0.16 : 0.22, false, rng);
        pushDrum(e * 0.5, 'hat', 42, e % 2 ? 0.3 : 0.38);
      }
      if (bar >= 2) {
        addKick(bus, b0 + 1.0, 0.5, rng);
        pushDrum(2, 'kick', 36, 0.5);
      }
      if (bar === 3) {
        addSnare(bus, b0 + 2 * DEMO_BEAT, 0.4, rng);
        pushDrum(2, 'snare', 38, 0.4);
      }
      continue;
    }

    if (sec === 1) {
      const kicks = [0, 1.5, 2.5];
      for (const beat of kicks) {
        addKick(bus, b0 + beat * DEMO_BEAT, beat === 0 ? 0.8 : 0.62, rng);
        pushDrum(beat, 'kick', 36, beat === 0 ? 0.8 : 0.62);
      }
      for (const beat of [1, 3]) {
        addSnare(bus, b0 + beat * DEMO_BEAT, 0.62, rng);
        pushDrum(beat, 'snare', 38, 0.62);
      }
      for (let e = 0; e < 8; e++) {
        const beat = e * 0.5;
        addHat(bus, b0 + beat * DEMO_BEAT, e % 2 ? 0.2 : 0.3, false, rng);
        pushDrum(beat, 'hat', 42, e % 2 ? 0.32 : 0.45);
      }
      if (lastBar) {
        addHat(bus, b0 + 3.5 * DEMO_BEAT, 0.4, true, rng);
        pushDrum(3.5, 'openhat', 46, 0.55);
        const fill = [45, 47, 50, 45];
        fill.forEach((midi, i) => {
          addTom(bus, b0 + (3 + i * 0.25) * DEMO_BEAT, midi, 0.55, rng);
          pushDrum(3 + i * 0.25, 'tom', midi, 0.55);
        });
      }
      continue;
    }

    if (sec === 2) {
      for (const beat of [0, 1, 2, 3]) {
        addKick(bus, b0 + beat * DEMO_BEAT, 0.85, rng);
        pushDrum(beat, 'kick', 36, 0.85);
      }
      for (const beat of [1, 3]) {
        addSnare(bus, b0 + beat * DEMO_BEAT, 0.78, rng);
        pushDrum(beat, 'snare', 38, 0.78);
      }
      addSnare(bus, b0 + 2.75 * DEMO_BEAT, 0.22, rng);
      pushDrum(2.75, 'snare', 38, 0.22);
      for (const beat of [0.5, 1.5, 2.5, 3.5]) {
        addHat(bus, b0 + beat * DEMO_BEAT, 0.34, beat === 3.5, rng);
        pushDrum(beat, beat === 3.5 ? 'openhat' : 'hat', beat === 3.5 ? 46 : 42, 0.5);
      }
      if (bar === 8 || bar === 10) {
        addCymbal(bus, b0, 0.5, rng, bar === 8 ? -0.2 : 0.25);
        pushDrum(0, 'crash', 49, 0.5);
      }
      if (lastBar) {
        addTom(bus, b0 + 3.0 * DEMO_BEAT, 47, 0.45, rng);
        addTom(bus, b0 + 3.25 * DEMO_BEAT, 50, 0.55, rng);
        addTom(bus, b0 + 3.5 * DEMO_BEAT, 45, 0.65, rng);
        addTom(bus, b0 + 3.75 * DEMO_BEAT, 47, 0.75, rng);
        pushDrum(3, 'tom', 47, 0.45);
        pushDrum(3.25, 'tom', 50, 0.55);
        pushDrum(3.5, 'tom', 45, 0.65);
        pushDrum(3.75, 'tom', 47, 0.75);
      }
      continue;
    }

    // outro
    if (bar === 12) {
      addKick(bus, b0, 0.8, rng);
      pushDrum(0, 'kick', 36, 0.8);
      addCymbal(bus, b0, 0.55, rng, 0.1);
      pushDrum(0, 'crash', 49, 0.55);
      addSnare(bus, b0 + 2 * DEMO_BEAT, 0.5, rng);
      pushDrum(2, 'snare', 38, 0.5);
    } else if (bar === 13) {
      addKick(bus, b0 + 2.5 * DEMO_BEAT, 0.55, rng);
      pushDrum(2.5, 'kick', 36, 0.55);
      addSnare(bus, b0 + 2 * DEMO_BEAT, 0.45, rng);
      pushDrum(2, 'snare', 38, 0.45);
    } else if (bar === 15) {
      addKick(bus, b0, 0.75, rng);
      addCymbal(bus, b0, 0.6, rng, 0);
      pushDrum(0, 'kick', 36, 0.75);
      pushDrum(0, 'crash', 49, 0.6);
    }
    for (let e = 0; e < 8; e++) {
      addHat(bus, b0 + e * 0.25, 0.14, false, rng);
      pushDrum(e * 0.5, 'hat', 42, 0.25);
    }
  }

  // 贝斯
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const chord = chordAt(bar);
    const b0 = bar * DEMO_BAR;
    const sec = sectionOf(bar);
    if (sec === 0) {
      if (bar < 2) continue;
      const notes = [chord.bass, chord.bass + 12];
      notes.forEach((midi, i) => {
        const t = b0 + i * 2 * DEMO_BEAT;
        addTone(bus, { t, dur: 0.85, midi, type: 'saw', gain: 0.17, attack: 0.01, sustain: 0.7, release: 0.08, cutoff: 480, cutoffEnd: 220, sub: 0.35, rev: 0.02 });
        events.bass.push({ t, dur: 0.85, midi, velocity: 0.55 });
      });
      continue;
    }
    if (sec === 3 && bar >= 13) {
      const t = b0;
      addTone(bus, { t, dur: 1.6, midi: chord.bass, type: 'saw', gain: 0.16, sustain: 0.6, cutoff: 420, cutoffEnd: 180, sub: 0.4, rev: 0.05 });
      events.bass.push({ t, dur: 1.6, midi: chord.bass, velocity: 0.5 });
      continue;
    }
    const pattern = sec === 2
      ? [chord.bass, chord.bass, chord.bass + 12, chord.bass, chord.bass + 7, chord.bass, chord.bass + 12, chord.bass + 7]
      : [chord.bass, chord.bass, chord.bass + 12, chord.bass, chord.bass + 7, chord.bass, chord.bass + 12, chord.bass + 7];
    pattern.forEach((midi, i) => {
      const t = b0 + i * 0.5 * DEMO_BEAT;
      const vel = i === 0 ? 0.85 : i % 2 ? 0.66 : 0.74;
      const dur = i === 6 ? 0.3 : 0.22;
      addTone(bus, {
        t, dur, midi, type: 'saw', gain: 0.16 * vel, attack: 0.006, decay: 0.08,
        sustain: 0.75, release: 0.05, cutoff: sec === 2 ? 600 : 480, cutoffEnd: 220,
        sub: 0.38, rev: 0.015,
      });
      events.bass.push({ t, dur, midi, velocity: vel });
    });
  }

  // 键盘
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const chord = chordAt(bar);
    const b0 = bar * DEMO_BAR;
    const sec = sectionOf(bar);
    if (sec === 0) {
      const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
      pattern.forEach((idx, i) => {
        const t = b0 + i * 0.5 * DEMO_BEAT;
        const midi = chord.pad[idx] + 12;
        addTone(bus, { t, dur: 0.2, midi, type: 'triangle', gain: 0.055, attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.2, cutoff: 2600, rev: 0.32, pan: -0.15 });
        events.keys.push({ t, dur: 0.2, midi, velocity: i % 2 ? 0.34 : 0.46 });
      });
      continue;
    }
    if (sec === 3) {
      const t = b0;
      const dur = bar === 15 ? 2.4 : 1.8;
      for (const midi of chord.pad) {
        addTone(bus, { t, dur, midi, type: 'triangle', gain: 0.045, attack: 0.08, decay: 0.4, sustain: 0.5, release: 0.5, cutoff: 1800, rev: 0.4, pan: -0.2 });
        events.keys.push({ t, dur, midi, velocity: 0.35 });
      }
      continue;
    }
    for (const midi of chord.pad) {
      addTone(bus, { t: b0, dur: 1.4, midi, type: 'triangle', gain: 0.038, attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.2, cutoff: 2200, rev: 0.35, pan: -0.18 });
      events.keys.push({ t: b0, dur: 1.4, midi, velocity: 0.4 });
    }
    const arp = [0, 2, 1, 3, 2, 1, 3, 2];
    arp.forEach((idx, i) => {
      const t = b0 + i * 0.5 * DEMO_BEAT;
      const midi = chord.pad[idx] + 12;
      addTone(bus, { t, dur: 0.18, midi, type: 'triangle', gain: 0.032, attack: 0.004, decay: 0.08, sustain: 0.25, release: 0.16, cutoff: 3200, rev: 0.3, pan: -0.12 });
      events.keys.push({ t, dur: 0.18, midi, velocity: 0.28 });
    });
  }

  // 电吉他（副歌失真强力和弦）
  for (let bar = 8; bar < 16; bar++) {
    const chord = chordAt(bar);
    const b0 = bar * DEMO_BAR;
    if (bar === 12) {
      chord.power.forEach((midi) => {
        addTone(bus, { t: b0, dur: 1.8, midi, type: 'saw', gain: 0.045, attack: 0.006, sustain: 0.6, release: 0.3, cutoff: 3000, cutoffEnd: 700, drive: 0.75, rev: 0.25, pan: 0.28 });
        events.guitar.push({ t: b0, dur: 1.8, midi, velocity: 0.55, fx: 'distortion' });
      });
      continue;
    }
    if (bar > 13) continue;
    const hits = [
      { beat: 0, dur: 0.22, vel: 0.85 },
      { beat: 1.5, dur: 0.16, vel: 0.7 },
      { beat: 2.5, dur: 0.16, vel: 0.72 },
      { beat: 3.5, dur: 0.14, vel: 0.66 },
    ];
    for (const hit of hits) {
      for (const midi of chord.power) {
        addTone(bus, {
          t: b0 + hit.beat * DEMO_BEAT, dur: hit.dur, midi, type: 'saw', gain: 0.042,
          attack: 0.003, decay: 0.12, sustain: 0.2, release: 0.08, cutoff: 2600,
          cutoffEnd: 500, drive: 0.85, rev: 0.12, pan: 0.3,
        });
        events.guitar.push({ t: b0 + hit.beat * DEMO_BEAT, dur: hit.dur, midi, velocity: hit.vel, fx: 'distortion' });
      }
    }
  }

  // 主旋律
  const leadAdd = (t, dur, midi, vel, vib = 0) => {
    addTone(bus, {
      t, dur, midi, type: 'square', gain: 0.075, attack: 0.012, decay: 0.15,
      sustain: 0.62, release: 0.18, cutoff: 3600, cutoffEnd: 1200, vibrato: vib,
      vibratoRate: 5.4, rev: 0.22, dly: 0.22, pan: 0.1,
    });
    events.lead.push({ t, dur, midi, velocity: vel, fx: vib ? 'vibrato' : '' });
  };
  const motif = [69, 72, 71, 76];
  motif.forEach((midi, i) => leadAdd(3 * DEMO_BAR + i * 0.5, i === 3 ? 0.8 : 0.32, midi, 0.55, i === 3 ? 0.25 : 0));
  const chorusMelody = [
    [[69, 0, 0.4], [72, 0.5, 0.35], [71, 1.0, 0.35], [76, 1.5, 0.85], [74, 2.5, 0.35], [72, 3.0, 0.35], [71, 3.5, 0.35]],
    [[69, 0, 0.45], [72, 0.5, 0.35], [77, 1.0, 0.75], [76, 2.0, 0.45], [72, 2.5, 0.35], [69, 3.0, 0.35], [67, 3.5, 0.3]],
    [[76, 0, 0.45], [79, 0.5, 0.35], [76, 1.0, 0.45], [72, 1.5, 0.75], [74, 2.5, 0.35], [76, 3.0, 0.35], [79, 3.5, 0.4]],
    [[74, 0, 0.45], [71, 0.5, 0.35], [67, 1.0, 0.6], [69, 2.0, 1.6]],
  ];
  chorusMelody.forEach((barNotes, bi) => {
    for (const [midi, beat, dur] of barNotes) {
      leadAdd(8 * DEMO_BAR + bi * DEMO_BAR + beat * DEMO_BEAT, dur, midi, 0.6, dur > 0.7 ? 0.3 : 0);
    }
  });
  [69, 72, 76].forEach((midi, i) => {
    leadAdd(12 * DEMO_BAR + i * 2 * DEMO_BEAT, 1.5, midi, 0.4, 0.4);
  });

  applyReverb(bus);
  applyDelay(bus, 0.375);

  // 软削波 + 归一化
  let peak = 0;
  for (let i = 0; i < bus.n; i++) {
    const l = Math.tanh(bus.left[i] * 1.15);
    const r = Math.tanh(bus.right[i] * 1.15);
    bus.left[i] = l;
    bus.right[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const g = peak > 1e-6 ? 0.88 / peak : 1;
  const startFade = Math.floor((DEMO_DURATION - 0.02) * sampleRate);
  for (let i = 0; i < bus.n; i++) {
    let fade = 1;
    if (i > startFade) fade = Math.max(0, 1 - (i - startFade) / (sampleRate * 1.5));
    bus.left[i] *= g * fade;
    bus.right[i] *= g * fade;
  }

  for (const key of Object.keys(events)) {
    events[key].sort((a, b) => a.t - b.t);
  }

  return {
    left: bus.left,
    right: bus.right,
    sampleRate,
    duration: DEMO_DURATION,
    events,
    meta: {
      title: '复制之夜 · Copy Night',
      artist: 'EchoStage Studio',
      bpm: DEMO_BPM,
      key: 'A minor',
      sections: DEMO_SECTIONS,
      chords: Array.from({ length: DEMO_BARS }, (_, bar) => ({ t: bar * DEMO_BAR, dur: DEMO_BAR, name: CHORDS[bar % 4].name })),
      source: '内置原创示例',
    },
  };
}
