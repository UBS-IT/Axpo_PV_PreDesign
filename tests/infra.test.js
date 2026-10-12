// Step 3 · Infrastructure: fence along the usable land and its clearance band, perimeter road, custom clearance,
// exclusions on the edge and inside, stations and their clearance, stations placed at the access, a country without
// toolkit values. Site: a 400 × 400 m square in Italy (invented place).
import { loadSdk, getSdk } from '../app/js/sdk.js';
import { loadCatalog } from '../app/js/catalog.js';
import { store, defaultProject } from '../app/js/state.js';
import { computeArea, siteFrame, crsState } from '../app/js/areas.js';
import { layoutInfra, addStation, moveStation, placeAtAccess, suggestedRoad, clearances, nearestOnRings, rectangle, ringArea, lotsOf, joinLots, separateLots, addRoad, updateRoad, removeRoad, innerPoint, fenceSpec, gateSpec, countryGates } from '../app/js/infra.js';
import { heights3d } from '../app/js/view3d/geometry.js';
import { makeLocalFrame } from '../app/js/geo/localframe.js';
import { toGeoJSON, projectPointToWgs84 } from '../app/js/geo/convert.js';

const results = [];
async function test(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); }
  catch (e) { console.error(name, e); results.push({ name, ok: false, note: e && e.message || String(e) }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, w) => assert(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b} (tolerance ${tol})`);

await loadSdk();
await loadCatalog();
const [lon, lat] = projectPointToWgs84(32633, [317500, 5063500]);
const F = makeLocalFrame({ lon0: lon, lat0: lat });
const { Polygon, Point, SpatialReference } = getSdk();
const geo = rings => toGeoJSON(F.toSr(new Polygon({ rings, spatialReference: F.sr }), SpatialReference.WGS84));
const sq = (x0, y0, x1, y1) => [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]];
const wgs = (x, y) => { const p = F.toSr(new Point({ x, y, spatialReference: F.sr }), SpatialReference.WGS84); return [p.x, p.y]; };
function site(extra = [], infra = {}) {
  const p = defaultProject();
  p.features = [{ id: 'g', name: 'gross', category: 'gross', geometry: geo(sq(-200, -200, 200, 200)), attrs: {}, source: 'test', sourceCategory: '' }, ...extra];
  Object.assign(p.infra, infra);
  store.project = p;
  crsState.iso = 'IT';
  return computeArea(siteFrame());
}
const exclusion = (id, rings) => ({ id, name: id, category: 'exclusion', geometry: geo(rings), attrs: {}, source: 'test', sourceCategory: '' });

await test('plain geometry: nearest point on a ring, rectangles, orientation', () => {
  const r = sq(0, 0, 10, 10)[0];
  const n = nearestOnRings([r], [3, -2]);
  assert(n.point[0] === 3 && n.point[1] === 0 && n.dist === 2, JSON.stringify(n));
  const rc = rectangle([0, 0], 8, 3, 90, 1);
  near(Math.abs(ringArea(rc)), 10 * 5, 1e-9, 'rectangle with margin');
  near(rc[1][0], 2.5, 1e-9, 'turned by 90°');
  assert(suggestedRoad(8.9) === true && suggestedRoad(9.1) === false && suggestedRoad(null) === null, 'road suggestion up to 9 MWp');
});

await test('fence without perimeter road: 4 m band cut in Italy', () => {
  const a = site();
  near(a.buildableArea, 392 * 392, 1, 'buildable');
  const L = layoutInfra(siteFrame(), a.pre, a.base);
  near(L.fences[0].length, 1600, 0.5, 'fence length');
  assert(!L.road && clearances().clearance === 4, 'no road');
  return `${(a.buildableArea / 1e4).toFixed(2)} ha of ${(a.grossArea / 1e4).toFixed(2)}`;
});

await test('perimeter road: 1 + 4 + 1 m, road drawn and measured', () => {
  const a = site([], { perimeterRoad: true });
  near(a.buildableArea, 388 * 388, 1, 'buildable');
  const L = layoutInfra(siteFrame(), a.pre, a.base);
  const { areaOperator } = getSdk();
  near(areaOperator.execute(L.road), 398 * 398 - 390 * 390, 1, 'road area: from 1 to 5 m inside the fence');
  near(L.roadLength, 4 * 394, 0.5, 'road centre line');
  return `road ${L.roadLength.toFixed(0)} m`;
});

await test('the designer can override the clearance, and switch the fence off', () => {
  near(site([], { clearance: 10 }).buildableArea, 380 * 380, 1, 'custom 10 m');
  near(site([], { fence: false }).buildableArea, 400 * 400, 1, 'no fence');
});

await test('mitigation strip inside the fence (phase 10B): cut on its own, the clearance and the perimeter road move inwards', () => {
  // 5 m of strip, then 4 m to the structures (IT: greenStripToStructures)
  const a = site([], { mitigation: 5 });
  near(a.buildableArea, 382 * 382, 1, 'strip 5 m + 4 m');
  const L = layoutInfra(siteFrame(), a.pre, a.base);
  near(L.stripArea, 400 * 400 - 390 * 390, 1, 'strip area');
  const c = clearances();
  assert(L.stripWidth === 5 && c.strip === 5 && c.clearance === 4, 'strip and clearance: ' + JSON.stringify(c));
  near(a.extras.filter(x => x.kind === 'strip').reduce((s, x) => s + x.area, 0), 400 * 400 - 390 * 390, 1, 'the strip is its own cut');
  near(a.extras.filter(x => x.kind === 'fence').reduce((s, x) => s + x.area, 0), 390 * 390 - 382 * 382, 1, 'the band after it');
  // with the perimeter road: strip 5, then 1 + 4 + 1 m
  const b = site([], { mitigation: 5, perimeterRoad: true });
  near(b.buildableArea, 378 * 378, 1, 'strip + road');
  const Lb = layoutInfra(siteFrame(), b.pre, b.base);
  near(getSdk().areaOperator.execute(Lb.road), 388 * 388 - 380 * 380, 1, 'road from 6 to 10 m inside the fence');
  near(Lb.roadLength, 4 * 384, 0.5, 'road centre line');
  // no fence, no strip; an empty width, no strip
  near(site([], { mitigation: 5, fence: false }).buildableArea, 400 * 400, 1, 'no fence, no strip');
  assert(!layoutInfra(siteFrame(), site().pre, site().base).strip, 'no width, no strip');
  return `${(L.stripArea / 1e4).toFixed(2)} ha of strip, buildable ${(a.buildableArea / 1e4).toFixed(2)} ha`;
});

await test('the fence as built (phase 10B): mesh, height and gate from the toolkit or typed in, on every gate and in 3D, nothing borrowed', () => {
  const [x, y] = wgs(30, -230);
  const access = { id: 'acc', name: 'Main access', category: 'access', geometry: { type: 'Point', coordinates: [x, y] }, attrs: { type: 'site-access' }, source: 'test', sourceCategory: '' };
  let a = site([access]);
  let f = fenceSpec(), g = gateSpec();
  assert(f.height === 2 && /welded mesh/.test(f.mesh) && g.id === 'GATE-IT-6' && g.width === 6 && g.height === 2 && !g.custom, 'the toolkit: ' + JSON.stringify([f, g]));
  a = site([access], { fenceHeight: 2.5, fenceMesh: 'Invented mesh 1', gate: 'custom', gateWidth: 8 });
  f = fenceSpec(); g = gateSpec();
  assert(f.height === 2.5 && f.mesh === 'Invented mesh 1' && f.heightToolkit === 2 && g.custom && g.width === 8 && g.height === 2.5, 'typed in: ' + JSON.stringify([f, g]));
  const L = layoutInfra(siteFrame(), a.pre, a.base);
  assert(L.gates.length === 1 && L.gates[0].width === 8 && L.gates[0].height === 2.5, 'the gate on the fence: ' + JSON.stringify(L.gates[0]));
  assert(heights3d(store.project, 'IT').fence === 2.5, 'the height of the 3D fence');
  // a country without toolkit values
  site();
  crsState.iso = 'PL';
  f = fenceSpec(); g = gateSpec();
  assert(f.height == null && f.mesh == null && g.width == null && countryGates().length === 0, 'nothing borrowed: ' + JSON.stringify([f, g]));
  crsState.iso = 'IT';
  return `gate ${L.gates[0].width} m × ${L.gates[0].height} m`;
});

await test('the fence follows exclusions on the edge and ignores holes inside', () => {
  const edge = site([exclusion('west strip', sq(-200, -200, -150, 200))]);
  near(edge.buildableArea, (350 - 8) * 392, 2, 'edge exclusion moves the fence');
  near(layoutInfra(siteFrame(), edge.pre, edge.base).fences[0].length, 1500, 0.5, 'fence length');
  const hole = site([exclusion('pond', sq(-20, -20, 20, 20))]);
  near(hole.buildableArea, 392 * 392 - 40 * 40, 2, 'hole cut once, no fence around it');
  near(layoutInfra(siteFrame(), hole.pre, hole.base).fences[0].length, 1600, 0.5, 'fence length');
});

await test('stations: footprint of the Italian toolkit and 3 m kept free around', () => {
  const base = site().buildableArea;
  const [x, y] = wgs(0, 0);
  const s = addStation('CT', x, y, 0);
  assert(s, 'placed');
  const a = computeArea(siteFrame());
  near(base - a.buildableArea, (8.7 + 6) * (3 + 6), 0.5, 'area taken');
  const L = layoutInfra(siteFrame(), a.pre, a.base);
  assert(L.stations[0].building.id === 'CT-IT' && L.stations[0].inside, 'CT inside');
  return `${(base - a.buildableArea).toFixed(1)} m²`;
});

await test('delivery and user stations at the site access: on the fence, inside, within 20 m', () => {
  const [x, y] = wgs(30, -230);   // an access just south of the site
  site([{ id: 'acc', name: 'Main access', category: 'access', geometry: { type: 'Point', coordinates: [x, y] }, attrs: { type: 'site-access' }, source: 'test', sourceCategory: '' }]);
  assert(placeAtAccess(), 'placed');
  const a = computeArea(siteFrame());
  const L = layoutInfra(siteFrame(), a.pre, a.base);
  const cc = L.stations.find(s => s.kind === 'CC'), cu = L.stations.find(s => s.kind === 'CU');
  assert(cc && cu && cc.inside && cu.inside, 'both inside');
  near(cc.center[1], -200 + 1.5, 0.05, 'delivery station flush with the fence');
  const d = Math.hypot(cc.center[0] - cu.center[0], cc.center[1] - cu.center[1]);
  assert(d <= 20 && !L.notes.length, `distance ${d}`);
  assert(L.gates.length === 1 && Math.abs(L.gates[0].point[1] + 200) < 0.01 && L.gates[0].width === 6, 'gate on the fence, 6 m');
  return `CC–CU ${d.toFixed(1)} m, gate at x ${L.gates[0].point[0].toFixed(1)}`;
});

// a road (linear infrastructure with a 10 m buffer) across the site from west to east, and a ditch from north to
// the road: three lots — 1 north-west, 2 north-east, 3 south
const splitters = () => [
  { id: 'road', name: 'Strada vicinale', category: 'linear', geometry: toGeoJSON(F.toSr(new (getSdk().Polyline)({ paths: [[[-260, 0], [260, 0]]], spatialReference: F.sr }), SpatialReference.WGS84)), attrs: { type: 'road', buffer: 10 }, source: 'test', sourceCategory: '' },
  { id: 'ditch', name: 'Fosso', category: 'linear', geometry: toGeoJSON(F.toSr(new (getSdk().Polyline)({ paths: [[[0, 0], [0, 260]]], spatialReference: F.sr }), SpatialReference.WGS84)), attrs: { type: 'ditch', buffer: 5 }, source: 'test', sourceCategory: '' },
];
await test('lots: the usable land split by a road and a ditch gives 3 lots, numbered north to south, one fence each', () => {
  const a = site(splitters());
  const L = layoutInfra(siteFrame(), a.pre, a.base);
  assert(L.lots.length === 3 && L.fences.length === 3, `${L.lots.length} lots, ${L.fences.length} fences`);
  assert(L.lots[0].label[0] < 0 && L.lots[0].label[1] > 0 && L.lots[1].label[0] > 0 && L.lots[2].label[1] < 0, 'numbering');
  near(L.lots[2].area, 400 * 190, 1, 'south lot');
  const p = innerPoint([[0, 0], [10, 0], [10, 10], [5, 1], [0, 10], [0, 0]]);
  assert(p[1] < 5 && p[0] > 0 && p[0] < 10, 'a point inside a concave ring');
  return L.lots.map(l => `${l.n}: ${(l.area / 1e4).toFixed(2)} ha`).join(' · ');
});

await test('lots 1 and 2 share one fence across the ditch; separating them gives their own fences back', () => {
  const a = site(splitters());
  const alone = a.buildableArea;
  assert(joinLots([1, 2]), 'joined');
  const b = computeArea(siteFrame());
  const L = layoutInfra(siteFrame(), b.pre, b.base);
  assert(L.fences.length === 2 && L.fences[0].lots.join() === '1,2' && L.fences[0].parts === 1, JSON.stringify(L.fences.map(f => f.lots)));
  assert(L.lots[0].fence === 'A' && L.lots[1].fence === 'A' && L.lots[2].fence === 'B', 'letters');
  // no band along the ditch any more
  near(b.buildableArea - alone, 2 * 4 * (190 - 8), 30, 'area gained: the two 4 m strips beside the ditch (their ends are in the other bands)');
  const len = L.fences[0].length;
  near(len, 2 * 400 + 2 * 190, 5, 'one fence around both lots, across the ditch');
  assert(separateLots([1, 2]), 'separated');
  const c = computeArea(siteFrame());
  near(c.buildableArea, alone, 1, 'back to three fences');
  store.project.infra.fenceGroups = [];
  return `fence A ${len.toFixed(0)} m, +${(b.buildableArea - alone).toFixed(0)} m²`;
});

await test('stations snap flush with the fence and along it; far from it they follow the rows; moving snaps too', () => {
  site();
  const [x, y] = wgs(50, -195);           // 5 m inside the south fence
  const s = addStation('CT', x, y);
  const L = () => { const a = computeArea(siteFrame()); return layoutInfra(siteFrame(), a.pre, a.base).stations; };
  let st = L()[0];
  near(st.center[1], -200 + 1.5, 0.05, 'flush with the south fence');
  near(Math.abs(Math.sin(st.rot * Math.PI / 180)), 0, 1e-6, 'along the fence');
  const [x2, y2] = wgs(0, 0);
  addStation('CT', x2, y2);
  st = L()[1];
  near(st.center[0], 0, 0.05, 'far from the fence: where clicked');
  const [x3, y3] = wgs(193, 30);          // near the east fence
  moveStation(s.id, x3, y3);
  st = L().find(q => q.id === s.id);
  near(st.center[0], 200 - 1.5, 0.05, 'moved flush with the east fence');
  near(Math.abs(Math.cos(st.rot * Math.PI / 180)), 0, 1e-6, 'turned along it');
  return `rotation ${st.rot.toFixed(0)}°`;
});

await test('roads drawn by the designer: cut with their width, reshaped, removed', () => {
  const before = site().buildableArea;
  const r = addRoad([wgs(0, -250), wgs(0, 250)], 'heavy');
  assert(r && r.width === 4, 'heavy road 4 m (Italy)');
  const a = computeArea(siteFrame());
  near(before - a.buildableArea, 4 * 392, 2, 'strip taken across the buildable area');
  updateRoad(r.id, [wgs(-250, 50), wgs(250, 50)]);
  near(before - computeArea(siteFrame()).buildableArea, 4 * 392, 2, 'moved, same length inside');
  assert(addRoad([wgs(0, 0), wgs(10, 0)], 'light').width === 3, 'light road 3 m');
  removeRoad(r.id);
  assert(store.project.infra.roads.length === 1, 'removed');
  const L = layoutInfra(siteFrame(), computeArea(siteFrame()).pre);
  near(L.roads[0].length, 10, 0.01, 'length of the light road');
  return `${(before - a.buildableArea).toFixed(0)} m² for 392 m of 4 m road`;
});

await test('a country without toolkit values: said, not borrowed', () => {
  const a = site();
  crsState.iso = 'PL';
  const b = computeArea(siteFrame());
  near(b.buildableArea, 400 * 400, 1, 'no clearance');
  assert(b.notes.some(n => /no fence clearance for Poland/.test(n)), 'note');
  assert(addStation('CT', lon, lat) === null, 'no station size for Poland');
  crsState.iso = 'IT';
  store.project = defaultProject();
  return `${(a.buildableArea / 1e4).toFixed(2)} ha in Italy, ${(b.buildableArea / 1e4).toFixed(2)} ha in Poland`;
});

const ok = results.filter(r => r.ok).length;
document.getElementById('sum').innerHTML = `<b class="${ok === results.length ? 'ok' : 'err'}">${ok} / ${results.length} passed</b>`;
document.getElementById('out').innerHTML = results.map(r => `<tr><td class="s ${r.ok ? 'ok' : 'err'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}<br><code>${String(r.note).replace(/</g, '&lt;')}</code></td></tr>`).join('');
window.__results = results;
