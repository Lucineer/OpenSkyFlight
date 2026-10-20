// Sitka Radio — STT place-name correction pass.
//
// WHY: Whisper mangles uncommon Sitka place names. Live proof (2026-10-20):
//   "Fly to Sitka, then turn left toward Mount Edgecom."
//   → "Edgecumbe" came back as "Edgecom", so matchIntent() fell through to
//   FALLBACK even though the player clearly named Mount Edgecumbe.
//   (matchIntent is pure substring matching on lowercase, so a mangled name
//   silently misses every keyword.)
//
// WHERE IT RUNS: client-side, on the transcript, BEFORE handleUserInput() —
// i.e. in the radio-chatbot's STT path (both Web Speech and the server-STT
// fallback in radio-stt-fallback-draft.js). The worker stays dumb.
//
// CANONICAL NAMES are grounded in the radio's own intent keywords
// (js/radio-chatbot/responses.js): edgecumbe, volcano, japonski, baranof,
// kruzof, sitka (+ response text: "Sitka Sound", "Sitka Airport"), plus
// Biorka Island from the Jayhawk rescue design (Biorka Island base).
//
// Variant tiers:
//   observed  — actually seen in a Whisper transcript (verified 2026-10-20)
//   predicted — phonetic near-misses Whisper plausibly produces; kept
//               conservative to avoid false corrections. Revisit after the
//               first real iPad mic test and promote what actually appears.

export const PLACE_CORRECTIONS = [
  {
    canonical: 'Edgecumbe',
    // pairs with "Mount Edgecumbe" phrasing; 'edgecumbe' is the intent keyword
    variants: [
      { v: 'edgecom', tier: 'observed' },   // seen 2026-10-20: "Mount Edgecom"
      { v: 'edgecomb', tier: 'predicted' },
      { v: 'edge comb', tier: 'predicted' },
      { v: 'edgcomb', tier: 'predicted' },
      { v: 'edgecum', tier: 'predicted' },
    ],
  },
  {
    canonical: 'Kruzof',
    variants: [
      { v: 'kruzaf', tier: 'predicted' },
      { v: 'kruzef', tier: 'predicted' },
      { v: 'kruzaff', tier: 'predicted' },
      { v: 'kroozof', tier: 'predicted' },
    ],
  },
  {
    canonical: 'Baranof',
    variants: [
      { v: 'baranoff', tier: 'predicted' },
      { v: 'baranov', tier: 'predicted' },
      { v: 'barranof', tier: 'predicted' },
    ],
  },
  {
    canonical: 'Japonski',
    variants: [
      { v: 'japanski', tier: 'predicted' },
      { v: 'japon ski', tier: 'predicted' },
      { v: 'japonsky', tier: 'predicted' },
    ],
  },
  {
    canonical: 'Biorka',
    // Jayhawk supply-drop base island (game vision); 'biorka' has no intent
    // keyword yet — correcting it keeps future "fly to Biorka" commands sane.
    variants: [
      { v: 'bjorka', tier: 'predicted' },
      { v: 'byorka', tier: 'predicted' },
      { v: 'beorka', tier: 'predicted' },
    ],
  },
];

// Longest-first so "edge comb" beats "edgecom" fragments; word-boundary
// aware so "Sitka" never gets clobbered inside another word.
const PATTERNS = PLACE_CORRECTIONS.flatMap(({ canonical, variants }) =>
  variants.map(({ v, tier }) => ({
    re: new RegExp(`(?<![\\p{L}])${escapeRegExp(v)}(?![\\p{L}])`, 'giu'),
    canonical,
    tier,
  })),
).sort((a, b) => b.re.source.length - a.re.source.length);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Correct Whisper place-name manglings in a transcript.
 * Returns { text, corrections: [{from, to, tier}] }.
 * Pure function — safe to unit test, safe to run on every transcript.
 */
export function correctPlaceNames(raw) {
  const corrections = [];
  let text = String(raw || '');
  for (const { re, canonical, tier } of PATTERNS) {
    text = text.replace(re, (m) => {
      corrections.push({ from: m, to: canonical, tier });
      // Preserve the speaker's capitalization shape: "mount edgecom" →
      // "mount Edgecumbe" is fine; matchIntent lowercases everything anyway.
      return canonical;
    });
  }
  return { text, corrections };
}

/**
 * Convenience: transcript corrected and ready for handleUserInput().
 * Feed the RETURNED text to handleUserInput; show the user whichever the
 * UX prefers (corrected reads better — they said "Edgecumbe", not "Edgecom").
 */
export function transcriptForRadio(raw) {
  return correctPlaceNames(raw).text;
}
