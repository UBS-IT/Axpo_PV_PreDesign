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
