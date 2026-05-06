/* ========== Eastern Sierra Trip Map — App Logic ========== */
// Zero API keys: uses Leaflet + OSM tiles + OSRM public API for routing

const CONFIG = {
  center: [37.38, -118.68],
  zoom: 10,
  osrmBase: 'https://router.project-osrm.org',
  typeColors: { campground: '#2D6A4F', trailhead: '#1B4332', geo_stop: '#6A4C93', hot_spring: '#C9594A' },
  typeIcons: { campground: '🏕️', trailhead: '🥾', geo_stop: '📷', hot_spring: '♨️' },
  typeLabels: { campground: 'Campground', trailhead: 'Trailhead', geo_stop: 'Geo Stop', hot_spring: 'Hot Spring' },
  typeSVG: {
    campground: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2D6A4F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M12 4L3 20h18L12 4z"/><path d="M8 20l4-8 4 8"/><circle cx="12" cy="14" r="1.5" fill="#2D6A4F"/></svg>`,
    trailhead: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1B4332" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M12 3l-8 10h16L12 3z"/><path d="M9 13v7"/><path d="M15 13v7"/><path d="M7 20h10"/></svg>`,
    geo_stop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6A4C93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="9" r="3"/><path d="M9 21l6-6"/><path d="M6 21l3-3"/><path d="M15 21l-3-3"/><path d="M12 12l-2 2"/></svg>`,
    hot_spring: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#C9594A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M6 10a6 6 0 0112 0"/><path d="M8 10c0 2.2 1.8 4 4 4s4-1.8 4-4"/><path d="M10 15.5A5 5 0 0012 16a5 5 0 002-.5"/><path d="M9 19a4 4 0 006 0"/></svg>`
  },
  // Tile layer definitions for map views
  tileLayers: {
    dark: {
      name: 'Dark Topo',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd'
    },
    terrain: {
      name: 'Outdoors',
      url: 'https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=4f67ffeb8eed4275811cf8d38f8e7ef9',
      attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>',
      maxZoom: 18
    },
    satellite: {
      name: 'Satellite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attr: '&copy; Esri, Maxar, Earthstar Geographics',
      maxZoom: 18
    }
  }
};

let tripData, map, markers = {}, markerGroups = {}, routeLayers = {};
let activeDay = 'all', activeWaypointId = null, activeFilters = {};
let baseTileLayer;

// ========== Mobile Helpers ==========
function isMobile() { return window.innerWidth <= 768; }

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

  // Init filter state: all types visible
  Object.keys(CONFIG.typeColors).forEach(t => { activeFilters[t] = true; });
  tripData.routes.forEach(r => { activeFilters['route_' + r.day] = true; });

  map = L.map('map', {
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    zoomControl: true,
    attributionControl: true
  });

  // Add scale control (improvement #3)
  L.control.scale({ position: 'bottomleft', imperial: true, metric: false }).addTo(map);

  // Base tile layer
  baseTileLayer = L.tileLayer(CONFIG.tileLayers.dark.url, {
    attribution: CONFIG.tileLayers.dark.attr,
    subdomains: CONFIG.tileLayers.dark.subdomains,
    maxZoom: 20
  }).addTo(map);

  // Build layer switcher for map views (improvement #2)
  const baseLayers = {};
  Object.entries(CONFIG.tileLayers).forEach(([key, cfg]) => {
    baseLayers[cfg.name] = L.tileLayer(cfg.url, {
      attribution: cfg.attr,
      subdomains: cfg.subdomains,
      maxZoom: cfg.maxZoom || 20
    });
  });
  L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

  createMarkers();
  renderAllRoutes();
  buildStopList();
  buildFilterPanel();
  setupDayTabs();
  setupSidebar();
  setupSidebarTabs();
  setupTrailConnector();

  // Select base camp by default
  selectWaypoint('convict_lake');
}

// ========== Markers ==========
function createMarkers() {
  if (!tripData.waypoints || tripData.waypoints.length === 0) return;

  tripData.waypoints.forEach(wp => {
    const isBase = wp.id === 'convict_lake';
    const marker = L.marker([wp.lat, wp.lng], {
      icon: L.divIcon({
        html: createMarkerIcon(wp.type, isBase),
        className: isBase ? 'marker-icon marker-base' : 'marker-icon',
        iconSize: isBase ? [44, 44] : [32, 32],
        iconAnchor: isBase ? [22, 22] : [16, 16]
      }),
      zIndexOffset: isBase ? 10000 : 0
    });

    marker.bindTooltip(wp.name, { direction: 'top', offset: [0, -12] });
    marker.on('click', () => selectWaypoint(wp.id));
    marker.addTo(map);
    markers[wp.id] = marker;

    // Group markers by type for filter toggling
    if (!markerGroups[wp.type]) markerGroups[wp.type] = [];
    markerGroups[wp.type].push(marker);
  });
}

function createMarkerIcon(type, isBase) {
  const color = CONFIG.typeColors[type] || '#888';
  const svg = CONFIG.typeSVG[type] || '';
  const size = isBase ? 36 : 28;
  return `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:${color}22;border-radius:50%;border:2px solid ${color};${isBase ? 'box-shadow:0 0 12px ' + color + '66;' : ''}">${svg}</div>`;
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

  const waypointStr = coords.map(c => `${c.lng},${c.lat}`).join(';');
  const cacheKey = route.day + '_' + waypointStr;

  if (routeCache[cacheKey]) {
    drawRouteLine(route, routeCache[cacheKey]);
    return;
  }

  try {
    const url = `${CONFIG.osrmBase}/route/v1/driving/${waypointStr}?geometries=geojson&overview=full&steps=false&alternatives=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data || !data.routes || !data.routes[0]) {
      drawStraightLine(route, coords);
      return;
    }
    routeCache[cacheKey] = data.routes[0].geometry;
    drawRouteLine(route, data.routes[0].geometry);
  } catch (err) {
    drawStraightLine(route, coords);
  }
}

function drawRouteLine(route, geometry) {
  const latlngs = geometry.coordinates.map(c => [c[1], c[0]]);
  const polyline = L.polyline(latlngs, {
    color: route.color, weight: 4, opacity: 0.8, dashArray: [10, 6], lineCap: 'round', lineJoin: 'round'
  }).addTo(map);
  routeLayers[route.day] = polyline;
}

function drawStraightLine(route, coords) {
  const latlngs = coords.map(c => [c.lat, c.lng]);
  const polyline = L.polyline(latlngs, {
    color: route.color, weight: 3, opacity: 0.5, dashArray: [8, 6]
  }).addTo(map);
  routeLayers[route.day] = polyline;
}

function setRouteVisibility(day, visible) {
  Object.entries(routeLayers).forEach(([key, layer]) => {
    const routeDay = parseInt(key);
    if (isNaN(routeDay) || !layer) return;
    layer.setStyle({ opacity: (day === 'all' || day === routeDay) ? 0.8 : 0 });
  });
}

// ========== Filter System ==========
function buildFilterPanel() {
  const container = document.getElementById('filter-panel');
  if (!container) return;

  // Marker type filters
  let html = `<div class="filter-section">
    <div class="filter-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <span>📍 Point Types</span>
      <span class="filter-toggle">−</span>
    </div>
    <div class="filter-body">`;

  Object.entries(CONFIG.typeLabels).forEach(([type, label]) => {
    const color = CONFIG.typeColors[type];
    html += `
      <label class="filter-item">
        <input type="checkbox" checked data-filter="type" data-value="${type}" onchange="toggleTypeFilter('${type}', this.checked)">
        <span class="filter-dot" style="background:${color}"></span>
        ${label}
      </label>`;
  });

  html += `</div></div>`;

  // Route filters
  html += `<div class="filter-section">
    <div class="filter-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <span>🗺️ Routes</span>
      <span class="filter-toggle">−</span>
    </div>
    <div class="filter-body">`;

  tripData.routes.forEach(route => {
    html += `
      <label class="filter-item">
        <input type="checkbox" checked data-filter="route" data-value="${route.day}" onchange="toggleRouteFilter(${route.day}, this.checked)">
        <span class="filter-line" style="background:${route.color}"></span>
        ${route.label}
      </label>`;
  });

  html += `</div></div>`;

  container.innerHTML = html;
}

function toggleTypeFilter(type, visible) {
  activeFilters[type] = visible;
  (markerGroups[type] || []).forEach(marker => {
    if (visible) marker.addTo(map);
    else map.removeLayer(marker);
  });
}

function toggleRouteFilter(day, visible) {
  activeFilters['route_' + day] = visible;
  const layer = routeLayers[day];
  if (layer) {
    layer.setStyle({ opacity: visible ? 0.8 : 0 });
  }
}

// ========== Waypoint Selection ==========
function selectWaypoint(id) {
  activeWaypointId = id;
  const wp = tripData.waypoints.find(w => w.id === id);
  if (!wp) return;

  Object.keys(markers).forEach(mid => {
    const m = markers[mid];
    const isActive = mid === id;
    const baseZ = (mid === 'convict_lake') ? 10000 : 0;
    m.setZIndexOffset(isActive ? 20000 : baseZ);
  });

  updateInfoPanel(wp);
  updateStopListHighlight(id);
  map.setView([wp.lat, wp.lng], map.getZoom(), { animate: true });
  // On mobile: auto-close sidebar so info panel is visible
  if (isMobile()) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('closed')) {
      sidebar.classList.add('closed');
      document.getElementById('sidebar-toggle').textContent = '≡';
    }
  }
}

// ========== Info Panel ==========
function updateInfoPanel(wp) {
  const panel = document.getElementById('info-panel');
  panel.classList.add('visible');

  const typeLabel = CONFIG.typeLabels[wp.type] || wp.type;
  const dayLabel = wp.day === 'base' ? 'Base Camp' : `Day ${wp.day}`;
  const elev = wp.elevation_ft ? `${wp.elevation_ft.toLocaleString()} ft` : '';
  const drive = wp.drive_from_base_min !== null && wp.drive_from_base_min !== undefined
    ? `🚗 ~${wp.drive_from_base_min} min from base camp` : '';

  let html = `
    <div class="info-header">
      <span class="info-icon">${CONFIG.typeIcons[wp.type]}</span>
      <div>
        <div class="info-title">${wp.name}</div>
        <div class="info-subtitle">${typeLabel} · ${dayLabel}${elev ? ' · ' + elev : ''}</div>
      </div>
      <button class="info-close" onclick="hideInfoPanel()" aria-label="Close">✕</button>
    </div>`;

  if (wp.notes) {
    html += `<div class="info-section"><div class="info-section-header">📝 Notes</div><div class="info-notes">${wp.notes.replace(/\n/g, '<br>')}</div></div>`;
  }

  if (wp.warnings && wp.warnings.length > 0) {
    let warningsHtml = '<div class="info-warnings">';
    wp.warnings.forEach(w => {
      const isHard = /closure|citation|danger/i.test(w);
      warningsHtml += `<div class="info-warning${isHard ? ' hard-closure' : ''}">⚠️ ${w}</div>`;
    });
    warningsHtml += '</div>';
    html += `<div class="info-section"><div class="info-section-header">⚠️ Warnings</div>${warningsHtml}</div>`;
  }

  if (wp.links && Object.keys(wp.links).length > 0) {
    const linkLabels = { reservation: 'Reserve on Recreation.gov', alltrails: 'View on AllTrails', inyo_nf: 'Inyo NF Alerts', permits: 'Get Wilderness Permit' };
    let linksHtml = '<div class="info-links">';
    Object.entries(wp.links).forEach(([key, url]) => {
      linksHtml += `<a class="info-link" href="${url}" target="_blank" rel="noopener">${linkLabels[key] || key} ↗</a>`;
    });
    linksHtml += '</div>';
    html += `<div class="info-section"><div class="info-section-header">🔗 Links</div>${linksHtml}</div>`;
  }

  if (drive) html += `<div class="info-drive">${drive}</div>`;
  panel.innerHTML = html;
}

// ========== Hide Info Panel ==========
function hideInfoPanel() {
  document.getElementById('info-panel').classList.remove('visible');
}

// ========== Stop List ==========
function buildStopList() {
  const container = document.getElementById('stop-list');
  const groups = { base: [], '1': [], '2': [] };
  tripData.waypoints.forEach(wp => { if (groups[wp.day]) groups[wp.day].push(wp); });

  const dayLabels = { base: '🏕️ Base Camp', '1': '🚗 Day 1', '2': '🚗 Day 2' };
  let html = '';
  ['base', '1', '2'].forEach(day => {
    const stops = groups[day];
    if (stops.length === 0) return;
    html += `<div class="stop-list-header">${dayLabels[day]}</div>`;
    stops.forEach(wp => {
      const color = CONFIG.typeColors[wp.type] || '#888';
      const isBase = wp.id === 'convict_lake';
      html += `<div class="stop-list-item" data-id="${wp.id}"><span class="stop-list-dot" style="background:${color}"></span><span class="stop-list-name">${isBase ? '⭐ ' : ''}${wp.name}</span><span class="stop-list-badge">${CONFIG.typeLabels[wp.type]}</span>${wp.elevation_ft ? '<span class="stop-list-elev">' + (wp.elevation_ft / 1000).toFixed(1) + 'k</span>' : ''}</div>`;
    });
  });
  container.innerHTML = html;
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
  tripData.waypoints.forEach(wp => {
    const marker = markers[wp.id];
    if (!marker) return;
    if (!activeFilters[wp.type]) { map.removeLayer(marker); return; }
    if (day === 'all' || wp.day === day || wp.day === 'base') marker.addTo(map);
    else map.removeLayer(marker);
  });
  setRouteVisibility(day);
  document.querySelectorAll('.stop-list-item').forEach(el => {
    const id = el.dataset.id;
    const wp = tripData.waypoints.find(w => w.id === id);
    if (!wp) return;
    el.style.display = (day === 'all' || wp.day === day || wp.day === 'base') ? 'flex' : 'none';
  });
}

// ========== Sidebar Toggle ==========
function setupSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  toggle.addEventListener('click', () => {
    const wasClosed = sidebar.classList.contains('closed');
    sidebar.classList.toggle('closed');
    toggle.textContent = sidebar.classList.contains('closed') ? '≡' : '✕';
    // On mobile: hide info panel when opening sidebar
    if (isMobile() && sidebar.classList.contains('closed') === false) {
      hideInfoPanel();
    }
    setTimeout(() => map.invalidateSize(), 350);
  });

  // ========== Mobile: Bottom Sheet Touch Drag ==========
  let startY = 0, currentY = 0, isDragging = false;
  const dragHandle = sidebar.querySelector('.sidebar-drag-handle');
  if (dragHandle) {
    dragHandle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      isDragging = true;
      sidebar.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const delta = currentY - startY;
      if (delta > 0) {
        const sheetH = sidebar.offsetHeight;
        const pct = Math.min(delta / sheetH, 0.9);
        sidebar.style.transform = `translateY(${pct * 100}%)`;
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      sidebar.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
      const delta = currentY - startY;
      const sheetH = sidebar.offsetHeight;
      if (delta > sheetH * 0.25) {
        // Close the sheet
        sidebar.classList.add('closed');
        toggle.textContent = '≡';
      } else {
        // Snap back open
        sidebar.style.transform = '';
        sidebar.classList.remove('closed');
        toggle.textContent = '✕';
      }
      startY = 0; currentY = 0;
    }, { passive: true });
  }
}

// ========== Sidebar Tabs (Stops / Filters) ==========
function setupSidebarTabs() {
  document.querySelectorAll('#sidebar-tabs .st').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#sidebar-tabs .st').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const panel = tab.dataset.st;
      document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
      const target = document.getElementById(panel + '-panel');
      if (target) target.classList.add('active');
    });
  });
}

// ========== AllTrails Trail Connector ==========
const importedTrails = {}; // { id: { name, geometry, metadata, layer } }
let trailColorIndex = 0;
const TRAIL_COLORS = ['#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#06B6D4', '#F97316', '#6366F1'];

function setupTrailConnector() {
  const btn = document.getElementById('trail-search-btn');
  const input = document.getElementById('trail-url-input');
  if (!btn || !input) return;

  btn.addEventListener('click', () => {
    const url = input.value.trim();
    if (url) searchAndRenderTrail(url);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = input.value.trim();
      if (url) searchAndRenderTrail(url);
    }
  });
}

async function searchAndRenderTrail(url) {
  const loading = document.getElementById('trail-loading');
  const errorDiv = document.getElementById('trail-error');
  const resultDiv = document.getElementById('trail-result');

  loading.style.display = 'flex';
  errorDiv.style.display = 'none';
  resultDiv.style.display = 'none';

  try {
    const apiUrl = `/api/alltrails?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    loading.style.display = 'none';

    if (!res.ok || !data.trail) {
      errorDiv.textContent = data.error || 'Failed to load trail data';
      errorDiv.style.display = 'block';
      return;
    }

    renderImportedTrail(data.trail, data.trail_url);
  } catch (err) {
    loading.style.display = 'none';
    errorDiv.textContent = 'Network error: ' + err.message;
    errorDiv.style.display = 'block';
  }
}

function renderImportedTrail(trailData, sourceUrl) {
  const resultDiv = document.getElementById('trail-result');
  const trailList = document.getElementById('trail-list');
  const trailId = 'imported_' + Date.now();

  const color = TRAIL_COLORS[trailColorIndex % TRAIL_COLORS.length];
  trailColorIndex++;

  // Store trail data
  importedTrails[trailId] = {
    name: trailData.name,
    geometry: trailData.geometry,
    metadata: trailData.metadata,
    sourceUrl,
    color,
    visible: true
  };

  // Render geometry on map
  let polyline = null;
  if (trailData.geometry && trailData.geometry.length > 1) {
    polyline = L.polyline(trailData.geometry, {
      color,
      weight: 4,
      opacity: 0.9,
      dashArray: null,
      lineCap: 'round'
    }).addTo(map);

    // Fit map to show the trail
    map.fitBounds(polyline.getBounds(), { padding: [50, 50], maxZoom: 13 });

    // Add start marker
    const start = trailData.geometry[0];
    L.circleMarker([start[0], start[1]], {
      radius: 6, color: '#10B981', fillColor: '#10B981', fillOpacity: 1, weight: 2
    }).addTo(map).bindTooltip(`Start: ${trailData.name}`, {permanent: false});
  }

  importedTrails[trailId].polyline = polyline;

  // Update result panel in sidebar
  const m = trailData.metadata || {};
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `
    <div class="trail-result-inner" style="border-left-color:${color}">
      <div class="trail-result-name">🥾 ${trailData.name}</div>
      <div class="trail-result-stats">
        ${m.route_type ? '<span class="tr-stat">🔄 ' + m.route_type + '</span>' : ''}
        ${m.difficulty ? '<span class="tr-stat">📊 ' + m.difficulty + '</span>' : ''}
        ${m.rating ? '<span class="tr-stat">⭐ ' + m.rating + '/5</span>' : ''}
        ${m.length_mi ? '<span class="tr-stat">📏 ' + m.length_mi + ' mi</span>' : ''}
        ${m.elevation_gain_ft ? '<span class="tr-stat">⛰️ ' + m.elevation_gain_ft + ' ft</span>' : ''}
        ${m.location ? '<span class="tr-stat">📍 ' + m.location + '</span>' : ''}
      </div>
      ${m.description ? '<div class="trail-result-desc">' + m.description.substring(0, 200) + (m.description.length > 200 ? '...' : '') + '</div>' : ''}
      <div class="trail-result-actions">
        <button class="tr-action btn-remove" data-id="${trailId}">Remove</button>
        <button class="tr-action btn-focus" data-id="${trailId}">Focus</button>
      </div>
    </div>
  `;

  // Wire result actions
  resultDiv.querySelector('.btn-remove')?.addEventListener('click', () => removeTrail(trailId));
  resultDiv.querySelector('.btn-focus')?.addEventListener('click', () => focusTrail(trailId));

  // Add to trail list
  const listItem = document.createElement('div');
  listItem.className = 'trail-list-item';
  listItem.dataset.trailId = trailId;
  listItem.innerHTML = `
    <span class="trail-list-color" style="background:${color}"></span>
    <span class="trail-list-name">${trailData.name.substring(0, 40)}</span>
    <button class="trail-list-remove" data-id="${trailId}">✕</button>
  `;
  listItem.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    selectImportedTrail(trailId);
  });
  listItem.querySelector('.trail-list-remove')?.addEventListener('click', (e) => {
    e.stopPropagation();
    removeTrail(trailId);
  });
  trailList.prepend(listItem);

  // Clear input
  document.getElementById('trail-url-input').value = '';
}

function selectImportedTrail(trailId) {
  const trail = importedTrails[trailId];
  if (!trail) return;

  if (trail.polyline) {
    map.fitBounds(trail.polyline.getBounds(), { padding: [50, 50], maxZoom: 13 });
  }

  // Re-render the result panel
  const resultDiv = document.getElementById('trail-result');
  const m = trail.metadata || {};
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `
    <div class="trail-result-inner" style="border-left-color:${trail.color}">
      <div class="trail-result-name">🥾 ${trail.name}</div>
      <div class="trail-result-stats">
        ${m.route_type ? '<span class="tr-stat">🔄 ' + m.route_type + '</span>' : ''}
        ${m.difficulty ? '<span class="tr-stat">📊 ' + m.difficulty + '</span>' : ''}
        ${m.rating ? '<span class="tr-stat">⭐ ' + m.rating + '/5</span>' : ''}
        ${m.length_mi ? '<span class="tr-stat">📏 ' + m.length_mi + ' mi</span>' : ''}
        ${m.elevation_gain_ft ? '<span class="tr-stat">⛰️ ' + m.elevation_gain_ft + ' ft</span>' : ''}
        ${m.description ? '<div class="trail-result-desc">' + m.description.substring(0, 200) + (m.description.length > 200 ? '...' : '') + '</div>' : ''}
      </div>
      <div class="trail-result-actions">
        <button class="tr-action btn-remove" data-id="${trailId}">Remove</button>
        <button class="tr-action btn-focus" data-id="${trailId}">Focus</button>
      </div>
    </div>
  `;
  resultDiv.querySelector('.btn-remove')?.addEventListener('click', () => removeTrail(trailId));
  resultDiv.querySelector('.btn-focus')?.addEventListener('click', () => focusTrail(trailId));
}

function focusTrail(trailId) {
  const trail = importedTrails[trailId];
  if (!trail?.polyline) return;
  map.fitBounds(trail.polyline.getBounds(), { padding: [50, 50], maxZoom: 14 });
}

function removeTrail(trailId) {
  const trail = importedTrails[trailId];
  if (!trail) return;

  if (trail.polyline) map.removeLayer(trail.polyline);
  if (trail.startMarker) map.removeLayer(trail.startMarker);

  delete importedTrails[trailId];

  // Remove from list UI
  document.querySelector(`.trail-list-item[data-trail-id="${trailId}"]`)?.remove();

  // Clear result panel if showing this trail
  const resultDiv = document.getElementById('trail-result');
  if (resultDiv.dataset.trailId === trailId) {
    resultDiv.style.display = 'none';
  }
}
document.addEventListener('DOMContentLoaded', init);
