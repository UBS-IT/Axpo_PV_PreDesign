"""The toolkit workbook: the editable source of app/catalog/toolkit.json.

    python scripts/make_toolkit.py            workbook  -> JSON   (after editing docs/toolkit/toolkit.xlsx)
    python scripts/make_toolkit.py --export   JSON      -> workbook (bootstrap, or after a session edited the JSON)
    python scripts/make_toolkit.py --check    exit 1 when the workbook and the JSON do not hold the same values

The app reads only the JSON; the workbook is what people edit (Excel, no code). Both files are committed and the
CI runs --check, so they never drift apart. Needs openpyxl (pip install openpyxl; the ArcGIS Pro Python has it).

Workbook layout (sheet README inside the workbook says the same):
  Meta      schema, version, updated, owner, notes
  Values    one row per value: Country (blank = group) · Section · Key (dotted path) · Value · Unit · Source ·
            Status (blank or confirmed / verify / open) · Note · Detail. A value with a unit, source, status,
            note or detail becomes {value, unit, source, verify, note, detail} in the JSON; a bare one stays a
            plain value. Status "open" = no value yet: the key is left out of the JSON (the app then says the
            toolkit has no rule), the row stays as a placeholder. Value cells: numbers and TRUE/FALSE as such,
            the word null for null, a JSON list such as [6.85, 10.3] for lists.
  Records   one sheet per list of records, Country first: Structures, SlopeLimits, Modules, ModulePowers, Rules,
            Buildings, StationRules, Gates, TransformerTypes, FireTanks. A blank cell = key absent. Column names
            with a dot (reference.tableLength) are nested keys.
"""
import argparse, datetime, json, pathlib, sys
from collections import OrderedDict

try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit('openpyxl is needed: pip install openpyxl')

ROOT = pathlib.Path(__file__).resolve().parents[1]
WB = ROOT / 'docs/toolkit/toolkit.xlsx'
JS = ROOT / 'app/catalog/toolkit.json'

META_KEYS = ['schema', 'version', 'updated', 'owner', 'notes']
TOP_ORDER = ['sources', 'standards', 'modules', 'defaults', 'slopeLimits', 'structures', 'countries', 'rules']
ATTRS = ['value', 'unit', 'source', 'verify', 'note', 'detail']          # keys of a value object
VALUE_COLS = ['Country', 'Section', 'Key', 'Value', 'Unit', 'Source', 'Status', 'Note', 'Detail']
RECORD_SHEETS = ['Structures', 'SlopeLimits', 'Modules', 'ModulePowers', 'Rules', 'Buildings', 'StationRules', 'Gates',
                 'TransformerTypes', 'FireTanks']
STATUS = ['', 'confirmed', 'verify', 'open']
TEXT_COLUMNS = {('ModulePowers', 'Period'), ('Modules', 'importedAt'), ('Modules', 'id'), ('Structures', 'id'),
                ('Structures', 'notation'), ('Rules', 'id'), ('Buildings', 'id'), ('Gates', 'id'), ('FireTanks', 'id')}

README = """The toolkit workbook — the editable source of app/catalog/toolkit.json

How to change a value
1. Edit the cell in the Values sheet (or in a record sheet), keep Source and Status up to date.
2. Run from the project root:  python scripts/make_toolkit.py   (needs openpyxl; the ArcGIS Pro Python has it).
3. Commit both files (docs/toolkit/toolkit.xlsx and app/catalog/toolkit.json). The CI checks that they match.
The app reads only the JSON: a change in this workbook reaches the app only after step 2.

Conventions
- Country: the ISO code (IT, FR, PL, ES, DE, CH); blank = a value of the whole group. A value of one country is never
  borrowed by another: if a country has no row, the app says that its toolkit has no rule.
- Key: the dotted path of the value (roads.heavy.width). Section is only the first part, for filtering.
- Value: numbers and TRUE/FALSE as such; the word null for null; a JSON list such as [6.85, 10.3] for lists.
  An empty Value with Status "open" = question asked, no answer yet: the key is left out of the JSON.
- Status: blank or confirmed = read from a toolkit document or stated by the user; verify = read from a drawing or an
  extraction that still needs a check (the app marks it "to verify"); open = no value yet.
- Source: the document behind the value, as listed in the Sources rows (CS, AGRI, NORMES, PC, IT-PC, ROADMAP, USER)
  or in docs/toolkit/sources.md.
- Record sheets (Structures, Buildings, Rules, ...): one row per record, Country first; a blank cell = key absent;
  a column name with a dot (reference.tableLength) is a nested key. ModulePowers holds the power roadmap of the
  modules of the Modules sheet (one row per module and period).
- Adding a country: rows with its code in Country (at least name), then its values and records.
- Never invent a value: a missing value is better than a borrowed one. Prices are never written here.

python scripts/make_toolkit.py --export rebuilds this workbook from the JSON (after a session edited the JSON directly):
it overwrites the workbook, so save your edits first. python scripts/make_toolkit.py --check only compares.
"""


# ── helpers ──
def is_value_obj(d):
    return isinstance(d, dict) and len(d) > 0 and set(d) <= set(ATTRS)


def sheet_key(sheet):
    """Sheet name -> JSON key (Structures -> structures, SlopeLimits -> slopeLimits)."""
    return sheet[0].lower() + sheet[1:]


def record_sheet(key):
    return key[0].upper() + key[1:]


def to_cell(v):
    """A JSON scalar or list as a cell value."""
    if v is None:
        return 'null'
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return v


def from_cell(v, text=False):
    """A cell value as a JSON value (None = blank, left out)."""
    if v is None:
        return None
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        if text:
            return str(int(v)) if float(v).is_integer() else str(v)
        return int(v) if isinstance(v, float) and v.is_integer() else v
    s = str(v).strip()
    if s == '':
        return None
    if text:
        return s
    if s == 'null':
        return 'null'           # the marker: resolved by the caller
    if s in ('TRUE', 'FALSE'):
        return s == 'TRUE'
    if s[0] in '[{':
        try:
            return json.loads(s)
        except json.JSONDecodeError as e:
            raise ValueError(f'not valid JSON: {s!r} ({e})')
    return s


def set_path(obj, path, value):
    """Sets obj[a][b][c] = value for path 'a.b.c', creating dicts on the way."""
    keys = path.split('.')
    for k in keys[:-1]:
        if k not in obj:
            obj[k] = OrderedDict()
        obj = obj[k]
    obj[keys[-1]] = value


# ── JSON -> rows ──
def flatten(node, country, path, values, records):
    """Walks the JSON of one country (or the group) into Values rows and record sheets."""
    if is_value_obj(node):
        status = 'open' if 'value' not in node else ('verify' if node.get('verify') else '')
        values.append([country, path[0], '.'.join(path), to_cell(node.get('value')) if 'value' in node else None,
                       node.get('unit'), node.get('source'), status, node.get('note'), node.get('detail')])
    elif isinstance(node, dict):
        for k, v in node.items():
            flatten(v, country, path + [k], values, records)
    elif isinstance(node, list) and node and all(isinstance(x, dict) for x in node):
        sheet = record_sheet(path[-1])
        if sheet not in RECORD_SHEETS:
            raise ValueError(f'no record sheet for {".".join(path)}: add it to RECORD_SHEETS')
        for rec in node:
            row = OrderedDict(Country=country)
            for k, v in rec.items():
                if sheet == 'Modules' and k == 'powers':
                    for period, wp in v:
                        records.setdefault('ModulePowers', []).append(OrderedDict(Country=country, Module=rec['id'], Period=period, Wp=wp))
                elif isinstance(v, dict):
                    for k2, v2 in v.items():
                        row[f'{k}.{k2}'] = to_cell(v2)
                else:
                    row[k] = to_cell(v)
            records.setdefault(sheet, []).append(row)
    else:
        values.append([country, path[0], '.'.join(path), to_cell(node), None, None, '', None, None])


def export(data):
    wb = openpyxl.Workbook()
    head_font, head_fill = Font(bold=True), PatternFill('solid', fgColor='DDE6EE')

    def header(ws, cols, widths=None):
        ws.append(cols)
        for c in ws[1]:
            c.font, c.fill = head_font, head_fill
        ws.freeze_panes = 'A2'
        for i, w in enumerate(widths or [], 1):
            ws.column_dimensions[get_column_letter(i)].width = w

    ws = wb.active
    ws.title = 'README'
    ws.column_dimensions['A'].width = 120
    for line in README.strip('\n').split('\n'):
        ws.append([line])
    ws['A1'].font = head_font

    ws = wb.create_sheet('Meta')
    header(ws, ['Key', 'Value'], [12, 110])
    for k in META_KEYS:
        ws.append([k, data.get(k)])

    values, records = [], OrderedDict()
    for k, v in data.items():
        if k in META_KEYS or k == 'countries':
            continue
        flatten(v, '', [k], values, records)
    for iso, c in data.get('countries', {}).items():
        for k, v in c.items():
            flatten(v, iso, [k], values, records)

    ws = wb.create_sheet('Values')
    header(ws, VALUE_COLS, [9, 14, 42, 22, 7, 16, 11, 60, 40])
    for row in values:
        ws.append(row)
    dv = DataValidation(type='list', formula1='"confirmed,verify,open"', allow_blank=True)
    dv.add(f'G2:G{max(2, ws.max_row + 500)}')
    ws.add_data_validation(dv)
    ws.auto_filter.ref = f'A1:{get_column_letter(len(VALUE_COLS))}{max(2, ws.max_row)}'
    for row in ws.iter_rows(min_row=2, min_col=8, max_col=9):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical='top')

    for sheet in RECORD_SHEETS:
        rows = records.get(sheet, [])
        cols = ['Country']
        for r in rows:
            for k in r:
                if k not in cols:
                    cols.append(k)
        ws = wb.create_sheet(sheet)
        header(ws, cols, [9] + [max(10, min(40, len(c) + 4)) for c in cols[1:]])
        for r in rows:
            ws.append([r.get(c) for c in cols])
        if rows:
            ws.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{ws.max_row}'
    wb.save(WB)
    return len(values), {s: len(r) for s, r in records.items()}


# ── rows -> JSON ──
def read_rows(ws):
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return [], []
    cols = [str(c).strip() if c is not None else '' for c in rows[0]]
    out = []
    for n, r in enumerate(rows[1:], start=2):
        if all(v is None or str(v).strip() == '' for v in r):
            continue
        out.append((n, dict(zip(cols, r))))
    return cols, out


def build(wb):
    errors = []
    data = OrderedDict()
    meta = dict((str(k).strip(), v) for k, v in wb['Meta'].iter_rows(min_row=2, values_only=True) if k)
    for k in META_KEYS:
        if meta.get(k) is not None:
            data[k] = from_cell(meta[k], text=True)
    group, countries = OrderedDict(), OrderedDict()

    def target(country, where):
        if not country:
            return group
        if len(country) != 2 or not country.isalpha() or not country.isupper():
            errors.append(f'{where}: Country must be a two-letter code, got {country!r}')
            return OrderedDict()
        return countries.setdefault(country, OrderedDict())

    seen = set()
    cols, rows = read_rows(wb['Values'])
    for n, r in rows:
        where = f'Values row {n}'
        country = str(r.get('Country') or '').strip()
        key = str(r.get('Key') or '').strip()
        if not key:
            errors.append(f'{where}: Key is empty'); continue
        if (country, key) in seen:
            errors.append(f'{where}: duplicate of {country or "group"} {key}'); continue
        seen.add((country, key))
        status = str(r.get('Status') or '').strip()
        if status not in STATUS:
            errors.append(f'{where}: Status {status!r} is not confirmed / verify / open'); continue
        try:
            value = from_cell(r.get('Value'))
        except ValueError as e:
            errors.append(f'{where}: {e}'); continue
        if value == 'null':
            value = None
        has_value = r.get('Value') is not None and str(r.get('Value')).strip() != ''
        attrs = OrderedDict()
        if has_value:
            attrs['value'] = value
        for col, k in (('Unit', 'unit'), ('Source', 'source')):
            v = from_cell(r.get(col), text=True)
            if v is not None:
                attrs[k] = v
        if status == 'verify':
            attrs['verify'] = True
        for col, k in (('Note', 'note'), ('Detail', 'detail')):
            v = from_cell(r.get(col), text=True)
            if v is not None:
                attrs[k] = v
        if status == 'open' and has_value:
            errors.append(f'{where}: Status open but a Value is given (use confirmed or verify)'); continue
        if not has_value and status != 'open':
            errors.append(f'{where}: no Value: set Status to open, or give the value'); continue
        if not has_value and len(attrs) == 0:
            continue                                   # open, nothing else to keep: the key is left out
        plain = has_value and len(attrs) == 1
        set_path(target(country, where), key, value if plain else attrs)

    for sheet in RECORD_SHEETS:
        if sheet not in wb.sheetnames:
            continue
        cols, rows = read_rows(wb[sheet])
        key = sheet_key(sheet)
        for n, r in rows:
            where = f'{sheet} row {n}'
            country = str(r.get('Country') or '').strip()
            rec = OrderedDict()
            for c in cols[1:]:
                if not c:
                    continue
                try:
                    v = from_cell(r.get(c), text=(sheet, c) in TEXT_COLUMNS)
                except ValueError as e:
                    errors.append(f'{where}: column {c}: {e}'); continue
                if v is None:
                    continue
                if v == 'null':
                    v = None
                set_path(rec, c, v)
            if sheet == 'ModulePowers':
                mods = target(country, where).get('modules', [])
                mod = next((m for m in mods if m.get('id') == rec.get('Module')), None)
                if not mod:
                    errors.append(f'{where}: module {rec.get("Module")!r} not in the Modules sheet'); continue
                mod.setdefault('powers', []).append([rec.get('Period'), rec.get('Wp')])
            else:
                target(country, where).setdefault(key, []).append(rec)

    # the order of the file: meta, the group sections in a fixed order, the countries, the group rules last
    out = OrderedDict((k, data[k]) for k in META_KEYS if k in data)
    for k in TOP_ORDER:
        if k == 'countries':
            out['countries'] = countries
        elif k in group:
            out[k] = group.pop(k)
    out.update(group)
    return out, errors


def load_workbook():
    if not WB.exists():
        sys.exit(f'{WB.relative_to(ROOT)} not found: run with --export first')
    return openpyxl.load_workbook(WB, data_only=True)


def diff(a, b, path='', out=None):
    """Paths where two JSON values differ (ints and floats of the same value are equal)."""
    out = [] if out is None else out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f'{path}.{k}: only in the JSON')
            elif k not in b:
                out.append(f'{path}.{k}: only in the workbook')
            else:
                diff(a[k], b[k], f'{path}.{k}', out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f'{path}: {len(a)} items in the workbook, {len(b)} in the JSON')
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f'{path}[{i}]', out)
    elif isinstance(a, bool) != isinstance(b, bool) or a != b:
        out.append(f'{path}: workbook {a!r} · JSON {b!r}')
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--export', action='store_true', help='rebuild the workbook from the JSON (overwrites it)')
    ap.add_argument('--check', action='store_true', help='compare the workbook with the JSON, exit 1 when they differ')
    a = ap.parse_args()
    if a.export:
        data = json.loads(JS.read_text(encoding='utf-8'), object_pairs_hook=OrderedDict)
        n, recs = export(data)
        print(f'{WB.relative_to(ROOT)}: {n} values, ' + ', '.join(f'{k} {v}' for k, v in recs.items()))
        return
    data, errors = build(load_workbook())
    if errors:
        print('\n'.join(errors))
        sys.exit(f'{len(errors)} problem(s) in {WB.relative_to(ROOT)}: nothing written')
    if a.check:
        current = json.loads(JS.read_text(encoding='utf-8'))
        d = diff(data, json.loads(json.dumps(current)))
        if d:
            print('\n'.join(d))
            sys.exit(f'{len(d)} difference(s): run python scripts/make_toolkit.py and commit the JSON')
        print('toolkit workbook and JSON match')
        return
    JS.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'{JS.relative_to(ROOT)} written: {len(data.get("countries", {}))} countries, version {data.get("version")}')


if __name__ == '__main__':
    main()
