# PV Predesign

Web app for the **predesign of ground-mounted fixed and agrivoltaic PV plants**, for the Axpo / Urbasolar teams in
Italy, Poland, France, Spain, Germany and Switzerland. It is standalone: it can import projects from the Italian
Geoportale (`.axpo`), but does not depend on it. The predesign is for prospection: it screens sites without
loading Engineering with embryonic projects, and later gives Engineering a useful starting point (they will still
rely on the topographic survey).

Status: **internal pilot candidate, not production-ready** (2026-10-02). The implemented workflow includes the site,
terrain, layout, infrastructure, exports and a working 3D scene; the UX refactor of 2026-10-02 (stepper, drawing in
two steps, 2D / 3D toggle) is to be checked in a real browser. The 3D browser regression check passed 5/5 after the
SceneView sizing fix; this does not establish production readiness or validate estimates against an Engineering design.
See [Release readiness](#release-readiness) below and `docs/plan.md` for planned work.

## The workflow

The map opens on satellite imagery without labels (a toggle switches to the topographic map); a slider on the map
sets the opacity of the background, remembered in the browser, so the layout stays readable over busy imagery.

The left rail is a **stepper** in the order of the dependencies: every step shows its state — *locked* (a
prerequisite is missing: the step still opens, with a gate that says why and a link to the step to do first),
*ready*, *optional*, *done* (a tick and its key figure: buildable hectares, MWp, fence length). Nothing forces the
order: a designer can work in any sequence. The app reopens on the step last visited, or on the first still to do.
Clicking the active step again folds the panel away to give the map more room. **2D / 3D** is a switch on the map,
not a step: the panel keeps its step while the map turns into the scene.

| Step | Today |
|---|---|
| **1 · Site** | Import or draw the boundary and the constraints (two-step drawing: what, then with which tool; undo / redo), sorted into categories (below); net area given or computed |
| **2 · Terrain** | Optional: analyse the slopes from Esri World Elevation or your own DTM / DSM (GeoTIFF) on a grid over the site; the areas too steep for the structure are cut from the buildable area; stale when the site changes |
| **3 · Layout** | Technology, toolkit structure (3V9 / 1V28 by default, custom notation on request), module (power by semester), tilt, azimuth, pitch; advanced options folded (gaps, tracks, half tables, target, grid position); results |
| **4 · Infrastructure** | Fence with its clearance, perimeter road (suggested up to ~9 MWp), internal roads from the corridors, gates at the accesses, delivery / user / transformer stations with their clearance |
| **5 · Outputs** | Export coordinate system; one-page PDF report; KMZ, GeoJSON, Shapefile, GeoPackage, DXF and Excel bill of quantities. The electrical design is not part of the predesign (kept open on purpose) |
| **2D / 3D** (map switch) | SceneView on the shared map, terrain, structures, sun and shadows, saved views, PNG/PDF and glTF export; editing remains in 2D |

**⚡ Quick predesign** (top bar, 1 · Site, 3 · Layout): once the site is loaded, one dialog with three choices
already filled in — technology (ground-mounted fixed 3V9, AgriPV tracker 1V28, AgriPV fixed), pitch (the toolkit
minimum of the country for fixed structures; for trackers the one agreed with the farm, asked), terrain (optional:
Esri World Elevation with the slope limit) — then one click: group standards, standard module at the power of the
current semester, best grid position, results. Everything stays editable in 3 · Layout.

The top bar has **New / Open / Save / Save as** (project files `.pvpd`, a zip holding `project.json`; Ctrl+S,
Ctrl+Shift+S, Ctrl+O), **Import**, and a badge with the coordinate system of the exports.

### 1 · Site

- **Categories** — Gross area, Net area, Grid connection route (the cable route to the point of connection, estimated
  or confirmed: shown with its length in km, dashed until confirmed, never cut), Exclusion zones, Linear
  infrastructure (power lines, pipelines, ditches, roads, railways), Obstacles (trees, poles, buildings, with height
  for their shade), Access & grid connection point, Mitigation (hedges, green screens), Agricultural zones,
  Reference (parcels and anything shown but not used).
- **Per-object attributes** — buffer (exclusions, lines, obstacles), type, height, width (strips drawn as lines).
  Buffers are drawn on the map as they are cut.
- **Moving objects** — drag them from one category to another (or use the *Move to* menu); a category refuses
  geometry it cannot take (a polygon is not a power line).
- **Import** — GeoJSON, KML, KMZ, Shapefile (.zip, several layers), CSV points (x/y or lon/lat, with name, type,
  height; semicolons and decimal commas accepted) and Geoportale projects (`.axpo`). Files dropped on the map are
  sorted automatically from folder, layer and object names in six languages (e.g. *Superficie bruta*,
  *Zona inundable*, *Ligne HTA 20 kV*, *Árboles*, *Accesos*); files dropped on a category go into it when their
  geometry fits. DWG / DXF import comes later.
- **From the Geoportale** — categories, types and attributes use one shared model ("site-features", AGOL Axpo
  `schemas/site_features_model.json`), also used by the AGOL layer *IT - Site Features*. Drawings saved with it
  keep their category, type, buffer, height, width and voltage exactly; the site of work of an `.axpo` (an area of
  AREAS COLLECTION) becomes the gross area; older drawings with the Sites Notes categories are mapped by a fixed
  table (e.g. *DPA* → exclusion · DPA corridor), keywords only for anything else. Slope exclusions made by the
  Geoportale's *Pendenze da DTM* come with their grid and limit: see 2 · Terrain.
- **Drawing** — the pattern of the Geoportale's *Disegna*, in two numbered steps: **① What you draw** (the category
  as a row of coloured chips, then the type and buffer / height / width given to the next drawings) and **② With
  which tool** (Point, Line, Area, Rectangle cards: a card is disabled with the reason when the category does not take
  that geometry). The armed tool stays armed after each drawing (a second click or Esc stops it); a status line says
  what is going on and a *Last drawing* box where the object went. **↶ ↷ undo / redo** (Ctrl+Z / Ctrl+Y, 40 steps)
  cover every change of the objects; removing one object or all of a category shows a message with *Undo* instead
  of a confirmation. Each row has rename (✎), reshape (⬠) and remove (×); *Draw here* on a category card picks it.
- **Net area** — used as it is when given (e.g. *Perimetro Netto* from the Geoportale); otherwise computed as gross
  area minus a boundary setback (setbacks change between countries and regions). In both cases exclusions,
  linear infrastructure, obstacles, mitigation and agricultural zones are cut out with their own buffers. The panel
  shows gross area, setback, exclusions and the buildable area in hectares.

### 2 · Terrain (optional)

The panel says what it does (cuts the areas too steep for the chosen structure), waits for the site (a gate with a
link to 1 · Site until then), has one primary action (*Analyse the slopes*, Esri World Elevation) and one secondary
(*Use my own model*, GeoTIFF), shows the structure it applies to (chosen here or in 3 · Layout), and flags the terrain
as *to redo* when the site or the grid cell changed after the sampling. Grid cell and small patches are advanced options.

The **slope limit in use** is chosen the same two ways as the Geoportale's *Pendenze da DTM*: the toolkit rule of the
structure (default), one value in every direction, or north–south and east–west apart (a cell is cut when it is over
either). A status line always says whether the limit in use is the toolkit's and what the toolkit says for the
structure ("Same as the toolkit for 3V9" / "Different from the toolkit: Fixed 3V is 10 % north-south and 10 %
east-west"); the layout warnings, the rail figure ("1.2 ha · own limit") and the report repeat it. The limit is kept in
the project file. Geoportale and PV Predesign compute slopes the same way (the Geoportale ported this module); the
toolkit values live only here.

- **Sources** — Esri World Elevation (global service, resolution depends on the country) or a DTM / DSM of your own
  (GeoTIFF in any system the SDK knows; files without a system go through the same dialog as other imports). The
  terrain is sampled on a grid of the local metric frame over the gross and net areas plus 30 m (cell 5 m by default;
  a finer model is averaged over each cell, a cell only partly covered by the model is left without data).
- **Slopes** — steepest slope and its north–south / east–west components per cell (Horn's weights), shown in classes
  0–5–10–15–25 %.
- **Slope limit of the structure** — from the catalog: fixed 3V at most 10 % north–south and 10 % east–west,
  fixed 2V, AgriPV fixed and tracker 1V at most 15 % in every direction; structures without a rule are not cut
  unless a limit is chosen by hand, and the panel says so. Cells over the limit (patches under 250 m² ignored, an app
  setting) are cut from the buildable area.
- **From the Geoportale** — a project whose slopes were computed there (*Pendenze da DTM*: a «steep slope» exclusion
  with how it was made, the elevation grid in `terreno/<id>.f32`) brings its grid as the terrain of this step when it
  covers the site (no new download) and its limit as the limit in use (compared with the toolkit); the imported
  exclusion is replaced by the live cut (with Undo), so the slope is cut once. A grid that does not cover the site, or
  an older export without one, leaves the exclusion as it is.
- The grid is kept in the browser (IndexedDB) and inside the project file (`terrain/grid.f32`).

### 3 · Layout

- **Standards of the group** — module TOPCon 2382 × 1134 mm bifacial; ground-mounted 3V9 (27 modules) at 15°;
  tracker 1V28 ±55°, 0.50 m between trackers in line, at most 4 in line then a 4 m gap, 1.19 m drive gap (measured on
  the Italian drawing); the pitch of trackers is agreed with the farm, so it has no default.
- **Module power by semester** — the catalog carries the power roadmap of the standard module (sheet «Roadmap
  Module- Standard», column «CS - PPA FR et EU»); importing a newer roadmap updates it. The power of the current
  semester is used unless the project picks another period (e.g. the one of construction). Powers loaded more than six
  months ago raise a warning: the roadmap is updated every six months. Prices are never read.
- **Modules travel with the project** — the modules a project uses are written into its file and added to the library
  of whoever opens it; a missing module is reported, never replaced silently.
- **Minimum pitch by country** — shading angle of the country of the site (Italy 29°, France 35°); countries without
  a toolkit value get no suggestion instead of a borrowed one.
- **Half tables** — optional: where a whole table does not fit, a half one (1V14 for the 1V28) takes the grid place.
  The 3V9 is never split.

### 4 · Infrastructure

- **Lots and fences** — the land the plant can use (base area minus the objects of 1 · Site) often falls apart in
  lots, e.g. between roads, lines and ditches: they are numbered on the map (north to south) and each has its own
  fence. Tick lots and **join them in one fence**: it runs around them and across the gaps between them, never outside
  the site nor over the lots of another fence. The band between fence and structures is cut from the buildable area:
  in Italy 4 m, or 6 m with the perimeter road (1 m, 4 m road, 1 m). The designer can type another clearance or switch
  the fence off.
- **Perimeter road** — a switch. It is the template for plants up to about 9 MWp: the panel shows the suggestion
  for the current layout and the quick predesign applies it; the designer decides.
- **Roads** — the corridors across the rows of 3 · Layout (e.g. a 4 m gap after 4 trackers in line) are drawn and
  measured; any other road is drawn on the map (heavy 4 m or light 3 m in Italy), reshaped by its vertices, removed,
  and cut from the buildable area with its width.
- **Gates** — one on the fence next to each site access (toolkit width, 6 m in Italy).
- **Stations** — delivery, user and transformer stations with the sizes of the country (IT: CT 8.70 × 3.00, CC and
  CU 7.50 × 3.00 m) and 3 m kept free around them; placed or moved within 25 m of a fence they snap flush with it and
  along it (elsewhere they follow the rows), turned by 90° with a click; delivery and user stations can be placed at the site access in one
  click (flush with the fence, user station within 20 m); transformer stations by hand, with a hint of about one every
  3 MWp (part of the electrical design, optional). Stations are cut from the buildable area.
- Countries without toolkit values get no borrowed value: the panel says what is missing.
- Fence, roads, stations and gates are part of the GeoJSON export.

### 5 · Outputs

- **PDF report** — one A4 landscape page: the layout drawn to scale from the local metric frame (site, exclusions,
  lines, roads, buildable area, tables, fences, stations, gates, lot numbers; scale bar and north arrow), the key
  figures, the assumptions with their toolkit sources (shading angle of the country, module power and roadmap date,
  fence clearance, slope limit and terrain, export system) and the checks still to do. Vector, no background map.
- **KMZ** for Google Earth — folders by category with their colours, attributes in the descriptions; the tables are
  one placemark.
- **GeoJSON** in WGS 84 — every object with its category and attributes (can be imported back).
- **For Engineering**, in the national system chosen above (metres; lengths and areas measured in the local frame):
  - **Shapefile** (zip) — one layer per kind of object (`areas_polygon` / `_line` / `_point`, `buildable`, `tables`,
    `fences`, `roads`, `road_axes`, `stations`, `gates`) with attributes, `.cpg` UTF-8 and the `.prj` in ESRI WKT
    (`app/catalog/prj.json`, generated from the EPSG database by `scripts/make_prj.py`); outer rings clockwise.
  - **GeoPackage** (`.gpkg`, OGC 1.3) — the same layers in one SQLite file (sql.js, SQLite in WebAssembly),
    multipolygons / multilinestrings, the system with its OGC WKT; ArcGIS Pro and QGIS open it directly (checked
    with GDAL 3.12). No file geodatabase: ArcGIS Pro converts a GeoPackage in one step if needed.
  - **DXF** (AutoCAD R12) — layers `PVP_*` (defaults of the app until Engineering gives its names: `DXF_LAYERS` in
    `app/js/export/model.js`), closed polylines, gates as points, labels of fences, stations and gates.
  - **Bill of quantities** (Excel) — summary of layout and infrastructure (tables, half tables, modules, MWp, areas,
    fence per group, gates, roads by kind with length and surface, stations), one row per table and per object with
    X, Y; foundations, cables and earthworks listed as not included, never estimated.
  Checked with ezdxf (audit: no errors), pyshp and openpyxl.

### 2D / 3D

The 2D / 3D switch on the map turns it into a 3D scene (same background and opacity) with its controls in a card
over the map; the side panel keeps its step and the editing stays in 2D.

- **Ground** — a designer-uploaded GeoTIFF grid from 2 · Terrain overlays Esri World Elevation locally; if that
  grid was sampled from Esri World Elevation, the scene uses World Elevation directly. National CRS choices apply
  to imports and exports; the 3D scene uses the spatial reference of its basemap. Do not use Web Mercator to measure
  site areas or table spacing.
- **Structures at their real height** — fixed tables with the low edge at the toolkit height of the country (IT
  1.00 m, FR 1.10 m) over the ground under each corner, as the piles follow the terrain; trackers with the axis at
  the IT height of their AgriPV category (standard 1.50, grazing 2.30, advanced 3.10 m), turned towards the sun at
  the time of the view (±55°, no backtracking) or by hand. Missing heights (other countries, AgriPV fixed) are typed
  in, never borrowed. Stations, fence, gates and obstacles with a height come too.
- **Sun and shadows** — date and time on the map (Daylight) with quick buttons for the solstices in solar time; the
  panel gives the sun position and the row-to-row shading at that moment; ShadowCast shows the hours of shadow over a
  period. Sun position from the NOAA calculator, within 0.01° of NREL SPA (pvlib), tracker angles as pvlib.
- **Views** — viewpoints saved in the project, PNG pictures, a PDF report with one page per saved view, line of sight.
- **glTF (.glb)** — terrain of 2 · Terrain around the site, modules, stations, fence, gates and obstacles in metres, Y up,
  with the origin and its national coordinates in the file (checked with the Khronos glTF validator).

### Coordinate systems

- **Proposed from the site location**: the country comes from generalized outlines (`app/catalog/countries.json`),
  then the national rule — Italy RDN2008 / UTM 32N west of 12° E and 33N east of it; France Lambert-93; Spain
  ETRS89 / UTM 29–31 by longitude, REGCAN95 / UTM 28N in the Canaries; Germany ETRS89 / UTM 33N in Berlin,
  Brandenburg, Mecklenburg-Vorpommern and Saxony and 32N elsewhere, Bavaria included (`app/catalog/regions.json`);
  Poland CS92 (with a note on the CS2000 zone of the cadastre); Switzerland LV95; elsewhere WGS 84 / UTM.
  Alerts near borders, across zones and where regions use one zone for their whole territory. The system can be
  changed by hand in 5 · Outputs.
- **Files in metres without a system** (a Shapefile without `.prj`, a CSV in easting / northing): a dialog lists the
  national systems that put every object inside their own country (e.g. RDN2008, ETRS89 and WGS 84 UTM 32N for
  a site near Cremona), or takes any EPSG code.
- **Datum shifts** — Shapefiles are read raw and converted by the SDK projection engine with their `.prj`, which
  applies the default datum transformation: a Monte Mario (Gauss-Boaga) file lands where ArcGIS puts it, whereas
  proj4 without TOWGS84 parameters would put it 168 m away (measured on the test fixture). Same for DHDN and
  CH1903 files.

## How it works

- **Toolkit archive and catalog** — `docs/toolkit/` collects the design rules by country (IT, FR, PL, ES, DE, CH)
  and for the whole group, each value with its source and status; `docs/toolkit/toolkit.xlsx` is the workbook
  people edit (one row per value, one sheet per kind of record; `python scripts/make_toolkit.py` writes the JSON and
  the CI checks that both match); `app/catalog/toolkit.json` holds the values the app
  uses: group values at the top, country values under `countries.<ISO>` (never borrowed by another country). Values
  still to be checked have `"verify": true`. `tools/cad/dwg_dump.mjs` reads toolkit DWGs.
  Table sizes are not stored: they come from the module, `n × W + (n − 1) × 0.02`, which reproduces every table
  length of the toolkit (2V13 14.98 m, 3V9 10.37 m, 3V18 20.75 m).
- **True metres** — areas and the layout are computed in a Transverse Mercator frame centred on the site with
  scale factor 1 (`app/js/geo/localframe.js`): a 100 × 50 m rectangle is 5 000.000 m² on the ellipsoid, and a
  400 × 250 m Lambert-93 rectangle (100 000 m² on the grid) measures 100 172.46 m², exactly the geodesic area
  given by ArcGIS. Web Mercator is never used for measuring (it is off by 0.15–0.17 % at 45°).
- **Row-fill engine** — `app/js/layout/rows.js`, pure functions without the SDK. Rows perpendicular to the
  azimuth at the given pitch, tables on a common column grid, optional corridors every N tables. A table is kept
  only if its whole rectangle is inside the buildable area; the test is exact (the strip of each row is cut in
  slabs at every vertex height, where the boundary moves linearly). Checked against a brute-force oracle on 200
  random polygons with holes (71 003 tables, identical). A 1 km site with ~5 500 tables fills in ~5 ms.
- **ArcGIS Maps SDK 4.34** loaded with `$arcgis.import()` (the 5.x mechanism), geometry operators
  (`geometry/operators/*`) for union, difference, buffer and projection. All SDK access goes through `app/js/sdk.js`.
  It is the only library loaded from a CDN (js.arcgis.com).
- **Libraries served by the app** — `app/vendor/` holds JSZip, togeojson, shpjs, geotiff, jsPDF and sql.js as minified ES
  modules of the versions pinned in `tools/headless/package-lock.json` (`npm run vendor` rebuilds them; CI checks they
  match; licenses and versions alongside), all loaded through `app/js/libs.js`, so company proxies that block public
  CDNs do not break imports or exports. Excel roadmaps (.xlsx / .xlsm) are read by `app/js/io/xlsx.js` (JSZip and
  the browser's XML parser; no SheetJS, whose npm release has known flaws) and CSV by `app/js/io/csv.js` (RFC 4180:
  quoted separators, quotes and line breaks). Old .xls workbooks must be saved as .xlsx. If the background map cannot
  be reached the app starts anyway and says so.

## Run it locally

```
py -3 scripts/serve.py 8140
```

Then open `http://localhost:8140/app/`. Tests, all in the browser:

- `http://localhost:8140/tests/` — layout engine, half tables, corridors as roads (14)
- `http://localhost:8140/tests/modules.html` — roadmap by semester, power periods, six-month alert, country catalog,
  slope limits, trackers, modules carried by projects, Excel and CSV readers and writers, GeoPackage geometry, vendored libraries (19)
- `http://localhost:8140/tests/sdk.html` — SDK and local frame (5)
- `http://localhost:8140/tests/import.html` — classification, v1 → v2 migration, countries and proposed systems,
  every national EPSG code, the import fixtures against the ArcGIS reference areas, Geoportale projects with the
  site-features model, net area, grid connection route, project and GeoJSON round trips (25)
- `http://localhost:8140/tests/terrain.html` — slopes, masks and outlines, GeoTIFF sampling, slope cut, limit chosen
  by hand against the toolkit, project file, Geoportale projects with slopes from their DTM (18)
- `http://localhost:8140/tests/infra.html` — fence, perimeter road, clearances, lots and shared fences, stations
  (snapping, moving, at the access), roads drawn (12)
- `http://localhost:8140/tests/ui.html` — the real panels on a stand-in map view, stepper states and gates, drawing
  block (chips, tools by category, undo / redo), structure presets, quick predesign, infrastructure, KMZ and PDF
  report, Shapefile / GeoPackage / DXF / bill of quantities, background map, 3D model on the terrain (16)
- `http://localhost:8140/tests/view3d.html` — sun and trackers against pvlib, row shading, heights by country,
  meshes, ground elevations, terrain tiles, glTF (8)
- `http://localhost:8140/tests/scene3d.html` — the real SceneView (2D / 3D switch) on the synthetic DTM: opens on the site
  without errors, ground from the terrain model, AgriPV fixed heights, sun buttons, views, report, back to 2D (5)

Without a browser, or where js.arcgis.com is blocked: `tools/headless` runs the browser test pages in headless
Chromium with the ArcGIS Maps SDK bundled from npm (`npm ci && npm run build && npm test` from `tools/headless`; see
its README). GitHub Actions runs them on pushes and pull requests (`.github/workflows/tests.yml`). These tests do
not exercise the complete production app boot flow; check `/app/` in a real browser and on the intended company
network before a pilot or release. A green CI run alone is not a production sign-off.

## Release readiness

The app is a candidate for a controlled internal pilot, **not an approved production rollout**. Before sharing it
widely or relying on its estimates, track and verify these gates:

- **Untrusted files (P0):** validate `.pvpd` project structure and values on open, and ensure imported feature,
  module and viewpoint IDs cannot enter HTML attributes without escaping. Add regression tests with malformed and
  hostile project files. See `app/js/io/projectfile.js`, `app/js/areas.js`, `app/js/modules.js` and `app/js/view3d/scene.js`.
- **Project integrity (P0):** do not report a successful save or open when the project declares a terrain grid but
  its `terrain/grid.f32` is unavailable, corrupt or mismatched. Surface browser autosave/storage failures and test
  save–close–reopen, including a fresh browser and storage quota failures.
- **Test and 3D resilience (P1):** make the headless runner fail on unexpected browser errors; test replacement of a
  terrain grid while the scene is open; bound screenshot/report waits so a stalled scene does not hang indefinitely.
  Run a manual smoke test of the real app, including the 2D ↔ 3D transition, on the target browsers.
- **Engineering pilot:** compare buildable area, tables and MWp with at least one completed Italian design; agree
  acceptable tolerances and record discrepancies. The existing synthetic fixtures and the 5/5 SceneView check do
  not establish the accuracy of an actual site.
- **Deployment decision:** approve company hosting and access control, Esri licensing/credentials for basemaps and
  World Elevation, data-handling policy, project-file backup/recovery and an owner for toolkit values before rollout.
  See `docs/plan.md` (A4 and D2). Do not silently substitute another country's unverified toolkit rules.

No build step is needed to serve `app/`; use an HTTP(S) server rather than opening it as a file.
The fixtures in `tests/fixtures` are synthetic and rebuilt with `scripts/make_fixtures.py` (ArcGIS Pro Python,
arcpy), which also writes the reference values in `expected.json`; the Geoportale projects with slopes from a DTM
with `scripts/make_axpo_slope_fixture.py` (plain Python with pyproj).

## Project layout

```
app/                  the web app (index.html, css/, js/)
  catalog/            toolkit.json, countries.json (outlines), regions.json (German zone-33 Länder)
  js/terrain/         step 2: grid sampling (Esri, GeoTIFF), slopes and masks (pure), storage
  js/areas.js         step 1: categories, import, drawing in two steps, undo / redo, net area
  js/categories.js    categories and automatic sorting (pure)
  js/crs.js           national systems, country detection, proposals and alerts (pure)
  js/field.js         step 3: parametric layout and results
  js/infra.js         step 4: fence, roads, gates, stations
  js/output.js        step 5: coordinate system for exports, export
  js/layout/          structures (notation, table geometry, pitch rule) and the row-fill engine
  js/geo/             local metric frame, GeoJSON <-> SDK conversion and reprojection
  js/io/              importers, Excel and CSV readers, Excel writer, project files
  js/export/          Shapefile, GeoPackage, DXF and bill of quantities for Engineering (national system)
  js/libs.js          loader of the vendored libraries
  vendor/             third-party libraries (built by tools/headless/vendor.mjs; sql.js with its .wasm), versions.json, licenses/
  js/ui/              stepper rail, confirm dialog, coordinate system dialog, background map, toasts (with Undo)
  js/view3d/          2D / 3D switch: sun and shading (pure), geometry, model, scene, glTF writer
tests/                browser tests and synthetic fixtures
docs/                 plan, decisions; toolkit/ = the toolkit archive by country and the toolkit workbook (toolkit.xlsx)
scripts/              serve.py (local server without cache), make_fixtures.py, make_prj.py (.prj texts), make_toolkit.py (workbook <-> toolkit.json)
tools/                headless test runner and vendor builder, CAD (DWG) reader — development tools, not part of the app
```

## Not done yet

Contour lines, access road from the gate, backtracking of the trackers, several
fields per site, DXF layer names of Engineering, piles in the bill of quantities (no toolkit value yet), DWG / DXF
import, yield API, electrical design (deliberately left open). See `docs/plan.md`.
