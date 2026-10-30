import { createStage } from './stage.js';
import { AudioEngine } from './audio-engine.js';
import { renderDemoSong } from './synth.js';
import { scoreFromDemo } from './analysis.js';
import { noteName } from './dsp.js';
import {
  formatTime, findSection, findChord, activeNotes, activeFx,
  SECTION_LABELS, FX_LABELS, downloadJSON, downloadMIDI,
} from './score-tools.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const params = new URLSearchParams(location.search);

const state = {
  stage: null,
  audio: null,
  score: null,
  demo: null,
  playing: false,
  source: 'demo',
  duration: 0,
  lastSectionKey: null,
  lastHud: 0,
  lastShot: '',
  directorOn: true,
  mv: false,
  worker: null,
  analyzing: false,
  companionOk: false,
  rows: new Map(),
  draggingProgress: false,
  suppressCards: false,
  uiBusy: false,
  startTime: Number.isFinite(parseFloat(params.get('t'))) ? parseFloat(params.get('t')) : 0,
};

const els = {
  title: $('#np-title'),
  artist: $('#np-artist'),
  source: $('#np-source'),
  bpm: $('#np-bpm'),
  key: $('#np-key'),
  quality: $('#np-quality'),
  tempo: $('#tempo-label'),
  meter: $('#meter-label'),
  timeNow: $('#time-now'),
  timeTotal: $('#time-total'),
  progress: $('#progress'),
  progressFill: $('#progress-fill'),
  progressHead: $('#progress-head'),
  progressSections: $('#progress-sections'),
  play: $('#btn-play'),
  playIcon: $('#play-icon'),
  bandList: $('#band-list'),
  panelHint: $('#panel-hint'),
  nowChord: $('#now-chord'),
  nowNotes: $('#now-notes'),
  nowSection: $('#now-section'),
  fxTags: $('#fx-tags'),
  energy: $('#energy-fill'),
  shot: $('#shot-name'),
  captionTrack: $('#caption-track'),
  typeCard: $('#type-card'),
  typeSmall: $('#type-small'),
  typeBig: $('#type-big'),
  typeCn: $('#type-cn'),
  toast: $('#toast'),
  modal: $('#modal-backdrop'),
  playlist: $('#playlist'),
  playlistCount: $('#playlist-count'),
  companions: $('#companion-text'),
  companionDot: $('#companion-dot'),
  analyzing: $('#analyzing'),
  analyzingTitle: $('#analyzing-title'),
  analyzingMsg: $('#analyzing-msg'),
  analyzeFill: $('#analyze-fill'),
  steps: $$('#analysis-steps span'),
  dropOverlay: $('#drop-overlay'),
  mvCaption: $('#mv-caption'),
  mvTitle: $('#mv-title'),
  director: $('#btn-director'),
};

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    state.audio = new AudioEngine();
    state.stage = createStage($('#stage'));
  } catch (err) {
    document.body.innerHTML = `<div style="padding:48px;color:#f0e7d6;font-family:sans-serif">
      <h1>WebGL 启动失败</h1><p>${String(err.message || err)}</p>
      <p>请使用支持 WebGL2 的 Chrome / Edge，并通过本地 HTTP 服务打开本页。</p></div>`;
    return;
  }

  state.audio.onEnded = () => {
    state.playing = false;
    updatePlayButton();
  };

  setupUI();
  setupKeyboard();
  setupDrop();
  setupProgress();

  if (params.get('ui') === '0') document.body.classList.add('ui-hidden');
  if (params.get('cards') === '0') state.suppressCards = true;

  await nextFrame();
  await loadDemo();

  if (params.get('mv') === '1') toggleMv(true);
  const shot = params.get('shot');
  if (shot) state.stage.focus(shot);
  if (params.get('auto') === '0') {
    state.stage.setAuto(false);
    state.directorOn = false;
    updateDirectorButton();
  }
  if (state.startTime > 0) seekTo(Math.min(state.duration - 0.05, state.startTime));
  if (params.get('play') === '1') setTimeout(() => togglePlay(), 400);

  requestAnimationFrame(loop);
  window.__ECHOSTAGE__ = { state, stage: state.stage, audio: state.audio, ...state.stage };
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function loadDemo({ analyze = false } = {}) {
  if (state.playing) {
    state.audio.pause();
    state.playing = false;
    updatePlayButton();
  }
  showAnalyzing('正在生成示例曲', '合成一段原创器乐 · 120 BPM');
  setAnalyzeProgress(0.15, '写入 Web Audio 缓冲…');
  await nextFrame();
  const demo = renderDemoSong(44100);
  state.demo = demo;
  const buffer = state.audio.setPcm(demo.left, demo.right, demo.sampleRate);
  state.duration = buffer.duration;

  if (!analyze) {
    const score = scoreFromDemo(demo);
    score.meta.duration = buffer.duration;
    applyScore(score, { source: 'demo', autoPlay: false });
    setAnalyzeProgress(1, '完成');
    hideAnalyzing();
    toast('已载入示例曲 · 内置原谱');
  } else {
    setAnalyzeProgress(0.3, '启动浏览器分析器…');
    const mono = downmix(demo.left, demo.right);
    runAnalysis(mono, demo.sampleRate, {
      title: demo.meta.title,
      artist: demo.meta.artist,
      source: 'demo-analysis',
      closeOverlay: true,
    });
  }
}

function applyScore(score, opts = {}) {
  if (state.playing) {
    state.audio.pause();
    state.playing = false;
    updatePlayButton();
  }
  state.score = score;
  state.source = opts.source || score.meta.source || 'local';
  state.duration = state.audio.duration || score.meta.duration;
  score.meta.duration = state.duration;
  state.stage.setScore(score);
  state.lastSectionKey = null;
  state.lastShot = '';
  buildBandList(score);
  buildProgress(score);
  updateMeta(score);
  updatePlayButton();
  seekTo(0);
  state.stage.warmUp(0);
  state.stage.update(0, 1 / 60, null);
  state.stage.render();
  updateHUD(0, 0, state.stage.shot, { force: true });
}

function updateMeta(score) {
  els.title.textContent = score.meta.title || '未命名音频';
  els.artist.textContent = score.meta.artist || '未知艺术家';
  els.source.textContent = score.meta.source || '本地文件';
  els.source.classList.toggle('chip-source', state.source === 'demo');
  els.source.classList.toggle('chip-quality', state.source === 'local');
  els.bpm.textContent = `${Math.round(score.meta.bpm)} BPM`;
  els.key.textContent = score.meta.key || '—';
  els.tempo.textContent = Math.round(score.meta.bpm);
  els.meter.textContent = `${score.meta.key || '—'} · ${score.meta.timeSignature?.[0] || 4}/4`;
  const q = score.meta.quality;
  const quick = state.source === 'local' || state.source === 'demo-analysis';
  if (state.source === 'demo') {
    els.quality.textContent = '原谱 100%';
    els.quality.style.color = 'var(--mint)';
  } else if (quick) {
    els.quality.textContent = '快速分析 · 实验性';
    els.quality.style.color = 'var(--orange)';
  } else {
    els.quality.textContent = q ? `分析 ${Math.round(q * 100)}%` : '浏览器分析';
    els.quality.style.color = 'var(--gold)';
  }
  els.timeTotal.textContent = `/ ${formatTime(state.duration)}`;
  document.title = `${score.meta.title} · EchoStage`;
  els.mvTitle.textContent = (score.meta.title || 'ECHO / STAGE').toUpperCase();
  els.mvCaption.textContent = `${score.meta.artist || ''} · ${Math.round(score.meta.bpm)} BPM · ${(score.meta.key || '').toUpperCase()}`;
  els.playlistCount.textContent = `${score.stats?.totalNotes || 0} NOTES`;
}

/* ------------------------------------------------------------------ */
/* 声部面板                                                            */
/* ------------------------------------------------------------------ */

const BAND_SUB = {
  drums: 'DRUM KIT / 打击乐',
  bass: 'BASS / 低频',
  guitar: 'ELECTRIC GUITAR / 和弦',
  keys: 'KEYS / 和声',
  lead: 'LEAD / 主旋律',
};

function buildBandList(score) {
  els.bandList.innerHTML = '';
  state.rows.clear();
  const visibleAll = {};
  for (const track of score.tracks) {
    const row = document.createElement('div');
    row.className = 'band-row';
    row.style.color = track.color;
    row.innerHTML = `
      <span class="band-dot" style="background:${track.color};color:${track.color}"></span>
      <div class="band-main">
        <div class="band-name">${track.label}<span style="color:var(--muted);font-weight:400;font-size:9px;margin-left:5px">${track.count ?? track.notes.length}</span></div>
        <div class="band-sub">${BAND_SUB[track.id] || track.instrument}${track.inference ? ' · 推断' : ''}</div>
      </div>
      <div class="band-meter" style="color:${track.color}"><i></i></div>
      <div class="band-actions">
        <button class="icon-btn eye" title="显示 / 隐藏">◉</button>
        <button class="icon-btn focus" title="镜头聚焦">⌖</button>
      </div>`;
    const meter = row.querySelector('.band-meter i');
    const eye = row.querySelector('.eye');
    const focus = row.querySelector('.focus');
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = eye.classList.toggle('off');
      const show = !on;
      state.stage.band.setActive(track.id, show);
      row.style.opacity = show ? '1' : '0.45';
      if (show) visibleAll[track.id] = true;
    });
    focus.addEventListener('click', (e) => {
      e.stopPropagation();
      state.stage.focus(track.id);
      toast(`镜头 → ${track.label}`);
    });
    row.addEventListener('click', () => state.stage.focus(track.id));
    els.bandList.appendChild(row);
    state.rows.set(track.id, { row, meter, track });
    const hasNotes = track.notes.length > 0;
    if (!hasNotes) {
      eye.classList.add('off');
      row.style.opacity = '0.38';
      state.stage.band.setActive(track.id, false);
    } else {
      state.stage.band.setActive(track.id, true);
    }
  }
  els.panelHint.textContent = `${score.tracks.filter((t) => t.notes.length).length} TRACKS / ${score.stats?.totalNotes || 0} NOTES`;
}

/* ------------------------------------------------------------------ */
/* 进度条                                                              */
/* ------------------------------------------------------------------ */

function buildProgress(score) {
  els.progressSections.innerHTML = '';
  for (const s of score.sections) {
    const el = document.createElement('i');
    const meta = SECTION_LABELS[s.label] || SECTION_LABELS.VERSE;
    el.style.background = meta.color;
    el.style.opacity = s.label === 'CHORUS' ? '0.72' : '0.35';
    el.style.width = `${((s.end - s.t) / state.duration) * 100}%`;
    el.title = `${s.label} · ${formatTime(s.t)}`;
    els.progressSections.appendChild(el);
  }
  setProgress(0);
}

function setProgress(t) {
  const p = Math.max(0, Math.min(1, t / Math.max(0.001, state.duration)));
  els.progressFill.style.width = `${p * 100}%`;
  els.progressHead.style.left = `${p * 100}%`;
}

function setupProgress() {
  const posFromEvent = (e) => {
    const r = els.progress.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * state.duration;
  };
  els.progress.addEventListener('pointerdown', (e) => {
    state.draggingProgress = true;
    els.progress.setPointerCapture(e.pointerId);
    seekTo(posFromEvent(e));
  });
  els.progress.addEventListener('pointermove', (e) => {
    if (state.draggingProgress) seekTo(posFromEvent(e));
  });
  const up = (e) => {
    state.draggingProgress = false;
    els.progress.releasePointerCapture?.(e.pointerId);
  };
  els.progress.addEventListener('pointerup', up);
  els.progress.addEventListener('pointercancel', up);
}

/* ------------------------------------------------------------------ */
/* 播放 / 跳转                                                         */
/* ------------------------------------------------------------------ */

async function togglePlay() {
  if (!state.score) return;
  await state.audio.resume();
  if (state.playing) {
    state.audio.pause();
    state.playing = false;
  } else {
    if (state.audio.currentTime >= state.duration - 0.06) {
      state.audio.seek(0);
      state.stage.warmUp(0);
    }
    state.audio.play(state.audio.currentTime);
    state.playing = true;
  }
  updatePlayButton();
}

function updatePlayButton() {
  els.play.classList.toggle('playing', state.playing);
  els.playIcon.setAttribute('d', state.playing ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z');
  els.play.setAttribute('aria-label', state.playing ? '暂停' : '播放');
}

function seekTo(t) {
  if (!state.score) return;
  const clamped = Math.max(0, Math.min(state.duration, t));
  const wasPlaying = state.playing;
  state.audio.seek(clamped);
  state.playing = wasPlaying;
  state.stage.warmUp(clamped);
  state.stage.update(clamped, 1 / 60, null);
  state.stage.render();
  state.lastSectionKey = null;
  updateHUD(clamped, 0, state.stage.shot, { force: true, noCard: true });
}

/* ------------------------------------------------------------------ */
/* 文件夹 / 歌单                                                       */
/* ------------------------------------------------------------------ */

function setupUI() {
  updatePerfLabel(state.stage.quality);
  if (/swiftshader|llvmpipe|software/i.test(state.stage.rendererName || '')) {
    setTimeout(() => toast('检测到软件渲染：建议在 Edge 设置中开启硬件加速'), 1400);
  }
  window.addEventListener('echostage:quality', (e) => {
    const q = e.detail?.quality;
    updatePerfLabel(q);
    if (String(e.detail?.reason || '').startsWith('fps') && state.playing) {
      toast(`帧率偏低，已切换到${QUALITY_NAMES[q] || q}画质`);
    }
  });
  els.play.addEventListener('click', togglePlay);
  $('#btn-mv').addEventListener('click', () => toggleMv());
  $('#btn-playlist').addEventListener('click', () => openPlaylist());
  $('#btn-export').addEventListener('click', toggleExportMenu);
  $('#btn-analyze-demo').addEventListener('click', () => {
    if (!state.demo) return;
    const mono = downmix(state.demo.left, state.demo.right);
    showAnalyzing('正在用分析器重跑示例曲', '这条路径与导入歌曲完全一致');
    setAnalyzeProgress(0.12, '启动分析器…');
    runAnalysis(mono, state.demo.sampleRate, {
      title: state.demo.meta.title,
      artist: state.demo.meta.artist,
      source: 'demo-analysis',
      closeOverlay: true,
    });
  });
  els.director.addEventListener('click', () => {
    state.directorOn = !state.directorOn;
    state.stage.setAuto(state.directorOn);
    updateDirectorButton();
  });
  $('#modal-close').addEventListener('click', closePlaylist);
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closePlaylist(); });
  $('#volume').addEventListener('input', (e) => state.audio.setVolume(e.target.value / 100));
  $$('#import-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('#import-tabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const local = tab.dataset.tab === 'local';
      $('#pane-url').classList.toggle('hidden', local);
      $('#pane-local').classList.toggle('hidden', !local);
      if (local) return;
      const platform = tab.dataset.tab;
      $('#playlist-url').placeholder = platform === 'netease'
        ? 'https://music.163.com/playlist?id=...'
        : platform === 'qq'
          ? 'https://y.qq.com/n/ryqq/playlist/...'
          : 'https://open.spotify.com/playlist/...';
    });
  });
  $('#btn-fetch-playlist').addEventListener('click', fetchPlaylist);
  $('#playlist-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchPlaylist(); });
  $('#file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  });
  $('#drop-hint').addEventListener('click', () => openPlaylist('local'));
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropOverlay.classList.add('open');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) els.dropOverlay.classList.remove('open');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropOverlay.classList.remove('open');
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('audio') || /\.(mp3|wav|flac|m4a|ogg)$/i.test(f.name));
    if (file) loadFile(file);
    else toast('请拖入音频文件');
  });
  document.addEventListener('click', (e) => {
    const menu = $('#export-menu');
    if (menu && !menu.contains(e.target) && e.target.id !== 'btn-export') menu.classList.remove('open');
  });
}

function updateDirectorButton() {
  els.director.textContent = `导演运镜 · ${state.directorOn ? 'ON' : 'OFF'}`;
  els.director.classList.toggle('on', state.directorOn);
}

function toggleMv(force) {
  state.mv = force === undefined ? !state.mv : force;
  document.body.classList.toggle('mv-mode', state.mv);
  els.mvCaption.textContent = `${state.score?.meta.artist || ''} · ${Math.round(state.score?.meta.bpm || 0)} BPM · ${(state.score?.meta.key || '').toUpperCase()}`;
  setTimeout(() => state.stage?.resize(), 60);
}

/* ------------------------------------------------------------------ */
/* 导入音频 / 分析                                                     */
/* ------------------------------------------------------------------ */

async function loadFile(file) {
  if (!file) return;
  if (state.playing) {
    state.audio.pause();
    state.playing = false;
    updatePlayButton();
  }
  showAnalyzing(`正在解构 ${file.name}`, '本地分析 · 音频不会上传');
  setAnalyzeProgress(0.04, '解码音频…');
  closePlaylist();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await state.audio.decode(arrayBuffer);
    state.duration = buffer.duration;
    setAnalyzeProgress(0.12, '解码完成，开始分析…');
    const mono = downmixBuffer(buffer);
    runAnalysis(mono, buffer.sampleRate, {
      title: file.name.replace(/\.[^.]+$/, ''),
      artist: '本地音频',
      source: 'local',
      closeOverlay: false,
    });
  } catch (err) {
    hideAnalyzing();
    toast(`无法解码这个文件：${err.message || err}`);
  }
}

function runAnalysis(mono, sampleRate, meta) {
  if (state.analyzing) {
    toast('已有分析任务在进行');
    return;
  }
  state.analyzing = true;
  state.worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
  const worker = state.worker;
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      setAnalyzeProgress(msg.progress, msg.message);
    } else if (msg.type === 'done') {
      const score = msg.score;
      score.meta.title = meta.title || score.meta.title;
      score.meta.artist = meta.artist || score.meta.artist;
      score.meta.source = meta.source === 'demo-analysis' ? '示例曲 · 浏览器分析' : '本地音频 · 浏览器分析';
      const analyserLabel = meta.source === 'demo-analysis' ? '示例曲 · 分析器' : '本地文件 · 分析器';
      applyScore(score, { source: meta.source });
      state.score.meta.source = analyserLabel;
      updateMeta(score);
      finishAnalysis();
      toast(`解构完成 · ${score.stats.totalNotes} 个音符`);
    } else if (msg.type === 'error') {
      finishAnalysis();
      toast('分析失败：' + msg.message.split('\n')[0]);
    }
  };
  worker.onerror = (err) => {
    finishAnalysis();
    toast('分析线程出错：' + (err.message || 'unknown'));
  };
  worker.postMessage({ type: 'analyze', mono, sampleRate, title: meta.title, artist: meta.artist }, [mono.buffer]);
  if (meta.closeOverlay) {
    // demo 重跑：保持遮罩，由完成回调关闭
  }
}

function finishAnalysis() {
  state.analyzing = false;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  hideAnalyzing();
}

function downmixBuffer(buffer) {
  const n = buffer.length;
  const mono = new Float32Array(n);
  const ch = buffer.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i] / ch;
  }
  return mono;
}

function downmix(left, right) {
  const n = Math.min(left.length, right.length);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (left[i] + right[i]) * 0.5;
  return mono;
}

function showAnalyzing(title, msg = '') {
  state.uiBusy = true;
  els.analyzingTitle.textContent = title;
  els.analyzingMsg.textContent = msg;
  setAnalyzeProgress(0, msg);
  els.analyzing.classList.add('open');
}

function hideAnalyzing() {
  state.uiBusy = false;
  els.analyzing.classList.remove('open');
  if (state.score && state.playing) state.stage?.warmUp(state.audio?.currentTime || 0);
}

function setAnalyzeProgress(p, msg) {
  els.analyzeFill.style.width = `${Math.max(0, Math.min(1, p)) * 100}%`;
  if (msg) els.analyzingMsg.textContent = msg;
  const idx = p < 0.14 ? 0 : p < 0.32 ? 1 : p < 0.45 ? 2 : p < 0.76 ? 3 : 4;
  els.steps.forEach((el, i) => {
    el.className = i < idx ? 'done' : i === idx ? 'active' : '';
  });
}

/* ------------------------------------------------------------------ */
/* 歌单弹窗                                                            */
/* ------------------------------------------------------------------ */

function openPlaylist(tab) {
  state.uiBusy = true;
  els.modal.classList.add('open');
  checkCompanion();
  if (tab === 'local') {
    $$('#import-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'local'));
    $('#pane-url').classList.add('hidden');
    $('#pane-local').classList.remove('hidden');
  }
  if (!els.playlist.dataset.loaded) renderDemoPlaylist();
}

function closePlaylist() {
  els.modal.classList.remove('open');
  state.uiBusy = false;
  if (state.score && state.playing) state.stage?.warmUp(state.audio?.currentTime || 0);
}

async function checkCompanion() {
  if (location.protocol === 'https:') {
    state.companionOk = false;
    els.companionDot.className = 'status-dot bad';
    els.companions.textContent = '在线演示：歌单助手需在本地运行；可直接拖入本地音频';
    return;
  }
  try {
    const r = await fetch('http://127.0.0.1:8787/api/health', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) throw new Error('bad status');
    const j = await r.json();
    state.companionOk = true;
    els.companionDot.className = 'status-dot ok';
    els.companions.textContent = `本地助手已连接 · ${j.platforms?.join(' / ') || 'netease / qq / spotify'}`;
  } catch {
    state.companionOk = false;
    els.companionDot.className = 'status-dot bad';
    els.companions.textContent = '未检测到本地助手（127.0.0.1:8787）· 示例与本地音频仍可用';
  }
}

function renderDemoPlaylist() {
  els.playlist.innerHTML = '';
  els.playlist.dataset.loaded = '1';
  const demo = document.createElement('div');
  demo.className = 'track-row';
  demo.innerHTML = `
    <div class="track-cover" style="background:linear-gradient(135deg,#ff4f8b,#4d7cff)">E</div>
    <div class="track-info">
      <div class="track-title">复制之夜 · Copy Night</div>
      <div class="track-artist">EchoStage Studio · 内置原创示例</div>
    </div>
    <div class="track-dur">0:32</div>
    <button class="track-load">载入</button>`;
  demo.querySelector('.track-load').addEventListener('click', async () => {
    closePlaylist();
    await loadDemo();
  });
  els.playlist.appendChild(demo);

  const local = document.createElement('div');
  local.className = 'track-row';
  local.innerHTML = `
    <div class="track-cover" style="background:linear-gradient(135deg,#79f2c0,#ffd166);color:#111">＋</div>
    <div class="track-info">
      <div class="track-title">本地音频…</div>
      <div class="track-artist">拖入 MP3 / WAV / FLAC，分析后直接演出</div>
    </div>
    <div class="track-dur">—</div>
    <button class="track-load">选择</button>`;
  local.querySelector('.track-load').addEventListener('click', () => $('#file-input').click());
  els.playlist.appendChild(local);
}

async function fetchPlaylist() {
  if (location.protocol === 'https:') {
    toast('在线版无法访问歌单助手；请本地运行完整版，或直接拖入音频');
    return;
  }
  const url = $('#playlist-url').value.trim();
  if (!url) { toast('先粘贴一个歌单链接'); return; }
  els.playlistCount.textContent = '读取中…';
  try {
    const endpoint = `http://127.0.0.1:8787/api/playlist?url=${encodeURIComponent(url)}`;
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    renderPlaylistTracks(data);
    toast(`已读取 ${data.tracks?.length || 0} 首曲目`);
  } catch (err) {
    els.playlistCount.textContent = '读取失败';
    toast(`歌单读取失败：${err.message || err}。请确认本地助手已启动。`);
    if (!els.playlist.children.length) renderDemoPlaylist();
  }
}

function renderPlaylistTracks(data) {
  els.playlist.innerHTML = '';
  els.playlist.dataset.loaded = '1';
  if (!data.tracks?.length) {
    els.playlist.innerHTML = '<div class="playlist-empty">这个歌单是空的，或者平台没有返回可读曲目。</div>';
    return;
  }
  els.playlistCount.textContent = `${data.tracks.length} TRACKS · ${data.platform || ''}`;
  for (const t of data.tracks.slice(0, 200)) {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.innerHTML = `
      ${t.cover ? `<img class="track-cover" src="${t.cover}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<div class="track-cover">♪</div>`}
      <div class="track-info">
        <div class="track-title">${escapeHtml(t.title)}</div>
        <div class="track-artist">${escapeHtml(t.artist || '')}${t.album ? ` · ${escapeHtml(t.album)}` : ''}</div>
      </div>
      <div class="track-dur">${t.duration ? formatTime(t.duration) : '—'}</div>
      <button class="track-load">${t.previewUrl ? '试听 30s' : '选本地音频'}</button>`;
    const btn = row.querySelector('.track-load');
    if (t.previewUrl) {
      btn.addEventListener('click', () => loadPreview(t));
    } else {
      btn.addEventListener('click', () => {
        closePlaylist();
        toast('请选择这首曲目的本地音频文件');
        setTimeout(() => $('#file-input').click(), 120);
      });
    }
    els.playlist.appendChild(row);
  }
}

async function loadPreview(track) {
  if (location.protocol === 'https:') {
    toast('在线版不支持平台试听代理；请本地运行歌单助手');
    return;
  }
  closePlaylist();
  if (state.playing) {
    state.audio.pause();
    state.playing = false;
    updatePlayButton();
  }
  showAnalyzing(`正在载入试听 · ${track.title}`, '通过本地助手代理音频，请稍候');
  setAnalyzeProgress(0.05, '请求试听音频…');
  try {
    const r = await fetch(`http://127.0.0.1:8787/api/audio?url=${encodeURIComponent(track.previewUrl)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ab = await r.arrayBuffer();
    const buffer = await state.audio.decode(ab);
    state.duration = buffer.duration;
    setAnalyzeProgress(0.12, '解码完成，开始分析…');
    runAnalysis(downmixBuffer(buffer), buffer.sampleRate, {
      title: track.title,
      artist: track.artist || '平台试听',
      source: 'local',
    });
  } catch (err) {
    hideAnalyzing();
    toast(`试听载入失败：${err.message || err}`);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ */
/* 导出                                                                */
/* ------------------------------------------------------------------ */

function toggleExportMenu() {
  let menu = $('#export-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'export-menu';
    menu.className = 'export-menu';
    menu.innerHTML = `
      <button data-export="json">乐谱 JSON<span>全部音符 / 和弦 / 分段</span></button>
      <button data-export="midi">多轨 MIDI<span>导入 DAW 继续编曲</span></button>`;
    document.body.appendChild(menu);
    menu.addEventListener('click', (e) => {
      const kind = e.target.closest('button')?.dataset.export;
      if (!kind) return;
      menu.classList.remove('open');
      if (kind === 'json') downloadJSON(state.score);
      if (kind === 'midi') downloadMIDI(state.score);
      toast(`已导出 ${kind.toUpperCase()}`);
    });
  }
  menu.classList.toggle('open');
}

/* ------------------------------------------------------------------ */
/* HUD / 动画                                                          */
/* ------------------------------------------------------------------ */

const DRUM_LABELS = {
  kick: '底鼓', snare: '军鼓', hat: '闭镲', openhat: '开镲', crash: '吊镲', ride: '叮叮镲', tom: '嗵鼓',
};

const QUALITY_NAMES = { high: '精细', medium: '均衡', low: '流畅' };

function updatePerfLabel(q) {
  const el = $('#perf-mode');
  if (el) el.textContent = `AUTO · ${QUALITY_NAMES[q] || q || '精细'}`;
}

function updateHUD(t, activity, shot, opts = {}) {
  const score = state.score;
  if (!score) return;
  els.timeNow.textContent = formatTime(t);
  setProgress(t);
  els.shot.textContent = `${(shot || 'wide').toUpperCase()} SHOT`;

  const section = findSection(score, t);
  if (section) {
    els.nowSection.textContent = `${section.label} · ${section.cn}`;
    const key = `${section.label}-${section.t}`;
    if (!opts.noCard && state.playing && key !== state.lastSectionKey && !state.suppressCards) {
      showTypeCard(section);
    }
    state.lastSectionKey = key;
  }
  const energy = Math.max(activity, (section?.energy || 0) * 0.28);
  els.energy.style.width = `${Math.min(100, energy * 100)}%`;

  const chord = findChord(score, t);
  els.nowChord.textContent = chord?.name || '—';

  const active = activeNotes(score, t);
  const noteText = [];
  for (const { track, notes } of active) {
    for (const n of notes) {
      if (noteText.length >= 5) break;
      if (track.id === 'drums') noteText.push(DRUM_LABELS[n.drum] || '鼓');
      else noteText.push(noteName(n.midi));
    }
  }
  els.nowNotes.textContent = noteText.length ? [...new Set(noteText)].join(' · ') : '—';

  const fx = activeFx(score, t);
  els.fxTags.innerHTML = fx.slice(0, 4).map((k) => `<span class="fx">${FX_LABELS[k] || k}</span>`).join('');

  let loudest = null;
  let loudestVal = 0.05;
  for (const [id, row] of state.rows) {
    const v = state.stage.band.getActivity(id);
    const pct = Math.min(100, v * 110);
    row.meter.style.width = `${pct}%`;
    if (v > loudestVal) { loudestVal = v; loudest = row.track; }
  }
  if (loudest) els.captionTrack.textContent = `${loudest.label} / ${(loudest.instrument || '').toUpperCase()} · LIVE`;

  if (!state.directorOn && state.stage.director.state.auto) {
    state.directorOn = true;
    updateDirectorButton();
  }
  if (state.directorOn && !state.stage.director.state.auto && !state.stage.director.state.holdShot) {
    state.directorOn = false;
    updateDirectorButton();
  }
}

function showTypeCard(section) {
  const meta = SECTION_LABELS[section.label] || SECTION_LABELS.VERSE;
  els.typeSmall.textContent = `SCENE · ${formatTime(section.t)}`;
  els.typeBig.textContent = meta.card;
  els.typeCn.textContent = `${section.label} / ${meta.cn}`;
  els.typeCard.classList.remove('show');
  void els.typeCard.offsetWidth;
  els.typeCard.classList.add('show');
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------------ */
/* 键盘 / 窗口                                                         */
/* ------------------------------------------------------------------ */

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekTo(state.audio.currentTime - 5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      seekTo(state.audio.currentTime + 5);
    } else if (e.key.toLowerCase() === 'm') {
      toggleMv();
    } else if (e.key.toLowerCase() === 'd') {
      state.directorOn = !state.directorOn;
      state.stage.setAuto(state.directorOn);
      updateDirectorButton();
    } else if (e.key === 'Escape') {
      closePlaylist();
      $('#export-menu')?.classList.remove('open');
      if (state.mv) toggleMv(false);
    }
  });
  window.addEventListener('resize', () => state.stage?.resize());
}

function setupDrop() {
  // handled in setupUI
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

let lastFrame = performance.now();
let lastDraw = 0;
let pacingAccum = 0;
let hudTimer = 0;

function loop(now) {
  const raw = Math.min(0.1, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  pacingAccum += raw;

  if (!state.stage || state.uiBusy || document.hidden) {
    requestAnimationFrame(loop);
    return;
  }

  // 用累积器做帧率上限：165Hz / 144Hz 屏幕上也能稳定在约 60fps，而不是固定每 3 帧才画一次。
  const interval = state.playing ? 1000 / 61 : 1000 / 31;
  if (pacingAccum * 1000 < interval) {
    requestAnimationFrame(loop);
    return;
  }

  const dt = Math.min(0.05, Math.max(0.001, (now - lastDraw) / 1000));
  pacingAccum = Math.min(pacingAccum - interval / 1000, interval / 1000);
  lastDraw = now;

  const t = state.audio?.currentTime || 0;
  const levels = state.audio?.getLevels();
  const { shot, activity } = state.stage.update(t, dt, levels);
  state.stage.render();
  hudTimer += dt;
  if (hudTimer > 0.09) {
    updateHUD(t, activity, shot);
    hudTimer = 0;
  }
  requestAnimationFrame(loop);
}

boot();
