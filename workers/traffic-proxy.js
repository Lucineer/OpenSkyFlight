// Traffic proxy Worker — proxies adsb.fi (fallback: adsb.lol) for live air traffic.
//
// GET /api/traffic?lat=57.05&lon=-135.33&dist=100
//
// - Adds CORS headers so the game can fetch from the browser
// - Sets identifying User-Agent (required by adsb.fi / adsb.lol)
// - 10s edge cache so upstream sees ~1 req/10s regardless of player count
// - Falls back to adsb.lol if adsb.fi fails
//
// Attribution: live traffic data by adsb.fi (https://adsb.fi)

const UPSTREAMS = [
  {
    name: 'adsb.fi',
    url: (lat, lon, dist) =>
      `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${dist}`,
  },
  {
    name: 'adsb.lol',
    url: (lat, lon, dist) =>
      `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
  },
];

const UA = 'SitkaSkies/1.0';

function corsHeaders(source) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=10',
    'X-ADSB-Source': source,
    'X-Attribution': 'Live traffic data by adsb.fi (https://adsb.fi)',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders('preflight') });
    }

    // Only serve /api/traffic
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

    // Try upstreams in order
    const errors = [];
    for (const up of UPSTREAMS) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(up.url(lat, lon, dist), {
          headers: { 'User-Agent': UA },
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
    }

    // All upstreams failed — return empty (game handles gracefully)
    return new Response(JSON.stringify({ ac: [], now: Date.now() / 1000, _debug: errors.join(' | ') }), {
      headers: corsHeaders('none'),
    });
  },
};
