/**
 * Sitka Radio — v1 standalone prototype.
 *
 * Push-to-talk radio chatbot.
 * - Voice input via Web Speech API (webkitSpeechRecognition on iPad),
 *   with a server fallback: MediaRecorder → Whisper worker when Web
 *   Speech is unavailable or has failed on this device
 * - Text fallback always available
 * - SpeechSynthesis for spoken responses
 * - Thumbs up/down → localStorage (v2 will POST to Worker)
 * - Collapsible to 📻 badge
 *
 * Usage:
 *   import { RadioChatbot } from './radio-chatbot.js';
 *   const radio = new RadioChatbot(document.body);
 *   radio.mount();
 *
 *   // Feed live game state for dynamic slots:
 *   import { setGameState } from './responses.js';
 *   setGameState({ alt: 1500, speed: 90, dist: 5, dir: 'west' });
 */

import { matchIntent, setGameState } from './responses.js';
import { transcriptForRadio } from './place-name-corrections.js';

const FEEDBACK_KEY = 'sitka-radio-feedback-v1';

// Server-STT fallback: when Web Speech is unavailable — or has failed once
// on this device (iPad Safari) — PTT records with MediaRecorder and POSTs
// the clip to this Whisper worker instead. Transcription round-trip
// verified 2026-10-20 ("Fly to Sitka, then turn left toward Mount
// Edgecumbe." — Whisper returned "Edgecom", hence the correction pass).
const STT_URL = 'https://sitka-stt-poc.magnus-digennaro.workers.dev/';
const STT_MAX_MS = 15000; // MediaRecorder never auto-stops; hard cap.
const SERVER_STT_KEY = 'sr:server-stt'; // localStorage: prefer server path

// Simulated radio latency: 1–3s before response appears.
const LATENCY_MIN = 1000;
const LATENCY_MAX = 3000;

export class RadioChatbot {
  constructor(container) {
    this.container = container;
    this.root = null;
    this.transcriptEl = null;
    this.pttButton = null;
    this.textInput = null;
    this.badge = null;
    this.collapsed = false;
    this.recognition = null;
    this.listening = false;
    this.session = null; // per push-to-talk session token (see startListening)
    this.serverSTT = false; // MediaRecorder → Whisper worker available
    this.preferServerSTT = false; // use the server path for PTT
    this.serverRecorder = null; // active { recorder, stream, session, chunks }
    this.serverStopTimer = null;
    this.speechEnabled = true;
    this.waveformCanvas = null;
    this.waveformCtx = null;
    this.waveformAnim = null;
    this.feedback = this.loadFeedback();
    this.voicesReady = false;

    this.detectSpeechSupport();
  }

  // ------------------------------------------------------------------
  // Speech API detection
  // ------------------------------------------------------------------
  detectSpeechSupport() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.speechInputSupported = !!SR;
    this.SRClass = SR || null;
    this.speechOutputSupported = 'speechSynthesis' in window;
    // Server-STT fallback needs MediaRecorder + mic access.
    this.serverSTT =
      typeof window.MediaRecorder !== 'undefined' &&
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    // Prefer the server path when Web Speech is absent, or once it has
    // failed on this device (preference persisted by enableServerSTTOnce).
    this.preferServerSTT = this.serverSTT && !this.speechInputSupported;
    try {
      if (this.serverSTT && localStorage.getItem(SERVER_STT_KEY) === '1') {
        this.preferServerSTT = true;
      }
    } catch {
      /* private mode */
    }
  }

  // After any Web Speech failure, permanently prefer the server path on
  // this device. Returns true only the first time it engages.
  enableServerSTTOnce(reason) {
    if (!this.serverSTT || this.preferServerSTT) return false;
    this.preferServerSTT = true;
    try {
      localStorage.setItem(SERVER_STT_KEY, '1');
    } catch {
      /* private mode */
    }
    console.debug('[sitka-radio] server STT engaged:', reason);
    return true;
  }

  loadFeedback() {
    try {
      return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}');
    } catch {
      return {};
    }
  }

  saveFeedback() {
    try {
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify(this.feedback));
    } catch {
      /* private mode */
    }
  }

  // ------------------------------------------------------------------
  // Mount / unmount
  // ------------------------------------------------------------------
  mount() {
    this.root = document.createElement('div');
    this.root.className = 'sitka-radio';
    this.root.innerHTML = `
      <div class="sr-header">
        <span class="sr-title">📻 SITKA RADIO</span>
        <div class="sr-header-btns">
          <button class="sr-icon-btn sr-sound-toggle" aria-label="Toggle voice" title="Voice on/off">🔊</button>
          <button class="sr-icon-btn sr-collapse" aria-label="Collapse" title="Collapse">—</button>
        </div>
      </div>
      <div class="sr-transcript" aria-live="polite"></div>
      <div class="sr-controls">
        <canvas class="sr-waveform" width="280" height="36" aria-hidden="true"></canvas>
        <button class="sr-ptt" ${this.speechInputSupported || this.serverSTT ? '' : 'disabled'}>
          🎙 HOLD TO TALK
        </button>
        <input class="sr-text" type="text" placeholder="type instead…" enterkeyhint="send" />
      </div>
      <div class="sr-footnote">v1 prototype · responses are pre-written · ${this.speechInputSupported || this.serverSTT ? 'voice + text' : 'text only on this browser'}</div>
    `;

    this.transcriptEl = this.root.querySelector('.sr-transcript');
    this.pttButton = this.root.querySelector('.sr-ptt');
    this.textInput = this.root.querySelector('.sr-text');
    this.waveformCanvas = this.root.querySelector('.sr-waveform');
    this.waveformCtx = this.waveformCanvas.getContext('2d');

    // Collapsed badge
    this.badge = document.createElement('button');
    this.badge.className = 'sitka-radio-badge';
    this.badge.textContent = '📻';
    this.badge.setAttribute('aria-label', 'Open Sitka Radio');
    this.badge.hidden = true;

    this.container.appendChild(this.root);
    this.container.appendChild(this.badge);

    this.wireEvents();
    this.addBotMessage('CO-PILOT', 'Sitka Radio online. Hold the mic to talk, or type below.');
    this.primeSpeech();
  }

  wireEvents() {
    // Collapse / expand
    this.root.querySelector('.sr-collapse').addEventListener('click', () => this.setCollapsed(true));
    this.badge.addEventListener('click', () => this.setCollapsed(false));

    // Sound toggle
    const soundBtn = this.root.querySelector('.sr-sound-toggle');
    soundBtn.addEventListener('click', () => {
      this.speechEnabled = !this.speechEnabled;
      soundBtn.textContent = this.speechEnabled ? '🔊' : '🔇';
      if (!this.speechEnabled && this.speechOutputSupported) {
        window.speechSynthesis.cancel();
      }
    });

    // Push-to-talk: pointerdown starts, pointerup/leave stops.
    // Wired when EITHER input path exists: Web Speech or the server fallback.
    if (this.speechInputSupported || this.serverSTT) {
      this.pttButton.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.startListening();
      });
      this.pttButton.addEventListener('pointerup', () => this.stopListening());
      // iOS fires pointercancel (not pointerup) when the system interrupts a touch —
      // without this, recognition hangs until the safety timeout.
      this.pttButton.addEventListener('pointercancel', () => this.stopListening());
      this.pttButton.addEventListener('pointerleave', () => {
        if (this.listening) this.stopListening();
      });
      // iOS Safari needs touch-action none to prevent scroll during hold
      this.pttButton.style.touchAction = 'none';
    } else {
      this.pttButton.title = 'Voice input not supported in this browser — type instead';
    }

    // Text input: Enter sends
    this.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.textInput.value.trim()) {
        this.handleUserInput(this.textInput.value.trim());
        this.textInput.value = '';
      }
    });
  }

  setCollapsed(collapsed) {
    this.collapsed = collapsed;
    this.root.hidden = collapsed;
    this.badge.hidden = !collapsed;
  }

  // ------------------------------------------------------------------
  // Speech input
  // ------------------------------------------------------------------
  startListening() {
    if (this.listening) return;
    // Server path first when Web Speech is absent or has failed here before.
    if (this.preferServerSTT && this.serverSTT) {
      this.startListeningServer();
      return;
    }
    if (!this.SRClass) return;
    this.primeSpeech(); // iOS gesture requirement

    // Abandon any stale session so its late onend can't submit old text.
    if (this.session) this.session.submit = false;
    // Per-session token: onend must submit this session's transcript even though
    // stopListening() already cleared this.listening by the time onend fires.
    // (pointerup -> stopListening -> recognition.stop() -> onend, in that order.)
    const session = (this.session = { submit: true });

    // Recreate per use (iOS quirk: reuse causes stale results)
    this.recognition = new this.SRClass();
    this.recognition.lang = 'en-US';
    // iOS Safari is flaky with interimResults=true — use false for reliability.
    // iPadOS in desktop mode sends a Mac user agent, so also check touch points.
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.recognition.interimResults = !isIOS;
    this.recognition.continuous = false;
    this.recognition.maxAlternatives = 1;

    let finalTranscript = '';
    let lastInterim = '';
    let gotResult = false;
    let listenTimeout = null;

    // Safety timeout: if iOS silently fails, don't hang on "LISTENING…"
    listenTimeout = setTimeout(() => {
      if (this.listening && !gotResult) {
        session.submit = false; // timeout already messaged the user; keep onend quiet
        this.stopListening();
        if (this.enableServerSTTOnce('web-speech timeout')) {
          this.addBotMessage(
            'CO-PILOT',
            "Voice isn't cooperating on this device — I've switched to the server mic. Hold the button and talk again, or type below.",
          );
        } else {
          this.addBotMessage(
            'CO-PILOT',
            "Voice isn't cooperating on this device — type below and I'll answer the same way.",
          );
        }
      }
    }, 12000);

    this.recognition.onresult = (event) => {
      gotResult = true;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalTranscript += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) lastInterim = interim;
      this.drawWaveform(true);
      this.pttButton.textContent = interim ? `🎙 "${interim.slice(0, 24)}…"` : '🎙 LISTENING…';
    };

    this.recognition.onerror = (event) => {
      clearTimeout(listenTimeout);
      session.submit = false; // onerror already messaged the user; keep onend quiet
      this.stopListening();
      // Any failure except a hard mic denial: next hold uses the server path.
      if (event.error !== 'not-allowed') {
        this.enableServerSTTOnce('web-speech error: ' + event.error);
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.addBotMessage('CO-PILOT', "Mic access was blocked — no worries, type instead and I'll still answer.");
      } else if (event.error === 'no-speech' || event.error === 'aborted') {
        this.addBotMessage('CO-PILOT', "Didn't hear anything — try holding the button while you talk, or type below.");
      } else {
        this.addBotMessage('CO-PILOT', "Voice hiccup — type it below and I'll answer.");
      }
    };

    this.recognition.onend = () => {
      clearTimeout(listenTimeout);
      // NOTE: don't read this.listening here — stopListening() (called on
      // pointerup before onend fires) already cleared it, which is why release
      // used to drop the transcript. The per-session token survives it.
      const shouldSubmit = session.submit;
      if (this.session === session) this.session = null;
      this.stopListening();
      // Use final transcript, fall back to last interim (iOS often never marks final)
      const text = finalTranscript.trim() || lastInterim.trim();
      if (shouldSubmit && text) {
        // Correction pass: Web Speech mangles Sitka place names too.
        this.handleUserInput(transcriptForRadio(text));
      } else if (shouldSubmit && !gotResult) {
        // onend with no result at all = silent iOS failure, timeout already handles messaging
        this.enableServerSTTOnce('web-speech silent failure');
      } else if (shouldSubmit) {
        this.enableServerSTTOnce('web-speech empty result');
        this.addBotMessage('CO-PILOT', "Didn't catch that — try again or type it below.");
      }
    };

    try {
      this.recognition.start();
      this.listening = true;
      this.pttButton.classList.add('sr-listening');
      this.pttButton.textContent = '🎙 LISTENING…';
      this.drawWaveform(true);
    } catch {
      this.stopListening();
    }
  }

  stopListening() {
    // A server recording in progress stops through its own path.
    if (this.serverRecorder) {
      this.stopListeningServer();
      return;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* already stopped */
      }
      this.recognition = null;
    }
    this.listening = false;
    this.pttButton.classList.remove('sr-listening');
    this.pttButton.textContent = '🎙 HOLD TO TALK';
    this.drawWaveform(false);
  }

  // ------------------------------------------------------------------
  // Server speech input (MediaRecorder → Whisper worker)
  // ------------------------------------------------------------------
  async startListeningServer() {
    if (this.listening) return;
    this.primeSpeech(); // iOS gesture requirement
    if (this.session) this.session.submit = false;
    const session = (this.session = { submit: true });

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (this.session === session) this.session = null;
      this.addBotMessage('CO-PILOT', "Mic access was blocked — type below and I'll still answer.");
      return;
    }

    // Prefer webm/opus (verified against the worker); iPad Safari falls
    // back to its default (audio/mp4), which Whisper decodes server-side.
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => {
      try {
        return window.MediaRecorder.isTypeSupported(t);
      } catch {
        return false;
      }
    });

    const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    this.serverRecorder = { recorder, stream, session, chunks };
    recorder.start();
    this.listening = true;
    this.pttButton.classList.add('sr-listening');
    this.pttButton.textContent = '🎙 RECORDING…';
    this.drawWaveform(true);

    // Hard cap: MediaRecorder never auto-stops on silence.
    this.serverStopTimer = setTimeout(() => this.stopListeningServer(), STT_MAX_MS);
  }

  async stopListeningServer() {
    const active = this.serverRecorder;
    clearTimeout(this.serverStopTimer);
    this.serverStopTimer = null;
    this.serverRecorder = null;
    if (!active) return;

    const { recorder, stream, session } = active;
    const stopped = new Promise((resolve) => {
      if (recorder.state === 'inactive') return resolve();
      recorder.addEventListener('stop', resolve, { once: true });
      setTimeout(resolve, 1000); // never hang the button
    });
    try {
      recorder.stop();
    } catch {
      /* already stopped */
    }
    await stopped; // wait for the final ondataavailable flush
    stream.getTracks().forEach((t) => t.stop());

    this.listening = false;
    this.pttButton.classList.remove('sr-listening');
    if (this.session === session) this.session = null;

    const blob = new Blob(active.chunks, { type: recorder.mimeType || 'audio/webm' });
    if (!session.submit || blob.size === 0) {
      this.pttButton.textContent = '🎙 HOLD TO TALK';
      this.drawWaveform(false);
      return;
    }

    this.pttButton.textContent = '🎙 TRANSCRIBING…';
    try {
      const res = await fetch(STT_URL, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      });
      if (!res.ok) throw new Error('stt ' + res.status);
      const data = await res.json();
      const transcript = ((data && data.text) || '').trim();
      if (transcript) {
        // Correction pass: Whisper mangles Sitka place names ("Edgecom").
        this.handleUserInput(transcriptForRadio(transcript));
      } else {
        this.addBotMessage('CO-PILOT', "Didn't catch that — try again or type it below.");
      }
    } catch {
      this.addBotMessage('CO-PILOT', "Voice hiccup on the server path — type it below and I'll answer.");
    } finally {
      this.pttButton.textContent = '🎙 HOLD TO TALK';
      this.drawWaveform(false);
    }
  }

  // ------------------------------------------------------------------
  // Input → response pipeline
  // ------------------------------------------------------------------
  handleUserInput(text) {
    this.addUserMessage(text);

    // "TOWER is responding..." shimmer with radio-like latency
    const pendingEl = this.addPendingMessage();

    const latency = LATENCY_MIN + Math.random() * (LATENCY_MAX - LATENCY_MIN);
    setTimeout(() => {
      pendingEl.remove();
      const { intent, responder, text: reply, locked } = matchIntent(text);
      this.addBotMessage(responder, reply, { intent, locked });
      this.speak(reply, responder);
    }, latency);
  }

  // ------------------------------------------------------------------
  // Speech output
  // ------------------------------------------------------------------
  primeSpeech() {
    // iOS requires a user gesture before speechSynthesis works.
    // Prime with a silent utterance on first interaction.
    if (!this.speechOutputSupported || this.voicesReady) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      this.voicesReady = true;
    } catch {
      /* unsupported */
    }
  }

  speak(text, responder) {
    if (!this.speechEnabled || !this.speechOutputSupported) return;
    try {
      window.speechSynthesis.cancel(); // don't queue up
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.pitch = responder === 'TOWER' ? 0.85 : 1.05;
      // Prefer a clear system voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => v.lang.startsWith('en') && v.name.includes('Samantha')) ||
        voices.find((v) => v.lang === 'en-US');
      if (preferred) u.voice = preferred;
      window.speechSynthesis.speak(u);
    } catch {
      /* TTS failed silently */
    }
  }

  // ------------------------------------------------------------------
  // Transcript rendering
  // ------------------------------------------------------------------
  addUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'sr-msg sr-user';
    el.innerHTML = `<span class="sr-who">YOU</span><span class="sr-text-body"></span>`;
    el.querySelector('.sr-text-body').textContent = `"${text}"`;
    this.transcriptEl.appendChild(el);
    this.scrollToBottom();
  }

  addPendingMessage() {
    const el = document.createElement('div');
    el.className = 'sr-msg sr-pending';
    el.innerHTML = `<span class="sr-who">…</span><span class="sr-static">responding</span>`;
    this.transcriptEl.appendChild(el);
    this.scrollToBottom();
    return el;
  }

  addBotMessage(responder, text, meta = {}) {
    const el = document.createElement('div');
    el.className = `sr-msg sr-bot sr-${responder.toLowerCase().replace('-', '')}`;
    const msgId = `msg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    el.innerHTML = `
      <span class="sr-who">${responder}</span>
      <span class="sr-text-body"></span>
      <div class="sr-feedback" role="group" aria-label="Rate this response">
        <button class="sr-thumb" data-vote="up" aria-label="Good response">👍</button>
        <button class="sr-thumb" data-vote="down" aria-label="Bad response">👎</button>
        ${meta.locked ? '<span class="sr-locked" title="Curated response">🔒</span>' : ''}
      </div>
    `;
    el.querySelector('.sr-text-body').textContent = `"${text}"`;

    el.querySelectorAll('.sr-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        const vote = btn.dataset.vote;
        this.recordFeedback(msgId, meta.intent || 'unknown', text, vote);
        // Visual confirmation
        el.querySelectorAll('.sr-thumb').forEach((b) => b.classList.remove('sr-voted'));
        btn.classList.add('sr-voted');
      });
    });

    this.transcriptEl.appendChild(el);
    this.scrollToBottom();
  }

  recordFeedback(msgId, intent, responseText, vote) {
    // v1: localStorage only. v2 will POST to Worker.
    if (!this.feedback[intent]) this.feedback[intent] = { up: 0, down: 0, samples: [] };
    this.feedback[intent][vote === 'up' ? 'up' : 'down']++;
    this.feedback[intent].samples.push({ msgId, vote, at: Date.now() });
    // Cap samples to avoid unbounded growth
    if (this.feedback[intent].samples.length > 50) {
      this.feedback[intent].samples = this.feedback[intent].samples.slice(-50);
    }
    this.saveFeedback();
  }

  getFeedbackStats() {
    return { ...this.feedback };
  }

  scrollToBottom() {
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  // ------------------------------------------------------------------
  // Waveform animation (cheap canvas bars while listening)
  // ------------------------------------------------------------------
  drawWaveform(active) {
    if (this.waveformAnim) {
      cancelAnimationFrame(this.waveformAnim);
      this.waveformAnim = null;
    }
    const ctx = this.waveformCtx;
    const W = this.waveformCanvas.width;
    const H = this.waveformCanvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!active) return;

    const bars = 32;
    const barW = W / bars;
    const animate = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#e33';
      const t = Date.now() / 120;
      for (let i = 0; i < bars; i++) {
        const h = 4 + Math.abs(Math.sin(t + i * 0.6)) * (H - 8) * (0.4 + Math.random() * 0.6);
        ctx.fillRect(i * barW + 1, (H - h) / 2, barW - 2, h);
      }
      this.waveformAnim = requestAnimationFrame(animate);
    };
    animate();
  }
}

export { setGameState };
