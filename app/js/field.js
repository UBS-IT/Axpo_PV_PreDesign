// Field: parameters, parametric generation (area -> rows of tables), map rendering, results and warnings.
import { getSdk } from './sdk.js';
import { store, change, on, emit, saveSoon } from './state.js';
import { t, tn, fmt } from './i18n.js';
import { parseNotation, tableGeometry, minPitch, shadingAngleDeg, gcr, halfNotation } from './layout/structures.js';
import { fillRows, tablesPerBlock, corridorRects } from './layout/rows.js';
import { structurePresets, presetFor, def, rule, standardFor, countryValue, countryName } from './catalog.js';
import { library, moduleById, moduleLabel, modulePower, modulePeriods, periodLabel, periodOf, powerAge, defaultModuleId } from './modules.js';
import { siteFrame, computeArea, crsState } from './areas.js';
import { ringsOf } from './geo/localframe.js';
import { toast } from './ui/toast.js';

// Defaults when the technology changes: the group standard of the catalog, else these
const TECH_FALLBACK = {
  'ground-fixed': { tiltDeg: 15, azimuthDeg: 180, structure: '3V9' },
  'agri-fixed': { tiltDeg: 20, azimuthDeg: 180, structure: '2V9' },
  'agri-tracker': { tiltDeg: 0, azimuthDeg: 90, structure: '1V28' },
};
const TABLE_SYMBOL = { type: 'simple-fill', color: [57, 69, 207, 0.78], outline: { color: [255, 255, 255, 0.55], width: 0.4 } };
const HALF_SYMBOL = { type: 'simple-fill', color: [110, 120, 235, 0.72], outline: { color: [255, 255, 255, 0.55], width: 0.4 } };
const AREA_SYMBOL = { type: 'simple-fill', color: [45, 190, 126, 0.07], outline: { color: [45, 190, 126], width: 1.5, style: 'dash' } };

let view, areaLayer, tableLayer;
export const last = { result: null };
const $ = id => document.getElementById(id);

// The group standard of a technology put into the field: structure, tilt, azimuth and the preset values
// (the pitch of trackers is agreed with the farm: it is cleared)
export function applyStandard(f, technology) {
  f.technology = technology;
  const std = { ...TECH_FALLBACK[technology], ...(standardFor(technology) || {}) };
  f.structure = std.structure;
  f.tiltDeg = technology === 'agri-tracker' ? 0 : std.tiltDeg;
  f.azimuthDeg = std.azimuthDeg;
  if (technology === 'agri-tracker') f.pitch = null;
  applyPreset(f, presetFor(technology, f.structure));
  if (technology === 'agri-tracker') f.tiltDeg = 0;
}

// Toolkit minimum pitch of the field as it is: fixed structures from the shading angle of the country of the site,
// others from their preset. { pitch (rounded up to the cm), source: 'country' | 'preset', angle, country } or null
export function toolkitMinPitch(f = store.project.field) {
  const s = parseNotation(f.structure), mod = moduleById(f.moduleId);
  const pre = s ? presetFor(f.technology, s.notation) : null;
  if (f.technology === 'ground-fixed') {
    const shade = shadingRule();
    if (!shade || !s || !mod) return null;
    const g = tableGeometry({ notation: s, module: mod, moduleGap: f.moduleGap, tiltDeg: f.tiltDeg, extraLength: pre?.driveGap || 0 });
    return { pitch: Math.ceil(minPitch(g, shade.value) * 100) / 100, source: 'country', angle: shade.value, country: countryName(crsState.iso) };
  }
  if (f.technology === 'agri-fixed' && pre?.minPitch) return { pitch: pre.minPitch, source: 'preset', id: pre.id };
  return null;
}

// Structure preset values that go into the field: tilt, azimuth, gap between tables, corridors
function applyPreset(f, pre) {
  if (!pre) return;
  if (pre.tiltDeg != null) f.tiltDeg = pre.tiltDeg;
  if (pre.azimuthDeg != null) f.azimuthDeg = pre.azimuthDeg;
  f.tableGap = pre.tableGap ?? def('tableGap', 0.3);
  if (pre.corridor) f.tracks = { ...f.tracks, enabled: true, tables: pre.corridor.tables ?? null, width: pre.corridor.width ?? f.tracks.width };
  else f.tracks = { ...f.tracks, tables: null };
  if (!pre.half) f.halfTables = false;
}

export function initField(mapView) {
  view = mapView;
  const { GraphicsLayer } = getSdk();
  areaLayer = new GraphicsLayer({ title: 'Buildable area' });
  tableLayer = new GraphicsLayer({ title: 'Tables' });
  view.map.addMany([areaLayer, tableLayer]);

  const set = (fn) => change('field', p => fn(p.field));
  const num = el => (el.value === '' ? null : Number(el.value));
  $('fTech').onchange = () => set(f => applyStandard(f, $('fTech').value));
  $('fStruct').onchange = () => set(f => {
    f.structure = $('fStruct').value.trim();
    applyPreset(f, presetFor(f.technology, f.structure));
    if (f.technology === 'agri-tracker') f.tiltDeg = 0;
  });
  $('fStruct').oninput = () => structureHint($('fStruct').value);
  $('fModule').onchange = () => set(f => { f.moduleId = $('fModule').value || null; });
  $('fPeriod').onchange = () => set(f => { f.powerPeriod = $('fPeriod').value || null; });
  $('fTilt').onchange = () => set(f => { f.tiltDeg = num($('fTilt')) ?? 0; });
  $('fAz').onchange = () => set(f => { f.azimuthDeg = num($('fAz')) ?? 180; });
  $('fPitch').onchange = () => set(f => { f.pitch = num($('fPitch')); });
  $('fTableGap').onchange = () => set(f => { f.tableGap = Math.max(0, num($('fTableGap')) ?? 0); });
  $('fModGap').onchange = () => set(f => { f.moduleGap = Math.max(0, num($('fModGap')) ?? 0); });
  $('fTracks').onchange = () => set(f => { f.tracks.enabled = $('fTracks').checked; });
  $('fTrackEvery').onchange = () => set(f => { f.tracks.spacing = Math.max(1, num($('fTrackEvery')) ?? 100); f.tracks.tables = null; });
  $('fTrackTables').onchange = () => set(f => { const n = num($('fTrackTables')); f.tracks.tables = n > 0 ? Math.round(n) : null; });
  $('fTrackWidth').onchange = () => set(f => { f.tracks.width = Math.max(0, num($('fTrackWidth')) ?? 0); });
  $('fHalf').onchange = () => set(f => { f.halfTables = $('fHalf').checked; });
  $('fTarget').onchange = () => set(f => { f.targetMWp = num($('fTarget')); });
  $('fRowOff').onchange = () => set(f => { f.rowOffset = Math.max(0, num($('fRowOff')) ?? 0); });
  $('fColOff').onchange = () => set(f => { f.columnOffset = Math.max(0, num($('fColOff')) ?? 0); });
  $('fOptimise').onclick = optimise;
  $('fPitchHint').onclick = e => {
    const b = e.target.closest('button[data-pitch]');
    if (b) set(f => { f.pitch = Number(b.dataset.pitch); });
  };
  $('specYield').onchange = () => change('yield', p => { p.specificYield = num($('specYield')); });

  for (const topic of ['site', 'settings', 'field', 'modules', 'project', 'crs', 'terrain', 'infra']) on(topic, () => { syncInputs(); schedule(); });
  on('yield', () => renderResults(last.result));
  syncInputs();
  schedule();
}

// ── inputs ──
function syncInputs() {
  const f = store.project.field;
  $('fTech').value = f.technology;
  const dl = $('structPresets');
  dl.innerHTML = structurePresets(f.technology).map(s => `<option value="${escapeHtml(s.notation)}">${escapeHtml(s.label)}${s.verify ? ' (to verify)' : ''}</option>`).join('');
  if (document.activeElement !== $('fStruct')) $('fStruct').value = f.structure;
  structureHint(f.structure);
  // modules: planned first; a module of the project missing from the library is never replaced silently
  const planned = new Set(store.project.plannedModules);
  const pl = library.modules.filter(m => planned.has(m.id)), rest = library.modules.filter(m => !planned.has(m.id));
  const opt = m => `<option value="${m.id}">${escapeHtml(moduleLabel(m, f.powerPeriod))}</option>`;
  const missing = f.moduleId && !moduleById(f.moduleId);
  $('fModule').innerHTML = (missing ? `<option value="${escapeHtml(f.moduleId)}">${escapeHtml(t('field.moduleMissing'))}</option>` : '')
    + (library.modules.length
      ? (pl.length ? `<optgroup label="${escapeHtml(t('mod.planned'))}">${pl.map(opt).join('')}</optgroup>` : '')
        + (rest.length ? `<optgroup label="${escapeHtml(t('mod.title'))}">${rest.map(opt).join('')}</optgroup>` : '')
      : `<option value="">${escapeHtml(t('field.noModule'))}</option>`);
  if (f.moduleId) $('fModule').value = f.moduleId;
  else {   // no module chosen yet: the group standard, else the first planned one
    const first = defaultModuleId();
    if (first) { $('fModule').value = first; f.moduleId = first; saveSoon(); }
  }
  // power period (modules with a roadmap)
  const mod = moduleById(f.moduleId), periods = modulePeriods(mod);
  $('fPeriodBox').hidden = !periods.length;
  if (periods.length) {
    const cur = modulePower(mod, null);
    $('fPeriod').innerHTML = `<option value="">${escapeHtml(t('field.periodNow', { period: periodLabel(periodOf()), wp: fmt(cur.wp) }))}</option>`
      + periods.map(p => `<option value="${p}">${escapeHtml(`${periodLabel(p)} · ${fmt(modulePower(mod, p).wp)} Wp`)}</option>`).join('');
    $('fPeriod').value = f.powerPeriod && periods.includes(f.powerPeriod) ? f.powerPeriod : '';
  }
  const tracker = f.technology === 'agri-tracker';
  $('fTiltBox').style.visibility = tracker ? 'hidden' : '';
  $('fTilt').value = f.tiltDeg;
  $('fAz').value = f.azimuthDeg;
  if (document.activeElement !== $('fPitch')) $('fPitch').value = f.pitch ?? '';
  $('fTableGap').value = f.tableGap;
  $('fModGap').value = f.moduleGap;
  $('fTracks').checked = !!f.tracks.enabled;
  $('fTrackEvery').value = f.tracks.tables ? '' : f.tracks.spacing;
  $('fTrackTables').value = f.tracks.tables ?? '';
  $('fTrackWidth').value = f.tracks.width;
  const pre = presetFor(f.technology, f.structure), half = halfNotation(pre);
  $('fHalf').checked = !!f.halfTables && !!half;
  $('fHalf').disabled = !half;
  $('fHalfHint').textContent = half ? t('field.halfOk', { half: half.notation }) : t(pre?.half === false ? 'field.halfNever' : 'field.halfNone', { structure: f.structure });
  $('fTarget').value = f.targetMWp ?? '';
  $('fRowOff').value = f.rowOffset;
  $('fColOff').value = f.columnOffset;
  $('specYield').value = store.project.specificYield ?? '';
}

function structureHint(text) {
  const s = parseNotation(text), f = store.project.field, mod = moduleById(f.moduleId), el = $('fStructHint');
  if (!s) { el.textContent = t('field.structureBad'); return; }
  if (!mod) { el.textContent = t('field.structureHint'); return; }
  const pre = presetFor(f.technology, s.notation);
  const g = tableGeometry({ notation: s, module: mod, moduleGap: f.moduleGap, tiltDeg: f.technology === 'agri-tracker' ? 0 : f.tiltDeg, extraLength: pre?.driveGap || 0 });
  el.textContent = t('field.structureParsed', { across: s.across, along: s.along, orientation: t('orientation.' + s.orientation),
    modules: g.modules, length: fmt(g.tableLength, 2), depth: fmt(g.planDepth, 2) })
    + (pre?.driveGap ? ' ' + t('field.driveGap', { gap: fmt(pre.driveGap, 2) }) : '');
}

// Shading angle of fixed structures in the country of the site: { value, source } or null
function shadingRule() {
  return crsState.iso ? countryValue(crsState.iso, 'fixed.maxShadingAngleDeg') : null;
}

// ── generation ──
let timer = 0;
function schedule() { clearTimeout(timer); timer = setTimeout(generate, 120); }
// regenerate now (instead of after the short delay that gathers the changes); returns the result
export function generateNow() { clearTimeout(timer); generate(); return last.result; }

function setup() {
  const p = store.project, f = p.field;
  const warns = [];
  const frame = siteFrame();
  if (!frame) return { warns: [t('warn.noSite')] };
  const area = computeArea(frame);
  if (area.error) return { warns: [t('warn.noSite')] };
  if (area.ignored) warns.push(tn('warn.lineNoBuffer', area.ignored));
  for (const w of area.notes || []) warns.push(w);
  for (const x of area.extras || []) if (x.kind === 'slope' && x.area >= 5) warns.push(t('warn.slopeCut', { ha: fmt(x.area / 1e4, 2), rule: x.label }));
  const mod = moduleById(f.moduleId);
  const s = parseNotation(f.structure);
  if (!mod) warns.push(t(f.moduleId ? 'warn.moduleMissing' : 'warn.noModule'));
  if (!s) warns.push(t('warn.badStructure'));
  if (!(f.pitch > 0)) warns.push(t(f.technology === 'agri-tracker' ? 'warn.noPitchTracker' : 'warn.noPitch'));
  if (!area.buildable) warns.push(t('warn.noArea'));
  const tracker = f.technology === 'agri-tracker';
  const pre = s ? presetFor(f.technology, s.notation) : null;
  const extraLength = pre?.driveGap || 0;
  // table geometry is known as soon as structure and module are: the pitch hint needs it even without a pitch
  const hintGeom = mod && s ? tableGeometry({ notation: s, module: mod, moduleGap: f.moduleGap, tiltDeg: tracker ? 0 : f.tiltDeg, extraLength }) : null;
  const power = mod ? modulePower(mod, f.powerPeriod) : null;
  if (mod) {
    const age = powerAge(mod);
    if (age.stale) warns.push(t('warn.powerStale', { module: moduleLabel(mod, f.powerPeriod), date: age.date, months: Math.floor(age.days / 30.4) }));
    if (power.beyond) warns.push(t('warn.periodBeyond', { period: periodLabel(f.powerPeriod || periodOf()), last: periodLabel(power.period), wp: fmt(power.wp) }));
  }
  const base = { frame, area, warns, mod, s, hintGeom, pre, power };
  if (!mod || !s || !(f.pitch > 0) || !area.buildable) return base;
  const geom = hintGeom;
  const opt = { azimuthDeg: f.azimuthDeg, tableLength: geom.tableLength, planDepth: geom.planDepth, pitch: f.pitch,
    tableGap: f.tableGap, rowOffset: f.rowOffset, columnOffset: f.columnOffset };
  if (f.tracks.enabled && f.tracks.width > 0 && (f.tracks.tables > 0 || f.tracks.spacing > 0)) {
    opt.blockTables = f.tracks.tables > 0 ? f.tracks.tables : tablesPerBlock(f.tracks.spacing, geom.tableLength, f.tableGap);
    opt.corridorWidth = f.tracks.width;
  }
  let halfGeom = null;
  const hn = halfNotation(pre);
  if (f.halfTables && hn) {
    halfGeom = tableGeometry({ notation: hn, module: mod, moduleGap: f.moduleGap, tiltDeg: tracker ? 0 : f.tiltDeg, extraLength });
    opt.halfLength = halfGeom.tableLength;
  }
  const wpTable = geom.modules * power.wp;
  if (f.targetMWp > 0) opt.maxTables = Math.ceil(f.targetMWp * 1e6 / wpTable);
  return { ...base, geom, halfGeom, opt, rings: ringsOf(area.buildable), wpTable, tracker };
}

function generate() {
  const { Graphic, Polygon } = getSdk();
  const st = setup();
  areaLayer.removeAll();
  tableLayer.removeAll();
  last.result = null;
  if (st.area && st.area.buildable) {
    areaLayer.add(new Graphic({ geometry: st.frame.toSr(st.area.buildable, view.spatialReference), symbol: AREA_SYMBOL }));
  }
  const f = store.project.field;
  const shade = shadingRule();
  if (!st.geom) {
    renderResults({ area: st.area, warns: st.warns });
    updatePitchHint(st.hintGeom && f.technology === 'ground-fixed' && shade ? minPitch(st.hintGeom, shade.value) : null, st.pre, shade);
    emit('layout');
    return;
  }
  const t0 = performance.now();
  const res = fillRows(st.rings, st.opt);
  const tFill = performance.now() - t0;
  // tables to the map (rings clockwise, as ArcGIS expects)
  const polys = res.tables.map(tb => new Polygon({ rings: [[tb.corners[0], tb.corners[3], tb.corners[2], tb.corners[1], tb.corners[0]]], spatialReference: st.frame.sr }));
  const inView = polys.length ? st.frame.toSrMany(polys, view.spatialReference) : [];
  tableLayer.addMany(inView.map((g, i) => g && new Graphic({ geometry: g, symbol: res.tables[i].half ? HALF_SYMBOL : TABLE_SYMBOL,
    attributes: { row: res.tables[i].row, col: res.tables[i].col } })).filter(Boolean));
  const tDraw = performance.now() - t0 - tFill;

  const halves = res.tables.filter(tb => tb.half).length, whole = res.tables.length - halves;
  const tables = res.tables.length;
  const modules = whole * st.geom.modules + halves * (st.halfGeom ? st.halfGeom.modules : 0);
  const dcMWp = modules * st.power.wp / 1e6;
  const footprint = whole * st.geom.tableLength * st.geom.planDepth + (st.halfGeom ? halves * st.halfGeom.tableLength * st.halfGeom.planDepth : 0);
  const siteArea = st.area.siteArea, cover = footprint / siteArea;
  const warns = [...st.warns];
  const preset = st.pre;
  let minP = null;
  if (f.technology === 'ground-fixed') {
    if (shade) {
      minP = minPitch(st.geom, shade.value);
      if (f.pitch < minP - 0.005) warns.push(t('warn.pitchBelowMin', { pitch: fmt(f.pitch, 2), min: fmt(minP, 2), angle: fmt(shadingAngleDeg(st.geom, f.pitch), 1), max: shade.value, country: countryName(crsState.iso) }));
    }
  } else if (preset && preset.minPitch && f.pitch < preset.minPitch - 0.005) {
    warns.push(t('warn.pitchBelowPreset', { pitch: fmt(f.pitch, 2), min: fmt(preset.minPitch, 2), id: preset.id }));
  }
  const cov = rule('agri-max-coverage');
  if (f.technology !== 'ground-fixed' && cov && cover > cov.value + 1e-9) warns.push(t('warn.coverage', { cov: fmt(cover * 100, 1), max: fmt(cov.value * 100, 0) }));
  if (st.opt.maxTables && tables >= st.opt.maxTables) warns.push(t('warn.target', { mwp: fmt(dcMWp, 2) }));
  const verify = [];
  if (preset && preset.verify) verify.push(preset.id);
  if (f.tracks.enabled && !f.tracks.tables && def('transversalTrack.width') === f.tracks.width) verify.push('track width');
  if (verify.length) warns.push(t('warn.verify', { items: verify.join(', ') }));

  // internal roads: the corridors across the rows, inside the buildable area
  const { Polygon: P2, intersectionOperator, areaOperator } = getSdk();
  const roads = corridorRects(res.grid).map(c => intersectionOperator.execute(new P2({ rings: [[...c, c[0]]], spatialReference: st.frame.sr }), st.area.buildable))
    .filter(g => g && g.rings && g.rings.length);
  const roadsLength = st.opt.corridorWidth > 0 ? roads.reduce((s, g) => s + areaOperator.execute(g), 0) / st.opt.corridorWidth : 0;
  last.result = { area: st.area, warns, tables, halves, modules, dcMWp, rows: res.rows, gcr: gcr(st.geom, f.pitch), roads, roadsLength,
    shading: f.technology === 'agri-tracker' ? null : shadingAngleDeg(st.geom, f.pitch), siteArea, buildableArea: st.area.buildableArea,
    cover, geom: st.geom, halfGeom: st.halfGeom, module: st.mod, power: st.power, frame: st.frame, tablesLocal: res.tables, ms: { fill: tFill, draw: tDraw } };
  window.__last = last.result;   // debug hook
  renderResults(last.result);
  updatePitchHint(minP, preset, shade);
  emit('layout');
}

function updatePitchHint(minP, preset, shade) {
  const el = $('fPitchHint');
  const f = store.project.field;
  let html = '';
  if (minP != null) {
    const v = Math.ceil(minP * 100) / 100;
    html = `${t('field.minPitch', { angle: shade.value, country: escapeHtml(countryName(crsState.iso)), pitch: fmt(v, 2) })} <button class="linkbtn" data-pitch="${v}">${t('field.useMin')}</button>`;
  } else if (f.technology === 'ground-fixed') {
    html = escapeHtml(crsState.iso ? t('field.noShadingRule', { country: countryName(crsState.iso) }) : t('field.noCountry'));
  } else if (f.technology === 'agri-tracker') {
    const ex = crsState.iso ? countryValue(crsState.iso, 'tracker.pitchExamples') : null;
    html = escapeHtml(t('field.trackerPitch')) + (ex ? ' ' + escapeHtml(t('field.trackerPitchEx', { country: countryName(crsState.iso), list: ex.value.map(v => fmt(v, 2)).join(' / ') })) : '');
  } else if (preset && preset.minPitch) {
    html = `${t('field.presetMinPitch', { id: escapeHtml(preset.id), pitch: fmt(preset.minPitch, 2) })} <button class="linkbtn" data-pitch="${preset.minPitch}">${t('field.useMin')}</button>`;
  }
  el.innerHTML = html;
}

// ── results ──
function renderResults(r) {
  const k = $('kpis'), w = $('warns');
  if (!r || r.tables === undefined) {
    const a = r && r.area;
    k.innerHTML = a && a.siteArea
      ? kpi('res.siteArea', `${fmt(a.siteArea / 1e4, 2)} ha`) + kpi('res.buildable', `${fmt((a.buildableArea || 0) / 1e4, 2)} ha`)
      : `<div class="hint" style="grid-column:1/-1">${t('res.none')}</div>`;
    w.innerHTML = (r && r.warns || []).map(x => `<div class="warn">${escapeHtml(x)}</div>`).join('');
    return;
  }
  const y = store.project.specificYield;
  k.innerHTML =
    `<div class="kpi big"><div class="v">${fmt(r.dcMWp, 2)} MWp</div><div class="k">${t('res.dc')} · ${escapeHtml(moduleLabel(r.module, store.project.field.powerPeriod))}</div></div>` +
    kpi('res.tables', r.halves ? `${fmt(r.tables - r.halves)} + ${fmt(r.halves)} ½` : fmt(r.tables)) + kpi('res.modules', fmt(r.modules)) +
    kpi('res.rows', fmt(r.rows)) + kpi('res.gcr', fmt(r.gcr, 3)) +
    (r.shading != null ? kpi('res.shading', `${fmt(r.shading, 1)}°`) : '') +
    kpi('res.coverage', `${fmt(r.cover * 100, 1)} %`) +
    kpi('res.siteArea', `${fmt(r.siteArea / 1e4, 2)} ha`) + kpi('res.buildable', `${fmt(r.buildableArea / 1e4, 2)} ha`) +
    kpi('res.density', `${fmt(r.dcMWp / (r.siteArea / 1e4), 3)} MWp/ha`) +
    (y > 0 ? kpi('res.energy', `${fmt(r.dcMWp * y, 0)} MWh/yr`) : '');
  w.innerHTML = r.warns.map(x => `<div class="warn">${escapeHtml(x)}</div>`).join('');
}
const kpi = (key, v) => `<div class="kpi"><div class="v">${v}</div><div class="k">${t(key)}</div></div>`;

// ── optimise the grid position ──
// Tries 12 × 12 offsets of rows and columns and keeps the one with the most tables. Returns { n, gain } or null.
export function optimise() {
  const st = setup();
  if (!st.geom) { toast(st.warns[0] || t('res.none'), 'err'); return null; }
  const f = store.project.field;
  const step = st.geom.tableLength + f.tableGap;
  const count = opt => fillRows(st.rings, opt).tables.reduce((n, tb) => n + (tb.half ? 0.5 : 1), 0);
  const base = count(st.opt);
  let best = { n: base, row: f.rowOffset, col: f.columnOffset };
  const NR = 12, NC = 12;
  for (let i = 0; i < NR; i++) for (let j = 0; j < NC; j++) {
    const row = +(f.pitch * i / NR).toFixed(3), col = +(step * j / NC).toFixed(3);
    const n = count({ ...st.opt, rowOffset: row, columnOffset: col, maxTables: undefined });
    if (n > best.n) best = { n, row, col };
  }
  change('field', p => { p.field.rowOffset = best.row; p.field.columnOffset = best.col; });
  const gain = best.n - base;
  $('fOptHint').textContent = t('field.optimised', { tables: fmt(best.n, best.n % 1 ? 1 : 0), gain: gain > 0 ? `+${fmt(gain, gain % 1 ? 1 : 0)}` : '±0' });
  return { n: best.n, gain };
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
