# Eastern Sierra Trip Map — May 2026

Interactive web map for a 2-day camping trip in the Eastern Sierra: Mammoth / Rock Creek / Big Pine Canyon.

Built with **Leaflet.js + OpenStreetMap tiles + OSRM routing** — zero API keys required.

## Features

- 🗺️ Dark-themed interactive map with all trip waypoints
- 🏕️ 4 marker types: campground, trailhead, geo stop, hot spring
- 🚗 Driving routes with OSRM (open-source routing engine)
- 📋 Sidebar stop list with click-to-select
- ℹ️ Info panel with notes, warnings, and link
- 📅 Day filter tabs (All / Day 1 / Day 2)
- 📖 Floating legend
- 📱 Responsive — sidebar becomes bottom sheet on mobile

## Quick Start

```bash
# Serve locally
npx serve . -p 8080

# Or open index.html directly
open index.html
```

No build step. No API keys. Open index.html and go.

## Project Structure

```
├── index.html           # Main page shell
├── styles.css           # All layout and styling
├── app.js               # Map logic, markers, routing, UI
├── trip.json            # Waypoint and route data (source of truth)
├── icons/               # SVG marker icons
│   ├── campground.svg
│   ├── trailhead.svg
│   ├── geo_stop.svg
│   └── hot_spring.svg
├── tests/
│   └── e2e.spec.js      # Playwright end-to-end tests
├── package.json
└── playwright.config.js
```

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Map | Leaflet.js 1.9 | Lightweight, open-source, no API key |
| Tiles | CARTO Dark (OpenStreetMap data) | Free, matches the dark theme |
| Routing | OSRM public API | Open-source, free, driving routes from OSM data |
| Testing | Playwright | E2E across Chromium/Firefox/WebKit |
| Hosting | Vercel / GitHub Pages | Free static hosting |

## Waypoints

| ID | Name | Type | Day |
|----|------|------|-----|
| convict_lake | Convict Lake Campground | Campground | Base |
| brees_lookout | Brees Lookout | Geo Stop | 1 |
| hot_creek | Hot Creek Geologic Site | Geo Stop | 1 |
| rock_tub | The Rock Tub Hot Springs | Hot Spring | 1 |
| crowley_stone_columns | Lake Crowley Stone Columns | Geo Stop | 1 |
| mosquito_flat | Mosquito Flat Trailhead | Trailhead | 1 |
| big_pine_trailhead | Big Pine Creek North Fork Trailhead | Trailhead | 2 |

All data lives in `trip.json`. Edit it to add/change waypoints.

## Testing

```bash
# Install deps
npm install

# Run E2E tests
npm test

# Run with browser visible
npm run test:headed
```

Tests verify: layout, markers, info panel, day filter, trip data schema, responsive layout, accessibility, and error handling.

## Deployment

### Vercel
```bash
npx vercel --prod
```
Zero config — static site, just deploy the root directory.

### GitHub Pages
Push to `main`, enable GitHub Pages in repo settings, source from root.

## Trip Notes

- Base camp: Convict Lake Campground (nights of May 8-9)
- Day 1: Geology crawl → Little Lakes Valley hike
- Day 2: Big Pine Lakes hike → return
- Check Inyo NF alerts before departure
