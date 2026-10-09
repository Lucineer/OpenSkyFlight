/**
 * Sitka Radio — v1 response engine.
 * Pattern matching + pre-written responses. No backend, no AI.
 *
 * Intent cascade: normalize → exact phrase → keyword set → fallback
 * Dynamic slots ({alt}, {speed}, {dist}, {dir}) filled from game state.
 *
 * Tier A responses are hand-written + curated. ATC/critical responses
 * (landing, checklist) are locked — popularity can't rewrite safety info.
 */

// ---------------------------------------------------------------------------
// Game state provider — the host game fills these in via setGameState().
// Until then, defaults keep responses sensible.
// ---------------------------------------------------------------------------
const DEFAULT_STATE = {
  alt: 1200,        // feet
  speed: 95,        // knots
  dist: 3,          // miles from airport
  dir: 'east',      // compass direction from airport
  clouds: 'scattered',
  windDir: 'southeast',
  windSpd: 8,
  vis: '10 miles',
};

let gameState = { ...DEFAULT_STATE };

export function setGameState(partial) {
  gameState = { ...gameState, ...partial };
}

export function getGameState() {
  return { ...gameState };
}

// ---------------------------------------------------------------------------
// Slot filling — replaces {alt}, {speed}, {dist}, {dir}, etc.
// ---------------------------------------------------------------------------
function fillSlots(text) {
  const s = gameState;
  return text
    .replace('{alt}', Math.round(s.alt).toLocaleString())
    .replace('{speed}', Math.round(s.speed))
    .replace('{dist}', s.dist)
    .replace('{dir}', s.dir)
    .replace('{clouds}', s.clouds)
    .replace('{windDir}', s.windDir)
    .replace('{windSpd}', s.windSpd)
    .replace('{vis}', s.vis)
    .replace('{aboveBelow}', s.alt >= 1000 ? 'above' : 'below');
}

// ---------------------------------------------------------------------------
// Response table — 20 starter responses across 7 categories.
// Each entry: intent, responder ('TOWER' | 'CO-PILOT'), keywords, responses[]
// Multiple responses per intent allow rotation (no repeats back-to-back).
// ---------------------------------------------------------------------------
const INTENTS = [
  // ---- LOCATION (TOWER) ----
  {
    intent: 'location',
    responder: 'TOWER',
    tier: 'A', locked: false,
    keywords: ['where am i', 'where are we', 'my position', 'my location', 'position report'],
    responses: [
      "You're over Sitka Sound, {dist} miles {dir} of Sitka Airport. Looking good.",
      "Sitka Radio: you're {dist} miles {dir} of the field, tracking nicely.",
    ],
  },
  {
    intent: 'altitude',
    responder: 'TOWER',
    tier: 'A', locked: false,
    keywords: ['altitude', 'how high', 'how high are we', 'climb', 'descend'],
    responses: [
      "Showing {alt} feet. Pattern altitude is 1,000 — you're {aboveBelow}.",
      "{alt} feet on the altimeter. Nice and steady.",
    ],
  },
  {
    intent: 'speed',
    responder: 'TOWER',
    tier: 'A', locked: false,
    keywords: ['how fast', 'my speed', 'speed check', 'slow down', 'speed up', 'airspeed'],
    responses: [
      "{speed} knots groundspeed. Right in the sweet spot.",
      "Showing {speed} knots. Smooth air, keep it there.",
    ],
  },

  // ---- POI (CO-PILOT) ----
  {
    intent: 'poi_mountain',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: ['mountain', 'peak', 'edgecumbe', 'volcano', 'that mountain'],
    responses: [
      "That's Mount Edgecumbe on Kruzof Island, sleeping beauty of the Sound. Last stirred 4,000 years back.",
      "Mount Edgecumbe — dormant volcano, perfect cone, pure Sitka postcard.",
    ],
  },
  {
    intent: 'poi_island',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: ['island', 'japonski', 'baranof', 'kruzof', 'what island'],
    responses: [
      "That's Japonski Island below — Coast Guard station, airport, and the old naval base.",
      "Baranof Island to the east — brown bears, old growth, and some of the best fishing in Alaska.",
      "Kruzof Island ahead — home of Mount Edgecumbe and nobody else. Pure wilderness.",
    ],
  },
  {
    intent: 'poi_whale',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: ['whale', 'whales', 'humpback', 'orca', 'see any'],
    responses: [
      "Watch the water below — humpbacks bubble-net feeding all summer long. Spot a blow? That's your whale.",
      "Humpbacks love the Sound. Look for the blow, then the fluke. Worth the wait.",
    ],
  },

  // ---- WEATHER (TOWER) ----
  {
    intent: 'weather',
    responder: 'TOWER',
    tier: 'A', locked: false,
    keywords: ['weather', 'wind', 'visibility', 'clouds', 'cloudy', 'rain', 'fog', 'conditions'],
    responses: [
      "Sitka special: {clouds} skies, winds {windDir} at {windSpd} knots, visibility {vis}. Dress for everything.",
      "Winds {windDir} at {windSpd}, {clouds}, vis {vis}. Classic Southeast Alaska.",
    ],
  },

  // ---- LANDING (TOWER, locked) ----
  {
    intent: 'landing_help',
    responder: 'TOWER',
    tier: 'A', locked: true,
    keywords: ['help me land', 'landing', 'how to land', 'talk me down', 'approach'],
    responses: [
      "Runway 11 is {dist} miles {dir}. Get to 1,000 feet, slow to 70 knots, and I'll talk you down.",
      "Set up for Runway 11. 1,000 feet, 70 knots, gentle descent. You've got this.",
    ],
  },
  {
    intent: 'runway',
    responder: 'TOWER',
    tier: 'A', locked: true,
    keywords: ['which runway', 'runway', 'runway info'],
    responses: [
      "Winds favor Runway 11 today. 7,200 feet of asphalt waiting for you.",
    ],
  },

  // ---- CHECKLIST (TOWER, locked) ----
  {
    intent: 'checklist',
    responder: 'TOWER',
    tier: 'A', locked: true,
    keywords: ['checklist', 'preflight', 'pre-flight', 'before takeoff', 'takeoff check'],
    responses: [
      "Mixture rich, throttle up, gauges green, runway clear. Call when ready.",
      "Pre-flight: controls free, fuel on, mixture rich, mags both. Takeoff: flaps as needed, rotate at 55.",
    ],
  },

  // ---- FUEL (TOWER) ----
  {
    intent: 'fuel',
    responder: 'TOWER',
    tier: 'A', locked: false,
    keywords: ['fuel', 'gas', 'how much fuel'],
    responses: [
      "Fuel's looking fine. You've got plenty for sightseeing — just watch the gauge on longer legs.",
    ],
  },

  // ---- FUN (CO-PILOT) ----
  {
    intent: 'joke',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: ['joke', 'funny', 'make me laugh', 'another one'],
    responses: [
      "Why'd the bush pilot bring a ladder? Said he was tired of just scraping treetops on takeoff.",
      "What do you call a sleepy moose in Sitka? A bull-dozer, 'cause he's snoring through the alders.",
      "Why don't eagles use GPS? They already know every thermal in the Sound.",
    ],
  },
  {
    intent: 'bored',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: ['bored', 'boring', 'nothing to do'],
    responses: [
      "Bored? Impossible. Eagles on the left, whales on the right, and Sitka sparkling below us.",
    ],
  },

  // ---- SOCIAL (CO-PILOT) ----
  {
    intent: 'greeting',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'howdy'],
    responses: [
      "Hey there! Sitka Radio, listening. Ask me where you are, about the weather, or just say hi.",
      "Sitka Radio here. Beautiful day for flying — what can I do for you?",
    ],
  },
  {
    intent: 'thanks',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: ['thank', 'thanks', 'appreciated'],
    responses: [
      "Anytime. That's what I'm here for. Fly safe.",
    ],
  },
  {
    intent: 'whoami',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: ['who are you', 'your name', 'what are you'],
    responses: [
      "I'm Sitka Radio — part tower, part co-pilot, all Alaska. Ask me anything.",
    ],
  },

  // ---- HELP ----
  {
    intent: 'help',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: ['help', 'what can you do', 'commands', 'options', 'how does this work'],
    responses: [
      "I can tell you where you are, what's around you, the weather, help you land, or tell a joke. What's up?",
    ],
  },

  // ---- FALLBACK ----
  {
    intent: 'fallback',
    responder: 'CO-PILOT',
    tier: 'A', locked: false,
    keywords: [],
    responses: [
      "Say again? Didn't catch that. Try 'where am I' or 'tell me a joke.'",
      "Hmm, static on that one. Ask me about location, weather, or say 'help.'",
    ],
  },
];

// Track last response per intent to avoid immediate repeats.
const lastUsed = {};

/**
 * Match normalized input to an intent. Returns { intent, responder, text }.
 */
export function matchIntent(rawInput) {
  const input = rawInput.toLowerCase().trim();

  for (const entry of INTENTS) {
    if (entry.intent === 'fallback') continue;
    for (const kw of entry.keywords) {
      if (input.includes(kw)) {
        return pickResponse(entry);
      }
    }
  }
  // No match → fallback
  const fb = INTENTS.find(e => e.intent === 'fallback');
  return pickResponse(fb);
}

function pickResponse(entry) {
  const pool = entry.responses.filter((_, i) => i !== lastUsed[entry.intent]);
  const chosen = pool.length > 0
    ? pool[Math.floor(Math.random() * pool.length)]
    : entry.responses[Math.floor(Math.random() * entry.responses.length)];
  lastUsed[entry.intent] = entry.responses.indexOf(chosen);
  return {
    intent: entry.intent,
    responder: entry.responder,
    locked: entry.locked,
    text: fillSlots(chosen),
  };
}

export function getIntentCount() {
  return INTENTS.length;
}
