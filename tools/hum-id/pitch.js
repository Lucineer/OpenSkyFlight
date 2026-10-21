// pitch.js — hum pitch extraction + demo melody matching.
// Runs in the browser (global HumPitch) and in node (module.exports).
// Pipeline: downsample to 8kHz -> autocorrelation pitch per frame ->
// median-smooth -> quantize to notes -> interval sequence -> DTW vs demo DB.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HumPitch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TARGET_SR = 8000;
  var FRAME = 1024;   // 128 ms @ 8kHz
  var HOP = 256;      // 32 ms
  var MIN_HZ = 75;
  var MAX_HZ = 1200;
  var MIN_RUN = 3;    // min voiced frames to count as a note (~100ms)

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var SEMIS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // Small public-domain demo library. Real song matching needs a licensed
  // melody DB (e.g. ACRCloud's Cover Song (humming) engine).
  var DEMO_DB = [
    { title: 'Twinkle Twinkle Little Star', seq: ['C', 'C', 'G', 'G', 'A', 'A', 'G'] },
    { title: 'Mary Had a Little Lamb', seq: ['E', 'D', 'C', 'D', 'E', 'E', 'E'] },
    { title: 'Ode to Joy', seq: ['E', 'E', 'F', 'G', 'G', 'F', 'E', 'D'] }
  ];
  DEMO_DB.forEach(function (e) {
    e.semis = e.seq.map(function (n) { return SEMIS[n]; });
    e.intervals = intervals(e.semis);
  });

  function downsample(pcm, fromRate) {
    var ratio = fromRate / TARGET_SR;
    if (ratio <= 1) return pcm;
    var len = Math.floor(pcm.length / ratio);
    var out = new Float32Array(len);
    var win = Math.max(1, Math.floor(ratio));
    for (var i = 0; i < len; i++) {
      var s = 0, n = 0;
      var start = Math.floor(i * ratio);
      for (var j = 0; j < win && start + j < pcm.length; j++) { s += pcm[start + j]; n++; }
      out[i] = n ? s / n : 0;
    }
    return out;
  }

  // Autocorrelation pitch for one frame. Returns Hz, or 0 when unvoiced.
  function pitchOfFrame(frame, thresh) {
    var N = frame.length, i, lag;
    var e0 = 0;
    for (i = 0; i < N; i++) e0 += frame[i] * frame[i];
    if (e0 < thresh) return 0;
    var maxLag = Math.min(N - 1, Math.floor(TARGET_SR / MIN_HZ));
    var minLag = Math.max(2, Math.floor(TARGET_SR / MAX_HZ));
    var corr = new Float32Array(maxLag + 2);
    for (lag = 0; lag <= maxLag + 1 && lag < N; lag++) {
      var s = 0;
      for (i = 0; i + lag < N; i++) s += frame[i] * frame[i + lag];
      corr[lag] = s / (N - lag);
    }
    var c0 = corr[0] || 1e-9;
    // First strong local peak: resists octave (double-period) errors.
    var best = -1;
    for (lag = minLag + 1; lag < maxLag; lag++) {
      if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > 0.35 * c0) {
        best = lag;
        break;
      }
    }
    if (best < 0) {
      var bv = 0;
      for (lag = minLag; lag <= maxLag; lag++) {
        if (corr[lag] > bv) { bv = corr[lag]; best = lag; }
      }
      if (bv < 0.3 * c0) return 0;
    }
    // Parabolic interpolation around the peak for sub-sample accuracy.
    var y0 = corr[best - 1], y1 = corr[best], y2 = corr[best + 1] || 0;
    var denom = y0 - 2 * y1 + y2;
    var shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
    shift = Math.max(-1, Math.min(1, shift));
    return TARGET_SR / (best + shift);
  }

  function medianFilter(track, width) {
    var half = Math.floor(width / 2);
    var out = new Array(track.length);
    for (var i = 0; i < track.length; i++) {
      var vals = [];
      for (var k = -half; k <= half; k++) {
        var v = track[i + k];
        if (v > 0) vals.push(v);
      }
      if (vals.length < 2) { out[i] = 0; continue; }
      vals.sort(function (a, b) { return a - b; });
      out[i] = vals[Math.floor(vals.length / 2)];
    }
    return out;
  }

  function pitchTrack(pcm, sampleRate) {
    var ds = downsample(pcm, sampleRate);
    var frames = [];
    var maxE = 0, i, k;
    for (i = 0; i + FRAME <= ds.length; i += HOP) {
      var e = 0;
      for (k = 0; k < FRAME; k++) e += ds[i + k] * ds[i + k];
      e /= FRAME;
      frames.push(i);
      if (e > maxE) maxE = e;
    }
    var thresh = Math.max(1e-4, maxE * 0.03); // adaptive voiced gate
    var track = new Array(frames.length);
    var buf = new Float32Array(FRAME);
    for (i = 0; i < frames.length; i++) {
      for (k = 0; k < FRAME; k++) buf[k] = ds[frames[i] + k];
      track[i] = pitchOfFrame(buf, thresh);
    }
    return medianFilter(track, 5);
  }

  function freqToMidi(f) { return 69 + 12 * (Math.log(f / 440) / Math.LN2); }

  function noteName(m) {
    if (m < 0) return '—';
    return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  // Quantize voiced frames to MIDI, compress runs, drop blips/silence.
  function noteRuns(track) {
    var runs = [], cur = null, i;
    for (i = 0; i < track.length; i++) {
      var m = track[i] > 0 ? Math.round(freqToMidi(track[i])) : -1;
      if (cur && m === cur.m) { cur.n++; }
      else { if (cur) runs.push(cur); cur = { m: m, n: 1 }; }
    }
    if (cur) runs.push(cur);
    var notes = [];
    runs.forEach(function (r) {
      if (r.m < 0 || r.n < MIN_RUN) return;
      var last = notes[notes.length - 1];
      if (last && last.m === r.m) last.n += r.n;
      else notes.push({ m: r.m, n: r.n });
    });
    return notes;
  }

  function noteSequence(track) {
    return noteRuns(track).map(function (r) { return r.m; });
  }

  function intervals(notes) {
    var out = [];
    for (var i = 1; i < notes.length; i++) out.push(notes[i] - notes[i - 1]);
    return out;
  }

  // Dynamic time warping on interval sequences; tempo-invariant, cap per-step
  // cost so one bad note doesn't sink a match.
  function dtw(a, b) {
    var n = a.length, m = b.length;
    if (!n || !m) return Infinity;
    var prev = new Array(m + 1), cur = new Array(m + 1), i, j, t;
    for (j = 0; j <= m; j++) prev[j] = Infinity;
    prev[0] = 0;
    for (i = 1; i <= n; i++) {
      cur[0] = Infinity;
      for (j = 1; j <= m; j++) {
        var cost = Math.min(2, Math.abs(a[i - 1] - b[j - 1]));
        var bestPrev = prev[j] < cur[j - 1] ? prev[j] : cur[j - 1];
        bestPrev = bestPrev < prev[j - 1] ? bestPrev : prev[j - 1];
        cur[j] = cost + bestPrev;
      }
      t = prev; prev = cur; cur = t;
    }
    return prev[m] / (n + m);
  }

  function distinct(notes) {
    var out = [];
    for (var i = 0; i < notes.length; i++) {
      if (i === 0 || notes[i] !== notes[i - 1]) out.push(notes[i]);
    }
    return out;
  }

  function matchHum(noteSeq) {
    // Match on both the raw interval sequence and the distinct-pitch contour:
    // hummed repeated notes often merge into one, so the contour is the
    // more reliable signal. Take the best alignment across representations.
    var reps = [intervals(noteSeq), intervals(distinct(noteSeq))];
    if (reps[0].length < 3 && reps[1].length < 3) return null;
    var best = null, second = Infinity;
    DEMO_DB.forEach(function (entry) {
      var dbReps = [entry.intervals, intervals(distinct(entry.semis))];
      var d = Infinity;
      reps.forEach(function (ra) {
        dbReps.forEach(function (rb) {
          var x = dtw(ra, rb);
          if (x < d) d = x;
        });
      });
      if (!best || d < best.dist) { second = best ? best.dist : Infinity; best = { title: entry.title, dist: d }; }
      else if (d < second) { second = d; }
    });
    if (best) best.margin = second - best.dist;
    return best;
  }

  function analyze(pcm, sampleRate) {
    var track = pitchTrack(pcm, sampleRate);
    var runs = noteRuns(track);
    var notes = runs.map(function (r) { return r.m; });
    return {
      track: track,                 // Hz per frame (0 = unvoiced), for drawing
      frameSec: HOP / TARGET_SR,
      runs: runs,                   // [{m: midi, n: frames}] with durations
      notes: notes,                 // MIDI ints
      noteNames: notes.map(noteName),
      match: matchHum(notes)        // {title, dist, margin} vs demo DB
    };
  }

  return {
    TARGET_SR: TARGET_SR,
    analyze: analyze,
    pitchTrack: pitchTrack,
    noteSequence: noteSequence,
    noteRuns: noteRuns,
    noteName: noteName,
    intervals: intervals,
    dtw: dtw,
    matchHum: matchHum,
    demoTitles: DEMO_DB.map(function (e) { return e.title; })
  };
});
