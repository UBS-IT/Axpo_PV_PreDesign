// Row-fill engine. Pure functions in a local metric frame (x east, y north, metres). No SDK.
//
// The buildable area is a set of rings (exterior rings and holes, even-odd rule; the caller unions the site
// polygons and subtracts the exclusions first, so rings do not overlap). Rows of tables are laid out
// perpendicular to the facing azimuth, at a fixed pitch, and tables sit on a common column grid so that they
// line up from row to row. A table is kept only if its whole plan rectangle lies inside the area.

const DEG = Math.PI / 180;
const EPS = 1e-9;

// Row frame: u runs along the rows, v runs away from the facing direction (up the slope). For a table facing
// south (azimuth 180) u = x and v = y.
export function toRowFrame([x, y], azimuthDeg) {
  const c = Math.cos(azimuthDeg * DEG), s = Math.sin(azimuthDeg * DEG);
  return [-x * c + y * s, -x * s - y * c];
}
export function fromRowFrame([u, v], azimuthDeg) {
  const c = Math.cos(azimuthDeg * DEG), s = Math.sin(azimuthDeg * DEG);
  return [-u * c - v * s, u * s - v * c];
}

function openRing(ring) {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, n - 1);
  return ring;
}

// Edges of all rings as [x1, y1, x2, y2], horizontal edges dropped (they never cross a horizontal line).
function edgesOf(rings) {
  const edges = [];
  for (const r of rings) {
    const ring = openRing(r), n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    }
  }
  return edges;
}

const xAt = (e, y) => e[0] + (y - e[1]) * (e[2] - e[0]) / (e[3] - e[1]);

// Horizontal extents (u ranges) where a rectangle spanning [y0, y1] fits entirely inside the area.
// Exact: the strip is cut into slabs at every vertex height; inside a slab the same edges cross it and each
// boundary moves linearly, so an interval is safe over the whole slab between max(left at both ends) and
// min(right at both ends). The strip is safe where every slab is.
export function stripRanges(edges, vertexYs, y0, y1) {
  const cuts = [y0];
  for (const y of vertexYs) if (y > y0 + EPS && y < y1 - EPS) cuts.push(y);
  cuts.push(y1);
  cuts.sort((a, b) => a - b);
  let result = null;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const ya = cuts[k], yb = cuts[k + 1];
    if (yb - ya < EPS) continue;
    const ym = (ya + yb) / 2;
    const crossing = [];
    for (const e of edges) {
      if ((e[1] > ym) !== (e[3] > ym)) crossing.push([xAt(e, ym), xAt(e, ya), xAt(e, yb)]);
    }
    crossing.sort((p, q) => p[0] - q[0]);
    const slab = [];
    for (let i = 0; i + 1 < crossing.length; i += 2) {
      const left = Math.max(crossing[i][1], crossing[i][2]);
      const right = Math.min(crossing[i + 1][1], crossing[i + 1][2]);
      if (right > left + EPS) slab.push([left, right]);
    }
    result = result === null ? slab : intersectRanges(result, slab);
    if (!result.length) return result;
  }
  return result || [];
}

export function intersectRanges(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]), hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo + EPS) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

// Column grid along a row: tables of length len separated by gap; with blockTables = K, a corridor of width
// corridorWidth replaces the gap after every K tables. Returns the start of every table that fits in [a, b].
// With halfLen > 0 (half tables, an option of the designer), a grid slot where a whole table does not fit takes a
// half table at its left end, or at its right end, if one fits: halves stay on the column grid.
export function columnsIn(a, b, grid) {
  const { u0, len, gap, blockTables, corridorWidth, halfLen = 0 } = grid;
  const step = len + gap;
  const slots = [];
  if (!(blockTables > 0) || !isFinite(blockTables)) {
    const i0 = Math.floor((a - u0) / step) - 1, i1 = Math.ceil((b - u0) / step) + 1;
    for (let i = i0; i <= i1; i++) slots.push({ col: i, u: u0 + i * step });
  } else {
    const K = blockTables, blockStep = K * len + (K - 1) * gap + corridorWidth;
    const j0 = Math.floor((a - u0) / blockStep) - 1, j1 = Math.ceil((b - u0) / blockStep) + 1;
    for (let j = j0; j <= j1; j++) for (let m = 0; m < K; m++) slots.push({ col: j * K + m, u: u0 + j * blockStep + m * step });
  }
  const out = [];
  for (const { col, u } of slots) {
    if (u >= a - EPS && u + len <= b + EPS) { out.push({ col, u }); continue; }
    if (!(halfLen > 0 && halfLen < len)) continue;
    const left = u >= a - EPS && u + halfLen <= b + EPS;
    const ru = u + len - halfLen;
    if (left) out.push({ col, u, half: 'L' });
    if (ru >= a - EPS && u + len <= b + EPS && (!left || ru >= u + halfLen + gap - EPS)) out.push({ col, u: ru, half: 'R' });
  }
  return out;
}

// Fill the area with rows of tables.
// area: rings in the local frame. opt: {
//   azimuthDeg        facing azimuth (180 = south; trackers: 90, rows north-south)
//   tableLength       along the row (m)
//   planDepth         table depth in plan (m)
//   pitch             row-to-row distance (m)
//   tableGap          gap between consecutive tables (m)
//   rowOffset         shift of the first row, 0 <= rowOffset < pitch (m)
//   columnOffset      shift of the column grid, 0 <= columnOffset < tableLength + tableGap (m)
//   blockTables, corridorWidth   optional corridors across the rows every blockTables tables
//   halfLength        optional length of a half table (half strings), used where a whole table does not fit
//   maxTables         optional cap (target capacity)
// }
// Returns { tables: [{ row, col, corners: [[x, y] x4], half: 'L' | 'R' (half tables only) }], rows, grid } — grid
// describes the column grid in the row frame (for the corridors: u0, len, gap, blockTables, corridorWidth, extent).
export function fillRows(area, opt) {
  const A = opt.azimuthDeg ?? 180;
  const len = opt.tableLength, depth = opt.planDepth, pitch = opt.pitch, gap = opt.tableGap ?? 0.3;
  if (!(len > 0 && depth > 0 && pitch > 0)) throw new Error('tableLength, planDepth and pitch must be positive');
  const rings = area.map(r => openRing(r).map(p => toRowFrame(p, A)));
  if (!rings.length) return { tables: [], rows: 0 };
  const edges = edgesOf(rings);
  const vertexYs = [];
  let umin = Infinity, vmin = Infinity, vmax = -Infinity;
  for (const r of rings) for (const [u, v] of r) {
    if (u < umin) umin = u;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
    vertexYs.push(v);
  }
  vertexYs.sort((a, b) => a - b);
  const grid = {
    u0: umin + ((opt.columnOffset ?? 0) % (len + gap)),
    len, gap,
    blockTables: opt.blockTables ?? 0,
    corridorWidth: opt.corridorWidth ?? 0,
    halfLen: opt.halfLength ?? 0,
  };
  const maxTables = opt.maxTables ?? Infinity;
  const tables = [];
  let rows = 0;
  const v0 = vmin + ((opt.rowOffset ?? 0) % pitch);
  for (let k = 0; ; k++) {
    const v = v0 + k * pitch;
    if (v + depth > vmax + EPS) break;
    // only vertices inside the strip matter for the slab cuts
    const lo = lowerBound(vertexYs, v), hi = lowerBound(vertexYs, v + depth);
    const ranges = stripRanges(edges, vertexYs.slice(lo, hi), v, v + depth);
    let inRow = 0;
    const halves = new Map();   // col -> half placed in this row: a slot split by a hole may offer both ends
    for (const [a, b] of ranges) {
      for (const { col, u, half } of columnsIn(a, b, grid)) {
        if (tables.length >= maxTables) break;
        if (half) {
          const other = halves.get(col);
          if (other && (other.half === half || (half === 'R' ? u < other.u + grid.halfLen + gap - EPS : other.u < u + grid.halfLen + gap - EPS))) continue;
          halves.set(col, { half, u });
        }
        const l = half ? grid.halfLen : len;
        const corners = [[u, v], [u + l, v], [u + l, v + depth], [u, v + depth]].map(p => fromRowFrame(p, A));
        tables.push(half ? { row: k, col, corners, half } : { row: k, col, corners });
        inRow++;
      }
    }
    if (inRow) rows++;
    if (tables.length >= maxTables) break;
  }
  let umax = -Infinity;
  for (const r of rings) for (const [u] of r) if (u > umax) umax = u;
  return { tables, rows, grid: { ...grid, azimuthDeg: A, umin, umax, vmin, vmax } };
}

// Corridors of a fill as rectangles in the local frame (x, y), each spanning the whole extent of the area across the
// rows: [[x, y] × 4] per corridor. Empty when the fill has no corridors.
export function corridorRects(grid) {
  const { u0, len, gap, blockTables: K, corridorWidth: w, azimuthDeg: A, umin, umax, vmin, vmax } = grid || {};
  if (!(K > 0) || !isFinite(K) || !(w > 0)) return [];
  const blockStep = K * len + (K - 1) * gap + w;
  const out = [];
  for (let j = Math.floor((umin - u0) / blockStep) - 1; u0 + j * blockStep <= umax; j++) {
    const a = u0 + j * blockStep + K * len + (K - 1) * gap, b = a + w;
    if (b < umin || a > umax) continue;
    out.push([[a, vmin], [b, vmin], [b, vmax], [a, vmax]].map(p => fromRowFrame(p, A)));
  }
  return out;
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

// Blocks of tables between corridors, sized so that a block (tables + gaps) is at most `spacing` long.
export function tablesPerBlock(spacing, tableLength, tableGap) {
  return Math.max(1, Math.floor((spacing + tableGap) / (tableLength + tableGap) + EPS));
}

// Plain polygon helpers used by the tests and the KPIs.
export function ringArea(ring) {
  const r = openRing(ring);
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
}
export function areaOf(rings) {
  // even-odd: exterior rings and holes have opposite sign only if oriented so; use absolute values with
  // containment parity instead
  let total = 0;
  rings.forEach((r, i) => {
    const a = Math.abs(ringArea(r));
    const depth = rings.reduce((d, q, j) => (j !== i && pointInRing(openRing(r)[0], q) ? d + 1 : d), 0);
    total += depth % 2 ? -a : a;
  });
  return total;
}
export function pointInRing([x, y], ring) {
  const r = openRing(ring);
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) inside = !inside;
  }
  return inside;
}
