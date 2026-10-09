# Handoff — session on the user's computer, 2026-10-09

Written on 2026-10-09 by the session that worked on the user's PC (clone `Axpo_PV_PreDesign-git`), after the
cloud session's note `2026-10-09-local-session.md`. Read `CLAUDE.md` first for the rules; this page holds the state,
what was verified today and what comes next.

## 1. Where the repository stands

- `main` = `abdf24e`, merge of [PR #17](https://github.com/UBS-IT/Axpo_PV_PreDesign/pull/17): `docs/architecture.md`,
  the map of the app for people who do not read the code (steps and files, data flow, generated files, "if you
  touch X, Y breaks", how every part is tested), plus one line in `README.md`. No code changed.
- Before it: PR #15 (Geoportale alignment, workbook in English) and PR #16 (the cloud session's handoff). The clone
  was brought up to date as that note prescribed; the local `toolkit.xlsx` had been re-saved by Excel with no
  value changed (checked cell by cell before discarding it).
- The CI (`browser-tests`) was green on PR #17.

## 2. Verified today: the import of real Geoportale projects

Two real `.axpo` files of the user (October 2026, kept in the user's Downloads, never in the repository) with
*Pendenze da DTM* were imported in the real page `/app/` of `main`, in a new project each time. Both gave the
expected toasts, in this order: the objects by category; the automatic drawings of the Geoportale left out
(`areas.autoSkipped`); the boundary setback taken from the project (`areas.setbackImported`); the terrain grid
adopted in full (`terrain.geoAdopted`, no coverage percentage: the grid covered the whole site). 2 · Terrain showed
the grid, its image and the limit "from the Geoportale".

One of the two files was also read offline (zip → `progetto.json`, coverage computed in the local Transverse
Mercator frame): the figures predicted from the file matched the toasts of the app exactly.

**Why the terrain did not arrive before the audit** (`docs/audit/2026-10-08-geoportale-alignment.md`, §2): the
files carried their grid (cause 1 excluded) and the grid covered the whole site (cause 2 excluded); the files had
one terrain record (cause 4 not applicable). It was **cause 3**: the project autosaved in the browser already had
a grid (from *Analyse the slopes* or a quick predesign of an earlier trial) and the old reader kept it. Verified
today the other way round: with an Esri grid in the project, re-importing the file gave `terrain.geoReplaced` and
the Geoportale grid took its place.

Nothing to fix on this point. The Geoportale could still warn before saving a project whose slope exclusion has no
grid any more (audit §5): not requested yet.

## 3. GitHub: protection of `main` is not enforced

A ruleset `protect main` was created on github.com (pull request required, status check `browser-tests` required,
branches up to date, no force push, no deletion). **The UBS-IT organization is on the free plan, where rulesets do
not apply to private repositories**: the rule is recorded but not enforced, and the user could merge PR #17 without
restriction. Until the repository moves to the Urbasolar GitHub enterprise (where the rule must be created again),
the protection is a working rule: branch and pull request for every change, merge only with a green check, never a
commit on `main`. The ruleset can be left as it is.

## 4. How the user works with a session on the PC (observed today)

- The user runs the Git commands **themselves**, one at a time, from PowerShell in the clone: the session gives
  each command with what it does, the expected output and how to undo it. Commits carry
  `--author="Claude <noreply@anthropic.com>"` (a stop hook of the user asks for it); PR descriptions end with the
  Claude Code attribution line. No `gh`: pull requests are opened and merged on github.com by the user.
- A session running in auto mode may be refused `git restore`, `git stash` and `git pull` by the safety filter even
  when they are reversible; `git merge --ff-only origin/main`, `git branch -f main origin/main` and plain file copies
  do the same job.
- The clone is inside OneDrive: `git fetch --prune` asked "Deletion of directory failed" for empty folders under
  `.git/refs/remotes/origin` (harmless; answered n). Moving the clone to e.g. `C:\dev\Axpo_PV_PreDesign` is still the
  recommendation of the cloud session; the user decides.
- Local server: `py -3 scripts\serve.py 8140` then http://localhost:8140/app/. `.claude/launch.json` (versioned)
  still points at the old folder `Predesign FV\scripts\serve.py`: the preview tool of the desktop app cannot start
  the server until it is fixed (one line; a branch and a PR).

## 5. Open work, in the order suggested

1. `.claude/launch.json`: point it at the clone's `scripts/serve.py` (or a relative path), one-line PR.
2. `COORDINAMENTO.md` of the AGOL Axpo workspace (not in this clone, owned by the Geoportale session): two lines in
   the Registro for PR #15, asked by the cloud session's note; the user decides who writes them.
3. Two local branches already merged, `docs/update-release-status` and `fix/sceneview-root-height`, can be deleted
   with `git branch -d`.
4. Workbook trial with a referent of a country without values (PL, ES, DE, CH): see the previous note, §3.
5. Release gates of `CLAUDE.md` («Stato e criteri per il rilascio»): P0 input validation of `.pvpd` and IDs, P0
   project integrity (`terrain/grid.f32`), P1 CI failing on browser errors (the runner still only prints them).
6. Lots (the user's definition of «lotto»), roads between rows and fillets, elevation profile: see the previous note.
