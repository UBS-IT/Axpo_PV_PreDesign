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
import { exportReport } from './report.js';
import { toast } from './ui/toast.js';
import { loadJsZip } from './libs.js';

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
  $('outKml').onclick = exportKmz;
  $('outReport').onclick = exportReport;
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

// ── KML / KMZ (Google Earth; always WGS 84) ──
// Folders by category with their colours; the tables are one placemark (a multi-geometry), so that large plants stay
// light in Google Earth.
const KML_STYLE = {   // [r, g, b], fill opacity (0 = no fill)
  gross: [[255, 140, 26], 0.1], net: [[45, 190, 126], 0.15], exclusion: [[229, 72, 77], 0.35], linear: [[233, 30, 140], 0],
  obstacle: [[150, 90, 40], 0.5], connection: [[139, 92, 246], 0], access: [[31, 153, 204], 0], mitigation: [[110, 170, 60], 0.35],
  agri: [[200, 170, 40], 0.3], reference: [[123, 138, 153], 0.05], buildable: [[45, 190, 126], 0.1], table: [[57, 69, 207], 0.85],
  fence: [[40, 40, 40], 0], road: [[150, 150, 150], 0.7], station: [[233, 120, 30], 0.9], gate: [[30, 30, 30], 0],
};
const xml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const kmlColour = ([r, g, b], a) => [Math.round(a * 255), b, g, r].map(v => v.toString(16).padStart(2, '0')).join('');
const coords = pts => pts.map(p => `${+p[0].toFixed(8)},${+p[1].toFixed(8)},0`).join(' ');
function kmlGeometry(g) {
  if (!g) return '';
  const poly = rings => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(rings[0])}</coordinates></LinearRing></outerBoundaryIs>${rings.slice(1).map(r => `<innerBoundaryIs><LinearRing><coordinates>${coords(r)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`;
  switch (g.type) {
    case 'Point': return `<Point><coordinates>${coords([g.coordinates])}</coordinates></Point>`;
    case 'LineString': return `<LineString><tessellate>1</tessellate><coordinates>${coords(g.coordinates)}</coordinates></LineString>`;
    case 'Polygon': return poly(g.coordinates);
    case 'MultiPoint': return `<MultiGeometry>${g.coordinates.map(c => `<Point><coordinates>${coords([c])}</coordinates></Point>`).join('')}</MultiGeometry>`;
    case 'MultiLineString': return `<MultiGeometry>${g.coordinates.map(l => `<LineString><tessellate>1</tessellate><coordinates>${coords(l)}</coordinates></LineString>`).join('')}</MultiGeometry>`;
    case 'MultiPolygon': return `<MultiGeometry>${g.coordinates.map(poly).join('')}</MultiGeometry>`;
    default: return '';
  }
}
const polysOf = g => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
export function buildKml(fc = buildGeoJSON()) {
  if (!fc) return null;
  const byCat = new Map();
  for (const f of fc.features) { const c = f.properties.category || 'reference'; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(f); }
  const styles = [...byCat.keys()].map(c => { const [rgb, a] = KML_STYLE[c] || KML_STYLE.reference;
    return `<Style id="s-${c}"><LineStyle><color>${kmlColour(rgb, 1)}</color><width>${c === 'fence' ? 2.5 : 1.5}</width></LineStyle><PolyStyle><color>${kmlColour(rgb, a)}</color><fill>${a > 0 ? 1 : 0}</fill></PolyStyle><IconStyle><color>${kmlColour(rgb, 1)}</color><scale>0.8</scale></IconStyle></Style>`; }).join('');
  const label = c => (c === 'table' ? t('res.tables') : c === 'buildable' ? t('res.buildable') : c === 'fence' ? t('infra.fence') : c === 'road' ? t('infra.roads')
    : c === 'station' ? t('infra.stations') : c === 'gate' ? t('infra.gates') : t('cat.' + c));
  const folders = [...byCat].map(([c, feats]) => {
    if (c === 'table') {   // one placemark for all the tables
      const all = feats.flatMap(f => polysOf(f.geometry));
      const p = feats[0].properties;
      const desc = `${feats.length} tables · ${p.structure} · ${p.module} · tilt ${p.tilt_deg}° · azimuth ${p.azimuth_deg}°`;
      return `<Folder><name>${xml(label(c))}</name><Placemark><name>${xml(label(c))} (${feats.length})</name><description>${xml(desc)}</description><styleUrl>#s-table</styleUrl>${kmlGeometry({ type: 'MultiPolygon', coordinates: all })}</Placemark></Folder>`;
    }
    const marks = feats.map(f => {
      const pr = f.properties;
      const desc = Object.entries(pr).filter(([k, v]) => v !== '' && v != null && k !== 'name').map(([k, v]) => `${k}: ${v}`).join('<br>');
      return `<Placemark><name>${xml(pr.name || pr.kind || label(c))}</name><description><![CDATA[${desc}]]></description><styleUrl>#s-${c}</styleUrl>${kmlGeometry(f.geometry)}</Placemark>`;
    }).join('');
    return `<Folder><name>${xml(label(c))}</name>${marks}</Folder>`;
  }).join('');
  const name = store.project.name || 'PV Predesign';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name><description>${xml(t('out.kmlDesc', { date: new Date().toISOString().slice(0, 10) }))}</description>${styles}${folders}</Document></kml>`;
}
export async function buildKmz() {
  const kml = buildKml();
  if (!kml) return null;
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), kml };
}
export async function exportKmz() {
  const out = await buildKmz();
  if (!out) { toast(t('toast.nothingToExport'), 'err'); return; }
  const name = (store.project.name || 'pv-predesign').replace(/[\\/:*?"<>|]+/g, '_') + '.kmz';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(out.blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(t('toast.exportedKmz', { file: name }), 'ok');
}
