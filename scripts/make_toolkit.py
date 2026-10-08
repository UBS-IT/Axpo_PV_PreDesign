"""The toolkit workbook: the editable source of app/catalog/toolkit.json.

    python scripts/make_toolkit.py            workbook  -> JSON   (after editing docs/toolkit/toolkit.xlsx)
    python scripts/make_toolkit.py --export   JSON      -> workbook (bootstrap, or after a session edited the JSON)
    python scripts/make_toolkit.py --check    exit 1 when the workbook and the JSON do not hold the same values

The app reads only the JSON; the workbook is what people edit (Excel, no code). Both files are committed and the
CI runs --check, so they never drift apart. Needs openpyxl (pip install openpyxl; the ArcGIS Pro Python has it).

Workbook layout (sheet README inside the workbook says the same):
  Meta      schema, version, updated, owner, notes
  Values    one row per value: Country (blank = group) · Section · Key (dotted path) · Meaning (written by the
            export, not read back) · Value · Unit · Source · Status (blank or confirmed / verify / open) · Note ·
            Detail. Every column header has a comment and a prompt that say what to fill. A value with a unit, source, status,
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
    from openpyxl.comments import Comment
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
VALUE_COLS = ['Country', 'Section', 'Key', 'Meaning', 'Value', 'Unit', 'Source', 'Status', 'Note', 'Detail']
COUNTRIES = ['IT', 'FR', 'PL', 'ES', 'DE', 'CH']

# What each value means, in plain words (the Meaning column of the Values sheet: written at export, never read back).
# Keys are the dotted path without the country; a trailing '.' matches a whole block, a missing key gives a generic
# line from its last word (source, note, unit, verify).
KEY_HELP = {
    'sources.': 'A source document: its code is what the Source column refers to; the text says which file (and sheet or page)',
    'standards.ground-fixed.structure': 'Group standard structure for ground-mounted fixed plants, as nVm notation (3V9 = 3 modules portrait across, 9 along)',
    'standards.ground-fixed.tiltDeg': 'Tilt of the group standard fixed structure (degrees)',
    'standards.ground-fixed.azimuthDeg': 'Facing azimuth of the standard fixed structure (degrees, 180 = south)',
    'standards.agri-tracker.structure': 'Group standard tracker, as nVm notation (1V28 = 1 module portrait, 28 along)',
    'standards.agri-tracker.rotationDeg': 'Maximum rotation of the tracker to each side (degrees)',
    'standards.agri-tracker.azimuthDeg': 'Azimuth of the tracker rows (degrees, 90 = rows north–south)',
    'standards.agri-tracker.pitch': 'Pitch of the trackers (m); null = none: it is agreed with the farm for each project',
    'standards.halfTables.optional': 'TRUE = half tables (half strings) are only an option the designer switches on',
    'standards.module': 'Id of the group standard module (a row of the Modules sheet)',
    'standards.perimeterRoad.suggestedUpToMWp': 'The perimeter road is proposed for plants up to this capacity (MWp)',
    'standards.perimeterRoad.mode': "'suggestion' = proposed by the app, decided by the designer (never imposed)",
    'defaults.moduleGap': 'Gap between two modules of a table (m)',
    'defaults.tableGap': 'Gap between two consecutive tables along a row (m)',
    'defaults.fixed.tiltDeg': 'Default tilt of fixed structures when a preset has none (degrees)',
    'defaults.fixed.azimuthDeg': 'Default facing azimuth of fixed structures (degrees, 180 = south)',
    'defaults.transversalTrack.spacing': 'A track across the rows every this distance (m)',
    'defaults.transversalTrack.width': 'Width of the track across the rows (m)',
    'name': 'Name of the country as shown in the app',
    'status': 'Free text shown when the country has no toolkit yet',
    'sources': 'Codes of the source documents of this country, as a JSON list, e.g. ["IT-PC"]',
    'fixed.maxShadingAngleDeg': 'Maximum shading angle between rows of fixed structures (degrees): it gives the minimum pitch',
    'fixed.lowEdgeHeight': 'Height of the low edge of a fixed table above the ground (m)',
    'tracker.pitchExamples': 'Pitches of trackers found in the toolkit drawings (m), as a JSON list: shown as examples, never applied',
    'tracker.gapInLine': 'Gap between two trackers in line (m)',
    'tracker.maxInLine': 'Trackers in line before a corridor (count)',
    'tracker.gapAfterLine': 'Width of the corridor after that many trackers (m)',
    'tracker.rotationDeg': 'Maximum rotation of the trackers to each side (degrees)',
    'tracker.minHeights.standard': 'Minimum height of the modules above the ground, AgriPV standard category (m)',
    'tracker.minHeights.grazing': 'Minimum height of the modules above the ground, grazing category (m)',
    'tracker.minHeights.advanced': 'Minimum height of the modules above the ground, advanced category (m)',
    'tracker.axisHeights.standard': 'Height of the rotation axis above the ground, AgriPV standard category (m): used by the 3D view',
    'tracker.axisHeights.grazing': 'Height of the rotation axis above the ground, grazing category (m)',
    'tracker.axisHeights.advanced': 'Height of the rotation axis above the ground, advanced category (m)',
    'roads.light.width': 'Width of a light-traffic internal road (m)',
    'roads.heavy.width': 'Width of a heavy-traffic internal road (m)',
    'roads.heavy.innerRadius': 'Inner radius of a bend of a heavy-traffic road (m)',
    'roads.heavy.outerRadius': 'Outer radius of a bend of a heavy-traffic road (m)',
    'roads.heavy.bendWidening': 'Extra width of a heavy-traffic road in a bend (m)',
    'roads.entranceRadius': 'Radius of the bend at the site entrance (m)',
    'clearances.fenceToStructuresWithPerimeterRoad': 'Distance from the fence to the structures when there is a perimeter road (m): cut from the buildable area',
    'clearances.fenceToPerimeterRoad': 'Distance from the fence to the perimeter road (m)',
    'clearances.perimeterRoadWidth': 'Width of the perimeter road (m)',
    'clearances.fenceToStructuresWithoutRoad': 'Distance from the fence to the structures without a perimeter road (m): cut from the buildable area',
    'clearances.greenStripToStructures': 'Distance from a green strip (hedge) to the structures (m)',
    'clearances.nsRoadToTrackerEnds': 'Distance from a north–south road to the ends of the trackers (m)',
    'clearances.roadBetweenBlocksWithStation': 'Width of the road between two blocks when a station sits beside it (m)',
    'clearances.stationClearance': 'Distance kept free of modules around a station, on every side (m)',
    'fence.height': 'Height of the fence (m)',
    'fence.mesh': 'Kind of mesh and posts of the fence (text, for the report)',
    'fence.postSpacing': 'Distance between fence posts (m)',
    'fence.wildlifePassages': 'TRUE when the fence has wildlife passages',
    'fence.colour': 'Colour of the fence (text, for the report)',
    'cameras.fixed': 'Height of the fixed cameras (m)',
    'cameras.dome': 'Height of the dome cameras (m)',
}
GENERIC_HELP = {'source': 'Code of the source document of this block (see the Sources rows)', 'note': 'Free note about this block',
                'unit': 'Unit of the numbers of this block (m, deg, %)', 'verify': 'TRUE while the numbers of this block are still to be checked'}


def key_help(key):
    if key in KEY_HELP:
        return KEY_HELP[key]
    for k, v in KEY_HELP.items():
        if k.endswith('.') and key.startswith(k):
            return v
    return GENERIC_HELP.get(key.rsplit('.', 1)[-1], '')


# What goes in each column: a comment on the header (hover) and a prompt when a cell of the column is selected
VALUE_HELP = {
    'Country': 'ISO code of the country the value belongs to: IT, FR, PL, ES, DE or CH. Leave blank for a value of the whole group. A value of one country is never used for another.',
    'Section': 'First part of the key, for filtering only (roads, fence, clearances…). Filled by the export.',
    'Key': 'Dotted path of the value inside the country block (e.g. roads.heavy.width). Keep it exactly: the app reads this name. New keys need the app to use them.',
    'Meaning': 'What the value is, in plain words, and its unit. Written by the export: not read back, no need to fill it.',
    'Value': 'The value itself: a number (metres, degrees, percent…), TRUE/FALSE, a text, the word null, or a JSON list like [6.85, 10.3]. Leave it empty and set Status to open when you do not know it yet.',
    'Unit': 'Unit of the value when it is not obvious from the key: m, deg, %, MWp.',
    'Source': 'Where the value comes from: one of the codes of the Sources rows (CS, AGRI, NORMES, PC, IT-PC, ROADMAP, USER), several separated by commas, or a short reference (file, page).',
    'Status': 'Blank or confirmed = read from a toolkit document or stated by the user. verify = read from a drawing or an extraction, still to be checked (the app marks it). open = no value yet (the key is left out, the app says the toolkit has no rule).',
    'Note': 'Anything useful to the next person: where in the document, how it was measured, doubts.',
    'Detail': 'How a composite value is built, e.g. "1 + 4 m road + 1" for a 6 m clearance.',
}
RECORD_HELP = {
    'Country': VALUE_HELP['Country'],
    'id': 'Unique identifier of the row (letters, digits, dashes): the app refers to it. Do not rename an id the app uses.',
    'source': VALUE_HELP['Source'], 'note': VALUE_HELP['Note'], 'unit': VALUE_HELP['Unit'],
    'verify': 'TRUE while the row is still to be checked (the app marks it "to verify"); blank otherwise.',
    'text': 'The rule in one sentence, as shown to the designer.',
    'label': 'Name shown to the designer.',
    'Structures.technology': 'ground-fixed, agri-fixed or agri-tracker: which technology the preset belongs to.',
    'Structures.notation': 'nVm or nHm: modules across (n), V portrait or H landscape, modules along (m). 3V9 = 3 portrait across, 9 along.',
    'Structures.tiltDeg': 'Tilt of the table (degrees); trackers: leave blank.',
    'Structures.azimuthDeg': 'Facing azimuth (degrees, 180 = south); tracker rows north–south: 90.',
    'Structures.reference.tableLength': 'Length of the table measured on the toolkit drawing (m): the app checks its own geometry against it.',
    'Structures.reference.planDepth': 'Depth of the table in plan, measured on the drawing (m).',
    'Structures.reference.source': 'Document the reference measures come from.',
    'Structures.reference.moduleWidth': 'Width of the module the drawing assumes (m).',
    'Structures.reference.moduleLength': 'Length of the module the drawing assumes (m).',
    'Structures.reference.highEdge': 'Height of the high edge of the table on the drawing (m).',
    'Structures.reference.verify': 'TRUE while the reference measures are still to be checked.',
    'Structures.reference.interRowGap': 'Gap between rows on the drawing (m).',
    'Structures.reference.pitch': 'Pitch on the drawing (m).',
    'Structures.foundations': 'Possible foundations, as a JSON list: ["piles", "concrete-longrine", "shallow"].',
    'Structures.standard': 'TRUE for the group standard of its technology (one per technology).',
    'Structures.half': 'Half table of this preset: its notation (1V14 for the 1V28), or FALSE when it is never split.',
    'Structures.minPitch': 'Minimum pitch of the preset (m), when the toolkit gives one.',
    'Structures.rotationDeg': 'Trackers: maximum rotation to each side (degrees).',
    'Structures.axis': 'Trackers: direction of the rotation axis (north-south).',
    'Structures.lowPointAtMaxRotation': 'Trackers: height of the lowest point at maximum rotation (m).',
    'Structures.axisHeight': 'Trackers: height of the rotation axis (m).',
    'Structures.driveGap': 'Trackers: extra length for the drive, included in the tracker length (m).',
    'Structures.tableGap': 'Gap between two tables in line (m), when the preset has its own.',
    'Structures.corridor.tables': 'Tables in line before a corridor (count).',
    'Structures.corridor.width': 'Width of that corridor (m).',
    'SlopeLimits.applies.technology': 'Technology the limit applies to: ground-fixed, agri-fixed or agri-tracker.',
    'SlopeLimits.applies.across': 'Modules across the limit applies to (3 for 3V…); blank = every structure of the technology.',
    'SlopeLimits.maxNS': 'Maximum slope north–south (percent); with maxEW. Leave blank when maxAny is used.',
    'SlopeLimits.maxEW': 'Maximum slope east–west (percent); with maxNS.',
    'SlopeLimits.maxAny': 'Maximum slope in every direction (percent). Leave blank when maxNS and maxEW are used.',
    'Modules.manufacturer': 'Manufacturer (blank for the generic group standard).',
    'Modules.model': 'Model name shown to the designer.',
    'Modules.length': 'Length of the module (m).', 'Modules.width': 'Width of the module (m).',
    'Modules.bifacial': 'TRUE for a bifacial module.', 'Modules.technology': 'Cell technology (TOPCon…).', 'Modules.cells': 'Number of cells.',
    'Modules.roadmapColumn': 'Column of the group roadmap workbook the powers come from.',
    'Modules.importedAt': 'Date the powers were read (YYYY-MM-DD): the app warns after six months.',
    'ModulePowers.Module': 'id of the module (Modules sheet).',
    'ModulePowers.Period': 'Semester of the roadmap, as text: 2026-S1, 2026-S2, or a year such as 2029.',
    'ModulePowers.Wp': 'Power of the module in that semester (Wp).',
    'Rules.applies': 'Technologies the rule applies to, as a JSON list: ["ground-fixed", "agri-fixed"] or ["all"].',
    'Rules.spacing': 'Distance of a repeated element (m), e.g. a track every 100 m.',
    'Rules.value': 'The number of the rule, in its unit (0.4 = 40 % coverage, 5 = 5 % slope, 30 = 30°).',
    'Rules.max': 'Upper value when the rule gives a range.', 'Rules.every': 'Repetition distance (m).',
    'Rules.maxDistance': 'Maximum distance of the rule (m).',
    'Buildings.kind': 'delivery-station, user-station or transformer-station: the app places buildings by kind.',
    'Buildings.length': 'Length of the building (m).', 'Buildings.width': 'Width of the building (m).', 'Buildings.area': 'Footprint (m²).',
    'Buildings.height': 'Height above the ground (m).', 'Buildings.belowGround': 'Depth below the ground (m).',
    'Buildings.embankment': 'Size of the embankment around it, as a JSON list [length, width] (m).',
    'Buildings.maxDistanceToDelivery': 'User station: maximum distance to the delivery station (m).',
    'StationRules.value': 'Number of the rule, when it has one (e.g. 3 = one station every 3 MWp).',
    'Gates.width': 'Width of the gate (m).', 'Gates.height': 'Height of the gate (m).', 'Gates.type': 'Kind of gate (text, for the report).',
    'TransformerTypes.type': 'Type letter of the transformer station in the toolkit.', 'TransformerTypes.kVA': 'Powers available, as a JSON list in kVA: [1250].',
    'FireTanks.volume': 'Volume (m³).', 'FireTanks.shape': 'horizontal cylinder or vertical cylinder.',
    'FireTanks.diameter': 'Diameter (m).', 'FireTanks.length': 'Length (m).', 'FireTanks.height': 'Height (m).',
}


def record_help(sheet, col):
    return RECORD_HELP.get(f'{sheet}.{col}') or RECORD_HELP.get(col) or RECORD_HELP.get(col.rsplit('.', 1)[-1], '')
RECORD_SHEETS = ['Structures', 'SlopeLimits', 'Modules', 'ModulePowers', 'Rules', 'Buildings', 'StationRules', 'Gates',
                 'TransformerTypes', 'FireTanks']
STATUS = ['', 'confirmed', 'verify', 'open']
TEXT_COLUMNS = {('ModulePowers', 'Period'), ('Modules', 'importedAt'), ('Modules', 'id'), ('Structures', 'id'),
                ('Structures', 'notation'), ('Rules', 'id'), ('Buildings', 'id'), ('Gates', 'id'), ('FireTanks', 'id')}

README = """The toolkit workbook — the editable source of app/catalog/toolkit.json

How to change a value
1. Find the row in the Values sheet (filter by Country or Section; the Meaning column says what each key is) or in
   a record sheet (Structures, Buildings, Rules…), change the Value, keep Source and Status up to date.
2. Run from the project root:  python scripts/make_toolkit.py   (needs openpyxl; the ArcGIS Pro Python has it).
3. Commit both files (docs/toolkit/toolkit.xlsx and app/catalog/toolkit.json). The CI checks that they match.
The app reads only the JSON: a change in this workbook reaches the app only after step 2.

Help inside the sheets
- Hover a column header: a comment says what the column is for. Select a cell: a prompt says what to type.
- Values · Meaning: what the key is and its unit, in plain words. Written by the export; you never fill it.
- Country and Status are drop-down lists. Everything is in English; the toolkit's own French or Italian terms are
  quoted in brackets where they help to find the value in the source document.

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

    def header(ws, cols, widths=None, helps=None, rows=500):
        ws.append(cols)
        for c in ws[1]:
            c.font, c.fill = head_font, head_fill
        ws.freeze_panes = 'A2'
        for i, w in enumerate(widths or [], 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        # what to fill: a comment on the header (hover) and a prompt on the cells of the column (selection)
        for i, col in enumerate(cols, 1):
            h = (helps or {}).get(col, '')
            if not h:
                continue
            cm = Comment(h, 'PV Predesign')
            cm.width, cm.height = 360, 110 + 18 * (len(h) // 70)
            ws.cell(row=1, column=i).comment = cm
            dv = DataValidation(type='none', showInputMessage=True, showErrorMessage=False, allow_blank=True,
                                promptTitle=col[:32], prompt=h[:255])
            dv.add(f'{get_column_letter(i)}2:{get_column_letter(i)}{rows}')
            ws.add_data_validation(dv)

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
    rows_v = len(values) + 500
    header(ws, VALUE_COLS, [9, 14, 40, 58, 22, 7, 16, 11, 50, 36], VALUE_HELP, rows_v)
    meaning_font = Font(italic=True, color='5B6B7B')
    for row in values:
        country, section, key = row[0], row[1], row[2]
        ws.append([country, section, key, key_help(key), *row[3:]])
        ws.cell(row=ws.max_row, column=4).font = meaning_font
    # drop-down lists (they keep the prompts of the columns)
    for col, items in (('A', ','.join(COUNTRIES)), ('H', 'confirmed,verify,open')):
        dv = DataValidation(type='list', formula1=f'"{items}"', allow_blank=True, showInputMessage=True,
                            promptTitle='Country' if col == 'A' else 'Status', prompt=VALUE_HELP['Country' if col == 'A' else 'Status'][:255])
        dv.add(f'{col}2:{col}{rows_v}')
        ws.add_data_validation(dv)
    ws.auto_filter.ref = f'A1:{get_column_letter(len(VALUE_COLS))}{max(2, ws.max_row)}'
    for row in ws.iter_rows(min_row=2, min_col=4, max_col=10):
        for c in row:
            if c.column in (4, 9, 10):
                c.alignment = Alignment(wrap_text=True, vertical='top')

    for sheet in RECORD_SHEETS:
        rows = records.get(sheet, [])
        cols = ['Country']
        for r in rows:
            for k in r:
                if k not in cols:
                    cols.append(k)
        ws = wb.create_sheet(sheet)
        header(ws, cols, [9] + [max(10, min(40, len(c) + 4)) for c in cols[1:]], {c: record_help(sheet, c) for c in cols}, len(rows) + 200)
        for r in rows:
            ws.append([r.get(c) for c in cols])
        dv = DataValidation(type='list', formula1=f'"{",".join(COUNTRIES)}"', allow_blank=True, showInputMessage=True, promptTitle='Country', prompt=VALUE_HELP['Country'][:255])
        dv.add(f'A2:A{len(rows) + 200}')
        ws.add_data_validation(dv)
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
