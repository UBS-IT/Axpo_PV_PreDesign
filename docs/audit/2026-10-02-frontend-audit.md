# Frontend audit — 2026-10-02

Scope: `app/` on `main` (`d2a0862`). Method: code reading of every module, automated cross-checks (i18n keys
vs. use, DOM ids vs. JS, WCAG contrast of the palette), the headless test suite (115 tests on 9 pages, all green on 2026-10-02), and the
two problems reported from the user tests (P1 Terrain panel, P2 drawing tools), and a reading of the reference
Geoportale (`UBS-IT/custom-AGOL-web-map`, `dbf5198`, its `README.md` and the *Disegna* tab of `geoportale_axpo.html`).

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

**What the Geoportale does** (its *Disegna* tab, refactored from its own user tests on 2026-10-01): two numbered
steps in one panel — **① Cosa disegni**: the category as a row of coloured chips (`role=radiogroup`, one active,
remembered), then only the type and attributes that apply, the source and a note; **② Con quale strumento**: five
tool cards (Punto, Linea, Area, Rettangolo, Cerchio — icon, name and the gesture in one line, `aria-pressed`,
disabled with the reason when the category does not take that geometry); the armed tool stays armed after each
drawing, a second click disarms it, Esc ends; ↶ ↷ undo/redo (Ctrl+Z / Ctrl+Y, 40 steps) in the header of step ②;
a status line under the cards (`role=status`: "Disegnato · Esclusione · Vincolo. Continua o cambia strumento.");
an **Ultimo disegno** box (category tag, name, zoom, ×) answering "where did it go"; a sticky **Supporto al
disegno** dock (snapping, typed lengths and angles with Tab, metric grid); a small mode banner on the top edge
of the map; drawings clicked on the map with no tool move and reshape, Delete removes; a sketch interrupted by
another tool is completed, not dropped. Keyboard shortcuts: Ctrl+S/O, Ctrl+Z/Y only; letters are not used.

**Direction:** port that pattern into step 1 of PV Predesign, with the same names, icons and gestures: the nine
category cards become one **① What you draw** block (chips + type/attributes of the active category), one
**② With which tool** block (Point, Line, Area, Rectangle; the circle has no use here), the armed tool stays
armed, ↶ ↷ with Ctrl+Z/Y, status line, *Last drawing* box, the list of objects grouped by category below (the
Geoportale keeps it in the Raccolta drawer; here the panel is the only home, so the list stays in the step).
Rename moves from the hidden double-click to the ✎ of the row; one gesture per element (click = zoom); import
stays one button plus drop. Not ported: rectangles/circles with exact measures and the metric grid (no use in a
predesign; the layout engine makes the geometry), the working-site row (the site is the project).

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

## 6. Consistency with the Geoportale

The stylesheet already shares the tokens (gradient, light/dark, `.sec` collapsibles ≈ `.imod`). Patterns of the
Geoportale worth porting, and what they replace here:

| Geoportale (validated with users) | PV Predesign today | Port |
|---|---|---|
| Numbered steps inside a panel (`.gpstep` ①②③), each card stating its own condition and disabled with the reason until the previous step fits | Flat cards; prerequisites invisible (Terrain) | Yes: Site ①②, Terrain, Layout (basic ① / advanced ②) |
| Category chips + tool cards (§3) | Per-category draw buttons | Yes |
| Status line `role=status` under the action, with a coloured dot, and "Vedi nella Raccolta ›" | Toasts | Yes: outcomes at the control, toasts only for background events |
| `i` buttons per module opening a "how it works" window with a drawn example | Hints in grey text | Yes, for Terrain, Layout, Infrastructure |
| Filled buttons: white on `--accent-strong #3945CF` (7.2:1); accent texts use `--link`; dark theme: dark text on the accent | White on `--accent` (3.2:1) | Yes, same tokens, no palette change |
| Mode banner small on the top edge of the map, `role=status` | Centred box | Yes |
| Rail: `role=tablist`/`tab`, roving tabindex, arrows/Home/End; `aria-expanded` on drawers | Buttons without roles | Yes |
| Undo/redo of drawings (own history, Ctrl+Z/Y); × with "↶ Annulla" | No undo | Yes |
| Raccolta drawer (noun) separate from Disegna (verb); Tools speed-dial; 🗺 map selector | — | No: one panel per step is enough here; the map toggle 2D/3D is the only "map selector" |
| Save/open project, Ctrl+S/O, name in the top bar | Same | Already aligned |

Names of the categories in the UI: the Geoportale uses the Italian labels of the shared model (Area lorda, Area
netta, Percorso di connessione, Esclusione, Infrastruttura lineare, Ostacolo, Accesso e punto di connessione,
Mitigazione, Zona agricola, Nota e riferimento); PV Predesign the English ones (`cat.*`). Same order, same colours.

## 7. Good things to keep

Single state with autosave and project files; parametric regeneration on every change; true-metre frame; toolkit
values with sources and "missing" instead of invented; quick predesign; site-features model shared with the
Geoportale; mode banner over the map; tests on every push, including the real SceneView.

## 8. Questions before the refactor (end of phase 1)

1. **Terrain placement**: step 2 "Terrain & slopes" between Site and Layout (proposal), or a card inside Site?
2. **3D**: a 2D/3D toggle on the map (proposal) or keep it as a step?
3. **Stepper**: locked steps openable with an explanation (proposal) or hidden until ready?
4. **Drawing**: port the Geoportale's two-step *Disegna* (category chips, then tool cards; §3) as it is — confirm.
5. **Structure selection**: a list of toolkit presets with a "custom nVm" escape, or keep the free text?
6. **Deletions**: undo via ↶ and a toast ("Removed Exclusion 3 · Undo") instead of confirms — confirm.
7. **Palette**: the Geoportale solved the same contrast failures with its own tokens (`--accent-strong` for filled
   buttons, `--link` for accent texts) — adopt the same, no new colour. Confirm.
8. **Repository**: the GitHub repository now lives at `UBS-IT/Axpo_PV_PreDesign` (`davo3188/…` redirects there);
   this session can push through the old URL only. `origin` stays on the old URL until a session is opened on the
   organisation repository.
