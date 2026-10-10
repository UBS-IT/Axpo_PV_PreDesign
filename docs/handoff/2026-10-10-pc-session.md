# Handoff — session on the user's computer, 2026-10-10

Written on 2026-10-10 by the session that worked on the user's PC (clone `Axpo_PV_PreDesign-git`), after the note
`2026-10-09-pc-session.md`. Read `CLAUDE.md` first for the rules; `docs/plan-ribbon-refactor.md` is the plan being
executed and `docs/decisions.md` holds every dated decision. This page holds the state, what was verified, how the
user works and what comes next.

## 1. Where the repository stands

- **Phase 2 is on the branch `ux/ribbon-tools`** (PR #34, open: the user merges it on github.com); **phase 2B on
  `ux/select-edit`**, branched from it (its PR follows #34; merge #34 first). `main` =
  `a323583`, merge of PR #33 (this note after phase 1), after [PR #32](https://github.com/UBS-IT/Axpo_PV_PreDesign/pull/32)
  (phase 1C of the ribbon refactor, `2a08f04`), [PR #31](https://github.com/UBS-IT/Axpo_PV_PreDesign/pull/31) (phase 1B, `cc6e612`) and
  [PR #30](https://github.com/UBS-IT/Axpo_PV_PreDesign/pull/30) (phase 1A, `424d513`). **Phase 1 is closed.** The
  clone is on `main`, no local branch left; the remote branch `claude/elegant-pascal-pu0yal` of the cloud session
  (PRs #15 and #16, merged) can be deleted on GitHub.
- Merged today, in this order (every one a branch and a PR, CI `tests` green):
  - #18 handoff note of 2026-10-09 · #19 `.claude/launch.json` with `scripts/serve.py` by a relative path (the
    preview tool of the desktop app can now start the server from the clone).
  - From a design critique of the interface (made in the desktop app's browser pane at 668 and 1366 px): #20
    `ux/figures` (the figures of 1 · Site and 3 · Layout as ledgers, not tiles) · #21 `ux/collection-drawer` (the
    objects by category in a drawer, later the Layers panel) · #22 `ux/one-primary` (one primary action per step) ·
    #23 `ux/narrow-3d` (no 3D under 760 px) · #24 `ux/texts-outputs-infra` (explanations behind «ⓘ», Outputs in two
    cards) · #25 `fix/dialog-close` (`whenClosed()` in `ui/dialog.js`, see §5).
  - #26 `ux/map-tools` (north arrow, scale bar, a Tools menu with the drawing support and the measures) · #27
    `ux/dimensions` (dimensions kept in the project, in the PDF and the DXF).
  - The refactor: #28 `ux/ribbon-plan` (the plan, 13 decisions D1–D13 taken by the user) · #29 `ux/tokens-icons`
    (phase 0) · #30 `ux/shell` (phase 1A).
- The CI checks, besides the browser tests: the toolkit workbook, `tokens.css` and `icons.svg` against `design/`
  (`scripts/make_tokens.py --check`, `scripts/make_icons.py --check`), the vendored libraries.

## 2. The ribbon refactor: where it is

The source is the design system produced by the UI design session, **outside the repository**:
`CLAUDE CODE/APP UI-UX DESIGN/design-system` (`HANDOFF.md`, `project/README.md`, `project/tokens.json`, the kit
`bundle.css`, 84 icons, the mockup `pv-predesign-mockup.html`; published as the artifact
https://claude.ai/artifact/D3MDZTYvmucJaXkXn4qULa). The plan (§5) splits the work in phases, each a PR into `main`
with the app working after each.

| Phase | State | What it left in the code |
|---|---|---|
| 0 · Tokens and icons | merged (#29) | `design/tokens.json` and `design/icons/` copied into the repo; `app/css/tokens.css` and `app/icons.svg` generated (never edited by hand); `ui/icons.js` (`icon()`, `data-icon`); no glyphs in labels |
| 1A · Shell | merged (#30) | top bar with icon buttons, four tabs (`ui/tabs.js`: `TABS`, `TAB_OF`, states and gates of the old rail), the ribbon (`ui/ribbon.js`: static `.rgroup[data-tab]` groups in `index.html`, whose buttons keep the ids the panels wire), the Layers panel (`ui/layers.js`, same exports as the old `collection.js`), the Properties panel (the step sections), `css/shell.css` |
| 1B · Status bar, panels, map controls | merged (#31) | docked panels that collapse to a 44 px strip; `ui/statusbar.js` (E / N in the export CRS, the CRS select moved from 5 · Report, scale, mode from the `pvp:mode` event, snapping, autosave); `ui/maptools.js` rewritten (controls column: Fit the site, Measure with Distance / Area chips, Dimensions; the drawing-support preferences); the Dimensions row at the foot of Layers; the basemap toggle and opacity as one stack bottom right |
| 1C · Kit | merged (#32) | `app/css/kit.css`, a byte-for-byte copy of the design system's `bundle.css` (CRLF aside), loaded between `tokens.css` and `app.css`; the markup takes the kit's names (`.lbl`, `.chip`, `.notice warn` / `err`, `dialog.dialog`, `.map-ctl`, `.banner`, `.project-name`, status bar `.it` / `.v`); three app names step aside (`.fold` sections, `.cat.over`, `.ctag`); `app.css` 328 → 252 lines (only what the kit lacks, every override commented with its clash), `shell.css` 142 → 87 (the layout) |
| 2 · Ribbon tools | PR #34 open (part A of 2026-10-11 added) | Site area: *Site definition* with Category and Type in line (`#drawType`), five geometries with Freehand (`thinned()`), Undo / Redo, Buffer and Height / Width (`renderValues()`), the two drawing-support boxes; *Constraints* group with the setback; the Site panel only shows its figures. Before part A: the **Category menu** (`ui/catmenu.js`, a listbox with colour dots, position fixed so the ribbon does not clip it) and four medium tools (`.tool.medium`, a CSS tick when armed) plus Undo / Redo; **Unclassified** (`UNCLASSIFIED` in `categories.js`, app-only: in `CATEGORY` but not in `CATEGORIES`; `classified()` filters it out of the GeoJSON / KMZ, `export/model.js` and `export/boq.js`; `pendingCount()` in `areas.js`). Terrain: Remove, Slope classes / Elevations switches. Layout & Infrastructure: Draw a road with Heavy / Light radio tools (`roadKind` in `infra.js`), At the access, Add module / Import roadmap. Report: working files, then the PDF alone on the right (`.rgroup.end`). `pvp:properties` from the ribbon reopens the Properties panel (`main.js`) |
| 2B · Selection and editing | branch `ux/select-edit` | `areas.js`: `selection` (a Set of ids), `selectFeatures` / `clearSelection` / `selectByGeometry`, `renderSelection()` (outlines on the `Selection` layer, `.it.sel` rows, the `#selCard`), `renderEditTools()` (on / off with the reason as tooltip), `op` = `box` / `split` (sketches routed by `finishOp`), `startMove` (SketchViewModel `transform`, points `move`), a generalized `finishEdit` (one history step); `edit.js`: `splitFeature`, `mergeFeatures`, `copyFeatures`, `measureFeature`, `frameFor`; the Layers rows only select and zoom |
| 3 · Layers | to do | visibility switches per computed layer (D6), legend of the slope classes |
| 4 · Status bar, part two | to do | elevation and slope under the pointer from the loaded grid (`terrain/store.js`) |
| 5 · New functions | to do | only the ones decided in plan §4 (search of project objects first) |
| 6 · Docs and tests | to do | README screenshots, the shell table of `architecture.md`, the headless suite, a handoff |

The decisions of 1C (C1–C8, `docs/decisions.md`) were confirmed by the user in one go («sono d'accordo su tutti i
punti»): the kit copied unchanged, the kit's names in the markup, the primary ribbon tool as the kit draws it
(link-coloured text, no gradient), one global rule for the panel inputs, the category colour kept on a checked
chip, the CSS tick kept on the tab number (the kit uses a ✓ glyph: to report to the design session), the kit's
measures elsewhere. The decisions of phase 2 (R1–R9) were answered item by item; the user changed three: the category
as a drop-down with colour dots and the geometry as icon tools (their reference image, which also shows a circle tool:
not added, not in their list), drawing **without a category** allowed and sorted later in the Layers panel, the PDF
apart on the right. The detailed behaviour of Unclassified (counted nowhere, exported nowhere, notices in the ledger and
the Report tab, grey dashed on the map) was chosen by the session and **is to be confirmed by the user at the review
of PR #34**. **Phase 3 (Layers visibility) starts the same way**: a numbered list of decisions first.

The decisions of 1B that changed on the user's say-so, for the record: the basemap stack goes **bottom right**
(the proposal said bottom left); the panels are **docked**, not floating (two screenshots of a collapsed floating
panel overlapping the map controls); the Esri attribution is compact, not removed (the terms of use ask for it).

## 3. Verified today

- Phase 2B in the real page at 1366 × 800: a click inside the site selects it (outline, row, card «7.04 ha · AREAS
  COLLECTION», «1 selected», tools on); a rectangle drawn, selected and split with a drawn line into «Object 1 (1)» and
  «(2)»; Move / rotate hands both to the sketch, the new positions are written back in one history step; Merge gives the
  0.49 ha rectangle back; the Delete key removes it with Undo; the project ended as it began. The Site area ribbon is
  1225 px wide with Selection. `ui.html` 21 / 21 (a new test for selection and edits), `modules.html` 19 / 19 (44
  modules), `import.html` 25 / 25, `infra.html` 12 / 12, `terrain.html` 20 / 20, `sdk.html` 5 / 5.

- Phase 2 in the real page at 1366 × 800 with the pane visible: the category menu (opens over the map, dots, tick,
  keyboard), Gross area turning Line and Point off, the Area tool armed with its tick and the mode in the status bar,
  an Unclassified point drawn with real clicks (first card of Layers, «Give a category…», the ledger notice; then
  undone), the four ribbons, the PDF on the right. Browser tests: `ui.html` 20 / 20 (it now takes about 70 s),
  `modules.html` 19 / 19 (43 modules), `import.html` 25 / 25, `infra.html` 12 / 12, `terrain.html` 20 / 20,
  `scene3d.html` 5 / 5.

- Phase 1C in the real page at 1366 × 800: the four tabs, the Quick predesign dialog (class, radius, options,
  buttons), a checked category chip in its category colour, the bare CRS select of the status bar, the controls
  column, the primary tool in link colour; mostly by computed styles, since the browser pane stayed hidden for most
  of the check (screenshots time out then), plus one screenshot of the Layout tab at the end. Browser tests:
  `ui.html` 19 / 19, `modules.html` 19 / 19, `import.html` 25 / 25. The Site, Terrain and Report tabs were not seen
  by eye: a look at them is the first thing to do before phase 2.

- Phase 1B in the real page `/app/` at 1366 × 800: the two panels close to their strips and reopen, the map resizes
  between them; the pointer coordinates appear in the status bar in RDN2008 / UTM 32N; the mode follows draw (polygon
  tool), reshape, measure (distance, then area, then distance again), dimension, and returns to Select on Esc; a
  dimension drawn with real clicks shows the Dimensions row (count, show / hide, remove all with the confirm dialog);
  the measure card opens next to the controls column. Browser tests: `ui.html` 19 / 19, `modules.html` 19 / 19,
  `import.html` 25 / 25. `scene3d.html` was not run (minutes long); the phase does not touch the 3D files.
- On 2026-10-09 (previous note, §2): the import of real `.axpo` projects with their terrain, and the reason the grid
  did not arrive before (cause 3, the project autosaved in the browser). Nothing to fix.

## 4. How the user works (what changed since the previous note)

- From 2026-10-10, on the user's request («fai tutto tu»), the session runs `git add`, `git commit`, `git push`
  itself, and after the user's «fuso» (merged) the cleanup: `git fetch --prune`, `git merge --ff-only origin/main`
  on `main` (or `git branch -f main origin/main`), `git branch -d <branch>`. Still true: every command is explained
  in the reply (what it does, how to undo it), never a commit on `main`, the PR is opened and merged by the user on
  github.com (the browser pane of the desktop app is not logged in to GitHub; no `gh`). The session gives the PR
  title and description ready to paste.
- Commits: `--author="Claude <noreply@anthropic.com>"` and the trailer `Co-Authored-By: Claude Fable 5.1
  <noreply@anthropic.com>`; PR descriptions end with the Claude Code attribution line.
- `git push`, `git fetch` and sometimes `git commit` take more than a minute on this PC (OneDrive, the network): run
  them in the background or with a long timeout; they are not hanging.
- The user's local server: `py -3 scripts\serve.py 8140`, the app at http://localhost:8140/app/ (the desktop app's
  preview tool can start the same through `.claude/launch.json`, entry `pv-predesign`). A `file://` page in the
  browser pane is a static snapshot: always serve over http.

## 5. Traps found today (do not rediscover them)

- **The SketchViewModel needs a pointer move before the first click** of a simulated drawing (a `hover` first),
  and a simulated drag does not drive its Move / rotate: the write-back was checked by moving the sketch graphics
  from a script. A person with a mouse is not affected.
- **Stored rings keep the orientation of their source** (GeoJSON counter-clockwise, the SDK clockwise): simplify
  before and after a cut, a union or an area, as `computeArea()` does, or the areas come out negative.
- **The yellow under the site is the terrain image**, not an object: a click there selects nothing.

- **The kit resets every `button`** (no background, border or padding) and **shares names with the app** that mean
  something else: `.sec` (flat section vs the app's collapsible card, now `.fold`), `.drop` (dashed drop zone vs
  the drag-over state, now `.cat.over`), `.tag` (top-bar badge vs the category tag, now `.ctag`), `.legend` (a
  column on the map vs the slope legend in the panel), `.opts` (a column vs the 3D mode radios in a row), `.it` (a
  status-bar item vs a list row), `.sw` (a bordered swatch vs the filled one), and `.notice` is `display: flex`, so
  a notice built with `hidden` would show. Each has a one-line override in `app.css` or `shell.css`, commented;
  read those comments before the next kit copy.

- **`<dialog>` in a hidden browser pane**: Chromium does not deliver the `close` event while the tab is hidden (the
  `toggle` event arrives). `tests/ui.html` fell from the quick predesign onwards for this reason, not for the code;
  `whenClosed(dlg, fn)` in `ui/dialog.js` (PR #25) made the tests deterministic. Synthetic clicks in the pane may
  also need a `hover` first.
- **Line endings**: the clone has `core.autocrlf=true`, the files are CRLF on disk. `sed -i` rewrites every line of
  a file to LF (40 untouched files showed as modified in phase 1A); files written by the editing tools or by Python
  come out LF. Before a commit, convert the touched files back to CRLF (a three-line Python) and check
  `git diff --stat` for whole-file diffs.
- **The Esri measurement widgets remove their `container` on `destroy()`**: the second measure of a session never
  showed (`#measureBox` was gone). Each widget now gets its own host element inside the box (`ui/maptools.js`).
- **Class and `[hidden]` clashes with the kit's names** (phase 0): `.grp` was both the top-bar group and the results
  group (renamed `.rgrp`); a `display` rule on `.suggest`, `.mapcard`, `.panel`, `.strip` overrides the `hidden`
  attribute, so each has an explicit `[hidden] { display: none }` rule.
- **`index.html` is edited by scripts in the scratchpad** (`shell_rewrite.py`, `shell_1b.py`, with assertions on the
  ids and their order); the Edit tool for small changes. Never a bare `open(path, 'w')` on it: a failed write once
  emptied an HTML file in the Geoportale.
- **The browser pane's coordinates** are those of the scaled screenshot it reports (800 × 468 for 1366 × 800); the
  SDK's `pointer-move` reacts to a real `hover`, not to `element.click()`.

## 6. Open work, in the order suggested

1. Review and merge PR #34 (phase 2 with part A), then the PR of `ux/select-edit` (phase 2B). Phase 2B was (decisions B1–B6 of 2026-10-11,
   built as accepted: Select / Box tools, the same Category / Type / Buffer controls acting on the selection, an Edit group with
   Reshape, Move / Rotate, Split, Merge, Copy, Delete, a «Selected object» card for name and voltage, the Layers panel
   reduced to groups, rows, selection and zoom); then phase 3 (visibility switches only).
   To report to the design session: the set lacks point, line, rectangle (and circle) icons; the kit's tab tick is a
   glyph.
2. Phases 2 to 6 of the plan, one PR each, each opened with its list of decisions. Phase 4 needs a grid lookup in
   `terrain/store.js` (elevation and slope at a map point).
3. i18n keys left unused by 1A and 1B (`top.crsNone`, `top.import`, `top.importTitle`; `tools.measureClose` is
   still used) and any wording «Tools menu» left in the docs: a sweep in phase 6.
4. From the previous notes, still open: two lines in the Registro of `COORDINAMENTO.md` (AGOL Axpo workspace, owned by
   the Geoportale session) for PR #15; the workbook trial with a referent of a country without values; the release
   gates of `CLAUDE.md` (P0 validation of `.pvpd` and IDs, P0 integrity of `terrain/grid.f32`, P1 CI failing on
   browser errors); lots, roads between rows and fillets, elevation profile.
5. The clone inside OneDrive still asks «Deletion of directory failed» on `fetch --prune` (answer n; harmless).
   Moving it to `C:\dev` remains the recommendation; the user decides.
