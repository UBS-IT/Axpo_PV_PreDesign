# Plan

## Done — milestone 1 (2026-09-23)

- Project set-up, catalog v0.1 from the Design ESQ toolkit (fixed ground-mounted and AgriPV presets, rules,
  stations, fence, gates, fire tanks).
- Row-fill engine with exact containment, crossing tracks, target capacity; tests against a brute-force oracle.
- Local metric frame (true metres), buildable area (union, setback, buffered exclusions).
- App: site drawing and roles, `.axpo` and GeoJSON import, module library with roadmap import, field parameters,
  toolkit minimum pitch, results and warnings, grid optimisation, GeoJSON export, autosave, light/dark theme.

## Done — milestone 2 (2026-09-23)

- Workflow in steps on a left rail (0 Terrain · 1 Areas · 2 Fields · 3 Infrastructure · 4 Output · 4b 3D ·
  Electrical); Terrain, Infrastructure, 3D and Electrical are placeholders that say what will come.
- Areas in nine categories with per-object attributes, drag and drop between categories, drawing and reshaping
  per category, buffers shown on the map, net area given or computed (gross − setback − cuts).
- Imports: KML (nested folders), KMZ, Shapefile zip (several layers, each with its `.prj`), CSV points, GeoJSON
  with a legacy `crs`, `.axpo`; automatic sorting from names in six languages; files dropped on a category.
- Coordinate systems: country detection, national proposal with alerts (borders, two zones, German Länder,
  Italian regions, Polish CS2000), manual choice, dialog for files in metres without a system, datum shifts by the
  SDK projection engine.
- Project files `.pvpd` (save in place, save as, open, Ctrl+S / Ctrl+O); projects of milestone 1 are migrated.
- Tests: import suite (22) with synthetic fixtures built by arcpy and reference areas from ArcGIS.

## Done — milestone 3 (2026-09-25)

- Toolkit archive by country (`docs/toolkit/`): Italy transcribed from the PC Ground Mounting toolkit (PDF and DWG:
  shading angle 29°, trackers 1V, roads, clearances, stations, fence), France from the Design ESQ sheets, the other
  countries listed with what is needed; the group choices of the user. Catalog 0.2 with country sections.
- Group standards: module 2382 × 1134 bifacial with its power roadmap by semester (import of the group roadmap,
  period per project, warning after six months), 3V9, tracker 1V28 with drive gap and corridors every 4 trackers.
- Minimum pitch from the shading angle of the country of the site; optional half tables (half strings).
- Modules written into the project file (no silent replacement on another computer).
- Step 0 · Terrain (optional): Esri World Elevation or GeoTIFF on a grid of the local frame, slope map, slope limits
  of the structure (fixed 3V 10 % N-S / E-W, tracker 1V 15 %) cut from the buildable area; grid in the project file.
- Tests: modules (12), terrain (14), panels on a stand-in view (5), half tables against the oracle; headless runner.

## Action plan (from 2026-09-25)

Guiding principle (user, 2026-09-25): a predesign **more accurate than usual but fast and intuitive**. Toolkit values
are defaults and suggestions, never locks; advanced options stay out of the basic path. Size: S = one working
session, M = two or three, L = more. «Needs» = what only the user can provide.

### Phase A — Consolidate and prove it (next)

A1 done 2026-09-25 by the user in the browser: start, `.axpo` import by drag and drop, quick predesign (fixed and
tracker), half tables, Esri terrain, save / open, GeoJSON export all fine. The roadmap import was checked on the real
group workbook through the app's reader (10 periods S2 2024 – 2029, standard sheet, nothing from NZIA or hidden
sheets); to be seen once in the browser. Merge into `main` still to do.

| # | What | Why | Size | Needs |
|---|---|---|---|---|
| A1 ✔ | **Browser check and merge** of the milestone 3 branch: a short checklist (import a site, terrain from Esri and from a DTM, 3V9 and 1V28, roadmap import, save / open) | The app page cannot run in the cloud session: the user's browser is the last check | S | 20 minutes of the user |
| A2 ✔ | **Continuous tests on GitHub** (Actions running `tools/headless` on every push) | Every change checked automatically, whoever makes it | S | — |
| A3 ✔ | **Quick predesign**: one button after the site is loaded — group standards, standard module of the current semester, toolkit minimum pitch of the country, optimised grid position — and a clear result card; empty states that say the next step | The core of the principle: a first answer in three clicks, details only if wanted | M | — |
| A4 | **Pilot on one real Italian site** already designed by Engineering: compare buildable area, tables and MWp, note the gaps | Sets the accuracy the tool can claim (target to agree, e.g. ±5 % MWp) and shows what is missing | S | one site with its engineering layout |
| A5 | **Robustness**: libraries served with the app instead of CDNs (corporate proxies), SheetJS update (known flaws of 0.18.5), CSV with quoted fields, start without a background map | Works on company networks and with real files | S | — |

### Phase B — Complete the predesign (the deliverable for prospection and engineering)

| # | What | Why | Size | Needs |
|---|---|---|---|---|
| B1 ✔ | **3 · Infrastructure v1**: perimeter road as a switch (proposed up to ~9 MWp), fence offset from the structures (IT: 6 m with the road, 4 m without), gate at the access point, internal roads from the corridors, delivery station at the access with its user station within 20 m, transformer stations placed by hand (hint: ~1 per 3 MWp) with their clearances cut from the field | Fence, roads and stations change the MWp: without them the predesign overstates the capacity | M–L | road / station rules of other countries when they come |
| B2 | **4 · Output v1**: one-page PDF report (map, KPIs, assumptions with their toolkit sources, checks still to do) and KML / KMZ for Google Earth | What prospection sends around | M | a sample of today's reports, if any |
| B3 | **4 · Output v2**: Shapefile and DXF in the national system for engineering, Excel bill of quantities (tables, modules, piles, fence, roads) | Hand-over to engineering without redrawing | M | the DXF layer names Engineering wants |
| B4 | **2 · Fields v2**: remove / lock single tables by clicking, kept across regenerations; several fields per site with their own structure | Real sites need exceptions; kept optional | M | — |

### Phase C — Better inputs

| # | What | Why | Size | Needs |
|---|---|---|---|---|
| C1 | **Contour lines**: imported (DXF / Shapefile, when there is no model) and generated from the terrain for display and export | Terrain where no DTM exists; contours in the outputs | M | sample contour files |
| C2 | **DWG / DXF import** of areas (layers to categories) | Sites often arrive as CAD | M | sample DWGs of sites |
| C3 | **Import from the portal by project code** (Italy): ArcGIS sign-in, AREAS COLLECTION area + *IT - Site Features* | No `.axpo` round trip for Italian sites | M | portal access for the app |
| C4 | **Obstacle shade** from their height (and the terrain) on the tables | Trees and poles near rows | M | — |

### Phase D — Group roll-out

| # | What | Why | Size | Needs |
|---|---|---|---|---|
| D1 | **Country toolkits**: each new document goes into `docs/toolkit/<country>.md`, then the catalog (shading angle, roads, stations, setbacks) | PL, ES, DE, CH get country rules instead of «no rule yet» | S per country | the documents, a referent per country |
| D2 | **Hosting and sign-in**: static hosting on the company cloud (e.g. Azure Static Web Apps) with Entra ID; ArcGIS licence / API key for basemaps and World Elevation in production; repository moved to the company organisation | Colleagues use it without a local server; Esri terms for production use | M | IT department, ArcGIS organisation |
| D3 | **Pilots per country**: Poland against a HelioScope design, Spain against a RatedPower one | Trust of the country teams | S each | one site per country |

### Phase E — Later

- **4b · 3D**: SceneView with the terrain, tables at their real height and tilt.
- **Yield**: the internal yield tool API when it exists (typed-in kWh/kWp until then).
- **Electrical design**: after the user's survey (kept open on purpose).

### Suggested order

A1 → A2 → A3 → A4 → B1 → B2 → A5 → B3 → C1 … Phase D runs alongside, as documents and decisions arrive.

## Open questions

- Owner of the catalog in the Design ESQ team.
- Road widths and setbacks per country / region (the user will provide them).
- Which DTM formats each country uses.
- Hosting and sign-in (Azure, Entra ID tenant(s) of the group).
- Electrical design scope (after the user's six-month survey).
