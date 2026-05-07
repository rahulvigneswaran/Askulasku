'use strict';

// ── Translation ───────────────────────────────────────────────────────────────

async function gtranslate(text, langCode) {
  // Unofficial Google Translate endpoint — no API key needed
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
  // Reject if it's basically a copy of the source with different punctuation
  const stripped = t.replace(/[^a-z]/gi, '').toLowerCase();
  const srcStripped = source.replace(/[^a-z]/gi, '').toLowerCase();
  if (stripped === srcStripped) return false;
  return true;
}

async function fetchOne(lang, phrase) {
  // Google Translate first, MyMemory as fallback
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

// ── App ───────────────────────────────────────────────────────────────────────

class App {
  constructor() {
    // Elements
    this.$canvas    = document.getElementById('stage');
    this.$input     = document.getElementById('phraseInput');
    this.$animBtn   = document.getElementById('animateBtn');
    this.$loadCount = document.getElementById('loadCount');
    this.$loadItems = document.getElementById('loadingItems');
    this.$counter   = document.getElementById('langCounter');
    this.$progFill  = document.getElementById('progressFill');
    this.$backBtn   = document.getElementById('backBtn');
    this.$ppBtn     = document.getElementById('playPauseBtn');
    this.$ppPause   = document.getElementById('pauseIcon');
    this.$ppPlay    = document.getElementById('playIcon');
    this.$loopBtn   = document.getElementById('loopBtn');
    this.$vidBtn    = document.getElementById('exportVideoBtn');
    this.$gifBtn    = document.getElementById('exportGifBtn');
    this.$toast     = document.getElementById('toast');
    this.$themeBtn  = document.getElementById('themeToggle');

    // State
    this.phrase      = '';
    this.translations = [];
    this.isPaused    = false;
    this.isLooping   = false;
    this.isExporting = false;
    this.toastTimer  = null;

    // Stage
    this.stage            = new Stage(this.$canvas);
    this.stage.onLangChange = i => this._onLang(i);
    this.stage.onComplete   = () => this._onComplete();
    this.stage.start();

    // Resize observer
    const ro = new ResizeObserver(() => this.stage.resize());
    ro.observe(this.$canvas);

    this._initTheme();
    this._bindEvents();
    this._renderLangBadges();
  }

  // ── Theme ──────────────────────────────────────────────────────────────────
  _initTheme() {
    const saved = localStorage.getItem('alTheme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    this._syncThemeIcon(theme);
  }

  _toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('alTheme', next);
    this._syncThemeIcon(next);
  }

  _syncThemeIcon(theme) {
    if (!this.$themeBtn) return;
    this.$themeBtn.textContent = theme === 'dark' ? '☀' : '☽';
    this.$themeBtn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  _bindEvents() {
    this.$animBtn.addEventListener('click',   () => this._run());
    this.$input.addEventListener('keydown',   e  => { if (e.key === 'Enter') this._run(); });
    this.$backBtn.addEventListener('click',   () => this._back());
    this.$ppBtn.addEventListener('click',     () => this._togglePause());
    this.$loopBtn.addEventListener('click',   () => this._toggleLoop());
    this.$vidBtn.addEventListener('click',    () => this._exportVideo());
    this.$gifBtn.addEventListener('click',    () => this._exportGIF());
    this.$themeBtn?.addEventListener('click', () => this._toggleTheme());

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape')  this._back();
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
    ['inputPanel','loadingPanel','playbackPanel'].forEach(id => {
      document.getElementById(id)?.classList.toggle('hidden', true);
    });
    document.getElementById(
      state === 'idle' ? 'inputPanel' :
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

    this.phrase = phrase;
    this.$loadCount.textContent = '0';
    this.$loadItems.innerHTML   = '';
    this._show('loading');

    try {
      this.translations = await this._fetchAll(phrase);

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
      this.stage.play(this.translations);

    } catch (err) {
      console.error(err);
      this._toast('Something went wrong.', 'error');
      this._show('idle');
    }
  }

  async _fetchAll(phrase) {
    // English always first
    const results = [{
      code: 'en', apiCode: 'en', name: 'English', native: 'English', dir: 'ltr', text: phrase,
    }];

    let done = 0;

    const promises = LANGUAGES.map(async lang => {
      const item = await fetchOne(lang, phrase);
      if (item) {
        results.push(item);
        done++;
        this.$loadCount.textContent = done;
        const span = document.createElement('span');
        span.className   = 'load-item';
        span.textContent = `${lang.native} · ${item.text}`;
        this.$loadItems.appendChild(span);
        this.$loadItems.scrollTop = this.$loadItems.scrollHeight;
      }
    });

    await Promise.all(promises);
    return results;
  }

  // ── Callbacks ──────────────────────────────────────────────────────────────
  _onLang({ index, total }) {
    this.$counter.textContent     = `${index + 1} / ${total}`;
    this.$progFill.style.width    = `${((index + 1) / total) * 100}%`;
  }

  _onComplete() {
    // Show replay affordance
    this._syncPP();
    this.$ppPlay.classList.remove('hidden');
    this.$ppPause.classList.add('hidden');
    this.isPaused = true;
  }

  // ── Controls ───────────────────────────────────────────────────────────────
  _back() {
    if (this._state() === 'idle') return;
    this.stage.halt();
    this._show('idle');
    this.$input.value = this.phrase;
    setTimeout(() => this.$input.focus(), 80);
  }

  _togglePause() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.stage.pause();
    } else {
      // If completed, restart
      if (!this.stage.isPlaying) {
        this.stage.play(this.translations);
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

  _toggleLoop() {
    this.isLooping = !this.isLooping;
    this.stage.setLoop(this.isLooping);
    this.$loopBtn.classList.toggle('active', this.isLooping);
    this.$loopBtn.setAttribute('aria-pressed', String(this.isLooping));
  }

  // ── Export — Video ─────────────────────────────────────────────────────────
  async _exportVideo() {
    if (this.isExporting) return;
    if (!window.MediaRecorder) { this._toast('MediaRecorder not supported.', 'error'); return; }

    const mime = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
      .find(m => MediaRecorder.isTypeSupported(m));
    if (!mime) { this._toast('No supported video codec.', 'error'); return; }

    this.isExporting = true;
    this._toast('Recording…', 'info');

    try {
      const stream   = this.$canvas.captureStream(30);
      const rec      = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks   = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

      // Re-play from start, no loop
      this.stage.setLoop(false);
      this.stage.play(this.translations);
      this.isPaused = false;
      this._syncPP();

      rec.start(80);
      await new Promise(resolve => {
        const prev = this.stage.onComplete;
        this.stage.onComplete = () => { this.stage.onComplete = prev; resolve(); };
        setTimeout(resolve, 6500); // safety cap
      });
      rec.stop();
      await new Promise(r => { rec.onstop = r; });

      this._dl(new Blob(chunks, { type: mime }), `asku-lasku-${this._slug()}.webm`);
      this._toast('Video saved!', 'success');
    } catch (e) {
      console.error(e);
      this._toast('Video export failed.', 'error');
    } finally {
      this.isExporting = false;
      this.stage.setLoop(this.isLooping);
    }
  }

  // ── Export — GIF ───────────────────────────────────────────────────────────
  async _exportGIF() {
    if (this.isExporting) return;
    if (typeof GIF === 'undefined') { this._toast('GIF library not loaded — try Video.', 'error'); return; }

    this.isExporting = true;
    this._toast('Capturing frames…', 'info');

    try {
      const scale = Math.min(1, 640 / this.stage.W);
      const W     = Math.round(this.stage.W * scale);
      const H     = Math.round(this.stage.H * scale);

      const gif = new GIF({ workers: 2, quality: 8, width: W, height: H, workerScript: 'vendor/gif.worker.js' });
      gif.on('progress', p => this._toast(`Encoding GIF… ${Math.round(p * 100)}%`, 'info'));
      gif.on('finished', blob => {
        this._dl(blob, `asku-lasku-${this._slug()}.gif`);
        this._toast('GIF saved!', 'success');
        this.isExporting = false;
        this.stage.setLoop(this.isLooping);
        this.stage.play(this.translations);
      });

      const tmp = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const tc  = tmp.getContext('2d');
      const FPS = 15, fMs = 1000 / FPS;

      this.stage.setLoop(false);
      this.stage.play(this.translations);
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
        setTimeout(resolve, 6500); // safety cap
      });

      gif.render();
    } catch (e) {
      console.error(e);
      this._toast('GIF export failed.', 'error');
      this.isExporting = false;
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
    const show = LANGUAGES.slice(0, 12);
    el.innerHTML =
      show.map(l => `<span class="badge">${l.native}</span>`).join('') +
      `<span class="badge dim">+${LANGUAGES.length - show.length} more</span>`;
  }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
