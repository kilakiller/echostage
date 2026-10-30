/**
 * 乐谱工具：时间/和弦/音符查询、MIDI 导出、JSON 导出。
 */

import { noteName } from './dsp.js';

export const SECTION_LABELS = {
  INTRO: { cn: '拆解', color: '#4d7cff', card: 'DECONSTRUCT' },
  VERSE: { cn: '声部', color: '#8b8579', card: 'STEMS' },
  CHORUS: { cn: '复制', color: '#ff4f8b', card: 'COPY' },
  BREAK: { cn: '故障', color: '#ffd166', card: 'GLITCH' },
  OUTRO: { cn: '回声', color: '#79f2c0', card: 'ECHO' },
};

export function formatTime(t, withMs = false) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  if (!withMs) return base;
  return `${base}.${String(Math.floor((t % 1) * 10))}`;
}

export function findSection(score, t) {
  if (!score?.sections?.length) return null;
  for (const s of score.sections) if (t >= s.t && t < s.end) return s;
  return score.sections[score.sections.length - 1];
}

export function findChord(score, t) {
  if (!score?.harmony?.length) return null;
  for (const c of score.harmony) if (t >= c.t - 0.02 && t < c.t + c.dur) return c;
  return null;
}

export function activeNotes(score, t, window = 0.02) {
  const out = [];
  for (const track of score.tracks) {
    const list = [];
    for (const n of track.notes) {
      if (n.t > t + window) break;
      if (t <= n.t + Math.max(0.08, n.dur) + 0.04) list.push(n);
    }
    if (list.length) out.push({ track, notes: list });
  }
  return out;
}

export function activeFx(score, t) {
  const tags = new Set();
  for (const { notes } of activeNotes(score, t)) {
    for (const n of notes) {
      for (const k of Object.keys(n.fx || {})) tags.add(k);
    }
  }
  return [...tags];
}

export const FX_LABELS = {
  vibrato: '颤音',
  distortion: '失真',
  palmMute: '掌闷',
  pad: '铺底',
  arp: '琶音',
  stab: '柱式',
  clean: '清音',
  openhat: '开镲',
};

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadJSON(score) {
  const safe = {
    ...score,
    meta: { ...score.meta, exportedAt: new Date().toISOString(), schema: 'echostage.performance/1' },
  };
  const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${sanitize(score.meta.title)}.echostage.json`);
}

function sanitize(s) {
  return String(s || 'echostage').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
}

/* ----------------------------- MIDI ----------------------------- */

function vlq(value) {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function str(s) {
  return [...String(s)].map((c) => c.charCodeAt(0));
}

function metaText(type, text) {
  const data = str(text);
  return [0xff, type, ...vlq(data.length), ...data];
}

function chunk(id, data) {
  const len = data.length;
  return [...str(id), (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...data];
}

const TRACK_CONFIG = {
  drums: { channel: 9, program: 0, name: 'Drums 鼓组' },
  bass: { channel: 1, program: 33, name: 'Bass 贝斯' },
  guitar: { channel: 2, program: 30, name: 'Guitar 电吉他' },
  keys: { channel: 3, program: 4, name: 'Keys 键盘' },
  lead: { channel: 4, program: 81, name: 'Lead 主旋律' },
};

export function scoreToMidi(score) {
  const PPQ = 480;
  const bpm = score.meta?.bpm || 120;
  const header = chunk('MThd', [0, 1, 0, 6, PPQ >> 8, PPQ & 0xff]);

  const tempoTrack = [];
  tempoTrack.push(...vlq(0), ...metaText(0x03, score.meta?.title || 'EchoStage'));
  const us = Math.round(60000000 / bpm);
  tempoTrack.push(...vlq(0), 0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
  tempoTrack.push(...vlq(0), 0xff, 0x58, 0x04, 4, 2, 24, 8);
  tempoTrack.push(...vlq(0), 0xff, 0x2f, 0x00);

  const tracks = [chunk('MTrk', tempoTrack)];
  for (const track of score.tracks) {
    const cfg = TRACK_CONFIG[track.id];
    if (!cfg || !track.notes.length) continue;
    const events = [];
    events.push({ tick: 0, order: 0, data: [...vlq(0), ...metaText(0x03, cfg.name)] });
    events.push({ tick: 0, order: 1, data: [...vlq(0), 0xc0 | cfg.channel, cfg.program] });
    const t0 = 0;
    for (const n of track.notes) {
      const tick = Math.round((n.t - t0) * (bpm / 60) * PPQ);
      const dur = Math.max(12, Math.round(Math.max(0.03, n.dur) * (bpm / 60) * PPQ));
      const vel = Math.max(1, Math.min(127, Math.round((n.velocity ?? 0.7) * 127)));
      const midi = Math.max(0, Math.min(127, n.midi));
      events.push({ tick, order: 2, data: [...vlq(0), 0x90 | cfg.channel, midi, vel] });
      events.push({ tick: tick + dur, order: 1, data: [...vlq(0), 0x80 | cfg.channel, midi, 0] });
    }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const data = [];
    let last = 0;
    for (const ev of events) {
      data.push(...vlq(ev.tick - last));
      data.push(...ev.data.slice(1));
      last = ev.tick;
    }
    data.push(...vlq(0), 0xff, 0x2f, 0x00);
    tracks.push(chunk('MTrk', data));
  }
  const bytes = new Uint8Array([...header, ...tracks.flat()]);
  return new Blob([bytes], { type: 'audio/midi' });
}

export function downloadMIDI(score) {
  const blob = scoreToMidi(score);
  downloadBlob(blob, `${sanitize(score.meta.title)}.mid`);
}
