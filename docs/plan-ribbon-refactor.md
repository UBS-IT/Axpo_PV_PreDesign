# Ribbon workspace — refactor plan (proposal, 2026-10-10)

A proposal, not a decision: nothing of the app changes until the decisions of §3 are taken. Written from the UI
design session's hand-over (`APP UI-UX DESIGN/design-system/HANDOFF.md`, `project/README.md`, `project/tokens.json`,
the kit `project/components/bundle.css`, the content model `sources/src/app.js`), the reference mockup
`pv-predesign-mockup.html`, a second concept (`pv-design-studio`, a left workflow sidebar instead of tabs) and the
app on `main` at `a74ebfa` plus the open branch `ux/dimensions`.

## 1. What the mockup proposes, against the app today

| | App today (`main`) | Mockup (ribbon workspace) |
|---|---|---|
| Shell | top bar 44 px; left rail 92 px (stepper, 5 steps); side panel 372 px; map | top bar 44 · tab strip 36 · ribbon 92 · map · status bar 24; two panels float over the map (Layers 236 px left, Properties 300 px right, collapsible) |
| Workflow | 5 steps: Site, Terrain, Layout, Infrastructure, Outputs | 5 tabs: Site & Building Area, Terrain Analysis, Layout & Infrastructure (steps 3 + 4 merged), Electrical Design (concept), Report |
| Where the actions are | inside each step's panel (buttons, chips, cards) | in the ribbon of the tab (groups of large / small tools); the Properties panel keeps parameters, ledgers, KPIs, notices |
| Top bar | New · Open · Save · Save as · Import · ⚡ Quick predesign · CRS badge · theme | brand · project name · version chip · ⚡ Quick predesign · CRS badge · save state · theme · avatar (the user asks to drop Import and Quick here and use icons) |
| Objects of the site | the Collection drawer on the right (PR 21) | the Layers panel on the left, grouped by tab, with visibility toggles for every layer, computed ones included |
| Map controls | zoom, north, Tools menu (support switches, measure, dimensions) bottom left, scale bar bottom centre, 2D / 3D top right, basemap + opacity bottom right | zoom, home, north, measure, dimensions in a column on the left; search top centre; 2D / 3D top right; basemap + opacity bottom left; scale bottom centre; attribution bottom right; legend |
| Status bar | none | coordinates E / N in the chosen CRS, CRS select, scale, elevation and slope under the pointer, mode, snapping state, autosave |
| Figures | KPIs and ledgers in the panels (PR 20) | the same ledgers and KPIs in the Properties panel, plus one key figure per tab in the ribbon context and on the tab |
| Tokens | `--site --excl --ref --area --on-accent --font` + the shared ones | the same names plus the renames `cat-gross cat-exclusion cat-reference cat-net`, the other `cat-*`, `on-brand on-ok focus table-edge road fence slope-1…5 slope-cut slope-cut-soft map-chrome on-map`, the spacing / radius / shadow scales |
| Icons | emoji and glyphs in labels (⚡ ⬆ ⬇ ✎ ⬠ × ↶ ↷ ☾ ⓘ) and 5 inline SVGs in the rail | 84 line icons on a 24 px grid (`assets/Icons`), none in text |
| Narrow screens | under 760 px: rail at the bottom, panel full width, no 3D | not designed (1920 and 1366 only) |

The second concept (`pv-design-studio`) keeps a **left workflow sidebar** (the steps as a vertical rail, like today
and like the Geoportale) with the same ribbon, Layers and Properties panels. It is the cheaper shell: no tab strip,
`ui/rail.js` survives almost as it is.

## 2. What changes in the logic, not only in the front-end

1. **Steps 3 and 4 merge into one tab.** Today `field.js` and `infra.js` are two panels with two state providers
   and two key figures (MWp, fence length). One tab means one state (done when both are done, the figure is the
   MWp) and one Properties panel that shows the layout parameters or the infrastructure ones according to the
   armed ribbon group. The two modules stay separate; only the panel and the rail change.
2. **Actions leave the panels.** Import, the drawing tools, Analyse the slopes, Use my own model, Generate /
   Optimise, Quick predesign, the station buttons, the export buttons: today they live in the step panels, with
   their messages at the control (audit of 2026-10-02). In the ribbon they are tools; their outcome must still
   appear next to something: the Properties panel keeps the status lines and notices.
3. **Drawing.** The ribbon of the mockup offers per-category tools (Draw site boundary, Exclusion zones, Cadastral
   parcels). The app draws in two steps (① category chips, ② tool cards), the pattern ported from the Geoportale
   because its own user tests had replaced per-category buttons. A hybrid keeps both: a ribbon group "Draw" with
   the category chips and the four tool cards (the same block, moved), plus two large shortcuts for the boundary and
   the exclusions that pre-select the chip.
4. **Layers with visibility.** Today every computed layer (tables, buildable area, fences, roads, stations, slope
   image) is always on except the terrain image. The Layers panel adds a visibility switch per layer: new state,
   not in the project (a view preference, remembered in the browser like the basemap opacity).
5. **Status bar.** Coordinates under the pointer in the chosen CRS (a projection on `pointer-move`, throttled),
   the CRS select (moves from the top-bar badge), the scale, the mode and the snapping state exist or are cheap.
   Elevation and slope under the pointer need the terrain grid in memory (`terrain/store.js`): cheap when a grid is
   loaded, "—" otherwise.
6. **New functions in the mockup that the app does not have.** Listed in §4 with a recommendation each. None of
   them is needed for the shell.
7. **Tab 4 Electrical Design.** CLAUDE.md rule 6 leaves the electrical design open; the decision of 2026-10-02
   took the placeholders out of the product. A tab that only shows a gate is a placeholder again.

## 3. Decisions to take (each with the options and a recommendation)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | The shell | **A** tabs + ribbon (mockup) · **B** left workflow sidebar + ribbon (studio concept) | **A**: it is what the design system was built for (Tabs, Ribbon, Workspace pages), it frees the whole width for two panels, and the tab strip carries the step states as the rail does. B costs 36 px less and keeps `rail.js`, but the system has no component for it |
| D2 | Top bar | which items: New / Open / Save / Save as as icon buttons · project name editable · version chip · CRS badge · save state · theme · help · avatar | New · Open · Save · Save as as icons (`file-plus folder file export`… from the set) with tooltips, the project name, the save state ("Saved 14:32" from the autosave), theme, help. **Import leaves** (ribbon tab 1). **Quick predesign leaves the top bar** as asked: it stays the primary large tool of tab 3 and the suggestion row of tab 1; the one-click promise survives, one click further. The CRS badge moves to the status bar (D7); the version chip and the avatar wait for a project history and a login that do not exist |
| D3 | Tab 4 Electrical Design | **A** no tab until there is content (4 tabs) · **B** the tab, locked, with a gate "not part of the predesign yet" · **C** the concept of the mockup with placeholder values | **A**. The shell is built for five; the fifth appears with the first real function (stations sizing from the layout, the cable route). B and C put a placeholder back in the product |
| D4 | Drawing in the ribbon | **A** per-category large tools · **B** the two-step block moved into a ribbon group · **C** hybrid: the block in the ribbon plus two shortcuts (boundary, exclusions) | **C** |
| D5 | Where the figures live | KPIs and ledgers in the Properties panel (as today's panels), one key figure in the ribbon context and on the tab | as the mockup; no change of the ledgers of PR 20 |
| D6 | Layers panel | **A** the Collection as it is, moved left · **B** the Collection plus visibility switches for the computed layers, grouped by tab | **B**, in a later phase: the switches are a view state, cheap, and the mockup's main gain for the map |
| D7 | Status bar | which items now: coordinates E / N · CRS select · scale · mode · snapping · autosave; later: elevation · slope under the pointer | the first six now (all exist or are cheap); elevation and slope when the terrain grid is loaded, "—" otherwise, in the same phase if time allows |
| D8 | Search (top centre) | **A** none · **B** objects of the project only · **C** B + places (Esri World Geocoding, credits / key) · **D** C + cadastral parcels (the Geoportale's job) | **B** now; C when the Esri credentials question of the release gates is settled; D never here |
| D9 | Map controls | the Tools menu of PR 26 becomes the control column: measure and dimensions as map buttons; the three support switches (snapping, typed, labels) move to the status bar ("Snapping on" is a toggle there) or stay in a small menu | measure and dimensions as buttons; snapping as a status-bar toggle; typed measures and labels in the Properties panel of 1 · Site under the drawing block |
| D10 | Narrow screens | **A** keep today's narrow layout under 760 px (rail at the bottom) · **B** the ribbon collapses to icons under 1024 px and the app is desktop-only below 760 (a message) | **B**: the ribbon workspace is a desktop tool; 3D is already off under 760 px; a second layout for phones is work nobody asked for. Icon-only ribbon under 1500 px as the README says |
| D11 | Fonts | **A** Open Sans from Google Fonts · **B** vendor the woff2 in `app/vendor` · **C** system stack only | **C** now (company proxies block CDNs, decision of 2026-09-28; `Segoe UI` is on every Windows PC), **B** if the brand wants Open Sans everywhere |
| D12 | Migration | **A** one long-lived branch, merged at the end · **B** phases merged into `main` one by one, the app working after each | **B**: `main` has no production users yet (pilot candidate), each phase is reviewable, and a phase can be reverted alone |
| D13 | The Geoportale | the two apps stop sharing the left-rail shell; they keep the drawing block, the site-features symbology, the names of the panels (Layers ≈ Raccolta) | accept: different products, same users; the shared parts are the model and the drawing gestures, not the chrome |

### Decisions taken on 2026-10-10

The user approved the recommendations as they stand: D1 **A** (tabs + ribbon), D2 as recommended (icons for New /
Open / Save / Save as, Import and Quick predesign out of the top bar, the CRS badge to the status bar), D3 **A** (no
tab 4 until there is content), D4 **C** (hybrid drawing), D5 as the mockup, D6 **B** (in phase 3), D7 the six items
now and elevation / slope when the grid is loaded, D8 **B** (project objects), D9 as recommended, D10 **B**
(desktop tool; icon-only ribbon under 1500 px, a message under 760 px), D11 **C** (system font stack), D12 **B**
(phases into `main`), D13 accepted. The kit (`bundle.css`) enters with the shell (phase 1), not in phase 0: its
class names overlap the app's (`.btn .tb .kpi .ledger .sec .status .toast …`) and loading both would change the look
before the layout. Phase 0 is tokens, variable names and icons only.

## 4. Functions of the mockup that the app does not have

| Tab | Function in the mockup | Status | Recommendation |
|---|---|---|---|
| 1 | Cadastral parcels (draw / list) | not in the app; parcels arrive as reference objects from a `.axpo` | no: the Geoportale's job (cadastre, AdE); keep the reference category |
| 1 | Setbacks / buffers as a tool | exists as the setback input and per-object buffers | ribbon tool that opens the Properties section; no new logic |
| 1 | Area statistics | exists as the buildable-area ledger | the ledger is the statistics; a ribbon tool that scrolls to it, no new logic |
| 2 | Aspect, Hillshade | the hill-shaded elevations exist as the terrain image; aspect does not | hillshade: a chip of the image (exists); aspect: later, cheap (same grid, Horn gradient) |
| 2 | Contours | not in the app (listed in "Not done yet") | later: marching squares on the grid, 2 m step; export to DXF; a day |
| 2 | Flood / hydro risk | not in the app, no data source | no, until a hazard layer is chosen (PGRA is Italian and not CORS-friendly) |
| 2 | Suitability map | not in the app | no: it is what the slope cut and the exclusions already do; a "map" of it is the buildable area |
| 3 | Substation, cable routes as tools | the grid connection route exists as a category; the substation is the delivery / user station | ribbon tools that arm the existing categories; no new logic |
| 3 | Target capacity | exists (advanced option) | a small ribbon tool that opens the field |
| 4 | everything | out of scope (rule 6) | D3 |
| 5 | Energy yield summary | the typed specific yield and the annual energy exist | the KPI; no new logic until the yield API |
| 5 | Bill of materials | the Excel bill of quantities exists | the same button, renamed consistently |
| 5 | Map sheet (A1, 1:5,000, visible layers) | not in the app; the PDF report is one A4 landscape page | later: a second PDF page at a chosen scale with the basemap needs the Esri print service or a canvas capture; a day or two; ask Engineering first |
| 5 | Report contents (checkboxes) | not in the app | later, cheap: sections on / off in the one-page report |
| — | Search | D8 | the objects of the project in phase 5 (Ctrl K); addresses through Nominatim and coordinates, asked by the user |
| — | Elevation / slope under the pointer | D7 | |

## 5. Phases (each one a branch and a PR into `main`, the app working after each)

| Phase | What | Files | Risk | Tests |
|---|---|---|---|---|
| **0 · Tokens and icons** (no layout change) | `design/tokens.json` copied from the design system into the repo and `app/css/tokens.css` generated from it by `scripts/make_tokens.py` (light `:root`, dark by `[data-theme=dark]` and by `prefers-color-scheme`, as `app.css` does today; the CI checks the two match, like the toolkit); the variables of `app.css` and of the modules renamed to the token names (`--site → --cat-gross` …) with aliases kept for one phase; the 84 icons as an inline sprite `app/icons.svg` loaded once by `ui/icons.js`, with `data-icon` on buttons that `applyI18n` renders and an `icon()` helper for labels built in JS; every emoji / glyph in labels replaced by an icon | `app.css`, `index.html`, `i18n.js`, the modules that write glyphs (`areas.js collection.js maptools.js terrain.js field.js output.js …`), new `design/tokens.json`, `app/css/tokens.css`, `app/icons.svg`, `ui/icons.js`, `scripts/make_tokens.py`, `.github/workflows/tests.yml` | low: the app looks the same, the names change; a missed variable shows as a wrong colour | every page green; a screenshot diff by eye |
| **1 · Shell** | the kit `bundle.css` as `app/css/kit.css` (its classes replace the app's own for buttons, fields, KPIs, ledgers, notices, toasts, dialogs); top bar (D2), tab strip from `rail.js` (states, figures, gates kept), ribbon with one group per tab holding the buttons that today sit at the top of each panel (Import; Analyse / Own model; Generate / Optimise / Quick; Stations; Exports), status bar (D7 first six), the step panels moved as they are into the floating Properties panel on the right, the Collection moved into the floating Layers panel on the left; steps 3 + 4 in one tab with the panel switching by group; map controls column (D9) | `index.html` (rewritten shell), `app.css`, `kit.css`, `ui/rail.js` → `ui/tabs.js`, `ui/ribbon.js` (new), `ui/statusbar.js` (new), `ui/collection.js` → `ui/layers.js`, `main.js`; the panels' ids stay so `areas.js field.js infra.js terrain.js output.js` change little; `tests/ui.test.js` mounts the new shell | **high**: everything moves; the tests that read ids keep working, the ones that read the rail need the tabs | `ui.html`, `scene3d.html`, a manual pass of every step at 1366 × 768 and 1920 × 1080, light and dark |
| **2 · Ribbon tools** | the actions of the panels become ribbon tools by group (D4 drawing block in the ribbon; the Properties panel keeps parameters, ledgers, notices); one key figure per tab in the ribbon context | `ui/ribbon.js`, the five step modules (their buttons move), `i18n.js` | medium: every action has a new place; the outcome lines must stay at a control | `ui.html` (its clicks move to the ribbon), manual pass |
| **2B · Selection and editing** (added on 2026-10-11) | Select and Box on the map and from the Layers rows; the ribbon's Category, Type and Buffer act on the selection; Reshape, Move / rotate, Split, Merge, Copy, Delete; the Selected object card; the Layers panel reduced to groups, rows and zoom | `areas.js`, new `edit.js`, `index.html`, `i18n.js` | medium | `ui.html` (a new test), manual pass |
| **3 · Layers** | visibility switches per computed layer, grouped by tab, remembered in the browser (D6); legend of the slope classes in the panel | `ui/layers.js`, the modules that own layers expose show / hide | low | `ui.html` |
| **4 · Status bar, part two** | elevation and slope under the pointer from the loaded grid; CRS select wired to `output.js` | `ui/statusbar.js`, `terrain/store.js` | low | `terrain.html` |
| **5 · New functions** | only the ones decided in §4 (search of project objects first) | per function | per function | per function |
| **6 · Docs and tests** | README (screenshots, the workflow section), `docs/architecture.md` (the shell table), `decisions.md`, the headless suite, the handoff | docs | — | CI |

Order of work: 0, 1, 2 are the refactor; 3 and 4 complete the mockup; 5 is product work. Phase 0 can start at once;
phase 1 needs D1, D2, D3, D7, D9, D10 decided; phase 2 needs D4, D5.

Estimate, in sessions of work: 0 = 1 · 1 = 3 · 2 = 2 · 3 = 1 · 4 = 1 · 6 = 1, before the functions of §4.

Progress: phase 0 merged (PR 29); phase 1 split in three PRs — 1A the shell (PR 30), 1B the status bar, the docked
panels and the map controls column in place of the Tools menu (PR 31), 1C the kit `bundle.css` as `app/css/kit.css`
(PR 32). Phase 2, the ribbon tools with the category menu and Unclassified objects, then its part A (Category and Type
in line, Circle, Freehand, Buffer, the Site panel with its figures only): PR 34. Phase 2B, selection and editing: PR 35 (the
3D scene test fixed in PR 36). Phase 3, the Layers panel as the design system's LayerList with a visibility switch
and a figure per layer (decisions F1–F9): PR 38. Phase 4, the elevation and slope under the pointer in the status
bar (G1–G7; the CRS select was already wired in 1B): PR 39. Phase 5 (H1–H8): the search of the objects of the
project (Ctrl K), and as asked by the user an address / coordinates search and *Zoom to* on a right click in Layers:
the branch `ux/search`, PR after 39. The other functions of §4 wait, each with its decisions. Next: phase 6, docs
and tests.

## 6. Rollback and safety

- Every phase is one PR; reverting a phase is reverting its merge commit on `main` (a PR of its own).
- The project file (`.pvpd`) and the `.axpo` import do not change in phases 0–4: a project saved before the
  refactor opens after it.
- The test pages keep mounting `app/index.html`, so a shell change that breaks a panel fails the CI before a merge.
- Phase 0 keeps a copy of the old variable names for one phase (`--site: var(--cat-gross)` …) so that a missed
  selector does not lose its colour; removed in phase 2.

## 7. Out of scope of this plan

The Geoportale (its own shell stays), the electrical design, the yield API, the hosting and the login (the avatar
of the mockup), phones.
