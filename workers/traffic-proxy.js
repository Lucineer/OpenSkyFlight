// Traffic proxy Worker — proxies ADS-B aggregators for live air traffic.
//
// GET /api/traffic?lat=57.05&lon=-135.33&dist=100
//
// - Adds CORS headers so the game can fetch from the browser
// - Sets identifying User-Agent with contact (required by aggregators)
// - 30s edge cache so upstream sees minimal load regardless of player count
// - Round-robin across upstreams to distribute rate-limit pressure
//
// Upstream status (2026-10-10):
// - adsb.fi: HTTP 403 from Cloudflare Workers egress (IP block). Kept in
//   rotation in case the block lifts; not relied upon.
// - adsb.lol: works, but 429s under shared-egress load. Primary.
// - airplanes.live: requires manual access approval. Not usable.
//
// Attribution: live traffic data by adsb.fi (https://adsb.fi)
// and adsb.lol (https://adsb.lol)

const UPSTREAMS = [
  {
    name: 'adsb.lol',
    url: (lat, lon, dist) =>
      `https://api.adsb.lol/v2/point/${lat}/${lon}/${dist}`,
  },
  {
    name: 'adsb.fi',
    url: (lat, lon, dist) =>
      `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${dist}`,
  },
];

// Identifying UA per aggregator policy. Contact must be real.
const UA =
  'SitkaSkies/1.0 (https://lucineer.com; contact: magnus.digennaro@gmail.com)';

const CACHE_SECONDS = 30;

function corsHeaders(source) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
    'X-ADSB-Source': source,
    'X-Attribution': 'Live traffic data by adsb.fi (https://adsb.fi) and adsb.lol (https://adsb.lol)',
  };
}

// Simple round-robin offset persisted in global scope (per isolate).
let rrOffset = 0;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders('preflight') });
    }

    if (!url.pathname.startsWith('/api/traffic')) {
      return new Response('Not found', { status: 404 });
    }

    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));
    const dist = Math.min(parseInt(url.searchParams.get('dist') || '100', 10), 250);

    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return new Response(JSON.stringify({ error: 'Bad coordinates' }), {
        status: 400,
        headers: corsHeaders('error'),
      });
    }

    // Round-robin: rotate which upstream goes first to spread rate-limit load.
    const start = rrOffset % UPSTREAMS.length;
    rrOffset += 1;
    const ordered = UPSTREAMS.slice(start).concat(UPSTREAMS.slice(0, start));

    const errors = [];
    for (const up of ordered) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(up.url(lat, lon, dist), {
          headers: {
            'User-Agent': UA,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          return new Response(JSON.stringify(data), {
            headers: corsHeaders(up.name),
          });
        }
        errors.push(`${up.name}: HTTP ${res.status}`);
      } catch (e) {
        errors.push(`${up.name}: ${e.message}`);
      }
      // Brief pause before trying the next upstream — don't hammer.
      await new Promise((r) => setTimeout(r, 500));
    }

    // All upstreams failed — return empty payload; game renders mock/empty gracefully.
    return new Response(
      JSON.stringify({ ac: [], now: Date.now() / 1000, _debug: errors.join(' | ') }),
      { headers: corsHeaders('none') }
    );
  },
};
