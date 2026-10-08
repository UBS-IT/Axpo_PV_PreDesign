# Toolkit archive

The design rules of the group are scattered over many files (toolkit sheets, DWGs, roadmaps, e-mails, answers
given in conversation). This folder collects them **by country**, in one place, so that every value the app uses
can be traced back to where it came from, and so that new information has an obvious place to go.

| File | Holds |
|---|---|
| [`group.md`](group.md) | Choices that hold for every country: standard module, standard structures, slope limits, module roadmap |
| [`IT.md`](IT.md) | Italy — toolkit PC Ground Mounting IT (PDF + DWG, received 2026-09-25) |
| [`FR.md`](FR.md) | France — Design ESQ toolkit sheets (CS, AGRI, NORMES, PC) |
| [`PL.md`](PL.md) · [`ES.md`](ES.md) · [`DE.md`](DE.md) · [`CH.md`](CH.md) | Nothing received yet: what is needed |
| [`sources.md`](sources.md) | Every file received: name, date, what was read from it, where it is kept |
| `toolkit.xlsx` | **The workbook: the editable source of `app/catalog/toolkit.json`** (see below) |

## How a value enters the app

1. Write it in the country file (or `group.md`): value, unit, **source** (file + sheet / panel / page), date received,
   status.
2. Status is one of: **confirmed** (read from a toolkit document or stated by the user), **verify** (read from a
   drawing or an extraction that still needs a check), **open** (question asked, no answer yet).
3. The app reads only `app/catalog/toolkit.json`. A value moves there when the app needs it, with the same source
   and `"verify": true` when its status is *verify*. Country values live under `countries.<ISO>`; values that hold
   everywhere live at the top level (`standards`, `modules`, `slopeLimits`, `defaults`).
4. The app never invents a value that is missing for a country: it says that the toolkit has no rule for it.

## Updating the values without touching code: the workbook

`toolkit.xlsx` (this folder) holds every value of `app/catalog/toolkit.json` in sheets people can edit in Excel:

| Sheet | Holds |
|---|---|
| `README` | these instructions |
| `Meta` | schema, version, `updated`, owner, notes of the catalog |
| `Values` | one row per value: Country (blank = the group) · Section · Key (dotted path, e.g. `roads.heavy.width`) · Meaning (what the key is, written by the export: not read back) · Value · Unit · Source · Status · Note · Detail |
| `Structures`, `SlopeLimits`, `Modules`, `ModulePowers`, `Rules`, `Buildings`, `StationRules`, `Gates`, `TransformerTypes`, `FireTanks` | one row per record, Country first; `ModulePowers` is the power roadmap of the modules (one row per module and semester) |

Help inside the workbook: every column header carries a comment (hover it) and every cell of a documented column
shows the same text as an Excel input message when selected; the `Meaning` column of `Values` says in plain
English what each key is and in which unit it is expected; `Country` and `Status` are drop-down lists. Everything
in the workbook is in English; where a toolkit uses a French or Italian term, it is kept in brackets after the
English one (e.g. «piste transversale») so the sheets can still be searched by the original name.

Rules of the sheets: numbers and TRUE/FALSE as such, the word `null` for null, a JSON list such as `[6.85, 10.3]`
for lists; a blank cell is a key left out; a value with a unit, source, status, note or detail becomes
`{ value, unit, source, verify, note, detail }` in the JSON, a bare one stays a plain value. **Status** is blank or
`confirmed`, `verify` (the JSON gets `"verify": true`, the app says "to verify") or `open` (no value yet: the key is
left out of the JSON, the app says the toolkit has no rule, the row stays as a placeholder). Values of one country
are never copied to another. Prices are never written.

Then, from the project root (Python with openpyxl; the ArcGIS Pro Python has it):

```
python scripts/make_toolkit.py            # workbook -> app/catalog/toolkit.json
python scripts/make_toolkit.py --check    # are the two files the same? (the CI runs this on every push)
python scripts/make_toolkit.py --export   # JSON -> workbook, when a session edited the JSON directly (overwrites it)
```

Commit both files together. A row with a wrong Status, a duplicate key or a bad list is reported with its row
number and nothing is written. DWG drawings cannot be read into the workbook automatically: `tools/cad/dwg_dump.mjs`
lists their texts and dimensions, a person writes the values.

Toolkit files themselves are **not** kept in the repository (internal documents, large binaries): `sources.md`
says where they are.

## Reading DWG files

`tools/cad/dwg_dump.mjs` reads a DWG (LibreDWG compiled to WebAssembly) and writes every text and dimension with its
coordinates, grouped by panel, so that the values can be transcribed exactly (dimensions carry their measured
value, not the rounded label). See `tools/cad/README.md`.
