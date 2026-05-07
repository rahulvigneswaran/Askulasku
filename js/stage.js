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
    this.W = 800; this.H = 280;

    // Current settled state
    this.curText   = '';
    this.curDir    = 'ltr';
    this.curLang   = '';
    this.curNative = '';

    // Queued next state (during flip)
    this.nxtText   = '';
    this.nxtDir    = 'ltr';
    this.nxtLang   = '';
    this.nxtNative = '';

    // Flip animation
    this.flipP        = 1;   // 0→1, 1 = settled
    this.flipDuration = 90;  // ms (fixed per flip)

    // Playback
    this.translations    = [];
    this.currentIndex    = -1;
    this.displayDuration = 200; // ms (recalculated in play())
    this.elapsed         = 0;
    this.phase           = 'idle'; // 'display' | 'flip' | 'idle'
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

  // ── Setup ──────────────────────────────────────────────────────────────────
  resize() {
    const dpr  = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.W = rect.width  || 800;
    this.H = rect.height || 280;
    this.canvas.width  = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width  = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
        // Commit flip
        this.curText   = this.nxtText;
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
    const item       = this.translations[this.currentIndex];
    this.nxtText     = item.text;
    this.nxtDir      = item.dir || 'ltr';
    this.nxtLang     = item.name;
    this.nxtNative   = item.native;
    this.flipP       = 0;
    this.phase       = 'flip';

    if (this.onLangChange) {
      this.onLangChange({ lang: item, index: this.currentIndex, total: this.translations.length });
    }
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  _draw() {
    const ctx = this.ctx;
    const { W, H } = this;
    const isDark = document.documentElement.dataset.theme === 'dark';

    // Board background — always dark regardless of page theme
    ctx.fillStyle = isDark ? '#0D0D0D' : '#131313';
    ctx.fillRect(0, 0, W, H);

    if (!this.curText && !this.nxtText) {
      this._drawPlaceholder(isDark);
      return;
    }

    const flipping = this.phase === 'flip' && this.flipP < 1;
    if (flipping) {
      this._drawFlip(this.flipP, isDark);
    } else {
      this._drawSettled(isDark);
    }

    this._drawVignette(W, H);
  }

  _drawSettled(isDark) {
    const { W, H } = this;
    const mid    = H / 2;
    const size   = this._fitFont(this.curText);
    const textY  = mid - size * 0.12;

    // Subtle fold line
    this.ctx.fillStyle = 'rgba(255,255,255,0.05)';
    this.ctx.fillRect(0, mid - 0.5, W, 1);

    this._putText(W / 2, textY, this.curText, this.curDir, size, '#F0F0F0', 1);
    this._putLabel(this.curLang, this.curNative, W, H, 1);
  }

  _drawFlip(p, isDark) {
    const ctx    = this.ctx;
    const { W, H } = this;
    const mid    = H / 2;
    const curSz  = this._fitFont(this.curText || this.nxtText);
    const nxtSz  = this._fitFont(this.nxtText);
    const textY  = mid - curSz * 0.12;

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, mid - 0.5, W, 1);

    const cx = W / 2;

    if (p < 0.5) {
      // ── Phase 1: top of current collapses toward fold line ────────────────
      const t     = easeInOut(p / 0.5);   // 0 → 1
      const scale = 1 - t;                 // 1 → 0

      // Static bottom half (current)
      ctx.save();
      ctx.beginPath(); ctx.rect(0, mid, W, H - mid); ctx.clip();
      this._putText(cx, textY, this.curText, this.curDir, curSz, '#F0F0F0', 1);
      ctx.restore();

      // Collapsing top half (current), pivot at fold line
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, mid); ctx.clip();
      ctx.translate(0, mid);
      ctx.scale(1, scale);
      ctx.translate(0, -mid);
      this._putText(cx, textY, this.curText, this.curDir, curSz, '#F0F0F0', 1);
      ctx.restore();

      // Flash at fold moment
      const flash = Math.max(0, 0.18 - Math.abs(p - 0.5)) / 0.18 * 0.18;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        ctx.fillRect(0, mid - 1, W, 2);
      }

      this._putLabel(this.curLang, this.curNative, W, H, Math.max(0, 1 - t));

    } else {
      // ── Phase 2: new top settled; new bottom expands from fold line ────────
      const t     = easeInOut((p - 0.5) / 0.5); // 0 → 1
      const scale = t;                             // 0 → 1

      // Static top half (next)
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, mid); ctx.clip();
      this._putText(cx, textY, this.nxtText, this.nxtDir, nxtSz, '#F0F0F0', 1);
      ctx.restore();

      // Expanding bottom half (next), pivot at fold line
      ctx.save();
      ctx.beginPath(); ctx.rect(0, mid, W, H - mid); ctx.clip();
      ctx.translate(0, mid);
      ctx.scale(1, scale);
      ctx.translate(0, -mid);
      this._putText(cx, textY, this.nxtText, this.nxtDir, nxtSz, '#F0F0F0', 1);
      ctx.restore();

      // Flash just after flip
      const flash = Math.max(0, 0.18 - Math.abs(p - 0.5)) / 0.18 * 0.18;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        ctx.fillRect(0, mid - 1, W, 2);
      }

      this._putLabel(this.nxtLang, this.nxtNative, W, H, Math.min(1, t));
    }
  }

  _putText(cx, cy, text, dir, size, color, opacity) {
    if (!text || opacity <= 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha    = opacity;
    ctx.font           = `700 ${size}px ${FONT}`;
    ctx.textAlign      = 'center';
    ctx.textBaseline   = 'middle';
    ctx.direction      = dir;
    ctx.fillStyle      = color;
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  _putLabel(lang, native, W, H, opacity) {
    if (!lang || opacity <= 0) return;
    const ctx = this.ctx;
    const cx  = W / 2;
    // Label sits in the lower quarter
    const baseY = H * 0.76;

    ctx.save();
    ctx.globalAlpha  = opacity;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = 'ltr';

    // Native name — amber
    ctx.font      = `500 ${Math.max(14, Math.min(20, H * 0.07))}px ${FONT}`;
    ctx.fillStyle = '#F5A623';
    ctx.fillText(native, cx, baseY);

    // English name — dim white
    ctx.font      = `500 11px 'Inter', sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.letterSpacing = '0.08em';
    ctx.fillText(lang.toUpperCase(), cx, baseY + 22);

    ctx.restore();
  }

  _drawPlaceholder(isDark) {
    const ctx = this.ctx;
    const cx = this.W / 2, cy = this.H / 2;
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
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  _fitFont(text) {
    if (!text) return 72;
    const ctx  = this.ctx;
    const maxW = this.W * 0.86;
    // Cap height to ~38% of board height
    let size   = Math.min(110, Math.floor(this.H * 0.38));
    while (size > 22) {
      ctx.font = `700 ${size}px ${FONT}`;
      if (ctx.measureText(text).width <= maxW) break;
      size -= 3;
    }
    return size;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  play(translations) {
    if (!translations.length) return;
    this.translations = translations;
    this.isPlaying    = true;
    this.isPaused     = false;

    // 5-second clip: divide time so (n-1) flips + n display slots = 5000ms
    const totalMs   = 5000;
    const n         = translations.length;
    this.flipDuration    = Math.min(95, Math.floor(totalMs / n * 0.33));
    this.displayDuration = Math.floor((totalMs - this.flipDuration * (n - 1)) / n);

    // First item — show immediately (no flip)
    const first      = translations[0];
    this.curText     = first.text;
    this.curDir      = first.dir || 'ltr';
    this.curLang     = first.name;
    this.curNative   = first.native;
    this.flipP       = 1;
    this.currentIndex = 0;
    this.elapsed     = 0;
    this.phase       = 'display';

    if (this.onLangChange) {
      this.onLangChange({ lang: first, index: 0, total: n });
    }
  }

  pause()  { this.isPaused = true;  }
  resume() { this.isPaused = false; }

  halt() {
    this.isPlaying    = false;
    this.isPaused     = false;
    this.curText      = '';
    this.translations = [];
    this.currentIndex = -1;
    this.phase        = 'idle';
  }

  setLoop(v) { this.isLooping = v; }
}
