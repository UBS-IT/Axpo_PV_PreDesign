// Step 4 · Output: the coordinate system for exports (proposed from the site, with alerts) and the exports.
import { getSdk } from './sdk.js';
import { store, change, on } from './state.js';
import { t, fmt } from './i18n.js';
import { NATIONAL, crsLabel } from './crs.js';
import { crsState } from './areas.js';
import { last } from './field.js';
import { toGeoJSON } from './geo/convert.js';
import { moduleLabel } from './modules.js';
import { layoutInfra } from './infra.js';
import { toast } from './ui/toast.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inLists = w => Object.values(NATIONAL).some(n => n.options.some(([x]) => x === w));

export function initOutput() {
  $('outCrs').onchange = () => {
    const v = $('outCrs').value;
    change('crs', p => {
      if (v === 'auto') { p.crs.auto = true; p.crs.wkid = crsState.suggested; p.crs.country = crsState.iso; }
      else { p.crs.auto = false; p.crs.wkid = Number(v); }
    });
  };
  $('outGeojson').onclick = exportGeoJSON;
  on('crs', renderCrs);
  on('project', renderCrs);
  renderCrs();
}

function renderCrs() {
  const c = store.project.crs, sug = crsState.suggested;
  const opts = [`<option value="auto">${esc(t('out.crsAutoOpt', { label: sug ? `${crsLabel(sug)} · EPSG:${sug}` : t('out.crsNoSite') }))}</option>`];
  for (const n of Object.values(NATIONAL)) {
    opts.push(`<optgroup label="${esc(n.name)}">${n.options.map(([w, l]) => `<option value="${w}">${esc(l)} · EPSG:${w}</option>`).join('')}</optgroup>`);
  }
  // a UTM zone outside the national lists (site in another country)
  const extra = [...new Set([sug, c.wkid].filter(w => w && !inLists(w)))];
  if (extra.length) opts.push(`<optgroup label="${esc(t('out.crsOther'))}">${extra.map(w => `<option value="${w}">${esc(crsLabel(w))} · EPSG:${w}</option>`).join('')}</optgroup>`);
  const sel = $('outCrs');
  sel.innerHTML = opts.join('');
  sel.value = c.auto || !c.wkid ? 'auto' : String(c.wkid);

  const alerts = crsState.alerts.map(a => ({ text: t(a.key, a.vars), cls: a.level === 'warn' ? 'warn' : 'hint' }));
  if (!c.auto && sug && c.wkid !== sug) alerts.push({ text: t('crs.manual', { label: crsLabel(sug), wkid: sug }), cls: 'warn' });
  $('outCrsAlerts').innerHTML = alerts.map(a => `<div class="${a.cls}">${esc(a.text)}</div>`).join('');

  const b = $('crsBadge');
  b.textContent = c.wkid ? `EPSG:${c.wkid}` : t('top.crsNone');
  b.title = c.wkid ? `${crsLabel(c.wkid)} — ${t(c.auto ? 'top.crsAuto' : 'top.crsManual')}\n${t('top.crsTitle')}` : t('top.crsTitle');
  b.classList.toggle('alert', alerts.some(a => a.cls === 'warn'));
}

// GeoJSON in WGS 84: every area with its category and attributes (it can be imported back), the buildable
// area and the tables
export function exportGeoJSON() {
  const fc = buildGeoJSON();
  if (!fc) { toast(t('toast.nothingToExport'), 'err'); return; }
  const r = last.result;
  const name = (store.project.name || 'pv-predesign').replace(/[\\/:*?"<>|]+/g, '_') + '.geojson';
  const blob = new Blob([JSON.stringify(fc)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(t('toast.exported', { n: fmt(r && r.tables ? r.tables : 0), file: name }), 'ok');
}

export function buildGeoJSON() {
  const { Polygon, SpatialReference, projectOperator } = getSdk();
  const r = last.result;
  const feats = [];
  for (const f of store.project.features) {
    feats.push({ type: 'Feature', geometry: f.geometry, properties: { name: f.name, category: f.category, ...(f.attrs || {}), source_layer: f.sourceCategory || '' } });
  }
  const area = r && r.area;
  if (area && area.buildable) {
    feats.push({ type: 'Feature', geometry: toGeoJSON(area.buildable), properties: { name: 'Buildable area', category: 'buildable', area_m2: Math.round(area.buildableArea) } });
  }
  if (r && r.tablesLocal && r.tablesLocal.length) {
    const polys = r.tablesLocal.map(tb => new Polygon({ rings: [[tb.corners[0], tb.corners[3], tb.corners[2], tb.corners[1], tb.corners[0]]], spatialReference: r.frame.sr }));
    const wgs = projectOperator.executeMany(polys, SpatialReference.WGS84);
    const f = store.project.field;
    wgs.forEach((g, i) => { const tb = r.tablesLocal[i], half = !!tb.half; feats.push({ type: 'Feature', geometry: toGeoJSON(g), properties: {
      category: 'table', row: tb.row, col: tb.col, structure: half ? r.halfGeom.notation : f.structure, half,
      modules: half ? r.halfGeom.modules : r.geom.modules, module: moduleLabel(r.module, f.powerPeriod), wp: r.power.wp,
      power_period: r.power.period || null, tilt_deg: f.technology === 'agri-tracker' ? 0 : f.tiltDeg, azimuth_deg: f.azimuthDeg } }); });
  }
  // infrastructure: fence, perimeter and internal roads, stations, gates
  if (r && r.frame && area && area.pre) {
    const { Polyline, Point } = getSdk();
    const L = layoutInfra(r.frame, area.pre, area.base);
    const wgs84 = g => toGeoJSON(g);
    for (const f of L.fences) feats.push({ type: 'Feature', geometry: wgs84(new Polyline({ paths: f.rings, spatialReference: r.frame.sr })), properties: { category: 'fence', fence: f.letter, lots: f.lots.join(','), length_m: Math.round(f.length) } });
    for (const rd of L.roads) feats.push({ type: 'Feature', geometry: rd.geometry, properties: { category: 'road', kind: 'drawn-' + rd.kind, width_m: rd.width, length_m: Math.round(rd.length) } });
    if (L.road) feats.push({ type: 'Feature', geometry: wgs84(L.road), properties: { category: 'road', kind: 'perimeter', length_m: Math.round(L.roadLength) } });
    for (const g of r.roads || []) feats.push({ type: 'Feature', geometry: wgs84(g), properties: { category: 'road', kind: 'internal', width_m: store.project.field.tracks.width } });
    for (const s of L.stations) feats.push({ type: 'Feature', geometry: wgs84(s.footprint), properties: { category: 'station', kind: s.kind, building: s.building.id, length_m: s.building.length, width_m: s.building.width } });
    for (const g of L.gates) feats.push({ type: 'Feature', geometry: wgs84(new Point({ x: g.point[0], y: g.point[1], spatialReference: r.frame.sr })), properties: { category: 'gate', access: g.name, width_m: g.width } });
  }
  return feats.length ? { type: 'FeatureCollection', features: feats } : null;
}
