'use strict';

// ── Font stack covers virtually every writing system ──────────────────────────
const FONT = "'Noto Sans','Noto Sans SC','Noto Sans JP','Noto Sans KR'," +
  "'Noto Sans Arabic','Noto Sans Devanagari','Noto Sans Tamil'," +
  "'Noto Sans Thai','Noto Sans Hebrew','Noto Serif',sans-serif";

// ── Easing ────────────────────────────────────────────────────────────────────
const easeInOut = t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t;

// ── Split-Flap Board ──────────────────────────────────────────────────────────
class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.W = 360; this.H = 640;

    // Current settled state
    this.curLines  = [];
    this.curSize   = 72;
    this.curDir    = 'ltr';
    this.curLang   = '';
    this.curNative = '';

    // Queued next state (during flip)
    this.nxtLines  = [];
    this.nxtSize   = 72;
    this.nxtDir    = 'ltr';
    this.nxtLang   = '';
    this.nxtNative = '';

    // Flip animation
    this.flipP        = 1;   // 0→1, 1 = settled
    this.flipDuration = 90;  // ms

    // Playback
    this.translations    = [];
    this.currentIndex    = -1;
    this.displayDuration = 200;
    this.elapsed         = 0;
    this.phase           = 'idle';
    this.isPlaying       = false;
    this.isPaused        = false;
    this.isLooping       = false;

    // RAF
    this.rafId  = null;
    this.lastTs = 0;

    // Callbacks
    this.onLangChange = null;
    this.onComplete   = null;

    this.resize();
  }

  // ── Layout helpers ─────────────────────────────────────────────────────────
  // Flip zone: top 65% of canvas
  _flipH()  { return this.H * 0.65; }
  // Fold line: middle of flip zone
  _foldY()  { return this._flipH() / 2; }
  // Label zone: centered in the bottom 35%
  _labelY() { return this._flipH() + (this.H - this._flipH()) * 0.38; }

  // ── Setup ──────────────────────────────────────────────────────────────────
  resize() {
    const dpr  = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.W = rect.width  || 360;
    this.H = rect.height || 640;
    this.canvas.width  = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width  = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── Text fitting ───────────────────────────────────────────────────────────
  _wrapWords(text, maxW, size) {
    const ctx = this.ctx;
    ctx.font = `700 ${size}px ${FONT}`;
    const trimmed = text.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);

    // Single token (CJK, compound word, etc.)
    if (words.length <= 1) return [trimmed];
    // Fits on one line
    if (ctx.measureText(trimmed).width <= maxW) return [trimmed];

    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width <= maxW) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  _fitText(text) {
    if (!text) return { lines: [], fontSize: 72 };
    const flipH    = this._flipH();
    const maxW     = this.W * 0.84;
    const maxH     = flipH * 0.72;
    const maxLines = 3;
    const minSize  = 18;
    let size = Math.min(100, Math.floor(flipH * 0.30));

    while (size >= minSize) {
      const lines   = this._wrapWords(text, maxW, size);
      const lh      = size * 1.32;
      const totalH  = lines.length > 1 ? (lines.length - 1) * lh + size : size;
      if (lines.length <= maxLines && totalH <= maxH) return { lines, fontSize: size };
      size -= 3;
    }
    const lines = this._wrapWords(text, maxW, minSize).slice(0, maxLines);
    return { lines, fontSize: minSize };
  }

  // ── Loop ───────────────────────────────────────────────────────────────────
  start() {
    if (this.rafId) return;
    this.lastTs = performance.now();
    const tick = ts => {
      const dt = Math.min(ts - this.lastTs, 120);
      this.lastTs = ts;
      this._update(dt);
      this._draw();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  _update(dt) {
    if (!this.isPlaying || this.isPaused) return;
    this.elapsed += dt;

    if (this.phase === 'flip') {
      if (this.elapsed >= this.flipDuration) {
        this.curLines  = this.nxtLines;
        this.curSize   = this.nxtSize;
        this.curDir    = this.nxtDir;
        this.curLang   = this.nxtLang;
        this.curNative = this.nxtNative;
        this.flipP     = 1;
        this.elapsed  -= this.flipDuration;
        this.phase     = 'display';
      } else {
        this.flipP = this.elapsed / this.flipDuration;
      }
    } else if (this.phase === 'display') {
      if (this.elapsed >= this.displayDuration) {
        this.elapsed -= this.displayDuration;
        this._advance();
      }
    }
  }

  _advance() {
    this.currentIndex++;
    if (this.currentIndex >= this.translations.length) {
      if (this.isLooping) {
        this.currentIndex = 0;
      } else {
        this.isPlaying = false;
        if (this.onComplete) this.onComplete();
        return;
      }
    }
    const item      = this.translations[this.currentIndex];
    const fitted    = this._fitText(item.text);
    this.nxtLines   = fitted.lines;
    this.nxtSize    = fitted.fontSize;
    this.nxtDir     = item.dir || 'ltr';
    this.nxtLang    = item.name;
    this.nxtNative  = item.native;
    this.flipP      = 0;
    this.phase      = 'flip';

    if (this.onLangChange) {
      this.onLangChange({ lang: item, index: this.currentIndex, total: this.translations.length });
    }
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  _draw() {
    const ctx = this.ctx;
    const { W, H } = this;
    const isDark = document.documentElement.dataset.theme === 'dark';

    ctx.fillStyle = isDark ? '#0D0D0D' : '#131313';
    ctx.fillRect(0, 0, W, H);

    if (!this.curLines.length && !this.nxtLines.length) {
      this._drawPlaceholder();
      return;
    }

    const flipping = this.phase === 'flip' && this.flipP < 1;
    if (flipping) {
      this._drawFlip(this.flipP);
    } else {
      this._drawSettled();
    }

    this._drawVignette(W, H);
  }

  _drawSettled() {
    const { W } = this;
    const foldY = this._foldY();

    // Fold line hint
    this.ctx.fillStyle = 'rgba(255,255,255,0.05)';
    this.ctx.fillRect(0, foldY - 0.5, W, 1);

    this._drawLines(this.curLines, this.curSize, this.curDir, foldY, '#F0F0F0', 1);
    this._drawLabel(this.curLang, this.curNative, 1);
  }

  _drawFlip(p) {
    const ctx   = this.ctx;
    const { W } = this;
    const foldY = this._foldY();
    const flipH = this._flipH();

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, foldY - 0.5, W, 1);

    if (p < 0.5) {
      // Phase 1: current top collapses toward fold
      const t     = easeInOut(p / 0.5);
      const scale = 1 - t;

      // Static bottom half — current
      ctx.save();
      ctx.beginPath(); ctx.rect(0, foldY, W, flipH - foldY); ctx.clip();
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, '#F0F0F0', 1);
      ctx.restore();

      // Collapsing top half — current, pivoted at foldY
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, foldY); ctx.clip();
      ctx.translate(0, foldY);
      ctx.scale(1, scale);
      ctx.translate(0, -foldY);
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, '#F0F0F0', 1);
      ctx.restore();

      // Flash at crease
      const flash = Math.max(0, 0.18 - Math.abs(p - 0.5)) / 0.18 * 0.22;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        ctx.fillRect(0, foldY - 1, W, 2);
      }

      this._drawLabel(this.curLang, this.curNative, Math.max(0, 1 - t * 2));

    } else {
      // Phase 2: next top settled; next bottom expands from fold
      const t     = easeInOut((p - 0.5) / 0.5);
      const scale = t;

      // Static top half — next
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, foldY); ctx.clip();
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, '#F0F0F0', 1);
      ctx.restore();

      // Expanding bottom half — next, pivoted at foldY
      ctx.save();
      ctx.beginPath(); ctx.rect(0, foldY, W, flipH - foldY); ctx.clip();
      ctx.translate(0, foldY);
      ctx.scale(1, scale);
      ctx.translate(0, -foldY);
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, '#F0F0F0', 1);
      ctx.restore();

      // Flash just after flip
      const flash = Math.max(0, 0.18 - Math.abs(p - 0.5)) / 0.18 * 0.22;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        ctx.fillRect(0, foldY - 1, W, 2);
      }

      this._drawLabel(this.nxtLang, this.nxtNative, Math.min(1, t * 2));
    }
  }

  // Draw multi-line text centered vertically around centerY (the fold line)
  _drawLines(lines, size, dir, centerY, color, opacity) {
    if (!lines.length || opacity <= 0) return;
    const ctx = this.ctx;
    const lh  = size * 1.32;
    const totalH = lines.length > 1 ? (lines.length - 1) * lh : 0;
    const startY = centerY - totalH / 2;

    ctx.save();
    ctx.globalAlpha  = opacity;
    ctx.font         = `700 ${size}px ${FONT}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = dir;
    ctx.fillStyle    = color;

    lines.forEach((line, i) => {
      ctx.fillText(line, this.W / 2, startY + i * lh);
    });

    ctx.restore();
  }

  _drawLabel(lang, native, opacity) {
    if (!lang || opacity <= 0) return;
    const ctx   = this.ctx;
    const cx    = this.W / 2;
    const baseY = this._labelY();
    const nativeSize = Math.max(13, Math.min(22, this.H * 0.034));

    ctx.save();
    ctx.globalAlpha  = opacity;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = 'ltr';

    // Native name — amber
    ctx.font      = `500 ${nativeSize}px ${FONT}`;
    ctx.fillStyle = '#F5A623';
    ctx.fillText(native, cx, baseY);

    // English name — dim white
    ctx.font         = `500 11px 'Inter', sans-serif`;
    ctx.fillStyle    = 'rgba(255,255,255,0.32)';
    ctx.letterSpacing = '0.08em';
    ctx.fillText(lang.toUpperCase(), cx, baseY + nativeSize + 10);

    ctx.restore();
  }

  _drawPlaceholder() {
    const ctx = this.ctx;
    const cx = this.W / 2, cy = this.H * 0.42;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `400 15px 'Inter', sans-serif`;
    ctx.fillStyle    = 'rgba(255,255,255,0.18)';
    ctx.fillText('Type a phrase above to begin', cx, cy);
    ctx.restore();
  }

  _drawVignette(W, H) {
    const ctx  = this.ctx;
    // Soft vignette on all four edges
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  play(translations) {
    if (!translations.length) return;
    this.translations = translations;
    this.isPlaying    = true;
    this.isPaused     = false;

    // 5-second clip
    const totalMs = 5000;
    const n       = translations.length;
    this.flipDuration    = Math.min(90, Math.floor(totalMs / n * 0.32));
    this.displayDuration = Math.floor((totalMs - this.flipDuration * (n - 1)) / n);

    // Show first item immediately (no flip)
    const first     = translations[0];
    const fitted    = this._fitText(first.text);
    this.curLines   = fitted.lines;
    this.curSize    = fitted.fontSize;
    this.curDir     = first.dir || 'ltr';
    this.curLang    = first.name;
    this.curNative  = first.native;
    this.flipP      = 1;
    this.currentIndex = 0;
    this.elapsed    = 0;
    this.phase      = 'display';

    if (this.onLangChange) {
      this.onLangChange({ lang: first, index: 0, total: n });
    }
  }

  pause()  { this.isPaused = true;  }
  resume() { this.isPaused = false; }

  halt() {
    this.isPlaying    = false;
    this.isPaused     = false;
    this.curLines     = [];
    this.translations = [];
    this.currentIndex = -1;
    this.phase        = 'idle';
  }

  setLoop(v) { this.isLooping = v; }
}
