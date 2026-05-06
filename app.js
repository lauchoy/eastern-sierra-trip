/* ========== Eastern Sierra Trip Map — App Logic ========== */
// Zero API keys: uses Leaflet + OSM tiles + OSRM public API for routing

const CONFIG = {
  center: [37.38, -118.68],  // Lat, Lng for Leaflet
  zoom: 10,
  tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  osrmBase: 'https://router.project-osrm.org',
  typeColors: {
    campground: '#2D6A4F',
    trailhead: '#1B4332',
    geo_stop: '#6A4C93',
    hot_spring: '#C9594A'
  },
  typeIcons: {
    campground: '🏕️',
    trailhead: '🥾',
    geo_stop: '📷',
    hot_spring: '♨️'
  },
  typeLabels: {
    campground: 'Campground',
    trailhead: 'Trailhead',
    geo_stop: 'Geo Stop',
    hot_spring: 'Hot Spring'
  },
  typeSVG: {
    campground: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2D6A4F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 20h16M12 4L3 20h18L12 4z"/><path d="M8 20l4-8 4 8"/><circle cx="12" cy="14" r="1.5" fill="#2D6A4F"/></svg>`,
    trailhead: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1B4332" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 20h16"/><path d="M12 3l-8 10h16L12 3z"/><path d="M9 13v7"/><path d="M15 13v7"/><path d="M7 20h10"/></svg>`,
    geo_stop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6A4C93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="15" cy="9" r="3"/><path d="M9 21l6-6"/><path d="M6 21l3-3"/><path d="M15 21l-3-3"/><path d="M12 12l-2 2"/></svg>`,
    hot_spring: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#C9594A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2v4"/><path d="M6 10a6 6 0 0112 0"/><path d="M8 10c0 2.2 1.8 4 4 4s4-1.8 4-4"/><path d="M10 15.5A5 5 0 0012 16a5 5 0 002-.5"/><path d="M9 19a4 4 0 006 0"/></svg>`
  }
};

let tripData, map, markers = {}, routeLayers = {}, activeDay = 'all', activeWaypointId = null;

// ========== Init ==========
async function init() {
  try {
    const res = await fetch('trip.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tripData = await res.json();
  } catch (err) {
    console.error('Failed to load trip data:', err);
    tripData = { waypoints: [], routes: [] };
  }

  map = L.map('map', {
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    zoomControl: true,
    attributionControl: true
  });

  L.tileLayer(CONFIG.tileUrl, {
    attribution: CONFIG.tileAttribution,
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  createMarkers();
  renderAllRoutes();
  buildStopList();
  setupDayTabs();
  setupSidebar();

  // Select base camp by default
  selectWaypoint('convict_lake');
}

// ========== Markers ==========
function createMarkers() {
  if (!tripData.waypoints || tripData.waypoints.length === 0) return;
  tripData.waypoints.forEach(wp => {
    const isBase = wp.id === 'convict_lake';
    const iconHtml = createMarkerIcon(wp.type, isBase);

    const marker = L.marker([wp.lat, wp.lng], {
      icon: L.divIcon({
        html: iconHtml,
        className: isBase ? 'marker-icon marker-base' : 'marker-icon',
        iconSize: isBase ? [44, 44] : [32, 32],
        iconAnchor: isBase ? [22, 22] : [16, 16]
      }),
      zIndexOffset: isBase ? 10000 : 0
    });

    marker.bindTooltip(wp.name, {
      direction: 'top',
      offset: [0, -12],
      className: 'marker-tooltip'
    });

    marker.on('click', () => selectWaypoint(wp.id));
    marker.addTo(map);
    markers[wp.id] = marker;
  });
}

function createMarkerIcon(type, isBase) {
  const color = CONFIG.typeColors[type] || '#888';
  const svg = CONFIG.typeSVG[type] || '';
  const size = isBase ? 36 : 28;

  return `<div style="
    display:flex;align-items:center;justify-content:center;
    width:${size}px;height:${size}px;
    background:${color}22;border-radius:50%;border:2px solid ${color};
    ${isBase ? 'box-shadow:0 0 12px ' + color + '66;' : ''}
  ">${svg}</div>`;
}

// ========== Routes ==========
const routeCache = {};

async function renderAllRoutes() {
  for (const route of tripData.routes) {
    await renderRoute(route);
  }
}

async function renderRoute(route) {
  const waypointIds = route.stops_ordered;
  const coords = waypointIds
    .map(id => tripData.waypoints.find(w => w.id === id))
    .filter(w => w && w.lat && w.lng);

  if (coords.length < 2) return;

  // Build OSRM waypoint string: lng,lat;lng,lat...
  const waypointStr = coords.map(c => `${c.lng},${c.lat}`).join(';');
  const cacheKey = route.day + '_' + waypointStr;

  if (routeCache[cacheKey]) {
    drawRouteLine(route, routeCache[cacheKey], coords);
    return;
  }

  try {
    const url = `${CONFIG.osrmBase}/route/v1/driving/${waypointStr}?geometries=geojson&overview=full&steps=false&alternatives=false`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data || !data.routes || !data.routes[0]) {
      console.warn(`OSRM returned no route for day ${route.day}`);
      drawStraightLine(route, coords);
      return;
    }

    const geometry = data.routes[0].geometry;
    routeCache[cacheKey] = geometry;
    drawRouteLine(route, geometry, coords);
  } catch (err) {
    console.error(`Failed to fetch route for day ${route.day}:`, err);
    // Fallback: straight line
    drawStraightLine(route, coords);
  }
}

function drawRouteLine(route, geometry, coords) {
  const latlngs = geometry.coordinates.map(c => [c[1], c[0]]);

  const polyline = L.polyline(latlngs, {
    color: route.color,
    weight: 4,
    opacity: 0.8,
    dashArray: [10, 6],
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);

  routeLayers[route.day] = polyline;
}

function drawStraightLine(route, coords) {
  const latlngs = coords.map(c => [c.lat, c.lng]);
  const polyline = L.polyline(latlngs, {
    color: route.color,
    weight: 3,
    opacity: 0.5,
    dashArray: [8, 6]
  }).addTo(map);
  routeLayers[route.day] = polyline;
}

function setRouteVisibility(day, visible) {
  Object.entries(routeLayers).forEach(([key, layer]) => {
    const routeDay = parseInt(key);
    if (isNaN(routeDay) || !layer) return;

    if (day === 'all') {
      layer.setStyle({ opacity: 0.8 });
    } else if (day === routeDay) {
      layer.setStyle({ opacity: 0.8 });
    } else {
      layer.setStyle({ opacity: 0 });
    }
  });
}

// ========== Waypoint Selection ==========
function selectWaypoint(id) {
  activeWaypointId = id;
  const wp = tripData.waypoints.find(w => w.id === id);
  if (!wp) return;

  // Update marker highlights
  Object.keys(markers).forEach(mid => {
    const m = markers[mid];
    const isActive = mid === id;
    const zIndex = (mid === 'convict_lake') ? 10000 : 0;
    m.setZIndexOffset(isActive ? 20000 : zIndex);
  });

  updateInfoPanel(wp);
  updateStopListHighlight(id);
  map.setView([wp.lat, wp.lng], map.getZoom(), { animate: true });
}

// ========== Info Panel ==========
function updateInfoPanel(wp) {
  const panel = document.getElementById('info-panel');
  panel.classList.add('visible');

  const typeLabel = CONFIG.typeLabels[wp.type] || wp.type;
  const dayLabel = wp.day === 'base' ? 'Base Camp' : `Day ${wp.day}`;
  const elev = wp.elevation_ft ? `${wp.elevation_ft.toLocaleString()} ft` : '';
  const drive = wp.drive_from_base_min !== null && wp.drive_from_base_min !== undefined
    ? `🚗 ~${wp.drive_from_base_min} min from base camp`
    : '';

  let html = `
    <div class="info-header">
      <span class="info-icon">${CONFIG.typeIcons[wp.type]}</span>
      <div>
        <div class="info-title">${wp.name}</div>
        <div class="info-subtitle">${typeLabel} · ${dayLabel}${elev ? ' · ' + elev : ''}</div>
      </div>
    </div>
  `;

  if (wp.notes) {
    html += `
      <div class="info-section">
        <div class="info-section-header">📝 Notes</div>
        <div class="info-notes">${wp.notes.replace(/\n/g, '<br>')}</div>
      </div>
    `;
  }

  if (wp.warnings && wp.warnings.length > 0) {
    let warningsHtml = '<div class="info-warnings">';
    wp.warnings.forEach(w => {
      const isHard = w.toLowerCase().includes('closure') || w.toLowerCase().includes('citation') || w.toLowerCase().includes('danger');
      warningsHtml += `<div class="info-warning${isHard ? ' hard-closure' : ''}">⚠️ ${w}</div>`;
    });
    warningsHtml += '</div>';
    html += `
      <div class="info-section">
        <div class="info-section-header">⚠️ Warnings</div>
        ${warningsHtml}
      </div>
    `;
  }

  if (wp.links && Object.keys(wp.links).length > 0) {
    const linkLabels = {
      reservation: 'Reserve on Recreation.gov',
      alltrails: 'View on AllTrails',
      inyo_nf: 'Inyo NF Alerts',
      permits: 'Get Wilderness Permit'
    };
    let linksHtml = '<div class="info-links">';
    Object.entries(wp.links).forEach(([key, url]) => {
      const label = linkLabels[key] || key;
      linksHtml += `<a class="info-link" href="${url}" target="_blank" rel="noopener">${label} ↗</a>`;
    });
    linksHtml += '</div>';
    html += `
      <div class="info-section">
        <div class="info-section-header">🔗 Links</div>
        ${linksHtml}
      </div>
    `;
  }

  if (drive) {
    html += `<div class="info-drive">${drive}</div>`;
  }

  panel.innerHTML = html;
}

// ========== Stop List ==========
function buildStopList() {
  const container = document.getElementById('stop-list');

  const groups = { base: [], '1': [], '2': [] };
  tripData.waypoints.forEach(wp => {
    if (groups[wp.day]) groups[wp.day].push(wp);
  });

  const dayLabels = { base: '🏕️ Base Camp', '1': '🚗 Day 1', '2': '🚗 Day 2' };

  let html = '';
  ['base', '1', '2'].forEach(day => {
    const stops = groups[day];
    if (stops.length === 0) return;
    html += `<div class="stop-list-header">${dayLabels[day]}</div>`;
    stops.forEach(wp => {
      const color = CONFIG.typeColors[wp.type] || '#888';
      const isBase = wp.id === 'convict_lake';
      html += `
        <div class="stop-list-item" data-id="${wp.id}">
          <span class="stop-list-dot" style="background:${color}"></span>
          <span class="stop-list-name">${isBase ? '⭐ ' : ''}${wp.name}</span>
          <span class="stop-list-badge">${CONFIG.typeLabels[wp.type]}</span>
          ${wp.elevation_ft ? `<span class="stop-list-elev">${(wp.elevation_ft / 1000).toFixed(1)}k</span>` : ''}
        </div>
      `;
    });
  });

  container.innerHTML = html;

  // Attach click handlers
  container.querySelectorAll('.stop-list-item').forEach(el => {
    el.addEventListener('click', () => selectWaypoint(el.dataset.id));
  });
}

function updateStopListHighlight(id) {
  document.querySelectorAll('.stop-list-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

// ========== Day Tabs ==========
function setupDayTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeDay = tab.dataset.day;
      filterByDay(activeDay);
    });
  });
}

function filterByDay(day) {
  // Show/hide waypoints
  tripData.waypoints.forEach(wp => {
    const marker = markers[wp.id];
    if (!marker) return;

    if (day === 'all') {
      marker.addTo(map);
    } else if (day === 'base') {
      if (wp.day === 'base') marker.addTo(map);
      else map.removeLayer(marker);
    } else {
      // Show waypoints that match this day OR are base camp
      if (wp.day === day || wp.day === 'base') marker.addTo(map);
      else map.removeLayer(marker);
    }
  });

  // Update route visibility
  setRouteVisibility(day);

  // Update stop list visibility
  document.querySelectorAll('.stop-list-item').forEach(el => {
    const id = el.dataset.id;
    const wp = tripData.waypoints.find(w => w.id === id);
    if (!wp) return;
    if (day === 'all' || wp.day === day || wp.day === 'base') {
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  });
}

// ========== Sidebar Toggle ==========
function setupSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('closed');
    toggle.textContent = sidebar.classList.contains('closed') ? '→' : '←';
    setTimeout(() => map.invalidateSize(), 350);
  });
}

// ========== Start ==========
document.addEventListener('DOMContentLoaded', init);
