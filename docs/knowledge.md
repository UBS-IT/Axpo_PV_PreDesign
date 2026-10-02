# PV Predesign — knowledge base (as of 2026-10-02)

What the app is, how it is built, what depends on what, and where to look. Written from the code on `main`
(commit `d2a0862`, "3D: fix the black screen"), not from memory. Companion of `README.md` (what it does, for users),
`docs/plan.md` (what comes next) and `docs/decisions.md` (why).

## 1. Purpose and users

Prospection teams of the group (IT, PL, FR, ES, DE, CH) screen a site and get a first layout, capacity and set of
exports **without loading Engineering**. Guiding principle (user, 2026-09-25): *more accurate than usual but fast and
intuitive* — toolkit values are defaults and suggestions, never locks; advanced options stay out of the basic path.
Everything electrical is deliberately left open (user survey, ~6 months).

## 2. Stack

- No build. Native ES modules under `app/js/`, one HTML page (`app/index.html`), one stylesheet (`app/css/app.css`),
  one dictionary of UI strings (`app/js/i18n.js`, English only). Served by any static server over http(s)
  (`scripts/serve.py`, port 8140).
- ArcGIS Maps SDK for JavaScript **4.34** from js.arcgis.com, loaded with `$arcgis.import()`; every SDK access goes
  through `app/js/sdk.js` (`loadSdk`, `getSdk`, `loadSdk3d` for the SceneView modules). Geometry operators
  (`geometry/operators/*`), never `geometryEngine`.
- Third-party libraries vendored in `app/vendor/` (built by `tools/headless/vendor.mjs` from pinned npm versions,
  checked by CI): JSZip, togeojson, shpjs (raw .shp/.dbf only), geotiff, jsPDF, sql.js (+ `.wasm`). Loaded only by
  `app/js/libs.js`. Excel read/written by own code (`io/xlsx.js`, `io/xlsxwrite.js`), CSV by `io/csv.js`.
- Tests: browser pages in `tests/` (each sets `window.__PVP_TEST__` so they never touch the app's autosave). Headless
  runner `tools/headless` (Playwright + esbuild bundle of `@arcgis/core`); the SceneView page runs with software
  WebGL. GitHub Actions runs everything on every push (`.github/workflows/tests.yml`). 115 tests on 9 pages.

## 3. Shape of the UI

```
#top     project name · New Open Save Save as · Import… · ⚡ Quick predesign · EPSG badge · theme
#rail    0 Terrain · 1 Areas · 2 Fields · 3 Infra · 4 Output · 4b 3D · (Electrical, placeholder)
#side    the panel of the active step (372 px), scrollable; clicking the active step again folds it
#view    MapView (satellite without labels + opacity slider); #view3d SceneView shown in place of it in 4b
#banner  one-line mode indicator over the map while drawing / placing / editing
#toast   messages bottom right (ok / err / plain), 4 at most, 6–12 s
```

Step switching: `ui/rail.js` (`showStep`, `onStep` listeners, last step remembered in `localStorage pvp.step`).
Dialogs: `<dialog class="dlg">` built in JS (coordinate system `ui/crsdialog.js`, quick predesign `quick.js`);
three native `confirm()` remain (new project, remove all of a category, remove terrain).

## 4. Data model (`state.js`)

`store.project` is the only state; the layout is always regenerated from it (parametric). Autosaved to
`localStorage pvp.project.v1` 400 ms after every change; written to `.pvpd` (zip: `project.json` +
`terrain/grid.f32`) by `io/projectfile.js`. `upgrade()` migrates v1 projects.

```
project {
  name, crs { wkid, auto, country }
  features[]            step 1: { id, name, category, geometry (GeoJSON WGS 84), source, sourceCategory, attrs }
  settings { boundarySetback }
  plannedModules[], moduleDefs[]   modules of the library used by the project (travel in the file)
  field { technology, structure 'nVm', moduleId, powerPeriod, tiltDeg, azimuthDeg, pitch, tableGap, moduleGap,
          tracks { enabled, spacing, width, tables }, halfTables, targetMWp, rowOffset, columnOffset }
  specificYield
  terrain { source, cellSize, applySlopeLimit, minPatch, showSlope, grid (description only) }
  infra { fence, fenceGroups[], perimeterRoad (null = not decided), clearance (null = toolkit), stations[], roads[] }
  view3d { lowEdge, trackerCategory, axisHeight, trackerMode, trackerAngle, viewpoints[], ground }
}
```

Categories, types and attributes of `features` follow the shared **site-features model 1.1.0** (`categories.js`):
gross, net, connection, exclusion, linear, obstacle, access, mitigation, agri, reference. `cuts: true` categories
are removed from the buildable area with their own buffer (or half width for strips).

Outside the project: the module library (`localStorage pvp.modules.v1`, `modules.js`), the terrain grid
(`IndexedDB pvp/terrain`, `terrain/store.js`), theme and basemap opacity (`localStorage`).

## 5. Event bus and dependency graph

`change(topic, fn)` mutates the project, autosaves and `emit(topic)`; modules subscribe with `on(topic, fn)`.
Topics: `site, settings, field, modules, project, crs, terrain, infra, layout, yield, name, view3d, views3d`.

```
features (1 · Areas) ──► siteFrame() local TM frame ──► computeArea(frame)
                                                          base = net given | gross − setback
                                                          pre  = base − cuts of the Areas categories (buffers)
                                                          buildable = pre − extraCuts  ◄── terrain cut (slope limit of field.structure)
                                                                                      ◄── infra cuts (fence band, drawn roads, stations)
field (2 · Fields) + module + pitch ──► fillRows(buildable rings) ──► tables ──► KPIs, warnings, roads from corridors
                                                                            └──► emit('layout') ──► infra panel, 3D, exports, report
infra (3) ──► layoutInfra(frame, pre, base): lots, fences (closing of grouped lots), clearance band, perimeter road,
              gates at access points, stations (snap to fence) ──► feeds back into computeArea as extraCuts
output (4): exportModel() projects everything to project.crs.wkid; GeoJSON/KMZ in WGS 84; report from last.result
3D (4b): model3d() = tables/trackers at toolkit heights on the ground (step 0 grid or World Elevation) + infra meshes
```

Hidden couplings worth knowing:
- The **terrain cut depends on step 2** (`terrain.js currentSlopeRule()` reads `field.structure`): 3V fixed 10 %
  N-S/E-W, 2V/AgriPV fixed/tracker 15 % any direction. With the default project it silently uses 3V9.
- The **terrain grid is sampled over gross + net areas** (`gridForSite`): no site, no grid. If the site grows beyond
  the grid, the cut is suspended with a note (`coversSite`).
- Every `field`, `infra`, `terrain` change regenerates the whole layout (`field.js schedule()`, 120 ms debounce).
- The quick predesign (`quick.js runQuick`) writes `field`, may load Esri terrain, sets `infra.perimeterRoad`
  (true, then false if the plant is over the template size), optimises the grid position and jumps to 2 · Fields.
- `crsState` (`areas.js`) = country of the site (`crs.js countryAt`) → toolkit values of that country
  (`catalog.countryValue`), proposed export system, alerts. Values are never borrowed between countries.

## 6. Measures

All measures are in a Transverse Mercator frame centred on the site, scale 1 (`geo/localframe.js`): true metres.
Projections always through the SDK `projectOperator` (datum shifts applied). Web Mercator only for drawing on the map.

## 7. Catalog and toolkit

`app/catalog/toolkit.json` (v0.3): group values at the top (`standards`, `modules` with the power roadmap by
semester, `slopeLimits`, `structures`, `defaults`, `rules`), country values under `countries.<ISO>` (IT and FR
filled; PL ES DE CH empty: the app says a value is missing). Archive with sources and status in `docs/toolkit/`.
`app/catalog/prj.json` holds the WKT of the export systems (generated by `scripts/make_prj.py`),
`countries.json` / `regions.json` the outlines for country and German Land detection.

## 8. Map layers (bottom to top)

`Slopes` (terrain classes + hatch over the limit) · `Areas` (features with their buffers) · `Buildable area` ·
`Tables` · `Infrastructure` (fence, roads, stations, gates, lot numbers) · sketch layers · `3D layout` (meshes, 3D only).
Drawing uses two `SketchViewModel`s (areas, roads) with snapping on; one map mode at a time, `Esc` cancels.

## 9. Where things are

| Need | File |
|---|---|
| Steps and panels markup | `app/index.html` |
| All UI text | `app/js/i18n.js` |
| Step 1 areas, import, drawing, buildable area, CRS of the site | `app/js/areas.js`, `categories.js`, `io/importers.js`, `crs.js`, `ui/crsdialog.js` |
| Step 0 terrain | `app/js/terrain/terrain.js` (UI + analysis), `slope.js` (pure), `dtm.js` (GeoTIFF), `store.js` |
| Step 2 fields, engine | `app/js/field.js`, `layout/rows.js` (pure engine), `layout/structures.js`, `modules.js` |
| Quick predesign | `app/js/quick.js` |
| Step 3 infrastructure | `app/js/infra.js` |
| Step 4 outputs | `app/js/output.js`, `report.js`, `export/{model,shp,gpkg,dxf,boq}.js` |
| Step 4b 3D | `app/js/view3d/{sun,geometry,model,scene,glb}.js` |
| Project files, state | `app/js/io/projectfile.js`, `state.js` |
| Tests | `tests/*.test.js`, runner `tools/headless/run.mjs`, screenshots of the 3D scene `snap3d.mjs` |

## 10. Known gaps (from the plan and the audit)

Pilot against a real engineering layout (A4) not done; piles per structure and Engineering's DXF layer names
unknown; contour lines, DWG import, portal import, several fields per site, table-by-table edits not done; the
UX audit of 2026-10-02 is in `docs/audit/2026-10-02-frontend-audit.md`.
