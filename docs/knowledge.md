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
#rail    stepper 1 Site · 2 Terrain · 3 Layout · 4 Infra · 5 Outputs, each with a state from its panel
         (locked / ready / optional / done + figure; a locked step opens with a gate and a link)
#side    the panel of the active step (372 px), scrollable; clicking the active step again folds it
#view    MapView (satellite without labels + opacity slider); #view3d SceneView in place of it behind the 2D / 3D
         switch on the map (.mapchips); the 3D controls float in a card (#d3Card) over the scene
#banner  one-line mode indicator over the map while drawing / placing / editing
#toast   messages bottom right (ok / err / plain), 4 at most, 6–12 s
```

Step switching: `ui/rail.js` (`showStep`, `onStep` listeners, `stepProvider(step, fn)` registered by each panel,
`startStep()` = last step visited unless locked, else the first still to do; `localStorage pvp.step`).
Dialogs: `<dialog class="dlg">` built in JS (coordinate system `ui/crsdialog.js`, quick predesign `quick.js`,
confirmations `ui/dialog.js confirmDialog`); no native `confirm()`. Removals in 1 · Site show a toast with *Undo*
(`ui/toast.js` `opts.action`); `areas.js` keeps an undo / redo history of the objects (40 steps, Ctrl+Z / Ctrl+Y).
Drawing in 1 · Site: ① category chips (`#drawCats`, `role=radiogroup`) with the defaults of the next drawings,
② tool cards (`#drawTools`, Point / Line / Area / Rectangle, `aria-pressed`, disabled with the reason), status line
(`#drawStatus`, `role=status`), *Last drawing* box (`#drawLast`); the armed tool stays armed until Esc.

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
features (1 · Site) ──► siteFrame() local TM frame ──► computeArea(frame)
                                                          base = net given | gross − setback
                                                          pre  = base − cuts of the Areas categories (buffers)
                                                          buildable = pre − extraCuts  ◄── terrain cut (slope limit of field.structure)
                                                                                      ◄── infra cuts (fence band, drawn roads, stations)
field (3 · Layout) + module + pitch ──► fillRows(buildable rings) ──► tables ──► KPIs, warnings, roads from corridors
                                                                            └──► emit('layout') ──► infra panel, 3D, exports, report
infra (4) ──► layoutInfra(frame, pre, base): lots, fences (closing of grouped lots), clearance band, perimeter road,
              gates at access points, stations (snap to fence) ──► feeds back into computeArea as extraCuts
output (5): exportModel() projects everything to project.crs.wkid; GeoJSON/KMZ in WGS 84; report from last.result
3D (map switch): model3d() = tables/trackers at toolkit heights on the ground (2 · Terrain grid or World Elevation) + infra meshes
```

Hidden couplings worth knowing:
- The **terrain cut depends on 3 · Layout** unless a limit was chosen by hand: `terrain.js effectiveLimit()` =
  `project.terrain.limit` (`{ maxAny }` or `{ maxNS, maxEW }`, `limitFrom` custom / geoportale) when set, else the
  toolkit rule of `field.structure` (`currentSlopeRule()`: 3V fixed 10 % N-S/E-W, 2V/AgriPV fixed/tracker 15 % any
  direction); `same` says whether they agree, `overLimit().own` marks a cut by an own limit (warnings, rail, report).
  The Terrain panel shows and can change the technology (`applyStandard`, the same as the Layout select).
  `terrainStale()` flags a grid that no longer matches the site or the cell size.
- A **Geoportale project with slopes from its DTM** (`readAxpo`: `sf_slope` on the exclusion → `feature.slope`,
  `terrain[]` records + `terreno/<id>.f32` → `result.terrain`, `sf_auto` drawings left out, `netSetback`) goes
  through `areas.importHooks`: `terrain.js adoptGeoportaleTerrain` adopts the grid of the imported exclusion (else
  the one of an imported gross area, else the first) when it covers any part of the site (`siteCoverage`), replacing
  an Esri grid and keeping a GeoTIFF of the designer (`useGrid`, cell and patch aligned, the limit as
  `limitFrom: 'geoportale'`, the site box at adoption in `meta.site`), and removes the imported slope exclusion with
  Undo (`replaceImportedSlopeExclusions`, also after any terrain load), so the slope is cut once. The cut applies
  where the grid is; a partial coverage is a note. The Geoportale computes slopes with a port of this module; the
  terrain image (`terrainCanvas`, a `MediaLayer`) and the figures inside the site (`siteStats`) are its drawing
  ported back. Audit: `docs/audit/2026-10-08-geoportale-alignment.md`.
- The **terrain grid is sampled over gross + net areas** (`gridForSite`): no site, no grid. If the site grows beyond
  the grid, the cut is suspended with a note (`coversSite`).
- Every `field`, `infra`, `terrain` change regenerates the whole layout (`field.js schedule()`, 120 ms debounce).
- The quick predesign (`quick.js runQuick`) writes `field`, may load Esri terrain, sets `infra.perimeterRoad`
  (only when the designer has not decided: `null`), optimises the grid position and jumps to 3 · Layout.
- `crsState` (`areas.js`) = country of the site (`crs.js countryAt`) → toolkit values of that country
  (`catalog.countryValue`), proposed export system, alerts. Values are never borrowed between countries.

## 6. Measures

All measures are in a Transverse Mercator frame centred on the site, scale 1 (`geo/localframe.js`): true metres.
Projections always through the SDK `projectOperator` (datum shifts applied). Web Mercator only for drawing on the map.

## 7. Catalog and toolkit

`app/catalog/toolkit.json` (v0.3): group values at the top (`standards`, `modules` with the power roadmap by
semester, `slopeLimits`, `structures`, `defaults`, `rules`), country values under `countries.<ISO>` (IT and FR
filled; PL ES DE CH empty: the app says a value is missing). Archive with sources and status in `docs/toolkit/`.
The JSON is generated from the workbook `docs/toolkit/toolkit.xlsx` by `scripts/make_toolkit.py` (Values sheet =
one row per value with unit, source, status, note; record sheets for structures, buildings, rules, modules and
their powers); `--check` in the CI keeps both in step. `countryValue()` wraps plain values, so `4` and
`{ value: 4 }` are the same to the app.
`app/catalog/prj.json` holds the WKT of the export systems (generated by `scripts/make_prj.py`),
`countries.json` / `regions.json` the outlines for country and German Land detection.

## 8. Map layers (bottom to top)

`Terrain image` (hill-shaded elevations or slope classes, hatch over the limit; a MediaLayer) · `Slopes` (outline of
the cut) · `Areas` (features with their buffers) · `Buildable area` ·
`Tables` · `Infrastructure` (fence, roads, stations, gates, lot numbers) · sketch layers · `3D layout` (meshes, 3D only).
Drawing uses two `SketchViewModel`s (areas, roads) with snapping on; one map mode at a time, `Esc` cancels.

## 9. Where things are

| Need | File |
|---|---|
| Steps and panels markup | `app/index.html` |
| All UI text | `app/js/i18n.js` |
| Stepper, step states, gates | `app/js/ui/rail.js` (`stepProvider`, `stepState`, `startStep`, `refreshRail`) |
| Step 1 site, import, drawing, undo / redo, buildable area, CRS of the site | `app/js/areas.js`, `categories.js`, `io/importers.js`, `crs.js`, `ui/crsdialog.js` |
| Step 2 terrain | `app/js/terrain/terrain.js` (UI + analysis), `slope.js` (pure), `dtm.js` (GeoTIFF), `store.js` |
| Step 3 layout, engine | `app/js/field.js`, `layout/rows.js` (pure engine), `layout/structures.js`, `modules.js` |
| Quick predesign | `app/js/quick.js` |
| Step 4 infrastructure | `app/js/infra.js` |
| Step 5 outputs | `app/js/output.js`, `report.js`, `export/{model,shp,gpkg,dxf,boq}.js` |
| 2D / 3D switch, scene | `app/js/view3d/{sun,geometry,model,scene,glb}.js` (`set3d`) |
| Confirmations, toasts with Undo | `app/js/ui/dialog.js`, `ui/toast.js` |
| Project files, state | `app/js/io/projectfile.js`, `state.js` |
| Tests | `tests/*.test.js`, runner `tools/headless/run.mjs`, screenshots of the 3D scene `snap3d.mjs` |

## 10. The Geoportale, the reference for UI patterns

`UBS-IT/custom-AGOL-web-map` (`geoportale_axpo.html`, one file, ~7 600 lines, SDK 4.34 AMD; its `README.md` §4
documents every pattern and §7 every audit). Shared with this app: the site-features model (categories, types,
attributes, colours), the `.axpo` project import, the palette tokens. Its *Disegna* tab (two steps: category chips,
then tool cards, armed tool, undo/redo, status line, *Ultimo disegno*), its three-step geoprocessing (`.gpstep`,
cards disabled with the reason), its `i` windows, its contrast rules (`--accent-strong` for filled buttons, `--link`
for accent texts) and its mode banner are the patterns to port here (audit §3 and §6). It has no tests and no CI:
verification is manual against the live portal. Not shared: parcel search (Zornade), AGOL write-back, DWG reader.

## 11. Known gaps (from the plan and the audit)

Pilot against a real engineering layout (A4) not done; piles per structure and Engineering's DXF layer names
unknown; contour lines, DWG import, portal import, several fields per site, table-by-table edits not done; the
UX audit of 2026-10-02 is in `docs/audit/2026-10-02-frontend-audit.md` (its §9 says what the refactor of the same
day fixed and what stays open: `i` help windows, inline errors at the controls, keyboard drawing).
