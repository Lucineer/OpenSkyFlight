// test-pitch.js — verify pitch.js with synthesized melodies. Run: node test-pitch.js
var HumPitch = require('./pitch.js');

var SR = 44100; // synth at 44.1kHz so the 8kHz downsampler is exercised
var SEMIS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function synth(names, baseHz, noteDur, noise) {
  var gapDur = 0.06; // 60ms breath between notes, like a real hum
  var total = Math.floor(names.length * (noteDur + gapDur) * SR);
  var out = new Float32Array(total);
  for (var n = 0; n < names.length; n++) {
    var f = baseHz * Math.pow(2, SEMIS[names[n]] / 12);
    var start = Math.floor(n * (noteDur + gapDur) * SR), end = Math.floor((n * (noteDur + gapDur) + noteDur) * SR);
    // proper FM: accumulate phase so vibrato is +/-0.6% (~10 cents), not a sweep
    var phase = 0;
    for (var i = start; i < end && i < total; i++) {
      var instF = f * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * (i - start) / SR));
      phase += 2 * Math.PI * instF / SR;
      var env = Math.min(1, (i - start) / (0.02 * SR), (end - i) / (0.03 * SR));
      out[i] = 0.5 * Math.sin(phase) * Math.max(0, env)
        + (noise ? noise * (Math.random() * 2 - 1) : 0);
    }
  }
  return out;
}

var failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' — ' + detail : ''));
  if (!cond) failures++;
}

// 1. Twinkle Twinkle with vibrato + noise -> detected notes + correct match
var twinkle = synth(['C', 'C', 'G', 'G', 'A', 'A', 'G'], 261.63, 0.4, 0.02);
var r1 = HumPitch.analyze(twinkle, SR);
var pc1 = r1.notes.map(function (m) { return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((m % 12) + 12) % 12]; });
check('twinkle pitch classes in order', JSON.stringify(pc1) === JSON.stringify(['C', 'G', 'A', 'G']),
  'got ' + r1.noteNames.join(' '));
check('twinkle matched title', r1.match && r1.match.title === 'Twinkle Twinkle Little Star',
  r1.match ? r1.match.title + ' dist=' + r1.match.dist.toFixed(3) + ' margin=' + r1.match.margin.toFixed(3) : 'no match');
check('twinkle match confident', r1.match && r1.match.dist < 0.35 && r1.match.margin > 0.02,
  r1.match ? 'dist=' + r1.match.dist.toFixed(3) : 'n/a');

// 2. Mary Had a Little Lamb -> matches Mary, not Twinkle
var mary = synth(['E', 'D', 'C', 'D', 'E', 'E', 'E'], 329.63, 0.35, 0.02);
var r2 = HumPitch.analyze(mary, SR);
check('mary matched title', r2.match && r2.match.title === 'Mary Had a Little Lamb',
  r2.match ? r2.match.title + ' dist=' + r2.match.dist.toFixed(3) : 'no match; notes=' + r2.noteNames.join(' '));

// 3. Ode to Joy at a different base pitch + faster tempo -> transposition/tempo invariant
var ode = synth(['E', 'E', 'F', 'G', 'G', 'F', 'E', 'D'], 196.0, 0.28, 0.02);
var r3 = HumPitch.analyze(ode, SR);
check('ode matched despite transposition+tempo', r3.match && r3.match.title === 'Ode to Joy',
  r3.match ? r3.match.title + ' dist=' + r3.match.dist.toFixed(3) : 'no match; notes=' + r3.noteNames.join(' '));

// 4. Silence -> no notes, no match
var silence = new Float32Array(SR * 2);
var r4 = HumPitch.analyze(silence, SR);
check('silence yields nothing', r4.notes.length === 0 && r4.match === null,
  'notes=' + r4.notes.length);

// 5. Wrong melody (random-ish) should not confidently match anything
var weird = synth(['C', 'F#', 'D', 'A#', 'G', 'E', 'B'], 261.63, 0.4, 0.02);
var r5 = HumPitch.analyze(weird, SR);
check('non-melody is a weak match', !r5.match || r5.match.dist > 0.5,
  r5.match ? r5.match.title + ' dist=' + r5.match.dist.toFixed(3) : 'no match (good)');

// 6. Low-volume hum still detected (adaptive gate)
var quiet = synth(['C', 'C', 'G', 'G'], 261.63, 0.4, 0.005);
for (var i = 0; i < quiet.length; i++) quiet[i] *= 0.08;
var r6 = HumPitch.analyze(quiet, SR);
var pc6 = r6.notes.map(function (m) { return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((m % 12) + 12) % 12]; });
check('quiet hum pitch classes right', JSON.stringify(pc6) === JSON.stringify(['C', 'G']),
  'notes=' + r6.noteNames.join(' '));

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
