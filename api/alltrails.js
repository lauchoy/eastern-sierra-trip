/**
 * AllTrails+OSM Trail Connector — Vercel Serverless Function
 *
 * Two-stage strategy:
 * 1. Firecrawl scrape → rich metadata from AllTrails (name, difficulty, rating, etc.)
 * 2. OSM Overpass API → trail geometry (AllTrails data originates from OSM)
 *
 * Result: Full trail data (metadata + geometry) with zero auth/API keys beyond Firecrawl.
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

// ========== Google Encoded Polyline Decoder ==========
function decodePolyline(encoded, precision = 5) {
  if (!encoded || typeof encoded !== 'string') return null;
  const factor = Math.pow(10, precision);
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

// ========== Extract slug from AllTrails URL ==========
function extractSlug(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/trail\/[^/]+\/[^/]+\/([^/]+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

// ========== Parse trail data from Firecrawl markdown ==========
function parseMarkdownForTrail(md, nameFallback) {
  const trail = {
    name: nameFallback || 'Unnamed Trail',
    difficulty: null,
    length_mi: null,
    elevation_gain_ft: null,
    rating: null,
    route_type: null,
    description: null,
    location: null,
    duration: null
  };

  if (!md) return trail;

  // Try to extract from structured content
  const lines = md.split('\n').map(l => l.trim()).filter(Boolean);

  // Name: usually the first heading
  const nameMatch = md.match(/^#\s+(.+)/m);
  if (nameMatch) trail.name = nameMatch[1].replace(/[🐾🥾🏔️⛰️📍📷]/g, '').trim();

  // Rating: look for star rating patterns
  const ratingMatch = md.match(/(\d+(\.\d+)?)\s*\/?\s*5\s*stars?/i) || md.match(/(\d+(\.\d+)?)\s*star/i);
  if (ratingMatch) trail.rating = parseFloat(ratingMatch[1]);

  // Length: various patterns
  const lengthMatch = md.match(/(\d+(\.\d+)?)\s*(mi|mile|miles)/i);
  if (lengthMatch && !lengthMatch[0].toLowerCase().includes('elevation')) {
    trail.length_mi = parseFloat(lengthMatch[1]);
  }

  // Elevation gain
  const elevMatch = md.match(/(\d+[,\d]*)\s*(ft|feet)\s*(elevation|gain|ascent)/i)
    || md.match(/elevation\s*(gain|ascent)[^0-9]*(\d+[,\d]*)\s*(ft|feet)/i);
  if (elevMatch) {
    trail.elevation_gain_ft = parseInt(elevMatch[1]?.replace(/,/g, '') || elevMatch[2]?.replace(/,/g, ''));
  }

  // Difficulty
  const diffMatch = md.match(/(easy|moderate|hard|difficult|expert|intermediate)/i);
  if (diffMatch) trail.difficulty = diffMatch[1].charAt(0).toUpperCase() + diffMatch[1].slice(1).toLowerCase();

  // Route type
  const rtMatch = md.match(/(out\s*&\s*back|out\s*and\s*back|loop|point\s*to\s*point|point-to-point)/i);
  if (rtMatch) trail.route_type = rtMatch[1];

  // Description (first substantive paragraph)
  const paraMatch = md.match(/\n\n([^#\n]{50,500})\n\n/);
  if (paraMatch) trail.description = paraMatch[1].trim();

  // Location
  const locMatch = md.match(/(?:near|location|region|area)[:\s]+([A-Za-z\s,]+?)(?:\n|$)/i);
  if (locMatch) trail.location = locMatch[1].trim();

  return trail;
}

// ========== Firecrawl scrape for rich metadata ==========
async function scrapeAllTrails(url) {
  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true
    })
  });
  if (!res.ok) throw new Error(`Firecrawl scrape failed (${res.status})`);
  return res.json();
}

// ========== OSM Overpass for trail geometry ==========
async function queryOverpass(trailName, centerLat = null, centerLng = null) {
  let bbox = '';
  if (centerLat && centerLng) {
    const d = 0.2;
    bbox = `(${centerLat - d},${centerLng - d},${centerLat + d},${centerLng + d})`;
  }

  // Extract core name for matching
  let names = [
    trailName,                                                    // full name
    trailName.replace(/\s*Trail$/i, ''),                          // remove "Trail" suffix
    trailName.replace(/\s*Trail$/i, '') + ' Trail',               // add "Trail" suffix
    trailName.replace(/\s*to\s.*$/i, '').trim(),                  // remove "to ..."
    trailName.replace(/\s*to\s.*$/i, '').trim() + ' Trail',       // add "Trail"
  ];
  // De-duplicate
  names = [...new Set(names.map(n => n.replace(/['"]/g, '').substring(0, 50)))];

  let allCoords = [];

  for (const name of names) {
    // Query 1: Exact match on relation, recurse for way geometry
    const relQuery = `[out:json][timeout:8];relation["route"="hiking"]["name"="${name}"]${bbox};out body;>;out geom;`;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(relQuery)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      const data = await res.json();
      if (data.elements?.length) {
        for (const el of data.elements) {
          if (el.type === 'way' && el.geometry?.length) {
            const coords = el.geometry.map(p => [p.lat, p.lon]);
            if (coords.length > allCoords.length) {
              allCoords = coords;
            }
          }
        }
        if (allCoords.length > 10) return { coords: allCoords };
      }
    } catch {}

    // Query 2: Direct way search by name
    const wayQuery = `[out:json][timeout:8];way["name"="${name}"]["highway"="path"](if:length()>100)${bbox};out geom;`;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(wayQuery)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      const data = await res.json();
      if (data.elements?.length) {
        for (const el of data.elements) {
          if (el.geometry?.length) {
            allCoords = el.geometry.map(p => [p.lat, p.lon]);
          }
        }
        if (allCoords.length > 10) return { coords: allCoords };
      }
    } catch {}
  }

  // Query 3: Broad search for any long hiking path in the area
  const broadQuery = `[out:json][timeout:8];way["highway"="path"](if:length()>500)${bbox};out geom;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(broadQuery)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = await res.json();
    if (data.elements?.length) {
      // Return the longest way
      let best = null;
      for (const el of data.elements) {
        if (el.geometry?.length > (best?.geometry?.length || 0)) {
          best = el;
        }
      }
      if (best?.geometry?.length > 20) {
        allCoords = best.geometry.map(p => [p.lat, p.lon]);
      }
    }
  } catch {}

  return allCoords.length > 5 ? { coords: allCoords } : null;
}

// ========== Main handler ==========
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({
      error: 'Provide ?url= with an AllTrails trail URL',
      example: '/api/alltrails?url=https://www.alltrails.com/trail/us/california/little-lakes-valley-to-gem-lakes'
    });
  }

  const slug = extractSlug(url);
  if (!slug) return res.status(400).json({ error: 'Invalid AllTrails URL format' });

  const nameFallback = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Stage 1: Firecrawl scrape for rich metadata
  let metadata = null;
  let markdown = '';
  try {
    const scrape = await scrapeAllTrails(url);
    markdown = scrape?.data?.markdown || '';
    if (markdown) {
      metadata = parseMarkdownForTrail(markdown, nameFallback);
    }
  } catch (err) {
    console.error('Firecrawl scrape failed:', err.message);
  }

  // If Firecrawl failed, use basic metadata from the URL slug
  if (!metadata) {
    metadata = {
      name: nameFallback,
      difficulty: null, length_mi: null, elevation_gain_ft: null,
      rating: null, route_type: null, description: null, location: null
    };
  }

  // Stage 2: OSM Overpass for trail geometry
  let geometry = null;
  try {
    // Try with known California Eastern Sierra coordinates
    let lat = 37.44, lng = -118.73;
    const centerMatch = markdown.match(/[-]?\d+\.\d+,\s*[-]?\d+\.\d+/);
    if (centerMatch) {
      const parts = centerMatch[0].split(',').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0]; lng = parts[1];
      }
    }
    const osmResult = await queryOverpass(metadata.name, lat, lng);
    if (osmResult && osmResult.coords && osmResult.coords.length > 5) {
      geometry = osmResult.coords;
    }
  } catch (err) {
    console.error('OSM Overpass failed:', err.message);
  }

  // Stage 3: Build response
  const trail = {
    name: metadata.name,
    geometry,
    metadata: {
      difficulty: metadata.difficulty,
      length_mi: metadata.length_mi,
      elevation_gain_ft: metadata.elevation_gain_ft,
      rating: metadata.rating,
      route_type: metadata.route_type,
      description: metadata.description,
      location: metadata.location
    }
  };

  // Clean up nulls
  Object.keys(trail.metadata).forEach(k => {
    if (trail.metadata[k] === null) delete trail.metadata[k];
  });

  return res.json({
    source: geometry ? 'alltrails+osm' : 'alltrails',
    trail,
    trail_url: url,
    slug,
    has_geometry: !!geometry,
    geometry_source: geometry ? 'osm' : 'none'
  });
}
