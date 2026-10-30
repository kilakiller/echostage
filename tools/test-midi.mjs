import { renderDemoSong } from '../web/js/synth.js';
import { scoreFromDemo } from '../web/js/analysis.js';
import { scoreToMidi } from '../web/js/score-tools.js';
const demo = renderDemoSong(44100);
const score = scoreFromDemo(demo);
const blob = scoreToMidi(score);
const buf = Buffer.from(await blob.arrayBuffer());
console.log('midi bytes', buf.length, 'header', buf.slice(0,4).toString(), 'tracks', buf.readUInt16BE(10));
