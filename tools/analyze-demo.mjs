import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDemoSong, DEMO_DURATION } from '../web/js/synth.js';
import { analyzePcm } from '../web/js/analysis.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.now();
const demo = renderDemoSong(44100);
const synthMs = Date.now() - t0;

let sr = demo.sampleRate;
const n = demo.left.length;
const mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = (demo.left[i] + demo.right[i]) * 0.5;

let peak = 0;
for (let i = 0; i < demo.left.length; i++) peak = Math.max(peak, Math.abs(demo.left[i]));
console.log(`synth: ${(synthMs / 1000).toFixed(2)}s, ${n} samples, peak=${peak.toFixed(3)}`);
const t1 = Date.now();
const score = analyzePcm(mono, sr, (p, msg) => console.log(`  [${(p * 100).toFixed(0)}%] ${msg}`));
const analysisMs = Date.now() - t1;

console.log('\n=== META ===');
console.log(score.meta);
console.log('\n=== SECTIONS ===');
for (const s of score.sections) console.log(s);
console.log('\n=== HARMONY ===');
console.log(score.harmony.map((h) => `${h.t.toFixed(2)}-${(h.t + h.dur).toFixed(2)} ${h.name} (${h.confidence})`).join('\n'));
console.log('\n=== COUNTS ===');
console.log(score.stats);
console.log('\n=== FIRST NOTES ===');
for (const t of score.tracks) {
  console.log(t.id, t.notes.slice(0, 8).map((x) => `${x.t.toFixed(2)}:${x.midi}@${x.velocity.toFixed(2)}`).join('  '));
}

function match(truth, pred, tol, pitchTol = 0, drumFamily = false) {
  const used = new Set();
  let hits = 0;
  for (const a of truth) {
    let best = -1;
    let bestDt = Infinity;
    for (let i = 0; i < pred.length; i++) {
      if (used.has(i)) continue;
      const b = pred[i];
      if (Math.abs(a.t - b.t) > tol) continue;
      if (drumFamily) {
        const fam = (x) => (x === 46 ? 'hat' : x === 42 ? 'hat' : x);
        if (fam(a.midi) !== fam(b.midi)) continue;
      } else if (Math.abs(a.midi - b.midi) > pitchTol) continue;
      const dt = Math.abs(a.t - b.t);
      if (dt < bestDt) { bestDt = dt; best = i; }
    }
    if (best >= 0) { used.add(best); hits++; }
  }
  return { hits, truth: truth.length, pred: pred.length, recall: hits / Math.max(1, truth.length), precision: hits / Math.max(1, pred.length) };
}

console.log('\n=== ACCURACY ===');
const drums = score.tracks.find((t) => t.id === 'drums').notes;
console.log('drums', match(demo.events.drums, drums, 0.09, 0, true));
const bass = score.tracks.find((t) => t.id === 'bass').notes;
console.log('bass ', match(demo.events.bass, bass, 0.12, 1));
const lead = score.tracks.find((t) => t.id === 'lead').notes;
console.log('lead ', match(demo.events.lead, lead, 0.14, 1));

// 写一份 WAV 便于人工试听
const wavPath = path.join(here, '..', 'docs', 'reference', 'demo-song.wav');
const out = Buffer.alloc(44 + n * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + n * 4, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(sr, 24); out.writeUInt32LE(sr * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(n * 4, 40);
let off = 44;
for (let i = 0; i < n; i++) {
  out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(demo.left[i] * 32767))), off); off += 2;
  out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(demo.right[i] * 32767))), off); off += 2;
}
fs.writeFileSync(wavPath, out);
console.log(`\nanalysis: ${(analysisMs / 1000).toFixed(2)}s, wav: ${wavPath}`);
