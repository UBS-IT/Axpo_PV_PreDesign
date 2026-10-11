// Modules, the group roadmap by semester, the country catalog and the structures of the group. No SDK needed.
// Run in the browser: /tests/modules.html. window.__results holds the outcome.
import { loadCatalog, countryValue, slopeLimitFor, standardFor, presetFor, catalogModules } from '../app/js/catalog.js';
import { parsePeriod, periodOf, periodLabel, modulePower, powerAge, parseSemesterRoadmap, readGroupRoadmap, library,
  usedModules, adoptProjectModules, seedCatalogModules, moduleById, defaultModuleId, STALE_DAYS } from '../app/js/modules.js';
import { parseNotation, tableGeometry, minPitch, halfNotation } from '../app/js/layout/structures.js';
import { store, defaultProject } from '../app/js/state.js';
import { readWorkbook, columnIndex } from '../app/js/io/xlsx.js';
import { writeWorkbook } from '../app/js/io/xlsxwrite.js';
import { writeDbf, writeShp } from '../app/js/export/shp.js';
import { polygonsOf, toWkb } from '../app/js/export/gpkg.js';
import { parseCsv, detectSeparator } from '../app/js/io/csv.js';
import { readRoadmapSheets } from '../app/js/modules.js';
import { loadJsZip, loadToGeoJSON, loadShp, loadGeoTiff, loadJsPdf } from '../app/js/libs.js';

const results = [];
async function test(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); }
  catch (e) { console.error(name, e); results.push({ name, ok: false, note: e && e.message || String(e) }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, w) => assert(JSON.stringify(a) === JSON.stringify(b), `${w}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const near = (a, b, tol, w) => assert(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b} (tolerance ${tol})`);
const M = { length: 2.382, width: 1.134 };

await loadCatalog();
library.modules = [];   // the test library starts empty (its own localStorage key)

// ── periods and powers ──
await test('periods: roadmap spellings', () => {
  eq(['S1 2026', ' S2 2024 old', '2029', 'S1-2027', 's2 2025', 'Date', ''].map(parsePeriod), ['2026-S1', '2024-S2', '2029', '2027-S1', '2025-S2', null, null], 'periods');
  eq(periodOf(new Date(2026, 8, 25)), '2026-S2', 'September'); eq(periodOf(new Date(2026, 0, 1)), '2026-S1', 'January');
  eq(periodLabel('2026-S2') + ' / ' + periodLabel('2029'), 'S2 2026 / 2029', 'labels');
});

await test('power of a period: exact, whole year, beyond the roadmap, before it', () => {
  const m = { powers: [['2025-S2', 630], ['2026-S1', 650], ['2026-S2', 651], ['2029', 675]] };
  eq(modulePower(m, '2026-S2'), { wp: 651, period: '2026-S2', exact: true, beyond: false, before: false }, 'exact');
  eq(modulePower(m, '2029-S2').wp, 675, 'a whole year covers both semesters');
  const b = modulePower(m, '2031-S1');
  assert(b.wp === 675 && b.beyond && !b.exact, 'beyond: last power, flagged');
  const g = modulePower(m, '2027-S2');
  assert(g.wp === 651 && g.period === '2026-S2', 'a gap takes the last earlier power');
  const e = modulePower(m, '2024-S1');
  assert(e.wp === 630 && e.before, 'before the roadmap: first power, flagged');
  eq(modulePower({ wp: 610 }).wp, 610, 'a module without roadmap keeps its power');
});

await test('powers older than six months raise the alert', () => {
  const now = new Date('2026-09-25T12:00:00');
  assert(!powerAge({ importedAt: '2026-09-25' }, now).stale, 'today');
  assert(!powerAge({ importedAt: '2026-04-01' }, now).stale, 'less than six months');
  const a = powerAge({ importedAt: '2026-03-01' }, now);
  assert(a.stale && a.days > STALE_DAYS, `seven months: ${a.days} days`);
  assert(!powerAge({ wp: 600 }, now).stale, 'no loading date: no alert');
});

// ── the group roadmap by semester (synthetic sheet shaped like « Roadmap Module- Standard») ──
const COL = /^\s*CS\s*-\s*PPA FR et EU\s*$/i;
function block(period, rows) {
  return [['Date', period], ...rows, []];
}
const types = ['Type de projets', 'Bâtiment - CRE', 'CS - PPA FR et EU', 'CS - PPA FR et EU', 'CS - CRE First Solar'];
const dims = ['Dimensions (mm)', '1762*1134', '2278*1134', '2382*1134', '2024*1245'];
const sheetStd = [
  ['ROADMAP Modules (prix / puissances)'],
  ['Date', 2022, '', '', 2022, 2023],                               // older layout: no matching column
  ['Type de projets', 'Sol CRE', 'PPA France et Europe'], ['Puissance (Wc) biface', 400, '-'], ['Dimensions (mm)', '2278*1134', '2278*1134'], [],
  ...block('S1 2026', [types, ['Techno module', 'TOPCon', 'Mono PERC', 'TOPCon', 'CDTe'], ['Puissance (Wc) monoface', 470, '', '-', '-'],
    ['Puissance (Wc) biface', 460, 555, 601, 475], ['Prix € DDP  Biface', 0.1, 0.1, 0.1, 0.2], dims]),
  ...block('S2 2026', [types, ['Puissance (Wc) biface / monoface AE', 465, 556, 602, 475], dims]),
  ...block(' S1 2027', [types, ['Puissance (Wc) biface ', 470, '', 603, 475], dims]),
  ...block('2029', [types, ['Puissance (Wc) biface', 490, '', 609, 475], dims]),
];
await test('roadmap by semester: the column «CS - PPA FR et EU» of the 2382 × 1134 module', () => {
  const r = parseSemesterRoadmap(sheetStd, { column: COL, ...M });
  eq(r.powers, [['2026-S1', 601], ['2026-S2', 602], ['2027-S1', 603], ['2029', 609]], 'powers (never the 2278 column, never prices)');
  eq(r.column, 'CS - PPA FR et EU', 'column');
  eq(parseSemesterRoadmap(sheetStd, { column: COL, length: 2.465, width: 1.134 }).powers, [], 'another size finds nothing');
});

await test('roadmap workbook: visible standard sheet first, NZIA only as a fallback, hidden sheets ignored', () => {
  const nzia = [...block('S1 2027', [types, ['Puissance (Wc) biface', 455, '', 620, ''], dims]), ...block('S2 2027', [types, ['Puissance (Wc) biface', 455, '', 620, ''], dims]),
    ...block('S1 2028', [types, ['Puissance (Wc) biface', 455, '', 620, ''], dims]), ...block('S2 2028', [types, ['Puissance (Wc) biface', 455, '', 620, ''], dims])];
  const hidden = [...sheetStd, ...block('S1 2030', [types, ['Puissance (Wc) biface', 1, 1, 999, 1], dims])];
  const target = catalogModules();
  const got = readGroupRoadmap([{ name: 'Roadmap Module - Critères NZIA', aoa: nzia }, { name: ' Roadmap Module- Standard', aoa: sheetStd },
    { name: 'Modules date', aoa: hidden, hidden: true }], target);
  eq(got.length, 1, 'one catalog module with a roadmap column');
  eq(got[0].sheet, ' Roadmap Module- Standard', 'standard sheet');
  eq(got[0].powers.length, 4, 'periods');
  const onlyNzia = readGroupRoadmap([{ name: 'Roadmap Module - Critères NZIA', aoa: nzia }], target);
  eq(onlyNzia[0].powers[0], ['2027-S1', 620], 'NZIA when it is the only one');
});

// ── Excel and CSV readers ──
// a minimal .xlsx written here: sheets = [{ name, state, rows: [[value | { f, v } | { rich: [..] } | { inline }]] }]
async function makeXlsx(sheets, { prefix = '' } = {}) {
  const JSZip = await loadJsZip();
  const zip = new JSZip(), strings = [], p = prefix ? prefix + ':' : '', xmlns = prefix ? `xmlns:${prefix}` : 'xmlns';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const col = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const cell = (v, ref) => {
    if (v === '' || v == null) return '';
    if (typeof v === 'number') return `<${p}c r="${ref}"><${p}v>${v}</${p}v></${p}c>`;
    if (typeof v === 'boolean') return `<${p}c r="${ref}" t="b"><${p}v>${v ? 1 : 0}</${p}v></${p}c>`;
    if (v.f) return `<${p}c r="${ref}"${typeof v.v === 'string' ? ' t="str"' : ''}><${p}f>${esc(v.f)}</${p}f><${p}v>${esc(v.v)}</${p}v></${p}c>`;
    if (v.inline) return `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t>${esc(v.inline)}</${p}t></${p}is></${p}c>`;
    const si = v.rich ? `<${p}si>${v.rich.map(r => `<${p}r><${p}t xml:space="preserve">${esc(r)}</${p}t></${p}r>`).join('')}<${p}rPh sb="0" eb="1"><${p}t>ヨミ</${p}t></${p}rPh></${p}si>`
      : `<${p}si><${p}t xml:space="preserve">${esc(v)}</${p}t></${p}si>`;
    strings.push(si);
    return `<${p}c r="${ref}" t="s"><${p}v>${strings.length - 1}</${p}v></${p}c>`;
  };
  sheets.forEach((sh, k) => {
    const rows = sh.rows.map((row, r) => row.some(v => v !== '' && v != null)
      ? `<${p}row r="${r + 1}">${row.map((v, c) => cell(v, col(c) + (r + 1))).join('')}</${p}row>` : '').join('');
    zip.file(`xl/worksheets/sheet${k + 1}.xml`, `<?xml version="1.0"?><${p}worksheet ${xmlns}="${NS}"><${p}sheetData>${rows}</${p}sheetData></${p}worksheet>`);
  });
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><${p}workbook ${xmlns}="${NS}" xmlns:r="${R}"><${p}sheets>${sheets.map((sh, k) =>
    `<${p}sheet name="${esc(sh.name)}" sheetId="${k + 1}"${sh.state ? ` state="${sh.state}"` : ''} r:id="rId${k + 1}"/>`).join('')}</${p}sheets></${p}workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((sh, k) =>
    `<Relationship Id="rId${k + 1}" Type="${R}/worksheet" Target="${k % 2 ? '/xl/' : ''}worksheets/sheet${k + 1}.xml"/>`).join('')}</Relationships>`);
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0"?><${p}sst ${xmlns}="${NS}">${strings.join('')}</${p}sst>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

await test('Excel reader: text (shared, rich, inline), numbers, booleans, formula results, gaps, hidden sheets', async () => {
  eq(['A1', 'Z9', 'AA1', 'AB12', 'XFD1'].map(columnIndex), [0, 25, 26, 27, 16383], 'column letters');
  const rows = [['Name', 'Wp', '', 'Ok'], [{ rich: ['TOP', 'Con'] }, 650, '', true], [], [{ inline: 'a_x000D_b' }, { f: 'B2+1', v: 651 }, { f: 'A1', v: 'Name' }, false]];
  for (const prefix of ['', 'x']) {
    const book = await readWorkbook(await makeXlsx([{ name: 'Visible', rows }, { name: 'Old', state: 'hidden', rows: [[1]] }, { name: 'VH', state: 'veryHidden', rows: [[2]] }], { prefix }));
    eq(book.map(s => [s.name, s.hidden]), [['Visible', false], ['Old', true], ['VH', true]], 'sheets ' + prefix);
    eq(book[0].aoa, [['Name', 'Wp', '', 'Ok'], ['TOPCon', 650, '', true], ['', '', '', ''], ['a\rb', 651, 'Name', false]], 'values ' + prefix);
  }
  let err = null;
  try { await readWorkbook(new TextEncoder().encode('not a zip').buffer); } catch (e) { err = e.message; }
  assert(/xlsx/.test(err || ''), 'a file that is not a workbook is refused: ' + err);
});

await test('roadmap workbook read from a real .xlsx file: same powers as the rows', async () => {
  const buf = await makeXlsx([{ name: 'Roadmap Module - Critères NZIA', rows: [['Date', 'S1 2030']] }, { name: ' Roadmap Module- Standard', rows: sheetStd },
    { name: 'Modules date', state: 'hidden', rows: sheetStd }]);
  const sheets = await readRoadmapSheets(new File([buf], 'roadmap.xlsm'));
  const got = readGroupRoadmap(sheets, catalogModules());
  eq(got[0].sheet, ' Roadmap Module- Standard', 'standard sheet');
  eq(got[0].powers, [['2026-S1', 601], ['2026-S2', 602], ['2027-S1', 603], ['2029', 609]], 'powers');
  eq(await readRoadmapSheets(new File(['x'], 'old.xls')), null, 'an .xls is refused with a message');
});

await test('Excel writer: values, bold rows, awkward sheet names; read back by the reader', async () => {
  const blob = await writeWorkbook([{ name: 'Summary', rows: [['Item', 'Qty'], ['Fence <A> & "B"', 1600.5], [], ['ctrl\u0001char', -0.25]], bold: [0], widths: [20, 8], freeze: true },
    { name: 'a/b:c*?[x]' + 'y'.repeat(40), rows: [[1, 2, 3]] }, { name: 'Summary', rows: [['dup']] }]);
  const book = await readWorkbook(await blob.arrayBuffer());
  eq(book.map(b => b.name), ['Summary', 'a b c   x ' + 'y'.repeat(21), 'Summary 2'], 'sheet names');
  eq(book[0].aoa, [['Item', 'Qty'], ['Fence <A> & "B"', 1600.5], ['', ''], ['ctrlchar', -0.25]], 'values');
});

await test('dBase and shapefile writers: UTF-8 text cut on a character, numbers, index offsets', () => {
  const dbf = new Uint8Array(writeDbf([{ name: 'é'.repeat(200), n: 1.5, k: 3 }, { name: 'x', n: null, k: 12 }]));
  const dv = new DataView(dbf.buffer);
  eq([dbf[0], dv.getUint32(4, true), dv.getUint16(8, true)], [3, 2, 32 + 32 * 3 + 1], 'header');
  const field = i => [new TextDecoder().decode(dbf.slice(32 + 32 * i, 32 + 32 * i + 11)).replace(/\0+$/, ''), String.fromCharCode(dbf[32 + 32 * i + 11]), dbf[32 + 32 * i + 16], dbf[32 + 32 * i + 17]];
  eq([field(0), field(1), field(2)], [['NAME', 'C', 254, 0], ['N', 'N', 19, 1], ['K', 'N', 19, 0]], 'fields');
  const rec = new TextDecoder().decode(dbf.slice(32 + 32 * 3 + 1 + 1, 32 + 32 * 3 + 1 + 1 + 254));
  assert(rec.trim() === 'é'.repeat(127) && !rec.includes('�'), 'text cut at 254 bytes on a character');
  eq(dbf.at(-1), 0x1a, 'end of file');
  const { shp, shx } = writeShp('polyline', [{ parts: [[[0, 0], [10, 0]], [[0, 5], [3, 4], [6, 5]]] }, { parts: [[[1, 1], [2, 2]]] }]);
  const s = new DataView(shp), x = new DataView(shx);
  eq([s.getInt32(0, false), s.getInt32(24, false) * 2, s.getInt32(32, true), s.getFloat64(36, true), s.getFloat64(52, true)], [9994, shp.byteLength, 3, 0, 10], 'shp header');
  eq([x.getInt32(100, false), x.getInt32(108, false)], [50, 50 + 4 + (44 + 8 + 16 * 5) / 2], 'record offsets in 16-bit words');
});

await test('GeoPackage geometry: holes go to the outer ring holding them, OGC orientation, WKB sizes', () => {
  const sq = (x, y, d, cw) => { const r = [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]; return cw ? r.reverse() : r; };
  // ESRI rings: two outer rings (clockwise), a hole (anticlockwise) inside the second one, listed first
  const polys = polygonsOf([sq(12, 2, 2, false), sq(0, 0, 4, true), sq(10, 0, 6, true)]);
  eq(polys.map(p => p.length), [1, 2], 'hole in the second polygon');
  const sa = r => r.slice(1).reduce((a, p, k) => a + r[k][0] * p[1] - p[0] * r[k][1], 0) / 2;
  assert(polys.every(p => sa(p[0]) > 0 && p.slice(1).every(h => sa(h) < 0)), 'outer anticlockwise, holes clockwise');
  const w = toWkb({ type: 'polygon', parts: [sq(12, 2, 2, false), sq(0, 0, 4, true), sq(10, 0, 6, true)] });
  eq([w.type, w.wkb.length, w.box], ['MULTIPOLYGON', 9 + (9 + 4 + 5 * 16) + (9 + 4 + 5 * 16 + 4 + 5 * 16), [0, 0, 16, 6]], 'multipolygon');
  eq([toWkb({ type: 'point', parts: [[[3, 4]]] }).wkb.length, toWkb({ type: 'polyline', parts: [[[0, 0], [1, 1]]] }).type], [21, 'MULTILINESTRING'], 'point and lines');
});

await test('CSV (RFC 4180): quoted separators, doubled quotes, line breaks in quotes, BOM, CRLF', () => {
  eq(detectSeparator('name;"a,b,c";x\n1;2;3'), ';', 'semicolon despite commas in quotes');
  eq(detectSeparator('a\tb\tc'), '\t', 'tab');
  eq(parseCsv('﻿name,note,x\r\n"Pole ""A""","line 1\nline 2, still",12.5\r\n\r\n plain , "",3\n'),
    [['name', 'note', 'x'], ['Pole "A"', 'line 1\nline 2, still', '12.5'], ['plain', '', '3']], 'rows');
  eq(parseCsv('a;b\n"1;5";2'), [['a', 'b'], ['1;5', '2']], 'separator inside quotes');
  eq(parseCsv('Wp,Length\n650,2382'), [['Wp', 'Length'], ['650', '2382']], 'no trailing line break');
});

await test('vendored libraries load from app/vendor (no CDN)', async () => {
  const [JSZip, tg, shp, GeoTIFF, JsPDF] = await Promise.all([loadJsZip(), loadToGeoJSON(), loadShp(), loadGeoTiff(), loadJsPdf()]);
  assert(typeof JSZip.loadAsync === 'function', 'JSZip');
  assert(typeof tg.kml === 'function', 'togeojson');
  assert(typeof shp.parseShp === 'function' && typeof shp.parseDbf === 'function', 'shpjs');
  assert(typeof GeoTIFF.fromBlob === 'function', 'geotiff');
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  assert(doc.output('arraybuffer').byteLength > 500, 'jsPDF');
  const v = await (await fetch('../app/vendor/versions.json')).json();
  return Object.values(v).map(m => `${m.package}@${m.version}`).join(', ');
});

// ── catalog: group standards and country values ──
await test('catalog: standard module and structures of the group', () => {
  const m = catalogModules()[0];
  assert(m.length === 2.382 && m.width === 1.134 && m.bifacial, 'module 2382 x 1134 bifacial');
  eq(modulePower(m, '2026-S2').wp, 650, 'S2 2026 power of the roadmap');
  eq(standardFor('ground-fixed').structure, '3V9', 'ground-mounted standard');
  eq(standardFor('agri-tracker').structure, '1V28', 'tracker standard');
  assert(standardFor('agri-tracker').pitch === null, 'tracker pitch: agreed with the farm');
  eq(parseNotation('3V9').across * parseNotation('3V9').along, 27, '3V9 = 27 modules');
});

await test('catalog: country values are never borrowed', () => {
  eq(countryValue('IT', 'fixed.maxShadingAngleDeg').value, 29, 'Italy');
  eq(countryValue('FR', 'fixed.maxShadingAngleDeg').value, 35, 'France');
  for (const iso of ['PL', 'ES', 'DE', 'CH', 'US', null]) eq(countryValue(iso, 'fixed.maxShadingAngleDeg'), null, `no rule for ${iso}`);
  eq(countryValue('IT', 'tracker.pitchExamples').value, [5.5, 6], 'Italian tracker pitches');
});

await test('slope limits: fixed 3V 10 % N-S and E-W; fixed 2V, AgriPV fixed and tracker 1V 15 % any direction', () => {
  const f = slopeLimitFor('ground-fixed', parseNotation('3V9'));
  assert(f && f.maxNS === 10 && f.maxEW === 10 && f.maxAny == null, 'fixed 3V');
  const t = slopeLimitFor('agri-tracker', parseNotation('1V28'));
  assert(t && t.maxAny === 15, 'tracker 1V');
  const f2 = slopeLimitFor('ground-fixed', parseNotation('2V13'));
  assert(f2 && f2.id === 'fixed-2v' && f2.maxAny === 15 && f2.maxNS == null, 'fixed 2V');
  for (const n of ['2V9', '3H8', '10H1']) eq(slopeLimitFor('agri-fixed', parseNotation(n))?.maxAny, 15, 'AgriPV fixed ' + n);
  eq(slopeLimitFor('ground-fixed', parseNotation('4H6')), null, 'a fixed structure without a rule');
});

// ── structures ──
await test('Italian toolkit: pitch at a 29° shading angle (2V 6.85 m, 3V 10.30 m)', () => {
  const a = countryValue('IT', 'fixed.maxShadingAngleDeg').value;
  near(minPitch(tableGeometry({ notation: '3V9', module: M, tiltDeg: 15 }), a), 10.30, 0.005, '3V');
  near(minPitch(tableGeometry({ notation: '2V13', module: M, tiltDeg: 15 }), a), 6.85, 0.01, '2V');
  return '3V 10.297 · 2V 6.855';
});

await test('trackers: length with the drive gap (1V27 = 32.33 m of the IT drawing), 4 in line, half 1V14', () => {
  const p28 = presetFor('agri-tracker', '1V28'), p27 = presetFor('agri-tracker', '1V27');
  near(tableGeometry({ notation: '1V27', module: M, extraLength: p27.driveGap }).tableLength, 32.33, 0.005, '1V27');
  near(tableGeometry({ notation: '1V28', module: M, extraLength: p28.driveGap }).tableLength, 33.482, 0.001, '1V28');
  eq(tableGeometry({ notation: '1V28', module: M }).planDepth, 2.382, 'flat: plan depth = module length');
  eq(p28.corridor, { tables: 4, width: 4 }, 'corridor after 4 trackers');
  eq(p28.tableGap, 0.5, 'gap between trackers in line');
  eq(halfNotation(p28).notation, '1V14', 'half tracker');
  eq(halfNotation(presetFor('ground-fixed', '3V9')), null, '3V9 is never split');
  eq(presetFor('ground-fixed', '3V9').half, false, '3V9: half false in the catalog');
  assert(!p28.verify, '1V28 values confirmed');
});

// ── modules travel with the project ──
await test('modules are written into the project and adopted on another computer', () => {
  library.modules = [];
  seedCatalogModules();
  assert(moduleById('std-topcon-2382'), 'catalog module seeded');
  eq(defaultModuleId(defaultProject()), 'std-topcon-2382', 'default module: the group standard');
  const p = defaultProject();
  library.modules.push({ id: 'm1', manufacturer: 'Acme', model: 'X', wp: 600, length: 2.278, width: 1.134, bifacial: true, source: 'manual' });
  p.plannedModules = ['m1']; p.field.moduleId = 'std-topcon-2382';
  const defs = usedModules(p);
  eq(defs.map(m => m.id).sort(), ['m1', 'std-topcon-2382'], 'planned and chosen modules');
  library.modules = [];                       // another computer
  const q = { ...p, moduleDefs: defs };
  eq(adoptProjectModules(q), 2, 'adopted');
  assert(moduleById('m1').wp === 600 && moduleById('std-topcon-2382').powers.length === 10, 'same modules');
  eq(adoptProjectModules(q), 0, 'nothing new the second time');
  // a newer loading of the roadmap wins over an older copy
  moduleById('std-topcon-2382').importedAt = '2026-01-01';
  eq(adoptProjectModules(q), 1, 'the project carries a newer loading');
  store.project = defaultProject();
});

// every module of the app loads (the app page itself needs a map: check it in a browser)
await test('every app module loads', async () => {
  const names = ['areas', 'edit', 'field', 'output', 'modules', 'quick', 'infra', 'categories', 'crs', 'catalog', 'state', 'i18n', 'io/importers', 'io/projectfile', 'io/xlsx', 'io/xlsxwrite', 'io/csv', 'libs', 'report', 'export/model', 'export/shp', 'export/gpkg', 'export/dxf', 'export/boq', 'ui/basemap', 'view3d/sun', 'view3d/geometry', 'view3d/model', 'view3d/glb', 'view3d/scene',
    'geo/convert', 'geo/localframe', 'layout/rows', 'layout/structures', 'ui/tabs', 'ui/ribbon', 'ui/catmenu', 'ui/visibility', 'ui/statusbar', 'ui/search', 'ui/geosearch', 'ui/layermenu', 'ui/mapnav', 'io/names', 'ui/snapping', 'ui/crsdialog', 'ui/toast', 'terrain/slope', 'terrain/terrain', 'terrain/dtm', 'terrain/store'];
  const missing = [];
  for (const n of names) {
    const r = await fetch(`../app/js/${n}.js`);
    if (!r.ok) { missing.push(n); continue; }
    await import(`../app/js/${n}.js`);
  }
  assert(!missing.length, 'missing: ' + missing.join(', '));
  return `${names.length - missing.length} modules`;
});

const ok = results.filter(r => r.ok).length;
document.getElementById('sum').innerHTML = `<b class="${ok === results.length ? 'ok' : 'err'}">${ok} / ${results.length} passed</b>`;
document.getElementById('out').innerHTML = results.map(r => `<tr><td class="s ${r.ok ? 'ok' : 'err'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}<br><code>${String(r.note).replace(/</g, '&lt;')}</code></td></tr>`).join('');
window.__results = results;
