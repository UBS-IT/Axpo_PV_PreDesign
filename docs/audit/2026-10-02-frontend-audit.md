# Frontend audit — 2026-10-02

Scope: `app/` on `main` (`d2a0862`). Method: code reading of every module, automated cross-checks (i18n keys
vs. use, DOM ids vs. JS, WCAG contrast of the palette), the headless test suite (115 tests on 9 pages, all green on 2026-10-02), and the
two problems reported from the user tests (P1 Terrain panel, P2 drawing tools). The reference Geoportale
(`UBS-IT/custom-AGOL-web-map`) could not be read from this session: alignment items are marked **[needs Geoportale]**.

Severity: **S1** blocks or misleads users · **S2** costs clicks or trust · **S3** polish. Refs are `file:line`.

## 1. Bugs and logic issues

| # | Sev | Finding | Where |
|---|---|---|---|
| L1 | S1 | **Terrain works before its prerequisite exists.** The panel never checks `siteFrame()`: its buttons are active with no site and the click ends in an error toast. The slope-limit card shows the rule of `field.structure` (default `3V9`) before any structure was chosen, so a new user reads "3V9: 10 % N-S and E-W" without knowing where 3V9 comes from. Root cause of P1. | `terrain/terrain.js:150, 261-283` |
| L2 | S1 | **The app reopens on the last step visited**, including `terrain`, `3d` and the `electrical` placeholder. A colleague who closed the browser on 4b lands on a black 3D panel; on 0 with no site, on a panel that only says "No terrain yet". Reopening on `3d` also starts the SceneView at load. | `ui/rail.js:17-19`, `view3d/scene.js initView3d` |
| L3 | S2 | **Quick predesign overrides the perimeter-road decision**: it sets `infra.perimeterRoad` to `true`, then `false` for plants over the template size, even when the designer had decided; the "not decided" state (`null`) that drives the suggestion UI is lost. | `quick.js:226-233` |
| L4 | S2 | **Deleting is immediate and irreversible** for one object (×), with a native confirm for "Remove all", "New project" and "Remove the terrain"; no undo anywhere. Inconsistent and against Nielsen #3 (user control). | `areas.js:275, 281`, `main.js:75`, `terrain/terrain.js:295` |
| L5 | S2 | **Terrain goes stale silently.** Changing the grid cell or the site needs a new sampling ("Load the terrain again…" is in a hint only); the panel flags only the case where the site grew beyond the grid. | `terrain/terrain.js:228-236, 70` |
| L6 | S3 | `syncInputs()` writes `field.moduleId` as a side effect of rendering, without `emit`. Harmless today (a regeneration always follows) but a trap for the next change. | `field.js:129-132` |
| L7 | S3 | Two `countryName()` with different fallbacks (`'unknown'` vs `''`). | `crs.js:92`, `catalog.js:41` |
| L8 | S3 | Dead UI string `field.rotation`; i18n otherwise complete (0 missing keys, every DOM id used). | `i18n.js:510` |
| L9 | S3 | `loadTerrain` returns silently while busy; a second click gives no feedback. | `terrain/terrain.js:148` |

## 2. Workflow and information architecture (P1)

**What Terrain really does** (from the code): it samples an elevation grid over the gross/net areas (Esri World
Elevation, or a GeoTIFF of the user), draws a slope map, and cuts from the buildable area the cells over the slope
limit **of the structure chosen in step 2** (`currentSlopeRule()`). It is therefore an *analysis of the drawn site*
with an *optional import* of a better model — both hypotheses of P1 are true — and it depends on **two** other steps
(1 Areas for the extent, 2 Fields for the limit), yet it sits first, numbered 0, titled "Elevation model and slopes".

Real flow in the code vs. the hypothesis of §3.3:

```
hypothesis: Site → gross → constraints → net → terrain → layout → report
code:       1 Areas (gross | net given; constraints with buffers → buildable)
            ↘ 0 Terrain (grid over the site; cut by the slope limit of the structure of step 2) ↗
            2 Fields (technology/structure/module/pitch → tables → MWp); Quick predesign = 1 → 2 (+ terrain) in one click
            3 Infrastructure (fence, clearance band, road, stations → cut back into buildable → layout regenerates)
            4 Output (CRS, exports, report) · 4b 3D (view only) · Electrical (placeholder)
```

Consequences seen by users: step "0" reads as "do this first"; the subtitle talks about data, not about the question
("is the site too steep for 3V9?"); nothing says what is done and what is next (no stepper state, only a count badge
on Areas); placeholders (contours "next", electrical "later") occupy space in the rail and the panels.

**Proposal (to validate, see questions):**

1. Rename and reorder the rail, numbered from 1, in the order of the real dependencies:
   `1 Site` (boundary, constraints, net area) → `2 Terrain & slopes` (optional) → `3 Layout` → `4 Infrastructure`
   → `5 Outputs`. 3D becomes a **2D / 3D toggle on the map**, not a step. Electrical leaves the rail (one line in
   Outputs: "electrical design: not part of the predesign").
2. **Stepper states** on the rail: *locked* (prerequisite missing: shows why and a link, still openable), *ready*,
   *done* (tick + key figure: "12.4 ha buildable", "24.0 MWp"). Nothing blocks: a designer can work in any order.
3. **Terrain panel**: empty state = "Draw or import the site first → 1 · Site"; with a site: one primary action
   "Analyse slopes (Esri World Elevation)" and a secondary "Use my own model (GeoTIFF)"; the slope-limit card names
   the technology it applies to, with the group standard as default and a selector tied to Layout; a *stale* badge
   when the site or the cell changed after sampling; the cut shown as "− 1.2 ha over 10 %" in the Site summary too.
4. Reopen the app on the **first incomplete step** (site missing → 1), never on 3D or a placeholder.

## 3. Drawing tools (P2)

Today (`areas.js:393-440`): each of the nine category cards carries its own Polygon / Line / Point / Import
buttons — up to 31 small buttons (≈ 23 px high) in the panel. The designer must pick the category **before**
drawing (decision before action), finish with double-click, cancel everything with Esc (no "remove last vertex"),
reshape through a ✎ in the row, rename by **double-click on the name** (hidden), move through drag or a select.
No keyboard shortcuts except Ctrl+S / Ctrl+O. The map banner is the only mode indicator.

**Direction (to align with the Geoportale — [needs Geoportale]):** one drawing toolbar for the Site step
(polygon, line, point, select/edit, delete, undo vertex, finish) with the same icons, names and shortcuts as the
Geoportale; the category is the *active chip* above the map (default: the category whose card is open), changeable
after drawing; `Enter` finishes, `Backspace` removes the last vertex, `Esc` cancels; rename through the ✎ menu;
one gesture per element in the list (click = zoom); touch-safe (no dblclick / drag-only actions).

## 4. Heuristics and interaction (Nielsen, Hick, Fitts)

| # | Sev | Finding | Where |
|---|---|---|---|
| U1 | S2 | **Visibility of status**: no done/next state across steps; the only result card is inside 2 · Fields; Outputs has no summary of what will be exported. | `index.html` rail, `field.js renderResults` |
| U2 | S2 | **Progressive disclosure missing in Fields**: ~20 controls at one level (gaps, offsets, tracks, half tables, target, period) next to the three that matter (technology, structure, pitch). The module library (a management task) sits inside the design step. | `index.html:112-208` |
| U3 | S2 | **System language**: structure typed as `3V9` in a free text field with "Write it as modules across, V or H, modules along"; "GCR", "EPSG:6707" badge in the top bar; "Buildable area" vs "Net area" vs "usable land" used for close concepts. | `field.js:163-172`, `i18n.js` |
| U4 | S2 | **Toasts carry outcomes** (import summary, CRS chosen, errors) and vanish in 6–12 s; errors of an action (no site, no module) are not shown at the control. | `ui/toast.js`, callers |
| U5 | S3 | Three entry points to import (top bar, Site button, per category) with two labels ("Import…", "Import files…"). Fine as redundancy, needs one name. | `index.html:22, 98`, `areas.js:405` |
| U6 | S3 | Quick predesign appears three times (top bar, Areas, Fields); keep one primary place plus the top bar. | `index.html:23, 99, 114` |
| U7 | S3 | Placeholders in the product ("next", "later" pills) — show what works; keep the roadmap in `docs/plan.md`. | `index.html:89-92, 259-262, 304-311` |
| U8 | S3 | Station buttons are disabled without explanation when the country has no toolkit building; the reason is a hint at the bottom (and only for CT). | `infra.js:470-474` |

## 5. WCAG 2.2 AA

| # | Criterion | Finding | Measured |
|---|---|---|---|
| A1 | 1.4.3 Contrast | Primary buttons and active draw buttons: white on `--accent #1F99CC` → **3.24:1**; dark theme white on `#4EBEEF` → **2.11:1**. Accent text (links, rail active) on white **3.24:1**. `.pill.ok` green text **2.39:1**, `--warn` **2.45:1** if ever used as text. | `app.css:5, 15-21, 176, 110` |
| A2 | 2.4.7 Focus visible | `#projName:focus { outline: none }` removes the focus ring; buttons rely on the browser default (fine in Chromium, inconsistent across browsers); only inputs/selects have a designed ring. | `app.css:35, 171` |
| A3 | 2.5.8 Target size (min 24 px) | Row icon buttons `.x` ≈ 19 × 23 px; `.drawbtn` ≈ 23 px high; `.linkbtn` inline text. | `app.css:200-201, 118-121` |
| A4 | 1.4.4 / readability | Rail labels 10.5 px, form labels 11 px uppercase, hints 11.5 px. Not a failure, but small for a field tool on laptops. | `app.css:49, 165, 185` |
| A5 | 2.1.1 Keyboard | Drawing, placing and editing need the mouse (SketchViewModel); rename only by double-click; rows reorder only by drag (a select exists as fallback: good). | `areas.js:302, 430` |
| A6 | 4.1.3 Status messages | Toasts have `aria-live="polite"`; errors should be `assertive` or inline. | `index.html:318` |
| A7 | 3.2.6 Consistent help | No help entry point; the only guidance is in hints and tooltips. | — |

Palette fix that keeps the Axpo look: accent for text and primary buttons ≥ 4.5:1 (e.g. `#1A7FAB` on white
= 4.6:1; dark theme accent used as a fill with dark text, or `#2A9CD6` text on `#18232E` = 6.7:1), focus ring
`2px solid` accent + 2 px offset on every control, 24 px minimum hit areas.

## 6. Consistency with the Geoportale **[needs Geoportale]**

The stylesheet already borrows the Geoportale tokens (gradient, light/dark, `.sec` collapsibles). What cannot be
checked without reading `geoportale_axpo.html`: the drawing toolbar (tools, icons, shortcuts, finish/cancel
gestures), the layer list and visibility pattern, the import dialog, the attribute editing of site features, the
basemap control, how 2D/3D (if any) is switched, and the naming of the site-features categories in the UI.

## 7. Good things to keep

Single state with autosave and project files; parametric regeneration on every change; true-metre frame; toolkit
values with sources and "missing" instead of invented; quick predesign; site-features model shared with the
Geoportale; mode banner over the map; tests on every push, including the real SceneView.

## 8. Questions before the refactor (end of phase 1)

1. **Access**: this session cannot read `UBS-IT/custom-AGOL-web-map` nor `UBS-IT/Axpo_PV_PreDesign` (access denied),
   and `git push` to `davo3188/Axpo_PV_PreDesign` now answers 403. Options: grant the session access to the two
   UBS-IT repositories, or start a new session with `UBS-IT/Axpo_PV_PreDesign` as its source (the same-name checkout
   limit prevents attaching it here), or paste `README.md` and `geoportale_axpo.html` of the Geoportale.
2. **Terrain placement**: step 2 "Terrain & slopes" between Site and Layout (proposal), or a card inside Site?
3. **3D**: a 2D/3D toggle on the map (proposal) or keep it as a step?
4. **Stepper**: locked steps openable with an explanation (proposal) or hidden until ready?
5. **Drawing**: category chosen before drawing (today) or after (chip / dialog, as proposed)? Which gestures and
   shortcuts does the Geoportale use? (polygon, line, point, edit, delete, finish, undo vertex)
6. **Structure selection**: a list of toolkit presets with a "custom nVm" escape, or keep the free text?
7. **Deletions**: undo via toast ("Removed Exclusion 3 · Undo") instead of confirms — acceptable?
8. **Palette**: may the accent darken to reach 4.5:1 on white (`#1A7FAB`), or must the Geoportale accent stay?
