// Import, classification, coordinate systems, net area and project round trips. Needs the SDK (browser).
// Reference values in fixtures/expected.json come from ArcGIS (scripts/make_fixtures.py).
import { loadSdk, getSdk } from '../app/js/sdk.js';
import { store, defaultProject, upgrade, linearTypeFor, geomKind } from '../app/js/state.js';
import { classify } from '../app/js/categories.js';
import { loadCountries, countryAt, suggestCrs, candidatesForProjected, allOptions, looksProjected, regionAt } from '../app/js/crs.js';
import { readAnyFile } from '../app/js/io/importers.js';
import { reprojectToWgs84, projectPointToWgs84, toGeoJSON } from '../app/js/geo/convert.js';
import { makeLocalFrame } from '../app/js/geo/localframe.js';
import { computeArea, siteFrame, importFiles, lineLengthKm } from '../app/js/areas.js';
import { projectBlob, openProjectFile } from '../app/js/io/projectfile.js';
import { buildGeoJSON } from '../app/js/output.js';
import { loadShp, loadJsZip } from '../app/js/libs.js';

const results = [];
async function test(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); }
  catch (e) { console.error(name, e); results.push({ name, ok: false, note: e && e.message || String(e) }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
// JSON with sorted keys: objects compare by content, not by key order
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const eq = (a, b, w) => assert(canon(a) === canon(b), `${w}: ${canon(a)} vs ${canon(b)}`);
const near = (a, b, tol, w) => assert(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b} (tolerance ${tol})`);
const metres = ([x1, y1], [x2, y2]) => Math.hypot((x1 - x2) * 111320 * Math.cos(y1 * Math.PI / 180), (y1 - y2) * 110574);

await loadSdk();
await loadCountries();
const expected = await (await fetch('./fixtures/expected.json')).json();
async function fixture(name) { const r = await fetch('./fixtures/' + name); assert(r.ok, `fixture ${name}: HTTP ${r.status}`); return new File([await r.blob()], name); }

// the app's import pipeline without the dialog: file system (declared or chosen) or each layer's .prj
function toWgs(r, fileWkid = r.declaredWkid) {
  return r.features.map(f => {
    const sr = f.srcWkt ? { wkt: f.srcWkt } : fileWkid;
    return sr ? { ...f, geometry: reprojectToWgs84(f.geometry, sr) } : f;
  });
}
function classified(r, feats) {
  const ctx = { type: r.type, polygonsInFile: feats.filter(f => geomKind(f.geometry) === 'polygon').length };
  return feats.map(f => ({ ...f, ...classify(f, ctx) }));
}
function useProject(features, settings = {}) {
  const p = defaultProject();
  p.features = features.map((f, i) => ({ id: 'f' + i, name: f.name, category: f.category, geometry: f.geometry, attrs: f.attrs || {}, source: 'test', sourceCategory: f.sourceCategory || '' }));
  Object.assign(p.settings, settings);
  store.project = p;
  return p;
}
const areaOf = () => computeArea(siteFrame());
const square = (lon, lat, d = 0.002) => [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d]];

// ── classification ──
await test('linear infrastructure recognised in six languages', () => {
  const cases = { 'Linea MT': 'overhead-power', 'Elettrodotto AT 132 kV': 'overhead-power', 'Ligne HTA 20 kV': 'overhead-power',
    'Línea MT 20 kV': 'overhead-power', 'Freileitung 110 kV': 'overhead-power', 'Cavidotto interrato': 'underground-power',
    'Gasdotto SNAM': 'gas', 'Fosso di scolo': 'ditch', 'Ferrovia Venezia-Trieste': 'railway', 'Autobahn A9': 'road',
    'Strada vicinale': 'road', 'Ligne_HTA': 'overhead-power', 'Station': null, 'Parcel': null };
  for (const [k, v] of Object.entries(cases)) eq(linearTypeFor(k), v, k);
  return `${Object.keys(cases).length} names`;
});
await test('classification of names, folders and layers', () => {
  const P = { type: 'Polygon', coordinates: [square(10, 45)] }, L = { type: 'LineString', coordinates: [[10, 45], [10.01, 45]] }, Pt = { type: 'Point', coordinates: [10, 45] };
  const c = (name, geometry, sourceCategory = '', properties = {}, ctx = { type: 'kml', polygonsInFile: 10 }) => classify({ name, geometry, sourceCategory, properties }, ctx);
  eq(c('Parcela 1', P, 'Superficie bruta').category, 'gross', 'Superficie bruta');
  eq(c('Area', P, 'Area_lorda').category, 'gross', 'Area_lorda');
  eq(c('Lot', P, 'Perimetro netto').category, 'net', 'Perimetro netto');
  eq(c('Arroyo zona', P, 'Restricciones / Zona inundable').category, 'exclusion', 'Zona inundable');
  eq(c('Encina 1', Pt, 'Árboles'), { category: 'obstacle', attrs: { type: 'tree' } }, 'Árboles');
  eq(c('Acceso principal', Pt, 'Accesos'), { category: 'access', attrs: { type: 'site-access' } }, 'Accesos');
  eq(c('Punto di connessione', Pt), { category: 'access', attrs: { type: 'grid-connection' } }, 'connection');
  eq(c('Haie champêtre', L), { category: 'mitigation', attrs: {} }, 'Haie');
  eq(c('Percorso di connessione MT', L), { category: 'connection', attrs: {} }, 'cable route by name');
  eq(c('Cavidotto MT', L).category, 'linear', 'a plain cavidotto stays an existing line');
  eq(c('Kabeltrasse zum Umspannwerk', L).category, 'connection', 'Kabeltrasse');
  eq(c('Tracé de raccordement', L, '', {}).category, 'connection', 'tracé de raccordement');
  eq(c('Su strada 3,4 km', L, '', { category: 'connection', type: 'estimated' }), { category: 'connection', attrs: { type: 'estimated' } }, 'explicit connection from the Geoportale');
  eq(c('Percorso di connessione', Pt).category !== 'connection', true, 'a point is never a cable route');
  eq(c('Punto di connessione', Pt, 'Percorso di connessione'), { category: 'access', attrs: { type: 'grid-connection' } }, 'connection point in a route folder');
  eq(c('Tracciato del cavo', L, 'Percorso di connessione').category, 'connection', 'the route in the same folder');
  eq(c('T1', Pt, 'tree', { height: 12.5 }), { category: 'obstacle', attrs: { type: 'tree', height: 12.5 } }, 'CSV tree with height');
  eq(c('X', Pt, '', { height: 8 }), { category: 'obstacle', attrs: { type: 'other', height: 8 } }, 'point with height');
  eq(c('Something', P, '', {}, { type: 'kml', polygonsInFile: 2 }).category, 'gross', 'lone polygon');
  eq(c('Something', P, '', {}, { type: 'kml', polygonsInFile: 9 }).category, 'reference', 'many polygons');
  eq(c('Anything', P, '', { category: 'agri', width: 4 }), { category: 'agri', attrs: { width: 4 } }, 'explicit category');
});
await test('project v1 is migrated to categories with per-object buffers', () => {
  const poly = { type: 'Polygon', coordinates: [square(12.6, 45.7)] }, line = { type: 'LineString', coordinates: [[12.6, 45.7], [12.61, 45.7]] };
  const v1 = { format: 'pv-predesign-project', version: 1, name: 'v1', settings: { siteSetback: 5, exclusionBuffer: 10 }, features: [
    { id: 'a', name: 'Perimetro netto', role: 'site', category: 'Perimetro Netto', geometry: poly },
    { id: 'b', name: 'Lotto', role: 'site', category: '', geometry: poly },
    { id: 'c', name: 'Linea MT', role: 'exclusion', category: 'Elettrodotto', geometry: line },
    { id: 'd', name: 'Vincolo', role: 'exclusion', category: 'Vincoli paesaggistici', geometry: poly },
    { id: 'e', name: 'Parcel', role: 'reference', category: 'parcel', geometry: poly }] };
  const p = upgrade(v1);
  eq(p.version, 2, 'version');
  eq(p.features.map(f => f.category), ['net', 'gross', 'linear', 'exclusion', 'reference'], 'categories');
  eq(p.features[2].attrs, { type: 'overhead-power', buffer: 10 }, 'line attrs');
  eq(p.features[3].attrs, { buffer: 10 }, 'exclusion attrs');
  eq(p.settings, { boundarySetback: 5 }, 'settings');
});

// ── countries and coordinate systems ──
await test('country of 12 places', () => {
  const places = { Rome: [12.4964, 41.9028, 'IT'], Como: [9.0852, 45.8081, 'IT'], Lyon: [4.8357, 45.764, 'FR'], Strasbourg: [7.7521, 48.5734, 'FR'],
    Madrid: [-3.7038, 40.4168, 'ES'], 'Las Palmas': [-15.4134, 28.1235, 'ES'], Berlin: [13.405, 52.52, 'DE'], Warsaw: [21.0122, 52.2297, 'PL'],
    Bern: [7.4474, 46.948, 'CH'], Geneva: [6.1432, 46.2044, 'CH'], Basel: [7.5886, 47.5596, 'CH'], Vienna: [16.3738, 48.2082, 'AT'] };
  for (const [n, [x, y, iso]] of Object.entries(places)) eq(countryAt(x, y), iso, n);
  return `${Object.keys(places).length} places`;
});
await test('German zone 33 Länder', () => {
  eq(regionAt(13.405, 52.52)?.code, 'DE-BE', 'Berlin');
  eq(regionAt(11.86, 53.07)?.code, 'DE-BB', 'Perleberg');
  eq(regionAt(11.41, 53.63)?.code, 'DE-MV', 'Schwerin');
  eq(regionAt(13.74, 51.05)?.code, 'DE-SN', 'Dresden');
  eq(regionAt(12.65, 51.87), null, 'Wittenberg (Saxony-Anhalt)');
  eq(regionAt(12.6, 48.88), null, 'Straubing (Bavaria)');
});
await test('system proposed for sites in six countries', () => {
  const sites = { Milan: [9.19, 45.46, 6707], Rome: [12.5, 41.9, 6708], Lecce: [18.17, 40.35, 6708], Ceggia: [12.64, 45.69, 6708],
    Lyon: [4.85, 45.76, 2154], Madrid: [-3.7, 40.42, 25830], Barcelona: [2.17, 41.39, 25831], Santiago: [-8.54, 42.88, 25829],
    'Las Palmas': [-15.43, 28.12, 4083], Berlin: [13.4, 52.52, 25833], Munich: [11.58, 48.14, 25832], Straubing: [12.6, 48.88, 25832],
    Perleberg: [11.86, 53.07, 25833], Schwerin: [11.41, 53.63, 25833], Wittenberg: [12.65, 51.87, 25832], Warsaw: [21.01, 52.23, 2180],
    Bern: [7.45, 46.95, 2056], Geneva: [6.14, 46.2, 2056], Vienna: [16.37, 48.21, 32633] };
  for (const [n, [x, y, w]] of Object.entries(sites)) eq(suggestCrs(square(x, y)).wkid, w, n);
  const keys = (x, y) => suggestCrs(square(x, y)).alerts.map(a => a.key);
  assert(keys(12.5, 41.9).includes('crs.itBand'), 'Rome: regional zone note');
  assert(keys(12.6, 48.88).includes('crs.deLand32'), 'Straubing: Land note');
  assert(keys(21.01, 52.23).includes('crs.plCs2000'), 'Warsaw: CS2000 note');
  assert(keys(16.37, 48.21).includes('crs.noProfile'), 'Vienna: no profile');
  assert(keys(8.95, 45.85).includes('crs.border'), 'Chiasso: border (IT / CH)');
  return `${Object.keys(sites).length} sites`;
});
await test('every national system projects back and forth', () => {
  const anchor = { IT: [12.5, 42], FR: [2.5, 46.5], ES: [-3.7, 40.4], DE: [10.5, 51], PL: [19, 52], CH: [8.2, 46.8] };
  const { Point, SpatialReference, projectOperator } = getSdk();
  const bad = [];
  for (const o of allOptions()) {
    const [x, y] = anchor[o.iso];
    try {
      const p = projectOperator.execute(new Point({ x, y, spatialReference: SpatialReference.WGS84 }), new SpatialReference({ wkid: o.wkid }));
      const back = projectPointToWgs84(o.wkid, [p.x, p.y]);
      if (!back || metres(back, [x, y]) > 0.01) bad.push(o.wkid);
    } catch (e) { bad.push(`${o.wkid} (${e.message})`); }
  }
  assert(!bad.length, 'failed: ' + bad.join(', '));
  return `${allOptions().length} systems`;
});

// ── import of the fixtures ──
await test('Shapefile in Lambert-93 (.prj): true ground areas', async () => {
  const r = await readAnyFile(await fixture('fr_lambert93.zip'));
  eq(r.type, 'shp', 'type'); eq(r.features.length, 3, 'features'); eq(r.needsCrs, false, 'needsCrs');
  assert(r.features.every(f => /Lambert_93/.test(f.srcWkt)), 'each layer keeps its .prj');
  const feats = classified(r, toWgs(r));
  eq(feats.map(f => [f.sourceCategory, f.category]), [['Emprise_projet', 'gross'], ['Ligne_HTA', 'linear'], ['Zone_exclusion', 'exclusion']].sort((a, b) => (a[0] > b[0] ? 1 : -1)), 'categories');
  useProject(feats);
  const a = areaOf(), e = expected.fr_lambert93;
  near(a.grossArea, e.grossGeodesicM2, 1, 'gross area vs ArcGIS geodesic');
  near(a.buildableArea, e.grossGeodesicM2 - e.exclusionGeodesicM2, 1, 'buildable (line without buffer cuts nothing)');
  eq(a.ignored, 1, 'line without buffer');
  return `gross ${a.grossArea.toFixed(2)} m² (grid 100 000, ArcGIS ${e.grossGeodesicM2})`;
});
await test('Shapefile in Monte Mario (.prj): datum shift applied', async () => {
  const r = await readAnyFile(await fixture('it_monte_mario.zip'));
  const [f] = toWgs(r);
  const first = f.geometry.coordinates[0][0];
  const ref = projectPointToWgs84(3003, expected.it_monte_mario.firstVertex);
  assert(metres(first, ref) < 0.01, `vertex ${metres(first, ref).toFixed(3)} m from the SDK EPSG:3003 projection`);
  // what proj4 (shpjs with the .prj) gives: no datum shift
  const [shp, JSZip] = await Promise.all([loadShp(), loadJsZip()]);
  const zip = await JSZip.loadAsync(await fixture('it_monte_mario.zip'));
  const g = shp.parseShp(await zip.file('Perimetro_lordo.shp').async('arraybuffer'), await zip.file('Perimetro_lordo.prj').async('text'));
  const p4 = g[0].coordinates[0][0];
  const shift = metres(first, p4);
  assert(shift > 30, `proj4 differs by only ${shift.toFixed(1)} m`);
  useProject(classified(r, [f]));
  near(areaOf().grossArea, expected.it_monte_mario.grossGeodesicM2, 3, 'area');
  return `proj4 without datum shift would be ${shift.toFixed(1)} m off`;
});
await test('Shapefile without .prj: candidates and conversion', async () => {
  const r = await readAnyFile(await fixture('it_utm32_noprj.zip'));
  eq(r.needsCrs, true, 'needsCrs'); assert(looksProjected(r.sample), 'projected');
  const cands = candidatesForProjected(r.sample, projectPointToWgs84).map(o => o.wkid);
  for (const w of [6707, 25832, 32632]) assert(cands.includes(w), `candidate ${w} in ${cands}`);
  assert(!cands.includes(2154) && !cands.includes(25830), `no foreign candidates: ${cands}`);
  useProject(classified(r, toWgs(r, 6707)));
  near(areaOf().grossArea, expected.it_utm32_noprj.grossGeodesicM2, 1, 'area');
  return `candidates ${cands.join(', ')}`;
});
await test('Lambert-93 coordinates without system: only French candidates', async () => {
  const cands = candidatesForProjected([[842000, 6519000], [842400, 6519250]], projectPointToWgs84);
  assert(cands.length && cands.every(o => o.iso === 'FR') && cands.some(o => o.wkid === 2154), JSON.stringify(cands.map(o => o.wkid)));
  return cands.map(o => o.wkid).join(', ');
});
await test('GeoJSON with a legacy "crs" (LV95)', async () => {
  const r = await readAnyFile(await fixture('ch_lv95.geojson'));
  eq(r.declaredWkid, 2056, 'declared'); eq(r.needsCrs, false, 'needsCrs');
  useProject(classified(r, toWgs(r)));
  near(areaOf().grossArea, expected.ch_lv95.grossGeodesicM2, 2, 'area');
  eq(suggestCrs(store.project.features[0].geometry.coordinates[0]).wkid, 2056, 'proposed system');
});
await test('KML with nested folders', async () => {
  const r = await readAnyFile(await fixture('es_sites.kml'));
  eq(r.features.length, 6, 'features');
  const byName = Object.fromEntries(classified(r, r.features).map(f => [f.name, f]));
  eq(byName['Parcela 1'].sourceCategory, 'Superficie bruta', 'folder');
  eq(byName['Arroyo zona'].sourceCategory, 'Restricciones / Zona inundable', 'nested folder');
  eq(Object.values(byName).map(f => f.category), ['gross', 'exclusion', 'linear', 'obstacle', 'obstacle', 'access'], 'categories');
  eq(byName['Línea MT 20 kV'].attrs.type, 'overhead-power', 'line type');
  const feats = Object.values(byName);
  useProject(feats);
  const e = expected.es_sites;
  let a = areaOf();
  near(a.grossArea, e.grossGeodesicM2, 2, 'gross');
  near(a.buildableArea, e.grossGeodesicM2 - e.exclusionGeodesicM2, 2, 'buildable');
  eq(a.ignored, 3, 'line and trees without buffer');
  store.project.features.find(f => f.category === 'linear').attrs.buffer = 10;
  store.project.features.filter(f => f.category === 'obstacle').forEach(f => { f.attrs.buffer = 5; });
  const b = areaOf();
  eq(b.ignored, 0, 'all cut');
  assert(b.buildableArea < a.buildableArea - 5000, `buffers cut ${a.buildableArea - b.buildableArea} m²`);
  eq(suggestCrs(feats[0].geometry.coordinates[0]).wkid, 25830, 'Spain zone 30');
  return `cut by the 10 m line buffer and 5 m tree buffers: ${(a.buildableArea - b.buildableArea).toFixed(0)} m²`;
});
await test('KMZ in Bavaria and Brandenburg: zone of the Land', async () => {
  for (const [file, key] of [['de_bayern.kmz', 'de_bayern'], ['de_brandenburg.kmz', 'de_brandenburg']]) {
    const r = await readAnyFile(await fixture(file));
    const [f] = classified(r, r.features);
    eq(f.category, 'gross', file + ' category');
    eq(suggestCrs(f.geometry.coordinates[0]).wkid, expected[key].wkid, file);
  }
});
await test('CSV of obstacles (semicolons, decimal commas)', async () => {
  const r = await readAnyFile(await fixture('pl_obstacles.csv'));
  const feats = classified(r, r.features);
  const e = expected.pl_obstacles;
  eq(feats.length, e.n, 'points');
  eq(feats.map(f => f.attrs.height), e.heights, 'heights');
  eq(feats.map(f => f.attrs.type), e.types, 'types');
  assert(feats.every(f => f.category === 'obstacle'), 'obstacles');
  near(feats[0].geometry.coordinates[0], 16.9001, 1e-9, 'longitude');
});
await test('Geoportale project (.axpo)', async () => {
  const r = await readAnyFile(await fixture('sample.axpo'));
  const feats = classified(r, r.features);
  const cats = feats.map(f => `${f.sourceCategory || f.kind}:${f.category}`);
  for (const c of ['Perimetro Netto:net', 'Vincoli paesaggistici:exclusion', 'parcel:reference']) assert(cats.includes(c), `${c} in ${cats}`);
  assert(feats.some(f => f.category === 'linear' && f.attrs.type === 'overhead-power'), 'power line');
  return cats.join(' · ');
});

await test('Geoportale project with the site-features model: codes read, never guessed', async () => {
  const r = await readAnyFile(await fixture('it_site_features.axpo'));
  const got = Object.fromEntries(classified(r, r.features).map(f => [f.name, [f.category, f.attrs]]));
  eq(got, expected.it_site_features.categories, 'categories and attributes');
  eq(r.site && r.site.code, 'C0000', 'site of work');
  return Object.entries(got).map(([n, [c]]) => `${n}: ${c}`).join(' · ');
});
await test('GeoJSON exported by the Geoportale: explicit category and attributes', async () => {
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[10, 45], [10.01, 45]] },
      properties: { nome: 'Linea', tipo: 'disegno', categoria: 'Infrastruttura lineare · Elettrodotto aereo', category: 'linear', type: 'overhead-power', buffer: 5, voltage: 20 } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [square(10, 45)] },
      properties: { nome: 'Vincolo', category: 'exclusion', type: 'no-such-type', buffer: -2 } } ] };
  const r = await readAnyFile(new File([JSON.stringify(fc)], 'geoportale.geojson'));
  const got = classified(r, r.features).map(f => [f.name, f.category, f.attrs]);
  eq(got, [['Linea', 'linear', { type: 'overhead-power', buffer: 5, voltage: 20 }], ['Vincolo', 'exclusion', {}]], 'explicit codes, bad values dropped');
});
await test('files dropped on a category: what fits goes there, the rest is sorted', async () => {
  useProject([]);
  const n = await importFiles([await fixture('es_sites.kml')], 'gross');
  eq(n, 6, 'imported');
  const cats = store.project.features.map(f => `${f.name}:${f.category}`);
  eq(cats, ['Parcela 1:gross', 'Arroyo zona:gross', 'Línea MT 20 kV:linear', 'Encina 1:obstacle', 'Encina 2:obstacle', 'Acceso principal:access'], 'categories');
  return cats.join(' · ');
});

// ── net area ──
const F = makeLocalFrame({ lon0: 12.5, lat0: 41.9 });
function local(kind, coords) {
  const { Polygon, Polyline, Point, SpatialReference } = getSdk();
  const g = kind === 'polygon' ? new Polygon({ rings: [coords], spatialReference: F.sr })
    : kind === 'line' ? new Polyline({ paths: [coords], spatialReference: F.sr }) : new Point({ x: coords[0], y: coords[1], spatialReference: F.sr });
  return toGeoJSON(F.toSr(g, SpatialReference.WGS84));
}
const rectL = (x0, y0, x1, y1) => local('polygon', [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]);
const cuts = [
  { name: 'excl', category: 'exclusion', geometry: rectL(40, 40, 60, 60) },
  { name: 'line', category: 'linear', geometry: local('line', [[150, -20], [150, 120]]), attrs: { type: 'road', buffer: 2 } },
  { name: 'tree', category: 'obstacle', geometry: local('point', [100, 50]), attrs: { type: 'tree', buffer: 3 } },
  { name: 'ref', category: 'reference', geometry: rectL(0, 0, 200, 100) },
  { name: 'gate', category: 'access', geometry: local('point', [0, 50]), attrs: { type: 'site-access' } },
];
await test('net area computed: gross − setback − exclusions with their buffers', () => {
  useProject([{ name: 'gross', category: 'gross', geometry: rectL(0, 0, 200, 100) }, ...cuts], { boundarySetback: 5 });
  const a = areaOf();
  eq(a.netMode, 'computed', 'mode');
  near(a.grossArea, 20000, 0.01, 'gross');
  near(a.baseArea, 190 * 90, 0.01, 'after the 5 m setback');
  near(a.setbackArea, 20000 - 17100, 0.01, 'setback strip');
  const circle = a.baseArea - 400 - 4 * 90 - a.buildableArea;
  near(circle, Math.PI * 9, 0.3, 'tree buffer');
  return `buildable ${a.buildableArea.toFixed(2)} m² = 17 100 − 400 − 360 − ${circle.toFixed(2)}`;
});
await test('net area given: used as it is, still minus exclusions', () => {
  useProject([{ name: 'gross', category: 'gross', geometry: rectL(0, 0, 200, 100) }, { name: 'net', category: 'net', geometry: rectL(10, 10, 160, 90) }, ...cuts], { boundarySetback: 5 });
  const a = areaOf();
  eq(a.netMode, 'given', 'mode');
  near(a.baseArea, 150 * 80, 0.01, 'net (setback not applied)');
  near(a.buildableArea, 12000 - 400 - 4 * 80 - Math.PI * 9, 0.3, 'buildable');
});
await test('mitigation and agricultural strips: width of lines, whole polygons', () => {
  useProject([{ name: 'gross', category: 'gross', geometry: rectL(0, 0, 200, 100) },
    { name: 'hedge', category: 'mitigation', geometry: local('line', [[-10, 30], [210, 30]]), attrs: { width: 6 } },
    { name: 'field', category: 'agri', geometry: rectL(0, 60, 50, 100) }]);
  const a = areaOf();
  near(a.buildableArea, 20000 - 6 * 200 - 50 * 40, 0.01, 'buildable');
});
await test('grid connection route: length on the ellipsoid, never cut from the site', () => {
  // 0.01° along the meridian at 45° N is 1 111.3 m on the WGS 84 ellipsoid
  near(lineLengthKm({ type: 'LineString', coordinates: [[10, 44.995], [10, 45.005]] }), 1.1113, 0.0005, 'meridian arc (km)');
  useProject([{ name: 'gross', category: 'gross', geometry: rectL(0, 0, 200, 100) },
    { name: 'route', category: 'connection', geometry: local('line', [[100, -500], [100, 50]]), attrs: { type: 'estimated' } }]);
  const a = areaOf();
  near(a.buildableArea, 20000, 0.01, 'not cut');
  eq(a.ignored, 0, 'not counted among the lines without buffer');
  near(lineLengthKm(store.project.features[1].geometry), 0.55, 0.0005, 'route of 550 m (km)');
});

// ── round trips ──
await test('project file (.pvpd) round trip', async () => {
  const p = useProject(cuts.concat([{ name: 'gross', category: 'gross', geometry: rectL(0, 0, 200, 100) }]), { boundarySetback: 7.5 });
  p.name = 'Round trip'; p.field.pitch = 9.6; p.crs = { wkid: 6708, auto: false, country: 'IT' };
  const before = JSON.parse(JSON.stringify(p));
  const blob = await projectBlob();
  assert(await openProjectFile(new File([blob], 'x.pvpd')), 'opened');
  const after = JSON.parse(JSON.stringify(store.project));
  delete after.saved; delete after.app;
  eq(after, before, 'project');
  return `${(blob.size / 1024).toFixed(1)} KB`;
});
await test('GeoJSON export imported back keeps categories and buffers', async () => {
  useProject([{ name: 'gross', category: 'gross', geometry: rectL(0, 0, 200, 100) }, ...cuts]);
  const fc = buildGeoJSON();
  const r = await readAnyFile(new File([JSON.stringify(fc)], 'export.geojson'));
  const back = classified(r, r.features);
  eq(back.map(f => [f.name, f.category, f.attrs]), store.project.features.map(f => [f.name, f.category, f.attrs]), 'objects');
});

const ok = results.filter(r => r.ok).length;
document.getElementById('sum').innerHTML = `<b class="${ok === results.length ? 'ok' : 'err'}">${ok} / ${results.length} passed</b>`;
document.getElementById('out').innerHTML = results.map(r => `<tr><td class="s ${r.ok ? 'ok' : 'err'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}<br><code>${String(r.note).replace(/</g, '&lt;')}</code></td></tr>`).join('');
window.__results = results;
