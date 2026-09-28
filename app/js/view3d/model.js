// Everything the 3D view and the glTF export draw, from the project and its layout, in the local frame of the site:
// module surfaces, stations, fences, gates and obstacles with their elevations. One query of ground elevations for
// all the points, then plain geometry (geometry.js).
import { store } from '../state.js';
import { getCatalog } from '../catalog.js';
import { crsState, siteFrame } from '../areas.js';
import { last } from '../field.js';
import { layoutInfra, rectangle } from '../infra.js';
import { toSdk } from '../geo/convert.js';
import { heights3d, groundAt, fillGaps, tableCorners, tableMesh, boxMesh, wallMesh, trackerAngleFor } from './geometry.js';

const OBSTACLE_SIDES = 8;

// an n-gon prism around a point (trees, poles) or on a plan ring (buildings): walls and a fan roof
export function prismMesh(ring, base, height) {
  const r = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  const n = r.length, pos = new Float64Array(n * 6), faces = [];
  r.forEach(([x, y], i) => { pos.set([x, y, base], 3 * i); pos.set([x, y, base + height], 3 * (n + i)); });
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push(i, j, n + j, i, n + j, n + i); }
  for (let i = 1; i + 1 < n; i++) faces.push(n, n + i, n + i + 1);
  return { positions: pos, faces: Uint32Array.from(faces) };
}
const circle = ([cx, cy], rad) => Array.from({ length: OBSTACLE_SIDES }, (_, i) => {
  const a = 2 * Math.PI * i / OBSTACLE_SIDES;
  return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
});

// The module surfaces of a model again, for another time of the view (trackers following the sun) or another
// manual angle: no new ground query. Returns true when the surfaces changed.
export function retilt(m, date = new Date()) {
  const P = store.project, f = P.field, h = m.h;
  if (!m.tableList?.length || h.missing) return false;
  const angle = h.tracker ? trackerAngleFor(P, m.tableList, date, m.frame.lon0, m.frame.lat0, h.maxRotation ?? 0) : 0;
  if (m.tables && angle === m.angle) return false;
  m.angle = angle;
  m.tables = tableMesh(m.tableList, m.tableGround, { tracker: h.tracker, tiltDeg: f.tiltDeg, lowEdge: h.lowEdge?.value ?? 0, axisHeight: h.axis?.value ?? 0, angleDeg: angle });
  return true;
}

// opts: { date (for trackers following the sun), query (ground elevations, see groundAt) }
// -> { frame, h, angle, tables: mesh | null, stations: [{ kind, mesh }], fences: [{ letter, mesh }], gates: [mesh],
//      obstacles: [{ kind, mesh }], notes: [keys], gaps, center: [lon, lat] } or null without a site
export async function model3d({ date = new Date(), query } = {}) {
  const P = store.project, frame = last.result?.frame || siteFrame();
  if (!frame) return null;
  const r = last.result, h = heights3d(P), iso = crsState.iso;
  const out = { frame, h, angle: 0, tables: null, stations: [], fences: [], gates: [], obstacles: [], notes: [], gaps: 0, center: [frame.lon0, frame.lat0] };
  const tables = r?.tablesLocal || [];
  const L = r?.area ? layoutInfra(frame, r.area.pre, r.area.base) : null;
  // obstacles of 1 · Areas with a height
  const obs = [];
  for (const f of P.features) {
    const ht = Number(f.attrs?.height);
    if (f.category !== 'obstacle' || !(ht > 0)) continue;
    const l = frame.toLocal(toSdk(f.geometry));
    if (l?.type === 'point') obs.push({ kind: f.attrs.type || 'other', ring: circle([l.x, l.y], f.attrs.type === 'tree' ? Math.max(1, ht * 0.3) : f.attrs.type === 'pole' ? 0.25 : 1), height: ht });
    else if (l?.type === 'polygon') for (const ring of l.rings) obs.push({ kind: f.attrs.type || 'other', ring, height: ht });
  }
  // every point that needs a ground elevation, in one query
  const pts = [], at = [];
  const add = list => { at.push(pts.length); pts.push(...list); };
  add(tableCorners(tables));
  const st = L?.stations || [], fc = L?.fences || [], gt = L?.gates || [];
  st.forEach(s => add(s.footprint.rings[0].slice(0, 4)));
  fc.forEach(f => f.rings.forEach(ring => add(ring)));
  gt.forEach(g => add([g.point]));
  obs.forEach(o => add(o.ring));
  const z = pts.length ? await groundAt(frame, pts, { query }) : new Float64Array(0);
  out.gaps = fillGaps(z);
  if (out.gaps) out.notes.push('d3.noteGround');
  let k = 0;
  const next = n => { const s = at[k++]; return z.subarray(s, s + n); };
  // tables and trackers
  const g0 = next(tables.length * 4);
  out.tableList = tables;
  out.tableGround = Float64Array.from(g0);
  if (tables.length && !h.missing) retilt(out, date);
  else if (tables.length) out.notes.push(h.missing === 'axis' ? 'd3.noteAxis' : 'd3.noteLowEdge');
  // stations: from the lowest corner, their height above the ground
  for (const s of st) {
    const g = next(4), b = s.building;
    out.stations.push({ kind: s.kind, mesh: boxMesh(s.footprint.rings[0].slice(0, 4), Math.min(...g), b.height ?? 3) });
    if (!(b.height > 0)) out.notes.push('d3.noteStation');
  }
  // fences and gates
  const fh = h.fence;
  if (fc.length && !(fh > 0)) out.notes.push('d3.noteFence');
  for (const f of fc) for (const ring of f.rings) { const g = next(ring.length); if (fh > 0) out.fences.push({ letter: f.letter, mesh: wallMesh(ring, g, fh) }); }
  const gh = ((iso && getCatalog()?.countries?.[iso]?.gates) || [])[0]?.height ?? fh;
  for (const g of gt) {
    const gz = next(1)[0];
    if (gh > 0 && g.width > 0) out.gates.push(boxMesh(rectangle(g.point, g.width, 0.15, Math.atan2(g.dir[1], g.dir[0]) * 180 / Math.PI), gz, gh));
  }
  for (const o of obs) { const g = next(o.ring.length); out.obstacles.push({ kind: o.kind, mesh: prismMesh(o.ring, Math.min(...g), o.height) }); }
  return out;
}
