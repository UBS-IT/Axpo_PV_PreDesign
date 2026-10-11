# Handoff — session on the user's computer, 2026-10-11

Written on 2026-10-11 by the session that worked on the user's PC (clone `Axpo_PV_PreDesign-git`), after the note
`2026-10-10-pc-session.md`, which keeps the history of phases 0–1 and the older traps (§5 there). Read `CLAUDE.md`
first; `docs/plan-ribbon-refactor.md` is the plan being executed and `docs/decisions.md` holds every dated decision.

## 1. Where the repository stands

- `main` = `fb8b854`, merge of PR #35. Merged on 2026-10-11, in this order:
  - **#34 `ux/ribbon-tools`**: phase 2 (the actions of the panels in the ribbon) and its part A;
  - **#36 `ci/runner-progress`**: the 3D scene test back to its 900 × 560 box, the headless runner that says where a
    page stopped, the runner scripts working on Windows (§3);
  - **#35 `ux/select-edit`**: phase 2B, selection and editing.
- Later the same day: **#37 `docs/handoff-2b`** (this note) merged, `main` = `3e058cc`; then phase 3 on the branch
  **`ux/layers`** (one commit and a merge of `main`), its PR after #37 (§7).
- When this note was first written the clone was on `main`, no local branch left. On GitHub only `main` and `claude/elegant-pascal-pu0yal` (the cloud
  session of 2026-10-09, PRs #15 and #16, merged; left to the user to delete).
- The CI (`browser-tests`) is expected green on `main`: every page passed headless on this PC on the code of #36 and
  of #35 (§3). The user merges after a green check.

## 2. The ribbon refactor: where it is

| Phase | State | What it left in the code |
|---|---|---|
| 0 · Tokens and icons | merged (#29) | see the note of 2026-10-10 |
| 1A · Shell, 1B · Status bar and docked panels, 1C · Kit | merged (#30, #31, #32) | see the note of 2026-10-10 |
| 2 · Ribbon tools, with part A | merged (#34) | Site area: *Site definition* = **Category** menu (`ui/catmenu.js`, colour dots, Unclassified first and default) and **Type** menu in line, five geometries (Area, Rectangle, Circle, Line, Point) with **Freehand** (`thinned()`, 0.5 m), Undo / Redo, **Buffer** and Height / Width (`renderValues()`), the two drawing-support boxes; *Constraints* = the setback. **Unclassified** objects (`UNCLASSIFIED`, app-only) count nowhere and are exported nowhere (`classified()`). Terrain: Remove, Slope classes / Elevations switches. Layout & Infrastructure: roads with Heavy / Light, At the access, Add module, Import roadmap. Report: the working files, the PDF alone on the right. A tool of tabs 1–3 reopens the Properties panel (`pvp:properties`). The Site panel only shows its figures |
| 2B · Selection and editing | merged (#35) | Site area, group *Selection*: **Select** (click, Shift+click, Esc, Delete) and **Box**; a click on a Layers row selects. With a selection the Category, Type and Buffer act on it (group tinted, «n selected»). **Reshape, Move / rotate, Split, Merge, Copy, Delete**, each off with its reason; every edit is one step of Undo. The **Selected object** card (name, voltage, size, source). `app/js/edit.js` does the geometry in the local frame. The **Layers panel** only lists the groups that hold objects (Unclassified first) with count and zoom, and the rows with zoom |
| 3 · Layers | branch `ux/layers`, PR after #37 | the Layers panel as the kit's LayerList: three groups in the order of the tabs (the active one open and marked), Hide all / Show all, a box, the kit's symbol, the name and a figure per row; the categories of Site area, the terrain image (= `terrain.showSlope`, its legend under it) and the cut, buildable area, tables, fences and gates, roads, stations, the Dimensions row with Remove all (F7 a). The switches are `app/js/ui/visibility.js` (a view preference in this browser, `pvp.layerVis`; never in the project or an export); the modules that draw a layer ask it and listen to it; the 3D model follows them (`KIND_3D`). §7 |
| 4 · Status bar, part two | branch `ux/statusbar-terrain`, PR after #38 | Elevation and Slope after the scale, only with a terrain grid in memory; the slope as the limit reads it (one figure, or N-S · E-W), red on the cut cells; `terrainAt()` in `terrain/terrain.js`, `exceeds()` in `terrain/slope.js`, the `pvp:view3d` event. §8 |
| 5 · New functions | merged (#40) | the search of the objects (Ctrl K, `ui/search.js`), an address or coordinates top right (`ui/geosearch.js`, Nominatim), Zoom to on a right click in Layers (`ui/layermenu.js`); the rest of plan §4 waits. §9 |
| 6 · Docs and tests | branch `ux/finish`, PR after #40 | old names out of the docs, CI red on uncaught browser errors, the 3D card without overlaps (Daylight inside it), messages bottom left with ×, the six geometries in a 2 × 3 grid with Freehand as a tool, the Ctrl K hint, `docs/design-feedback.md`, README pictures. §10 |

**Decided on 2026-10-11** (rows in `docs/decisions.md`): part A (A1–A4) from the user's layout («category e menu
devono essere in linea, sotto category c'è type…»); phase 2B (B1–B6) and the behaviour of Unclassified, all accepted
with the recommendations («ok su tutto»): no Array (no use case yet), a Merge, the Selected-object card as the one input
left in the Site panel. **Phase 3 starts the same way**: a numbered list of concrete decisions, answered item by item
before any code.

## 3. The red CI of 2026-10-11 and what fixed it

The branch of phase 2B came back red twice: `/tests/scene3d.html: timed out` (10 minutes), every other page green.
GitHub Copilot's «explain error» blamed the 20-minute job limit: wrong, the job was not cancelled; the 10-minute
limit of the page in `run.mjs` ran out. What it was, measured headless on this PC with the same runner and Chromium:

| Code | 3D scene test |
|---|---|
| before the refactor (`8d8172b`) | 60 s |
| `main` with phase 2 | 79 s |
| phase 2B | 77 s |
| with the fix of #36 | 62–64 s (the whole suite: 99 s) |

Since phase 1 the map stack takes its box from `shell.css`, which `tests/scene3d.html` does not load: the views filled
the window and the 3D canvas grew from 900 × 450 to 1280 × 640 (twice the pixels). The CI draws the scene with
software WebGL (no graphics card), so it needed about 10 minutes; the page showed «5 / 5 passed» just as the runner's
time ran out. Phase 2B was not the cause. The test page now gives `#mapStack` its 900 × 560 box.

The runner now prints a line a minute while a page runs and, on a timeout, the tests done, where the page stopped and
its last console messages.

## 4. How the user works (what changed since the previous note)

- The user switched the session model to Claude Opus 5.5 on 2026-10-11: commit trailers are now
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (follow the attribution the session is given).
- The user pastes CI logs and GitHub Copilot explanations: read the log itself before trusting the explanation.
- **Node.js is installed on this PC** (24.x): the headless suite runs locally, which is faster than asking for logs.
  Install it outside OneDrive (the packages are about 400 MB, Playwright's Chromium about 550 MB in
  `%LOCALAPPDATA%\ms-playwright`): a copy of the commit (`git archive <commit> | tar -x -C <folder>`), then in its
  `tools/headless` `npm ci`, `npx playwright install chromium`, `node build.mjs`, `node run.mjs`. In Git Bash set
  `MSYS_NO_PATHCONV=1`, otherwise `/tests/…` becomes a Windows path. Downloads need the user's yes; after use they
  were deleted on the user's request (the folder, `ms-playwright`, `npm-cache`).
- A `git push` can stop on **Git Credential Manager** (a GitHub sign-in to renew): the user signs in; the session
  never types credentials.

## 5. Traps found on 2026-10-11 (the older ones are in the note of 2026-10-10)

- **Test pages that mount the app's markup without `shell.css`** lose the boxes the layout gives (the map stack):
  give them a box in the page, as `tests/scene3d.html` does now. The CI pays for every pixel of the 3D scene.
- **`new URL(import.meta.url).pathname` is not a path on Windows** («/C:/…», spaces as `%20`): the runner scripts use
  `fileURLToPath`.
- **The SketchViewModel needs a pointer move before the first click** of a simulated drawing (a `hover` first), and a
  simulated drag does not drive its Move / rotate: the write-back was checked by moving the sketch graphics from a
  script. A person with a mouse is not affected.
- **Stored rings keep the orientation of their source** (GeoJSON counter-clockwise, the SDK clockwise): simplify
  before and after a cut, a union or an area, as `computeArea()` does, or the areas come out negative.
- **The yellow under the site in the test project is the terrain image**, not an object: a click there selects nothing.
- **A circle drawn by clicks is true on the ground** (radius 49.8 m for 50.1 m between the clicks, round within
  0.3 %); a radius typed in the tooltip was not verified.

## 6. Open work, in the order suggested

1. **Phases 3 to 5** merged (#38, #39, #40). **Phase 6** on `ux/finish` (§10): the user merges after a green check,
   then the cleanup. With it the ribbon refactor is complete.
2. Phases 4 to 6 of the plan, one PR each, each opened with its list of decisions.
3. The notes for the design session are in `docs/design-feedback.md` (icons drawn by the app, the tab tick, the CRS of
   the StatusBar, the search placeholder, no menu component); to be passed on.
4. Done in phase 6: the unused key `top.crsNone` and the old names in README and architecture.
5. Still open from the earlier notes: two lines in the Registro of `COORDINAMENTO.md` (AGOL Axpo workspace) for PR #15;
   the workbook trial with a referent of a country without values; the release gates of `CLAUDE.md` (P0 validation of
   `.pvpd` and IDs, P0 integrity of `terrain/grid.f32`, P1 CI failing on browser errors: the runner still only prints
   them); lots, roads between rows and fillets, elevation profile.
6. The clone inside OneDrive: moving it to `C:\dev` remains the recommendation; the user decides.

## 7. Phase 3, the Layers panel (added later on 2026-10-11)

Decisions F1–F9 accepted by the user («ok su tutto, F7 opzione a»); the row is in `docs/decisions.md`. What was
checked before the PR:

- **Test pages in the browser pane**: engine, modules, SDK, import, terrain, infrastructure, 3D view and `ui.html`
  (22 / 22, with a new test for the panel) passed. `scene3d.html` was not run here: the Claude window was hidden, so
  the page could not draw (`document.visibilityState` = hidden); the CI runs it.
- **The real app at 1366 × 800**: every row and figure (6.6 ha, 580 tables, 1.08 km of fences; roads and stations
  empty in the test project, a station placed by hand gave «1»), the tables and stations hidden and shown in 2D and in
  3D, Hide all / Show all with the terrain image and its legend, a hidden category with its row still selecting with
  the outline, a drawing in a hidden category showing it again, the Dimensions row (switch, count, Remove all), the
  group of the active tab marked.

Traps of this phase:

- **`button[data-del]` is used by three lists** (the stations, the module library, the 3D viewpoints): a test script
  that clicked the first one removed the catalog module from the browser's library of the test project. It was put
  back with `seedCatalogModules()` (the field then picks the group standard again). Select inside the list
  (`#infStations button[data-del]`).
- **`sed -i` in Git Bash rewrites a CRLF file with LF**: edit with Python that keeps the line endings, or with the
  Edit tool.
- **A test page in a background tab or a hidden window does not draw a SceneView**: front the tab, keep the window
  visible, or run the headless suite.
- **Seen, not changed** (existing on `main`): entering 3D folds the Layers panel without saving that, and back in 2D it
  stays folded (`view3d/scene.js`, `enter()`); the user reopens it by hand. A candidate for phase 6 or a small PR, the
  user decides.

## 8. Phase 4, the status bar part two (added later on 2026-10-11)

Phase 3 merged as #38 (`main` = `66e572e`, both branches deleted on GitHub by the user, the local ones by the
session). Decisions G1–G7 accepted («ok su tutto»); the row is in `docs/decisions.md`. Checked before the PR:

- **Test pages in the browser pane**: engine, modules, SDK, import, terrain (21 / 21, a new test on the 12 % plane:
  154.00 m and 12.00 % exactly), infrastructure, 3D view, `ui.html` (23 / 23, a new test of the bar). `scene3d.html`
  not run here, the window being hidden; the CI runs it.
- **The real app at 1366 × 800** on the test project «Slope test» (a 10.3 % plane, a limit of 10 % chosen by hand,
  the cut switched off): 100.0 m and 10.3 % on the field, not red, the tooltip saying why; «—» outside the grid with
  the coordinates still shown; «—» for both in 3D; the bar fits the width.

Trap: a first version coloured every cell over the limit. On that test project the bar was red where the map showed
no hatching, because the cut was off. The red now follows the mask of `overLimit()`, as the hatching and the figures.

## 9. Phase 5, the searches (added later on 2026-10-11)

Phase 4 merged as #39 (`main` = `c7662e8`); cleanup done (the user deleted the branch on GitHub). Decisions H1–H8
answered with two additions of the user: an address / coordinates search (Nominatim or open source, a compact
magnifier top right) and «Zoom to» on a right click in Layers. Checked before the PR:

- **Test pages in the browser pane**: engine, modules, SDK, import, terrain, infrastructure, 3D view, `ui.html` (24 / 24,
  a new test: matching, Ctrl K, a pick, a hidden category, a tool armed, coordinates, the address service stood in,
  Zoom to). `scene3d.html` not run here (hidden window).
- **The real app at 1366 × 800**: Ctrl K, «site» finds the gross area with 7.04 ha, Enter selects it in Site area with
  its row shown; coordinates «45.4642, 9.1900» put a pin on Piazza del Duomo; one real request to Nominatim
  («Duomo di Milano», a public landmark) answered from the browser (CORS works) with the attribution; E N in metres
  «684621 4873020» in RDN2008 / UTM 32N landed on the test site; Zoom to on Tables went back to the site; every row
  checked (the cut switched off, roads, stations and dimensions said «nothing on the map»).

Traps: the test page mounts only parts of the app's markup (add the new boxes to its list) and its box is hidden (no
focus there); its banner element starts without `hidden`, which reads as «a tool is armed». Nominatim's policy: no
search while typing, one request a second, the attribution; a company proxy may block it (the box says so).

## 10. Phase 6, the end of the refactor (added later on 2026-10-11)

Phase 5 merged as #40 (`main` = `814607a`); the user confirmed the seven decisions taken while building it and
deleted the branch on GitHub. Phase 6 answered «ok per tutto il resto» with three notes of the user, all done:

- **3D panels** (a screenshot of the user: the 3D card covered the controls of the scene, Daylight covered 2D / 3D):
  the card sits in the top left corner, the scene's controls to its right (`scene.ui.padding`), the Daylight widget
  inside the card in Sun and shadows (its host survives the redraws: `placeDaylight()`); the widget's own width and
  title are overridden and its Calcite parts take the app's colours (they were dark on dark). The first section of the
  card is «Ground and heights» (it repeated «3D view»).
- **Messages**: bottom left of the map (`#toast` inside `#mapStack`), right of the 3D card in 3D; a × on every one.
- **Drawing tools**: two rows of three small tools (Area · Line · Point / Rectangle · Circle · Freehand); Freehand is a
  tool: an area when the category takes areas, else a line. The Freehand box is gone.
- **Buffers** (a question of the user): a value of the object, drawn in the colour of its category, cut with it, the
  attribute `buffer_m` in the exports; now said in the README.

- **Checked**: the whole headless suite on this PC (`C:\Users\ddicarlo\pvp-check`, outside OneDrive): every page
  green, the 3D scene 5 / 5 with the Daylight widget found in the card and the view padded beside it, no page failing
  on the new rule of uncaught errors; in the browser pane the 3D card, the controls beside it, the messages, the grid
  of tools, Freehand arming an area for a gross area and a line for the connection route, the Layers panel back after
  3D.
- **README pictures**: `tools/headless/shots.mjs` (headless Chromium with the real SDK from the CDN and the Esri
  imagery: the MapView starts there, unlike with the npm bundle of run.mjs) on the test project `it_slope.axpo`, with a
  limit of 15 % and a pitch of 10.3 m set by the script. No 3D picture: the invented terrain of that project runs from
  76 to 124 m at a real place where the Esri ground is at 269 m, so its tables lie under the ground in 3D.

Traps: a widget given a `container` puts its classes on that element (style `.d3-daylight.esri-daylight`, not a
descendant); Calcite components read `--calcite-color-*` variables, set them on the host for the dark theme;
`view.padding` and `view.ui.padding` add up (the controls went far right until `ui.padding.left` was set back to 12).

What comes after the refactor, each with its own list of decisions:
1. The P0 release gates of `CLAUDE.md`: validation of `.pvpd` files and IDs, integrity of `terrain/grid.f32`.
2. The functions of plan §4 left for later: target capacity in the ribbon, aspect, report sections, contours, the
   map sheet (Engineering first).
3. The trial with the users (`docs/handoff` notes say what was checked and what was not).

## 11. The second round, phase 7 (added later on 2026-10-11)

Phase 6 merged as #41 (`main` = `4d7e347`); the user confirmed the four decisions taken while building it. Cleanup
from now on also deletes the branch on GitHub (the user said yes; a push can wait on Git Credential Manager, so it
runs in the background without a time limit). The user then set the logic of the app and a second round of the
workspace: decisions L1–L22, all accepted, plan §8, phases 7 to 11.

Phase 7 on `ux/project-logic`: `ui/mapnav.js` (the box of 5 km around the gross areas, 1:50,000, the scale menu and
the padlock) and `io/names.js` (file names, unnamed project). Checked: `ui.html` 25 / 25 with a new test, every other
page green but `scene3d.html` (hidden window: the CI runs it); in the browser pane the box (about 14 km of Web
Mercator around the test site), zoom-out stopping at 1:50,000, the lock at the nearest scale and moved by the menu,
the unnamed save refused with the red field and the message, the name and the day in the file names.

Traps: with the browser pane hidden, `view.goTo()` does not settle (no animation frames): test the constraints by
setting `view.scale` or by calling the module. `view.constraints.minScale` is the widest scale (zoomed out).
Confirmed by the user: one file per day of work, the menu moving a locked scale. Merged as #42.

## 12. Phase 8, drawing aids and Layers (added later on 2026-10-11)

On `ux/drawing-aids`: `ui/snapping.js` (the menu of the Snapping button, the sources of every sketch, the hidden
layer «Snap points» of midpoints and centres), Rename in the right-click menu of an object row (`renameRow()` in
`ui/layermenu.js`, `renameFeature()` in `areas.js`), rows and groups of the Layers panel only when they hold something
(`syncGroups()` in `ui/layers.js`; the rows start hidden in the markup and show with their figure), Buffer in
Constraints. Checked: `ui.html` 26 / 26 with a new test, every other page green but `scene3d.html` (hidden window);
in the app the menu, the sources (5 points on the test site: its centre and the midpoints of its four sides), the
tables added and removed, Rename and back, the rows of roads, stations and the cut hidden, Buffer above the setback.

Traps: a failed run of `ui.html` can leave its preferences in this browser under the test key (`pvp.draw.test`), and
the next run starts with them: clear the key. A module that imports `ui/maptools.js` must not call it while loading
(an import cycle through `areas.js`): `ui/snapping.js` subscribes at the first sketch.

## 13. Phase 9, Terrain (added later on 2026-10-11)

Phase 8 merged as #43. On `ux/terrain-ribbon`: the Terrain ribbon (Digital elevation models, Slope analysis, Other
analysis, Remove terrain on the right), several GeoTIFF mosaicked (`mosaic()` in `terrain/slope.js`, `meta.parts` says
what each model gave), Aspect and Hillshade beside Elevation and Slope classes (`aspectColour()`, the `view` of the
project is now `s`, `z`, `a` or `h`), contours (`contourLines()`, `terrainContours()`, a row of Layers, PVP_CONTOURS in the
exports with the elevation of each line). Checked: `terrain.html` 23 / 23 and `ui.html` 27 / 27 with new tests, every
other page green but `scene3d.html`; in the app the ribbon at 1366 px, the four images and their legends, the contours
on the test plane (straight lines) with the Esri warning under 2 m.

Traps: the kit's `.rline` is a flex row, so `[hidden]` needs its own rule; «Show all» of the Layers panel now switches
the contours on (a test that toggles them must start from off); the export projects the items of WGS 84 together, so
the contours (in the frame of the grid) are projected on their own. To confirm with the user: *Remove terrain* as its
own group on the right, contours switched on by «Show all», contours in the Shapefile and GeoPackage too.
