// Step 2 · Terrain: slopes, masks and outlines (pure), then GeoTIFF sampling, the Esri sampler, the cut of the
// buildable area by the slope limit (the toolkit rule of the structure or one chosen by hand), the project file and
// the Geoportale projects with slopes from their DTM (SDK). Fixtures: fixtures/it_dtm_plane.tif, a synthetic plane
// rising 12 % to the north in EPSG:32633 (tools/headless/make_terrain_fixture.mjs); fixtures/it_slope*.axpo, a plane
// rising 9 % east and 5 % north with the grid of the Geoportale (scripts/make_axpo_slope_fixture.py).
import { loadSdk, getSdk } from '../app/js/sdk.js';
import { loadCatalog } from '../app/js/catalog.js';
import { store, defaultProject, upgrade } from '../app/js/state.js';
import { gradients, limitMask, classMask, dropSmallPatches, maskToRings, ringArea, gridOver, bilinear } from '../app/js/terrain/slope.js';
import { openGeoTiff } from '../app/js/terrain/dtm.js';
import { sampleDtm, sampleEsri, gridForSite, useGrid, removeTerrain, overLimit, currentSlopeRule, effectiveLimit, setLimit, limitText, terrainStale } from '../app/js/terrain/terrain.js';
import { terrainData, setTerrainData } from '../app/js/terrain/store.js';
import { computeArea, siteFrame, importFiles } from '../app/js/areas.js';
import { readAnyFile } from '../app/js/io/importers.js';
import { makeLocalFrame } from '../app/js/geo/localframe.js';
import { toGeoJSON, projectPointToWgs84 } from '../app/js/geo/convert.js';
import { projectBlob, openProjectFile } from '../app/js/io/projectfile.js';

const results = [];
async function test(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); }
  catch (e) { console.error(name, e); results.push({ name, ok: false, note: e && e.message || String(e) }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, w) => assert(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b} (tolerance ${tol})`);
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const plane = (nx, ny, cell, fn) => { const z = new Float32Array(nx * ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = fn((i + 0.5) * cell, (j + 0.5) * cell); return { x0: 0, y0: 0, cell, nx, ny, z }; };

// ── pure ──
await test('slopes of a plane: exact components, edges included', () => {
  const g = gradients(plane(20, 15, 5, (x, y) => 50 + 0.08 * x - 0.12 * y));
  for (let k = 0; k < g.gx.length; k++) { near(g.gx[k], 0.08, 1e-5, 'east'); near(g.gy[k], -0.12, 1e-5, 'north'); }
  return 'dz/dx 8 %, dz/dy −12 % on every cell';
});

await test('slope limits: fixed 3V (10 % N-S and E-W) and tracker 1V (15 % any direction)', () => {
  const fixed = { maxNS: 10, maxEW: 10 }, tracker = { maxAny: 15 };
  const cases = [[0.12, 0, true, false], [0.08, 0.08, false, false], [0.11, 0.11, true, true], [0, 0.16, true, true], [0.09, 0.0, false, false]];
  for (const [sx, sy, fixedOver, trackerOver] of cases) {
    const g = gradients(plane(6, 6, 2, (x, y) => sx * x + sy * y));
    const f = limitMask(g, fixed), t = limitMask(g, tracker);
    assert((f.over === 36) === fixedOver && (f.over === 0) === !fixedOver, `fixed ${sx} ${sy}: ${f.over}`);
    assert((t.over === 36) === trackerOver && (t.over === 0) === !trackerOver, `tracker ${sx} ${sy}: ${t.over}`);
  }
  return '8 % + 8 % (11.3 % steepest) passes both; 11 % + 11 % fails both';
});

await test('no-data cells are never over the limit and do not spoil their neighbours', () => {
  const grid = plane(10, 10, 5, (x, y) => 0.05 * y);
  grid.z[55] = NaN;
  const g = gradients(grid), m = limitMask(g, { maxAny: 4 });
  assert(m.unknown === 1 && m.over === 99, `over ${m.over}, unknown ${m.unknown}`);
  near(g.gy[54], 0.05, 1e-6, 'neighbour of a hole');
});

await test('patch filter (4-connected) and outlines: area = cells, holes and corner-touching cells', () => {
  const rnd = mulberry32(25092026);
  let rings = 0;
  for (let n = 0; n < 60; n++) {
    const nx = 5 + Math.floor(rnd() * 30), ny = 5 + Math.floor(rnd() * 30), cell = 1 + rnd() * 9;
    const mask = new Uint8Array(nx * ny).map(() => rnd() < 0.45 ? 1 : 0);
    const r = maskToRings(mask, nx, ny, 100, 200, cell);
    let cells = 0; for (const v of mask) cells += v;
    const area = r.reduce((s, ring) => s + ringArea(ring), 0);
    near(area, cells * cell * cell, 1e-6 * cells * cell * cell + 1e-9, `case ${n}: signed area of the rings`);
    for (const ring of r) assert(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1], 'closed');
    rings += r.length;
  }
  const m = new Uint8Array([1, 0, 0, 1, 1, 0, 0, 0, 1]);   // 3 x 3: a pair and a corner cell
  const removed = dropSmallPatches(m, 3, 3, 2);
  assert(removed === 1 && m[8] === 0 && m[0] === 1, 'the lone cell goes, the pair stays');
  const diag = maskToRings(new Uint8Array([1, 0, 0, 1]), 2, 2, 0, 0, 1);
  assert(diag.length === 2, `cells touching at a corner: ${diag.length} rings`);
  const ring = maskToRings(new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]), 3, 3, 0, 0, 1);
  assert(ring.length === 2 && ringArea(ring[0]) * ringArea(ring[1]) < 0, 'an outer ring and a hole of opposite orientation');
  return `60 random masks, ${rings} rings`;
});

await test('grid over a site and bilinear sampling', () => {
  const g = gridOver({ xmin: 0, ymin: 0, xmax: 400, ymax: 300 }, 5, 30);
  assert(g.nx === 92 && g.ny === 72 && g.x0 === -30 && !g.grown, JSON.stringify(g));
  const big = gridOver({ xmin: 0, ymin: 0, xmax: 20000, ymax: 20000 }, 5, 30, 2e6);
  assert(big.grown && big.nx * big.ny <= 2e6, 'large sites get a coarser cell');
  const v = new Float32Array([0, 1, 2, 3]);   // 2 x 2
  near(bilinear(v, 2, 2, 0.5, 0.5), 1.5, 1e-9, 'centre');
  assert(Number.isNaN(bilinear(v, 2, 2, 3, 0)), 'outside');
  assert(Number.isNaN(bilinear(new Float32Array([0, -9999, 2, 3]), 2, 2, 0.5, 0.5, -9999)), 'next to no-data');
});

// ── with the SDK ──
await loadSdk();
await loadCatalog();
const file = new File([await (await fetch('./fixtures/it_dtm_plane.tif')).blob()], 'it_dtm_plane.tif');
const PLANE = { e0: 317000, n0: 5063000, slope: 0.12 };   // z = 100 + 0.12 (N − N0), see the fixture
const zAt = (e, n) => 100 + PLANE.slope * (n - PLANE.n0);
// a square site of side 2a metres around a UTM point, as the gross area of the project
function useSite(e, n, a = 200, field = {}) {
  const [lon, lat] = projectPointToWgs84(32633, [e, n]);
  const f = makeLocalFrame({ lon0: lon, lat0: lat });
  const { Polygon, SpatialReference } = getSdk();
  const sq = new Polygon({ rings: [[[-a, -a], [-a, a], [a, a], [a, -a], [-a, -a]]], spatialReference: f.sr });
  const p = defaultProject();
  p.features = [{ id: 'g', name: 'gross', category: 'gross', geometry: toGeoJSON(f.toSr(sq, SpatialReference.WGS84)), attrs: {}, source: 'test', sourceCategory: '' }];
  Object.assign(p.field, field);
  store.project = p;
  return p;
}

await test('GeoTIFF: system, georeferencing and no-data read from the file', async () => {
  const t = await openGeoTiff(file);
  assert(t.epsg === 32633 && t.width === 250 && t.height === 250, `${t.epsg} ${t.width}x${t.height}`);
  assert(t.res[0] === 4 && t.res[1] === -4 && t.noData === -9999, `res ${t.res} nodata ${t.noData}`);
  assert(t.origin[0] === 317002 && t.origin[1] === 5063998, `centre of the first pixel ${t.origin}`);
  const w = await t.read(0, 0, 2, 1);
  near(w[0], zAt(0, 5063998), 1e-3, 'first pixel');
});

let site;
await test('DTM sampled on the grid of the site: elevations of the plane at every cell centre', async () => {
  useSite(317500, 5063500);
  site = gridForSite(10);
  const r = await sampleDtm(file, site.frame, site.def, () => { throw new Error('no dialog expected'); });
  const { Multipoint, projectOperator, SpatialReference } = getSdk();
  const pts = [];
  for (let j = 0; j < site.def.ny; j++) for (let i = 0; i < site.def.nx; i++) pts.push([site.def.x0 + (i + 0.5) * site.def.cell, site.def.y0 + (j + 0.5) * site.def.cell]);
  const utm = projectOperator.execute(new Multipoint({ points: pts, spatialReference: site.frame.sr }), new SpatialReference({ wkid: 32633 })).points;
  let worst = 0;
  utm.forEach((p, k) => { worst = Math.max(worst, Math.abs(r.z[k] - zAt(p[0], p[1]))); });
  assert(worst < 0.01, `worst difference ${worst} m`);
  return `${site.def.nx} × ${site.def.ny} cells of ${site.def.cell} m, worst ${(worst * 1000).toFixed(2)} mm`;
});

await test('slope of the plane seen in the local frame: 12 %, grid convergence of UTM 33 included', async () => {
  const r = await sampleDtm(file, site.frame, site.def);
  const g = gradients({ ...site.def, z: r.z });
  const k = Math.floor(g.gx.length / 2) + Math.floor(site.def.nx / 2);
  const mag = Math.hypot(g.gx[k], g.gy[k]) * 100;
  near(mag, 12, 0.02, 'steepest slope');
  // UTM grid north turns about 1.7° west of true north here (2.4° west of the central meridian, 45.7° N)
  const conv = Math.atan2(-g.gx[k], g.gy[k]) * 180 / Math.PI;
  assert(conv > 1.4 && conv < 2.0, `direction of the slope ${conv.toFixed(2)}°`);
  return `${mag.toFixed(3)} %, turned ${conv.toFixed(2)}°`;
});

await test('slope limit of the structure cuts the buildable area: fixed 3V all, tracker 1V and fixed 2V nothing, no rule no cut', async () => {
  const r = await sampleDtm(file, site.frame, site.def);
  const meta = { id: 'plane', lon0: site.frame.lon0, lat0: site.frame.lat0, ...site.def, source: 'dtm', name: 'plane', loadedAt: '2026-09-25T00:00:00Z', zmin: 0, zmax: 1, missing: 0 };
  await useGrid(meta, r.z, { persist: false });
  const gross = computeArea(siteFrame()).grossArea;
  store.project.field = { ...store.project.field, technology: 'ground-fixed', structure: '3V9' };
  let a = computeArea(siteFrame());
  assert(currentSlopeRule().id === 'fixed-3v' && a.buildableArea < 1, `fixed 3V: ${a.buildableArea} m² left`);
  near(a.extras[0].area, gross, gross * 1e-6, 'the slope cut takes the whole site');
  store.project.field = { ...store.project.field, technology: 'agri-tracker', structure: '1V28' };
  a = computeArea(siteFrame());
  near(a.buildableArea, gross, 1e-6 * gross, 'tracker 1V: 12 % < 15 %');
  store.project.field = { ...store.project.field, technology: 'ground-fixed', structure: '2V13' };
  a = computeArea(siteFrame());
  near(a.buildableArea, gross, 1e-6 * gross, 'fixed 2V: 12 % < 15 %');
  store.project.field = { ...store.project.field, technology: 'ground-fixed', structure: '4H6' };
  a = computeArea(siteFrame());
  near(a.buildableArea, gross, 1e-6 * gross, 'no rule, nothing cut');
  assert(a.notes.some(n => /no slope limit for 4H6/.test(n)), 'the missing rule is said');
  store.project.field = { ...store.project.field, technology: 'ground-fixed', structure: '3V9' };
  store.project.terrain.applySlopeLimit = false;
  near(computeArea(siteFrame()).buildableArea, gross, 1e-6 * gross, 'cut switched off');
  store.project.terrain.applySlopeLimit = true;
  return `site ${(gross / 1e4).toFixed(2)} ha`;
});

await test('a smaller site inside the grid (another local frame): the cut follows it', () => {
  const p = store.project, keep = p.features;
  const [lon, lat] = projectPointToWgs84(32633, [317500, 5063500]);
  const f = makeLocalFrame({ lon0: lon, lat0: lat });
  const { Polygon, SpatialReference } = getSdk();
  const part = new Polygon({ rings: [[[-150, -100], [-150, 180], [60, 180], [60, -100], [-150, -100]]], spatialReference: f.sr });
  p.features = [{ ...keep[0], geometry: toGeoJSON(f.toSr(part, SpatialReference.WGS84)) }];
  const a = computeArea(siteFrame());
  const fr = siteFrame();
  assert(Math.abs(fr.lon0 - terrainData.meta.lon0) > 1e-6, 'the frame of the site moved');
  assert(a.buildableArea < 1 && Math.abs(a.extras[0].area - a.grossArea) < a.grossArea * 1e-4, `left ${a.buildableArea} m², cut ${a.extras[0].area} of ${a.grossArea}`);
  p.features = keep;
  return `${(a.grossArea / 1e4).toFixed(2)} ha cut in the moved frame`;
});

await test('a site grown beyond the grid: slopes are not cut and the user is told', () => {
  const p = store.project;
  const [lon, lat] = projectPointToWgs84(32633, [317500, 5063500]);
  const f = makeLocalFrame({ lon0: lon, lat0: lat });
  const { Polygon, SpatialReference } = getSdk();
  const far = new Polygon({ rings: [[[250, 250], [250, 400], [400, 400], [400, 250], [250, 250]]], spatialReference: f.sr });
  p.features.push({ id: 'g2', name: 'more', category: 'gross', geometry: toGeoJSON(f.toSr(far, SpatialReference.WGS84)), attrs: {}, source: 'test', sourceCategory: '' });
  const a = computeArea(siteFrame());
  assert(a.notes.some(n => /grown beyond the terrain grid/.test(n)) && !a.extras.length, 'note, no cut');
  p.features.pop();
});

await test('Esri World Elevation sampler (service simulated): chunks and no-data', async () => {
  const { SpatialReference, projectOperator } = getSdk();
  let calls = 0;
  const query = async mp => { calls++; const u = projectOperator.execute(mp, new SpatialReference({ wkid: 32633 })).points; return u.map((p, i) => i === 3 && calls === 1 ? -99999 : zAt(p[0], p[1])); };
  const def = { ...site.def };
  const z = await sampleEsri(site.frame, def, query);
  assert(calls === Math.ceil(def.nx * def.ny / 5000), `${calls} requests`);
  assert(Number.isNaN(z[3]), 'no-data kept as NaN');
  const { Point } = getSdk();
  const u = projectOperator.execute(new Point({ x: def.x0 + 4.5 * def.cell, y: def.y0 + 0.5 * def.cell, spatialReference: site.frame.sr }), new SpatialReference({ wkid: 32633 }));
  near(z[4], zAt(u.x, u.y), 0.01, 'cell 4');
  return `${def.nx * def.ny} points in ${calls} requests`;
});

await test('project file (.pvpd) carries the terrain grid', async () => {
  const before = terrainData.z;
  const blob = await projectBlob();
  setTerrainData(null, null);
  assert(await openProjectFile(new File([blob], 'x.pvpd')), 'opened');
  assert(terrainData.meta && terrainData.meta.id === 'plane' && terrainData.z.length === before.length, 'grid back');
  let same = true; for (let k = 0; k < before.length; k++) if (before[k] !== terrainData.z[k]) { same = false; break; }
  assert(same, 'same elevations');
  assert(overLimit().cells === before.length, 'still all over the fixed limit');
  await removeTerrain();
  assert(!terrainData.z && !store.project.terrain.grid, 'removed');
  return `${(blob.size / 1024).toFixed(0)} KB`;
});

await test('no-data of the model: cells outside it are unknown, never cut', async () => {
  useSite(317940, 5063940, 60);   // over the no-data square of the north-east corner and the edge of the model
  const g = gridForSite(10);
  const r = await sampleDtm(file, g.frame, g.def);
  let missing = 0; for (const v of r.z) if (!Number.isFinite(v)) missing++;
  assert(missing > 0, 'some cells have no data');
  const m = limitMask(gradients({ ...g.def, z: r.z }), { maxNS: 10, maxEW: 10 });
  assert(m.unknown === missing && m.over === g.def.nx * g.def.ny - missing, `over ${m.over}, unknown ${m.unknown}`);
  store.project = defaultProject();
  return `${missing} of ${g.def.nx * g.def.ny} cells without data`;
});

// ── the limit chosen by hand (as on the Geoportale) and the comparison with the toolkit ──
await test('slope limit chosen by hand, in every direction or north-south / east-west, compared with the toolkit rule', async () => {
  useSite(317500, 5063500);
  const g = gridForSite(10);
  const r = await sampleDtm(file, g.frame, g.def);
  await useGrid({ id: 'plane2', lon0: g.frame.lon0, lat0: g.frame.lat0, ...g.def, source: 'dtm', name: 'plane', loadedAt: '2026-10-04T00:00:00Z', zmin: 0, zmax: 1, missing: 0 }, r.z, { persist: false });
  const gross = computeArea(siteFrame()).grossArea;
  let L = effectiveLimit();
  assert(!L.custom && L.same && L.from === 'toolkit' && L.rule.id === 'fixed-3v' && L.limit.maxNS === 10, 'toolkit rule of the 3V9 by default: ' + JSON.stringify(L));
  assert(computeArea(siteFrame()).buildableArea < 1, 'the 12 % plane is cut by the toolkit rule');
  // 13 % north-south / 13 % east-west by hand: nothing cut, said to differ from the toolkit
  setLimit({ maxNS: 13, maxEW: 13 });
  L = effectiveLimit();
  assert(L.custom && !L.same && L.from === 'custom' && L.text === '13 % north–south and 13 % east–west', JSON.stringify(L));
  let a = computeArea(siteFrame());
  near(a.buildableArea, gross, 1e-6 * gross, 'nothing over 13 %');
  // 10 % in every direction: all cut, the cut says it is an own limit and which rule the toolkit has
  setLimit({ maxAny: 10 });
  a = computeArea(siteFrame());
  assert(a.buildableArea < 1 && a.extras[0].own && a.extras[0].label === '10 % in every direction' && /Fixed 3V/.test(a.extras[0].rule), JSON.stringify(a.extras[0]));
  // the same values as the toolkit, typed by hand: same, the toolkit's words
  setLimit({ maxNS: 10, maxEW: 10 });
  L = effectiveLimit();
  a = computeArea(siteFrame());
  assert(L.custom && L.same && !a.extras[0].own && /Fixed 3V/.test(a.extras[0].label), 'same as the toolkit');
  // a structure without a toolkit rule: nothing cut unless a limit is chosen by hand
  store.project.field = { ...store.project.field, structure: '4H6' };
  setLimit(null);
  a = computeArea(siteFrame());
  assert(!effectiveLimit().limit && a.notes.some(n => /no slope limit for 4H6/.test(n)) && !a.extras.length, 'no rule, no cut, said');
  setLimit({ maxAny: 15 });
  a = computeArea(siteFrame());
  L = effectiveLimit();
  near(a.buildableArea, gross, 1e-6 * gross, '12 % < 15 % by hand');
  assert(L.custom && !L.rule && !L.same, 'own limit without a rule');
  setLimit({ maxAny: 11 });
  a = computeArea(siteFrame());
  assert(a.buildableArea < 1 && a.extras[0].own && a.extras[0].rule === null, 'cut by the own limit, no rule to compare');
  // the limit travels in the project; old projects get the toolkit rule
  const blob = await projectBlob();
  const JSZip = (await import('../app/js/libs.js')).loadJsZip;
  const pj = JSON.parse(await (await (await JSZip()).loadAsync(blob)).file('project.json').async('text'));
  assert(pj.terrain.limit.maxAny === 11 && pj.terrain.limitFrom === 'custom', 'limit in the .pvpd');
  const old = upgrade({ format: 'pv-predesign-project', version: 2, features: [], terrain: { grid: null, cellSize: 5 } });
  assert(old.terrain.limit === null && old.terrain.limitFrom === null, 'old project: toolkit rule');
  store.project.field = { ...store.project.field, structure: '3V9' };
  setLimit(null);
  await removeTerrain();
  return `${limitText({ maxAny: 10 })} · ${limitText({ maxNS: 10, maxEW: 12 })}`;
});

// ── Geoportale projects with slopes from their DTM («Pendenze da DTM», 2026-10-04) ──
const expected = await (await fetch('./fixtures/expected.json')).json();
const axpo = async name => new File([await (await fetch('./fixtures/' + name)).blob()], name);
const E = expected.it_slope;

await test('Geoportale project with slopes from its DTM: the exclusion says how it was made, the grid is read, the pictures are ignored', async () => {
  const r = await readAnyFile(await axpo('it_slope.axpo'));
  const ex = r.features.find(f => f.properties.category === 'exclusion');
  assert(ex && ex.properties.type === 'steep-slope' && ex.properties.slope, 'steep-slope exclusion with its slope record');
  assert(ex.properties.slope.limit.maxAny === E.limit.maxAny && ex.properties.slope.grid === E.grid && ex.properties.slope.cell === E.cell && ex.properties.slope.minPatch === E.min_patch, JSON.stringify(ex.properties.slope));
  assert(r.terrain.length === 1, 'one grid');
  const g = r.terrain[0];
  assert(g.meta.id === E.grid && g.meta.nx === E.nx && g.meta.ny === E.ny && g.meta.cell === E.cell && g.z.length === E.nx * E.ny, JSON.stringify({ ...g.meta, z: g.z.length }));
  assert(g.limit.maxAny === E.limit.maxAny && g.minPatch === E.min_patch && g.areaGeom && g.meta.buffer === 25, 'limit, patch, area and buffer of the record');
  const gr = gradients({ ...g.meta, z: g.z });
  const k = Math.floor(gr.gx.length / 2);
  near(gr.gx[k], E.slopeEast, 1e-4, 'east slope'); near(gr.gy[k], E.slopeNorth, 1e-4, 'north slope');
  near(Math.hypot(gr.gx[k], gr.gy[k]) * 100, E.steepest, 0.01, 'steepest');
  return `${g.meta.nx} × ${g.meta.ny} cells of ${g.meta.cell} m, ${(Math.hypot(gr.gx[k], gr.gy[k]) * 100).toFixed(3)} % steepest`;
});

await test('importing it: the grid becomes the terrain, the limit the one chosen on the Geoportale (compared with the toolkit), the exclusion gives way to the live cut', async () => {
  store.project = defaultProject();
  const n = await importFiles([await axpo('it_slope.axpo')]);
  assert(n === 2, `${n} objects imported`);
  const P = store.project;
  assert(P.features.length === 1 && P.features[0].category === 'gross', 'the imported slope exclusion was replaced: ' + P.features.map(f => f.category));
  assert(terrainData.meta && terrainData.meta.id === E.grid && P.terrain.grid && P.terrain.grid.id === E.grid, 'grid adopted without a download');
  assert(P.terrain.limit.maxAny === 10 && P.terrain.limitFrom === 'geoportale' && P.terrain.applySlopeLimit, 'limit of the Geoportale in use: ' + JSON.stringify(P.terrain));
  assert(P.terrain.cellSize === E.cell && P.terrain.minPatch === E.min_patch && !terrainStale(), 'cell and patch aligned, not stale');
  const L = effectiveLimit();
  assert(L.custom && !L.same && L.from === 'geoportale' && L.rule.id === 'fixed-3v', 'different from the toolkit rule of the 3V9: ' + JSON.stringify(L));
  let a = computeArea(siteFrame());
  const gross = a.grossArea;
  near(gross, E.gross_m2, E.gross_m2 * 1e-4, 'gross area of the fixture');
  assert(a.buildableArea < 1 && a.extras.length === 1 && a.extras[0].kind === 'slope' && a.extras[0].own, `10 % in every direction cuts everything: ${a.buildableArea} m² left`);
  near(a.extras[0].area, gross, gross * 1e-4, 'cut once, by the live cut');
  // back to the toolkit rule: 9 % east and 5 % north are under 10 % N-S and 10 % E-W
  setLimit(null);
  a = computeArea(siteFrame());
  near(a.buildableArea, gross, 1e-6 * gross, 'toolkit rule: nothing cut');
  assert(effectiveLimit().same && !effectiveLimit().custom, 'toolkit rule in use');
  setLimit({ maxNS: 10, maxEW: 8 });
  assert(computeArea(siteFrame()).buildableArea < 1, '8 % east-west by hand cuts everything');
  await removeTerrain();
  store.project = defaultProject();
  return `${(gross / 1e4).toFixed(2)} ha, ${E.nx * E.ny} cells adopted, limit ${limitText({ maxAny: 10 })}`;
});

await test('a Geoportale grid that does not cover the site is not used; a project without a grid keeps its exclusion', async () => {
  // a project whose site reaches far beyond the grid of the Geoportale project
  useSite(317500, 5063500, 1500);
  await importFiles([await axpo('it_slope.axpo')]);
  let P = store.project;
  assert(!P.terrain.grid && !terrainData.meta, 'grid not adopted');
  let ex = P.features.filter(f => f.category === 'exclusion');
  assert(ex.length === 1 && ex[0].slope && ex[0].slope.limit.maxAny === 10, 'exclusion kept with its slope record');
  assert(P.terrain.limit === null, 'limit untouched');
  // an older export: the exclusion alone cuts the site, the terrain step has nothing yet
  store.project = defaultProject();
  await importFiles([await axpo('it_slope_noterrain.axpo')]);
  P = store.project;
  ex = P.features.filter(f => f.category === 'exclusion');
  assert(ex.length === 1 && ex[0].attrs.type === 'steep-slope' && ex[0].slope && !P.terrain.grid, 'exclusion with its record, no grid');
  const a = computeArea(siteFrame());
  assert(a.buildableArea < 1 && !a.extras.length, 'cut once, by the exclusion');
  store.project = defaultProject();
});

const ok = results.filter(r => r.ok).length;
document.getElementById('sum').innerHTML = `<b class="${ok === results.length ? 'ok' : 'err'}">${ok} / ${results.length} passed</b>`;
document.getElementById('out').innerHTML = results.map(r => `<tr><td class="s ${r.ok ? 'ok' : 'err'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}<br><code>${String(r.note).replace(/</g, '&lt;')}</code></td></tr>`).join('');
window.__results = results;
