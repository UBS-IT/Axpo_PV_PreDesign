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
- The clone is on `main`, no local branch left. On GitHub only `main` and `claude/elegant-pascal-pu0yal` (the cloud
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
| 3 · Layers | **next** | visibility switches (D6), legend of the slope classes |
| 4 · Status bar, part two | to do | elevation and slope under the pointer (`terrain/store.js`) |
| 5 · New functions | to do | only those decided in plan §4 (search of project objects first) |
| 6 · Docs and tests | to do | README screenshots, the shell table of `architecture.md`, the headless suite, a handoff |

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

1. **Phase 3, the Layers panel**: its decisions first. The panel now lists only the objects of 1 · Site by category;
   the computed layers (tables, buildable area, fences, roads, stations, slope image, dimensions) have no switch.
2. Phases 4 to 6 of the plan, one PR each, each opened with its list of decisions.
3. To report to the design session: the set lacks point, line, rectangle and circle icons; the kit's tab tick is a glyph.
4. i18n keys left unused by phase 1 (`top.crsNone`) and any wording «Tools menu» or «Collection» left in the docs: a
   sweep in phase 6.
5. Still open from the earlier notes: two lines in the Registro of `COORDINAMENTO.md` (AGOL Axpo workspace) for PR #15;
   the workbook trial with a referent of a country without values; the release gates of `CLAUDE.md` (P0 validation of
   `.pvpd` and IDs, P0 integrity of `terrain/grid.f32`, P1 CI failing on browser errors: the runner still only prints
   them); lots, roads between rows and fillets, elevation profile.
6. The clone inside OneDrive: moving it to `C:\dev` remains the recommendation; the user decides.
