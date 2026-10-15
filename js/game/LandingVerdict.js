/**
 * LandingVerdict — scores a touchdown and shows a satisfying verdict overlay.
 *
 * Scoring (based on real aviation standards, tuned for fun):
 * - Vertical speed: the big one. Airliners aim for <150 fpm.
 * - Bank angle: wings level is the mark of a pro.
 * - Centerline: how close to the middle?
 * - Touchdown zone: first third of the runway.
 *
 * Tracks best landing in localStorage.
 */

// Vertical speed thresholds (fpm, positive = descent rate)
const VS_GREASER = 80; // barely feel it
const VS_NICE = 150; // airline smooth
const VS_FIRM = 300; // normal
const VS_HARD = 500; // ouch

// Bank angle thresholds (degrees)
const BANK_PERFECT = 3;
const BANK_OK = 8;

// Centerline thresholds (meters from center)
const CENTER_PERFECT = 5;
const CENTER_OK = 15;

const PERFECT_PHRASES = ['GREASER! 🧈', 'BUTTER! 🧈', 'KISSED THE RUNWAY! 💋', 'SILK! ✨', 'TEXTBOOK! 📖'];

const GOOD_PHRASES = ['Nice touchdown!', 'Smooth one!', 'Well flown!', 'Clean landing!'];

const FIRM_PHRASES = ['Firm arrival.', 'Positive touchdown.', "You're down. That's what matters."];

const HARD_PHRASES = [
  'HARD LANDING! 💥',
  'The runway felt that one.',
  'Did you mean to do that?',
  'The landing gear has filed a complaint.',
];

const WING_LOW_PHRASE = 'WING LOW! ⚠️';
const OFF_CENTER_PHRASE = 'Off centerline!';
const LONG_PHRASE = 'Long landing — ate up runway!';
const SHORT_PHRASE = 'Short! Barely made the pavement!';

const STORAGE_KEY = 'osf-best-landing-v1';

export default class LandingVerdict {
  constructor() {
    this.best = this._loadBest();
    this._overlay = null;
    this._dismissTimer = null;
  }

  _loadBest() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return null;
  }

  _saveBest(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  /**
   * Score a touchdown. Returns { grade, score (0-100), phrases[], isBest }.
   */
  score(touchdown) {
    const phrases = [];
    let score = 100;

    // --- Vertical speed (worth 50 points) ---
    const vs = touchdown.vspeedFpm;
    let vsGrade, vsPoints;
    if (vs < VS_GREASER) {
      vsGrade = 'greaser';
      vsPoints = 50;
      phrases.push(PERFECT_PHRASES[Math.floor(Math.random() * PERFECT_PHRASES.length)]);
    } else if (vs < VS_NICE) {
      vsGrade = 'nice';
      vsPoints = 42;
      phrases.push(GOOD_PHRASES[Math.floor(Math.random() * GOOD_PHRASES.length)]);
    } else if (vs < VS_FIRM) {
      vsGrade = 'firm';
      vsPoints = 30;
      phrases.push(FIRM_PHRASES[Math.floor(Math.random() * FIRM_PHRASES.length)]);
    } else if (vs < VS_HARD) {
      vsGrade = 'hard';
      vsPoints = 15;
      phrases.push(HARD_PHRASES[Math.floor(Math.random() * HARD_PHRASES.length)]);
    } else {
      vsGrade = 'crunch';
      vsPoints = 5;
      phrases.push('CRUNCH! 💥💥');
    }
    score = vsPoints;

    // --- Bank angle (worth 20 points) ---
    const bank = touchdown.bankDeg;
    if (bank <= BANK_PERFECT) {
      score += 20;
      phrases.push('Wings level! ✈️');
    } else if (bank <= BANK_OK) {
      score += 14;
    } else {
      score += 5;
      phrases.push(WING_LOW_PHRASE);
    }

    // --- Centerline (worth 20 points) ---
    const center = Math.abs(touchdown.crossTrackM);
    if (center <= CENTER_PERFECT) {
      score += 20;
      phrases.push('CENTERLINE! 🎯');
    } else if (center <= CENTER_OK) {
      score += 14;
    } else {
      score += 5;
      phrases.push(OFF_CENTER_PHRASE);
    }

    // --- Touchdown zone (worth 10 points) ---
    if (touchdown.inTouchdownZone) {
      score += 10;
      phrases.push('In the zone! 🟩');
    } else if (touchdown.alongTrackM < 0) {
      phrases.push(SHORT_PHRASE);
    } else {
      phrases.push(LONG_PHRASE);
    }

    // Clamp
    score = Math.max(0, Math.min(100, Math.round(score)));

    // Grade letter
    let grade;
    if (score >= 95) grade = 'S';
    else if (score >= 85) grade = 'A';
    else if (score >= 70) grade = 'B';
    else if (score >= 55) grade = 'C';
    else if (score >= 40) grade = 'D';
    else grade = 'F';

    // Best tracking (higher score = better; tiebreak on lower vspeed)
    let isBest = false;
    if (!this.best || score > this.best.score || (score === this.best.score && vs < this.best.vspeedFpm)) {
      isBest = true;
      this.best = { score, vspeedFpm: Math.round(vs), grade, date: new Date().toISOString() };
      this._saveBest(this.best);
      phrases.push('🏆 NEW BEST!');
    }

    return { grade, score, vsGrade, phrases, isBest, vspeedFpm: Math.round(vs) };
  }

  /**
   * Show the verdict overlay. Auto-dismisses after 5 seconds.
   */
  show(result) {
    this._dismiss();

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed',
      'top:50%',
      'left:50%',
      'transform:translate(-50%,-50%)',
      'z-index:100',
      'text-align:center',
      'pointer-events:none',
      'background:rgba(0,10,25,0.85)',
      'border:2px solid rgba(125,249,255,0.5)',
      'border-radius:20px',
      'padding:32px 48px',
      'backdrop-filter:blur(8px)',
      'animation:verdict-pop 0.4s ease-out',
    ].join(';');

    // Grade color
    const gradeColor =
      {
        S: '#ffd700',
        A: '#7df9ff',
        B: '#90ee90',
        C: '#ffa500',
        D: '#ff8080',
        F: '#ff4444',
      }[result.grade] || '#fff';

    const phrasesHtml = result.phrases.map((p) => `<div style="font-size:20px;margin:6px 0;">${p}</div>`).join('');

    overlay.innerHTML = `
      <div style="font-size:18px;color:#8a97a8;letter-spacing:3px;margin-bottom:8px;">LANDING</div>
      <div style="font-size:84px;font-weight:900;color:${gradeColor};line-height:1;margin:8px 0;">${result.grade}</div>
      <div style="font-size:28px;color:#fff;margin:8px 0;">${result.score}/100</div>
      <div style="font-size:16px;color:#8a97a8;margin:8px 0;">${result.vspeedFpm} fpm</div>
      <div style="margin-top:16px;">${phrasesHtml}</div>
      ${this.best ? `<div style="font-size:14px;color:#8a97a8;margin-top:16px;">Best: ${this.best.score}/100 (${this.best.grade})</div>` : ''}
    `;

    // Add pop animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes verdict-pop {
        0% { transform:translate(-50%,-50%) scale(0.5); opacity:0; }
        60% { transform:translate(-50%,-50%) scale(1.08); opacity:1; }
        100% { transform:translate(-50%,-50%) scale(1); opacity:1; }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(overlay);
    this._overlay = overlay;

    // Auto-dismiss after 5s
    this._dismissTimer = setTimeout(() => this._dismiss(), 5000);
  }

  _dismiss() {
    if (this._dismissTimer) {
      clearTimeout(this._dismissTimer);
      this._dismissTimer = null;
    }
    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
      this._overlay = null;
    }
  }

  getBest() {
    return this.best;
  }
}
