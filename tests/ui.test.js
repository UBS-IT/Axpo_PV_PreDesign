// The panels of the app (1 · Areas, 0 · Terrain, 2 · Fields, 4 · Output) mounted from app/index.html on a stand-in
// map view (a real Map, no drawing on screen): the code that fills the panels, the layers and the results runs as in
// the app. The page of the app itself needs a real map view: check it in a browser too.
import { loadSdk, getSdk } from '../app/js/sdk.js';
import { loadCatalog } from '../app/js/catalog.js';
import { applyI18n } from '../app/js/i18n.js';
import { store, defaultProject, replaceProject, change } from '../app/js/state.js';
import { loadCountries } from '../app/js/crs.js';
import { initAreas } from '../app/js/areas.js';
import { initTerrain, sampleDtm, gridForSite, useGrid } from '../app/js/terrain/terrain.js';
import { initModulesUi, library } from '../app/js/modules.js';
import { initField, last } from '../app/js/field.js';
import { initOutput, buildGeoJSON, buildKmz, exportEngineering } from '../app/js/output.js';
import { exportModel } from '../app/js/export/model.js';
import { buildShapefiles, prjFor } from '../app/js/export/shp.js';
import { buildDxf } from '../app/js/export/dxf.js';
import { buildBoq } from '../app/js/export/boq.js';
import { buildGeoPackage } from '../app/js/export/gpkg.js';
import { srsDefinition } from '../app/js/export/shp.js';
import { readWorkbook } from '../app/js/io/xlsx.js';
import { loadJsZip, loadShp, loadSqlJs } from '../app/js/libs.js';
import { buildReport } from '../app/js/report.js';
import { initQuick, runQuick } from '../app/js/quick.js';
import { initInfra, addStation } from '../app/js/infra.js';
import { makeLocalFrame } from '../app/js/geo/localframe.js';
import { initBasemap } from '../app/js/ui/basemap.js';
import { initView3d } from '../app/js/view3d/scene.js';
import { model3d } from '../app/js/view3d/model.js';
import { layoutGlb, readGlb } from '../app/js/view3d/glb.js';
import { terrainData } from '../app/js/terrain/store.js';
import { toGeoJSON, projectPointToWgs84 } from '../app/js/geo/convert.js';

const results = [];
async function test(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); }
  catch (e) { console.error(name, e); results.push({ name, ok: false, note: e && e.message || String(e) }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const text = id => document.getElementById(id).innerText;
const eq = (a, b, w) => assert(JSON.stringify(a) === JSON.stringify(b), `${w}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const close = (a, b, tol, w) => assert(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);

await loadSdk();
await loadCatalog();
await loadCountries();
// the side panel and the hidden inputs of the app, in a hidden box
const html = await (await fetch('../app/index.html')).text();
const doc = new DOMParser().parseFromString(html, 'text/html');
const box = document.createElement('div');
box.style.display = 'none';
box.append(doc.getElementById('top'), doc.getElementById('side'), ...doc.querySelectorAll('body > input[type=file]'), doc.getElementById('toast'));
const banner = document.createElement('div'); banner.id = 'banner'; box.append(banner);
const railAreas = document.createElement('span'); railAreas.id = 'railAreas'; box.append(railAreas);
document.body.append(box);
applyI18n(box);

const { Map, SpatialReference } = getSdk();
const view = { map: new Map(), spatialReference: SpatialReference.WebMercator, ui: { add() {} }, goTo: async () => {}, on() { return { remove() {} }; }, when: async () => {} };
library.modules = [];

// a 400 m square site around a point of the terrain fixture (EPSG:32633), in Italy
const [lon, lat] = projectPointToWgs84(32633, [317500, 5063500]);
const f = makeLocalFrame({ lon0: lon, lat0: lat });
const { Polygon } = getSdk();
const sq = new Polygon({ rings: [[[-200, -200], [-200, 200], [200, 200], [200, -200], [-200, -200]]], spatialReference: f.sr });
const p = defaultProject();
p.name = 'UI';
p.features = [{ id: 'g', name: 'gross', category: 'gross', geometry: toGeoJSON(f.toSr(sq, SpatialReference.WGS84)), attrs: {}, source: 'test', sourceCategory: '' }];
store.project = p;

await test('panels start: areas, terrain, modules, fields, output', async () => {
  try { initAreas(view); } catch (e) { throw new Error('areas: ' + e.message); }
  initTerrain(view); initModulesUi(); initField(view); initInfra(view); initOutput(); initQuick();
  await wait(600);
  assert(/Italy|RDN2008/.test(document.getElementById('outCrsAlerts').innerText + text('crsBadge')), 'national system proposed');
  assert(document.getElementById('fStruct').value === '3V9', 'standard structure');
  assert(/TOPCon/.test(document.getElementById('fModule').selectedOptions[0].text), 'standard module chosen');
  assert(/29° shading angle/.test(text('fPitchHint')), 'Italian minimum pitch: ' + text('fPitchHint'));
  return text('fPitchHint');
});

// the quick predesign dialog: open it, check what it proposes, run it
async function quickDialog(set = () => {}) {
  document.getElementById('btnQuick').click();
  await wait(100);
  const dlg = document.querySelector('dialog.quick');
  assert(dlg && dlg.open, 'dialog open');
  const form = dlg.querySelector('form');
  set(form);
  const seen = { pitch: form.pitch.value, hint: form.querySelector('[data-hint]').textContent, tech: form.tech.value };
  dlg.querySelector('button[type=submit]').click();
  await wait(1500);
  return seen;
}

await test('quick predesign, fixed: 3V9, Italian minimum pitch, optimised position, in one click', async () => {
  change('field', q => { q.field.structure = '2V13'; q.field.pitch = null; q.field.moduleId = null; });
  const seen = await quickDialog(form => { form.tech.value = 'ground-fixed'; form.dispatchEvent(new Event('change')); });
  assert(seen.pitch === '10.3' && /Italy \(29° shading angle\)/.test(seen.hint), `proposed ${seen.pitch}: ${seen.hint}`);
  const f = store.project.field, r = last.result;
  assert(f.structure === '3V9' && f.tiltDeg === 15 && f.pitch === 10.3, `field ${f.structure} ${f.tiltDeg} ${f.pitch}`);
  assert(r && r.tables > 100 && r.power.wp === 650, `result ${r && r.tables}`);
  assert(store.project.plannedModules.includes(f.moduleId), 'the module is planned for the project');
  assert(!document.querySelector('dialog.quick'), 'dialog closed');
  assert(store.project.infra.perimeterRoad === false && r.dcMWp > 9, 'over 9 MWp: no perimeter road');
  await wait(300);
  assert(/1,600 m/.test(text('infFenceInfo')) && /4.0 m/.test(text('infFenceInfo')), 'fence panel: ' + text('infFenceInfo'));
  assert(/Suggested without/.test(text('infRoadInfo')), 'road panel: ' + text('infRoadInfo'));
  return `${r.tables} tables, ${r.dcMWp.toFixed(2)} MWp, offsets ${f.rowOffset} / ${f.columnOffset}, no perimeter road`;
});

await test('fields: 3V9 at the Italian minimum pitch fills the site', async () => {
  document.querySelector('#fPitchHint button[data-pitch]').click();
  await wait(600);
  const r = last.result;
  assert(r && r.tables > 100, `tables ${r && r.tables}`);
  assert(Math.abs(store.project.field.pitch - 10.3) < 0.01, `pitch ${store.project.field.pitch}`);
  assert(r.power.wp === 650 || r.power.period, 'roadmap power of the period');
  return `${r.tables} tables, ${r.dcMWp.toFixed(2)} MWp at ${r.power.wp} Wp (${r.power.period})`;
});

await test('terrain: DTM loaded, slope map drawn, 3V cut (10 %), tracker kept (15 %)', async () => {
  const file = new File([await (await fetch('./fixtures/it_dtm_plane.tif')).blob()], 'it_dtm_plane.tif');
  const g = gridForSite(10);
  const r = await sampleDtm(file, g.frame, g.def);
  await useGrid({ id: 'ui', lon0: g.frame.lon0, lat0: g.frame.lat0, ...g.def, source: 'dtm', name: file.name, loadedAt: new Date().toISOString(), zmin: 100, zmax: 220, missing: 0 }, r.z, { persist: false });
  await wait(800);
  const slopes = view.map.layers.find(l => l.title === 'Slopes');
  assert(slopes && slopes.graphics.length >= 2, `slope layer graphics: ${slopes && slopes.graphics.length}`);
  assert(/Fixed 3V/.test(text('terRule')), 'rule shown: ' + text('terRule'));
  assert(/over the slope limit/.test(text('warns')), 'field warning: ' + text('warns'));
  assert(!last.result || last.result.tables === 0, 'no table on a 12 % slope for 3V');
  document.getElementById('fTech').value = 'agri-tracker';
  document.getElementById('fTech').dispatchEvent(new Event('change'));
  await wait(600);
  assert(store.project.field.structure === '1V28' && store.project.field.pitch === null, 'tracker standard, pitch left to the farm');
  assert(/agreed with the farm/.test(text('warns') + text('fPitchHint')), 'pitch message');
  document.getElementById('fPitch').value = '6';
  document.getElementById('fPitch').dispatchEvent(new Event('change'));
  await wait(800);
  const t = last.result;
  assert(t && t.tables > 20, `trackers ${t && t.tables}`);
  assert(!/over the slope limit/.test(text('warns')), 'nothing cut for trackers');
  return `${t.tables} trackers 1V28 (${(t.geom.tableLength).toFixed(2)} m), ${t.dcMWp.toFixed(2)} MWp`;
});

await test('quick predesign, tracker: the pitch agreed with the farm is asked, then 1V28 fills the site', async () => {
  let blocked = false;
  const seen = await quickDialog(form => {
    form.tech.value = 'agri-tracker'; form.dispatchEvent(new Event('change'));
    blocked = !form.checkValidity();          // empty pitch: the form does not run
    form.pitch.value = '5.5';
  });
  assert(blocked && seen.pitch === '5.5' && /agreed with the farm/.test(seen.hint) && /5.50 \/ 6.00/.test(seen.hint), seen.hint);
  const f = store.project.field, r = last.result;
  assert(f.structure === '1V28' && f.pitch === 5.5 && f.tracks.tables === 4, `field ${f.structure} ${f.pitch} ${f.tracks.tables}`);
  assert(r && r.tables > 20, `trackers ${r && r.tables}`);
  return `${r.tables} trackers at 5.50 m, ${r.dcMWp.toFixed(2)} MWp`;
});

await test('internal roads from the corridors of the trackers (4 in line, then 4 m)', async () => {
  await wait(300);
  const r = last.result;
  assert(r.roads.length > 0 && r.roadsLength > 300, `roads ${r.roads.length}, ${r.roadsLength} m`);
  assert(/roads from the corridors/.test(text('infRoads')), text('infRoads'));
  return `${r.roads.length} roads, ${r.roadsLength.toFixed(0)} m`;
});

await test('half tables option and GeoJSON export', async () => {
  const half = document.getElementById('fHalf');
  assert(!half.disabled, 'half tracker defined for 1V28');
  half.checked = true; half.dispatchEvent(new Event('change'));
  await wait(800);
  const r = last.result;
  const fc = buildGeoJSON();
  const tables = fc.features.filter(x => x.properties.category === 'table');
  assert(tables.length === r.tables, 'every table exported');
  assert(tables.every(x => x.properties.wp === r.power.wp), 'power of the period');
  assert(fc.features.some(x => x.properties.category === 'fence') && fc.features.some(x => x.properties.kind === 'internal'), 'fence and roads exported');
  return `${r.halves} halves (1V14) of ${r.tables}`;
});

await test('KMZ for Google Earth and the one-page PDF report', async () => {
  const r = last.result;
  const out = await buildKmz();
  assert(out && out.blob.size > 1000, 'kmz written');
  const dom = new DOMParser().parseFromString(out.kml, 'application/xml');
  assert(!dom.querySelector('parsererror'), 'valid KML');
  const folders = [...dom.querySelectorAll('Folder > name')].map(n => n.textContent);
  assert(folders.includes('Tables') && folders.includes('Fence') && folders.includes('Gross area'), folders.join(', '));
  const tables = [...dom.querySelectorAll('Placemark')].find(p => /^Tables \(/.test(p.querySelector('name').textContent));
  assert(tables.querySelectorAll('Polygon').length === r.tables, 'one polygon per table in one placemark');
  const rep = await buildReport();
  assert(rep && rep.blob.size > 5000, `pdf ${rep && rep.blob.size} bytes`);
  const pdf = rep.doc.output();
  assert(pdf.startsWith('%PDF') && pdf.includes(`${r.dcMWp.toFixed(2)} MWp`) && pdf.includes('PV Predesign'), 'capacity and title in the PDF');
  assert(rep.data.assumptions.some(a => /agreed with the farm/.test(a)) && rep.data.checks.some(c => /topographic survey/.test(c)), 'assumptions and checks');
  window.__reportPdf = btoa(pdf);
  return `KMZ ${(out.blob.size / 1024).toFixed(0)} KB, ${folders.length} folders · PDF ${(rep.blob.size / 1024).toFixed(0)} KB`;
});

await test('for Engineering: Shapefile, GeoPackage, DXF and bill of quantities in the national system', async () => {
  const wkid = store.project.crs.wkid;
  assert(wkid, 'export system set from the site');
  addStation('CT', lon, lat, 0, { snap: false });
  await wait(800);
  const r = last.result, model = exportModel();
  assert(!model.error, 'model: ' + model.error);
  const { Point, SpatialReference: SR } = getSdk();
  const target = new SR({ wkid });
  const c0 = r.frame.toSr(new Point({ x: r.tablesLocal[0].corners[0][0], y: r.tablesLocal[0].corners[0][1], spatialReference: r.frame.sr }), target);
  const near = (pts, [x, y], tol) => pts.some(p => Math.hypot(p[0] - x, p[1] - y) < tol);
  // Shapefile: read back with shpjs (raw coordinates, no reprojection) and its dBase reader
  const shp = await buildShapefiles(model);
  const [JSZip, shpjs] = await Promise.all([loadJsZip(), loadShp()]);
  const zip = await JSZip.loadAsync(shp.blob);
  for (const n of ['tables', 'fences', 'roads', 'stations', 'buildable', 'areas_polygon']) assert(shp.files.includes(n), `layer ${n} in ${shp.files}`);
  for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg']) assert(zip.file('tables.' + ext), 'tables.' + ext);
  eq(await zip.file('tables.prj').async('text'), await prjFor(wkid), '.prj = ESRI WKT of EPSG:' + wkid);
  const geoms = shpjs.parseShp(await zip.file('tables.shp').async('arraybuffer'));
  const rows = shpjs.parseDbf(await zip.file('tables.dbf').async('arraybuffer'), 'UTF-8');
  assert(geoms.length === r.tables && rows.length === r.tables, `${geoms.length} shapes, ${rows.length} rows, ${r.tables} tables`);
  assert(near(geoms[0].coordinates[0], [c0.x, c0.y], 0.001), 'first table corner at the SDK projection (1 mm)');
  const halves = rows.filter(x => x.HALF === 1);
  assert(halves.length === r.halves && halves.every(x => x.STRUCTURE === r.halfGeom.notation && x.MODULES === r.halfGeom.modules), 'half tables with their notation');
  assert(rows.filter(x => x.HALF === 0).every(x => x.STRUCTURE === store.project.field.structure && x.WP === r.power.wp), 'attributes');
  const shx = new DataView(await zip.file('tables.shx').async('arraybuffer'));
  assert(shx.getInt32(24, false) * 2 === shx.byteLength && shx.byteLength === 100 + 8 * r.tables, 'index length');
  const st = shpjs.parseDbf(await zip.file('stations.dbf').async('arraybuffer'), 'UTF-8');
  assert(st.length === 1 && st[0].KIND === 'CT' && st[0].BUILDING === 'CT-IT', 'station row: ' + JSON.stringify(st[0]));
  // DXF: group codes in pairs, layers declared, one closed polyline per table
  const dxf = buildDxf(model), lines = dxf.split('\r\n');
  assert(lines.length % 2 === 1 && lines.at(-2) === 'EOF', 'pairs and EOF');
  const pairs = []; for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
  const ents = []; let cur = null;
  for (const [c, v] of pairs) { if (c === '0') { cur = { type: v, g: [] }; ents.push(cur); } else if (cur) cur.g.push([c, v]); }
  const layerOf = e => e.g.find(x => x[0] === '8')?.[1];
  const declared = new Set(ents.filter(e => e.type === 'LAYER').map(e => e.g.find(x => x[0] === '2')[1]));
  const usedL = new Set(ents.filter(e => ['POLYLINE', 'POINT', 'TEXT'].includes(e.type)).map(layerOf));
  assert([...usedL].every(l => declared.has(l)), `layers declared: ${[...usedL].filter(l => !declared.has(l))}`);
  const polys = ents.filter(e => e.type === 'POLYLINE');
  const tablesDxf = polys.filter(e => /^PVP_TABLES/.test(layerOf(e)));
  assert(tablesDxf.length === r.tables && tablesDxf.every(e => e.g.some(x => x[0] === '70' && x[1] === '1')), `${tablesDxf.length} closed table polylines`);
  assert(ents.filter(e => e.type === 'VERTEX').length === ents.filter(e => e.type === 'VERTEX').length && polys.length === ents.filter(e => e.type === 'SEQEND').length, 'one SEQEND per polyline');
  const verts = []; let i0 = ents.indexOf(tablesDxf[0]);
  for (let k = i0 + 1; ents[k].type === 'VERTEX'; k++) verts.push([+ents[k].g.find(x => x[0] === '10')[1], +ents[k].g.find(x => x[0] === '20')[1]]);
  assert(verts.length === 4 && near(verts, [c0.x, c0.y], 0.002), 'first table in the DXF at the SDK projection');
  assert(ents.some(e => e.type === 'TEXT' && layerOf(e) === 'PVP_TEXT' && e.g.some(x => x[0] === '1' && x[1] === 'CT')), 'station label');
  // bill of quantities: read back with the app's own Excel reader
  const book = await readWorkbook(await (await buildBoq(model)).arrayBuffer());
  eq(book.map(b => b.name), ['Summary', 'Tables', 'Infrastructure', 'Areas'], 'sheets');
  const sum = book[0].aoa, val = label => sum.find(x => x[0] === label)?.[1];
  assert(val('DC capacity') === Math.round(r.dcMWp * 1000) / 1000 && val('Modules') === r.modules && val('Half tables') === (r.halves || undefined), 'summary figures: ' + JSON.stringify(sum.slice(0, 26)));
  assert(sum.some(x => /^Fence A/.test(x[0]) && x[1] > 1000) && sum.some(x => x[0] === 'Transformer station' && x[1] === 1), 'fence and station quantities');
  assert(sum.some(x => /Foundations and piles/.test(x[0])), 'what is not included is said');
  assert(book[1].aoa.length === r.tables + 1 && Math.abs(book[1].aoa[1][6] - c0.x) < 5, 'one row per table with X, Y');
  // GeoPackage: opened again with SQLite, checked against the OGC rules that readers rely on
  const gp = await buildGeoPackage(model);
  const SQL = await loadSqlJs(), db = new SQL.Database(gp.bytes);
  const one = sql => db.exec(sql)[0]?.values ?? [];
  try {
    eq(one('PRAGMA application_id')[0][0], 0x47504B47, 'application id GPKG');
    eq(one('PRAGMA user_version')[0][0], 10300, 'GeoPackage 1.3');
    eq(one('PRAGMA integrity_check')[0][0], 'ok', 'SQLite integrity');
    eq(one('PRAGMA foreign_key_check'), [], 'foreign keys');
    const srs = one(`SELECT organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys WHERE srs_id = ${wkid}`)[0];
    eq([srs[0], srs[1], srs[2]], ['EPSG', wkid, (await srsDefinition(wkid)).wkt], 'system with its OGC WKT');
    const contents = Object.fromEntries(one('SELECT table_name, data_type FROM gpkg_contents'));
    for (const n of gp.tables) assert(contents[n] === 'features', 'contents: ' + n);
    eq(one("SELECT geometry_type_name, srs_id FROM gpkg_geometry_columns WHERE table_name = 'tables'")[0], ['MULTIPOLYGON', wkid], 'geometry column');
    eq(one('SELECT COUNT(*), SUM(half) FROM "tables"')[0], [r.tables, r.halves || 0], 'one row per table');
    const blob = one('SELECT geom FROM "tables" ORDER BY fid LIMIT 1')[0][0];
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    eq([String.fromCharCode(blob[0], blob[1]), blob[2], blob[3], dv.getInt32(4, true)], ['GP', 0, 3, wkid], 'blob header');
    eq([blob[40], dv.getUint32(41, true), dv.getUint32(45, true), blob[49], dv.getUint32(50, true), dv.getUint32(54, true), dv.getUint32(58, true)], [1, 6, 1, 1, 3, 1, 5], 'WKB multipolygon of one ring of 5 points');
    const ring = [0, 1, 2, 3, 4].map(k => [dv.getFloat64(62 + 16 * k, true), dv.getFloat64(70 + 16 * k, true)]);
    assert(near(ring, [c0.x, c0.y], 0.001), 'first table corner at the SDK projection (1 mm)');
    const area2 = ring.slice(0, 4).reduce((a, p, k) => a + p[0] * ring[k + 1][1] - ring[k + 1][0] * p[1], 0);
    assert(area2 > 0, 'outer ring anticlockwise (OGC)');
    const [minx, maxx, miny, maxy] = [8, 16, 24, 32].map(o => dv.getFloat64(o, true));
    assert(minx === Math.min(...ring.map(p => p[0])) && maxy === Math.max(...ring.map(p => p[1])) && maxx > minx && maxy > miny, 'envelope');
    eq(one('SELECT kind, building FROM stations')[0], ['CT', 'CT-IT'], 'station attributes');
  } finally { db.close(); }
  // the button: no real download (anchor click intercepted), no system -> a message
  const click = HTMLAnchorElement.prototype.click, got = [];
  HTMLAnchorElement.prototype.click = function () { got.push(this.download); };
  try {
    const out = await exportEngineering('dxf');
    assert(out && got[0] === out.name && out.name.endsWith(`_EPSG${wkid}.dxf`), 'download ' + got);
    change('crs', q => { q.crs.auto = false; q.crs.wkid = null; });
    assert(await exportEngineering('shp') === null && got.length === 1, 'no system: nothing written');
    change('crs', q => { q.crs.auto = true; q.crs.wkid = wkid; });
  } finally { HTMLAnchorElement.prototype.click = click; }
  change('infra', q => { q.infra.stations = []; });
  await wait(400);
  return `EPSG:${wkid} · ${shp.files.length} shapefiles · GeoPackage ${(gp.bytes.length / 1024).toFixed(0)} KB, ${gp.tables.length} layers · DXF ${(dxf.length / 1024).toFixed(0)} KB, ${polys.length} polylines, layers ${[...usedL].join(' ')}`;
});

await test('4b · 3D: panel, trackers on the terrain of step 0 at the IT axis height, glTF, report with a 3D view', async () => {
  initView3d(view);
  const panel = document.getElementById('d3Panel');
  const cat = panel.querySelector('#d3Cat');
  assert(cat && /1\.50 m/.test(cat.options[0].textContent) && /3\.10 m/.test(cat.options[2].textContent), 'IT categories with their axis heights');
  assert(/IT-PC/.test(panel.textContent) && panel.querySelector('#d3Glb') && panel.querySelector('[data-sun="12-21-9"]'), 'toolkit source, sun buttons, glTF');
  assert(terrainData.meta, 'terrain of step 0 still loaded');
  change('infra', q => { q.infra.stations = []; });
  addStation('CT', lon, lat, 0, { snap: false });
  await wait(800);
  const r = last.result;
  const date = new Date('2026-12-21T09:00:00Z');
  const m = await model3d({ date, query: null });
  eq([m.h.tracker, m.h.axis.value, m.tables.positions.length / 12, m.stations.length], [true, 1.5, r.tables, 1], 'model');
  assert(m.angle < -30, `trackers towards the east in the morning: ${m.angle.toFixed(1)}°`);
  // every tracker end: its axis 1.50 m over the terrain (the midpoint of the two long edges)
  const p = m.tables.positions, k = 7;
  const axisZ = (p[12 * k + 2] + p[12 * k + 11]) / 2;
  const g = (m.tableGround[4 * k] + m.tableGround[4 * k + 3]) / 2;
  close(axisZ - g, 1.5, 1e-6, 'axis height over the ground');
  assert(m.gaps === 0 && m.fences.length >= 1, `ground known everywhere (${m.gaps} gaps), fence walls`);
  // changing category moves the axis
  change('view3d', q => { q.view3d.trackerCategory = 'grazing'; });
  const m2 = await model3d({ date, query: null });
  close((m2.tables.positions[12 * k + 2] + m2.tables.positions[12 * k + 11]) / 2 - g, 2.3, 1e-6, 'grazing: 2.30 m');
  change('view3d', q => { q.view3d.trackerCategory = 'standard'; });
  // glTF of the layout: nodes and extras
  const glb = layoutGlb(m, null, { wkid: 6708, x: 1, y: 2 });
  const { json } = readGlb(glb.buffer);
  eq(json.nodes.map(n => n.name), ['Modules', 'Stations', 'Fence'], 'nodes');
  eq(json.accessors[0].count, r.tables * 4, 'module vertices');
  eq([json.asset.extras.national.wkid, json.asset.extras.axes], [6708, 'x east, y up, z south'], 'extras');
  // the PDF report with a picture of the 3D view on a second page
  const c = document.createElement('canvas'); c.width = 400; c.height = 240;
  const cx = c.getContext('2d'); cx.fillStyle = '#3b5'; cx.fillRect(0, 0, 400, 240);
  const rep = await buildReport({ views: [{ name: 'From the road', dataUrl: c.toDataURL('image/jpeg', 0.8), width: 400, height: 240, note: 'test' }] });
  eq(rep.doc.getNumberOfPages(), 2, 'second page with the 3D view');
  change('infra', q => { q.infra.stations = []; });
  await wait(400);
  return `${r.tables} trackers at ${m.angle.toFixed(1)}° on 21 Dec 09:00 UTC, GLB ${(glb.buffer.byteLength / 1024).toFixed(0)} KB`;
});

await test('background map: satellite without labels, opacity slider kept when switching to topographic', async () => {
  try { localStorage.removeItem('pvp.test.basemapOpacity'); } catch {}
  const added = [];
  // basemaps from ids load their layers from the network (not in the test bench): stand-in basemaps with a layer each
  const { GraphicsLayer } = getSdk();
  const v = { map: new Map({ basemap: { baseLayers: [new GraphicsLayer()] } }), ui: { add: (w, pos) => added.push([w, pos]) } };
  const box = initBasemap(v);
  assert(added.length === 2 && added.every(a => a[1] === 'bottom-right'), 'toggle and slider on the map');
  assert(/basemap: 'satellite'/.test(await (await fetch('../app/js/main.js')).text()), 'the app starts on satellite imagery without labels');
  const input = box.querySelector('input');
  eq(input.value, '100', 'opaque by default');
  input.value = '40'; input.dispatchEvent(new Event('input'));
  assert(v.map.basemap.baseLayers.every(l => l.opacity === 0.4) && /40 %/.test(box.textContent), 'opacity applied: ' + box.textContent);
  v.map.basemap = { baseLayers: [new GraphicsLayer()] };
  await wait(50);
  assert(v.map.basemap.baseLayers.length && v.map.basemap.baseLayers.every(l => l.opacity === 0.4), 'the other basemap takes the same opacity');
  eq(localStorage.getItem('pvp.test.basemapOpacity'), '0.4', 'remembered in this browser (test key)');
  localStorage.removeItem('pvp.test.basemapOpacity');
  return box.textContent;
});

await test('infrastructure panel: lots numbered, two of them joined in one fence with the check boxes', async () => {
  const { Polyline } = getSdk();
  const line = (pts, type, buffer) => ({ id: type, name: type, category: 'linear', attrs: { type, buffer }, source: 'test', sourceCategory: '',
    geometry: toGeoJSON(f.toSr(new Polyline({ paths: [pts], spatialReference: f.sr }), SpatialReference.WGS84)) });
  change('site', q => { q.features.push(line([[-260, 0], [260, 0]], 'road', 10), line([[0, 0], [0, 260]], 'ditch', 5)); });
  await wait(800);
  const boxes = [...document.querySelectorAll('#infLots [data-lot]')];
  assert(boxes.length === 3 && !document.getElementById('infLotsBox').hidden, `lots in the panel: ${boxes.length}`);
  for (const b of boxes.slice(0, 2)) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); }
  document.getElementById('infJoin').click();
  await wait(800);
  assert(store.project.infra.fenceGroups.length === 1, 'one group');
  assert(/fence A/.test(text('infLots')) && (text('infLots').match(/fence A/g) || []).length === 2, text('infLots'));
  const labels = view.map.layers.find(l => l.title === 'Infrastructure').graphics.filter(g => g.symbol?.type === 'text').map(g => g.symbol.text);
  assert(labels.includes('1 · A') && labels.includes('2 · A') && labels.includes('3'), 'labels on the map: ' + labels.join(' '));
  change('site', q => { q.features = q.features.filter(x => x.category !== 'linear'); q.infra.fenceGroups = []; });
  await wait(500);
  return labels.join(' | ');
});

await test('area summary shows the slope cut and the terrain panel its figures', async () => {
  change('field', q => { q.field.technology = 'ground-fixed'; q.field.structure = '3V9'; q.field.pitch = 10.3; });
  await wait(800);
  assert(/slopes over the limit/.test(text('areaSummary')), 'summary: ' + text('areaSummary'));
  assert(/Over the limit on the grid/.test(text('terCut')), 'terrain panel: ' + text('terCut'));
  assert(/it_dtm_plane.tif/.test(text('terInfo')), 'terrain info');
  replaceProject(defaultProject());
  await wait(400);
  assert(await runQuick({ technology: 'ground-fixed' }) === null, 'no site: the quick predesign says so');
  // a small site: the quick predesign keeps the perimeter road of the template (up to ~9 MWp)
  const small = new Polygon({ rings: [[[-80, -80], [-80, 80], [80, 80], [80, -80], [-80, -80]]], spatialReference: f.sr });
  const q = defaultProject();
  q.features = [{ id: 's', name: 'small', category: 'gross', geometry: toGeoJSON(f.toSr(small, SpatialReference.WGS84)), attrs: {}, source: 'test', sourceCategory: '' }];
  replaceProject(q);
  await wait(500);
  const rs = await runQuick({ technology: 'ground-fixed' });
  assert(rs && rs.dcMWp < 9 && store.project.infra.perimeterRoad === true, `small site ${rs && rs.dcMWp} MWp, road ${store.project.infra.perimeterRoad}`);
  replaceProject(defaultProject());
  await wait(300);
  return text('terCut');
});

const ok = results.filter(r => r.ok).length;
document.getElementById('sum').innerHTML = `<b class="${ok === results.length ? 'ok' : 'err'}">${ok} / ${results.length} passed</b>`;
document.getElementById('out').innerHTML = results.map(r => `<tr><td class="s ${r.ok ? 'ok' : 'err'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}<br><code>${String(r.note).replace(/</g, '&lt;')}</code></td></tr>`).join('');
window.__results = results;
