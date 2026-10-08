# Geoportale ↔ PV Predesign alignment — audit of 2026-10-08

Scope: `UBS-IT/custom-AGOL-web-map` at `f54d7d6` (2026-10-07; `README.md` §4 and §7, `geoportale_axpo.html`:
`slp*`, `sfAuto*`, `captureWork`, `projBuild`, `projOpen`) against PV Predesign `main` at `634bb7a`. Reason: the
user reported that PV Predesign did not import the terrain (DTM) extracted by the Geoportale, and that the
Geoportale's slope tool is the more complete of the two. Method: code reading of both sides, the `.axpo` contract
rebuilt from the writer's code, synthetic fixtures made from that contract, tests. No real project was available:
the causes below are the ones the code allows; the one that hit the user is to be confirmed with their file.

## 1. What the Geoportale writes in a `.axpo` today, and what PV Predesign reads

| In `progetto.json` | Written by the Geoportale (f54d7d6) | Read by PV Predesign before | After this audit |
|---|---|---|---|
| `site` | the site of work of AREAS COLLECTION: `guid, code, comune, regione, geom` | gross area «Site <code>» | same |
| `toolGeoms[].a.sf_*` | category, type, buffer, height, width, voltage, source, status, site, GlobalID | category, type, buffer, height, width, voltage | same |
| `toolGeoms[].a.sf_slope` | `{limit, cell, min_patch, buffer, source, dtm, grid, area, date}` on the exclusion of *Pendenze da DTM* | since 2026-10-04: `feature.slope` | same |
| `toolGeoms[].a.sf_auto` | `'buffer'` (strip around an object with a buffer, 2026-10-06) or `'net'` (automatic net area); `sf_of`, `sf_uid`, `sf_sig` | **imported as ordinary drawings**: the strip doubled the buffered object, the automatic net froze PV Predesign's own net area | **left out** (one toast says how many): PV Predesign computes strips and net area from the objects with the same rules |
| `netSetback`, `netAuto` | the setback from the cadastral boundary of the automatic net area (m), the switch | ignored | `netSetback` → `settings.boundarySetback` when none was set |
| `terrain[]` | one record per DTM **still on the map**: `{id, lon0, lat0, x0, y0, cell, nx, ny, zmin, zmax, missing, loadedAt, source, name, buffer, area_name, area_geom, limit, min_patch, view, file}` | since 2026-10-04: adopted when the project had no grid **and** the grid covered the whole site | adopted when it covers any part of the site (the coverage is shown); replaces an Esri grid of this app, never a GeoTIFF of the designer |
| `terreno/<id>.f32` | Float32 little-endian, row by row from the south-west cell, NaN without data | read, `length === nx · ny` checked | same |
| `images[]` with `slp` | the DTM picture (rebuilt from the grid on opening) | ignored | ignored |
| `parcels` | the cadastral parcels of the list | reference objects | same |
| `layers, order, webmap, services, dwg, images` (files) | the map of the Geoportale | ignored (not PV Predesign's business) | ignored |

## 2. Why the terrain did not arrive (the causes the code allows)

1. **The DTM was no longer on the Geoportale map when the project was saved.** `slpProjSave` writes only the
   grids whose image is still among the imports (`importedImages`): closing the DTM picture with × (or reloading
   the page, after which "the exclusion stays, the image does not") drops the grid from the next save. The exclusion
   keeps `sf_slope.grid`, but there is nothing to adopt. PV Predesign says nothing in this case (the exclusion is
   imported as it is); the fix is on the Geoportale side or in the user's habit: save the project while the DTM is
   on the map, or extract the slopes again before saving.
2. **The grid did not cover the whole site.** The Geoportale samples the gross area the user picked (a drawing, the
   site of work, or merged parcels) plus 25 m; PV Predesign's site is the union of every gross and net area, the
   AREAS COLLECTION site of work included. A grid made on a gross drawing inside a larger site of work did not cover
   PV Predesign's site, and the import refused it ("does not cover the site: not used"). **Fixed**: the grid is
   adopted when it covers any part of the site; the covered share is shown in the Terrain step and in the results,
   the slopes outside it are said not to be checked, and the box of the site at adoption time travels with the grid
   so that it is not flagged as "to redo".
3. **The project already had a terrain.** A quick predesign with the terrain box ticked, or *Analyse the slopes*
   pressed before the import, left an Esri grid in the project, and the import kept it ("already has a terrain").
   **Fixed**: an Esri grid of this app is replaced by the Geoportale one (same data, chosen on purpose for the
   project); a GeoTIFF of the designer is kept, with a message.
4. **The first record was not the right one.** With several grids the import took the one made on the imported
   gross area, else the first. **Fixed**: the grid named by the imported slope exclusion (`sf_slope.grid`) comes
   first, then the one made on an imported gross area, then the first.

Not a cause: the file layout (`terreno/<id>.f32`, Float32 LE, south-west first) and the record fields match the
reader exactly; `images[].slp` is ignored as agreed.

## 3. The slope tool of the Geoportale against 2 · Terrain

| Geoportale (*Pendenze da DTM*) | PV Predesign 2 · Terrain, before | After |
|---|---|---|
| Choice of the gross area (drawing, site of work, merged parcels) | the union of gross and net areas, always | same (the site is the project) |
| Limit in every direction, or N-S and E-W apart; recomputed at once | same since 2026-10-04, plus the toolkit rule as default and the comparison | same |
| Grid of 5 m cells (2–50, grown by 1.25 under 400,000 cells), 25 m margin plus one cell | 5 m cells (1–50, grown under 2 M cells), 30 m margin | same (equivalent; the margins differ by design) |
| Esri World Elevation, `finest-contiguous`, 5,000 points per request | same, plus the designer's own GeoTIFF | same |
| Horn 3 × 3, `limitMask`, small patches dropped, rings | same code (the Geoportale ported it) | same |
| **Image on the map**: hill-shaded elevations or slope classes, transparent outside the gross area + buffer, cells over the limit hatched in red, 80 % opacity | polygons of the slope classes over the whole grid (margin included), hatched polygon of the cut | **ported**: the same image (`MediaLayer`, same ramp, light and hatch), *Elevations* / *Slope classes* chips, transparent outside the site plus its buffer; the cut keeps a dashed outline |
| **Figures inside the gross area**: mean and max slope, ha over the limit and % of the area, DTM and grid | "over the limit on the grid: x ha" (margin included) | **ported**: inside the site: mean, steepest, ha over the limit, % of the site; the share of the site the grid covers |
| One extraction per area, updated in place; the exclusion as one drawing, updated | one grid per project | same (one grid per project; the Geoportale's exclusion is replaced by the live cut) |
| Clip of the exclusion to the gross area | the cut is clipped to the base area by `computeArea` | same |
| Reopening a project restores image, limit and view | restore from IndexedDB / the `.pvpd` | same, plus the view |

What is **not** ported, on purpose: the choice of the area to sample (the site is the whole project here), the
"add the exclusion to the collection" step (the cut is live), the Italian texts.

## 4. Other things the Geoportale does that touch PV Predesign

| Geoportale | PV Predesign | Decision |
|---|---|---|
| Gross area from the parcels (2026-10-06) | parcels arrive as reference objects; the gross area is the drawing or the site of work | nothing to do: the drawing comes with the project |
| Automatic strips (buffer polygons that follow their object) | buffers are computed from the object's attribute, drawn and cut | strips left out at import (§1): one source of truth, the object |
| Automatic net area with boundary setback | net = gross − setback − cuts, live | the automatic net left out, the setback taken (§1) |
| Images v2 (world files, control points, PDF) and DWGs | not read (the map of the Geoportale) | out of scope: PV Predesign is about the layout, the Geoportale about the map |
| Profilo altimetrico, Analisi di contesto, Percorso su strada | — | not for the predesign; an elevation profile on the terrain grid could come later (open) |
| Save of drawings to *IT - Site Features* | — | not PV Predesign's business |

## 5. Still open

- The real `.axpo` of the user: confirm which of the causes of §2 applied (the import toasts now name each case).
- An elevation profile along a line on the terrain grid (the Geoportale has one on the Esri service): not asked.
- The Geoportale could warn before saving a project whose slope exclusion has no grid any more (cause 1): a
  request for the Geoportale session, if the user wants it.
