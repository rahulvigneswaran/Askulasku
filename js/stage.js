'use strict';

// Font stack: Syne (beautiful Latin), Space Grotesk (fallback Latin),
// then Noto for every other writing system on the planet.
const FONT = "'Syne','Space Grotesk','Noto Sans','Noto Sans SC','Noto Sans JP'," +
  "'Noto Sans KR','Noto Sans Arabic','Noto Sans Devanagari','Noto Sans Tamil'," +
  "'Noto Sans Thai','Noto Sans Hebrew','Noto Serif',sans-serif";

const FONT_CSS = "'Syne','Space Grotesk','Noto Sans','Noto Sans SC','Noto Sans JP'," +
  "'Noto Sans KR','Noto Sans Arabic','Noto Sans Devanagari','Noto Sans Tamil'," +
  "'Noto Sans Thai','Noto Sans Hebrew','Noto Serif',sans-serif";

// Easing
const easeInOut3 = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;

class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.W = 360; this.H = 640;

    // Current settled state
    this.curLines  = []; this.curSize   = 72;
    this.curDir    = 'ltr';
    this.curLang   = ''; this.curNative = '';

    // Next state (during transition)
    this.nxtLines  = []; this.nxtSize   = 72;
    this.nxtDir    = 'ltr';
    this.nxtLang   = ''; this.nxtNative = '';

    // Transition: shared for both morph and flip
    this.transP        = 1;   // 0→1; 1 = settled
    this.transDuration = 120; // ms; recalculated per mode in play()

    // Playback
    this.translations    = [];
    this.currentIndex    = -1;
    this.displayDuration = 200;
    this.elapsed         = 0;
    this.phase           = 'idle'; // 'display' | 'transition' | 'idle'
    this.isPlaying       = false;
    this.isPaused        = false;
    this.isLooping       = false;

    // Mode: 'morph' uses DOM overlay + SVG filter; 'flip' uses canvas only
    this.transitionMode = 'morph';
    // During export we always use canvas-only rendering
    this.exportMode = false;

    // DOM elements for morph overlay
    this.morphOverlay = document.getElementById('morphOverlay');
    this.morphEl1     = document.getElementById('morphText1');
    this.morphEl2     = document.getElementById('morphText2');

    // RAF
    this.rafId  = null;
    this.lastTs = 0;

    // Callbacks
    this.onLangChange = null;
    this.onComplete   = null;

    this.resize();
    this._syncOverlay(false);
  }

  // ── Layout zones ───────────────────────────────────────────────────────────
  // Top 62% = flip/morph zone. Fold at 31%. Label zone: 62%–100%.
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
    // Re-apply font size to morph elements after resize
    this._syncMorphTextSize();
  }

  // ── Text fitting ───────────────────────────────────────────────────────────
  _wrapWords(text, maxW, size) {
    const ctx = this.ctx;
    ctx.font = `800 ${size}px ${FONT}`;
    const trimmed = text.trim();
    const words   = trimmed.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [trimmed];
    if (ctx.measureText(trimmed).width <= maxW) return [trimmed];
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width <= maxW) { cur = test; }
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  _fitText(text) {
    if (!text) return { lines: [], fontSize: 60 };
    const flipH   = this._flipH();
    // 13% padding each side → 74% of canvas width
    const maxW    = this.W * 0.74;
    const maxH    = flipH * 0.68;
    const maxLines = 3;
    const minSize  = 18;
    let size = Math.min(96, Math.floor(flipH * 0.27));

    while (size >= minSize) {
      this.ctx.font = `800 ${size}px ${FONT}`;
      const lines    = this._wrapWords(text, maxW, size);
      const maxLineW = Math.max(...lines.map(l => this.ctx.measureText(l).width));
      const lh       = size * 1.25;
      const blockH   = lines.length > 1 ? (lines.length - 1) * lh + size : size;
      if (maxLineW <= maxW && lines.length <= maxLines && blockH <= maxH) {
        return { lines, fontSize: size };
      }
      size -= 3;
    }
    // Fallback: keep shrinking until it fits
    for (let fb = minSize; fb >= 10; fb -= 2) {
      this.ctx.font = `800 ${fb}px ${FONT}`;
      const lines  = this._wrapWords(text, maxW, fb).slice(0, maxLines);
      const maxW2  = Math.max(...lines.map(l => this.ctx.measureText(l).width));
      if (maxW2 <= maxW) return { lines, fontSize: fb };
    }
    return { lines: [text.slice(0, 20)], fontSize: 10 };
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

    if (this.phase === 'transition') {
      if (this.elapsed >= this.transDuration) {
        this.curLines  = this.nxtLines;  this.curSize   = this.nxtSize;
        this.curDir    = this.nxtDir;    this.curLang   = this.nxtLang;
        this.curNative = this.nxtNative;
        this.transP    = 1;
        this.elapsed  -= this.transDuration;
        this.phase     = 'display';
        this._syncMorphTextSize();
      } else {
        this.transP = this.elapsed / this.transDuration;
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
    this.transP    = 0;
    this.phase     = 'transition';

    if (this.onLangChange) {
      this.onLangChange({ lang: item, index: this.currentIndex, total: this.translations.length });
    }
  }

  // ── Draw dispatcher ────────────────────────────────────────────────────────
  _draw() {
    const { W, H } = this;

    // Rich gradient background
    const bg = this.ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#1C1C1C');
    bg.addColorStop(0.5, '#0E0E0E');
    bg.addColorStop(1,   '#070707');
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, W, H);

    const inTransition = this.phase === 'transition' && this.transP < 1;
    const useMorph = (this.transitionMode === 'morph') && !this.exportMode;

    if (useMorph) {
      // Canvas only draws background + label; DOM overlay handles the text
      this._syncOverlay(true);
      this._updateMorphDOM(inTransition ? this.transP : 1);
      if (this.curLang || this.nxtLang) {
        const labelOpacity = inTransition ? Math.min(1, this.transP * 3) : 1;
        const labelLang   = inTransition && this.transP > 0.4 ? this.nxtLang   : this.curLang;
        const labelNative = inTransition && this.transP > 0.4 ? this.nxtNative : this.curNative;
        this._drawLabel(labelLang, labelNative, labelOpacity, 0);
      }
    } else {
      // Flip mode (or export canvas render)
      this._syncOverlay(false);
      if (!this.curLines.length && !this.nxtLines.length) {
        this._drawPlaceholder();
      } else if (inTransition) {
        if (this.exportMode && this.transitionMode === 'morph') {
          this._drawMorphCanvas(this.transP);
        } else {
          this._drawFlip(this.transP);
        }
      } else {
        if (this.exportMode && this.transitionMode === 'morph') {
          // Clean settled frame for morph export — no flip crease, matches _drawMorphCanvas style
          this._drawLines(this.curLines, this.curSize, this.curDir, this._foldY(), 1);
          this._drawLabel(this.curLang, this.curNative, 1, 0);
        } else {
          this._drawSettled();
        }
      }
    }

    // Vignette always on top
    if (this.curLines.length || this.nxtLines.length || !useMorph) {
      this._drawVignette();
    }

    if (!this.isPlaying && !this.curLines.length) this._drawPlaceholder();
  }

  // ── Morph: DOM overlay ─────────────────────────────────────────────────────
  _syncOverlay(visible) {
    if (!this.morphOverlay) return;
    this.morphOverlay.style.display = visible ? 'block' : 'none';
  }

  _syncMorphTextSize() {
    if (!this.morphEl1 || !this.morphEl2) return;
    const sz1 = this.curSize || 60;
    const sz2 = this.nxtSize || 60;
    this.morphEl1.style.fontSize = sz1 + 'px';
    this.morphEl1.style.direction = this.curDir;
    this.morphEl1.style.lineHeight = '1.25';
    this.morphEl2.style.fontSize = sz2 + 'px';
    this.morphEl2.style.direction = this.nxtDir;
    this.morphEl2.style.lineHeight = '1.25';
  }

  _updateMorphDOM(p) {
    if (!this.morphEl1 || !this.morphEl2) return;

    if (p >= 1) {
      // Settled state: show current text, hide previous
      this.morphEl1.textContent = this.curLines.join('\n');
      this.morphEl1.style.fontSize  = this.curSize + 'px';
      this.morphEl1.style.direction = this.curDir;
      this.morphEl1.style.filter    = '';
      this.morphEl1.style.opacity   = '1';
      this.morphEl2.style.filter    = '';
      this.morphEl2.style.opacity   = '0';
      this.morphEl2.textContent     = '';
      return;
    }

    // Morphing: text1 leaves (blurs out), text2 arrives (blurs in)
    this.morphEl1.textContent = this.curLines.join('\n');
    this.morphEl1.style.fontSize  = this.curSize + 'px';
    this.morphEl1.style.direction = this.curDir;

    this.morphEl2.textContent = this.nxtLines.join('\n');
    this.morphEl2.style.fontSize  = this.nxtSize + 'px';
    this.morphEl2.style.direction = this.nxtDir;

    // Outgoing: fraction = p (0→1 means it leaves)
    const f1    = p;
    const blur1 = Math.min(8 / Math.max(1 - f1, 0.001) - 8, 100);
    const alpha1 = Math.pow(1 - f1, 0.4);

    // Incoming: fraction = p (0→1 means it arrives)
    const f2    = p;
    const blur2 = Math.min(8 / Math.max(f2, 0.001) - 8, 100);
    const alpha2 = Math.pow(f2, 0.4);

    this.morphEl1.style.filter  = blur1 > 0.2 ? `blur(${blur1.toFixed(1)}px)` : '';
    this.morphEl1.style.opacity = alpha1;
    this.morphEl2.style.filter  = blur2 > 0.2 ? `blur(${blur2.toFixed(1)}px)` : '';
    this.morphEl2.style.opacity = alpha2;
  }

  // ── Morph: canvas-only fallback (for export) ───────────────────────────────
  _drawMorphCanvas(p) {
    const ctx   = this.ctx;
    const foldY = this._foldY();

    // Outgoing text
    const f1     = p;
    const blur1  = Math.min(8 / Math.max(1 - f1, 0.001) - 8, 80);
    const alpha1 = Math.pow(1 - f1, 0.4);

    // Incoming text
    const f2     = p;
    const blur2  = Math.min(8 / Math.max(f2, 0.001) - 8, 80);
    const alpha2 = Math.pow(f2, 0.4);

    if (alpha1 > 0.01) {
      ctx.save();
      ctx.globalAlpha = alpha1;
      if (blur1 > 0.3) ctx.filter = `blur(${blur1.toFixed(1)}px)`;
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
      ctx.restore();
    }

    if (alpha2 > 0.01) {
      ctx.save();
      ctx.globalAlpha = alpha2;
      if (blur2 > 0.3) ctx.filter = `blur(${blur2.toFixed(1)}px)`;
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, 1);
      ctx.restore();
    }

    // Label cross-fades in the second half
    if (p < 0.5) {
      this._drawLabel(this.curLang, this.curNative, Math.max(0, 1 - p * 2.5), 0);
    } else {
      this._drawLabel(this.nxtLang, this.nxtNative, Math.min(1, (p - 0.5) * 2.5), 0);
    }
  }

  // ── Flip: canvas split-flap ────────────────────────────────────────────────
  _drawSettled() {
    const { W } = this;
    const foldY = this._foldY();

    // Mechanical crease: lighter above, shadow below
    this.ctx.fillStyle = 'rgba(255,255,255,0.09)';
    this.ctx.fillRect(0, foldY - 1, W, 1);
    this.ctx.fillStyle = 'rgba(0,0,0,0.50)';
    this.ctx.fillRect(0, foldY, W, 1);

    this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
    this._drawLabel(this.curLang, this.curNative, 1, 0);
  }

  _drawFlip(p) {
    const ctx   = this.ctx;
    const { W } = this;
    const foldY = this._foldY();
    const flipH = this._flipH();

    const ep = easeInOut3(p);

    // Crease always visible
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(0, foldY - 1, W, 1);

    if (p < 0.5) {
      const t = easeInOut3(p / 0.5);

      // Static bottom half — current
      ctx.save();
      ctx.beginPath(); ctx.rect(0, foldY, W, flipH - foldY); ctx.clip();
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
      ctx.restore();

      // Collapsing top half — current, darkens as it folds
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, foldY); ctx.clip();
      ctx.translate(0, foldY); ctx.scale(1, 1 - t); ctx.translate(0, -foldY);
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
      // Card darkens as it turns away from the light
      ctx.fillStyle = `rgba(0,0,0,${t * 0.70})`;
      ctx.fillRect(0, 0, W, foldY);
      ctx.restore();

      // Shadow cast by the folding card
      const shadow = Math.sin(t * Math.PI) * 0.55;
      if (shadow > 0.01) {
        const len = Math.min(55, flipH * 0.13);
        const sh  = ctx.createLinearGradient(0, foldY, 0, foldY + len);
        sh.addColorStop(0, `rgba(0,0,0,${shadow})`);
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(0, foldY, W, len);
      }

      // Flash at crease
      const flash = Math.max(0, 0.14 - Math.abs(p - 0.5)) / 0.14 * 0.28;
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, foldY - 1, W, 2); }

      this._drawLabel(this.curLang, this.curNative, Math.max(0, 1 - t * 2.4), 0);

    } else {
      const t = easeInOut3((p - 0.5) / 0.5);

      // Static top half — next
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, foldY); ctx.clip();
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, 1);
      ctx.restore();

      // Expanding bottom half — next, lightens as it opens
      ctx.save();
      ctx.beginPath(); ctx.rect(0, foldY, W, flipH - foldY); ctx.clip();
      ctx.translate(0, foldY); ctx.scale(1, t); ctx.translate(0, -foldY);
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, 1);
      // Shadow lifts as the new card opens
      ctx.fillStyle = `rgba(0,0,0,${(1 - t) * 0.60})`;
      ctx.fillRect(0, foldY, W, flipH - foldY);
      ctx.restore();

      // Residual shadow fades
      const shadow = (1 - t) * 0.45;
      if (shadow > 0.01) {
        const len = Math.min(55, flipH * 0.13);
        const sh  = ctx.createLinearGradient(0, foldY, 0, foldY + len);
        sh.addColorStop(0, `rgba(0,0,0,${shadow})`);
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(0, foldY, W, len);
      }

      // Flash
      const flash = Math.max(0, 0.14 - Math.abs(p - 0.5)) / 0.14 * 0.28;
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, foldY - 1, W, 2); }

      // Shadow underline for the settled top card
      ctx.fillStyle = 'rgba(0,0,0,0.50)';
      ctx.fillRect(0, foldY, W, 1);

      this._drawLabel(this.nxtLang, this.nxtNative, Math.min(1, t * 2.4), (1 - t) * 5);
    }
  }

  // ── Shared drawing primitives ──────────────────────────────────────────────
  _drawLines(lines, size, dir, centerY, opacity) {
    if (!lines.length || opacity <= 0) return;
    const ctx  = this.ctx;
    const lh   = size * 1.25;
    const totalH = lines.length > 1 ? (lines.length - 1) * lh : 0;
    const startY = centerY - totalH / 2;

    ctx.save();
    ctx.globalAlpha  = opacity;
    ctx.font         = `800 ${size}px ${FONT}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = dir;
    ctx.fillStyle    = '#F5F0E8'; // warm off-white
    lines.forEach((line, i) => ctx.fillText(line, this.W / 2, startY + i * lh));
    ctx.restore();
  }

  _drawLabel(lang, native, opacity, slideDown) {
    if (!lang || opacity <= 0) return;
    const ctx   = this.ctx;
    const cx    = this.W / 2;
    const baseY = this._labelY() + (slideDown || 0);
    const nSize = Math.max(12, Math.min(19, this.H * 0.030));

    ctx.save();
    ctx.globalAlpha  = opacity;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = 'ltr';

    // Native script — warm amber/gold
    ctx.font      = `700 ${nSize}px ${FONT}`;
    ctx.fillStyle = '#F5A623';
    ctx.fillText(native, cx, baseY);

    // English name — small, dim, spaced caps
    ctx.font         = `500 10px 'Inter', sans-serif`;
    ctx.fillStyle    = 'rgba(255,255,255,0.26)';
    ctx.letterSpacing = '0.13em';
    ctx.fillText(lang.toUpperCase(), cx, baseY + nSize + 12);

    ctx.restore();
  }

  _drawPlaceholder() {
    const ctx = this.ctx;
    const cx  = this.W / 2;
    const cy  = this._foldY();
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `400 13px 'Inter', sans-serif`;
    ctx.fillStyle    = 'rgba(255,255,255,0.13)';
    ctx.fillText('Your phrase will appear here', cx, cy);
    ctx.restore();
  }

  _drawVignette() {
    const { W, H } = this;
    const ctx = this.ctx;

    const radial = ctx.createRadialGradient(W/2, H/2, H*0.20, W/2, H/2, H*0.88);
    radial.addColorStop(0, 'transparent');
    radial.addColorStop(1, 'rgba(0,0,0,0.52)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, W, H);

    const topFade = ctx.createLinearGradient(0, 0, 0, H * 0.07);
    topFade.addColorStop(0, 'rgba(0,0,0,0.28)');
    topFade.addColorStop(1, 'transparent');
    ctx.fillStyle = topFade;
    ctx.fillRect(0, 0, W, H * 0.07);

    const btmFade = ctx.createLinearGradient(0, H * 0.93, 0, H);
    btmFade.addColorStop(0, 'transparent');
    btmFade.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = btmFade;
    ctx.fillRect(0, H * 0.93, W, H * 0.07);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  play(translations, totalMs) {
    if (!translations.length) return;
    this.translations = translations;
    this.isPlaying    = true;
    this.isPaused     = false;

    const ms = totalMs || 9000;
    this._calcTimings(ms, translations.length);

    const first  = translations[0];
    const fitted = this._fitText(first.text);
    this.curLines  = fitted.lines;
    this.curSize   = fitted.fontSize;
    this.curDir    = first.dir || 'ltr';
    this.curLang   = first.name;
    this.curNative = first.native;
    this.transP    = 1;
    this.currentIndex = 0;
    this.elapsed   = 0;
    this.phase     = 'display';

    this._syncMorphTextSize();
    if (this.onLangChange) {
      this.onLangChange({ lang: first, index: 0, total: translations.length });
    }
  }

  _calcTimings(totalMs, n) {
    if (this.transitionMode === 'morph') {
      // Morph needs more time per transition than a flip
      this.transDuration   = Math.min(560, Math.max(100, Math.floor(totalMs / n * 0.52)));
      this.displayDuration = Math.max(80, Math.floor((totalMs - this.transDuration * (n - 1)) / n));
    } else {
      this.transDuration   = Math.min(110, Math.max(60, Math.floor(totalMs / n * 0.30)));
      this.displayDuration = Math.max(60, Math.floor((totalMs - this.transDuration * (n - 1)) / n));
    }
  }

  // Recalculate timings in real-time (called when speed slider changes during playback)
  setSpeed(totalMs) {
    if (!this.isPlaying || !this.translations.length) return;
    this._calcTimings(totalMs, this.translations.length);
    // Keep elapsed within bounds of new displayDuration
    if (this.phase === 'display') this.elapsed = Math.min(this.elapsed, this.displayDuration - 1);
    if (this.phase === 'transition') this.elapsed = Math.min(this.elapsed, this.transDuration - 1);
  }

  setMode(mode) {
    if (mode === this.transitionMode) return;
    this.transitionMode = mode;
    if (!this.isPlaying) this._syncOverlay(false);
    // Recalculate timings for new mode
    if (this.isPlaying && this.translations.length) {
      const ms = this.transDuration + this.displayDuration; // approximate per-slot ms
      this._calcTimings(ms * this.translations.length, this.translations.length);
    }
  }

  pause()  { this.isPaused = true;  }
  resume() { this.isPaused = false; }

  halt() {
    this.isPlaying    = false;
    this.isPaused     = false;
    this.curLines     = [];
    this.nxtLines     = [];
    this.translations = [];
    this.currentIndex = -1;
    this.phase        = 'idle';
    this._syncOverlay(false);
  }

  setLoop(v) { this.isLooping = v; }
}
