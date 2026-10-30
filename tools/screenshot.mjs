import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'http://127.0.0.1:8777/web/?t=17.4&cards=0';
const out = process.argv[3] || 'docs/reference/app.png';
const wait = Number(process.argv[4] || 5000);

fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
  ],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
page.on('console', (msg) => {
  const type = msg.type();
  if (type === 'error' || type === 'warning') console.log(`[console.${type}]`, msg.text());
  else if (process.env.VERBOSE) console.log(`[console.${type}]`, msg.text());
});
page.on('pageerror', (err) => console.log('[pageerror]', err.stack || err.message));
page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure()?.errorText));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
try {
  await page.waitForFunction('window.__ECHOSTAGE__ && window.__ECHOSTAGE__.state && window.__ECHOSTAGE__.state.score', { timeout: 45000 });
  console.log('score ready');
} catch (e) {
  console.log('score not ready:', e.message);
}
await new Promise((r) => setTimeout(r, wait));
const info = await page.evaluate(() => {
  const s = window.__ECHOSTAGE__;
  if (!s) return null;
  const canvas = document.querySelector('#stage');
  return {
    score: s.state.score?.meta,
    playing: s.state.playing,
    t: s.state.audio?.currentTime,
    canvas: { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight },
    tracks: s.state.score?.tracks.map((t) => [t.id, t.notes.length]),
    shot: s.stage?.shot,
    gl: s.stage?.renderer?.info?.render,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: out });
console.log('screenshot:', out);
await browser.close();

