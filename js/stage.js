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

    this.curLines  = []; this.curSize   = 72;
    this.curDir    = 'ltr';
    this.curLang   = ''; this.curNative = '';

    this.nxtLines  = []; this.nxtSize   = 72;
    this.nxtDir    = 'ltr';
    this.nxtLang   = ''; this.nxtNative = '';

    this.transP        = 1;
    this.transDuration = 120;

    this.translations    = [];
    this.currentIndex    = -1;
    this.displayDuration = 200;
    this.elapsed         = 0;
    this.phase           = 'idle';
    this.isPlaying       = false;
    this.isPaused        = false;
    this.isLooping       = false;

    this.transitionMode = 'morph';
    this.exportMode = false;

    this.morphOverlay = document.getElementById('morphOverlay');
    this.morphEl1     = document.getElementById('morphText1');
    this.morphEl2     = document.getElementById('morphText2');

    this.rafId  = null;
    this.lastTs = 0;

    this.onLangChange = null;
    this.onComplete   = null;

    this.qrCodeImg = null;
    this.siteUrl   = '';

    this.resize();
    this._renderDPR = window.devicePixelRatio || 1;
    this._syncOverlay(false);
  }

  _flipH()  { return this.H * 0.62; }
  _foldY()  { return this._flipH() / 2; }
  _labelY() { return this._flipH() + (this.H - this._flipH()) * 0.40; }

  resize() {
    const dpr  = window.devicePixelRatio || 1;
    this._renderDPR = dpr;
    const rect = this.canvas.getBoundingClientRect();
    this.W = Math.max(rect.width,  1);
    this.H = Math.max(rect.height, 1);
    this.canvas.width  = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width  = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._syncMorphTextSize();
  }

  _scale() { return this.H / 640; }

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
    const maxW    = this.W * 0.74;
    const maxH    = flipH * 0.68;
    const maxLines = 3;
    const minSize  = Math.round(18 * this._scale());
    let size = Math.floor(flipH * 0.27);

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
    for (let fb = minSize; fb >= 10; fb -= 2) {
      this.ctx.font = `800 ${fb}px ${FONT}`;
      const lines  = this._wrapWords(text, maxW, fb).slice(0, maxLines);
      const maxW2  = Math.max(...lines.map(l => this.ctx.measureText(l).width));
      if (maxW2 <= maxW) return { lines, fontSize: fb };
    }
    return { lines: [text.slice(0, 20)], fontSize: 10 };
  }

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

  _draw() {
    const { W, H } = this;

    const bg = this.ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#1C1C1C');
    bg.addColorStop(0.5, '#0E0E0E');
    bg.addColorStop(1,   '#070707');
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, W, H);
    if (this.exportMode) this._applyGrain();

    const inTransition = this.phase === 'transition' && this.transP < 1;
    const useMorph = (this.transitionMode === 'morph') && !this.exportMode;

    if (useMorph) {
      this._syncOverlay(true);
      this._updateMorphDOM(inTransition ? this.transP : 1);
      if (this.curLang || this.nxtLang) {
        const labelOpacity = inTransition ? Math.min(1, this.transP * 3) : 1;
        const labelLang   = inTransition && this.transP > 0.4 ? this.nxtLang   : this.curLang;
        const labelNative = inTransition && this.transP > 0.4 ? this.nxtNative : this.curNative;
        this._drawLabel(labelLang, labelNative, labelOpacity, 0);
      }
    } else {
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
          this._drawLines(this.curLines, this.curSize, this.curDir, this._foldY(), 1);
          this._drawLabel(this.curLang, this.curNative, 1, 0);
        } else {
          this._drawSettled();
        }
      }
    }

    if (this.curLines.length || this.nxtLines.length || !useMorph) {
      this._drawVignette();
    }

    if (!this.isPlaying && !this.curLines.length) this._drawPlaceholder();
  }

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

    this.morphEl1.textContent = this.curLines.join('\n');
    this.morphEl1.style.fontSize  = this.curSize + 'px';
    this.morphEl1.style.direction = this.curDir;

    this.morphEl2.textContent = this.nxtLines.join('\n');
    this.morphEl2.style.fontSize  = this.nxtSize + 'px';
    this.morphEl2.style.direction = this.nxtDir;

    const f1    = p;
    const blur1 = Math.min(8 / Math.max(1 - f1, 0.001) - 8, 100);
    const alpha1 = Math.pow(1 - f1, 0.4);

    const f2    = p;
    const blur2 = Math.min(8 / Math.max(f2, 0.001) - 8, 100);
    const alpha2 = Math.pow(f2, 0.4);

    this.morphEl1.style.filter  = blur1 > 0.2 ? `blur(${blur1.toFixed(1)}px)` : '';
    this.morphEl1.style.opacity = alpha1;
    this.morphEl2.style.filter  = blur2 > 0.2 ? `blur(${blur2.toFixed(1)}px)` : '';
    this.morphEl2.style.opacity = alpha2;
  }

  _drawMorphCanvas(p) {
    const mainCtx = this.ctx;
    const foldY   = this._foldY();
    const flipH   = this._flipH();
    const dpr     = this._renderDPR || 1;
    const pw      = this.canvas.width;
    const ph      = Math.round(flipH * dpr);
    const sc      = this._scale();

    const blur1  = Math.min(8 / Math.max(1 - p, 0.001) - 8, 80) * sc;
    const alpha1 = Math.pow(1 - p, 0.4);
    const blur2  = Math.min(8 / Math.max(p,     0.001) - 8, 80) * sc;
    const alpha2 = Math.pow(p, 0.4);

    const off  = new OffscreenCanvas(pw, ph);
    const octx = off.getContext('2d');
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.ctx = octx;
    if (alpha1 > 0.01) {
      octx.save();
      octx.globalAlpha = alpha1;
      if (blur1 > 0.3) octx.filter = `blur(${blur1.toFixed(1)}px)`;
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
      octx.restore();
    }
    if (alpha2 > 0.01) {
      octx.save();
      octx.globalAlpha = alpha2;
      if (blur2 > 0.3) octx.filter = `blur(${blur2.toFixed(1)}px)`;
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, 1);
      octx.restore();
    }
    this.ctx = mainCtx;

    const imgData = octx.getImageData(0, 0, pw, ph);
    const d = imgData.data;
    for (let i = 3; i < d.length; i += 4) {
      d[i] = d[i] < 140 ? 0 : 255;
    }
    octx.putImageData(imgData, 0, 0);

    mainCtx.save();
    mainCtx.filter = `blur(${(0.5 * sc).toFixed(2)}px)`;
    mainCtx.drawImage(off, 0, 0, this.W, flipH);
    mainCtx.restore();

    if (p < 0.5) {
      this._drawLabel(this.curLang, this.curNative, Math.max(0, 1 - p * 2.5), 0);
    } else {
      this._drawLabel(this.nxtLang, this.nxtNative, Math.min(1, (p - 0.5) * 2.5), 0);
    }
  }

  _applyGrain() {
    const { W, H, ctx } = this;
    const tileSize = 96;
    const off  = new OffscreenCanvas(tileSize, tileSize);
    const octx = off.getContext('2d');
    const img  = octx.createImageData(tileSize, tileSize);
    const d    = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = Math.random() * 22 | 0;
      d[i] = d[i + 1] = d[i + 2] = n;
      d[i + 3] = 22;
    }
    octx.putImageData(img, 0, 0);
    ctx.save();
    ctx.fillStyle = ctx.createPattern(off, 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  _drawSettled() {
    const { W } = this;
    const foldY = this._foldY();

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

    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(0, foldY - 1, W, 1);

    if (p < 0.5) {
      const t = easeInOut3(p / 0.5);

      ctx.save();
      ctx.beginPath(); ctx.rect(0, foldY, W, flipH - foldY); ctx.clip();
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
      ctx.restore();

      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, foldY); ctx.clip();
      ctx.translate(0, foldY); ctx.scale(1, 1 - t); ctx.translate(0, -foldY);
      this._drawLines(this.curLines, this.curSize, this.curDir, foldY, 1);
      ctx.fillStyle = `rgba(0,0,0,${t * 0.70})`;
      ctx.fillRect(0, 0, W, foldY);
      ctx.restore();

      const shadow = Math.sin(t * Math.PI) * 0.55;
      if (shadow > 0.01) {
        const len = Math.min(55, flipH * 0.13);
        const sh  = ctx.createLinearGradient(0, foldY, 0, foldY + len);
        sh.addColorStop(0, `rgba(0,0,0,${shadow})`);
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(0, foldY, W, len);
      }

      const flash = Math.max(0, 0.14 - Math.abs(p - 0.5)) / 0.14 * 0.28;
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, foldY - 1, W, 2); }

      this._drawLabel(this.curLang, this.curNative, Math.max(0, 1 - t * 2.4), 0);

    } else {
      const t = easeInOut3((p - 0.5) / 0.5);

      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, foldY); ctx.clip();
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, 1);
      ctx.restore();

      ctx.save();
      ctx.beginPath(); ctx.rect(0, foldY, W, flipH - foldY); ctx.clip();
      ctx.translate(0, foldY); ctx.scale(1, t); ctx.translate(0, -foldY);
      this._drawLines(this.nxtLines, this.nxtSize, this.nxtDir, foldY, 1);
      ctx.fillStyle = `rgba(0,0,0,${(1 - t) * 0.60})`;
      ctx.fillRect(0, foldY, W, flipH - foldY);
      ctx.restore();

      const shadow = (1 - t) * 0.45;
      if (shadow > 0.01) {
        const len = Math.min(55, flipH * 0.13);
        const sh  = ctx.createLinearGradient(0, foldY, 0, foldY + len);
        sh.addColorStop(0, `rgba(0,0,0,${shadow})`);
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(0, foldY, W, len);
      }

      const flash = Math.max(0, 0.14 - Math.abs(p - 0.5)) / 0.14 * 0.28;
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, foldY - 1, W, 2); }

      ctx.fillStyle = 'rgba(0,0,0,0.50)';
      ctx.fillRect(0, foldY, W, 1);

      this._drawLabel(this.nxtLang, this.nxtNative, Math.min(1, t * 2.4), (1 - t) * 5);
    }
  }

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
    ctx.fillStyle    = '#F5F0E8';
    lines.forEach((line, i) => ctx.fillText(line, this.W / 2, startY + i * lh));
    ctx.restore();
  }

  _drawLabel(lang, native, opacity, slideDown) {
    if (!lang || opacity <= 0) return;
    const ctx   = this.ctx;
    const cx    = this.W / 2;
    const baseY = this._labelY() + (slideDown || 0);
    const sc    = this._scale();
    const nSize = Math.round(Math.min(sc * 22, this.H * 0.030));

    ctx.save();
    ctx.globalAlpha  = opacity;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = 'ltr';

    ctx.font      = `700 ${nSize}px ${FONT}`;
    ctx.fillStyle = '#F5A623';
    ctx.fillText(native, cx, baseY);

    ctx.font          = `500 ${Math.round(sc * 10)}px 'Inter', sans-serif`;
    ctx.fillStyle     = 'rgba(255,255,255,0.26)';
    ctx.letterSpacing = '0.13em';
    ctx.fillText(lang.toUpperCase(), cx, baseY + nSize + Math.round(sc * 12));

    ctx.restore();
  }

  _drawPlaceholder() {
    const ctx = this.ctx;
    const cx  = this.W / 2;
    const cy  = this._foldY();
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `400 ${Math.round(this._scale() * 13)}px 'Inter', sans-serif`;
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

  _drawEndFrame(exportCanvas, W, H) {
    const ctx = exportCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const saved = {
      ctx: this.ctx, W: this.W, H: this.H,
      canvas: this.canvas, renderDPR: this._renderDPR,
    };
    this.ctx = ctx; this.W = W; this.H = H;
    this.canvas = exportCanvas; this._renderDPR = 1;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#1C1C1C');
    bg.addColorStop(0.5, '#0E0E0E');
    bg.addColorStop(1,   '#070707');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    this._applyGrain();

    const cx = W / 2;
    const sc = H / 640;

    ctx.save();
    ctx.font         = `800 ${Math.round(sc * 36)}px ${FONT}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = 'ltr';
    ctx.fillStyle    = '#F5F0E8';
    ctx.fillText('Say it in', cx, H * 0.31);
    ctx.restore();

    ctx.save();
    ctx.font         = `italic 400 ${Math.round(sc * 34)}px 'Instrument Serif', Georgia, serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = 'ltr';
    ctx.fillStyle    = '#F5F0E8';
    ctx.fillText('every language.', cx, H * 0.31 + sc * 52);
    ctx.restore();

    const qrSize = Math.round(W * 0.36);
    const qrX    = Math.round(cx - qrSize / 2);
    const qrY    = Math.round(H * 0.43);
    if (this.qrCodeImg?.complete && this.qrCodeImg.naturalWidth > 0) {
      ctx.drawImage(this.qrCodeImg, qrX, qrY, qrSize, qrSize);
    }
    const afterQR = qrY + qrSize;

    ctx.save();
    ctx.font          = `500 ${Math.round(sc * 13)}px 'Inter', sans-serif`;
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';
    ctx.direction     = 'ltr';
    ctx.fillStyle     = '#F5A623';
    ctx.letterSpacing = '0.05em';
    ctx.fillText(this.siteUrl, cx, afterQR + sc * 44);
    ctx.restore();

    ctx.save();
    ctx.font          = `400 ${Math.round(sc * 9)}px 'Inter', sans-serif`;
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';
    ctx.direction     = 'ltr';
    ctx.fillStyle     = 'rgba(255,255,255,0.28)';
    ctx.letterSpacing = '0.12em';
    ctx.fillText('SCAN TO TRY IT YOURSELF', cx, afterQR + sc * 70);
    ctx.restore();

    this._drawVignette();

    this.ctx = saved.ctx; this.W = saved.W; this.H = saved.H;
    this.canvas = saved.canvas; this._renderDPR = saved.renderDPR;
  }

  // ── High-resolution export frame rendering ────────────────────────────────────────────
  _drawExportFrame(exportCanvas, W, H) {
    const scale = W / this.W;

    const saved = {
      ctx: this.ctx, W: this.W, H: this.H, canvas: this.canvas,
      curSize: this.curSize, nxtSize: this.nxtSize, renderDPR: this._renderDPR,
    };

    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.setTransform(1, 0, 0, 1, 0, 0);

    this.ctx        = exportCtx;
    this.W          = W;
    this.H          = H;
    this.canvas     = exportCanvas;
    this.curSize    = Math.round(saved.curSize * scale);
    this.nxtSize    = Math.round(saved.nxtSize * scale);
    this._renderDPR = 1;

    this._draw();

    this.ctx        = saved.ctx;
    this.W          = saved.W;
    this.H          = saved.H;
    this.canvas     = saved.canvas;
    this.curSize    = saved.curSize;
    this.nxtSize    = saved.nxtSize;
    this._renderDPR = saved.renderDPR;
  }

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
      this.transDuration   = Math.min(560, Math.max(100, Math.floor(totalMs / n * 0.52)));
      this.displayDuration = Math.max(80, Math.floor((totalMs - this.transDuration * (n - 1)) / n));
    } else {
      this.transDuration   = Math.min(110, Math.max(60, Math.floor(totalMs / n * 0.30)));
      this.displayDuration = Math.max(60, Math.floor((totalMs - this.transDuration * (n - 1)) / n));
    }
  }

  setSpeed(totalMs) {
    if (!this.isPlaying || !this.translations.length) return;
    this._calcTimings(totalMs, this.translations.length);
    if (this.phase === 'display') this.elapsed = Math.min(this.elapsed, this.displayDuration - 1);
    if (this.phase === 'transition') this.elapsed = Math.min(this.elapsed, this.transDuration - 1);
  }

  setMode(mode) {
    if (mode === this.transitionMode) return;
    this.transitionMode = mode;
    if (!this.isPlaying) this._syncOverlay(false);
    if (this.isPlaying && this.translations.length) {
      const ms = this.transDuration + this.displayDuration;
      this._calcTimings(ms * this.translations.length, this.translations.length);
    }
  }

  pause()  { this.isPaused = true;  }
  resume() { this.isPaused = false; }

  stepExport(dt) {
    const was = this.isPaused;
    this.isPaused = false;
    this._update(dt);
    this.isPaused = was;
  }

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
