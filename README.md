# PV Predesign

Web app for the **predesign of ground-mounted fixed and agrivoltaic PV plants**, for the Axpo / Urbasolar teams in
Italy, Poland, France, Spain, Germany and Switzerland. It is standalone: it can import projects from the Italian
Geoportale (`.axpo`), but does not depend on it. The predesign is for prospection: it screens sites without
loading Engineering with embryonic projects, and later gives Engineering a useful starting point (they will still
rely on the topographic survey).

Status: **milestone 3** (2026-09-25) — toolkit archive by country, group standards (module 2382 × 1134 bifacial with
its power roadmap, 3V9, tracker 1V28), optional terrain step with slope limits. See `docs/plan.md` for what comes next.

## The workflow

The left rail holds the steps; clicking the active step again folds the panel away to give the map more room.

| Step | Today |
|---|---|
| **0 · Terrain** | Optional: Esri World Elevation or your DTM / DSM (GeoTIFF) on a grid over the site, slope map, slopes over the limit of the structure cut from the buildable area; contour lines come next |
| **1 · Areas** | Import or draw the areas, sorted into categories (below); net area given or computed |
| **2 · Fields** | Modules (power by semester), structure (3V9 / 1V28 by default), tilt, azimuth, pitch, half tables, parametric layout and results |
| **3 · Infrastructure** | Fence with its clearance, perimeter road (suggested up to ~9 MWp), internal roads from the corridors, gates at the accesses, delivery / user / transformer stations with their clearance |
| **4 · Output** | Coordinate system for exports, GeoJSON export; KML, Shapefile, DXF and the report come next |
| **4b · 3D** | Placeholder |
| **Electrical** | Kept open on purpose |

**⚡ Quick predesign** (top bar, 1 · Areas, 2 · Fields): once the site is loaded, one dialog with three choices
already filled in — technology (ground-mounted fixed 3V9, AgriPV tracker 1V28, AgriPV fixed), pitch (the toolkit
minimum of the country for fixed structures; for trackers the one agreed with the farm, asked), terrain (optional:
Esri World Elevation with the slope limit) — then one click: group standards, standard module at the power of the
current semester, best grid position, results. Everything stays editable in 2 · Fields.

The top bar has **New / Open / Save / Save as** (project files `.pvpd`, a zip holding `project.json`; Ctrl+S,
Ctrl+Shift+S, Ctrl+O), **Import**, and a badge with the coordinate system of the exports.

### 1 · Areas

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
  table (e.g. *DPA* → exclusion · DPA corridor), keywords only for anything else.
- **Drawing** — polygon, line or points in any category (points are placed one after the other until Esc), reshape
  with the ✎ button, rename with a double click.
- **Net area** — used as it is when given (e.g. *Perimetro Netto* from the Geoportale); otherwise computed as gross
  area minus a boundary setback (setbacks change between countries and regions). In both cases exclusions,
  linear infrastructure, obstacles, mitigation and agricultural zones are cut out with their own buffers. The panel
  shows gross area, setback, exclusions and the buildable area in hectares.

### 0 · Terrain (optional)

- **Sources** — Esri World Elevation (global service, resolution depends on the country) or a DTM / DSM of your own
  (GeoTIFF in any system the SDK knows; files without a system go through the same dialog as other imports). The
  terrain is sampled on a grid of the local metric frame over the gross and net areas plus 30 m (cell 5 m by default;
  a finer model is averaged over each cell, a cell only partly covered by the model is left without data).
- **Slopes** — steepest slope and its north–south / east–west components per cell (Horn's weights), shown in classes
  0–5–10–15–25 %.
- **Slope limit of the structure** — from the catalog: fixed 3V at most 10 % north–south and 10 % east–west,
  fixed 2V, AgriPV fixed and tracker 1V at most 15 % in every direction; structures without a rule are not cut and
  the panel says so. Cells over the limit (patches under 250 m² ignored, an app setting) are cut from the buildable area.
- The grid is kept in the browser (IndexedDB) and inside the project file (`terrain/grid.f32`).

### 2 · Fields

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

### 3 · Infrastructure

- **Lots and fences** — the land the plant can use (base area minus the objects of 1 · Areas) often falls apart in
  lots, e.g. between roads, lines and ditches: they are numbered on the map (north to south) and each has its own
  fence. Tick lots and **join them in one fence**: it runs around them and across the gaps between them, never outside
  the site nor over the lots of another fence. The band between fence and structures is cut from the buildable area:
  in Italy 4 m, or 6 m with the perimeter road (1 m, 4 m road, 1 m). The designer can type another clearance or switch
  the fence off.
- **Perimeter road** — a switch. It is the template for plants up to about 9 MWp: the panel shows the suggestion
  for the current layout and the quick predesign applies it; the designer decides.
- **Roads** — the corridors across the rows of 2 · Fields (e.g. a 4 m gap after 4 trackers in line) are drawn and
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

### Coordinate systems

- **Proposed from the site location**: the country comes from generalized outlines (`app/catalog/countries.json`),
  then the national rule — Italy RDN2008 / UTM 32N west of 12° E and 33N east of it; France Lambert-93; Spain
  ETRS89 / UTM 29–31 by longitude, REGCAN95 / UTM 28N in the Canaries; Germany ETRS89 / UTM 33N in Berlin,
  Brandenburg, Mecklenburg-Vorpommern and Saxony and 32N elsewhere, Bavaria included (`app/catalog/regions.json`);
  Poland CS92 (with a note on the CS2000 zone of the cadastre); Switzerland LV95; elsewhere WGS 84 / UTM.
  Alerts near borders, across zones and where regions use one zone for their whole territory. The system can be
  changed by hand in 4 · Output.
- **Files in metres without a system** (a Shapefile without `.prj`, a CSV in easting / northing): a dialog lists the
  national systems that put every object inside their own country (e.g. RDN2008, ETRS89 and WGS 84 UTM 32N for
  a site near Cremona), or takes any EPSG code.
- **Datum shifts** — Shapefiles are read raw and converted by the SDK projection engine with their `.prj`, which
  applies the default datum transformation: a Monte Mario (Gauss-Boaga) file lands where ArcGIS puts it, whereas
  proj4 without TOWGS84 parameters would put it 168 m away (measured on the test fixture). Same for DHDN and
  CH1903 files.

## How it works

- **Toolkit archive and catalog** — `docs/toolkit/` collects the design rules by country (IT, FR, PL, ES, DE, CH)
  and for the whole group, each value with its source and status; `app/catalog/toolkit.json` holds the values the app
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

## Run it locally

```
py -3 scripts/serve.py 8140
```

Then open `http://localhost:8140/app/`. Tests, all in the browser:

- `http://localhost:8140/tests/` — layout engine, half tables, corridors as roads (14)
- `http://localhost:8140/tests/modules.html` — roadmap by semester, power periods, six-month alert, country catalog,
  slope limits, trackers, modules carried by projects (12)
- `http://localhost:8140/tests/sdk.html` — SDK and local frame (5)
- `http://localhost:8140/tests/import.html` — classification, v1 → v2 migration, countries and proposed systems,
  every national EPSG code, the import fixtures against the ArcGIS reference areas, Geoportale projects with the
  site-features model, net area, grid connection route, project and GeoJSON round trips (25)
- `http://localhost:8140/tests/terrain.html` — slopes, masks and outlines, GeoTIFF sampling, slope cut, project file (14)
- `http://localhost:8140/tests/infra.html` — fence, perimeter road, clearances, lots and shared fences, stations
  (snapping, moving, at the access), roads drawn (12)
- `http://localhost:8140/tests/ui.html` — the real panels on a stand-in map view, quick predesign, infrastructure (9)

Without a browser, or where the CDNs are blocked: `tools/headless` runs every page in headless Chromium with the
libraries bundled from npm (`npm install && npm run build && npm test`, see its README). GitHub Actions runs the same
on every push (`.github/workflows/tests.yml`).

No build step; any static web server works, but the app must be served over http(s), not opened as a file.
The fixtures in `tests/fixtures` are synthetic and rebuilt with `scripts/make_fixtures.py` (ArcGIS Pro Python,
arcpy), which also writes the reference values in `expected.json`.

## Project layout

```
app/                  the web app (index.html, css/, js/)
  catalog/            toolkit.json, countries.json (outlines), regions.json (German zone-33 Länder)
  js/terrain/         step 0: grid sampling (Esri, GeoTIFF), slopes and masks (pure), storage
  js/areas.js         step 1: categories, import, drawing, net area
  js/categories.js    categories and automatic sorting (pure)
  js/crs.js           national systems, country detection, proposals and alerts (pure)
  js/field.js         step 2: parametric layout and results
  js/output.js        step 4: coordinate system for exports, export
  js/layout/          structures (notation, table geometry, pitch rule) and the row-fill engine
  js/geo/             local metric frame, GeoJSON <-> SDK conversion and reprojection
  js/io/              importers, project files
  js/ui/              rail, coordinate system dialog, toasts
tests/                browser tests and synthetic fixtures
docs/                 plan, decisions; toolkit/ = the toolkit archive by country
scripts/              serve.py (local server without cache), make_fixtures.py
tools/                headless test runner, CAD (DWG) reader — development tools, not part of the app
```

## Not done yet

Contour lines, access road from the gate, 3D, several
fields per site, exports in the national system (KML / Shapefile / DXF), report, DWG / DXF import, yield API,
electrical design (deliberately left open). See `docs/plan.md`.
