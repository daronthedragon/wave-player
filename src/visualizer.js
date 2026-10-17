import { PS3WaveRenderer } from './ps3-wave.js?v=1.2.0';
// Console-style broad silky light surfaces and audio visualizations.
// A media element may only be wrapped once, including across visualizer instances.
const audioGraphs = new WeakMap();
const palettes = {
  blue: ['#020817', '#071a3e', '#103b70', '179,213,255'],
  midnight: ['#020817', '#071a3e', '#103b70', '179,213,255'],
  violet: ['#080516', '#1b123d', '#392662', '216,195,255'],
  purple: ['#080516', '#1b123d', '#392662', '216,195,255'],
  amber: ['#110b05', '#2c1b12', '#523923', '255,225,183'],
  gold: ['#110b05', '#2c1b12', '#523923', '255,225,183'],
  green: ['#020e10', '#062b31', '#14515a', '167,242,229'],
  teal: ['#020e10', '#062b31', '#14515a', '167,242,229'],
  silver: ['#090c13', '#222b3a', '#435366', '227,237,255'],
  black: ['#020304', '#111821', '#273241', '218,229,244'],
};

export class WaveVisualizer {
  constructor(canvas, { audio, getTheme = () => 'blue', getReducedMotion = () => false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    try { this.consoleWave = new PS3WaveRenderer(); } catch { this.consoleWave = null; }
    this.getTheme = getTheme;
    this.getReducedMotion = getReducedMotion;
    this.audio = null;
    this.graph = null;
    this.mode = 'ambient';
    this.running = false;
    this.playing = false;
    this.frame = 0;
    this.phase = 0;
    this.lastTime = 0;
    this.energy = 0;
    this.lowPower = (navigator.deviceMemory || 8) <= 4;
    this.frequency = new Uint8Array(512);
    this.waveform = new Uint8Array(1024);
    this.waveform.fill(128);
    this.onFrame = time => this.tick(time);
    this.onResize = () => this.resize();
    this.onVisibility = () => {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.lastTime = 0;
      if (!document.hidden && this.running) this.frame = requestAnimationFrame(this.onFrame);
    };
    this.onPlay = () => { this.playing = true; if (this.graph) this.resume().catch(() => {}); };
    this.onPause = () => { this.playing = false; };
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.onResize);
      this.observer.observe(canvas);
    }
    this.setAudio(audio);
    this.resize();
  }

  setAudio(audio) {
    if (this.audio === audio) return;
    if (this.audio) {
      this.audio.removeEventListener('play', this.onPlay);
      this.audio.removeEventListener('pause', this.onPause);
      this.audio.removeEventListener('ended', this.onPause);
    }
    this.audio = audio || null;
    this.graph = this.audio ? audioGraphs.get(this.audio) || null : null;
    this.playing = Boolean(this.audio && !this.audio.paused && !this.audio.ended);
    this.audio?.addEventListener('play', this.onPlay);
    this.audio?.addEventListener('pause', this.onPause);
    this.audio?.addEventListener('ended', this.onPause);
  }

  // Call from an explicit user gesture before starting audio playback.
  async resume() {
    if (!this.audio) return false;
    if (!this.graph) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      let graph = audioGraphs.get(this.audio);
      if (!graph) {
        const context = new AudioContext();
        try {
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.84;
          const source = context.createMediaElementSource(this.audio);
          source.connect(analyser);
          analyser.connect(context.destination);
          graph = { context, analyser, source };
          audioGraphs.set(this.audio, graph);
        } catch (error) {
          await context.close();
          throw error;
        }
      }
      this.graph = graph;
    }
    if (this.graph.context.state !== 'running') await this.graph.context.resume();
    return this.graph.context.state === 'running';
  }

  setMode(mode) {
    this.mode = ['ambient', 'wave', 'spectrum', 'orbit'].includes(mode) ? mode : 'ambient';
    this.draw();
  }

  setPlaying(playing) { this.playing = Boolean(playing); }

  start() {
    if (this.running || !this.ctx) return;
    this.running = true;
    this.lastTime = 0;
    this.draw();
    if (!document.hidden) this.frame = requestAnimationFrame(this.onFrame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, bounds.width || window.innerWidth);
    this.height = Math.max(1, bounds.height || window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.25 : 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  tick(time) {
    if (!this.running || document.hidden) return;
    this.frame = requestAnimationFrame(this.onFrame);
    const reduced = Boolean(this.getReducedMotion());
    const elapsed = this.lastTime ? time - this.lastTime : 1000;
    if (elapsed < (reduced ? 150 : this.lowPower ? 32 : 16)) return;
    this.lastTime = time;
    if (!reduced) this.phase += Math.min(elapsed, 64) * 0.00012;
    if (this.graph && this.playing) {
      this.graph.analyser.getByteFrequencyData(this.frequency);
      this.graph.analyser.getByteTimeDomainData(this.waveform);
      let total = 0;
      for (let i = 1; i < 50; i++) total += this.frequency[i];
      this.energy += (total / (49 * 255) - this.energy) * 0.08;
    } else {
      this.energy *= 0.93;
      this.frequency.fill(0);
      this.waveform.fill(128);
    }
    this.draw(reduced);
  }

  draw(reduced = Boolean(this.getReducedMotion())) {
    if (!this.ctx || !this.width) return;
    const { ctx, width: w, height: h } = this;
    const theme = this.getTheme();
    const palette = palettes[typeof theme === 'string' ? theme : theme?.name] || palettes.blue;
    this.tint = palette[3];
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const background = ctx.createLinearGradient(0, h, w * 0.68, 0);
    background.addColorStop(0, palette[0]);
    background.addColorStop(0.55, palette[1]);
    background.addColorStop(1, palette[2]);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.68, h * 0.59, 0, w * 0.68, h * 0.59, w * 0.6);
    glow.addColorStop(0, `rgba(${this.tint},${0.055 + this.energy * 0.03})`);
    glow.addColorStop(1, `rgba(${this.tint},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    if (this.consoleWave) {
      const frame = this.consoleWave.render(w * this.dpr, h * this.dpr, reduced ? 1.6 : this.phase, theme, this.mode === 'wave' ? this.energy : 0);
      if (frame) ctx.drawImage(frame, 0, 0, w, h);
      else this.ribbons(this.mode === 'wave', reduced);
    } else this.ribbons(this.mode === 'wave', reduced);
    if (this.mode === 'spectrum') this.spectrum(reduced);
    if (this.mode === 'orbit') this.orbit(reduced);
    if (!reduced) this.particles();
  }

  ribbonY(x, index, reactive, reduced) {
    const p = x / this.width;
    const t = reduced ? 0.6 : this.phase;
    const amplitude = this.height * (0.052 + (reactive ? this.energy * 0.035 : 0));
    const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
    const sample = reactive && !reduced ? (this.waveform[Math.min(1023, Math.max(0, Math.floor(p * 1023)))] - 128) / 128 : 0;
    return this.height * 0.63
      + Math.sin(p * 5.5 + t * 0.67 + index * 0.037) * amplitude
      + Math.sin(p * 3.6 - t * 0.41 + index * 0.025) * this.height * 0.065
      + Math.sin(p * 8.2 + t * 0.21) * this.height * 0.019
      + index * this.height * 0.0021 * (0.2 + envelope)
      + sample * this.height * 0.055 * envelope;
  }

  ribbons(reactive, reduced) {
    const { ctx, width: w, height: h } = this;
    if (!reactive) {
      // CPU fallback keeps the broad, folded surface when WebGL is unavailable.
      const phase = reduced ? 0.6 : this.phase;
      for (let layer = 2; layer >= 0; layer--) {
        const curve = (x, lower) => {
          const p = x / w;
          const center = h * (0.56 - Math.sin(p * 5.2 + phase * 0.34 + layer * 0.35) * 0.084 - Math.sin(p * 2.9 - phase * 0.2 + layer * 0.22) * 0.042);
          const breadth = h * (0.028 + 0.055 * (0.5 + 0.5 * Math.sin(p * 4.2 - phase * 0.17 + layer * 0.7)));
          return center + (lower ? 0.45 : -0.75) * breadth;
        };
        const surface = ctx.createLinearGradient(0, h * 0.42, 0, h * 0.7);
        surface.addColorStop(0, 'rgba(226,235,250,.3)');
        surface.addColorStop(0.45, 'rgba(183,196,215,.16)');
        surface.addColorStop(1, 'rgba(150,166,191,.01)');
        ctx.beginPath();
        ctx.moveTo(-12, curve(-12, false));
        for (let x = 0; x <= w + 12; x += 12) ctx.lineTo(x, curve(x, false));
        for (let x = w + 12; x >= -12; x -= 12) ctx.lineTo(x, curve(x, true));
        ctx.closePath();ctx.fillStyle = surface;ctx.fill();
        ctx.beginPath();ctx.moveTo(-12, curve(-12, false));
        for (let x = 0; x <= w + 12; x += 12) ctx.lineTo(x, curve(x, false));
        ctx.strokeStyle = 'rgba(222,233,249,.2)';ctx.lineWidth = 0.7;ctx.stroke();
      }
      return;
    }
    const count = this.lowPower ? 22 : 38;
    const step = reactive ? 5 : 12;
    ctx.globalCompositeOperation = 'screen';
    const shine = ctx.createLinearGradient(0, 0, w, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0)');
    shine.addColorStop(0.22, `rgba(${this.tint},0.13)`);
    shine.addColorStop(0.54, `rgba(235,245,255,${reactive ? 0.45 : 0.31})`);
    shine.addColorStop(0.79, `rgba(${this.tint},0.23)`);
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 12) {
      const y = this.ribbonY(x, 0, false, reduced);
      if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let x = w + 20; x >= -20; x -= 12) ctx.lineTo(x, this.ribbonY(x, count, false, reduced));
    ctx.closePath();
    ctx.fillStyle = shine;
    ctx.globalAlpha = 0.09;
    ctx.fill();
    for (let i = 0; i < count; i++) {
      ctx.beginPath();
      for (let x = -step; x <= w + step; x += step) {
        const y = this.ribbonY(x, i, reactive, reduced);
        if (x === -step) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = shine;
      ctx.globalAlpha = i === 0 ? 0.9 : (0.13 + 0.36 * Math.pow(1 - i / count, 3));
      ctx.lineWidth = i === 0 ? 1.15 : 0.65;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  spectrum(reduced) {
    const { ctx, width: w, height: h } = this;
    const count = this.lowPower ? 64 : 96;
    const left = w * 0.16, span = w * 0.68, base = h * 0.81;
    const gap = span / count;
    const gradient = ctx.createLinearGradient(0, base - h * 0.25, 0, base + h * 0.05);
    gradient.addColorStop(0, 'rgba(247,251,255,.85)');
    gradient.addColorStop(0.72, `rgba(${this.tint},.42)`);
    gradient.addColorStop(1, `rgba(${this.tint},0)`);
    ctx.fillStyle = gradient;
    for (let i = 0; i < count; i++) {
      const bin = Math.floor(Math.pow(i / count, 1.65) * 340) + 1;
      const value = reduced ? 0 : this.frequency[bin] / 255;
      const bar = 2 + Math.pow(value, 1.6) * h * 0.24;
      ctx.globalAlpha = Math.sin((i + 1) / (count + 1) * Math.PI) * 0.8;
      ctx.fillRect(left + i * gap, base - bar, Math.max(1.5, gap * 0.27), bar);
      ctx.globalAlpha *= 0.15;
      ctx.fillRect(left + i * gap, base + 5, Math.max(1.5, gap * 0.27), bar * 0.2);
    }
    ctx.globalAlpha = 1;
  }

  orbit(reduced) {
    const { ctx, width: w, height: h } = this;
    const radius = Math.min(w * 0.19, h * 0.24);
    const cx = w * 0.7, cy = h * 0.59;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.24);
    ctx.globalCompositeOperation = 'screen';
    for (let ring = 0; ring < 7; ring++) {
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const angle = i / 240 * Math.PI * 2;
        const bin = Math.floor((1 - Math.cos(angle)) * 90) + 1;
        const value = reduced ? 0 : this.frequency[bin] / 255;
        const r = radius + ring * 2.4 + value * radius * 0.17
          + Math.sin(angle * 3 + (reduced ? 0 : this.phase)) * radius * 0.035;
        const x = Math.cos(angle) * r, y = Math.sin(angle) * r * 0.7;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.lineWidth = ring === 0 ? 1.5 : 0.65;
      ctx.strokeStyle = `rgba(${this.tint},${ring === 0 ? 0.65 : 0.22 - ring * 0.023})`;
      ctx.stroke();
    }
    ctx.restore();
  }

  particles() {
    const { ctx, width: w, height: h } = this;
    const count = this.lowPower ? 14 : 26;
    for (let i = 0; i < count; i++) {
      const seed = Math.sin(i * 127.1 + 31.7) * 43758.5453;
      const fraction = seed - Math.floor(seed);
      const x = ((fraction * w + this.phase * (i % 3 + 1) * 3) % (w + 40)) - 20;
      const y = h * (0.28 + (i * 0.173 % 0.66)) + Math.sin(this.phase * 0.5 + i) * 9;
      const opacity = 0.06 + (1 + Math.sin(i * 2 + this.phase)) * 0.06;
      ctx.fillStyle = `rgba(${this.tint},${opacity})`;
      ctx.beginPath();
      ctx.arc(x, y, i % 6 === 0 ? 1.15 : 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  destroy() {
    this.stop();
    this.observer?.disconnect();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.setAudio(null);
    this.consoleWave?.destroy();
    // Keep the element's graph alive: closing it would permanently silence that
    // media element. WeakMap ownership permits reuse without a second source.
  }
}
