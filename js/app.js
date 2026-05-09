'use strict';

// ── Translation ───────────────────────────────────────────────────────────────

async function gtranslate(text, langCode) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${langCode}&dt=t&q=${encodeURIComponent(text)}`;
  const res  = await fetch(url);
  const data = await res.json();
  const t    = data?.[0]?.[0]?.[0];
  return (t && typeof t === 'string') ? t.trim() : null;
}

async function mymemory(text, langCode) {
  const url  = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${langCode}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.responseStatus === 200) {
    const t = (data.responseData?.translatedText || '').trim();
    if (!t.includes('MYMEMORY WARNING') && !t.includes('PLEASE SELECT')) return t;
  }
  return null;
}

function isOk(translation, source) {
  if (!translation) return false;
  const t = translation.trim();
  if (!t) return false;
  if (t.toLowerCase() === source.toLowerCase()) return false;
  const stripped    = t.replace(/[^a-z]/gi, '').toLowerCase();
  const srcStripped = source.replace(/[^a-z]/gi, '').toLowerCase();
  if (stripped === srcStripped) return false;
  return true;
}

async function fetchOne(lang, phrase) {
  try {
    const t = await gtranslate(phrase, lang.apiCode);
    if (isOk(t, phrase)) return { ...lang, text: t };
  } catch { /* continue */ }
  try {
    const t = await mymemory(phrase, lang.apiCode);
    if (isOk(t, phrase)) return { ...lang, text: t };
  } catch { /* continue */ }
  return null;
}

// ── Speed helpers ─────────────────────────────────────────────────────────────

function speedToMs(v) {
  // speed 1 (very slow) → 22 000ms; speed 5 (medium) → ~13 600ms; speed 10 (fast) → 3 000ms
  return Math.round(22000 - (+v - 1) * 2111);
}

function speedLabel(v) {
  v = +v;
  if (v <= 2)  return 'Very Slow';
  if (v <= 4)  return 'Slow';
  if (v <= 6)  return 'Medium';
  if (v <= 8)  return 'Brisk';
  return 'Fast';
}

// ── App ───────────────────────────────────────────────────────────────────────

class App {
  constructor() {
    // DOM refs
    this.$canvas      = document.getElementById('stage');
    this.$input       = document.getElementById('phraseInput');
    this.$animBtn     = document.getElementById('animateBtn');
    this.$loadCount   = document.getElementById('loadCount');
    this.$loadItems   = document.getElementById('loadingItems');
    this.$counter     = document.getElementById('langCounter');
    this.$progFill    = document.getElementById('progressFill');
    this.$backBtn     = document.getElementById('backBtn');
    this.$ppBtn       = document.getElementById('playPauseBtn');
    this.$ppPause     = document.getElementById('pauseIcon');
    this.$ppPlay      = document.getElementById('playIcon');
    this.$vidBtn      = document.getElementById('exportVideoBtn');
    this.$gifBtn      = document.getElementById('exportGifBtn');
    this.$toast       = document.getElementById('toast');
    this.$speedSlider = document.getElementById('speedSlider');
    this.$speedVal    = document.getElementById('speedVal');
    this.$caption     = document.getElementById('boardCaption');
    this.$modeBtns    = document.querySelectorAll('.mode-btn');

    // State
    this.phrase       = '';
    this.translations = [];
    this.isPaused     = false;
    this.isLooping    = true;
    this.isExporting  = false;
    this.toastTimer   = null;
    this._isPreview   = false;
    this._previewData = null;

    // Stage engine
    this.stage            = new Stage(this.$canvas);
    this.stage.onLangChange = i => this._onLang(i);
    this.stage.onComplete   = () => this._onComplete();
    this.stage.setLoop(true);
    this.stage.start();

    // Resize observer
    const ro = new ResizeObserver(() => this.stage.resize());
    ro.observe(this.$canvas);

    this._bindEvents();
    this._renderLangBadges();
    this._syncSpeedLabel();
    this._autoPlayPreview();
  }

  // ── Speed ──────────────────────────────────────────────────────────────────
  _getSpeed()   { return parseInt(this.$speedSlider?.value || '5', 10); }
  _getTotalMs() { return speedToMs(this._getSpeed()); }

  _syncSpeedLabel() {
    if (this.$speedVal) this.$speedVal.textContent = speedLabel(this._getSpeed());
  }

  // ── Auto-preview "love" on load ────────────────────────────────────────────
  async _autoPlayPreview() {
    await document.fonts.ready;
    this._isPreview = true;
    try {
      const data = await this._fetchAll('love', true);
      if (data.length >= 4 && this._isPreview) {
        this._previewData = data;
        this.$caption?.classList.remove('hidden');
        this.stage.setLoop(true);
        this.stage.play(data, speedToMs(1));
      }
    } catch { /* network unavailable — silent */ }
  }

  _restartPreview() {
    if (!this._previewData?.length) return;
    this._isPreview = true;
    this.$caption?.classList.remove('hidden');
    this.stage.setLoop(true);
    this.stage.play(this._previewData, speedToMs(1));
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  _bindEvents() {
    this.$animBtn.addEventListener('click',   () => this._run());
    this.$input.addEventListener('keydown',   e  => { if (e.key === 'Enter') this._run(); });
    this.$backBtn.addEventListener('click',   () => this._back());
    this.$ppBtn.addEventListener('click',     () => this._togglePause());
    this.$vidBtn.addEventListener('click',    () => this._exportVideo());
    this.$gifBtn.addEventListener('click',    () => this._exportGIF());

    // Speed slider: real-time label update + live pace change during playback
    this.$speedSlider?.addEventListener('input', () => {
      this._syncSpeedLabel();
      // Only update live if playing user's own phrase (not preview)
      if (this._state() === 'playing' && !this._isPreview) {
        this.stage.setSpeed(this._getTotalMs());
      }
    });

    // Mode toggle (Morph / Flip)
    this.$modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.$modeBtns.forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        this.stage.setMode(mode);
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._back();
      if (e.key === ' ' && this._state() === 'playing') { e.preventDefault(); this._togglePause(); }
    });
  }

  // ── State machine ──────────────────────────────────────────────────────────
  _state() {
    if (!document.getElementById('loadingPanel').classList.contains('hidden')) return 'loading';
    if (!document.getElementById('playbackPanel').classList.contains('hidden')) return 'playing';
    return 'idle';
  }

  _show(state) {
    ['badgesPanel', 'loadingPanel', 'playbackPanel'].forEach(id =>
      document.getElementById(id)?.classList.toggle('hidden', true)
    );
    document.getElementById(
      state === 'idle'    ? 'badgesPanel'   :
      state === 'loading' ? 'loadingPanel' : 'playbackPanel'
    )?.classList.remove('hidden');
  }

  // ── Animate ────────────────────────────────────────────────────────────────
  async _run() {
    const phrase = this.$input.value.trim();
    if (!phrase) {
      this.$input.classList.add('shake');
      this.$input.focus();
      setTimeout(() => this.$input.classList.remove('shake'), 500);
      return;
    }

    this._isPreview = false;
    this.$caption?.classList.add('hidden');
    this.stage.halt();

    this.phrase = phrase;
    this.$loadCount.textContent = '0';
    this.$loadItems.innerHTML   = '';
    this._show('loading');

    try {
      this.translations = await this._fetchAll(phrase, false);

      if (this.translations.length < 2) {
        this._toast('Couldn\'t reach the translation API. Check your connection.', 'error');
        this._show('idle');
        return;
      }

      await document.fonts.ready;
      this._show('playing');
      this.isPaused = false;
      this._syncPP();
      this.stage.setLoop(this.isLooping);
      this.stage.play(this.translations, this._getTotalMs());

    } catch (err) {
      console.error(err);
      this._toast('Something went wrong.', 'error');
      this._show('idle');
    }
  }

  async _fetchAll(phrase, quiet) {
    const results = [{
      code: 'en', apiCode: 'en', name: 'English', native: 'English', dir: 'ltr', text: phrase,
    }];
    let done = 0;

    await Promise.all(LANGUAGES.map(async lang => {
      const item = await fetchOne(lang, phrase);
      if (item) {
        results.push(item);
        done++;
        if (!quiet) {
          this.$loadCount.textContent = done;
          const span = document.createElement('span');
          span.className   = 'load-item';
          span.textContent = `${lang.native} · ${item.text}`;
          this.$loadItems.appendChild(span);
          this.$loadItems.scrollTop = this.$loadItems.scrollHeight;
        }
      }
    }));

    return results;
  }

  // ── Callbacks ──────────────────────────────────────────────────────────────
  _onLang({ index, total }) {
    this.$counter.textContent  = `${index + 1} / ${total}`;
    this.$progFill.style.width = `${((index + 1) / total) * 100}%`;
  }

  _onComplete() {
    if (this._isPreview) return;
    this._syncPP();
    this.$ppPlay.classList.remove('hidden');
    this.$ppPause.classList.add('hidden');
    this.isPaused = true;
  }

  // ── Controls ───────────────────────────────────────────────────────────────
  _back() {
    if (this._state() === 'idle') return;
    this._isPreview = false;
    this.stage.halt();
    this._show('idle');
    this.$input.focus();
    setTimeout(() => this._restartPreview(), 80);
  }

  _togglePause() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.stage.pause();
    } else {
      if (!this.stage.isPlaying) {
        this.stage.play(this.translations, this._getTotalMs());
      } else {
        this.stage.resume();
      }
    }
    this._syncPP();
  }

  _syncPP() {
    this.$ppPause.classList.toggle('hidden',  this.isPaused);
    this.$ppPlay.classList.toggle('hidden',  !this.isPaused);
  }

  // ── Export — Video ─────────────────────────────────────────────────────────
  async _exportVideo() {
    if (this.isExporting) return;
    // Prefer WebCodecs → MP4 (Chrome 94+); fall back to MediaRecorder
    if (typeof VideoEncoder !== 'undefined' && typeof Mp4Muxer !== 'undefined') {
      return this._exportMP4WebCodecs();
    }
    // Safari: native MP4 recording
    const mimeOrder = [
      { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
      { mime: 'video/mp4',             ext: 'mp4' },
      { mime: 'video/webm;codecs=vp9', ext: 'webm' },
      { mime: 'video/webm;codecs=vp8', ext: 'webm' },
      { mime: 'video/webm',            ext: 'webm' },
    ];
    const chosen = mimeOrder.find(({ mime }) => MediaRecorder?.isTypeSupported(mime));
    if (!chosen) { this._toast('Video export not supported in this browser.', 'error'); return; }
    return this._exportMediaRecorder(chosen.mime, chosen.ext);
  }

  async _exportMP4WebCodecs() {
    this.isExporting = true;
    this.stage.exportMode = true;
    this._toast('Recording…', 'info');

    let fallbackToWebM = false;
    try {
      // Instagram Reels/Stories spec: 1080x1920, 60fps, H.264 High Profile
      const W   = 1080, H = 1920;
      const FPS = 60;
      const ms  = this._getTotalMs();
      const frameMs = 1000 / FPS;

      const exportCanvas = new OffscreenCanvas(W, H);

      const target = new Mp4Muxer.ArrayBufferTarget();
      const muxer  = new Mp4Muxer.Muxer({
        target,
        video: { codec: 'avc', width: W, height: H },
        fastStart: 'in-memory',
      });

      let encodeError = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error:  e => { encodeError = e; },
      });

      // avc1.640033 = H.264 High Profile Level 5.1 — supports 1080x1920@60fps
      const cfg = { codec: 'avc1.640033', width: W, height: H, bitrate: 15_000_000, framerate: FPS };
      const support = await VideoEncoder.isConfigSupported(cfg);
      if (!support.supported) throw new Error('H.264 High Profile not supported');
      encoder.configure(cfg);

      this.stage.setLoop(false);
      this.stage.play(this.translations, ms);
      this.isPaused = false;
      this._syncPP();

      let done = false;
      let frameIndex = 0;
      const prev = this.stage.onComplete;
      this.stage.onComplete = () => { done = true; this.stage.onComplete = prev; };

      await new Promise(resolve => {
        const captureFrame = () => {
          if (encodeError || done || frameIndex * frameMs > ms + 300) { resolve(); return; }
          const timestamp = Math.round(frameIndex * (1_000_000 / FPS));
          try {
            this.stage._drawExportFrame(exportCanvas, W, H);
            const vf = new VideoFrame(exportCanvas, { timestamp });
            encoder.encode(vf, { keyFrame: frameIndex % (FPS * 2) === 0 });
            vf.close();
          } catch { /* skip if state isn't ready yet */ }
          frameIndex++;
          setTimeout(captureFrame, frameMs);
        };
        captureFrame();
        setTimeout(resolve, ms + 2000);
      });

      if (encodeError) throw encodeError;
      await encoder.flush();
      muxer.finalize();

      this._dl(new Blob([target.buffer], { type: 'video/mp4' }), `asku-lasku-${this._slug()}.mp4`);
      this._toast('Video saved!', 'success');

    } catch (e) {
      console.error('MP4 WebCodecs export failed:', e);
      fallbackToWebM = true;
    } finally {
      this.isExporting = false;
      this.stage.exportMode = false;
      this.stage.setLoop(this.isLooping);
    }

    if (fallbackToWebM) {
      const webmMime = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
        .find(m => MediaRecorder?.isTypeSupported(m));
      if (webmMime) return this._exportMediaRecorder(webmMime, 'webm');
      this._toast('Video export failed.', 'error');
    }
  }

  async _exportMediaRecorder(mime, ext) {
    if (!window.MediaRecorder) { this._toast('MediaRecorder not supported.', 'error'); return; }
    this.isExporting = true;
    this.stage.exportMode = true;
    this._toast('Recording…', 'info');
    try {
      const ms     = this._getTotalMs();
      const stream = this.$canvas.captureStream(30);
      const rec    = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

      this.stage.setLoop(false);
      this.stage.play(this.translations, ms);
      this.isPaused = false;
      this._syncPP();

      rec.start(80);
      await new Promise(resolve => {
        const prev = this.stage.onComplete;
        this.stage.onComplete = () => { this.stage.onComplete = prev; resolve(); };
        setTimeout(resolve, ms + 1500);
      });
      rec.stop();
      await new Promise(r => { rec.onstop = r; });

      this._dl(new Blob(chunks, { type: mime }), `asku-lasku-${this._slug()}.${ext}`);
      this._toast('Video saved!', 'success');
    } catch (e) {
      console.error(e);
      this._toast('Video export failed.', 'error');
    } finally {
      this.isExporting = false;
      this.stage.exportMode = false;
      this.stage.setLoop(this.isLooping);
    }
  }

  // ── Export — GIF ───────────────────────────────────────────────────────────
  async _exportGIF() {
    if (this.isExporting) return;
    if (typeof GIF === 'undefined') { this._toast('GIF library not loaded — try Video.', 'error'); return; }

    this.isExporting = true;
    this.stage.exportMode = true;
    this._toast('Capturing frames…', 'info');

    try {
      const scale = Math.min(1, 480 / this.stage.W);
      const W     = Math.round(this.stage.W * scale);
      const H     = Math.round(this.stage.H * scale);

      const gif = new GIF({ workers: 2, quality: 8, width: W, height: H, workerScript: 'vendor/gif.worker.js' });
      gif.on('progress', p => this._toast(`Encoding GIF… ${Math.round(p * 100)}%`, 'info'));
      gif.on('finished', blob => {
        this._dl(blob, `asku-lasku-${this._slug()}.gif`);
        this._toast('GIF saved!', 'success');
        this.isExporting = false;
        this.stage.exportMode = false;
        this.stage.setLoop(this.isLooping);
        this.stage.play(this.translations, this._getTotalMs());
      });

      const tmp = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const tc  = tmp.getContext('2d');
      const FPS = 15, fMs = 1000 / FPS;
      const ms  = this._getTotalMs();

      this.stage.setLoop(false);
      this.stage.play(this.translations, ms);
      this.isPaused = false;
      this._syncPP();

      let done = false;
      const prev = this.stage.onComplete;
      this.stage.onComplete = () => { this.stage.onComplete = prev; done = true; };

      await new Promise(resolve => {
        const frame = () => {
          if (done) { resolve(); return; }
          tc.drawImage(this.$canvas, 0, 0, this.$canvas.width, this.$canvas.height, 0, 0, W, H);
          gif.addFrame(tc, { delay: Math.round(fMs), copy: true });
          setTimeout(frame, fMs);
        };
        frame();
        setTimeout(resolve, ms + 1500);
      });

      gif.render();
    } catch (e) {
      console.error(e);
      this._toast('GIF export failed.', 'error');
      this.isExporting = false;
      this.stage.exportMode = false;
      this.stage.setLoop(this.isLooping);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _dl(blob, name) {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: name
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }

  _slug() {
    return this.phrase.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28) || 'phrase';
  }

  _toast(msg, type = 'info') {
    clearTimeout(this.toastTimer);
    Object.assign(this.$toast, { textContent: msg, className: `toast ${type}` });
    this.$toast.classList.remove('hidden');
    if (type !== 'info') this.toastTimer = setTimeout(() => this.$toast.classList.add('hidden'), 4000);
  }

  _renderLangBadges() {
    const el   = document.getElementById('langBadges');
    const show = LANGUAGES.slice(0, 10);
    el.innerHTML =
      show.map(l => `<span class="badge">${l.native}</span>`).join('') +
      `<span class="badge dim">+${LANGUAGES.length - show.length} more</span>`;
  }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
