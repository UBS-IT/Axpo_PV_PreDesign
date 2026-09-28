// 4b · 3D: sun position and tracker angles against pvlib (NREL SPA), row-to-row shading, heights from the toolkit of
// the country, module surfaces of fixed tables and trackers on the ground, ground elevations from the terrain grid,
// terrain tiles of the scene, glTF files. Run in the browser: /tests/view3d.html.
import { loadSdk, getSdk } from '../app/js/sdk.js';
import { loadCatalog } from '../app/js/catalog.js';
import { store, defaultProject } from '../app/js/state.js';
import { crsState } from '../app/js/areas.js';
import { makeLocalFrame } from '../app/js/geo/localframe.js';
import { setTerrainData } from '../app/js/terrain/store.js';
import { sunPosition, trackerAngle, rowShading, solarTimeDate, axisFrame } from '../app/js/view3d/sun.js';
import { heights3d, tableMesh, boxMesh, wallMesh, groundAt, fillGaps, axisAzimuth, terrainMesh } from '../app/js/view3d/geometry.js';
import { prismMesh } from '../app/js/view3d/model.js';
import { writeGlb, readGlb, mergeMeshes } from '../app/js/view3d/glb.js';
import { fillTileFromGrid } from '../app/js/view3d/scene.js';

const results = [];
async function test(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); }
  catch (e) { console.error(name, e); results.push({ name, ok: false, note: e && e.message || String(e) }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, w) => assert(JSON.stringify(a) === JSON.stringify(b), `${w}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const near = (a, b, tol, w) => assert(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b} (tolerance ${tol})`);
const D = Math.PI / 180;

await loadSdk();
await loadCatalog();

// ── sun ──
// reference values: pvlib 0.13 (NREL SPA, true elevation) and pvlib.tracking.singleaxis (axis south, ±55°, no backtracking)
const REF = [
  ['2026-06-21T12:00:00Z', 45.0, 9.0, 67.341, 200.726, 8.402],
  ['2026-12-21T08:30:00Z', 41.9, 12.5, 15.147, 142.801, -55],
  ['2026-03-20T15:45:00Z', 52.2, 21.0, 8.897, 258.382, 55],
  ['2026-09-28T06:00:00Z', 37.5, -4.8, -3.214, 90.11, 0],
];
await test('sun position and tracker angle agree with pvlib (NREL SPA) within 0.01°', () => {
  for (const [time, lat, lon, el, az, th] of REF) {
    const s = sunPosition(new Date(time), lat, lon);
    near(s.elevation, el, 0.01, `elevation ${time}`); near(s.azimuth, az, 0.01, `azimuth ${time}`);
    near(trackerAngle(s.vector, 180, 55), th, 0.01, `tracker ${time}`);
    near(Math.hypot(...s.vector), 1, 1e-12, 'unit vector');
  }
  const noon = sunPosition(solarTimeDate(2026, 12, 21, 12, 12.5), 41.9, 12.5);
  near(noon.azimuth, 180, 1, 'solar noon: sun due south (equation of time +2 min)');
  near(noon.elevation, 90 - 41.9 - 23.44, 0.05, 'winter solstice noon: 90° − latitude − 23.44°');
  eq(axisFrame(180).right.map(Math.round), [-1, 0], 'right of an axis pointing south: west');
});

await test('row-to-row shading: none down to the shading angle of the pitch, then the geometric share; trackers', () => {
  // a fixed row 4 m wide at 15°, pitch set for a 29° shading angle
  const L = 4, b = 15, P = L * Math.cos(b * D) + L * Math.sin(b * D) / Math.tan(29 * D), south = [0, -1];
  const sun = el => [0, -Math.cos(el * D), Math.sin(el * D)];
  near(rowShading(sun(29), south, L, P, b), 0, 1e-9, 'at 29°');
  eq(rowShading(sun(40), south, L, P, b), 0, 'higher sun');
  // at 20°: the shadow of the front edge of the row behind falls (P·tan20 − H) / (sin15 + cos15·tan20) up the module
  const H = L * Math.sin(b * D), share = (L * Math.sin(b * D) - (P - L * Math.cos(b * D)) * Math.tan(20 * D)) / (L * (Math.sin(b * D) + Math.cos(b * D) * Math.tan(20 * D))) ;
  near(rowShading(sun(20), south, L, P, b), share, 1e-9, 'at 20°: ' + H.toFixed(3));
  eq(rowShading(sun(-2), south, L, P, b), null, 'night');
  // tracker facing the sun at 70° from the vertical: shaded share 1 − pitch·cos(70°)/width
  near(rowShading([Math.sin(70 * D), 0, Math.cos(70 * D)], [1, 0], 2.382, 5.5, 70), 1 - 5.5 * Math.cos(70 * D) / 2.382, 1e-12, 'tracker');
  eq(rowShading([Math.sin(30 * D), 0, Math.cos(30 * D)], [1, 0], 2.382, 5.5, 30), 0, 'tracker at 30°: no shading');
});

// ── heights ──
await test('heights from the toolkit of the country, typed values win, missing values are said', () => {
  const P = defaultProject();
  crsState.iso = 'IT';
  let h = heights3d(P);
  eq([h.tracker, h.lowEdge.value, h.lowEdge.source, h.fence, h.missing], [false, 1, 'IT-PC, USER', 2, null], 'IT fixed');
  P.field.technology = 'agri-tracker';
  h = heights3d(P);
  eq([h.axis.value, h.axis.category, h.maxRotation], [1.5, 'standard', 55], 'IT tracker, standard AgriPV');
  P.view3d.trackerCategory = 'grazing'; eq(heights3d(P).axis.value, 2.3, 'grazing');
  P.view3d.trackerCategory = 'advanced'; eq(heights3d(P).axis.value, 3.1, 'advanced');
  P.view3d.axisHeight = 2.75; eq([heights3d(P).axis.value, heights3d(P).axis.source], [2.75, 'custom'], 'typed');
  P.view3d.axisHeight = null;
  crsState.iso = 'FR';
  eq([heights3d(P).axis, heights3d(P).missing], [null, 'axis'], 'FR: no tracker heights, never borrowed from IT');
  P.field.technology = 'ground-fixed'; eq(heights3d(P).lowEdge.value, 1.1, 'FR fixed');
  P.field.technology = 'agri-fixed'; eq(heights3d(P).missing, 'lowEdge', 'AgriPV fixed: typed in');
  crsState.iso = null;
});

// ── meshes ──
const table = (x0, y0, len, depth) => ({ corners: [[x0, y0], [x0 + len, y0], [x0 + len, y0 + depth], [x0, y0 + depth]] });
await test('fixed tables: low edge towards the facing side, high edge raised by depth × tan(tilt), corners on their ground', () => {
  const t0 = table(0, 0, 10.37, 6.93);
  const m = tableMesh([t0], [100, 100, 100, 100], { tracker: false, tiltDeg: 15, lowEdge: 1 });
  const z = [2, 5, 8, 11].map(i => m.positions[i]);
  eq(z.slice(0, 2), [101, 101], 'low edge'); near(z[2], 101 + 6.93 * Math.tan(15 * D), 1e-9, 'high edge');
  eq([...m.faces], [0, 1, 2, 0, 2, 3], 'two triangles');
  const s = tableMesh([t0], [100, 100.5, 101.2, 100.7], { tracker: false, tiltDeg: 15, lowEdge: 1 });
  near(s.positions[5] - s.positions[2], 0.5, 1e-9, 'the piles follow the ground');
});

await test('trackers: axis at its height over the ground of each end, modules turned towards the west for positive angles', () => {
  // a tracker along north-south (axis pointing south), 33.48 m long, modules 2.382 m across
  const tr = { corners: [[0, 0], [0, -33.48], [2.382, -33.48], [2.382, 0]] };
  eq(axisAzimuth([tr]), 180, 'axis azimuth');
  const m = tableMesh([tr], [50, 50, 50, 50], { tracker: true, axisHeight: 1.5, angleDeg: 30 });
  const v = [0, 1, 2, 3].map(i => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]]);
  const w = 2.382 / 2;
  // vertices 0,1 on the left (east) of the axis, 2,3 on the right (west)
  near(v[0][0], w + w * Math.cos(30 * D), 1e-9, 'east edge x'); near(v[0][2], 51.5 + w * Math.sin(30 * D), 1e-9, 'east edge up');
  near(v[3][0], w - w * Math.cos(30 * D), 1e-9, 'west edge x'); near(v[3][2], 51.5 - w * Math.sin(30 * D), 1e-9, 'west edge down');
  const flat = tableMesh([tr], [50, 52, 52, 50], { tracker: true, axisHeight: 1.5, angleDeg: 0 });
  eq([flat.positions[2], flat.positions[5]], [51.5, 53.5], 'the axis follows the ground of each end');
});

await test('boxes, walls, prisms and merged meshes', () => {
  const b = boxMesh([[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]], 10, 3.5);
  eq([b.positions.length / 3, b.faces.length / 3, b.positions[2], b.positions[14]], [8, 12, 10, 13.5], 'box');
  const w = wallMesh([[0, 0], [10, 0], [10, 10]], [5, 6, 7], 2);
  eq([w.positions.length / 3, w.faces.length / 3, w.positions[2], w.positions[5], w.positions[8]], [6, 4, 5, 7, 6], 'wall: ground and top of each point');
  const p = prismMesh([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], 0, 9);
  eq([p.positions.length / 3, p.faces.length / 3], [8, 10], 'prism: 4 walls, a roof of 2 triangles');
  const m = mergeMeshes([b, null, w]);
  eq([m.positions.length / 3, m.faces.length, Math.max(...m.faces)], [14, 48, 13], 'merged, indices shifted');
});

// ── ground ──
await test('ground elevations: bilinear on the terrain grid, Esri (stub) outside it, gaps filled with the mean', async () => {
  const frame = makeLocalFrame({ lon0: 14.5, lat0: 45.7 });
  // a plane z = 200 + 0.1 x on a 5 m grid covering x, y in [-100, 100]
  const meta = { id: 'g', lon0: 14.5, lat0: 45.7, x0: -100, y0: -100, cell: 5, nx: 40, ny: 40 };
  const z = new Float32Array(40 * 40);
  for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) z[j * 40 + i] = 200 + 0.1 * (-100 + (i + 0.5) * 5);
  setTerrainData(meta, z);
  const asked = [];
  const got = await groundAt(frame, [[0, 0], [52.3, -10], [500, 0]], { query: async pts => { asked.push(...pts); return pts.map(() => 180); } });
  near(got[0], 200, 1e-4, 'centre'); near(got[1], 205.23, 1e-4, 'on the plane');
  eq([asked.length, got[2]], [1, 180], 'outside the grid: asked to Esri');
  const other = makeLocalFrame({ lon0: 14.5005, lat0: 45.7 });   // a frame 39 m east of the grid's
  const g2 = await groundAt(other, [[0, 0]], { query: null });
  near(g2[0], 200 + 0.1 * 38.9, 0.05, 'another frame: points projected to the grid frame by the SDK');
  const gaps = Float64Array.from([10, NaN, 20]);
  eq([fillGaps(gaps), [...gaps]], [1, [10, 15, 20]], 'gap filled');
  const t = terrainMesh({ xmin: -20, ymin: -20, xmax: 20, ymax: 20 });
  assert(t && t.faces.length > 0 && t.positions.every(Number.isFinite), 'terrain mesh');
  // a tile of the scene: values replaced where the grid covers them (identity projection for the test)
  const vals = new Float32Array(9).fill(-5);
  const n = fillTileFromGrid(vals, 3, 3, [-50, -50, 150, 50], pts => pts, meta, z);
  eq([n, vals[0], Math.round(vals[1] * 1e4) / 1e4, vals[2]], [6, 195, 205, -5], 'tile: two columns inside, one outside');
  setTerrainData(null, null);
});

// ── glTF ──
await test('glTF binary: header, chunks, accessors, Y up and origin, extras', () => {
  const box = boxMesh([[0, 0], [4, 0], [4, 2], [0, 2]], 110, 3);
  const buf = writeGlb([{ name: 'Box', ...box, color: [1, 0, 0, 1] }, { name: 'Empty', positions: new Float64Array(0), faces: new Uint32Array(0) }], [0, 0, 100], { note: 'x' });
  const dv = new DataView(buf);
  eq([dv.getUint32(0, true), dv.getUint32(4, true), dv.getUint32(8, true)], [0x46546c67, 2, buf.byteLength], 'header');
  const { json, bin } = readGlb(buf);
  eq([json.asset.version, json.meshes.length, json.nodes[0].name, json.asset.extras.note], ['2.0', 1, 'Box', 'x'], 'json');
  eq([json.accessors[0].count, json.accessors[1].count, json.accessors[0].min, json.accessors[0].max], [8, 36, [0, 10, -2], [4, 13, 0]], 'accessors (x east, y up, z south)');
  eq(bin.byteLength, json.buffers[0].byteLength, 'binary chunk');
  assert(json.bufferViews.every(v => v.byteOffset % 4 === 0), 'aligned');
  const pos = new Float32Array(bin, json.bufferViews[0].byteOffset, 24);
  eq([pos[12], pos[13], pos[14]], [0, 13, 0], 'a top vertex');
});

const ok = results.filter(r => r.ok).length;
document.getElementById('sum').innerHTML = `<b class="${ok === results.length ? 'ok' : 'err'}">${ok} / ${results.length} passed</b>`;
document.getElementById('out').innerHTML = results.map(r => `<tr><td class="s ${r.ok ? 'ok' : 'err'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}<br><code>${String(r.note).replace(/</g, '&lt;')}</code></td></tr>`).join('');
window.__results = results;
