# Architecture — the map of PV Predesign for people who do not read the code

This page says what the app is made of, which file does what, how the data travel from the drawing of the site to
the files for Engineering, which files are generated and from what, where the app is fragile, and how every part is
tested. It is written for a product owner or a reviewer: no code, only names of files so that a conversation about a
change can point at the right place. Dates and decisions are in `docs/decisions.md`; the feature list is in
`README.md`; the open work is in `docs/plan.md`.

## 1. The app in one picture

PV Predesign is a web page and about fifty JavaScript files, served as they are: there is no build step, no server
logic, no database. Everything runs in the browser of the designer. The only things fetched from outside the app are
the ArcGIS Maps SDK (from `js.arcgis.com`), the background map and Esri World Elevation.

```
                       the browser of the designer
 ┌────────────────────────────────────────────────────────────────────────────┐
 │  app/index.html  (top bar, tabs, ribbon, two panels, map, status bar)      │
 │  app/js/main.js  (starts everything, in this order)                        │
 │     │                                                                      │
 │     ├─ sdk.js ──────── ArcGIS Maps SDK 4.34  ◄──── js.arcgis.com (CDN)     │
 │     ├─ catalog.js ──── app/catalog/toolkit.json  (the toolkit values)      │
 │     ├─ crs.js ──────── app/catalog/countries.json, regions.json            │
 │     ├─ i18n.js ─────── every text of the interface                         │
 │     └─ state.js ────── store.project  (the project: inputs only)           │
 │                              │  autosave in localStorage                   │
 │                              ▼                                             │
 │   ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────┐  │
 │   │ 1 · Site  │─►│ 2 Terrain │─►│ 3 Layout  │─►│ 4 Infra   │─►│5 Outputs│  │
 │   │ areas.js  │  │ terrain/  │  │ field.js  │  │ infra.js  │  │output.js│  │
 │   └───────────┘  └───────────┘  └───────────┘  └───────────┘  └─────────┘  │
 │         ▲              │              │              │             │       │
 │     io/importers.js    │     layout/rows.js          │        export/*     │
 │     (.axpo, KML,       │     (the row-fill           │        report.js    │
 │      Shapefile, CSV…)  │      engine)                │        (PDF)        │
 │                        └──────────────┬──────────────┘                     │
 │                                       ▼                                    │
 │                        2D / 3D switch: view3d/scene.js (SceneView, glTF)   │
 │                                                                            │
 │   ui/tabs.js · ui/ribbon.js · ui/layers.js · ui/statusbar.js (the shell)  │
 │   ui/toast.js   ui/dialog.js   ui/basemap.js   ui/maptools.js   ui/icons.js │
 │   io/projectfile.js: Save / Open  ◄──► .pvpd (zip: project.json + grid)    │
 │   app/vendor/: JSZip, togeojson, shpjs, geotiff, jsPDF, sql.js (local)     │
 └────────────────────────────────────────────────────────────────────────────┘
```

Three ideas explain most of the design:

- **The project holds inputs, never results.** `store.project` (in `app/js/state.js`) keeps the drawings, the
  parameters and the choices of the designer. Tables, buildable area, fences and figures are recomputed every time
  something changes. This is why a project file is small and why a change in the engine changes every old project
  the next time it is opened.
- **Everything is measured in true metres.** Areas and the layout are computed in a local Transverse Mercator frame
  centred on the site (`app/js/geo/localframe.js`), never in the Web Mercator of the map. The national coordinate
  system only matters for the exports.
- **The toolkit is data, not code.** Structures, roads, buildings, clearances and slope limits come from
  `app/catalog/toolkit.json`, which is generated from a workbook that people edit in Excel. A value missing for a
  country is reported as missing, never borrowed from another country.

## 2. The steps (the tabs) and the files behind them

Since the ribbon refactor (phases 1A to 6, 2026-10-10 and 11) the shell is a top bar, four tabs (`app/js/ui/tabs.js`:
Site area, Terrain Analysis, Layout & Infrastructure, Report & exports), the ribbon of the active tab
(`ui/ribbon.js`: the actions of the panels, whose tools keep the ids of the buttons they replace; the drawing menu
of 1 · Site is `ui/catmenu.js`; a tool of tabs 1–3 reopens a collapsed Properties panel), the map between two docked panels that
collapse to a strip, Layers on the left (`ui/layers.js`: one group per tab, a visibility switch and a figure per layer, the
objects by category in the first group, the Dimensions row at the end; the switches are `ui/visibility.js`)
and Properties on the right (the sections of the steps of the active tab), and a status bar (`ui/statusbar.js`:
the pointer coordinates in the export system, the CRS select, the scale, the elevation and slope under the pointer
from the terrain grid (`terrainAt()` of `terrain/terrain.js`), the mode the modules announce with a `pvp:mode`
event, the snapping switch, the autosave time; the 3D view announces itself with `pvp:view3d`); the map controls column (`ui/maptools.js`: Fit the
site, Measure, Dimensions) sits under the zoom and the north arrow, the basemap toggle and the opacity slider
bottom right, the messages (`ui/toast.js`) bottom left, each with a ×; in 3D the card of `view3d/scene.js` takes the
top left corner with the Daylight widget inside it and the controls of the scene to its right (`scene.ui.padding`); the kit of the design system (`css/kit.css`, phase 1C) draws the pieces and `css/shell.css` lays them
out. The steps below are unchanged: a tab holds one or two of
them (the third tab holds fields and infra). Each panel tells the tabs how its step stands: locked (a
prerequisite is missing), ready, optional or done with its key figure. The panels are independent files; they talk
to each other only through the project and a small publish/subscribe (`change(topic)` / `on(topic)` in `state.js`).

| Step | What the designer does | Main file | Helpers | Reads | Writes into the project |
|---|---|---|---|---|---|
| **1 · Site** | Imports or draws the site and its constraints, sorted into categories; sets the boundary setback; draws from the ribbon (Category and Type menus, six geometries in two rows, Freehand among them; *Unclassified* by default, counted nowhere until classified), selects on the map, in a box or from the Layers rows and edits from the ribbon (Reshape, Move / rotate, Split, Merge, Copy, Delete; the Category, Type and Buffer act on the selection); the objects by category are in the Layers panel on the left, which only lists and zooms | `app/js/areas.js` | `categories.js` (the categories and the automatic sorting, shared "site-features" model), `io/importers.js` (file readers), `crs.js` + `ui/crsdialog.js` (which coordinate system a file is in), `geo/convert.js`, `ui/layers.js` (the Layers panel: strip with counters, open / collapse, "see in the Layers panel"), `ui/catmenu.js` (the category menu of the ribbon) | the drawings, the toolkit (nothing else) | `features[]`, `settings.boundarySetback`, `crs` |
| **2 · Terrain** (optional) | Samples the elevations on a grid, chooses the slope limit, sees the areas too steep | `app/js/terrain/terrain.js` | `terrain/slope.js` (slopes and masks, pure maths), `terrain/dtm.js` (GeoTIFF reading), `terrain/store.js` (the grid in memory, in IndexedDB and in the file) | the site, the structure of step 3 (for the toolkit rule), Esri World Elevation or a GeoTIFF | `terrain` (description of the grid, limit, view); the grid itself goes to IndexedDB |
| **3 · Layout** | Chooses technology, structure, module, tilt, azimuth, pitch; reads the results | `app/js/field.js` | `layout/structures.js` (the nVm notation and the size of a table), `layout/rows.js` (the row-fill engine), `modules.js` (the module library and the roadmaps), `catalog.js` | the buildable area of step 1, the cuts of steps 2 and 4, the module | `field`, `plannedModules`, `moduleDefs`, `specificYield` |
| **4 · Infrastructure** | Fences, perimeter road, gates, internal roads, stations | `app/js/infra.js` | `catalog.js` (the country values) | the usable land of step 1, the rows of step 3, the country of the site | `infra` (fence groups, perimeter road, clearance, stations, roads) |
| **5 · Outputs** | Picks the export coordinate system, exports | `app/js/output.js` | `export/model.js` (what goes to Engineering), `export/shp.js`, `export/gpkg.js`, `export/dxf.js`, `export/boq.js`, `report.js` (the PDF), `io/xlsxwrite.js` | everything above | `crs` (when chosen by hand) |
| **Quick predesign** (ribbon of Layout & Infrastructure) | One dialog, one click: group standards and the best grid position | `app/js/quick.js` | calls steps 2, 3 and 4 | the site | `field`, `terrain`, `infra` |
| **2D / 3D** (map switch) | Looks at the plant in 3D with sun and shadows, saves views, exports glTF | `app/js/view3d/scene.js` | `view3d/model.js` (what to draw), `view3d/geometry.js` (heights and vertices), `view3d/sun.js` (sun position, trackers), `view3d/glb.js` (the glTF writer) | the layout, the infrastructure, the terrain, the toolkit heights | `view3d` (heights, tracker mode, saved viewpoints) |

Shared by every step:

| File | Role |
|---|---|
| `app/js/main.js` | Starts the app: texts, theme, tabs and ribbon, SDK and catalog in parallel, the map, then every panel; wires New / Open / Save / Import, keyboard shortcuts and files dropped on the map |
| `app/js/state.js` | The project (`store.project`), its default shape, the upgrade of old projects (`upgrade()`), autosave in the browser, the publish/subscribe |
| `app/js/sdk.js` | The only door to the ArcGIS Maps SDK (`$arcgis.import()`). A new SDK module is declared here and nowhere else |
| `app/js/libs.js` | The only door to the vendored libraries (`app/vendor/`) |
| `app/js/i18n.js` | Every visible text (about 580 uses of `t('…')` across the app). English only for now |
| `app/js/catalog.js` | Reads `toolkit.json` once and answers "what does the toolkit say for this country and this key" |
| `app/js/io/projectfile.js` | Save / Open of the `.pvpd` project file (a zip with `project.json` and, when there is a terrain, `terrain/grid.f32`) |
| `app/js/edit.js` | The edits of 1 · Site (phase 2B): split an object with a line, merge areas, copy objects, the size of one object, all in the local metric frame; `areas.js` applies them through its undo history |
| `app/js/dims.js` | Dimensions on the map: measured lines kept in `project.dims`, lengths in true metres from the local frame, ticks and labels, show / hide / remove; the export model and the PDF report ask it for the parts of every dimension |
| `app/js/ui/` | The tabs and the ribbon (`tabs.js`, `ribbon.js`; the category menu of the drawing tools, `catmenu.js`), the Layers panel (`layers.js`: the groups of the tabs with a visibility switch and a figure per layer, reachable from every tab; the cards of the categories inside it are drawn by `areas.js`), the visibility of the layers (`visibility.js`: one switch per layer, remembered in this browser, never in the project; the modules that draw a layer ask it and listen to it), the map controls column and the drawing-support preferences (`maptools.js`: Fit the site, the measure card with the Esri widgets, the Dimensions button; the preferences that `areas.js` and `dims.js` apply to their sketch), the status bar (`statusbar.js`), the searches (`search.js`: the objects of the project, Ctrl K; `geosearch.js`: an address through Nominatim or coordinates read in the browser, a pin on the map), the *Zoom to* menu of a right click in the Layers panel (`layermenu.js`), the icons of the design system (`icons.js`), the toasts (with Undo), the app's own confirmation dialog, the background map and its opacity, the coordinate-system dialog |

## 3. How the data travel, from the drawing to the export

1. **A file arrives or a shape is drawn.** `io/importers.js` turns a `.axpo`, GeoJSON, KML, KMZ, zipped Shapefile or
   CSV into raw objects. If the file has projected coordinates but no declared system, `crs.js` proposes the national
   systems that fit and `ui/crsdialog.js` asks. `categories.js` decides the category: objects from the Geoportale
   carry their codes and are never guessed; anything else is sorted by its folder, layer and object names.
   `areas.js` adds the objects to `project.features` and publishes the topic `site`. Import hooks run here too: the
   terrain step registers one that adopts the DTM grid of a Geoportale project.
2. **The buildable area is computed.** `areas.js` builds the local metric frame of the site (`siteFrame()`), then
   `computeArea()`: gross area, minus the boundary setback (or the net area as given), minus every exclusion, line,
   obstacle, mitigation and agricultural zone with its own buffer, minus the *extra cuts* that other steps register
   (the slope cut of step 2, the fence band, stations and roads of step 4). The result is kept in `areasState`.
3. **The terrain cuts what is too steep** (optional). `terrain/terrain.js` samples a grid over the site plus a
   margin; `terrain/slope.js` computes the slopes; the limit in use (toolkit rule of the structure, or chosen by
   hand, or brought by the Geoportale) gives a mask; the cells over the limit become an extra cut of step 2. The
   same grid answers the status bar: the elevation (bilinear) and the slope of the cell under the pointer.
4. **The layout is generated.** Every change of `site`, `settings`, `field`, `modules`, `terrain`, `infra`, `crs` or
   `project` makes `field.js` regenerate: it takes the buildable area, the structure (`layout/structures.js` gives the
   size of a table from the module), the pitch and azimuth, and calls the pure engine `layout/rows.js`, which fills
   the area with rows of tables on a common column grid. The result (tables, MWp, warnings) stays in memory in
   `field.last.result`: it is never written into the project.
5. **The infrastructure follows the layout.** `infra.js` splits the usable land into lots, draws a fence around each
   (or around the lots the designer joined), the perimeter road if wanted, the corridors of step 3 as roads, the gates
   at the accesses and the stations. Fence band, stations and roads go back to step 2 as extra cuts, so the layout is
   regenerated once more without them.
6. **The exports read everything.** `export/model.js` gathers every object of the project and of the layout, measures
   lengths and areas in the local frame, then projects them into the national system chosen in step 5. From that one
   model: Shapefile (`export/shp.js`, with the `.prj` text taken from `app/catalog/prj.json`), GeoPackage
   (`export/gpkg.js`, SQLite written in the browser), DXF (`export/dxf.js`), bill of quantities (`export/boq.js`).
   KMZ and GeoJSON are written by `output.js` itself; the PDF by `report.js`.
7. **The project is saved.** `io/projectfile.js` zips `project.json` (the project plus the modules it uses and the
   date) and the terrain grid. Autosave keeps a copy of the project in the browser after every change (0.4 s delay);
   the grid is too large for that and lives in IndexedDB.

The 3D view reads the same things as the exports (layout, infrastructure, terrain) and draws them as meshes on a
SceneView; editing never happens in 3D.

## 4. Generated files: what is generated from what

Some files in the repository are **outputs** of a script or a tool. They must never be edited by hand: the next
regeneration would overwrite the edit, and in two cases the CI fails when the generated file and its source disagree.

| Generated file | Source | Generator | Checked by the CI | When to regenerate |
|---|---|---|---|---|
| `app/catalog/toolkit.json` (the values the app reads) | `docs/toolkit/toolkit.xlsx` (the workbook people edit) | `python scripts/make_toolkit.py` (needs openpyxl; the ArcGIS Pro Python has it) | **yes** (`--check`: the push fails when the two differ) | after every edit of the workbook; commit both files together. If a session edited the JSON directly, `--export` rebuilds the workbook from it |
| `app/catalog/prj.json` (the `.prj` and WKT texts of the export systems) | the EPSG database (through pyproj) | `scripts/make_prj.py` | no | only when a coordinate system is added to the list of `crs.js` |
| `app/css/tokens.css` (every colour, spacing, radius, shadow and font the app uses, light and dark) | `design/tokens.json`, a copy of the design system's tokens (`APP UI-UX DESIGN/design-system/project/tokens.json`, owned by the UI design session) | `python scripts/make_tokens.py` | **yes** (`--check`) | when the design system changes a token: copy `tokens.json`, regenerate, commit both. `app.css` defines no colour of its own |
| `app/icons.svg` (the sprite of the 84 line icons) | `design/icons/*.svg`, a copy of the design system's icons | `python scripts/make_icons.py` | **yes** (`--check`) | when an icon is added or changed in the design system. Buttons declare `data-icon="<name>"`, labels built in JavaScript call `icon(name)` (`ui/icons.js`) |
| `app/css/kit.css` (the classes of the design system's kit: top bar, tabs, ribbon, panels, fields, buttons, KPIs and ledgers, notices, toasts, dialogs, map controls, status bar) | `APP UI-UX DESIGN/design-system/project/components/bundle.css`, owned by the UI design session | none: a byte-for-byte copy (phase 1C, 2026-10-10) | no (the design system is outside the repository: compare the two files by hand) | when the kit changes in the design system. `app.css` holds only what the kit lacks and the few overrides where a kit class and an app class share a name (each commented); `shell.css` the layout of the docked workspace |
| `app/vendor/*.js`, `sql-wasm.wasm`, `versions.json`, `licenses/` | the npm versions pinned in `tools/headless/package-lock.json` | `npm run vendor` in `tools/headless` (`vendor.mjs`) | **yes** (rebuilt and compared byte by byte) | only when a library version changes in `tools/headless/package.json` |
| `tests/fixtures/*.kmz, .kml, .zip, .geojson, .csv` and `expected.json` (the reference areas) | invented sites | `scripts/make_fixtures.py` (ArcGIS Pro Python, arcpy) | no (the tests use them) | when a test needs a new synthetic file. Codes, GUIDs, parcels and names are always invented, never taken from the portal |
| `tests/fixtures/it_slope*.axpo` (Geoportale projects with a DTM) | the `.axpo` contract of the Geoportale | `scripts/make_axpo_slope_fixture.py` (plain Python with pyproj) | no | when the Geoportale changes what it writes |
| `tests/fixtures/it_dtm_plane.tif` (synthetic terrain model) | a plane rising 12 % to the north | `tools/headless/make_terrain_fixture.mjs` | no | almost never |
| `tools/headless/dist/` (the ArcGIS SDK bundled for the headless tests, not committed) | `@arcgis/core` from npm | `npm run build` in `tools/headless` | rebuilt at every CI run | after adding an SDK module to `app/js/sdk.js` |
| `app/js/i18n.js` | **not generated**: written by hand | — | no | every new visible text goes there; the code only calls `t('key')` |

What is **not** in the repository on purpose: the toolkit documents themselves (internal, large binaries; `docs/toolkit/sources.md`
says where they are), real project files, real DTMs, real KML/Shapefiles. The `.gitignore` excludes them.

## 5. If you touch X, Y breaks

The fragile points, in the order a change is most likely to hit them.

| If you touch… | …this breaks or changes | Why | What protects you |
|---|---|---|---|
| `docs/toolkit/toolkit.xlsx` without running `make_toolkit.py` | the CI goes red; the app keeps the old values | the app reads only the JSON | the `--check` step of `.github/workflows/tests.yml` |
| `app/catalog/toolkit.json` directly | the next regeneration from the workbook erases the edit | the workbook is the source | run `make_toolkit.py --export` right after, or edit the workbook instead |
| a key name in `toolkit.json` (e.g. `roads.heavy.width`) | the panel that reads it shows "the toolkit has no rule", silently for the other countries | the code asks for keys by their dotted path (`catalog.js`, `infra.js`, `terrain.js`, `view3d/geometry.js`) | `tests/modules.html`, `tests/infra.html`, `tests/terrain.html` check the main keys; a renamed key still needs a search in `app/js` |
| the shape of `store.project` in `state.js` | old project files and the autosave of every user open with missing fields | the project is a plain JSON object | add the new field to `defaultProject()` **and** to `upgrade()`; `tests/import.html` has the v1 → v2 migration and a project round trip |
| `app/js/categories.js` (categories, types, attributes) | the import of `.axpo` files and the AGOL layer "IT - Site Features" fall out of step with the Geoportale | the three share one "site-features" model (`schemas/site_features_model.json` in the AGOL Axpo workspace) | change the model first, then the three places together; `tests/import.html` checks the mapping on `it_site_features.axpo` |
| `app/js/i18n.js` keys | a missing key shows the key itself on screen | every text is looked up by key | `tests/ui.html` mounts the real panels; read the screen |
| `app/js/sdk.js` (an SDK module added or renamed) | the app page works, the headless tests fail: the npm bundle does not know the new module | `tools/headless/build.mjs` bundles only the modules listed there | run `npm run build` in `tools/headless` after the change |
| `app/js/layout/rows.js` or `layout/structures.js` | tables, MWp and the bill of quantities of **every** project change the next time they are opened | results are never stored; the engine is recomputed | `tests/index.html` (the engine against a brute-force oracle on 200 random polygons) and `tests/ui.html` |
| `app/js/geo/localframe.js` | every area, length, pitch and export is measured wrongly | it is the ruler of the whole app | `tests/sdk.html` (5 000.000 m² for a 100 × 50 m rectangle) and the reference areas of `expected.json` |
| `areas.js` `computeArea()` or the `extraCuts` list | the layout, the fences and the figures of the tabs change together | every step cuts through the same function | `tests/import.html` (net area), `tests/terrain.html` (slope cut), `tests/infra.html` (fence band, stations) |
| the order of `main.js` (what starts before what) | a panel reads the catalog or the map before they exist: blank panel, errors in the console | SDK, catalog and countries load in parallel, then the panels in order | `tests/ui.html` starts the panels the same way; the app page is checked by hand |
| `app/js/libs.js` or `app/vendor/` | imports or exports stop on company networks | the libraries are served by the app so that blocked CDNs do not matter | the vendor step of the CI; `tests/modules.html` loads every vendored library |
| the `.axpo` contract (what the Geoportale writes) | the Geoportale import silently drops the terrain, doubles the strips or freezes the net area | the reader rebuilds the contract from the writer's code (`docs/audit/2026-10-08-geoportale-alignment.md`) | the three `it_slope*.axpo` fixtures and `tests/terrain.html`; a real `.axpo` is still to be tried |
| `tools/headless/run.mjs` or the CI workflow | a green CI that proves less than it seems | today the runner prints browser errors but **does not fail** for them | read the log of the run, not only the badge (P1 in the release gates) |
| a `<dialog>` of the app (`ui/dialog.js`, `ui/crsdialog.js`, `quick.js`) that waits only for its `close` event | the quick predesign, a confirmation or the coordinate-system dialog never finishes in a hidden tab, and `tests/ui.html` fails from the quick test onwards | Chromium does not deliver `close` while the tab is hidden (seen in the browser pane of the desktop app, 2026-10-10) | `whenClosed()` in `ui/dialog.js`: the OK / Cancel handlers finish the dialog themselves, `close` and `toggle` cover Escape |
| `scripts/serve.py` or `.claude/launch.json` | the app opens as `file://` and nothing loads | ES modules and the SDK need an HTTP server | `launch.json` still points at the old folder `Predesign FV`: use `py -3 scripts/serve.py 8140` from the project root |

Things that are **not** fragile, by design: a panel can be rewritten without touching the others (they only share
the project and the topics); the SDK version can change in one file (`sdk.js`) plus the two CDN lines of
`index.html`; a new export reads `export/model.js` and nothing else.

## 6. How every part is tested

All tests run in the browser, one page per area, from `http://localhost:8140/tests/…` after
`py -3 scripts/serve.py 8140`. Every page prints a table with green or red rows and a summary line. The same pages
run without a browser in `tools/headless` (`npm ci && npm run build && npm test`) and on GitHub Actions at every push
and pull request. The test pages set `window.__PVP_TEST__` so that they never overwrite the project autosaved by the
app.

| Page | What it proves | Files under test |
|---|---|---|
| `tests/index.html` | the row-fill engine, half tables, corridors (14 tests; the engine against a brute-force oracle) | `layout/rows.js`, `layout/structures.js` |
| `tests/modules.html` | roadmaps by semester, power periods, the six-month warning, the country catalog, slope limits, trackers, modules carried by projects, Excel and CSV readers and writers, GeoPackage geometry, every vendored library (19) | `modules.js`, `catalog.js`, `io/xlsx.js`, `io/csv.js`, `io/xlsxwrite.js`, `libs.js` |
| `tests/sdk.html` | the SDK loads, the local frame measures true metres (5) | `sdk.js`, `geo/localframe.js` |
| `tests/import.html` | classification, v1 → v2 migration, countries and proposed systems, every national EPSG code, the fixtures against the ArcGIS reference areas, Geoportale projects with the site-features model, net area, grid connection route, project and GeoJSON round trips (25) | `io/importers.js`, `categories.js`, `crs.js`, `areas.js`, `state.js`, `io/projectfile.js` |
| `tests/terrain.html` | slopes, masks and outlines, GeoTIFF sampling, the slope cut, a limit chosen by hand against the toolkit, figures inside the site and the terrain image, the project file, Geoportale projects with their DTM (grid adopted, partial coverage, replaced or kept, automatic drawings left out), the terrain under the pointer (21) | `terrain/*` |
| `tests/infra.html` | fence, perimeter road, clearances, lots and shared fences, stations (snapping, moving, at the access), roads drawn (12) | `infra.js` |
| `tests/ui.html` | the real panels on a stand-in map view: tab states and gates, the drawing block, structure presets, quick predesign, infrastructure, KMZ and PDF report, Shapefile / GeoPackage / DXF / bill of quantities, background map, the 3D model on the terrain, the Layers panel and its visibility switches, the drawing support, dimensions, selection and editing, the status bar, the searches and Zoom to (24) | `ui/tabs.js`, `ui/layers.js`, `ui/maptools.js`, `areas.js`, `field.js`, `quick.js`, `output.js`, `report.js`, `export/*` |
| `tests/view3d.html` | sun and trackers against pvlib, row shading, heights by country, meshes, ground elevations, terrain tiles, glTF (8) | `view3d/sun.js`, `view3d/geometry.js`, `view3d/model.js`, `view3d/glb.js` |
| `tests/scene3d.html` | the real SceneView on the synthetic DTM: opens on the site without errors, ground from the terrain, AgriPV heights, sun buttons, views, report, back to 2D (5; minutes long in headless, software WebGL) | `view3d/scene.js` |

What the tests do **not** prove, and must be checked by hand in a real browser on the company network:

- the app page itself (`/app/`): the headless runner cannot start a 2D MapView, so the boot of the real page, the
  drawing tools on the map and the 2D → 3D → 2D switch are checked by eye with a sample site;
- the quality of the estimates on a real site: the fixtures are synthetic; a comparison with an Italian design of
  Engineering is still to be done (see the release gates in `README.md`);
- the import of a real `.axpo` of a designer: only synthetic ones have been tried.

Before a commit, every page must be green **and** the console of the headless run must be read, because the runner
does not fail on browser errors yet.

## 7. Where to look for a question

| Question | Look in |
|---|---|
| Why was this decided? | `docs/decisions.md` (one row per decision, with the date and the reason) |
| What is still to do? | `docs/plan.md`, and the release gates in `README.md` |
| Where does this toolkit value come from? | `docs/toolkit/<COUNTRY>.md`, then the `Source` column of the workbook |
| What did an audit find? | `docs/audit/` (UX audit of 2026-10-02, Geoportale alignment of 2026-10-08) |
| Where did the last session stop, and what comes next on the PC? | `docs/handoff/` (one note per hand-over between sessions) |
| How does the Geoportale write a `.axpo`? | section 1 of `docs/audit/2026-10-08-geoportale-alignment.md` |
| Which rules bind a coding session? | `CLAUDE.md` |
