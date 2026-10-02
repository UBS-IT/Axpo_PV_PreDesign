// 4b · 3D with the real SceneView (WebGL; headless Chromium draws it with SwiftShader, see tools/headless): the panels
// of the app on a real MapView sharing its Map with the SceneView, a site in Italy with synthetic DTM over a flat
// stand-in for Esri World Elevation (no Internet in the test bench), the quick predesign, then step 4b: the scene
// starts on the site without errors, the ground follows the terrain model, the layout is drawn, sun buttons, views,
// report and back to 2D. Run in the browser: /tests/scene3d.html.
import { loadSdk, getSdk, loadSdk3d } from '../app/js/sdk.js';
import { loadCatalog } from '../app/js/catalog.js';
import { applyI18n } from '../app/js/i18n.js';
import { store, defaultProject, change } from '../app/js/state.js';
import { loadCountries } from '../app/js/crs.js';
import { initAreas, siteFrame } from '../app/js/areas.js';
import { initTerrain, sampleDtm, gridForSite, useGrid } from '../app/js/terrain/terrain.js';
import { initModulesUi, library } from '../app/js/modules.js';
import { initField, last } from '../app/js/field.js';
import { initInfra } from '../app/js/infra.js';
import { initOutput } from '../app/js/output.js';
import { initQuick, runQuick } from '../app/js/quick.js';
import { makeLocalFrame } from '../app/js/geo/localframe.js';
import { toGeoJSON, projectPointToWgs84 } from '../app/js/geo/convert.js';
import { initView3d, view3dState, scene3dConfig, reportWithViews, set3d } from '../app/js/view3d/scene.js';
import { groundAt } from '../app/js/view3d/geometry.js';

const results = [];
window.__progress = results;   // for a screenshot while the scene is shown (tools/headless)
async function test(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); }
  catch (e) { console.error(name, e); results.push({ name, ok: false, note: e && e.message || String(e) }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const logError = console.error;
console.error = (...a) => { errors.push(a.map(x => (x && x.message) || String(x)).join(' ')); logError(...a); };
window.addEventListener('error', e => errors.push(String(e.message)));
const sceneErrors = () => errors.filter(e => /Exception in task|TypeError|NaN|layerview:|Failed to resolve/i.test(e));

await loadSdk();
await loadSdk3d();
await loadCatalog();
await loadCountries();
const html = await (await fetch('../app/index.html')).text();
const doc = new DOMParser().parseFromString(html, 'text/html');
const box = document.createElement('div');
box.style.display = 'none';
box.append(doc.getElementById('top'), doc.getElementById('side'), ...doc.querySelectorAll('body > input[type=file]'));
const railAreas = document.createElement('span'); railAreas.id = 'railAreas'; box.append(railAreas);
document.body.append(box, doc.getElementById('toast'));
// Use the app's actual map markup/CSS rather than a stand-in 2D view.
const appStack = doc.getElementById('mapStack');
const body = document.getElementById('body');
if (appStack) body.append(appStack);
else body.append(doc.getElementById('view'), doc.getElementById('view3d'));
applyI18n(box);

// World Elevation stand-in: a flat ground at 90 m on the Web Mercator tiling
const { Map, MapView, SpatialReference, Extent, Polygon } = getSdk();
const [BaseElevationLayer, BaseTileLayer, Basemap, TileInfo] = await $arcgis.import(['@arcgis/core/layers/BaseElevationLayer.js', '@arcgis/core/layers/BaseTileLayer.js', '@arcgis/core/Basemap.js', '@arcgis/core/layers/support/TileInfo.js']);
const Flat = BaseElevationLayer.createSubclass({
  load() {
    this.tileInfo = TileInfo.create({ spatialReference: SpatialReference.WebMercator, size: 256, numLODs: 20 });
    this.spatialReference = SpatialReference.WebMercator;
    this.fullExtent = new Extent({ xmin: -20037508.34, ymin: -20037508.34, xmax: 20037508.34, ymax: 20037508.34, spatialReference: SpatialReference.WebMercator });
    return this;
  },
  fetchTile() { return Promise.resolve({ values: new Float32Array(257 * 257).fill(90), width: 257, height: 257, maxZError: 0, noDataValue: -99999 }); },
});
scene3dConfig.baseElevation = () => new Flat({ title: 'flat' });

// A local Web Mercator basemap makes the shared Map choose the same 3D spatial reference
// as the real app's satellite basemap, without network requests in the test bench.
const FlatBasemap = BaseTileLayer.createSubclass({
  load() {
    this.tileInfo = TileInfo.create({ spatialReference: SpatialReference.WebMercator, size: 256, numLODs: 20 });
    this.spatialReference = SpatialReference.WebMercator;
    this.fullExtent = new Extent({ xmin: -20037508.34, ymin: -20037508.34, xmax: 20037508.34, ymax: 20037508.34, spatialReference: SpatialReference.WebMercator });
    return this;
  },
  fetchTile() {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const ctx = tile.getContext('2d');
    ctx.fillStyle = '#c9c9c9';
    ctx.fillRect(0, 0, tile.width, tile.height);
    return Promise.resolve(tile);
  },
});
const view = new MapView({
  container: 'view', map: new Map({ basemap: new Basemap({ baseLayers: [new FlatBasemap({ title: 'offline Web Mercator' })] }) }), spatialReference: SpatialReference.WebMercator,
  // With an empty map there is no basemap tiling scheme from which to infer zoom.
  center: [10.5, 46.5], scale: 4000000, constraints: { snapToZoom: false },
});
window.__sceneTest2dView = view; // inspect view.ready/size/fatalError if the fixture fails
const setupStatus = document.getElementById('sum');
setupStatus.textContent = 'Preparing real 2D view...';
try {
  await Promise.race([
    view.when(),
    wait(30000).then(() => { throw new Error('2D MapView did not become ready within 30 seconds'); }),
  ]);
} catch (error) {
  setupStatus.textContent = 'Setup FAIL: ' + (error?.message || String(error));
  throw error;
}
library.modules = [];
const [lon, lat] = projectPointToWgs84(32633, [317500, 5063500]);
const f = makeLocalFrame({ lon0: lon, lat0: lat });
const sq = new Polygon({ rings: [[[-150, -150], [-150, 150], [150, 150], [150, -150], [-150, -150]]], spatialReference: f.sr });
const p = defaultProject();
p.name = 'Scene';
p.features = [{ id: 'g', name: 'gross', category: 'gross', geometry: toGeoJSON(f.toSr(sq, SpatialReference.WGS84)), attrs: {}, source: 'test', sourceCategory: '' }];
store.project = p;
initAreas(view); initTerrain(view); initModulesUi(); initField(view); initInfra(view); initOutput(); initQuick(); initView3d(view);
await wait(600);
document.getElementById('sum').textContent = 'Preparing synthetic terrain and layout...';
// the synthetic DTM (a 12 % plane) as the terrain model of step 0
const g = gridForSite();
const file = new File([await (await fetch('./fixtures/it_dtm_plane.tif')).blob()], 'it_dtm_plane.tif');
const r0 = await sampleDtm(file, g.frame, g.def);
await useGrid({ id: 'scene', lon0: g.frame.lon0, lat0: g.frame.lat0, ...g.def, source: 'dtm', name: file.name, loadedAt: new Date().toISOString(), zmin: 100, zmax: 220, missing: 0 }, r0.z, { persist: false });
change('terrain', q => { q.terrain.applySlopeLimit = false; });
await runQuick({ technology: 'ground-fixed' });
await wait(600);

const settle = async (ms = 60000) => {
  const s = view3dState.scene;
  const { reactiveUtils } = getSdk();
  await Promise.race([reactiveUtils.whenOnce(() => s.ready && !s.updating), wait(ms)]);
  await wait(1500);
};

document.getElementById('sum').textContent = 'Running scene tests...';
await test('step 4b opens a SceneView on the site, without errors of the scene', async () => {
  set3d(true);
  for (let i = 0; i < 100 && !view3dState.scene; i++) await wait(100);
  assert(view3dState.scene, 'scene created');
  await settle();
  const s = view3dState.scene, c = s.center;
  assert(s.ready, 'scene ready');
  assert(s.spatialReference?.isWebMercator, '3D scene must use the Web Mercator basemap reference: ' + JSON.stringify(s.spatialReference?.toJSON()));
  assert(view.ready && view.map === s.map, 'real MapView and SceneView share one map');
  assert(document.getElementById('view').getBoundingClientRect().height > 0, '2D container keeps its height in 3D');
  assert(s.container.querySelector('.esri-view-root')?.getBoundingClientRect().height > 0, '3D internal root has non-zero height');
  assert(s.width > 0 && s.height > 0, `scene size: ${s.width} x ${s.height}`);
  const canvases = [...s.container.querySelectorAll('canvas')];
  assert(canvases.some(c => c.getBoundingClientRect().height > 0 && c.width > 0 && c.height > 0), '3D canvas has non-zero CSS and pixel sizes');
  assert(c && Number.isFinite(c.longitude) && Math.abs(c.longitude - lon) < 0.05 && Math.abs(c.latitude - lat) < 0.05, `centre on the site: ${c?.longitude}, ${c?.latitude}`);
  assert(!sceneErrors().length, 'errors: ' + sceneErrors().slice(0, 3).join(' | '));
  const layer = s.map.layers.find(l => l.title === '3D layout');
  const kinds = layer.graphics.map(x => x.attributes.kind).toArray();
  assert(kinds.includes('tables') && kinds.includes('fence'), 'drawn: ' + kinds.join(', '));
  assert(!s.map.layers.find(l => l.title === 'Tables').visible, 'flat 2D tables hidden');
  assert(document.querySelector('#view3d .esri-daylight, #view3d arcgis-daylight, #view3d .esri-ui-top-right > *'), 'date and time widget on the map: ' + document.querySelector('#view3d .esri-ui-top-right')?.innerHTML.slice(0, 200));
  if (window.__snap) await window.__snap('opened');   // screenshots of the scene (tools/headless/snap3d.mjs)
  return `${last.result.tables} tables · ${kinds.join(', ')} · centre ${c.longitude.toFixed(4)}, ${c.latitude.toFixed(4)}`;
});

await test('the ground of the scene is the terrain model of step 0 (over the stand-in World Elevation)', async () => {
  const s = view3dState.scene, frame = siteFrame();
  const { Multipoint, SpatialReference: SR, projectOperator } = getSdk();
  const pts = [[0, 0], [60, -40], [-100, 90]];
  const expect = await groundAt(frame, pts, { query: null });
  const mp = projectOperator.execute(new Multipoint({ points: pts, spatialReference: frame.sr }), SR.WebMercator);
  const got = (await s.map.ground.queryElevation(mp, { demResolution: 'finest-contiguous' })).geometry.points.map(q => q[2]);
  got.forEach((z, i) => assert(Math.abs(z - expect[i]) < 0.6, `point ${i}: ground ${z.toFixed(2)} vs terrain ${expect[i].toFixed(2)}`));
  const far = projectOperator.execute(new Multipoint({ points: [[3000, 3000]], spatialReference: frame.sr }), SR.WebMercator);
  const zf = (await s.map.ground.queryElevation(far)).geometry.points[0][2];
  assert(Math.abs(zf - 90) < 0.01, 'outside the model: World Elevation (90 m) ' + zf);
  return got.map(z => z.toFixed(2)).join(' / ') + ' m';
});

await test('AgriPV fixed without a low edge: said in the panel, no tables, no errors; typed in: the tables come', async () => {
  const s = view3dState.scene, layer = s.map.layers.find(l => l.title === '3D layout');
  change('field', q => { q.field.technology = 'agri-fixed'; q.field.structure = '2V14'; q.field.pitch = 9; });
  await wait(1500); await settle(20000);
  const panel = document.getElementById('d3Panel');
  assert(/AgriPV fixed structures: type the low-edge height/.test(panel.textContent), 'note in the panel');
  assert(!layer.graphics.some(x => x.attributes.kind === 'tables'), 'no tables without a height');
  const le = panel.querySelector('#d3LowEdge'); le.value = '2.1'; le.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(1500); await settle(20000);
  assert(layer.graphics.some(x => x.attributes.kind === 'tables'), 'tables with the typed height');
  eq(document.getElementById('d3LowEdge').value, '2.1', 'value kept');
  assert(!sceneErrors().length, 'errors: ' + sceneErrors().slice(0, 3).join(' | '));
  return `${last.result.tables} tables 2V14 at 2.10 m`;
});

await test('terrain of step 0 sampled from World Elevation: the scene uses World Elevation itself', async () => {
  const s = view3dState.scene;
  await useGrid({ ...store.project.terrain.grid, id: 'scene-esri', source: 'esri', name: 'Esri World Elevation' }, (await import('../app/js/terrain/store.js')).terrainData.z, { persist: false });
  await wait(1500); await settle(20000);
  eq(s.map.ground.layers.map(l => l.title).toArray(), ['flat'], 'ground');
  assert(/Esri World Elevation \(load a DTM/.test(document.getElementById('d3Panel').textContent), 'said in the panel');
  assert(!sceneErrors().length, 'errors: ' + sceneErrors().slice(0, 3).join(' | '));
});

await test('sun buttons, shading readout, ShadowCast, a saved view, the report with the view, back to 2D', async () => {
  const s = view3dState.scene, panel = document.getElementById('d3Panel');
  panel.querySelector('[data-sun="12-21-9"]').click();
  await wait(300);
  const d = s.environment.lighting.date;
  assert(d.getUTCMonth() === 11 && d.getUTCDate() === 21, 'date set: ' + d.toISOString());
  assert(/sun .*high/.test(document.getElementById('d3Sun').textContent) && /shading/.test(document.getElementById('d3Sun').textContent), document.getElementById('d3Sun').textContent);
  const sc = panel.querySelector('#d3Shadow'); sc.checked = true; sc.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(20000);
  panel.querySelector('#d3Save').click();
  await wait(300);
  eq(store.project.view3d.viewpoints.length, 1, 'view saved');
  const click = HTMLAnchorElement.prototype.click, got = [];
  HTMLAnchorElement.prototype.click = function () { got.push(this.download); };
  let rep;
  try { rep = await reportWithViews(); } finally { HTMLAnchorElement.prototype.click = click; }
  assert(rep && rep.doc.getNumberOfPages() === 2 && got.length === 1, `report: ${rep && rep.doc.getNumberOfPages()} pages, downloads ${got}`);
  const sc2 = document.getElementById('d3Shadow'); sc2.checked = false; sc2.dispatchEvent(new Event('change', { bubbles: true }));
  assert(!sceneErrors().length, 'errors: ' + sceneErrors().slice(0, 3).join(' | '));
  set3d(false);
  assert(!document.body.classList.contains('in-3d') && !s.map.layers.find(l => l.title === '3D layout').visible && s.map.layers.find(l => l.title === 'Tables').visible, 'back to 2D');
  return `${(rep.blob.size / 1024).toFixed(0)} KB report`;
});
function eq(a, b, w) { assert(JSON.stringify(a) === JSON.stringify(b), `${w}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); }

const ok = results.filter(r => r.ok).length;
document.getElementById('sum').innerHTML = `<b class="${ok === results.length ? 'ok' : 'err'}">${ok} / ${results.length} passed</b>`;
document.getElementById('out').innerHTML = results.map(r => `<tr><td class="s ${r.ok ? 'ok' : 'err'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}<br><code>${String(r.note).replace(/</g, '&lt;')}</code></td></tr>`).join('');
window.__results = results;
