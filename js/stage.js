'use strict';

const FONT = "'Noto Sans','Noto Sans SC','Noto Sans JP','Noto Sans KR'," +
  "'Noto Sans Arabic','Noto Sans Devanagari','Noto Sans Tamil'," +
  "'Noto Sans Thai','Noto Sans Hebrew','Noto Serif',sans-serif";

// Easing curves
const easeOut  = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;

class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.W = 360; this.H = 640;

    this.curLines  = []; this.curSize = 72;
    this.curDir    = 'ltr';
    this.curLang   = ''; this.curNative = '';

    this.nxtLines  = []; this.nxtSize = 72;
    this.nxtDir    = 'ltr';
    this.nxtLang   = ''; this.nxtNative = '';

    this.flipP        = 1;
    this.flipDuration = 90;

    this.translations    = [];
    this.currentIndex    = -1;
    this.displayDuration = 200;
    this.elapsed         = 0;
    this.phase           = 'idle';
    this.isPlaying       = false;
    this.isPaused        = false;
    this.isLooping       = false;

    this.rafId  = null;
    this.lastTs = 0;

    this.onLangChange = null;
    this.onComplete   = null;

    this.resize();
  }

  // ── Layout zones ───────────────────────────────────────────────────────────
  // The canvas is split: top 62% is the flip zone, bottom 38% is the label zone.
  // The fold line sits at exactly 50% of the flip zone.
  _flipH()  { return this.H * 0.62; }
  _foldY()  { return this._flipH() / 2; }
  _labelY() { return this._flipH() + (this.H - this._flipH()) * 0.40; }

  // ── Setup ──────────────────────────────────────────────────────────────────
  resize() {
    const dpr  = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.W = Math.max(rect.width,  1);
    this.H = Math.max(rect.height, 1);
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
    const words   = trimmed.split(/\s+/).filter(Boolean);

    if (words.length <= 1) return [trimmed];
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
    if (!text) return { lines: [], fontSize: 60 };
    const flipH    = this._flipH();
    // Conservative padding: 13% each side → 74% of canvas width usable
    const maxW     = this.W * 0.74;
    const maxH     = flipH * 0.70;
    const maxLines = 3;
    const minSize  = 18;
    let size = Math.min(96, Math.floor(flipH * 0.28));

    while (size >= minSize) {
      this.ctx.font = `700 ${size}px ${FONT}`;
      const lines     = this._wrapWords(text, maxW, size);
      // Explicitly verify no line overflows — font metrics can be imprecise
      const maxLineW  = Math.max(...lines.map(l => this.ctx.measureText(l).width));
      const lh        = size * 1.30;
      const blockH    = lines.length > 1 ? (lines.length - 1) * lh + size : size;

      if (maxLineW <= maxW && lines.length <= maxLines && blockH <= maxH) {
        return { lines, fontSize: size };
      }
      size -= 3;
    }
    // Absolute fallback: shrink until single-line fits in width
    let fb = minSize;
    while (fb > 10) {
      this.ctx.font = `700 ${fb}px ${FONT}`;
      const lines = this._wrapWords(text, maxW, fb).slice(0, maxLines);
      const maxW2 = Math.max(...lines.map(l => this.ctx.measureText(l).width));
      if (maxW2 <= maxW) return { lines, fontSize: fb };
      fb -= 2;
    }
    return { lines: [text.slice(0, 24)], fontSize: 10 };
  }

  // ── Loop ───────────────────────────────────────────────────────────────────
  start() {
    if (this.rafId) return;
    this.lastTs = performance.now();
    const tick = ts => {
      const dt = Math.min(ts - this.lastTs, 100);
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
        this.curLines  = this.nxtLines;  this.curSize   = this.nxtSize;
        this.curDir    = this.nxtDir;    this.curLang   = this.nxtLang;
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
      if (this.isLooping) { this.currentIndex = 0; }
      else { this.isPlaying = false; if (this.onComplete) this.onComplete(); return; }
    }
    const item     = this.translations[this.currentIndex];
    const fitted   = this._fitText(item.text);
    this.nxtLines  = fitted.lines;
    this.nxtSize   = fitted.fontSize;
    this.nxtDir    = item.dir || 'ltr';
    this.nxtLang   = item.name;
    this.nxtNative = item.native;
    this.flipP     = 0;
    this.phase     = 'flip';

    if (this.onLangChange) {
      this.onLangChange({ lang: item, index: this.currentIndex, total: this.translations.length });
    }
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  _draw() {
    const { W, H } = this;

    // Rich board background: subtle vertical gradient
    const bg = this.ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#1A1A1A');
    bg.addColorStop(0.5, '#0E0E0E');
    bg.addColorStop(1,   '#080808');
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, W, H);

    if (!this.curLines.length && !this.nxtLines.length) {
      this._drawPlaceholder();
      return;
    }

    if (this.phase === 'flip' && this.flipP < 1) {
      this._drawFlip(this.flipP);
    } else {
      this._drawSettled();
    }

    this._drawVignette();
  }

  _drawSettled() {
    const { W } = this;
    const foldY = this._foldY();

    // Mechanical crease: bright line above fold, shadow line below
    this.ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this.ctx.fillRect(0, foldY - 1, W, 1);
    this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this.ctx.fillRect(0, foldY, W, 1);

    this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
    this._drawLabel(this.curLang, this.curNative, 1, 0);
  }

  _drawFlip(p) {
    const ctx   = this.ctx;
    const { W } = this;
    const foldY = this._foldY();
    const flipH = this._flipH();

    // Crease always visible
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, foldY - 1, W, 1);

    if (p < 0.5) {
      // Phase 1: current top collapses toward fold
      const t     = easeInOut(p / 0.5);   // 0→1
      const scale = 1 - t;

      // Static bottom half — current text
      ctx.save();
      ctx.beginPath(); ctx.rect(0, foldY, W, flipH - foldY); ctx.clip();
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
      ctx.restore();

      // Collapsing top half — current text, darkens as it folds
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, foldY); ctx.clip();
      ctx.translate(0, foldY);
      ctx.scale(1, scale);
      ctx.translate(0, -foldY);
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
      // Darken the flap as it folds (simulates the card turning away from light)
      ctx.fillStyle = `rgba(0,0,0,${t * 0.65})`;
      ctx.fillRect(0, 0, W, foldY);
      ctx.restore();

      // Shadow cast by the folding card onto the bottom half
      const shadowPeak  = Math.sin(t * Math.PI);
      const shadowAlpha = shadowPeak * 0.50;
      const shadowLen   = Math.min(50, flipH * 0.12);
      const sh = ctx.createLinearGradient(0, foldY, 0, foldY + shadowLen);
      sh.addColorStop(0, `rgba(0,0,0,${shadowAlpha})`);
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(0, foldY, W, shadowLen);

      // Bright flash at the crease at the fold moment
      const flash = Math.max(0, 0.15 - Math.abs(p - 0.5)) / 0.15 * 0.30;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        ctx.fillRect(0, foldY - 1, W, 2);
      }

      this._drawLabel(this.curLang, this.curNative, Math.max(0, 1 - t * 2.2), 0);

    } else {
      // Phase 2: next top settled; next bottom expands from fold
      const t     = easeInOut((p - 0.5) / 0.5); // 0→1
      const scale = t;

      // Static top half — next text
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, foldY); ctx.clip();
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, 1);
      ctx.restore();

      // Expanding bottom half — next text, lightens as it opens
      ctx.save();
      ctx.beginPath(); ctx.rect(0, foldY, W, flipH - foldY); ctx.clip();
      ctx.translate(0, foldY);
      ctx.scale(1, scale);
      ctx.translate(0, -foldY);
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, 1);
      // Shadow lifts as the new card opens
      ctx.fillStyle = `rgba(0,0,0,${(1 - t) * 0.55})`;
      ctx.fillRect(0, foldY, W, flipH - foldY);
      ctx.restore();

      // Residual shadow at top of bottom half
      const shadowAlpha = (1 - t) * 0.40;
      if (shadowAlpha > 0.01) {
        const shadowLen = Math.min(50, flipH * 0.12);
        const sh = ctx.createLinearGradient(0, foldY, 0, foldY + shadowLen);
        sh.addColorStop(0, `rgba(0,0,0,${shadowAlpha})`);
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(0, foldY, W, shadowLen);
      }

      // Flash just after flip
      const flash = Math.max(0, 0.15 - Math.abs(p - 0.5)) / 0.15 * 0.30;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        ctx.fillRect(0, foldY - 1, W, 2);
      }

      // Shadow underline for the settled top card
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, foldY, W, 1);

      this._drawLabel(this.nxtLang, this.nxtNative, Math.min(1, t * 2.2), (1 - t) * 5);
    }
  }

  // Draws multi-line text centered vertically around the fold line
  _drawLines(lines, size, dir, centerY, opacity) {
    if (!lines.length || opacity <= 0) return;
    const ctx = this.ctx;
    const lh  = size * 1.30;
    // totalH: total vertical span of the block (top of first line to bottom of last)
    const totalH = lines.length > 1 ? (lines.length - 1) * lh : 0;
    const startY = centerY - totalH / 2;

    ctx.save();
    ctx.globalAlpha  = opacity;
    ctx.font         = `700 ${size}px ${FONT}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = dir;
    // Warm off-white: slightly warmer than pure white for that "lit display" look
    ctx.fillStyle    = '#F5F0E8';

    lines.forEach((line, i) => {
      ctx.fillText(line, this.W / 2, startY + i * lh);
    });
    ctx.restore();
  }

  _drawLabel(lang, native, opacity, slideDown) {
    if (!lang || opacity <= 0) return;
    const ctx    = this.ctx;
    const cx     = this.W / 2;
    const baseY  = this._labelY() + (slideDown || 0);
    const nSize  = Math.max(13, Math.min(20, this.H * 0.031));

    ctx.save();
    ctx.globalAlpha  = opacity;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = 'ltr';

    // Native script name — amber/gold
    ctx.font      = `600 ${nSize}px ${FONT}`;
    ctx.fillStyle = '#F5A623';
    ctx.fillText(native, cx, baseY);

    // English name — dim uppercase caps
    ctx.font      = `500 10px 'Inter', sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.letterSpacing = '0.12em';
    ctx.fillText(lang.toUpperCase(), cx, baseY + nSize + 11);

    ctx.restore();
  }

  _drawPlaceholder() {
    const ctx = this.ctx;
    const cx = this.W / 2;
    const cy = this._foldY();

    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `400 13px 'Inter', sans-serif`;
    ctx.fillStyle    = 'rgba(255,255,255,0.14)';
    ctx.fillText('Your phrase will appear here', cx, cy);
    ctx.restore();
  }

  _drawVignette() {
    const { W, H } = this;
    const ctx = this.ctx;

    // Corner vignette
    const grad = ctx.createRadialGradient(W/2, H/2, H*0.22, W/2, H/2, H*0.90);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(1, 'rgba(0,0,0,0.48)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Top and bottom edge fade
    const topFade = ctx.createLinearGradient(0, 0, 0, H * 0.06);
    topFade.addColorStop(0, 'rgba(0,0,0,0.25)');
    topFade.addColorStop(1, 'transparent');
    ctx.fillStyle = topFade;
    ctx.fillRect(0, 0, W, H * 0.06);

    const btmFade = ctx.createLinearGradient(0, H * 0.94, 0, H);
    btmFade.addColorStop(0, 'transparent');
    btmFade.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = btmFade;
    ctx.fillRect(0, H * 0.94, W, H * 0.06);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  play(translations, totalMs) {
    if (!translations.length) return;
    this.translations = translations;
    this.isPlaying    = true;
    this.isPaused     = false;

    const ms = totalMs || 8000;
    const n  = translations.length;
    // flipDuration: capped at 110ms for very long animations, min ~60ms
    this.flipDuration    = Math.min(110, Math.max(60, Math.floor(ms / n * 0.30)));
    this.displayDuration = Math.floor((ms - this.flipDuration * (n - 1)) / n);

    const first    = translations[0];
    const fitted   = this._fitText(first.text);
    this.curLines  = fitted.lines;
    this.curSize   = fitted.fontSize;
    this.curDir    = first.dir || 'ltr';
    this.curLang   = first.name;
    this.curNative = first.native;
    this.flipP     = 1;
    this.currentIndex = 0;
    this.elapsed   = 0;
    this.phase     = 'display';

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
