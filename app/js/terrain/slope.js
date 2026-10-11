// Terrain grid, slopes and slope masks. Pure functions in a local metric frame (x east, y north, metres): no SDK.
//
// A grid is { x0, y0, cell, nx, ny, z }: cell (i, j) covers [x0 + i·cell, x0 + (i+1)·cell] × [y0 + j·cell,
// y0 + (j+1)·cell], j grows northwards, z[j·nx + i] is the elevation of its centre (NaN where there is no data).
// Slopes are in percent: the east–west and north–south components of the gradient (Horn's 3 × 3 weights), and
// their magnitude (the steepest slope, "in every direction").

// Gradient of every cell: { gx: dz/dx (east), gy: dz/dy (north) } as Float32Array, NaN where unknown.
// Missing neighbours are skipped (one-sided differences at the edges and next to no-data cells).
export function gradients(grid) {
  const { nx, ny, z, cell } = grid;
  const gx = new Float32Array(nx * ny), gy = new Float32Array(nx * ny);
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny) ? NaN : z[j * nx + i];
  // derivative along one axis at (i, j): central difference, or one-sided when a side is missing
  const d = (i, j, di, dj) => {
    const c = at(i, j), p = at(i + di, j + dj), m = at(i - di, j - dj);
    if (!Number.isFinite(c)) return NaN;
    if (Number.isFinite(p) && Number.isFinite(m)) return (p - m) / (2 * cell);
    if (Number.isFinite(p)) return (p - c) / cell;
    if (Number.isFinite(m)) return (c - m) / cell;
    return NaN;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!Number.isFinite(z[k])) { gx[k] = NaN; gy[k] = NaN; continue; }
    // Horn: weights 1, 2, 1 across the derivative direction
    let sx = 0, wx = 0, sy = 0, wy = 0;
    for (const [o, w] of [[-1, 1], [0, 2], [1, 1]]) {
      const ax = d(i, j + o, 1, 0); if (Number.isFinite(ax)) { sx += w * ax; wx += w; }
      const ay = d(i + o, j, 0, 1); if (Number.isFinite(ay)) { sy += w * ay; wy += w; }
    }
    gx[k] = wx ? sx / wx : NaN;
    gy[k] = wy ? sy / wy : NaN;
  }
  return { gx, gy };
}

// Slope in percent of a cell: magnitude, or its north–south / east–west component
export const slopeAny = (g, k) => Math.hypot(g.gx[k], g.gy[k]) * 100;

// Over a slope limit { maxAny, maxNS, maxEW } (percent, any subset): the slope components of a cell in percent
export const exceeds = (ns, ew, limit) => (limit.maxAny != null && Math.hypot(ew, ns) > limit.maxAny + 1e-9)
  || (limit.maxNS != null && ns > limit.maxNS + 1e-9) || (limit.maxEW != null && ew > limit.maxEW + 1e-9);

// Cells over a slope limit: { maxAny, maxNS, maxEW } in percent (any subset). Unknown cells are never "over".
// Returns { mask: Uint8Array, over, unknown } (counts of cells).
export function limitMask(g, limit, n = g.gx.length) {
  const mask = new Uint8Array(n);
  let over = 0, unknown = 0;
  for (let k = 0; k < n; k++) {
    const x = g.gx[k], y = g.gy[k];
    if (!Number.isFinite(x) || !Number.isFinite(y)) { unknown++; continue; }
    const ew = Math.abs(x) * 100, ns = Math.abs(y) * 100;
    if (exceeds(ns, ew, limit)) { mask[k] = 1; over++; }
  }
  return { mask, over, unknown };
}

// Cells whose steepest slope (percent) is in [lo, hi)
export function classMask(g, lo, hi, n = g.gx.length) {
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const s = Math.hypot(g.gx[k], g.gy[k]) * 100;
    if (Number.isFinite(s) && s >= lo && s < hi) mask[k] = 1;
  }
  return mask;
}

// Remove the patches (4-connected) of fewer than minCells cells; returns the number of cells removed.
export function dropSmallPatches(mask, nx, ny, minCells) {
  if (!(minCells > 1)) return 0;
  const seen = new Uint8Array(mask.length), stack = [], patch = [];
  let removed = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    patch.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const k = stack.pop(); patch.push(k);
      const i = k % nx, j = (k - i) / nx;
      for (const q of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1]) {
        if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (patch.length < minCells) { for (const k of patch) mask[k] = 0; removed += patch.length; }
  }
  return removed;
}

// Outline of the cells of a mask as rings [[x, y], …] (closed), exterior rings counter-clockwise and holes clockwise
// (the cells are on the left of every edge). Cells touching only at a corner give separate rings. Collinear
// vertices are dropped.
export function maskToRings(mask, nx, ny, x0, y0, cell) {
  const on = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && mask[j * nx + i] === 1;
  // directed boundary edges between lattice vertices (vi, vj), keyed by their start vertex
  const W = nx + 1;
  const out = new Map();
  const add = (a, b) => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
  const V = (i, j) => j * W + i;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!on(i, j)) continue;
    if (!on(i, j - 1)) add(V(i, j), V(i + 1, j));           // south side, eastwards
    if (!on(i + 1, j)) add(V(i + 1, j), V(i + 1, j + 1));   // east side, northwards
    if (!on(i, j + 1)) add(V(i + 1, j + 1), V(i, j + 1));   // north side, westwards
    if (!on(i - 1, j)) add(V(i, j + 1), V(i, j));           // west side, southwards
  }
  const rings = [];
  const dir = (a, b) => [(b % W) - (a % W), Math.floor(b / W) - Math.floor(a / W)];
  for (const [start, list] of out) {
    while (list.length) {
      const ring = [start];
      let prev = start, cur = list.pop();
      while (cur !== start) {
        ring.push(cur);
        const nexts = out.get(cur);
        // at a vertex shared by two diagonal cells, turn left: the ring goes on around the same cell, so cells that
        // touch only at a corner stay in separate rings
        let pick = 0;
        if (nexts.length > 1) {
          const [dx, dy] = dir(prev, cur);
          pick = nexts.findIndex(n => { const [ex, ey] = dir(cur, n); return dx * ey - dy * ex > 0; });
          if (pick < 0) pick = 0;
        }
        prev = cur;
        cur = nexts.splice(pick, 1)[0];
      }
      // drop collinear vertices, then to coordinates
      const pts = [];
      for (let k = 0; k < ring.length; k++) {
        const a = ring[(k - 1 + ring.length) % ring.length], b = ring[k], c = ring[(k + 1) % ring.length];
        const [d1x, d1y] = dir(a, b), [d2x, d2y] = dir(b, c);
        if (d1x * d2y - d1y * d2x !== 0) pts.push([x0 + (b % W) * cell, y0 + Math.floor(b / W) * cell]);
      }
      if (pts.length >= 4) { pts.push([...pts[0]]); rings.push(pts); }
    }
  }
  return rings;
}

// Signed area of a ring (counter-clockwise positive)
export function ringArea(r) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
}

export const SLOPE_CLASSES = [[0, 5], [5, 10], [10, 15], [15, 25], [25, Infinity]];

// A grid of `cell` metres covering a local bounding box plus a margin, with at most maxCells cells (the cell grows
// when needed). Returns { x0, y0, cell, nx, ny, grown }.
export function gridOver({ xmin, ymin, xmax, ymax }, cell, margin = 30, maxCells = 2e6) {
  let c = Math.max(0.5, cell), grown = false;
  const w = xmax - xmin + 2 * margin, h = ymax - ymin + 2 * margin;
  while (Math.ceil(w / c) * Math.ceil(h / c) > maxCells) { c *= 1.25; grown = true; }
  c = Math.round(c * 100) / 100;
  const nx = Math.ceil(w / c), ny = Math.ceil(h / c);
  return { x0: xmin - margin, y0: ymin - margin, cell: c, nx, ny, grown };
}

// Bilinear value of a raster at a fractional pixel position (column u, row v measured from the centre of the first
// pixel); NaN outside or next to a no-data pixel.
export function bilinear(values, width, height, u, v, noData = null) {
  if (u < -0.5 || v < -0.5 || u > width - 0.5 || v > height - 0.5) return NaN;
  const cu = Math.min(Math.max(u, 0), width - 1), cv = Math.min(Math.max(v, 0), height - 1);
  const i = Math.max(0, Math.min(Math.floor(cu), width - 2)), j = Math.max(0, Math.min(Math.floor(cv), height - 2));
  const fu = width > 1 ? cu - i : 0, fv = height > 1 ? cv - j : 0;
  const g = (a, b) => { const x = values[Math.min(b, height - 1) * width + Math.min(a, width - 1)]; return (noData != null && x === noData) || !Number.isFinite(x) ? NaN : x; };
  const a = g(i, j), b = g(i + 1, j), c = g(i, j + 1), d = g(i + 1, j + 1);
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

// ── contours (phase 9, decision L14) ──
// The segments of marching squares in a cell, by the corners over the level (1 lower left, 2 lower right, 4 upper
// right, 8 upper left); edges 0 bottom, 1 right, 2 top, 3 left. 5 and 10 are the saddles, decided by the centre.
const CASES = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]],
  11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]] };
// Contour lines of a grid at every multiple of step, on the centres of the cells, joined into polylines:
// [{ z, path: [[x, y], …] }] in the coordinates of the grid (x0, y0 the lower left corner, cell its size). Cells with
// no data stop the lines. Each cell is visited once, with only the levels between its lowest and highest corner.
export function contourLines({ nx, ny, z, cell, x0 = 0, y0 = 0 }, step) {
  if (!(step > 0)) return [];
  const X = i => x0 + (i + 0.5) * cell, Y = j => y0 + (j + 0.5) * cell;
  const byLevel = new Map();
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = z[j * nx + i], b = z[j * nx + i + 1], c = z[(j + 1) * nx + i + 1], d = z[(j + 1) * nx + i];
    if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
    const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
    for (let n = Math.ceil(lo / step); n * step < hi; n++) {
      const level = n * step;
      const idx = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const f = (p, q) => (level - p) / (q - p);
      const edge = e => (e === 0 ? [X(i) + f(a, b) * cell, Y(j)] : e === 1 ? [X(i + 1), Y(j) + f(b, c) * cell]
        : e === 2 ? [X(i) + f(d, c) * cell, Y(j + 1)] : [X(i), Y(j) + f(a, d) * cell]);
      const centre = (a + b + c + d) / 4 > level;
      const pairs = idx === 5 ? (centre ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]])
        : idx === 10 ? (centre ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]]) : CASES[idx];
      let list = byLevel.get(n);
      if (!list) byLevel.set(n, list = []);
      for (const [p, q] of pairs) list.push([edge(p), edge(q)]);
    }
  }
  const out = [];
  for (const [n, segs] of [...byLevel].sort((u, v) => u[0] - v[0])) {
    const level = Math.round(n * step * 1e6) / 1e6;
    for (const path of joinSegments(segs)) out.push({ z: level, path });
  }
  return out;
}
// segments that share an end become one polyline (the shared points are computed the same way in both cells)
function joinSegments(segs) {
  const key = p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const ends = new Map();
  segs.forEach((s, k) => { for (const e of [0, 1]) { const id = key(s[e]); const l = ends.get(id); if (l) l.push(k); else ends.set(id, [k]); } });
  const used = new Uint8Array(segs.length), out = [];
  const next = (p, from) => (ends.get(key(p)) || []).find(k => k !== from && !used[k]);
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const path = [segs[s0][0], segs[s0][1]];
    for (const forward of [true, false]) {
      let last = s0;
      for (;;) {
        const tip = forward ? path[path.length - 1] : path[0];
        const k = next(tip, last);
        if (k === undefined) break;
        used[k] = 1; last = k;
        const s = segs[k], other = key(s[0]) === key(tip) ? s[1] : s[0];
        if (forward) path.push(other); else path.unshift(other);
      }
    }
    out.push(path);
  }
  return out;
}

// ── several elevation models at once (phase 9, decision L11) ──
// models: [{ z, res }] sampled on the same grid; every cell takes the value of the finest model that has one there.
// { z, counts (the cells each model gave, in the order of models), missing }
export function mosaic(models) {
  const order = models.map((m, k) => k).sort((p, q) => (models[p].res || Infinity) - (models[q].res || Infinity));
  const n = models[0]?.z.length || 0, z = new Float32Array(n).fill(NaN), counts = models.map(() => 0);
  let missing = 0;
  for (let c = 0; c < n; c++) {
    for (const k of order) { const v = models[k].z[c]; if (Number.isFinite(v)) { z[c] = v; counts[k]++; break; } }
    if (!Number.isFinite(z[c])) missing++;
  }
  return { z, counts, missing };
}
