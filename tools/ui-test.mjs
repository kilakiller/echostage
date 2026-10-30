import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({
  executablePath: edge,
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars', '--force-device-scale-factor=1',
  ],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto('http://127.0.0.1:8777/web/?t=7.4&cards=0', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ECHOSTAGE__?.state?.score', { timeout: 45000 });
await new Promise((r) => setTimeout(r, 1200));

// 1. playback
await page.click('#btn-play');
await new Promise((r) => setTimeout(r, 2600));
const playState = await page.evaluate(() => ({
  playing: window.__ECHOSTAGE__.state.playing,
  t: window.__ECHOSTAGE__.state.audio.currentTime,
  shot: window.__ECHOSTAGE__.stage.shot,
  card: document.querySelector('#type-card').className,
  cardText: document.querySelector('#type-big').textContent,
  progress: document.querySelector('#progress-fill').style.width,
}));
console.log('PLAY', playState);
await page.screenshot({ path: 'docs/reference/playing.png' });
await page.click('#btn-play');

// 2. playlist modal + netease
await page.click('#btn-playlist');
await new Promise((r) => setTimeout(r, 800));
const companion = await page.$eval('#companion-text', (el) => el.textContent);
console.log('COMPANION', companion);
await page.type('#playlist-url', 'https://music.163.com/playlist?id=3778678');
await page.click('#btn-fetch-playlist');
await page.waitForFunction(() => document.querySelectorAll('#playlist .track-row').length > 5, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
const playlist = await page.evaluate(() => ({
  count: document.querySelectorAll('#playlist .track-row').length,
  label: document.querySelector('#playlist-count').textContent,
  first: document.querySelector('#playlist .track-title')?.textContent,
  cover: document.querySelector('#playlist img.track-cover')?.src?.slice(0, 60),
}));
console.log('PLAYLIST', playlist);
await page.screenshot({ path: 'docs/reference/playlist.png' });
await page.click('#modal-close');

// 3. local WAV analysis
const input = await page.$('#file-input');
await input.uploadFile(path.resolve('docs/reference/demo-song.wav'));
await page.waitForFunction(() => {
  const s = window.__ECHOSTAGE__?.state;
  return s && s.score && String(s.score.meta.engine).includes('Browser');
}, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1000));
const analyzed = await page.evaluate(() => {
  const s = window.__ECHOSTAGE__.state;
  return {
    meta: s.score.meta,
    tracks: s.score.tracks.map((t) => [t.id, t.notes.length]),
    sections: s.score.sections,
    harmony: s.score.harmony.slice(0, 6),
    overlayOpen: document.querySelector('#analyzing').classList.contains('open'),
    engine: s.score.meta.engine,
  };
});
console.log('ANALYZED', JSON.stringify(analyzed, null, 2));
await page.screenshot({ path: 'docs/reference/analyzed.png' });

// 4. MV mode
await page.click('#btn-mv');
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'docs/reference/mv.png' });
const mv = await page.evaluate(() => ({
  body: document.body.className,
  canvas: [document.querySelector('#stage').clientWidth, document.querySelector('#stage').clientHeight],
}));
console.log('MV', mv);

console.log('ERRORS', errors.length ? errors : 'none');
await browser.close();

