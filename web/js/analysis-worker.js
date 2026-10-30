import { analyzePcm } from './analysis.js';

self.onmessage = (e) => {
  const { type, mono, sampleRate, title, artist } = e.data || {};
  if (type !== 'analyze') return;
  try {
    const score = analyzePcm(mono, sampleRate, (progress, message) => {
      self.postMessage({ type: 'progress', progress, message });
    });
    if (title) score.meta.title = title;
    if (artist) score.meta.artist = artist;
    self.postMessage({ type: 'done', score });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.stack || err?.message || err) });
  }
};
