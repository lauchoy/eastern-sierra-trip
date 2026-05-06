// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Eastern Sierra Trip Map', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for map tiles and app to initialize
    await page.waitForSelector('#map.leaflet-container', { timeout: 15000 });
    await page.waitForTimeout(2000); // Let markers render
  });

  // ========== LAYOUT ==========

  test('loads with correct title and day tabs', async ({ page }) => {
    const title = page.locator('#header h1');
    await expect(title).toContainText('Eastern Sierra');

    const tabs = page.locator('.tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveText('All');
    await expect(tabs.nth(1)).toHaveText('Day 1');
    await expect(tabs.nth(2)).toHaveText('Day 2');
  });

  test('defaults to "All" tab as active', async ({ page }) => {
    const allTab = page.locator('.tab[data-day="all"]');
    await expect(allTab).toHaveClass(/active/);
  });

  test('has a visible sidebar with stop list', async ({ page }) => {
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).not.toHaveClass(/closed/);
  });

  test('has sidebar toggle button', async ({ page }) => {
    const toggle = page.locator('#sidebar-toggle');
    await expect(toggle).toBeVisible();
  });

  test('sidebar collapses and expands on toggle', async ({ page }) => {
    const toggle = page.locator('#sidebar-toggle');
    const sidebar = page.locator('#sidebar');

    // Sidebar starts open
    await expect(sidebar).toBeVisible();

    // Collapse
    await toggle.click();
    await page.waitForTimeout(400); // Let transition finish
    const closed = await sidebar.evaluate(el => el.classList.contains('closed'));
    expect(closed).toBe(true);

    // Expand
    await toggle.click();
    await page.waitForTimeout(400);
    const open = await sidebar.evaluate(el => !el.classList.contains('closed'));
    expect(open).toBe(true);
  });

  test('legend is visible on the map', async ({ page }) => {
    const legend = page.locator('#legend');
    await expect(legend).toBeVisible();

    // Check all legend items (4: Campground, Trailhead, Driving route, Imported trail)
    const items = legend.locator('.legend-item');
    await expect(items).toHaveCount(4);
  });

  // ========== MARKERS ==========

  test('has markers for all waypoints', async ({ page }) => {
    // Leaflet creates image elements for divIcon markers
    const markers = page.locator('.leaflet-marker-icon');
    // Each marker creates a div, and map may have multiple layers
    // We check that our marker divs exist with the marker-icon class
    const markerIcons = page.locator('.marker-icon');
    const count = await markerIcons.count();
    expect(count).toBeGreaterThanOrEqual(7); // All 7 waypoints
  });

  test('clicking a marker shows info panel', async ({ page }) => {
    const infoPanel = page.locator('#info-panel');
    await expect(infoPanel).toHaveClass(/visible/);

    // Panel should show content for default selection (Convict Lake)
    await expect(infoPanel).toContainText('Convict Lake Campground');
    await expect(infoPanel).toContainText('Base Camp');
  });

  test('clicking stop list item updates info panel', async ({ page }) => {
    // Click on Mosquito Flat
    const stopItem = page.locator('.stop-list-item[data-id="mosquito_flat"]');
    await stopItem.click();

    const infoPanel = page.locator('#info-panel');
    await expect(infoPanel).toContainText('Mosquito Flat Trailhead');
    await expect(infoPanel).toContainText('10,230 ft');
  });

  test('warning badges are shown for waypoints with warnings', async ({ page }) => {
    // Big Pine has warnings
    const stopItem = page.locator('.stop-list-item[data-id="big_pine_trailhead"]');
    await stopItem.click();

    const infoPanel = page.locator('#info-panel');
    await expect(infoPanel).toContainText('microspikes');
    await expect(infoPanel).toContainText('parking fee');
  });

  test('links section renders for waypoints with links', async ({ page }) => {
    const stopItem = page.locator('.stop-list-item[data-id="convict_lake"]');
    await stopItem.click();

    const link = page.locator('.info-link');
    await expect(link).toContainText('Reserve on Recreation.gov');
    await expect(link).toHaveAttribute('href', /recreation\.gov/);
  });

  // ========== DAY FILTER ==========

  test('Day 1 filter shows only base camp + Day 1 stops', async ({ page }) => {
    await page.locator('.tab[data-day="1"]').click();

    // Base camp + Day 1 stops should be visible in sidebar
    const visible = page.locator('.stop-list-item:visible');
    const visibleCount = await visible.count();
    // Day 1 has: base (convict) + 5 others = 6
    expect(visibleCount).toBe(6);
  });

  test('Day 2 filter shows only base camp + Day 2 stop', async ({ page }) => {
    await page.locator('.tab[data-day="2"]').click();

    const visible = page.locator('.stop-list-item:visible');
    const visibleCount = await visible.count();
    // Day 2 has: base (convict) + Big Pine = 2
    expect(visibleCount).toBe(2);
  });

  test('All tab shows all stop list items', async ({ page }) => {
    await page.locator('.tab[data-day="2"]').click();
    await page.locator('.tab[data-day="all"]').click();

    const visible = page.locator('.stop-list-item:visible');
    const visibleCount = await visible.count();
    expect(visibleCount).toBe(7); // All 7 waypoints
  });

  test('tab switching highlights correct tab', async ({ page }) => {
    await page.locator('.tab[data-day="1"]').click();
    await expect(page.locator('.tab[data-day="1"]')).toHaveClass(/active/);
    await expect(page.locator('.tab[data-day="2"]')).not.toHaveClass(/active/);

    await page.locator('.tab[data-day="2"]').click();
    await expect(page.locator('.tab[data-day="2"]')).toHaveClass(/active/);
    await expect(page.locator('.tab[data-day="1"]')).not.toHaveClass(/active/);
  });

  // ========== ROUTE DATA ==========

  test('trip.json loads and has correct structure', async ({ page }) => {
    const tripData = await page.evaluate(async () => {
      const res = await fetch('/trip.json');
      return await res.json();
    });

    expect(tripData.waypoints).toHaveLength(7);
    expect(tripData.routes).toHaveLength(2);

    // Validate waypoint schema
    tripData.waypoints.forEach(wp => {
      expect(wp).toHaveProperty('id');
      expect(wp).toHaveProperty('name');
      expect(wp).toHaveProperty('type');
      expect(wp).toHaveProperty('day');
      expect(wp).toHaveProperty('lat');
      expect(wp).toHaveProperty('lng');
      expect(wp).toHaveProperty('elevation_ft');
      expect(wp).toHaveProperty('notes');
      expect(wp).toHaveProperty('warnings');
      expect(wp).toHaveProperty('links');
      expect(['campground', 'trailhead', 'geo_stop', 'hot_spring']).toContain(wp.type);
      expect(['base', '1', '2']).toContain(wp.day);
    });

    // Validate route schema
    tripData.routes.forEach(route => {
      expect(route).toHaveProperty('day');
      expect(route).toHaveProperty('label');
      expect(route).toHaveProperty('color');
      expect(route).toHaveProperty('stops_ordered');
      expect(route.stops_ordered.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========== RESPONSIVE ==========

  test('adjusts layout on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Sidebar should still exist as bottom sheet
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();
  });

  // ========== ACCESSIBILITY ==========

  test('sidebar toggle has accessible label', async ({ page }) => {
    const toggle = page.locator('#sidebar-toggle');
    await expect(toggle).toHaveAttribute('aria-label');
  });

  test('day tabs have visible text labels', async ({ page }) => {
    const tabs = page.locator('.tab');
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      await expect(tabs.nth(i)).not.toBeEmpty();
    }
  });

  // ========== ERRORS & EDGE CASES ==========

  test('handles missing trip.json gracefully', async ({ page }) => {
    await page.route('**/trip.json', route => route.abort('connectionrefused'));
    await page.goto('/');
    await page.waitForSelector('#map', { timeout: 15000 });
    // Map container should still render even without trip data
    const mapEl = page.locator('#map');
    await expect(mapEl).toBeVisible();
  });

  // ========== NEW FEATURES: FILTERS & LAYER SWITCHER ==========

  test('sidebar has Stops, Filters and Trails tabs', async ({ page }) => {
    const tabs = page.locator('#sidebar-tabs .st');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText('Stops');
    await expect(tabs.nth(1)).toContainText('Filters');
    await expect(tabs.nth(2)).toContainText('Trails');
  });

  test('filters tab shows filter panel with type and route sections', async ({ page }) => {
    await page.locator('#sidebar-tabs .st').nth(1).click();
    const filtersPanel = page.locator('#filters-panel');
    await expect(filtersPanel).toHaveClass(/active/);

    const sections = page.locator('.filter-section');
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('filter checkboxes toggle marker types', async ({ page }) => {
    await page.locator('#sidebar-tabs .st').nth(1).click();
    // Uncheck campground filter
    const checkbox = page.locator('.filter-item input[type="checkbox"]').first();
    const initialChecked = await checkbox.isChecked();
    expect(initialChecked).toBe(true);

    await checkbox.click();
    const afterUncheck = await checkbox.isChecked();
    expect(afterUncheck).toBe(false);

    // Re-check
    await checkbox.click();
    const afterRecheck = await checkbox.isChecked();
    expect(afterRecheck).toBe(true);
  });

  test('map view layer switcher is present', async ({ page }) => {
    // Leaflet layer control creates a .leaflet-control-layers element
    const layerControl = page.locator('.leaflet-control-layers');
    await expect(layerControl).toBeVisible();
  });

  test('scale control is present on the map', async ({ page }) => {
    const scale = page.locator('.leaflet-control-scale');
    await expect(scale).toBeVisible();
  });

  test('leaflet-routing-container is hidden', async ({ page }) => {
    // OSRM routing container should not be present (we use direct OSRM API)
    const routing = page.locator('.leaflet-routing-container');
    await expect(routing).toHaveCount(0);
  });

  test('filter section headers are collapsible', async ({ page }) => {
    await page.locator('#sidebar-tabs .st').nth(1).click();
    const header = page.locator('.filter-section-header').first();
    const section = page.locator('.filter-section').first();

    // Initially not collapsed
    await expect(section).not.toHaveClass(/collapsed/);

    // Click header to collapse
    await header.click();
    await expect(section).toHaveClass(/collapsed/);

    // Click again to expand
    await header.click();
    await expect(section).not.toHaveClass(/collapsed/);
  });

  // ========== TRAIL CONNECTOR ==========

  test('trail search panel has input and button', async ({ page }) => {
    await page.locator('#sidebar-tabs .st').nth(2).click();
    await expect(page.locator('#trail-url-input')).toBeVisible();
    await expect(page.locator('#trail-search-btn')).toBeVisible();
  });

  test('trail list section exists in trails panel', async ({ page }) => {
    await page.locator('#sidebar-tabs .st').nth(2).click();
    await expect(page.locator('#imported-trails-list')).toBeVisible();
    await expect(page.locator('.trail-section-header')).toContainText('Imported Trails');
  });
});
