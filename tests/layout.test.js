// Layout engine tests. Run in the browser: /tests/index.html. window.__results holds the outcome.
import { parseNotation, tableGeometry, minPitch, shadingAngleDeg, gcr } from '../app/js/layout/structures.js';
import { fillRows, stripRanges, columnsIn, tablesPerBlock, toRowFrame, fromRowFrame, areaOf, corridorRects } from '../app/js/layout/rows.js';

const results = [];
function test(name, fn) {
  const t0 = performance.now();
  try { const note = fn(); results.push({ name, ok: true, note: note ?? '', ms: performance.now() - t0 }); }
  catch (e) { results.push({ name, ok: false, note: e && e.message || String(e), ms: performance.now() - t0 }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function near(a, b, tol, what) { assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`); }
function eq2(a, b, what) { assert(a === b, `${what}: ${a} vs ${b}`); }

// ── reference module of the toolkit sheets: 2.382 x 1.134 m ──
const M = { length: 2.382, width: 1.134 };

test('notation: accepted spellings', () => {
  const a = parseNotation('2V13'), b = parseNotation('2v/13'), c = parseNotation(' 3 H 8 '), d = parseNotation('1P26');
  assert(a.across === 2 && a.along === 13 && a.orientation === 'V', '2V13');
  assert(b.notation === '2V13', '2v/13');
  assert(c.across === 3 && c.along === 8 && c.orientation === 'H', '3H8');
  assert(d.orientation === 'V' && d.along === 26, '1P26');
  assert(parseNotation('V13') === null && parseNotation('0V13') === null && parseNotation('2X13') === null, 'invalid ones rejected');
});

test('toolkit CS: table lengths from modules (2V13, 3V9, 3V18)', () => {
  near(tableGeometry({ notation: '2V13', module: M }).tableLength, 14.98, 0.005, '2V13 length');
  near(tableGeometry({ notation: '3V9', module: M }).tableLength, 10.37, 0.005, '3V9 length');
  near(tableGeometry({ notation: '3V18', module: M }).tableLength, 20.75, 0.005, '3V18 length');
  return '14.982 · 10.366 · 20.752 m';
});

test('toolkit CS: 3V9 section at 15 deg (plan depth 6.94, gap 2.66, pitch 9.60)', () => {
  const g = tableGeometry({ notation: '3V9', module: M, tiltDeg: 15 });
  near(g.planDepth, 6.94, 0.005, 'plan depth');
  const p = minPitch(g, 35);
  near(p - g.planDepth, 2.66, 0.01, 'free gap between rows');
  near(p, 9.60, 0.01, 'pitch');
  near(shadingAngleDeg(g, p), 35, 1e-9, 'shading angle back');
  return `depth ${g.planDepth.toFixed(3)} · gap ${(p - g.planDepth).toFixed(3)} · pitch ${p.toFixed(3)} · GCR ${gcr(g, p).toFixed(3)}`;
});

test('toolkit CS: 2V13 plan depth 4.62 at 15 deg', () => {
  const g = tableGeometry({ notation: '2V13', module: M, tiltDeg: 15 });
  near(g.planDepth, 4.62, 0.005, 'plan depth');
  return `depth ${g.planDepth.toFixed(3)} · min pitch ${minPitch(g, 35).toFixed(3)}`;
});

test('landscape 3H8', () => {
  const g = tableGeometry({ notation: '3H8', module: M });
  near(g.tableLength, 8 * 2.382 + 7 * 0.02, 1e-9, 'length');
  near(g.slopeDepth, 3 * 1.134 + 2 * 0.02, 1e-9, 'depth');
  assert(g.modules === 24, 'modules');
});

test('row frame round trip', () => {
  for (const A of [180, 90, 200, 135.5, 270]) {
    const p = [123.4, -56.7], q = fromRowFrame(toRowFrame(p, A), A);
    near(q[0], p[0], 1e-9, `x @${A}`); near(q[1], p[1], 1e-9, `y @${A}`);
  }
  const [u, v] = toRowFrame([10, 20], 180);
  near(u, 10, 1e-12, 'south: u = x'); near(v, 20, 1e-12, 'south: v = y');
});

test('rectangle: exact count', () => {
  const rect = [[[0, 0], [100, 0], [100, 50], [0, 50]]];
  const r0 = fillRows(rect, { tableLength: 10, planDepth: 5, pitch: 10, tableGap: 0 });
  assert(r0.tables.length === 50 && r0.rows === 5, `gap 0: ${r0.tables.length} tables, ${r0.rows} rows`);
  const r1 = fillRows(rect, { tableLength: 10, planDepth: 5, pitch: 10, tableGap: 0.3 });
  assert(r1.tables.length === 45, `gap 0.3: ${r1.tables.length} tables (expected 9 x 5)`);
  return '50 and 45 tables';
});

test('slanted notch (no table may cut into it)', () => {
  // top edge with a notch leaning right: tip at (40, 5)
  const poly = [[[0, 0], [100, 0], [100, 20], [60, 20], [40, 5], [30, 20], [0, 20]]];
  const ranges = stripRanges(
    [[0, 0, 100, 0], [100, 0, 100, 20], [60, 20, 40, 5], [40, 5, 30, 20], [0, 20, 0, 0]],
    [0, 20, 5, 20, 20, 0], 0, 10);
  near(ranges[0][1], 36.6667, 1e-3, 'left range ends at the notch at y = 10');
  near(ranges[1][0], 46.6667, 1e-3, 'right range starts at the notch at y = 10');
  // grid moved 10 cm off the outer edges: the oracle cannot judge points lying exactly on the boundary
  const r = fillRows(poly, { tableLength: 5, planDepth: 9.8, pitch: 20, tableGap: 0, rowOffset: 0.1, columnOffset: 0.1 });
  assert(r.tables.length > 10, `only ${r.tables.length} tables`);
  for (const t of r.tables) assert(rectInside(t.corners, poly), `table ${t.col} cuts the notch`);
  return `${r.tables.length} tables, none in the notch`;
});

test('corridors across rows every 100 m', () => {
  const rect = [[[0, 0], [500, 0], [500, 10], [0, 10]]];
  const K = tablesPerBlock(100, 10, 0.3);
  assert(K === 9, `tables per block ${K}`);
  const r = fillRows(rect, { tableLength: 10, planDepth: 5, pitch: 20, tableGap: 0.3, blockTables: K, corridorWidth: 4 });
  const us = r.tables.map(t => Math.min(...t.corners.map(c => c[0]))).sort((a, b) => a - b);
  assert(us.length === 46, `tables in the row: ${us.length}`);
  near(us[9] - (us[8] + 10), 4, 1e-9, 'corridor width after the first block');
  near(us[1] - (us[0] + 10), 0.3, 1e-9, 'normal gap');
  // the corridors as road rectangles: exactly in the gaps, across the whole area
  const roads = corridorRects(r.grid).map(c => [Math.min(...c.map(p => p[0])), Math.max(...c.map(p => p[0])), Math.min(...c.map(p => p[1])), Math.max(...c.map(p => p[1]))]);
  const first = roads.find(q => q[1] > us[0]);
  near(first[0], us[8] + 10, 1e-9, 'road starts after the ninth table'); near(first[1], us[9], 1e-9, 'road ends at the tenth');
  near(first[2], 0, 1e-9, 'across the area (south)'); near(first[3], 10, 1e-9, 'across the area (north)');
  assert(!corridorRects(fillRows(rect, { tableLength: 10, planDepth: 5, pitch: 20, tableGap: 0.3 }).grid).length, 'no corridors, no roads');
  return `9 tables per block, 4 m corridors, ${roads.length} road rectangles`;
});

test('target capacity stops the fill', () => {
  const rect = [[[0, 0], [100, 0], [100, 50], [0, 50]]];
  const r = fillRows(rect, { tableLength: 10, planDepth: 5, pitch: 10, tableGap: 0, maxTables: 17 });
  assert(r.tables.length === 17, `${r.tables.length}`);
});

// ── exactness against a brute-force oracle on random polygons with holes, random azimuths ──
test('random polygons: engine = brute force (200 cases)', () => {
  let rnd = mulberry32(20260923), cases = 0, checked = 0, placed = 0;
  for (let n = 0; n < 200; n++) {
    const outer = star(rnd, 0, 0, 60, 180, 6 + Math.floor(rnd() * 14));
    const rings = [outer];
    if (rnd() < 0.6) rings.push(star(rnd, (rnd() - 0.5) * 30, (rnd() - 0.5) * 30, 5, 20, 5 + Math.floor(rnd() * 5)));
    const opt = {
      azimuthDeg: 90 + rnd() * 180, tableLength: 4 + rnd() * 20, planDepth: 2 + rnd() * 6,
      tableGap: rnd() < 0.5 ? 0 : 0.3, rowOffset: rnd() * 5, columnOffset: rnd() * 5,
    };
    opt.pitch = opt.planDepth + 0.5 + rnd() * 6;
    const got = new Set(fillRows(rings, opt).tables.map(t => `${t.row}:${t.col}`));
    const want = bruteForce(rings, opt);
    for (const k of want) assert(got.has(k), `case ${n}: missing slot ${k}`);
    for (const k of got) assert(want.has(k), `case ${n}: slot ${k} is not fully inside`);
    cases++; checked += want.size; placed += got.size;
  }
  return `${cases} cases, ${placed} tables all verified`;
});

test('performance: ~50 MWp site', () => {
  // 1 km x 700 m irregular site, 400 vertices, 2V13 of 2.382 x 1.134 at 15 deg, pitch 6.4 m
  const rnd = mulberry32(7);
  const ring = [];
  for (let i = 0; i < 400; i++) {
    const a = i / 400 * 2 * Math.PI;
    ring.push([500 * Math.cos(a) * (1 + 0.05 * Math.sin(7 * a)) + rnd(), 350 * Math.sin(a) * (1 + 0.05 * Math.cos(5 * a)) + rnd()]);
  }
  const g = tableGeometry({ notation: '2V13', module: M, tiltDeg: 15 });
  const t0 = performance.now();
  const r = fillRows([ring], { tableLength: g.tableLength, planDepth: g.planDepth, pitch: 6.4, tableGap: 0.3 });
  const ms = performance.now() - t0;
  const mwp = r.tables.length * g.modules * 620 / 1e6;
  assert(ms < 500, `too slow: ${ms.toFixed(0)} ms`);
  return `${r.tables.length} tables, ${r.rows} rows, ${mwp.toFixed(1)} MWp at 620 Wp, ${ms.toFixed(0)} ms`;
});

test('half tables: a half takes the grid place where a whole table does not fit', () => {
  const rect = [[[0, 0], [25, 0], [25, 5], [0, 5]]];
  const opt = { tableLength: 10, planDepth: 5, pitch: 10, tableGap: 0, rowOffset: 0, columnOffset: 0 };
  eq2(fillRows(rect, opt).tables.length, 2, 'without halves');
  const r = fillRows(rect, { ...opt, halfLength: 5 });
  eq2(r.tables.length, 3, 'with halves');
  const h = r.tables.find(t => t.half);
  near(Math.min(...h.corners.map(c => c[0])), 20, 1e-9, 'half at the start of the third slot');
  near(Math.max(...h.corners.map(c => c[0])), 25, 1e-9, 'half length');
  // a slot cut in two by a hole takes a half at each end when both fit with the table gap between them
  const two = fillRows([[[0, 0], [10, 0], [10, 5], [5.4, 5], [5.4, 0.001], [4.6, 0.001], [4.6, 5], [0, 5]]], { ...opt, tableLength: 10, halfLength: 4.5 });
  eq2(two.tables.filter(t => t.half).map(t => t.half).join(''), 'LR', 'both ends of a split slot');
  return '2 whole + 1 half; split slot L + R';
});

test('half tables: engine = brute force (200 cases)', () => {
  const rnd = mulberry32(20260925);
  let placed = 0, halves = 0;
  for (let n = 0; n < 200; n++) {
    const outer = star(rnd, 0, 0, 60, 180, 6 + Math.floor(rnd() * 14));
    const rings = [outer];
    if (rnd() < 0.6) rings.push(star(rnd, (rnd() - 0.5) * 30, (rnd() - 0.5) * 30, 5, 20, 5 + Math.floor(rnd() * 5)));
    const opt = { azimuthDeg: 90 + rnd() * 180, tableLength: 6 + rnd() * 30, planDepth: 2 + rnd() * 6,
      tableGap: rnd() < 0.5 ? 0.3 : 0.5, rowOffset: rnd() * 5, columnOffset: rnd() * 5 };
    opt.halfLength = opt.tableLength * (0.4 + rnd() * 0.2);
    opt.pitch = opt.planDepth + 0.5 + rnd() * 6;
    if (rnd() < 0.3) { opt.blockTables = 1 + Math.floor(rnd() * 4); opt.corridorWidth = 4; }
    const res = fillRows(rings, opt);
    const got = new Set(res.tables.map(t => `${t.row}:${t.col}${t.half || ''}`));
    const want = bruteForce(rings, opt);
    for (const k of want) assert(got.has(k), `case ${n}: missing ${k}`);
    for (const k of got) assert(want.has(k), `case ${n}: ${k} is not expected`);
    placed += res.tables.length; halves += res.tables.filter(t => t.half).length;
  }
  return `${placed} tables of which ${halves} halves, all verified`;
});

// ── oracle ──
function bruteForce(rings, opt) {
  const A = opt.azimuthDeg, len = opt.tableLength, depth = opt.planDepth, gap = opt.tableGap, step = len + gap;
  const h = opt.halfLength || 0, K = opt.blockTables || 0;
  const uv = rings.flat().map(p => toRowFrame(p, A));
  const umin = Math.min(...uv.map(p => p[0])), umax = Math.max(...uv.map(p => p[0]));
  const vmin = Math.min(...uv.map(p => p[1])), vmax = Math.max(...uv.map(p => p[1]));
  const u0 = umin + (opt.columnOffset % step), v0 = vmin + (opt.rowOffset % opt.pitch);
  // start of the table of column i (with corridors: a corridor replaces the gap after every K tables)
  const slotU = i => K ? u0 + Math.floor(i / K) * (K * len + (K - 1) * gap + opt.corridorWidth) + (((i % K) + K) % K) * step : u0 + i * step;
  const fits = (u, v, l) => rectInside([[u, v], [u + l, v], [u + l, v + depth], [u, v + depth]].map(p => fromRowFrame(p, A)), rings);
  const ok = new Set();
  for (let k = 0; v0 + k * opt.pitch + depth <= vmax; k++) {
    const v = v0 + k * opt.pitch;
    for (let i = Math.floor((umin - u0) / step) - K - 2; slotU(i) <= umax; i++) {
      const u = slotU(i);
      if (fits(u, v, len)) { ok.add(`${k}:${i}`); continue; }
      if (!h) continue;
      const L = fits(u, v, h), R = fits(u + len - h, v, h);
      if (L) ok.add(`${k}:${i}L`);
      if (R && (!L || u + len - h >= u + h + gap - 1e-9)) ok.add(`${k}:${i}R`);
    }
  }
  return ok;
}
function inArea(p, rings) {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < xi + (p[1] - yi) * (xj - xi) / (yj - yi)) inside = !inside;
  }
  return inside;
}
function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
function segCross(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}
function rectInside(corners, rings) {
  if (!corners.every(c => inArea(c, rings))) return false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    for (let k = 0; k < 4; k++) if (segCross(r[j], r[i], corners[k], corners[(k + 1) % 4])) return false;
    if (inArea(r[i], [corners])) return false;   // a vertex poking into the table
  }
  return true;
}
function star(rnd, cx, cy, r1, r2, n) {
  const angles = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b);
  return angles.map(a => { const r = r1 + rnd() * (r2 - r1); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
}
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ── report ──
const ok = results.filter(r => r.ok).length;
document.getElementById('sum').innerHTML = `<b class="${ok === results.length ? 'ok' : 'err'}">${ok} / ${results.length} passed</b>`;
document.getElementById('out').innerHTML = results.map(r =>
  `<tr><td class="s ${r.ok ? 'ok' : 'err'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}<br><code>${r.note} · ${r.ms.toFixed(1)} ms</code></td></tr>`).join('');
window.__results = results;
