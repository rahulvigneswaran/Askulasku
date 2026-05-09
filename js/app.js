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
    this.stage.watermarkText = window.location.hostname || 'sayitineverylanguage.com';

    // Resize observer
    const ro = new ResizeObserver(() => this.stage.resize());
    ro.observe(this.$canvas);

    this._bindEvents();
    this._renderLangBadges();
    this._syncSpeedLabel();
    this._autoPlayPreview();
  }

  // ── Speed ──────────────────────────────────────────────────────────────────
  _getSpeed()   { return parseInt(this.$speedSlider?.value || '1', 10); }
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
    document.getElementById('downloadBtn')?.addEventListener('click',  () => this._download());
    document.getElementById('shareBtn')?.addEventListener('click',     () => this._share());
    document.getElementById('whatsappBtn')?.addEventListener('click',  () => this._shareWhatsApp());

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

  // ── Export — shared render ─────────────────────────────────────────────────
  async _renderVideoBlob() {
    this.isExporting = true;
    this.stage.exportMode = true;
    this._toast('Recording…', 'info');

    try {
      // Instagram Reels/Stories spec: 1080x1920, 30fps, H.264 High Profile
      const W   = 1080, H = 1920;
      const FPS = 30;
      const ms  = this._getTotalMs();
      const frameMs       = 1000 / FPS;
      const frameDuration = Math.round(1_000_000 / FPS);

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

      // avc1.640033 = H.264 High Profile Level 5.1 — supports 1080x1920@30fps
      // latencyMode:'realtime' disables B-frames so PTS == DTS — prevents mp4-muxer timing drift
      const cfg = {
        codec: 'avc1.640033', width: W, height: H,
        bitrate: 8_000_000, framerate: FPS,
        latencyMode: 'realtime',
      };
      const support = await VideoEncoder.isConfigSupported(cfg);
      if (!support.supported) throw new Error('H.264 High Profile not supported');
      encoder.configure(cfg);

      this.stage.setLoop(false);
      this.stage.play(this.translations, ms);
      this.stage.pause();
      this.isPaused = false;
      this._syncPP();

      let simulatedMs = 0;
      let frameIndex  = 0;

      await new Promise(resolve => {
        const captureFrame = () => {
          if (encodeError || simulatedMs >= ms) { resolve(); return; }
          const timestamp = frameIndex * frameDuration;
          try {
            this.stage._drawExportFrame(exportCanvas, W, H);
            const vf = new VideoFrame(exportCanvas, { timestamp, duration: frameDuration });
            encoder.encode(vf, { keyFrame: frameIndex % (FPS * 2) === 0 });
            vf.close();
            this.stage.stepExport(frameMs);
            simulatedMs += frameMs;
          } catch (e) { console.error('frame export error', e); }
          frameIndex++;
          setTimeout(captureFrame, 0);
        };
        captureFrame();
      });

      if (encodeError) throw encodeError;
      await encoder.flush();
      muxer.finalize();

      return new Blob([target.buffer], { type: 'video/mp4' });

    } catch (e) {
      console.error('MP4 WebCodecs export failed:', e);
      return null;
    } finally {
      this.isExporting = false;
      this.stage.exportMode = false;
      this.stage.resume();
      this.stage.setLoop(this.isLooping);
    }
  }

  async _download() {
    if (this.isExporting) return;
    const blob = await this._renderVideoBlob();
    if (!blob) { this._toast('Export failed.', 'error'); return; }
    this._dl(blob, `asku-lasku-${this._slug()}.mp4`);
    this._toast('Video saved!', 'success');
  }

  async _share() {
    if (this.isExporting) return;
    const blob = await this._renderVideoBlob();
    if (!blob) { this._toast('Export failed.', 'error'); return; }
    const file = new File([blob], `asku-lasku-${this._slug()}.mp4`, { type: 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Say it in every language', text: window.location.href });
      } catch (e) { if (e.name !== 'AbortError') this._toast('Share failed.', 'error'); }
    } else {
      this._dl(blob, `asku-lasku-${this._slug()}.mp4`);
      this._toast('Video saved! Upload it to Instagram as a Reel.', 'success');
    }
  }

  _shareWhatsApp() {
    const text = `Say it in every language 🌍\n${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
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