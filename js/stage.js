'use strict';
// ─── Easing ──────────────────────────────────────────────────────────────────
const easeOutCubic  = t => 1 - Math.pow(1 - t, 3);
const easeInCubic   = t => t * t * t;
const easeOutBack   = t => { const c = 1.70158 + 1; return 1 + c * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); };
const easeOutElastic = t => {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
};

// ─── Font stack (covers virtually every script) ──────────────────────────────
const FONT_STACK = "'Noto Sans', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', " +
  "'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans Tamil', " +
  "'Noto Sans Thai', 'Noto Sans Hebrew', 'Noto Serif', sans-serif";

// ─── Transition definitions ───────────────────────────────────────────────────
// Each transition: enter(p) / exit(p) → {x, y, opacity, scale, rotation, blur}
const TRANSITIONS = [
  {
    name: 'rise',
    enter: p => ({ x: 0, y: (1 - easeOutBack(p)) * 80,  opacity: Math.min(1, p * 2),   scale: 1,                           rotation: 0,                      blur: 0 }),
    exit:  p => ({ x: 0, y: -easeInCubic(p) * 70,        opacity: 1 - easeInCubic(p),   scale: 1,                           rotation: 0,                      blur: 0 }),
  },
  {
    name: 'zoom',
    enter: p => ({ x: 0, y: 0,                            opacity: easeOutCubic(p),       scale: 0.08 + 0.92 * easeOutBack(p), rotation: 0,                     blur: 0 }),
    exit:  p => ({ x: 0, y: 0,                            opacity: 1 - easeInCubic(p),   scale: 1 + 0.7 * easeInCubic(p),    rotation: 0,                     blur: 0 }),
  },
  {
    name: 'slide-l',
    enter: p => ({ x: (1 - easeOutCubic(p)) * 450, y: 0, opacity: easeOutCubic(p),       scale: 1,                           rotation: 0,                      blur: 0 }),
    exit:  p => ({ x: -easeInCubic(p) * 450,        y: 0, opacity: 1 - easeInCubic(p),  scale: 1,                           rotation: 0,                      blur: 0 }),
  },
  {
    name: 'blur',
    enter: p => ({ x: 0, y: 0,                            opacity: easeOutCubic(p),       scale: 1 + (1 - easeOutCubic(p)) * 0.12, rotation: 0,                blur: (1 - easeOutCubic(p)) * 32 }),
    exit:  p => ({ x: 0, y: 0,                            opacity: 1 - easeInCubic(p),   scale: 1,                               rotation: 0,                blur: easeInCubic(p) * 32 }),
  },
  {
    name: 'tilt',
    enter: p => ({ x: 0, y: (1 - easeOutCubic(p)) * 60,  opacity: easeOutCubic(p),       scale: 1,                           rotation: (1 - easeOutCubic(p)) * -0.28, blur: 0 }),
    exit:  p => ({ x: 0, y: -easeInCubic(p) * 60,         opacity: 1 - easeInCubic(p),  scale: 1,                           rotation: easeInCubic(p) * 0.28,        blur: 0 }),
  },
  {
    name: 'expand',
    enter: p => ({ x: 0, y: 0,                            opacity: easeOutCubic(p),       scale: 1.9 - 0.9 * easeOutCubic(p), rotation: 0,                    blur: 0 }),
    exit:  p => ({ x: 0, y: 0,                            opacity: 1 - easeInCubic(p),   scale: 1 - 0.6 * easeInCubic(p),    rotation: 0,                    blur: 0 }),
  },
  {
    name: 'slide-r',
    enter: p => ({ x: -(1 - easeOutCubic(p)) * 450, y: 0, opacity: easeOutCubic(p),      scale: 1,                           rotation: 0,                      blur: 0 }),
    exit:  p => ({ x: easeInCubic(p) * 450,          y: 0, opacity: 1 - easeInCubic(p), scale: 1,                           rotation: 0,                      blur: 0 }),
  },
  {
    name: 'cascade',
    enter: p => ({ x: 0, y: -(1 - easeOutElastic(p)) * 110, opacity: Math.min(1, p * 3.5), scale: 1,                        rotation: 0,                      blur: 0 }),
    exit:  p => ({ x: 0, y: easeInCubic(p) * 90,            opacity: 1 - easeInCubic(p),  scale: 1,                        rotation: 0,                      blur: 0 }),
  },
];

// ─── Stage class ──────────────────────────────────────────────────────────────
class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    // Logical dimensions (before dpr)
    this.W = window.innerWidth;
    this.H = window.innerHeight;

    // Playback
    this.isPlaying = false;
    this.isPaused  = false;
    this.isLooping = true;

    // Current item
    this.translations  = [];
    this.currentIndex  = -1;
    this.transType     = 0;   // cycles through TRANSITIONS
    this.elapsed       = 0;   // ms within current item
    this.phase         = 'enter';

    // Durations (ms)
    this.ENTER_DUR = 700;
    this.HOLD_DUR  = 2400;
    this.EXIT_DUR  = 600;

    // Visual state
    this.bgHue      = 220;
    this.targetHue  = 220;
    this.curColor   = 'hsl(220,80%,70%)';
    this.curText    = '';
    this.curName    = '';
    this.curNative  = '';
    this.curDir     = 'ltr';
    this.fontSize   = 72;
    this.labelSize  = 20;

    // Glitch jitter (pre-computed, refreshed periodically)
    this.jX = 0; this.jY = 0; this.jNext = 0;

    // Aurora seed
    this.seed = Math.random() * 1000;

    // Particles
    this.particles = [];

    // Ripple ring (plays on each new language)
    this.rippleR   = 0;
    this.rippleMax = 0;
    this.rippleAlpha = 0;

    // Callbacks
    this.onLangChange = null;
    this.onEnd        = null;

    // RAF
    this.rafId  = null;
    this.lastTs = 0;

    this.resize();
    this._initParticles();
  }

  // ── Setup ──────────────────────────────────────────────────────────────────
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width  = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width  = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this._initParticles();
  }

  _initParticles() {
    this.particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * this.W,
      y: Math.random() * this.H,
      r: Math.random() * 1.8 + 0.3,
      vx: (Math.random() - 0.5) * 0.55,
      vy: (Math.random() - 0.5) * 0.55,
      op: Math.random() * 0.45 + 0.05,
      dh: Math.random() * 90 - 45,
    }));
  }

  // ── Loop ───────────────────────────────────────────────────────────────────
  start() {
    if (this.rafId) return;
    this.lastTs = performance.now();
    const tick = ts => {
      const dt = Math.min(ts - this.lastTs, 100);
      this.lastTs = ts;
      this._update(dt, ts);
      this._draw(ts);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  _update(dt, ts) {
    // Smooth hue
    this.bgHue += (this.targetHue - this.bgHue) * 0.025;

    // Particles
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -5) p.x = this.W + 5; else if (p.x > this.W + 5) p.x = -5;
      if (p.y < -5) p.y = this.H + 5; else if (p.y > this.H + 5) p.y = -5;
    }

    // Glitch jitter refresh
    if (ts > this.jNext) {
      this.jX = (Math.random() - 0.5) * 18;
      this.jY = (Math.random() - 0.5) * 9;
      this.jNext = ts + 35 + Math.random() * 90;
    }

    // Ripple
    if (this.rippleAlpha > 0) {
      this.rippleR    += dt * 0.35;
      this.rippleAlpha = Math.max(0, this.rippleAlpha - dt * 0.0015);
    }

    // Animation
    if (this.isPlaying && !this.isPaused) {
      this.elapsed += dt;
      this._advancePhase();
    }
  }

  _advancePhase() {
    const { ENTER_DUR, HOLD_DUR, EXIT_DUR, elapsed } = this;
    const total = ENTER_DUR + HOLD_DUR + EXIT_DUR;
    if      (elapsed < ENTER_DUR)               this.phase = 'enter';
    else if (elapsed < ENTER_DUR + HOLD_DUR)    this.phase = 'hold';
    else if (elapsed < total)                   this.phase = 'exit';
    else {
      this.elapsed = 0;
      this._advance();
    }
  }

  _phaseProgress() {
    const { ENTER_DUR, HOLD_DUR, EXIT_DUR, elapsed } = this;
    if (elapsed < ENTER_DUR) return elapsed / ENTER_DUR;
    if (elapsed < ENTER_DUR + HOLD_DUR) return (elapsed - ENTER_DUR) / HOLD_DUR;
    return (elapsed - ENTER_DUR - HOLD_DUR) / EXIT_DUR;
  }

  _advance() {
    this.currentIndex++;
    if (this.currentIndex >= this.translations.length) {
      if (this.isLooping) {
        this.currentIndex = 0;
      } else {
        this.isPlaying = false;
        if (this.onEnd) this.onEnd();
        return;
      }
    }
    this._applyCurrent();
    this.transType = (this.transType + 1) % TRANSITIONS.length;
  }

  _applyCurrent() {
    const item = this.translations[this.currentIndex];
    if (!item) return;

    this.curText   = item.text;
    this.curName   = item.name;
    this.curNative = item.native;
    this.curDir    = item.dir || 'ltr';

    const hue = (this.currentIndex * 360 / Math.max(1, this.translations.length)) % 360;
    this.curColor  = `hsl(${hue},85%,68%)`;
    this.targetHue = hue;

    this.fontSize = this._computeFontSize(item.text);

    // Trigger ripple
    this.rippleR     = this.fontSize * 0.6;
    this.rippleMax   = Math.min(this.W, this.H) * 0.7;
    this.rippleAlpha = 0.5;

    if (this.onLangChange) {
      this.onLangChange({ lang: item, index: this.currentIndex, total: this.translations.length, color: this.curColor });
    }
  }

  _computeFontSize(text) {
    const ctx = this.ctx;
    const maxW = this.W * 0.88;
    let size = Math.min(130, Math.floor(this.H * 0.22));
    while (size > 20) {
      ctx.font = `700 ${size}px ${FONT_STACK}`;
      if (ctx.measureText(text).width <= maxW) break;
      size -= 3;
    }
    return size;
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  _draw(ts) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawBackground(ts);
    this._drawParticles();

    if (this.isPlaying && this.curText) {
      const tf = this._getTransform();
      this._drawRipple(tf.opacity);
      this._drawMainText(tf, ts);
      this._drawLabel(tf.opacity);
    }
  }

  _drawBackground(ts) {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const t = ts * 0.001 + this.seed;

    ctx.fillStyle = '#060612';
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'screen';

    const blobs = [
      { bx: 0.22, by: 0.28, ax: 0.14, ay: 0.10, r: 0.58, dh: 0   },
      { bx: 0.78, by: 0.65, ax: 0.11, ay: 0.14, r: 0.62, dh: 65  },
      { bx: 0.12, by: 0.78, ax: 0.13, ay: 0.07, r: 0.46, dh: 145 },
      { bx: 0.88, by: 0.22, ax: 0.09, ay: 0.12, r: 0.52, dh: 215 },
      { bx: 0.50, by: 0.48, ax: 0.07, ay: 0.07, r: 0.34, dh: 305 },
    ];

    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const x = (b.bx + b.ax * Math.sin(t * 0.38 + i * 1.35)) * W;
      const y = (b.by + b.ay * Math.cos(t * 0.29 + i * 1.71)) * H;
      const r = b.r * Math.min(W, H);
      const hue = (this.bgHue + b.dh) % 360;

      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0,   `hsla(${hue},72%,55%,0.24)`);
      g.addColorStop(0.45,`hsla(${hue},60%,45%,0.10)`);
      g.addColorStop(1,   'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  _drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.bgHue + p.dh},70%,80%,${p.op})`;
      ctx.fill();
    }
  }

  _drawRipple(opacity) {
    if (this.rippleAlpha <= 0) return;
    const ctx = this.ctx;
    const cx = this.W / 2, cy = this.H / 2;
    const alpha = this.rippleAlpha * opacity;
    ctx.beginPath();
    ctx.arc(cx, cy, this.rippleR, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${this.bgHue},80%,75%,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _getTransform() {
    const tr = TRANSITIONS[this.transType % TRANSITIONS.length];
    const p  = Math.min(1, Math.max(0, this._phaseProgress()));
    if (this.phase === 'enter') return tr.enter(p);
    if (this.phase === 'exit')  return tr.exit(p);
    return tr.enter(1); // hold = settled state
  }

  _drawMainText({ x, y, opacity, scale, rotation, blur }) {
    if (opacity <= 0.002) return;
    const ctx = this.ctx;
    const cx  = this.W / 2;
    const cy  = this.H / 2 - this.fontSize * 0.15;

    const tr = TRANSITIONS[this.transType % TRANSITIONS.length];
    // Glitch offsets only during enter/exit
    const gx = (tr.name === 'glitch' && this.phase !== 'hold')
      ? this.jX * (1 - Math.min(1, this._phaseProgress())) : 0;
    const gy = (tr.name === 'glitch' && this.phase !== 'hold')
      ? this.jY * (1 - Math.min(1, this._phaseProgress())) : 0;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
    if (blur > 0.8) ctx.filter = `blur(${blur.toFixed(1)}px)`;

    ctx.translate(cx + x + gx, cy + y + gy);
    ctx.rotate(rotation || 0);
    ctx.scale(scale || 1, scale || 1);
    ctx.direction = this.curDir;

    ctx.font = `700 ${this.fontSize}px ${FONT_STACK}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Subtle hold-phase pulse on glow
    const pulse = this.phase === 'hold'
      ? 30 + 20 * (Math.sin(performance.now() * 0.0018) * 0.5 + 0.5)
      : 50;

    ctx.shadowColor = this.curColor;
    ctx.shadowBlur  = pulse;
    ctx.fillStyle   = '#ffffff';
    ctx.fillText(this.curText, 0, 0);

    ctx.shadowBlur  = 0;
    ctx.fillText(this.curText, 0, 0);

    ctx.filter = 'none';
    ctx.restore();
  }

  _drawLabel(opacity) {
    if (opacity <= 0.01) return;
    const ctx  = this.ctx;
    const cx   = this.W / 2;
    const cy   = this.H / 2 + this.fontSize * 0.72;
    const fade = Math.min(1, opacity * 2.2); // label appears quickly

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, fade));
    ctx.direction   = 'ltr';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';

    // Native name
    ctx.font        = `400 ${this.labelSize + 6}px ${FONT_STACK}`;
    ctx.shadowColor = this.curColor;
    ctx.shadowBlur  = 18;
    ctx.fillStyle   = this.curColor;
    ctx.fillText(this.curNative, cx, cy);

    // English name
    ctx.font        = `300 ${this.labelSize}px 'Inter', sans-serif`;
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,255,0.45)';
    ctx.fillText(this.curName, cx, cy + this.labelSize * 2);

    ctx.restore();
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  play(translations) {
    this.translations  = translations;
    this.currentIndex  = -1;
    this.transType     = 0;
    this.elapsed       = 0;
    this.phase         = 'enter';
    this.isPlaying     = true;
    this.isPaused      = false;
    this._advance();
  }

  pause()  { this.isPaused = true;  }
  resume() { this.isPaused = false; }

  halt() {
    this.isPlaying = false;
    this.isPaused  = false;
    this.curText   = '';
    this.translations = [];
    this.currentIndex = -1;
    this.targetHue = 220;
    this.rippleAlpha = 0;
  }

  setLoop(v) { this.isLooping = v; }

  setSpeed(multiplier) {
    const base = [700, 2400, 600];
    this.ENTER_DUR = base[0] / multiplier;
    this.HOLD_DUR  = base[1] / multiplier;
    this.EXIT_DUR  = base[2] / multiplier;
  }
}
