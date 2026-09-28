// Modules, the group roadmap by semester, the country catalog and the structures of the group. No SDK needed.
// Run in the browser: /tests/modules.html. window.__results holds the outcome.
import { loadCatalog, countryValue, slopeLimitFor, standardFor, presetFor, catalogModules } from '../app/js/catalog.js';
import { parsePeriod, periodOf, periodLabel, modulePower, powerAge, parseSemesterRoadmap, readGroupRoadmap, library,
  usedModules, adoptProjectModules, seedCatalogModules, moduleById, defaultModuleId, STALE_DAYS } from '../app/js/modules.js';
import { parseNotation, tableGeometry, minPitch, halfNotation } from '../app/js/layout/structures.js';
import { store, defaultProject } from '../app/js/state.js';

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
  const names = ['areas', 'field', 'output', 'modules', 'quick', 'infra', 'categories', 'crs', 'catalog', 'state', 'i18n', 'io/importers', 'io/projectfile',
    'geo/convert', 'geo/localframe', 'layout/rows', 'layout/structures', 'ui/rail', 'ui/crsdialog', 'ui/toast', 'terrain/slope', 'terrain/terrain', 'terrain/dtm', 'terrain/store'];
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
