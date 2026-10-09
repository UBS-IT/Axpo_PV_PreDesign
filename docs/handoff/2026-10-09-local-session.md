# Handoff — from the cloud session of 2026-10-08 to a session on the user's computer

Written on 2026-10-09 by the cloud session (branch `claude/elegant-pascal-pu0yal`) for the session that continues
on the user's PC, in the clone `C:\Users\ddicarlo\OneDrive - URBASOLAR\Desktop\CLAUDE CODE\Axpo_PV_PreDesign-git`.
Read `CLAUDE.md` first: it holds the rules; this page holds only the state and what comes next.

## 1. Where the repository stands

- `main` = `d6b05ae`, merge of [PR #15](https://github.com/UBS-IT/Axpo_PV_PreDesign/pull/15) (two commits):
  - `3e4110d` **Geoportale alignment** — audit in `docs/audit/2026-10-08-geoportale-alignment.md`; a Geoportale
    terrain grid is adopted when it covers any part of the site (share shown, slopes outside said not checked),
    replaces an Esri grid, keeps a GeoTIFF of the designer; terrain image of the Geoportale ported (hillshade / slope
    classes `MediaLayer`, hatch over the limit, figures in the Slopes card); the automatic drawings of the Geoportale
    (`sf_auto`) are not imported; the Geoportale `netSetback` becomes the boundary setback when the project has none.
  - `f8fda65` **Toolkit workbook made easy to fill** — `docs/toolkit/toolkit.xlsx` all in English (original toolkit
    terms in brackets), `Meaning` column in `Values` (written by the export, never read back), a hover comment and
    an Excel input message on every column of every sheet, `Country` and `Status` drop-down lists. Help texts live in
    `scripts/make_toolkit.py` (`KEY_HELP`, `VALUE_HELP`, `RECORD_HELP`).
- CI green on `f8fda65` (both runs, 124 tests, no browser errors in the log). `python scripts/make_toolkit.py --check`
  passes.
- The repository now lives at **https://github.com/UBS-IT/Axpo_PV_PreDesign**; the old `davo3188/...` URL redirects.
  No `gh` CLI on the PC: PRs are opened and merged on github.com.

## 2. First thing to do on the PC: bring the clone up to date

On 2026-10-08 the clone was on `main` at `634bb7a`, **3 commits behind**, with `docs/toolkit/toolkit.xlsx` shown as
modified (Excel or OneDrive re-saved it). `git pull` refuses to overwrite it. Close Excel, then:

```
git restore docs/toolkit/toolkit.xlsx
git pull --ff-only origin main
git log --oneline -1          # must print d6b05ae
```

If the user did type values into that workbook by hand, copy it elsewhere **before** `git restore`, then re-enter
them in the new workbook row by row: `Values` has one more column (`Meaning`, after `Key`), so a block paste from
the old file shifts everything by one column. Then `python scripts\make_toolkit.py` and `--check`.

A Git clone inside OneDrive keeps producing this kind of problem (locked files, Files-On-Demand placeholders).
Moving the clone to e.g. `C:\dev\Axpo_PV_PreDesign` was suggested and is still the recommendation.

## 3. What the user still has to check (needs the PC and the real files)

1. **Real `.axpo` with «Pendenze da DTM»**: open it in PV Predesign (1 · Site → Import) and note which toasts appear.
   They name the case (`app/js/i18n.js`):
   - `terrain.geoAdopted` / `terrain.geoAdoptedPart` — grid adopted (whole site / `{pct}` % of it);
   - `terrain.geoReplaced` — the project's Esri grid was replaced; `terrain.geoKeptDtm` — a GeoTIFF was kept;
   - `terrain.geoNoCover` — the grid does not touch the site (wrong record or stale grid);
   - no terrain toast at all — the `.axpo` carries no `terrain[]` record: the DTM image had been removed from the
     Geoportale map before saving (cause 1 of the audit, §2). Re-run the Geoportale tool and save again.
   - `areas.autoSkipped` — automatic drawings left out; `areas.setbackImported` — setback taken from the project.
   The real page `/app/` is not in the headless suite: this is the only way to validate the import end to end.
2. **COORDINAMENTO.md** (`../AGOL Axpo/COORDINAMENTO.md`, not in this clone): add to the Registro the two lines for
   PR #15 (Geoportale alignment: what PV Predesign reads from a `.axpo`, `sf_auto` ignored, `netSetback` adopted;
   toolkit workbook in English with help). Audit §5 lists a possible request to the Geoportale session: warn before
   saving a project whose slope exclusion has no grid any more.
3. **Workbook trial**: hand `docs/toolkit/toolkit.xlsx` to a referent of a country without values (PL, ES, DE, CH)
   and note where they get stuck. The web form with drawings discussed on 2026-10-08 is feasible (a page inside
   PV Predesign, no backend, reusing the help texts, downloading xlsx/JSON; the costly part is a dozen dimensioned
   sketches) but should be designed on those observations, not before.

## 4. Open work, in the order suggested

- Release gate items of `CLAUDE.md` («Stato e criteri per il rilascio»): P0 input validation of `.pvpd` and IDs,
  P0 project integrity (`terrain/grid.f32`), P1 CI failing on browser errors (today the runner prints them only).
- Lots: wait for the user's definition of «lotto» (fences vs. lots, decision pending since 2026-10-04).
- Roads between rows and road fillets (asked on 2026-10-04, not started).
- Elevation profile along a line (Geoportale has it, PV Predesign not; not asked).
- `docs/plan.md` «Open questions» (catalog owner, road widths per country, DTM formats, hosting, electrical scope).

## 5. How to work on the PC

- Server: `py -3 scripts\serve.py` then http://localhost:8140/app/ ; tests at `/tests/…` (all pages must be green).
  Headless: `cd tools\headless && npm ci && npm run build && npm test` (Chromium; the scene3d page may take minutes).
- Branch for every change, commit author `Claude <noreply@anthropic.com>` (the user's stop hook asks for it), push and
  PR only when the user asks; the user merges on github.com or asks the session to.
- Workbook edits: change `toolkit.xlsx`, run `python scripts\make_toolkit.py`, commit both files; JSON edits by a
  session: `--export` then commit both. CI runs `--check`.
- Never commit real project data, toolkit documents, or identifiers of real sites (fixtures are synthetic).
