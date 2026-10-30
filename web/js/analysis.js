/**
 * EchoStage · 浏览器端音乐解构器
 * 输入单声道 PCM，输出 PerformanceScore：
 *   节拍/段落 → 鼓点 → 贝斯/主旋律音高 → 和弦 → 吉他/键盘编曲推断 → 演奏效果
 *
 * 说明：这是一个可离线运行的“轻量分析器”，用于演示与快速预览。
 * 生产环境请使用 pipeline/ 下的 Demucs + YourMT3 + ADTOF 多模型方案。
 */

import {
  clamp, normalizeEnvelope, movingAverage, median, biquad, downsample,
  computeSpectralFeatures, detectOnsets, trackPitch, framesToNotes, rmsAt,
  noteName, pitchClassName,
} from './dsp.js';

const TRACK_COLORS = {
  drums: '#ff6b4a',
  bass: '#4d7cff',
  guitar: '#ff4f8b',
  keys: '#79f2c0',
  lead: '#ffd166',
};

const TRACK_LABELS = {
  drums: '鼓组',
  bass: '贝斯',
  guitar: '电吉他',
  keys: '键盘',
  lead: '主旋律',
};

const SECTION_TEXT = {
  INTRO: '拆解',
  VERSE: '声部',
  CHORUS: '复制',
  BREAK: '故障',
  OUTRO: '回声',
};

/* ------------------------------------------------------------------ */
/* 节拍                                                                */
/* ------------------------------------------------------------------ */

function estimateTempo(features) {
  const fps = features.fps;
  const env = normalizeEnvelope(movingAverage(features.fluxFull, 1));
  const n = env.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += env[i] * env[i];
  if (energy < 1e-6) return { bpm: 120, beats: [], confidence: 0 };

  const minLag = Math.max(2, Math.floor((60 / 190) * fps));
  const maxLag = Math.min(Math.floor((60 / 55) * fps), Math.floor(n * 0.6));
  const acf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    let count = 0;
    for (let i = 0; i + lag < n; i++) {
      s += env[i] * env[i + lag];
      count++;
    }
    acf[lag] = count ? s / count : 0;
  }
  let bestLag = Math.round(fps * 0.5);
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = acf[lag];
    if (lag * 2 <= maxLag) score += acf[lag * 2] * 0.5;
    if (lag * 3 <= maxLag) score += acf[lag * 3] * 0.22;
    if (lag > 1) score += (acf[lag - 1] + acf[lag + 1]) * 0.15;
    const bpm = (60 * fps) / lag;
    // 人耳常用速度区间加权，避免把 8 分音符当成拍
    let prior = 1;
    if (bpm < 65) prior = 0.55;
    else if (bpm > 175) prior = 0.7;
    else prior = 0.85 + 0.15 * Math.exp(-Math.pow(Math.log2(bpm / 118), 2) / 0.6);
    score *= prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // 相位：让拍点尽量落在 onset 上
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  const phaseSteps = Math.max(1, Math.round(bestLag));
  for (let p = 0; p < phaseSteps; p++) {
    let s = 0;
    for (let k = 0; ; k++) {
      const idx = Math.round(p + k * bestLag);
      if (idx >= n) break;
      s += env[idx] + 0.5 * (env[idx - 1] || 0) + 0.3 * (env[idx + 1] || 0);
    }
    if (s > bestPhaseScore) {
      bestPhaseScore = s;
      bestPhase = p;
    }
  }

  const duration = n / fps;
  const beats = [];
  for (let k = 0; ; k++) {
    const t = (bestPhase + k * bestLag) / fps;
    if (t > duration + 0.05) break;
    // 局部微调，但保持拍距稳定
    const center = Math.round(t * fps);
    let bestIdx = center;
    let bestVal = -1;
    const radius = Math.max(1, Math.round(bestLag * 0.12));
    for (let j = center - radius; j <= center + radius; j++) {
      if (j < 0 || j >= n) continue;
      if (env[j] > bestVal) {
        bestVal = env[j];
        bestIdx = j;
      }
    }
    beats.push({ time: bestIdx / fps, strength: bestVal });
  }

  const bpm = (60 * fps) / bestLag;
  return { bpm, beats, confidence: clamp(bestScore / (acf[bestLag] + 1e-9), 0, 1.5) };
}

/** 根据底鼓位置判断反拍/小节起点 */
function alignDownbeat(beats, drums) {
  if (beats.length < 4) return beats;
  let best = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < 4; phase++) {
    let score = 0;
    for (let i = phase; i < beats.length; i += 4) {
      const t = beats[i].time;
      for (const d of drums) {
        if (Math.abs(d.t - t) < 0.09) {
          if (d.drum === 'kick') score += 1 + d.velocity;
          if (d.drum === 'crash') score += 1.5;
          if (d.drum === 'snare') score -= 0.5;
        }
      }
      score += beats[i].strength * 0.2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = phase;
    }
  }
  return beats.slice(best);
}

/* ------------------------------------------------------------------ */
/* 鼓组                                                                */
/* ------------------------------------------------------------------ */

function detectDrums(features, beats) {
  const fps = features.fps;
  const kickEnv = normalizeEnvelope(movingAverage(features.bands.kick, 0));
  const snareRaw = new Float32Array(features.nFrames);
  const hatEnv = normalizeEnvelope(movingAverage(features.bands.hat, 0));
  for (let i = 0; i < features.nFrames; i++) {
    snareRaw[i] = features.bands.snare[i] + features.bands.presence[i] * 0.45;
  }
  const snareEnv = normalizeEnvelope(movingAverage(snareRaw, 1));

  const kickPeaks = detectOnsets(kickEnv, fps, { minSep: 0.12, threshold: 0.8, window: 0.5, minValue: 0.04 });
  const snarePeaks = detectOnsets(snareEnv, fps, { minSep: 0.11, threshold: 1.0, window: 0.45, minValue: 0.05 });
  const hatPeaks = detectOnsets(hatEnv, fps, { minSep: 0.06, threshold: 0.85, window: 0.35, minValue: 0.03 });

  const maxKick = kickPeaks.reduce((m, p) => Math.max(m, p.strength), 1e-9);
  const maxSnare = snarePeaks.reduce((m, p) => Math.max(m, p.strength), 1e-9);
  const maxHat = hatPeaks.reduce((m, p) => Math.max(m, p.strength), 1e-9);
  const notes = [];

  for (const p of kickPeaks) {
    const i = p.index;
    const snare = features.bands.snare[i];
    const presence = features.bands.presence[i];
    const hat = features.bands.hat[i];
    const kick = features.bands.kick[i];
    const lowDom = kick / (snare + presence + hat + 1e-9);
    const cen = features.centroid[i];
    const flat = features.flatness[i];
    const isKick = lowDom > 15 || (cen < 2600 && flat > 0.2 && lowDom > 1.2) || (lowDom > 6 && flat > 0.55);
    if (!isKick) continue;
    notes.push({
      t: +p.time.toFixed(3), dur: 0.12, midi: 36, drum: 'kick',
      velocity: clamp(0.35 + 0.6 * (p.strength / maxKick), 0.25, 1),
    });
  }
  for (const p of snarePeaks) {
    const i = p.index;
    const snare = features.bands.snare[i];
    const hat = features.bands.hat[i];
    const kick = features.bands.kick[i];
    if (kick > (snare + hat) * 2) continue;
    if (features.rms[i] < 0.07) continue;
    if (features.flatness[i] < 0.62 || features.centroid[i] < 2800) continue;
    notes.push({
      t: +p.time.toFixed(3), dur: 0.12, midi: 38, drum: 'snare',
      velocity: clamp(0.35 + 0.6 * (p.strength / maxSnare), 0.22, 1),
    });
  }
  for (const p of hatPeaks) {
    const i = p.index;
    if (features.centroid[i] < 3000) continue;
    if (features.flatness[i] < 0.35) continue;
    notes.push({
      t: +p.time.toFixed(3), dur: 0.06, midi: 42, drum: 'hat',
      velocity: clamp(0.25 + 0.65 * (p.strength / maxHat), 0.18, 1),
    });
  }

  const filtered = notes.filter((n) => {
    if (n.drum !== 'snare') return true;
    const kick = notes.find((k) => k.drum === 'kick' && Math.abs(k.t - n.t) < 0.04);
    if (!kick) return true;
    return n.velocity > kick.velocity * 0.7;
  });

  filtered.sort((a, b) => a.t - b.t);
  return filtered;
}

/* ------------------------------------------------------------------ */
/* 音高                                                                */
/* ------------------------------------------------------------------ */

function pitchNotes(mono, sampleRate, opts) {
  const { lowpass, highpass, fmin, fmax, minMidi, maxMidi, minDur, minVel, harmonicityFilter } = opts;
  let sig = biquad(mono, 'highpass', highpass, 0.707, sampleRate);
  if (lowpass) sig = biquad(sig, 'lowpass', lowpass, 0.707, sampleRate);
  const ds = downsample(sig, 4);
  const sr = sampleRate / 4;
  const frames = trackPitch(ds, sr, {
    fmin, fmax, frameSize: 1024, hop: Math.max(2, Math.round(sr * 0.04)),
    threshold: 0.16, rmsFloor: 0.006, minConfidence: 0.55,
  });
  const notes = framesToNotes(frames, {
    minDuration: minDur, maxGap: 0.09, pitchTolerance: 0.8,
    minMidi, maxMidi, hop: 0.04, minConfidence: 0.58,
  }).filter((n) => n.velocity >= minVel);

  const kept = [];
  for (const n of notes) {
    if (harmonicityFilter) {
      const h = harmonicityAt(mono, sampleRate, n.t + Math.min(0.07, n.dur * 0.4), 440 * Math.pow(2, (n.midi - 69) / 12));
      // 底鼓/超低频冲击缺少 2、3、4 次谐波，容易伪装成低音
      if (h < 0.11 && n.dur < 0.55) continue;
    }
    // 音高轨迹里提取颤音
    const inNote = frames.filter((f) => f.time >= n.t && f.time <= n.t + n.dur && Number.isFinite(f.midi));
    let fx = null;
    if (inNote.length > 5 && n.dur > 0.4) {
      const mean = inNote.reduce((s, f) => s + f.midi, 0) / inNote.length;
      const dev = inNote.map((f) => f.midi - mean);
      const std = Math.sqrt(dev.reduce((s, v) => s + v * v, 0) / dev.length);
      if (std > 0.09) fx = { vibrato: { rate: 5.4, depth: +Math.min(0.6, std).toFixed(2) } };
    }
    kept.push({ ...n, fx });
  }
  return kept;
}

/** 目标频率的 2/3/4 次谐波能量占比（用一小段 DFT） */
function harmonicityAt(mono, sampleRate, t, f0) {
  const size = 2048;
  const start = Math.max(0, Math.round(t * sampleRate) - size / 2);
  const magAt = (f) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < size; i++) {
      const x = mono[start + i] || 0;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      const ph = (2 * Math.PI * f * i) / sampleRate;
      const v = x * w;
      re += v * Math.cos(ph);
      im -= v * Math.sin(ph);
    }
    return Math.hypot(re, im) / (size / 4);
  };
  const m1 = magAt(f0);
  if (m1 < 1e-5) return 0;
  const m2 = magAt(f0 * 2);
  const m3 = magAt(f0 * 3);
  const m4 = magAt(f0 * 4);
  return (m2 + m3 + m4) / (3 * m1);
}

/* ------------------------------------------------------------------ */
/* 和弦                                                                */
/* ------------------------------------------------------------------ */

const MAJOR = [0, 4, 7];
const MINOR = [0, 3, 7];
const QUALITY_INTERVALS = { maj: [0, 4, 7], min: [0, 3, 7], '5': [0, 7] };

function chordTemplates() {
  const list = [];
  for (let root = 0; root < 12; root++) {
    list.push({ root, quality: 'maj', intervals: MAJOR, name: pitchClassName(root) });
    list.push({ root, quality: 'min', intervals: MINOR, name: pitchClassName(root) + 'm' });
  }
  return list;
}

const TEMPLATES = chordTemplates();

function chromaAt(features, t0, t1) {
  const out = new Float32Array(12);
  const fps = features.fps;
  const i0 = Math.max(0, Math.floor(t0 * fps));
  const i1 = Math.min(features.nFrames - 1, Math.ceil(t1 * fps));
  let weightSum = 0;
  for (let i = i0; i <= i1; i++) {
    // 安静 / 噪声帧（镲片、掌声、嘶声）权重低；谐波清晰的帧权重高
    const w = Math.max(0, 1 - features.flatness[i]) ** 2 * clamp(features.rms[i] / 0.012, 0, 1.5);
    if (w <= 0.001) continue;
    for (let pc = 0; pc < 12; pc++) out[pc] += features.chroma[i * 12 + pc] * w;
    weightSum += w;
  }
  if (weightSum) for (let pc = 0; pc < 12; pc++) out[pc] /= weightSum;
  return out;
}

function scoreChord(chroma, template, bassPc) {
  let score = 0;
  let inEnergy = 0;
  let outEnergy = 0;
  for (let pc = 0; pc < 12; pc++) {
    const v = chroma[pc];
    const rel = (pc - template.root + 12) % 12;
    if (template.intervals.includes(rel)) {
      const w = rel === 0 ? 1.0 : rel === 7 ? 0.82 : 0.9;
      score += v * w;
      inEnergy += v;
    } else {
      outEnergy += v;
    }
  }
  score -= outEnergy * 0.42;
  if (bassPc >= 0) {
    if (((bassPc - template.root + 12) % 12) === 0) score += 0.28;
    else if (((bassPc - template.root + 12) % 12) === 7) score += 0.08;
  }
  score += inEnergy * 0.1;
  return score;
}

function detectHarmony(features, beats, bassNotes, duration) {
  const beatDur = beats.length > 2
    ? median(beats.slice(1).map((b, i) => b.time - beats[i].time))
    : 0.5;
  const step = Math.max(0.5, Math.min(2, beatDur)) * 2; // 半小节
  const windows = [];
  for (let t = 0; t < duration; t += step) {
    const t1 = Math.min(duration, t + step);
    if (t1 - t < 0.2) break;
    const chroma = chromaAt(features, t, t1);
    let bassPc = -1;
    for (const n of bassNotes) {
      if (n.t <= t + 0.15 && n.t + n.dur >= t - 0.05) {
        bassPc = ((n.midi % 12) + 12) % 12;
        break;
      }
    }
    windows.push({ t, dur: t1 - t, chroma, bassPc });
  }
  if (!windows.length) return [];

  const candidates = windows.map((w) => TEMPLATES.map((tpl) => ({
    tpl, score: scoreChord(w.chroma, tpl, w.bassPc),
  })).sort((a, b) => b.score - a.score));

  // 简单 Viterbi：偏好延续同一个和弦
  const states = TEMPLATES.length;
  const dp = Array.from({ length: windows.length }, () => new Float32Array(states));
  const back = Array.from({ length: windows.length }, () => new Int16Array(states));
  const winner = new Int16Array(windows.length);
  for (let s = 0; s < states; s++) dp[0][s] = candidates[0][s] ? candidates[0].find((c) => TEMPLATES.indexOf(c.tpl) === s)?.score ?? 0 : 0;
  for (let w = 1; w < windows.length; w++) {
    const scoreByState = new Float32Array(states);
    for (const c of candidates[w]) scoreByState[TEMPLATES.indexOf(c.tpl)] = c.score;
    for (let s = 0; s < states; s++) {
      let bestPrev = 0;
      let bestVal = -Infinity;
      for (let p = 0; p < states; p++) {
        const v = dp[w - 1][p] + (p === s ? 0.07 : 0);
        if (v > bestVal) {
          bestVal = v;
          bestPrev = p;
        }
      }
      dp[w][s] = bestVal + scoreByState[s];
      back[w][s] = bestPrev;
    }
  }
  let state = 0;
  for (let s = 1; s < states; s++) if (dp[windows.length - 1][s] > dp[windows.length - 1][state]) state = s;
  for (let w = windows.length - 1; w >= 0; w--) {
    winner[w] = state;
    if (w > 0) state = back[w][state];
  }

  const raw = windows.map((w, i) => {
    const tpl = TEMPLATES[winner[i]];
    const sorted = candidates[i];
    const top = sorted[0].score;
    const second = sorted[1]?.score ?? top - 1;
    return {
      t: w.t, dur: w.dur, root: tpl.root, quality: tpl.quality, name: tpl.name,
      confidence: clamp((top - second) * 8 + 0.35),
    };
  });

  // 合并相邻同名和弦
  const merged = [];
  for (const c of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.name === c.name && Math.abs(prev.t + prev.dur - c.t) < 0.02) {
      prev.dur += c.dur;
      prev.confidence = Math.max(prev.confidence, c.confidence);
    } else {
      merged.push({ ...c });
    }
  }
  for (const c of merged) {
    c.dur = +c.dur.toFixed(3);
    c.t = +c.t.toFixed(3);
    c.confidence = +c.confidence.toFixed(2);
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* 段落                                                                */
/* ------------------------------------------------------------------ */

function detectSections(features, beats, harmony, duration) {
  const barDur = beats.length > 4
    ? median(beats.slice(1, 9).map((b, i) => b.time - beats[i].time)) * 4
    : 2;
  const bars = [];
  for (let t = 0; t < duration - 0.1; t += barDur) {
    const t1 = Math.min(duration, t + barDur);
    const i0 = Math.max(0, Math.floor(t * features.fps));
    const i1 = Math.min(features.nFrames - 1, Math.floor(t1 * features.fps));
    let rms = 0;
    let high = 0;
    let low = 0;
    for (let i = i0; i <= i1; i++) {
      rms += features.rms[i];
      high += features.bands.hat[i] + features.bands.presence[i];
      low += features.bands.kick[i];
    }
    const count = Math.max(1, i1 - i0 + 1);
    const chroma = chromaAt(features, t, t1);
    bars.push({ t, dur: t1 - t, rms: rms / count, high: high / count, low: low / count, chroma });
  }

  const maxRms = bars.reduce((m, b) => Math.max(m, b.rms), 1e-6);
  const novelty = bars.map((b, i) => {
    if (i === 0) return 0;
    const prev = bars[i - 1];
    let diff = 0;
    for (let pc = 0; pc < 12; pc++) diff += Math.abs(b.chroma[pc] - prev.chroma[pc]);
    return diff * 2 + Math.abs(b.rms - prev.rms) / maxRms * 1.5 + Math.abs(b.high - prev.high) / (maxRms + 1e-6) * 0.1;
  });
  const mean = novelty.reduce((s, v) => s + v, 0) / Math.max(1, novelty.length);
  const std = Math.sqrt(novelty.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, novelty.length));
  const boundaries = [0];
  for (let i = 3; i < bars.length - 2; i++) {
    if (novelty[i] > mean + std * 0.6 && novelty[i] >= novelty[i - 1] && novelty[i] >= novelty[i + 1]) {
      if (i - boundaries[boundaries.length - 1] >= 3) boundaries.push(i);
      if (boundaries.length >= 7) break;
    }
  }
  if (boundaries.length < 3 && bars.length >= 8) {
    boundaries.length = 0;
    boundaries.push(0, Math.floor(bars.length / 4), Math.floor(bars.length / 2), Math.floor((bars.length * 3) / 4));
  }
  boundaries.push(bars.length);

  const sections = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i];
    const b = boundaries[i + 1];
    if (b <= a) continue;
    const slice = bars.slice(a, b);
    const energy = slice.reduce((s, x) => s + x.rms, 0) / slice.length / maxRms;
    sections.push({
      t: bars[a].t,
      end: b >= bars.length ? duration : bars[b].t,
      energy,
      label: '',
      cn: '',
    });
  }

  // 依据能量与位置给段落命名
  const sorted = [...sections].sort((a, b) => b.energy - a.energy);
  sorted.forEach((s, rank) => {
    if (rank === 0 && s.energy > 0.45) s.label = 'CHORUS';
  });
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.label) continue;
    if (i === 0) s.label = s.energy < 0.42 ? 'INTRO' : 'VERSE';
    else if (i === sections.length - 1) s.label = s.energy < 0.55 ? 'OUTRO' : 'VERSE';
    else s.label = s.energy < 0.3 ? 'BREAK' : 'VERSE';
  }
  for (const s of sections) {
    s.cn = SECTION_TEXT[s.label] || s.label;
    s.t = +s.t.toFixed(3);
    s.end = +s.end.toFixed(3);
    s.energy = +s.energy.toFixed(2);
  }
  return sections;
}

/* ------------------------------------------------------------------ */
/* 编曲推断                                                            */
/* ------------------------------------------------------------------ */

function sectionAt(sections, t) {
  for (const s of sections) if (t >= s.t && t < s.end) return s;
  return sections[sections.length - 1] || { label: 'VERSE', energy: 0.5 };
}

function chordVoicing(chord, base = 60) {
  const rootPc = chord.root;
  let root = base + ((rootPc - (base % 12) + 12) % 12);
  if (root > base + 11) root -= 12;
  const intervals = QUALITY_INTERVALS[chord.quality] || MAJOR;
  const notes = intervals.map((i) => root + i);
  notes.push(root + 12);
  return notes;
}

function powerVoicing(chord) {
  let root = 40 + ((chord.root - 4 + 12) % 12);
  return [root, root + 7, root + 12];
}

function buildInferredTracks(harmony, beats, sections) {
  const keys = [];
  const guitar = [];
  const beatDur = beats.length > 2
    ? median(beats.slice(1).map((b, i) => b.time - beats[i].time))
    : 0.5;
  for (const chord of harmony) {
    const sec = sectionAt(sections, chord.t);
    const high = sec.energy > 0.62 || sec.label === 'CHORUS';
    const voicing = chordVoicing(chord);
    const barStart = chord.t;
    // 键盘铺底
    for (const midi of voicing) {
      keys.push({
        t: +barStart.toFixed(3), dur: +Math.min(chord.dur * 0.92, 1.7).toFixed(3), midi,
        velocity: high ? 0.62 : 0.42, fx: { pad: true },
      });
    }
    // 键盘琶音 / 副歌柱式
    const steps = Math.max(2, Math.round(chord.dur / (beatDur / 2)));
    const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
    for (let i = 1; i < steps; i++) {
      const t = barStart + (i * beatDur) / 2;
      if (t >= chord.t + chord.dur - 0.05) break;
      const midi = voicing[pattern[i % pattern.length]] + (high ? 0 : 12);
      keys.push({
        t: +t.toFixed(3), dur: 0.18, midi,
        velocity: high ? 0.36 : 0.26, fx: { arp: true },
      });
    }
    if (high) {
      for (const beat of [1.5, 2.5]) {
        const t = barStart + beat * beatDur;
        if (t >= chord.t + chord.dur) continue;
        for (const midi of voicing) {
          keys.push({ t: +t.toFixed(3), dur: 0.16, midi, velocity: 0.5, fx: { stab: true } });
        }
      }
    }
    // 吉他：副歌强力和弦切分；其他段落长音铺底
    const power = powerVoicing(chord);
    if (high) {
      const hits = [0, 1.5, 2.5, 3.5];
      for (const beat of hits) {
        const t = barStart + beat * beatDur;
        if (t >= chord.t + chord.dur) continue;
        for (const midi of power) {
          guitar.push({
            t: +t.toFixed(3), dur: beat === 0 ? 0.26 : 0.17, midi,
            velocity: beat === 0 ? 0.78 : 0.64,
            fx: { distortion: true, palmMute: beat !== 0 },
          });
        }
      }
    } else {
      for (const midi of power) {
        guitar.push({
          t: +barStart.toFixed(3), dur: +Math.min(chord.dur * 0.9, 1.6).toFixed(3), midi,
          velocity: 0.4, fx: { clean: true },
        });
      }
    }
  }

  // 键盘音域收拢到 3 个八度，便于 3D 键盘按键
  for (const n of keys) {
    while (n.midi < 48) n.midi += 12;
    while (n.midi > 84) n.midi -= 12;
  }
  keys.sort((a, b) => a.t - b.t);
  guitar.sort((a, b) => a.t - b.t);
  return { keys, guitar };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

export function analyzePcm(input, sampleRate, onProgress = () => {}) {
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const t0 = now();
  let mono;
  if (input instanceof Float32Array) mono = input;
  else if (Array.isArray(input)) {
    const n = Math.min(...input.map((c) => c.length));
    mono = new Float32Array(n);
    for (const c of input) for (let i = 0; i < n; i++) mono[i] += c[i] / input.length;
  } else {
    throw new Error('不支持的音频数据');
  }
  const duration = mono.length / sampleRate;
  onProgress(0.08, '频谱 / 起音');

  const features = computeSpectralFeatures(mono, sampleRate, { frameSize: 2048, hop: 512 });
  onProgress(0.28, '节拍 / 速度');
  const tempo = estimateTempo(features);
  let beats = tempo.beats;
  if (beats.length < 4) {
    const step = 0.5;
    beats = [];
    for (let t = 0; t < duration; t += step) beats.push({ time: t, strength: 0 });
  }

  onProgress(0.38, '鼓组分离');
  const drums = detectDrums(features, beats);
  beats = alignDownbeat(beats, drums);
  if (!beats.length) beats = [{ time: 0, strength: 0 }];

  onProgress(0.52, '贝斯音高');
  const bass = pitchNotes(mono, sampleRate, {
    lowpass: 320, highpass: 38, fmin: 36, fmax: 320,
    minMidi: 26, maxMidi: 57, minDur: 0.12, minVel: 0.18, harmonicityFilter: true,
  });

  onProgress(0.66, '主旋律音高');
  const lead = pitchNotes(mono, sampleRate, {
    lowpass: 2400, highpass: 220, fmin: 150, fmax: 1400,
    minMidi: 55, maxMidi: 90, minDur: 0.15, minVel: 0.28,
  });

  onProgress(0.78, '和弦 / 调性');
  const harmony = detectHarmony(features, beats, bass, duration);
  onProgress(0.9, '段落 / 演奏编排');
  const sections = detectSections(features, beats, harmony, duration);
  const inferred = buildInferredTracks(harmony, beats, sections);

  // 段落起点加镲片
  const crashNotes = [];
  let prevEnergy = 0;
  for (const s of sections) {
    if (s.t === 0 || s.energy > prevEnergy * 1.05) {
      crashNotes.push({ t: s.t, dur: 1.2, midi: 49, drum: 'crash', velocity: 0.42 + s.energy * 0.35 });
    }
    prevEnergy = s.energy;
  }
  const allDrums = [...drums, ...crashNotes].sort((a, b) => a.t - b.t);
  const cleanedDrums = allDrums.filter((n, i, arr) => {
    if (n.drum !== 'crash') return true;
    return !arr.some((m) => m !== n && m.drum === 'crash' && Math.abs(m.t - n.t) < 0.05);
  });

  const bassNotes = bass.map((n) => ({ ...n }));
  const leadNotes = lead.map((n) => ({ ...n }));

  const tracks = [
    { id: 'drums', instrument: 'drums', label: TRACK_LABELS.drums, color: TRACK_COLORS.drums, notes: cleanedDrums, confidence: 0.78, inference: false },
    { id: 'bass', instrument: 'bass', label: TRACK_LABELS.bass, color: TRACK_COLORS.bass, notes: bassNotes, confidence: 0.74, inference: false },
    { id: 'guitar', instrument: 'guitar', label: TRACK_LABELS.guitar, color: TRACK_COLORS.guitar, notes: inferred.guitar, confidence: 0.6, inference: true },
    { id: 'keys', instrument: 'keys', label: TRACK_LABELS.keys, color: TRACK_COLORS.keys, notes: inferred.keys, confidence: 0.58, inference: true },
    { id: 'lead', instrument: 'lead', label: TRACK_LABELS.lead, color: TRACK_COLORS.lead, notes: leadNotes, confidence: 0.66, inference: false },
  ];

  const totalNotes = tracks.reduce((s, t) => s + t.notes.length, 0);
  const noteDensity = totalNotes / Math.max(1, duration);
  const keyGuess = guessKey(features, harmony);
  const quality = clamp(
    0.35 +
    Math.min(0.25, totalNotes / Math.max(1, duration) / 16) +
    (harmony.length ? 0.2 : 0) +
    (drums.length ? 0.15 : 0) +
    (bass.length ? 0.1 : 0),
    0.2, 0.95,
  );
  const elapsed = (now() - t0) / 1000;

  onProgress(1, '完成');

  return {
    version: 1,
    meta: {
      title: '未命名音频',
      artist: '本地文件',
      duration: +duration.toFixed(3),
      bpm: Math.round(tempo.bpm * 10) / 10,
      key: keyGuess,
      timeSignature: [4, 4],
      source: '本地音频',
      engine: 'EchoStage Browser Analyzer v1',
      elapsed: +elapsed.toFixed(2),
      quality: +quality.toFixed(2),
      noteDensity: +noteDensity.toFixed(2),
      analyzedAt: new Date().toISOString(),
    },
    beats: beats.map((b) => +b.time.toFixed(3)),
    sections,
    harmony,
    tracks,
    stats: {
      totalNotes,
      drums: cleanedDrums.length,
      bass: bassNotes.length,
      lead: leadNotes.length,
      guitar: inferred.guitar.length,
      keys: inferred.keys.length,
      sections: sections.length,
    },
  };
}

function guessKey(features, harmony) {
  if (!harmony.length) return '—';
  const major = new Float32Array(12);
  const minor = new Float32Array(12);
  for (const c of harmony) {
    if (c.quality === 'min') {
      minor[c.root] += 1.5 + c.confidence * 0.5;
      minor[(c.root + 7) % 12] += 0.3;
      major[(c.root + 3) % 12] += 0.35;
    } else {
      major[c.root] += 1.5 + c.confidence * 0.5;
      major[(c.root + 7) % 12] += 0.3;
      minor[(c.root + 4) % 12] += 0.35;
    }
  }
  let bestPc = 0;
  let bestMode = 'major';
  let best = -Infinity;
  for (let i = 0; i < 12; i++) {
    if (major[i] > best) { best = major[i]; bestPc = i; bestMode = 'major'; }
    if (minor[i] > best) { best = minor[i]; bestPc = i; bestMode = 'minor'; }
  }
  return `${pitchClassName(bestPc)} ${bestMode}`;
}

/** 从示例曲内置事件构造“原谱”，用于稳定演示与对照 */
export function scoreFromDemo(demo) {
  const { events, meta } = demo;
  const toNotes = (list) => list.map((n) => ({
    t: +n.t.toFixed(3),
    dur: +(n.dur || 0.12).toFixed(3),
    midi: n.midi,
    velocity: n.velocity ?? 0.7,
    ...(n.drum ? { drum: n.drum } : {}),
    ...(n.fx ? { fx: typeof n.fx === 'string' ? { [n.fx]: true } : n.fx } : {}),
  }));
  const tracks = [
    { id: 'drums', instrument: 'drums', label: TRACK_LABELS.drums, color: TRACK_COLORS.drums, notes: toNotes(events.drums), confidence: 1, inference: false },
    { id: 'bass', instrument: 'bass', label: TRACK_LABELS.bass, color: TRACK_COLORS.bass, notes: toNotes(events.bass), confidence: 1, inference: false },
    { id: 'guitar', instrument: 'guitar', label: TRACK_LABELS.guitar, color: TRACK_COLORS.guitar, notes: toNotes(events.guitar), confidence: 1, inference: false },
    { id: 'keys', instrument: 'keys', label: TRACK_LABELS.keys, color: TRACK_COLORS.keys, notes: toNotes(events.keys), confidence: 1, inference: false },
    { id: 'lead', instrument: 'lead', label: TRACK_LABELS.lead, color: TRACK_COLORS.lead, notes: toNotes(events.lead), confidence: 1, inference: false },
  ];
  const beats = [];
  for (let t = 0; t <= demo.duration; t += 0.5) beats.push(+t.toFixed(3));
  return {
    version: 1,
    meta: {
      title: meta.title,
      artist: meta.artist,
      duration: demo.duration,
      bpm: meta.bpm,
      key: meta.key,
      timeSignature: [4, 4],
      source: meta.source,
      engine: 'EchoStage Demo Score (ground truth)',
      elapsed: 0,
      quality: 1,
      noteDensity: +(tracks.reduce((s, t) => s + t.notes.length, 0) / demo.duration).toFixed(2),
      analyzedAt: new Date().toISOString(),
    },
    beats,
    sections: meta.sections.map((s) => ({
      t: s.start, end: s.end, label: s.name, cn: s.cn,
      energy: s.name === 'CHORUS' ? 1 : s.name === 'INTRO' ? 0.35 : 0.7,
    })),
    harmony: meta.chords.map((c) => ({
      t: c.t, dur: c.dur, name: c.name,
      root: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(c.name.replace('m', '')),
      quality: c.name.includes('m') ? 'min' : 'maj',
      confidence: 1,
    })),
    tracks,
    stats: {
      totalNotes: tracks.reduce((s, t) => s + t.notes.length, 0),
      drums: tracks[0].notes.length,
      bass: tracks[1].notes.length,
      lead: tracks[4].notes.length,
      guitar: tracks[2].notes.length,
      keys: tracks[3].notes.length,
      sections: meta.sections.length,
    },
  };
}

/** 从分析结果生成控制器用的轻量音符索引 */
export function prepareScore(score) {
  for (const track of score.tracks) {
    track.notes.sort((a, b) => a.t - b.t);
    track.count = track.notes.length;
    track.effects = [...new Set(track.notes.flatMap((n) => Object.keys(n.fx || {})))];
  }
  return score;
}

export const _internals = {
  estimateTempo, detectDrums, detectHarmony, detectSections,
  buildInferredTracks, chordVoicing, powerVoicing, noteName, rmsAt,
};
