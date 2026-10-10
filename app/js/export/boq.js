// Bill of quantities for Engineering (Excel): a summary of the layout and of the infrastructure, then one sheet per
// kind of object with its measures (true metres, local frame) and its position in the national system. What the
// predesign does not know (foundations, cables, earthworks) is listed as not included, never estimated.
import { store } from '../state.js';
import { t } from '../i18n.js';
import { crsState } from '../areas.js';
import { countryName } from '../catalog.js';
import { crsLabel } from '../crs.js';
import { moduleLabel } from '../modules.js';
import { toSdk } from '../geo/convert.js';
import { classified } from '../categories.js';
import { getSdk } from '../sdk.js';
import { partsOf } from './model.js';
import { writeWorkbook } from '../io/xlsxwrite.js';

const r2 = (v, d = 2) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const centre = g => {
  const p = partsOf(g);
  if (!p) return [null, null];
  const pts = p.type === 'polygon' ? p.parts[0].slice(0, -1) : p.parts.flat();
  return pts.length ? [r2(pts.reduce((s, q) => s + q[0], 0) / pts.length, 3), r2(pts.reduce((s, q) => s + q[1], 0) / pts.length, 3)] : [null, null];
};
const sum = (arr, k) => arr.reduce((s, x) => s + (x.attrs[k] || 0), 0);

// model (export/model.js) -> the sheets of the workbook
export function boqSheets(model) {
  const P = store.project, r = model.result, f = P.field, L = model.infra;
  const by = layer => model.items.filter(i => i.layer === layer);
  const S = [[t('boq.item'), t('boq.qty'), t('boq.unit'), t('boq.note')]], bold = [0];
  const head = key => { S.push([]); bold.push(S.length); S.push([t(key)]); };
  const row = (label, qty, unit = '', note = '') => S.push([label, qty ?? '—', unit, note]);

  head('boq.sProject');
  row(t('boq.name'), P.name || 'Untitled project');
  row(t('boq.date'), new Date().toISOString().slice(0, 10));
  row(t('boq.country'), countryName(crsState.iso) || '—');
  row(t('boq.crs'), `${crsLabel(model.wkid)} (EPSG:${model.wkid})`, '', t('boq.crsNote'));

  if (r && r.tables) {
    head('boq.sLayout');
    row(t('boq.technology'), t('tech.' + f.technology));
    row(t('boq.structure'), f.structure, '', r.halves ? t('boq.halfNote', { s: r.halfGeom?.notation }) : '');
    row(t('boq.module'), moduleLabel(r.module, f.powerPeriod));
    row(t('boq.power'), r.power?.wp ?? null, 'Wp');
    if (f.technology !== 'agri-tracker') { row(t('boq.tilt'), f.tiltDeg, '°'); row(t('boq.azimuth'), f.azimuthDeg, '°'); }
    row(t('boq.pitch'), r2(f.pitch), 'm');
    row(t('boq.gcr'), r2(r.gcr, 3));
    row(t('boq.tables'), r.tables - (r.halves || 0), t('boq.pcs'), f.structure);
    if (r.halves) row(t('boq.halves'), r.halves, t('boq.pcs'), r.halfGeom?.notation);
    row(t('boq.modules'), r.modules, t('boq.pcs'));
    row(t('boq.dc'), r2(r.dcMWp, 3), 'MWp');
    row(t('boq.site'), r2(r.siteArea / 1e4, 2), 'ha');
    row(t('boq.buildable'), r2(r.buildableArea / 1e4, 2), 'ha');
    if (P.specificYield > 0) row(t('boq.energy'), r2(r.dcMWp * P.specificYield, 0), 'MWh/yr', t('boq.energyNote', { y: P.specificYield }));
  }

  const fences = by('fence'), roads = model.items.filter(i => i.file === 'roads'), stations = by('station'), gates = by('gate');
  if (fences.length || roads.length || stations.length || gates.length) {
    head('boq.sInfra');
    for (const fc of fences) row(t('boq.fenceOf', { letter: fc.attrs.fence, lots: fc.attrs.lots }), r2(fc.attrs.length_m, 0), 'm');
    if (fences.length > 1) row(t('boq.fenceTotal'), r2(sum(fences, 'length_m'), 0), 'm');
    if (gates.length) row(t('boq.gates'), gates.length, t('boq.pcs'), gates[0].attrs.width_m ? t('boq.gateWidth', { w: gates[0].attrs.width_m }) : '');
    for (const kind of [...new Set(roads.map(x => x.attrs.kind))]) {
      const rs = roads.filter(x => x.attrs.kind === kind);
      row(t('boq.road', { kind: t('boq.road.' + kind.replace(/^drawn-/, 'drawn.')) }), r2(sum(rs, 'length_m'), 0), 'm', t('boq.roadArea', { a: Math.round(sum(rs, 'area_m2')) }));
    }
    for (const kind of ['CC', 'CU', 'CT']) {
      const ss = stations.filter(s => s.attrs.kind === kind);
      if (ss.length) row(t('infra.kind.' + kind), ss.length, t('boq.pcs'), `${ss[0].attrs.building} · ${ss[0].attrs.length_m} × ${ss[0].attrs.width_m} m`);
    }
  }
  head('boq.sNot');
  for (const k of ['boq.notFoundations', 'boq.notElectrical', 'boq.notEarthworks']) S.push([t(k)]);
  const checks = [...(r?.warns || []), ...(L?.notes || []).filter(n => !(r?.warns || []).includes(n))];
  if (checks.length) { head('boq.sChecks'); for (const c of checks) S.push([c]); }

  const sheets = [{ name: t('boq.sheetSummary'), rows: S, bold, widths: [44, 14, 8, 60] }];
  const tables = by('tables').concat(by('tables-half'));
  if (tables.length) {
    const rows = [['row', 'col', 'structure', 'half', 'modules', 'kWp', 'X', 'Y']];
    for (const it of tables.sort((a, b) => a.attrs.row - b.attrs.row || a.attrs.col - b.attrs.col)) {
      const a = it.attrs, [x, y] = centre(it.geometry);
      rows.push([a.row, a.col, a.structure, a.half, a.modules, a.kwp, x, y]);
    }
    sheets.push({ name: t('boq.sheetTables'), rows, bold: [0], widths: [6, 6, 10, 6, 9, 9, 14, 14], freeze: true });
  }
  const infra = [...fences, ...roads, ...by('road-axis'), ...stations, ...gates];
  if (infra.length) {
    const rows = [['category', 'kind', 'name', 'length_m', 'area_m2', 'width_m', 'X', 'Y']];
    for (const it of infra) {
      const a = it.attrs, [x, y] = centre(it.geometry);
      rows.push([it.layer, a.kind ?? '', a.fence ? `${a.fence} (${a.lots})` : a.building || a.name || '', a.length_m ?? null, a.area_m2 ?? null, a.width_m ?? null, x, y]);
    }
    sheets.push({ name: t('boq.sheetInfra'), rows, bold: [0], widths: [16, 14, 18, 10, 10, 9, 14, 14], freeze: true });
  }
  // areas of 1 · Areas, measured in the local frame (true metres)
  const feats = classified(P.features);   // objects without a category stay in the app
  if (feats.length && model.frame) {
    const { areaOperator } = getSdk();
    const rows = [['name', 'category', 'type', 'buffer_m', 'area_m2', 'length_m', 'X', 'Y']];
    const byId = new Map(model.items.filter(i => i.file === 'areas').map(i => [i.fid, i]));
    feats.forEach(ft => {
      const g = toSdk(ft.geometry), lg = g && model.frame.toLocal(g);
      const a = lg?.type === 'polygon' ? r2(areaOperator.execute(lg), 0) : null;
      const len = lg?.type === 'polyline' ? r2(lg.paths.reduce((s, p) => s + p.slice(1).reduce((q, v, k) => q + Math.hypot(v[0] - p[k][0], v[1] - p[k][1]), 0), 0), 1) : null;
      const [x, y] = centre(byId.get(ft.id)?.geometry);
      rows.push([ft.name || '', t('cat.' + ft.category), ft.attrs?.type ?? '', ft.attrs?.buffer ?? null, a, len, x, y]);
    });
    sheets.push({ name: t('boq.sheetAreas'), rows, bold: [0], widths: [30, 22, 18, 9, 12, 10, 14, 14], freeze: true });
  }
  return sheets;
}

export const buildBoq = model => writeWorkbook(boqSheets(model));
