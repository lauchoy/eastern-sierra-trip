/**
 * AllTrails Connector — Powered by Firecrawl
 *
 * Accepts an AllTrails trail URL, uses Firecrawl to extract
 * trail metadata + geometry, returns structured GeoJSON.
 *
 * Strategy:
 * 1. Firecrawl scrape the trail page (handles JS, anti-bot)
 * 2. Extract __NEXT_DATA__ from raw HTML for geometry polyline
 * 3. Decode Google encoded polyline → [lat, lng] coordinates
 * 4. Extract structured metadata via Firecrawl/LLM
 * 5. Fall back to OSM Overpass for trails without AllTrails URLs
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

// ========== Google Encoded Polyline Decoder (precision 5) ==========
function decodePolyline(encoded, precision = 5) {
  if (!encoded || typeof encoded !== 'string') return null;
  const factor = Math.pow(10, precision);
  const coords = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1));

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1));

    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

// ========== Deep search for polyline data in JSON ==========
function deepFindPolylines(obj, results = []) {
  if (!obj || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) {
    obj.forEach(item => deepFindPolylines(item, results));
    return results;
  }
  // Look for Google encoded polyline strings
  if (obj.pointsData && typeof obj.pointsData === 'string' && obj.pointsData.length > 20) {
    results.push(obj.pointsData);
  }
  if (obj.polyline && typeof obj.polyline === 'object') {
    deepFindPolylines(obj.polyline, results);
  }
  // Try common AllTrails geometry fields
  ['encodedPolyline', 'polyline', 'path', 'routePath', 'routeLine'].forEach(field => {
    if (obj[field] && typeof obj[field] === 'string' && obj[field].length > 20) {
      results.push(obj[field]);
    }
  });
  Object.values(obj).forEach(val => {
    if (val && typeof val === 'object') deepFindPolylines(val, results);
  });
  return results;
}

// ========== Extract trail data from __NEXT_DATA__ JSON ==========
function extractFromNextData(jsonStr) {
  try {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    const pageProps = data?.props?.pageProps || {};
    let trail = pageProps.trail || pageProps.route || null;

    // Direct API response format
    if (!trail && pageProps.trails?.[0]) trail = pageProps.trails[0];
    if (!trail && pageProps.maps?.[0]) {
      trail = pageProps.maps[0];
      trail._isMap = true;
    }

    // Find polylines anywhere in the data
    const allPolylines = deepFindPolylines(pageProps);
    let geometry = null;
    if (allPolylines.length > 0) {
      geometry = decodePolyline(allPolylines[0]);
    }

    // Extract metadata
    const get = (obj, ...keys) => {
      for (const k of keys) {
        const val = typeof obj === 'object' ? obj?.[k] : obj;
        if (val !== undefined && val !== null) return val;
      }
      return null;
    };

    return {
      name: get(trail, 'name', 'title', 'displayName') || 'Unnamed Trail',
      geometry,
      metadata: {
        difficulty: get(trail, 'difficulty', 'skillLevel'),
        length_mi: trail?.length ? parseFloat(trail.length)?.toFixed(1) : null,
        length_km: trail?.lengthKm ? parseFloat(trail.lengthKm)?.toFixed(1) : null,
        elevation_gain_ft: get(trail, 'elevationGain', 'ascent', 'elevation_gain'),
        rating: trail?.rating ? parseFloat(trail.rating)?.toFixed(1) : null,
        route_type: get(trail, 'routeType', 'route_type', 'activityType'),
        duration: get(trail, 'duration', 'durationHours'),
        description: get(trail, 'description', 'summary'),
        thumbnail: get(trail, 'thumbnail', 'photoUrl', 'imageUrl'),
        stats: trail?.stats ? {
          distance: trail.stats.distance,
          elevationGain: trail.stats.elevationGain,
          avgGrade: trail.stats.avgGrade,
          maxElevation: trail.stats.maxElevation,
          minElevation: trail.stats.minElevation,
          duration: trail.stats.duration
        } : null
      }
    };
  } catch (err) {
    console.error('extractFromNextData failed:', err.message);
    return null;
  }
}

// ========== Extract trail URL slug ==========
function extractSlug(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/trail\/[^/]+\/[^/]+\/([^/]+)/);
    if (match) return match[1];
    const idMatch = u.pathname.match(/\/trails\/(\d+)/);
    if (idMatch) return idMatch[1];
    return null;
  } catch { return null; }
}

// ========== Firecrawl scrape ==========
async function firecrawlScrape(url) {
  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'rawHtml'],
      onlyMainContent: false
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Firecrawl scrape failed (${res.status}): ${err}`);
  }
  return res.json();
}

// ========== Firecrawl LLM extract (for structured metadata) ==========
async function firecrawlExtract(url) {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      difficulty: { type: 'string' },
      length_miles: { type: 'number' },
      elevation_gain_ft: { type: 'number' },
      rating: { type: 'number' },
      route_type: { type: 'string' },
      description: { type: 'string' },
      duration_hours: { type: 'number' },
      location: { type: 'string' }
    }
  };

  const res = await fetch(`${FIRECRAWL_BASE}/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({
      urls: [url],
      prompt: 'Extract hiking trail information from this AllTrails page. Include all metadata about the trail.',
      schema,
      enableWebSearch: false
    })
  });
  if (!res.ok) {
    const err = await res.text();
    console.warn(`Firecrawl extract failed (${res.status}): ${err}`);
    return null;
  }
  const result = await res.json();
  return result?.data?.extracted || result?.data || null;
}

// ========== OSM Overpass fallback ==========
async function searchOverpass(name, lat, lng) {
  const query = `[out:json];(way["name"~"${name.replace(/['"]/g, '').substring(0, 30)}"](around:5000,${lat},${lng});relation["route"="hiking"]["name"~"${name.replace(/['"]/g, '').substring(0, 30)}"](around:5000,${lat},${lng}););out geom;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = await res.json();
    if (!data.elements?.length) return null;
    const el = data.elements[0];
    const coords = el.geometry ? el.geometry.map(p => [p.lat, p.lon]) : [];
    return {
      name: el.tags?.name || name,
      geometry: coords,
      metadata: {
        difficulty: el.tags?.difficulty || null,
        length_mi: el.tags?.length ? (parseFloat(el.tags.length) * 0.62137).toFixed(1) : null,
        source: 'OpenStreetMap'
      }
    };
  } catch (err) {
    console.error('Overpass query failed:', err.message);
    return null;
  }
}

// ========== Main Handler ==========
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, name, lat, lng } = req.query;

  // ── Mode 1: Resolve by AllTrails URL ─────────────────────
  if (url) {
    const slug = extractSlug(url);
    if (!slug) {
      return res.status(400).json({ error: 'Could not extract trail slug from URL' });
    }

    let trailData = null;

    // Step 1: Firecrawl scrape for __NEXT_DATA__
    try {
      const scrape = await firecrawlScrape(url);
      if (scrape?.data?.rawHtml) {
        const html = scrape.data.rawHtml;

        // Find __NEXT_DATA__
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
        if (nextDataMatch?.[1]) {
          trailData = extractFromNextData(nextDataMatch[1]);
        }

        // If no geometry yet, search for embedded GeoJSON/GPX in HTML
        if (!trailData?.geometry) {
          // Try finding AllTrails internal state JSON
          const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/);
          if (stateMatch?.[1]) {
            trailData = extractFromNextData(stateMatch[1]) || trailData;
          }
        }

        // Try to find GPX export URL in the page
        if (!trailData?.geometry) {
          const exportMatch = html.match(/\/trail\/[^"']+\/export\?format=gpx/i);
          if (exportMatch) {
            try {
              const gpxUrl = `https://www.alltrails.com${exportMatch[0]}`;
              const gpxRes = await fetch(gpxUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
              });
              if (gpxRes.ok) {
                const gpxText = await gpxRes.text();
                const trkpts = [...gpxText.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)">/g)];
                if (trkpts.length > 0) {
                  trailData = trailData || { name: slug.replace(/-/g, ' ') };
                  trailData.geometry = trkpts.map(t => [parseFloat(t[1]), parseFloat(t[2])]);
                }
              }
            } catch {}
          }
        }
      }

      // Step 2: Use Firecrawl LLM extraction for rich metadata
      if (scrape && !trailData?.metadata?.rating) {
        try {
          const extracted = await firecrawlExtract(url);
          if (extracted) {
            trailData = trailData || { name: extracted.name };
            trailData.metadata = {
              ...(trailData.metadata || {}),
              ...extracted
            };
          }
        } catch {}
      }
    } catch (err) {
      console.error('Firecrawl flow failed:', err.message);
    }

    if (!trailData) {
      return res.status(404).json({
        error: 'Could not extract trail data',
        note: 'Firecrawl may have been rate-limited or the page requires authentication'
      });
    }

    return res.json({
      source: 'alltrails',
      trail: trailData,
      trail_url: url,
      slug
    });
  }

  // ── Mode 2: Search by name + location (OSM Overpass) ────
  if (name && lat && lng) {
    const result = await searchOverpass(name, parseFloat(lat), parseFloat(lng));
    if (!result) {
      return res.status(404).json({ error: 'Trail not found in OpenStreetMap' });
    }
    return res.json({ source: 'osm', trail: result });
  }

  return res.status(400).json({
    error: 'Provide ?url= (AllTrails URL) or ?name=&lat=&lng= (OSM search)',
    example: '/api/alltrails?url=https://www.alltrails.com/trail/us/california/little-lakes-valley-to-gem-lakes'
  });
}
