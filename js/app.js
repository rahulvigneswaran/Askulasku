'use strict';

class App {
  constructor() {
    // Elements
    this.canvas         = document.getElementById('stage');
    this.phraseInput    = document.getElementById('phraseInput');
    this.animateBtn     = document.getElementById('animateBtn');
    this.loadCount      = document.getElementById('loadCount');
    this.loadingLangs   = document.getElementById('loadingLangs');
    this.langCounter    = document.getElementById('langCounter');
    this.progressFill   = document.getElementById('progressFill');
    this.backBtn        = document.getElementById('backBtn');
    this.playPauseBtn   = document.getElementById('playPauseBtn');
    this.pauseIcon      = document.getElementById('pauseIcon');
    this.playIcon       = document.getElementById('playIcon');
    this.loopBtn        = document.getElementById('loopBtn');
    this.exportVideoBtn = document.getElementById('exportVideoBtn');
    this.exportGifBtn   = document.getElementById('exportGifBtn');
    this.toastEl        = document.getElementById('toast');

    // State
    this.phrase      = '';
    this.translations = [];
    this.isPaused    = false;
    this.isLooping   = true;
    this.isExporting = false;
    this.toastTimer  = null;

    // Stage
    this.stage = new Stage(this.canvas);
    this.stage.onLangChange = info => this._onLangChange(info);
    this.stage.onEnd        = ()   => this._onAnimEnd();
    this.stage.start();

    window.addEventListener('resize', () => this.stage.resize());

    this._bindEvents();
    this._renderLangBadges();
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  _bindEvents() {
    this.animateBtn.addEventListener('click', () => this._handleAnimate());
    this.phraseInput.addEventListener('keydown', e => { if (e.key === 'Enter') this._handleAnimate(); });

    this.backBtn.addEventListener('click', () => this._handleBack());
    this.playPauseBtn.addEventListener('click', () => this._togglePause());

    this.loopBtn.addEventListener('click', () => {
      this.isLooping = !this.isLooping;
      this.stage.setLoop(this.isLooping);
      this.loopBtn.classList.toggle('active', this.isLooping);
    });

    this.exportVideoBtn.addEventListener('click', () => this._exportVideo());
    this.exportGifBtn.addEventListener('click',   () => this._exportGIF());

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._handleBack();
      if (e.key === ' ' && this._getState() === 'playing') {
        e.preventDefault();
        this._togglePause();
      }
    });
  }

  // ── State machine ──────────────────────────────────────────────────────────
  _getState() {
    if (!document.getElementById('loadingPanel').classList.contains('hidden')) return 'loading';
    if (!document.getElementById('playbackPanel').classList.contains('hidden')) return 'playing';
    return 'idle';
  }

  _setState(state) {
    const show = id => document.getElementById(id).classList.remove('hidden');
    const hide = id => document.getElementById(id).classList.add('hidden');
    ['inputPanel', 'loadingPanel', 'playbackPanel'].forEach(hide);
    if (state === 'idle')    show('inputPanel');
    if (state === 'loading') show('loadingPanel');
    if (state === 'playing') show('playbackPanel');
  }

  // ── Animate ────────────────────────────────────────────────────────────────
  async _handleAnimate() {
    const phrase = this.phraseInput.value.trim();
    if (!phrase) {
      this.phraseInput.focus();
      this.phraseInput.classList.add('shake');
      setTimeout(() => this.phraseInput.classList.remove('shake'), 600);
      return;
    }

    this.phrase = phrase;
    this.loadCount.textContent = '0';
    this.loadingLangs.innerHTML = '';
    this._setState('loading');

    try {
      this.translations = await this._fetchAll(phrase);

      if (this.translations.length === 0) {
        this._showToast('No translations received — check your connection.', 'error');
        this._setState('idle');
        return;
      }

      this._setState('playing');
      this.isPaused = false;
      this._syncPlayPauseUI();

      await document.fonts.ready;
      this.stage.setLoop(this.isLooping);
      this.stage.play(this.translations);
    } catch (err) {
      console.error(err);
      this._showToast('Something went wrong. Please try again.', 'error');
      this._setState('idle');
    }
  }

  async _fetchAll(phrase) {
    // English is always first
    const results = [{
      code: 'en', apiCode: 'en',
      name: 'English', native: 'English',
      dir: 'ltr', text: phrase,
    }];

    const promises = LANGUAGES.map(async lang => {
      try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(phrase)}&langpair=en|${lang.apiCode}`;
        const res  = await fetch(url);
        const data = await res.json();

        if (data.responseStatus === 200) {
          const text = (data.responseData.translatedText || '').trim();
          // Discard if identical to source or suspiciously short/long
          if (text && text.toLowerCase() !== phrase.toLowerCase() && text.length <= phrase.length * 5) {
            results.push({ ...lang, text });

            // Update loading UI
            const n = results.length - 1; // minus english
            this.loadCount.textContent = n;
            const span = document.createElement('span');
            span.className = 'load-badge';
            span.textContent = `${lang.native} · ${text}`;
            this.loadingLangs.appendChild(span);
            this.loadingLangs.scrollTop = this.loadingLangs.scrollHeight;
          }
        }
      } catch { /* skip */ }
    });

    await Promise.all(promises);
    return results;
  }

  // ── Playback callbacks ─────────────────────────────────────────────────────
  _onLangChange({ index, total, color }) {
    this.langCounter.textContent = `${index + 1} / ${total}`;
    this.progressFill.style.width      = `${((index + 1) / total) * 100}%`;
    this.progressFill.style.background = color;
    this.progressFill.style.boxShadow  = `0 0 12px ${color}`;
  }

  _onAnimEnd() { /* no-op — loop handles re-start */ }

  _handleBack() {
    if (this._getState() === 'idle') return;
    this.stage.halt();
    this._setState('idle');
    this.phraseInput.value = this.phrase;
    setTimeout(() => this.phraseInput.focus(), 100);
  }

  _togglePause() {
    if (this._getState() !== 'playing') return;
    this.isPaused = !this.isPaused;
    this.isPaused ? this.stage.pause() : this.stage.resume();
    this._syncPlayPauseUI();
  }

  _syncPlayPauseUI() {
    this.pauseIcon.classList.toggle('hidden', this.isPaused);
    this.playIcon.classList.toggle('hidden', !this.isPaused);
  }

  // ── Export — Video (WebM) ─────────────────────────────────────────────────
  async _exportVideo() {
    if (this.isExporting) return;
    if (!window.MediaRecorder) {
      this._showToast('Your browser does not support video capture.', 'error');
      return;
    }

    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find(m => MediaRecorder.isTypeSupported(m));
    if (!mime) { this._showToast('Video codec not supported.', 'error'); return; }

    this.isExporting = true;
    this._showToast('Recording video — one full cycle…', 'info');

    try {
      const stream   = this.canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks   = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

      // Reset to start
      this.stage.play(this.translations);
      this.isPaused = false;
      this._syncPlayPauseUI();

      // Record until one full cycle
      const cycleDur = this.translations.length *
        (this.stage.ENTER_DUR + this.stage.HOLD_DUR + this.stage.EXIT_DUR);

      recorder.start(100); // collect in 100ms chunks

      await new Promise(r => setTimeout(r, cycleDur + 800));
      recorder.stop();
      await new Promise(r => { recorder.onstop = r; });

      const blob = new Blob(chunks, { type: mime });
      this._download(blob, `asku-lasku-${this._slug()}.webm`);
      this._showToast('Video saved!', 'success');
    } catch (err) {
      console.error(err);
      this._showToast('Video export failed.', 'error');
    } finally {
      this.isExporting = false;
    }
  }

  // ── Export — GIF ──────────────────────────────────────────────────────────
  async _exportGIF() {
    if (this.isExporting) return;
    if (typeof GIF === 'undefined') {
      this._showToast('GIF library not available — try Video instead.', 'error');
      return;
    }

    this.isExporting = true;
    this._showToast('Capturing frames…', 'info');

    try {
      // Capture at half logical resolution for a manageable file
      const W = Math.max(320, Math.floor(this.stage.W * 0.5));
      const H = Math.max(180, Math.floor(this.stage.H * 0.5));

      const gif = new GIF({
        workers:      2,
        quality:      8,
        width:        W,
        height:       H,
        workerScript: 'vendor/gif.worker.js',
        dither:       false,
      });

      gif.on('progress', p => {
        this._showToast(`Encoding GIF… ${Math.round(p * 100)}%`, 'info');
      });

      gif.on('finished', blob => {
        this._download(blob, `asku-lasku-${this._slug()}.gif`);
        this._showToast('GIF saved!', 'success');
        this.isExporting = false;
        // resume normal looping play
        this.stage.setLoop(this.isLooping);
        this.stage.play(this.translations);
      });

      // Temp canvas for downscaling
      const tmp    = document.createElement('canvas');
      tmp.width    = W; tmp.height = H;
      const tmpCtx = tmp.getContext('2d');

      const FPS          = 15;
      const frameMs      = 1000 / FPS;
      const cycleDur     = this.translations.length *
        (this.stage.ENTER_DUR + this.stage.HOLD_DUR + this.stage.EXIT_DUR);

      // Play from beginning (no loop so we stop cleanly)
      this.stage.setLoop(false);
      this.stage.play(this.translations);
      this.isPaused = false;
      this._syncPlayPauseUI();

      let captured = false;
      const originalOnEnd = this.stage.onEnd;
      this.stage.onEnd = () => {
        captured = true;
        this.stage.onEnd = originalOnEnd;
      };

      // Frame capture loop
      const startAt = performance.now();
      await new Promise(resolve => {
        const captureFrame = () => {
          if (captured || performance.now() - startAt > cycleDur + 2000) {
            resolve(); return;
          }
          // Draw main canvas → temp canvas (downscaled)
          tmpCtx.drawImage(
            this.canvas,
            0, 0, this.canvas.width, this.canvas.height,
            0, 0, W, H
          );
          gif.addFrame(tmpCtx, { delay: Math.round(frameMs), copy: true });
          setTimeout(captureFrame, frameMs);
        };
        captureFrame();
      });

      gif.render();
    } catch (err) {
      console.error(err);
      this._showToast('GIF export failed.', 'error');
      this.isExporting = false;
      this.stage.setLoop(this.isLooping);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  _slug() {
    return this.phrase.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  }

  _showToast(msg, type = 'info') {
    clearTimeout(this.toastTimer);
    this.toastEl.textContent = msg;
    this.toastEl.className   = `toast ${type}`;
    this.toastEl.classList.remove('hidden');
    if (type !== 'info') {
      this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), 4500);
    }
  }

  _renderLangBadges() {
    const container = document.getElementById('langBadges');
    const shown     = LANGUAGES.slice(0, 14);
    container.innerHTML =
      shown.map(l => `<span class="lang-badge">${l.native}</span>`).join('') +
      `<span class="lang-badge dim">+${LANGUAGES.length - shown.length} more</span>`;
  }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
