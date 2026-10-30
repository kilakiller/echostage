/**
 * Web Audio 播放引擎：时钟、分析器、音量、拖动。
 */

export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.82;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.offset = 0;
    this.startedAt = 0;
    this.levels = new Float32Array(64);
    this._byte = new Uint8Array(this.analyser.frequencyBinCount);
    this.onEnded = null;
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  setPcm(left, right, sampleRate) {
    const buffer = this.ctx.createBuffer(2, left.length, sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    this.setBuffer(buffer);
    return buffer;
  }

  setBuffer(buffer) {
    this.pause();
    this.buffer = buffer;
    this.offset = 0;
  }

  async decode(arrayBuffer) {
    const copy = arrayBuffer.slice(0);
    const buffer = await this.ctx.decodeAudioData(copy);
    this.setBuffer(buffer);
    return buffer;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  get currentTime() {
    if (!this.buffer) return 0;
    if (this.playing) {
      return Math.min(this.buffer.duration, Math.max(0, this.ctx.currentTime - this.startedAt));
    }
    return this.offset;
  }

  play(from = this.offset) {
    if (!this.buffer) return;
    this.pause();
    const start = Math.max(0, Math.min(this.buffer.duration - 0.01, from));
    this.offset = start;
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gain);
    this.source.onended = () => {
      if (!this.playing) return;
      if (Math.abs(this.currentTime - this.buffer.duration) < 0.08) {
        this.playing = false;
        this.offset = this.buffer.duration;
        this.source = null;
        this.onEnded?.();
      }
    };
    this.startedAt = this.ctx.currentTime - start;
    this.playing = true;
    this.source.start(0, start);
  }

  pause() {
    if (this.source) {
      this.offset = this.currentTime;
      this.playing = false;
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    } else {
      this.playing = false;
    }
  }

  seek(t) {
    const clamped = Math.max(0, Math.min(this.duration, t));
    if (this.playing) {
      this.play(clamped);
    } else {
      this.offset = clamped;
    }
  }

  setVolume(v) {
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.02);
  }

  getLevels() {
    if (!this.analyser) return this.levels;
    this.analyser.getByteFrequencyData(this._byte);
    for (let i = 0; i < this.levels.length; i++) {
      const idx = Math.floor((i / this.levels.length) * this._byte.length);
      this.levels[i] = this._byte[idx] / 255;
    }
    return this.levels;
  }
}
