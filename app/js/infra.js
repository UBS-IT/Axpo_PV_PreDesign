// Step 3 · Infrastructure: fence, perimeter road, gates, internal roads (from the corridors of 2 · Fields) and
// stations. Values come from the country of the site (catalog countries.<ISO>: clearances, roads, buildings, gates);
// every value is a default the designer can change, and a missing country value is reported, never borrowed.
//
// The fence runs along the outline of the land the plant can use (the base area minus the objects of 1 · Areas,
// holes ignored). The band between the fence and the structures (with a perimeter road: fence → road → structures)
// is cut from the buildable area, and so is every station with its clearance.
import { getSdk } from './sdk.js';
import { store, change, on, uid } from './state.js';
import { t, fmt } from './i18n.js';
import { countryValue, countryName, getCatalog, standardFor } from './catalog.js';
import { siteFrame, extraCuts, crsState, computeArea } from './areas.js';
import { last } from './field.js';
import { toast } from './ui/toast.js';
import { icon } from './ui/icons.js';
import { stepProvider } from './ui/rail.js';

const KINDS = { CC: 'delivery-station', CU: 'user-station', CT: 'transformer-station' };
const STATION_COLOUR = { CC: [31, 153, 204], CU: [110, 170, 60], CT: [233, 120, 30] };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let view = null, layer = null, placing = null, clickHandle = null;
// figures of the step for the rail
export const infraState = { fenceLength: 0, fences: 0 };

// ── plain geometry in the local frame (no SDK) ──
export function ringArea(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; }
export function ringLength(r) { let s = 0; for (let i = 1; i < r.length; i++) s += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]); return s; }
export function pointInRing([x, y], r) {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) ins = !ins;
  }
  return ins;
}
// Nearest point of a set of rings: { point, dir (unit vector of the segment), ring, dist }
export function nearestOnRings(rings, [px, py]) {
  let best = null;
  rings.forEach((r, k) => {
    for (let i = 1; i < r.length; i++) {
      const [ax, ay] = r[i - 1], [bx, by] = r[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const s = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      const q = [ax + s * dx, ay + s * dy], d = Math.hypot(px - q[0], py - q[1]);
      if (!best || d < best.dist) { const l = Math.sqrt(l2); best = { point: q, dir: [dx / l, dy / l], ring: k, dist: d }; }
    }
  });
  return best;
}
// Corners of a rectangle of length L (along the angle rotDeg) and width W centred on c, grown by m on every side
export function rectangle([cx, cy], L, W, rotDeg, m = 0) {
  const a = rotDeg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const hl = L / 2 + m, hw = W / 2 + m;
  return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw], [-hl, -hw]].map(([s, q]) => [cx + s * ux + q * vx, cy + s * uy + q * vy]);
}

// ── values of the country of the site ──
const val = path => (crsState.iso ? countryValue(crsState.iso, path) : null);
export function building(kind) {
  const list = (crsState.iso && getCatalog()?.countries?.[crsState.iso]?.buildings) || [];
  return list.find(b => b.kind === KINDS[kind]) || null;
}
// Clearances in force: { clearance (fence → structures), roadGap (fence → road), roadWidth, source, missing }
export function clearances(P = store.project) {
  const road = !!P.infra.perimeterRoad;
  const tk = val(road ? 'clearances.fenceToStructuresWithPerimeterRoad' : 'clearances.fenceToStructuresWithoutRoad');
  const roadGap = val('clearances.fenceToPerimeterRoad')?.value ?? null;
  const roadWidth = val('clearances.perimeterRoadWidth')?.value ?? val('roads.heavy.width')?.value ?? null;
  const custom = P.infra.clearance;
  return { clearance: custom != null ? custom : tk?.value ?? null, source: custom != null ? 'custom' : tk ? 'toolkit' : null,
    toolkit: tk?.value ?? null, roadGap, roadWidth, road };
}
export function stationClearance() { return val('clearances.stationClearance')?.value ?? 0; }
export function gateWidth() { const g = (crsState.iso && getCatalog()?.countries?.[crsState.iso]?.gates) || []; return g[0]?.width ?? null; }
export function suggestedRoad(mwp) {
  const s = standardFor('perimeterRoad');
  return s && mwp > 0 ? mwp <= s.suggestedUpToMWp : null;
}

// ── lots and fences ──
const MIN_LOT = 200;      // m²: smaller parts of the usable land are not lots
const SNAP = 25;          // m: a station placed this close to a fence is set flush with it
// A point inside a ring (its centre when inside, else the middle of the widest span of the line through the centre)
export function innerPoint(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; }
  const c = a ? [cx / (3 * a), cy / (3 * a)] : r[0];
  if (pointInRing(c, r)) return c;
  const xs = [];
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > c[1]) !== (yj > c[1])) xs.push(xi + (c[1] - yi) * (xj - xi) / (yj - yi));
  }
  xs.sort((p, q) => p - q);
  let best = null;
  for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
  return best ? [(best[0] + best[1]) / 2, c[1]] : r[0];
}
// The lots: separate parts of the usable land, numbered from north to south, then west to east.
// [{ n, ring (outer, clockwise), holes, area, label: [x, y] }]
export function lotsOf(pre) {
  const rings = pre?.rings || [];
  const holes = rings.filter(r => ringArea(r) > 0);
  const lots = rings.filter(r => ringArea(r) < 0 && -ringArea(r) > MIN_LOT).map(ring => {
    const hs = holes.filter(h => pointInRing(h[0], ring));
    return { ring, holes: hs, area: -ringArea(ring) - hs.reduce((s, h) => s + ringArea(h), 0), label: innerPoint(ring) };
  });
  lots.sort((a, b) => (Math.round(b.label[1] / 10) - Math.round(a.label[1] / 10)) || (a.label[0] - b.label[0]));
  lots.forEach((l, i) => { l.n = i + 1; });
  return lots;
}
function polygonOf(rings, sr) { const { Polygon } = getSdk(); return new Polygon({ rings, spatialReference: sr }); }
const outer = g => (g?.rings || []).filter(r => ringArea(r) < 0 && -ringArea(r) > 1);
function shrink(poly, d) { const g = d > 0 ? getSdk().bufferOperator.execute(poly, -d) : poly; return g && g.rings && g.rings.length ? g : null; }
function minus(a, b) { return a && b ? getSdk().differenceOperator.execute(a, b) : a; }
function perimeterOf(g) { return (g?.rings || []).reduce((s, r) => s + ringLength(r), 0); }

// Fence of a group of lots: around the lots, across the gaps between them (roads, ditches, buffers…), never outside
// the site and never over the lots of another fence. Returns { polygon, rings, length, lots: [n], parts }.
function fenceOfLots(lots, others, base, sr) {
  const S = getSdk();
  let poly = polygonOf(lots.map(l => l.ring), sr);
  if (lots.length > 1) {
    const u = S.unionOperator.executeMany(lots.map(l => polygonOf([l.ring], sr)));
    // morphological closing: the smallest distance that joins the lots, taken half again larger so that the gaps are
    // filled straight across instead of with arcs
    const close = d => S.bufferOperator.execute(S.bufferOperator.execute(u, d), -d);
    let closed = u;
    for (const d of [2, 5, 10, 20, 40, 80, 160]) {
      closed = close(d);
      if (outer(closed).length <= 1) { const wider = close(d * 1.5); if (outer(wider).length <= 1) closed = wider; break; }
    }
    const site = polygonOf(outer(base), sr);
    let g = S.intersectionOperator.execute(closed, site);
    if (others.length) g = S.differenceOperator.execute(g, S.unionOperator.executeMany(others.map(l => polygonOf([l.ring], sr))));
    poly = polygonOf(outer(g), sr);
  }
  const rings = outer(poly);
  return { polygon: polygonOf(rings, sr), rings, length: rings.reduce((s, r) => s + ringLength(r), 0), lots: lots.map(l => l.n), parts: rings.length };
}
// The fences of the plant: one per group of lots chosen by the designer, one per lot otherwise.
// Groups are kept as points (WGS84) inside their lots, so they survive small changes of the areas.
export function fencesOf(frame, pre, base) {
  const lots = lotsOf(pre);
  if (!lots.length) return { lots, fences: [] };
  const { Point, SpatialReference } = getSdk();
  const groups = (store.project.infra.fenceGroups || []).map(g => ({ id: g.id, pts: g.points.map(([lo, la]) => { const p = frame.toLocal(new Point({ x: lo, y: la, spatialReference: SpatialReference.WGS84 })); return p && [p.x, p.y]; }).filter(Boolean) }));
  for (const l of lots) l.group = (groups.find(g => g.pts.some(p => pointInRing(p, l.ring))) || {}).id || null;
  const sets = [];
  for (const g of groups) { const ls = lots.filter(l => l.group === g.id); if (ls.length) sets.push({ id: g.id, lots: ls }); }
  for (const l of lots) if (!l.group) sets.push({ id: null, lots: [l] });
  sets.sort((a, b) => Math.min(...a.lots.map(l => l.n)) - Math.min(...b.lots.map(l => l.n)));
  const fences = sets.map((s, i) => ({ ...fenceOfLots(s.lots, lots.filter(l => !s.lots.includes(l)), base, frame.sr), group: s.id, letter: String.fromCharCode(65 + (i % 26)) }));
  for (const f of fences) for (const n of f.lots) lots[n - 1].fence = f.letter;
  return { lots, fences };
}
// Join lots (numbers) in one fence, or give them back their own fence
export function joinLots(ns, frame = siteFrame()) {
  const ctx = currentCtx(frame);
  if (!ctx) return false;
  const { lots } = fencesOf(frame, ctx.pre, ctx.base);
  const pick = lots.filter(l => ns.includes(l.n));
  if (pick.length < 2) { toast(t('infra.joinTwo'), 'err'); return false; }
  const pts = pick.map(l => toWgs(frame, l.label));
  change('infra', p => {
    p.infra.fenceGroups = dropLots(p.infra.fenceGroups, frame, pick).concat([{ id: uid(), points: pts }]);
  });
  return true;
}
export function separateLots(ns, frame = siteFrame()) {
  const ctx = currentCtx(frame);
  if (!ctx) return false;
  const { lots } = fencesOf(frame, ctx.pre, ctx.base);
  const pick = lots.filter(l => ns.includes(l.n));
  change('infra', p => { p.infra.fenceGroups = dropLots(p.infra.fenceGroups, frame, pick); });
  return true;
}
// the groups without the points that fall in the given lots; groups left with one point are dropped
function dropLots(groups, frame, lots) {
  const { Point, SpatialReference } = getSdk();
  return (groups || []).map(g => ({ ...g, points: g.points.filter(([lo, la]) => {
    const p = frame.toLocal(new Point({ x: lo, y: la, spatialReference: SpatialReference.WGS84 }));
    return !(p && lots.some(l => pointInRing([p.x, p.y], l.ring)));
  }) })).filter(g => g.points.length > 1);
}
function toWgs(frame, [x, y]) {
  const { Point, SpatialReference, projectOperator } = getSdk();
  const q = projectOperator.execute(new Point({ x, y, spatialReference: frame.sr }), SpatialReference.WGS84);
  return [q.x, q.y];
}
function toLocalPt(frame, lon, lat) {
  const { Point, SpatialReference } = getSdk();
  const p = frame.toLocal(new Point({ x: lon, y: lat, spatialReference: SpatialReference.WGS84 }));
  return p ? [p.x, p.y] : null;
}
// Road widths of the country: heavy (trucks) and light traffic
export function roadWidth(kind) { return val(`roads.${kind}.width`)?.value ?? null; }

// Everything computed for a frame: { lots, fences, band, road, roadLength, roads (drawn), stations, gates, notes }
export function layoutInfra(frame, pre, base = pre) {
  const P = store.project, I = P.infra;
  const out = { lots: [], fences: [], band: null, road: null, roadLength: 0, roads: [], stations: [], gates: [], notes: [] };
  if (!pre) return out;
  const { lots, fences } = fencesOf(frame, pre, base);
  out.lots = lots;
  const S = getSdk();
  // roads drawn by the designer: a strip of their width around the line
  const { Polyline } = S;
  for (const r of I.roads || []) {
    const pts = (r.geometry?.coordinates || []).map(([lo, la]) => toLocalPt(frame, lo, la)).filter(Boolean);
    if (pts.length < 2 || !(r.width > 0)) continue;
    const line = new Polyline({ paths: [pts], spatialReference: frame.sr });
    out.roads.push({ ...r, line, strip: S.bufferOperator.execute(line, r.width / 2), length: ringLength(pts) });
  }
  if (!I.fence || !fences.length) { stationsOf(frame, out, []); return out; }
  out.fences = fences;
  const c = clearances(P);
  if (c.clearance == null) out.notes.push(t('infra.noClearance', { country: countryName(crsState.iso) || '—' }));
  const bands = [], roads = [];
  for (const f of fences) {
    if (c.clearance > 0) bands.push(minus(f.polygon, shrink(f.polygon, c.clearance)));
    if (c.road && c.roadGap != null && c.roadWidth > 0) {
      roads.push(minus(shrink(f.polygon, c.roadGap), shrink(f.polygon, c.roadGap + c.roadWidth)));
      out.roadLength += perimeterOf(shrink(f.polygon, c.roadGap + c.roadWidth / 2));
    }
    if (f.lots.length > 1 && f.parts > 1) out.notes.push(t('infra.fenceParts', { lots: f.lots.join(', '), n: f.parts }));
  }
  const union = arr => { const a = arr.filter(g => g && g.rings && g.rings.length); return a.length > 1 ? S.unionOperator.executeMany(a) : a[0] || null; };
  out.band = union(bands);
  out.road = union(roads);
  const allRings = fences.flatMap(f => f.rings);
  // gates at the site accesses, on the nearest fence
  for (const a of P.features.filter(x => x.category === 'access' && x.attrs?.type !== 'grid-connection')) {
    const c0 = a.geometry.type === 'Point' ? a.geometry.coordinates : a.geometry.type === 'LineString' ? a.geometry.coordinates[0] : null;
    const p = c0 && toLocalPt(frame, c0[0], c0[1]);
    const n = p && nearestOnRings(allRings, p);
    if (n) out.gates.push({ id: a.id, name: a.name, point: n.point, dir: n.dir, dist: n.dist, width: gateWidth() });
  }
  stationsOf(frame, out, allRings);
  return out;
}
// stations: footprint, the area kept free around it, inside a fence or not, distance rules
function stationsOf(frame, out, allRings) {
  const { Polygon } = getSdk();
  const sc = stationClearance();
  for (const s of store.project.infra.stations) {
    const b = building(s.kind), p = toLocalPt(frame, s.lon, s.lat);
    if (!b || !p) continue;
    const footprint = new Polygon({ rings: [rectangle(p, b.length, b.width, s.rot || 0)], spatialReference: frame.sr });
    const cut = new Polygon({ rings: [rectangle(p, b.length, b.width, s.rot || 0, sc)], spatialReference: frame.sr });
    const inside = !allRings.length || allRings.some(r => pointInRing(p, r));
    out.stations.push({ ...s, center: p, building: b, footprint, cut, inside });
  }
  const cc = out.stations.find(s => s.kind === 'CC');
  for (const s of out.stations) {
    if (!s.inside) out.notes.push(t('infra.stationOutside', { kind: t('infra.kind.' + s.kind) }));
    if (s.kind === 'CU' && cc) {
      const max = s.building.maxDistanceToDelivery;
      const d = Math.hypot(s.center[0] - cc.center[0], s.center[1] - cc.center[1]);
      if (max && d > max) out.notes.push(t('infra.cuFar', { d: fmt(d, 0), max }));
    }
  }
}

// Cuts for the buildable area (areas.js): the fence band, the roads drawn by the designer and the stations
extraCuts.push((frame, ctx) => {
  if (!ctx) return null;
  const L = layoutInfra(frame, ctx.pre, ctx.base);
  const out = L.notes.map(note => ({ note }));
  if (L.band) out.push({ geometry: L.band, kind: 'fence', label: t('infra.fenceBand') });
  for (const r of L.roads) out.push({ geometry: r.strip, kind: 'road', label: t('infra.roadDrawn') });
  for (const s of L.stations) out.push({ geometry: s.cut, kind: 'station', label: t('infra.kind.' + s.kind) });
  return out;
});

// ── stations ──
// Where a station goes for a clicked point (local): flush with the nearest fence and along it when the point is
// within SNAP metres of a fence, else where clicked, along the rows. { center, rot, snapped }
export function snapStation(kind, p, frame = siteFrame()) {
  const b = building(kind), ctx = frame && currentCtx(frame);
  const rings = ctx ? fencesOf(frame, ctx.pre, ctx.base).fences.flatMap(f => f.rings) : [];
  const n = rings.length && store.project.infra.fence ? nearestOnRings(rings, p) : null;
  if (!b || !n || n.dist > SNAP) return { center: p, rot: rowAngle(), snapped: false };
  let nx = -n.dir[1], ny = n.dir[0];
  if (!rings.some(r => pointInRing([n.point[0] + nx * 0.5, n.point[1] + ny * 0.5], r))) { nx = -nx; ny = -ny; }
  return { center: [n.point[0] + nx * b.width / 2, n.point[1] + ny * b.width / 2], rot: Math.atan2(n.dir[1], n.dir[0]) * 180 / Math.PI, snapped: true };
}
export function addStation(kind, lon, lat, rot = null, { snap = true } = {}) {
  if (!building(kind)) { toast(t('infra.noBuilding', { kind: t('infra.kind.' + kind), country: countryName(crsState.iso) || '—' }), 'err'); return null; }
  const frame = siteFrame();
  let s = { id: uid(), kind, lon, lat, rot: rot ?? rowAngle() };
  if (snap && frame && rot == null) {
    const q = snapStation(kind, toLocalPt(frame, lon, lat), frame);
    const [x, y] = toWgs(frame, q.center);
    s = { ...s, lon: x, lat: y, rot: q.rot };
  }
  change('infra', p => { p.infra.stations.push(s); });
  return s;
}
// Move a station to a clicked point, with the same snapping to the fence
export function moveStation(id, lon, lat) {
  const s0 = store.project.infra.stations.find(x => x.id === id), frame = siteFrame();
  if (!s0 || !frame) return null;
  const q = snapStation(s0.kind, toLocalPt(frame, lon, lat), frame);
  const [x, y] = toWgs(frame, q.center);
  change('infra', p => { const s = p.infra.stations.find(z => z.id === id); if (s) Object.assign(s, { lon: x, lat: y, rot: q.snapped ? q.rot : s.rot }); });
  return store.project.infra.stations.find(z => z.id === id);
}
// long side of the stations along the rows by default
function rowAngle() {
  const A = store.project.field.azimuthDeg ?? 180;
  return Math.atan2(Math.sin(A * Math.PI / 180), -Math.cos(A * Math.PI / 180)) * 180 / Math.PI;
}
// Delivery station at the site access, flush with the fence, and the user station next to it (toolkit: at the
// entrance; user station within 20 m of the delivery station)
export function placeAtAccess() {
  const frame = siteFrame();
  const a = frame && store.project.features.find(x => x.category === 'access' && x.attrs?.type !== 'grid-connection' && x.geometry.type === 'Point');
  if (!a) { toast(t('infra.noAccess'), 'err'); return false; }
  const ctx = currentCtx(frame);
  const rings = ctx ? fencesOf(frame, ctx.pre, ctx.base).fences.flatMap(f => f.rings) : [];
  const bcc = building('CC'), bcu = building('CU');
  if (!rings.length || !bcc) { toast(t('infra.noBuilding', { kind: t('infra.kind.CC'), country: countryName(crsState.iso) || '—' }), 'err'); return false; }
  const p0 = toLocalPt(frame, a.geometry.coordinates[0], a.geometry.coordinates[1]);
  const n = nearestOnRings(rings, p0);
  let nx = -n.dir[1], ny = n.dir[0];
  if (!rings.some(r => pointInRing([n.point[0] + nx * 0.5, n.point[1] + ny * 0.5], r))) { nx = -nx; ny = -ny; }
  const rot = Math.atan2(n.dir[1], n.dir[0]) * 180 / Math.PI;
  const cc = [n.point[0] + nx * bcc.width / 2, n.point[1] + ny * bcc.width / 2];
  const list = [{ id: uid(), kind: 'CC', lon: toWgs(frame, cc)[0], lat: toWgs(frame, cc)[1], rot }];
  if (bcu) {
    const step = bcc.length / 2 + stationClearance() + bcu.length / 2;
    let cu = [cc[0] + n.dir[0] * step, cc[1] + n.dir[1] * step];
    if (!rings.some(r => pointInRing(cu, r))) cu = [cc[0] - n.dir[0] * step, cc[1] - n.dir[1] * step];
    const w = toWgs(frame, cu);
    list.push({ id: uid(), kind: 'CU', lon: w[0], lat: w[1], rot });
  }
  change('infra', p => { p.infra.stations = p.infra.stations.filter(s => s.kind !== 'CC' && s.kind !== 'CU').concat(list); });
  return true;
}
function currentCtx(frame) {
  const r = computeArea(frame);
  return r && !r.error ? { pre: r.pre, base: r.base } : null;
}

// ── roads drawn by the designer ──
// coordinates: [[lon, lat], …]; kind 'heavy' | 'light' sets the width from the toolkit, width overrides it
export function addRoad(coordinates, kind = 'heavy', width = null) {
  const w = width ?? roadWidth(kind);
  if (!(w > 0)) { toast(t('infra.noRoadWidth', { country: countryName(crsState.iso) || '—' }), 'err'); return null; }
  const r = { id: uid(), kind, width: w, geometry: { type: 'LineString', coordinates } };
  change('infra', p => { p.infra.roads = [...(p.infra.roads || []), r]; });
  return r;
}
export function updateRoad(id, coordinates) {
  change('infra', p => { const r = (p.infra.roads || []).find(x => x.id === id); if (r) r.geometry = { type: 'LineString', coordinates }; });
}
export function removeRoad(id) { change('infra', p => { p.infra.roads = (p.infra.roads || []).filter(x => x.id !== id); }); }

// ── map ──
const GREY = [150, 150, 150];
function draw(frame, L) {
  if (!layer) return;
  const { Graphic, projectOperator, Polyline, Point } = getSdk();
  layer.removeAll();
  if (!frame) return;
  const to = g => projectOperator.execute(g, view.spatialReference);
  const out = [];
  const roadSym = a => ({ type: 'simple-fill', color: [...GREY, a], outline: { color: [120, 120, 120, 0.8], width: 0.5 } });
  if (L.road) out.push(new Graphic({ geometry: to(L.road), symbol: roadSym(0.55) }));
  for (const r of last.result?.roads || []) out.push(new Graphic({ geometry: to(r), symbol: roadSym(0.45) }));
  for (const r of L.roads) {
    out.push(new Graphic({ geometry: to(r.strip), symbol: roadSym(0.6), attributes: { road: r.id } }));
    out.push(new Graphic({ geometry: to(r.line), symbol: { type: 'simple-line', color: [90, 90, 90, 0.9], width: 1, style: 'dash' }, attributes: { road: r.id } }));
  }
  for (const f of L.fences) out.push(new Graphic({ geometry: to(new Polyline({ paths: f.rings, spatialReference: frame.sr })),
    symbol: { type: 'simple-line', color: [60, 60, 60], width: 2, style: 'short-dash-dot' } }));
  for (const s of L.stations) {
    const c = STATION_COLOUR[s.kind];
    out.push(new Graphic({ geometry: to(s.cut), symbol: { type: 'simple-fill', color: [...c, 0.1], outline: { color: [...c, 0.8], width: 1, style: 'dash' } } }));
    out.push(new Graphic({ geometry: to(s.footprint), symbol: { type: 'simple-fill', color: [...c, 0.85], outline: { color: [255, 255, 255], width: s.id === moving ? 3 : 1 } } }));
  }
  for (const g of L.gates) out.push(new Graphic({ geometry: to(new Point({ x: g.point[0], y: g.point[1], spatialReference: frame.sr })),
    symbol: { type: 'simple-marker', style: 'square', size: 11, color: [30, 30, 30], outline: { color: [255, 255, 255], width: 1.5 } } }));
  // lot numbers (with the letter of their fence when lots share one)
  const shared = new Set(L.fences.filter(f => f.lots.length > 1).map(f => f.letter));
  for (const l of L.lots) out.push(new Graphic({ geometry: to(new Point({ x: l.label[0], y: l.label[1], spatialReference: frame.sr })),
    symbol: { type: 'text', text: shared.has(l.fence) ? `${l.n} · ${l.fence}` : String(l.n), color: [255, 255, 255], haloColor: [20, 30, 40], haloSize: 1.5,
      font: { size: 13, weight: 'bold' } } }));
  layer.addMany(out.filter(g => g.geometry));
}

// ── panel ──
const selectedLots = new Set();
function render() {
  if (!$('infFence')) return;
  const P = store.project, I = P.infra, frame = siteFrame();
  const ctx = frame ? currentCtx(frame) : null;
  const L = frame && ctx ? layoutInfra(frame, ctx.pre, ctx.base) : { lots: [], fences: [], roads: [], stations: [], gates: [], notes: [] };
  const c = clearances(P), country = countryName(crsState.iso) || '—';
  const r = last.result;
  $('infFence').checked = !!I.fence;
  $('infClear').value = I.clearance ?? '';
  $('infClear').placeholder = c.toolkit != null ? `${fmt(c.toolkit, 1)} (${t('infra.toolkit')})` : '';
  $('infClearHint').textContent = c.toolkit != null
    ? t(c.road ? 'infra.clearWithRoad' : 'infra.clearNoRoad', { m: fmt(c.toolkit, 1), country })
    : t('infra.noClearance', { country });
  const fenceLen = L.fences.reduce((s, f) => s + f.length, 0);
  infraState.fenceLength = fenceLen; infraState.fences = L.fences.length;
  $('infFenceInfo').innerHTML = L.fences.length
    ? `<div class="ledger"><div class="r"><span>${esc(t('infra.fenceLength'))}</span><b>${fmt(fenceLen, 0)} m</b></div>`
      + (L.fences.length > 1 ? `<div class="r"><span>${esc(t('infra.fenceCount'))}</span><b>${fmt(L.fences.length)}</b></div>` : '') + `</div>`
    : `<div class="hint">${esc(t(I.fence ? 'infra.noSite' : 'infra.fenceOff'))}</div>`;
  // lots and their fences
  for (const n of [...selectedLots]) if (!L.lots.some(l => l.n === n)) selectedLots.delete(n);
  $('infLots').innerHTML = L.lots.length > 1 ? L.lots.map(l => `<label class="it lot"><input type="checkbox" data-lot="${l.n}" ${selectedLots.has(l.n) ? 'checked' : ''}>
      <span class="nm">${esc(t('infra.lot', { n: l.n }))}<small>${esc(t('infra.lotInfo', { ha: fmt(l.area / 1e4, 2), fence: l.fence }))}</small></span></label>`).join('') : '';
  $('infLotsBox').hidden = L.lots.length < 2 || !I.fence;
  $('infLotsHint').textContent = L.lots.length > 1 ? t('infra.lotsHint', { n: L.lots.length, fences: L.fences.length }) : '';
  // perimeter road and its suggestion
  $('infRoad').checked = !!I.perimeterRoad;
  const sug = suggestedRoad(r?.dcMWp), std = standardFor('perimeterRoad');
  let html = L.road ? `<div class="hint">${esc(t('infra.roadInfo', { len: fmt(L.roadLength, 0), w: fmt(c.roadWidth, 1), gap: fmt(c.roadGap, 1) }))}</div>` : '';
  if (sug != null) {
    const same = sug === !!I.perimeterRoad;
    html += `<div class="${same ? 'hint' : 'warn'}">${esc(t(sug ? 'infra.roadSugOn' : 'infra.roadSugOff', { mwp: fmt(r.dcMWp, 2), max: std.suggestedUpToMWp }))}
      ${same ? '' : ` <button type="button" class="linkbtn" id="infRoadApply">${esc(t('infra.apply'))}</button>`}</div>`;
  } else html += `<div class="hint">${esc(t('infra.roadSugNone', { max: std?.suggestedUpToMWp ?? 9 }))}</div>`;
  if (I.perimeterRoad && (c.roadGap == null || !(c.roadWidth > 0))) html += `<div class="warn">${esc(t('infra.noRoadValues', { country }))}</div>`;
  $('infRoadInfo').innerHTML = html;
  const ap = $('infRoadApply');
  if (ap) ap.onclick = () => change('infra', p => { p.infra.perimeterRoad = sug; });
  // roads: from the corridors, and drawn
  const auto = r?.roads || [];
  $('infRoads').innerHTML = auto.length
    ? `<div class="hint">${esc(t('infra.roadsInfo', { n: auto.length, len: fmt(r.roadsLength, 0), w: fmt(P.field.tracks.width, 1) }))}</div>`
    : `<div class="hint">${esc(t('infra.roadsNone'))}</div>`;
  for (const k of ['heavy', 'light']) {
    const w = roadWidth(k), o = $('infRoadKind').querySelector(`option[value=${k}]`);
    if (o) o.textContent = t('infra.roadKind.' + k, { w: w != null ? fmt(w, 1) + ' m' : '—' });
  }
  $('infRoadList').innerHTML = '';
  for (const rd of L.roads) {
    const row = document.createElement('div');
    row.className = 'it';
    row.innerHTML = `<span class="sw" style="background:rgb(${GREY.join(',')})"></span><span class="nm"></span>
      <button type="button" class="x" data-redit="${rd.id}" title="${esc(t('infra.editRoad'))}" aria-label="${esc(t('infra.editRoad'))}">${icon('pen')}</button>
      <button type="button" class="x" data-rdel="${rd.id}" title="${esc(t('areas.remove'))}" aria-label="${esc(t('areas.remove'))}">${icon('close')}</button>`;
    row.querySelector('.nm').textContent = t('infra.roadRow', { kind: t('infra.roadKindShort.' + rd.kind), len: fmt(rd.length, 0), w: fmt(rd.width, 1) });
    $('infRoadList').appendChild(row);
  }
  // gates
  $('infGates').innerHTML = L.gates.length
    ? L.gates.map(g => `<div class="hint">${esc(t('infra.gate', { name: g.name, w: g.width != null ? fmt(g.width, 1) + ' m' : '—', d: fmt(g.dist, 0) }))}</div>`).join('')
    : `<div class="hint">${esc(t('infra.gatesNone'))}</div>`;
  // stations
  $('infStations').innerHTML = '';
  for (const s of L.stations) {
    const row = document.createElement('div');
    row.className = 'it' + (s.id === moving ? ' moving' : '');
    row.innerHTML = `<span class="sw" style="background:rgb(${STATION_COLOUR[s.kind].join(',')})"></span><span class="nm"></span>
      <button type="button" class="x" data-move="${s.id}" title="${esc(t('infra.move'))}" aria-label="${esc(t('infra.move'))}">${icon('cursor')}</button>
      <button type="button" class="x" data-rot="${s.id}" title="${esc(t('infra.rotate'))}" aria-label="${esc(t('infra.rotate'))}">${icon('refresh')}</button>
      <button type="button" class="x" data-del="${s.id}" title="${esc(t('areas.remove'))}" aria-label="${esc(t('areas.remove'))}">${icon('close')}</button>`;
    const nm = row.querySelector('.nm');
    nm.textContent = t('infra.kind.' + s.kind);
    const sm = document.createElement('small');
    sm.textContent = `${fmt(s.building.length, 2)} × ${fmt(s.building.width, 2)} m · ${s.building.id}${s.inside ? '' : ' · ' + t('infra.outside')}`;
    nm.appendChild(sm);
    $('infStations').appendChild(row);
  }
  const nCT = L.stations.filter(s => s.kind === 'CT').length;
  const per = getCatalog()?.countries?.[crsState.iso]?.stationRules?.find(x => x.id === 'transformer-stations-per-mwp')?.value ?? 3;
  $('infStationsHint').textContent = [
    r?.dcMWp > 0 ? t('infra.ctHint', { n: Math.ceil(r.dcMWp / per), per, mwp: fmt(r.dcMWp, 1), placed: nCT }) : '',
    building('CT') ? t('infra.stationClear', { m: fmt(stationClearance(), 1) }) + ' ' + t('infra.snapHint', { m: SNAP }) : t('infra.noBuilding', { kind: t('infra.kind.CT'), country }),
  ].filter(Boolean).join(' ');
  for (const k of ['CC', 'CU', 'CT']) $('inf' + k).disabled = !building(k);
  draw(frame, L);
}

// one map mode at a time: placing a station, moving one, drawing or reshaping a road
let moving = null, sketchVM = null, sketchLayer = null, editingRoad = null;
function banner(html) { const b = $('banner'); if (b) { if (html) { b.innerHTML = html; b.hidden = false; } else b.hidden = true; } }
function stopModes() {
  placing = null; moving = null;
  if (sketchVM && (sketchVM.state === 'active')) sketchVM.cancel();
  editingRoad = null;
  document.querySelectorAll('#side [data-place], #infRoadDraw').forEach(b => b.classList.remove('active'));
  banner(null);
}
function startPlacing(kind) {
  const again = placing === kind;
  stopModes();
  if (again) return;
  placing = kind;
  document.querySelectorAll('#side [data-place]').forEach(b => b.classList.toggle('active', b.dataset.place === placing));
  banner(t('infra.placeBanner', { kind: esc(t('infra.kind.' + kind)), m: SNAP }));
}
function startMoving(id) {
  const again = moving === id;
  stopModes();
  if (again) { renderSoon(); return; }
  moving = id;
  const s = store.project.infra.stations.find(x => x.id === id);
  banner(t('infra.moveBanner', { kind: esc(t('infra.kind.' + (s?.kind || 'CT'))), m: SNAP }));
  renderSoon();
}
function startRoad() {
  const again = sketchVM && sketchVM.state === 'active' && !editingRoad;
  stopModes();
  if (again || !sketchVM) return;
  const w = roadWidth($('infRoadKind').value);
  if (!(w > 0)) { toast(t('infra.noRoadWidth', { country: countryName(crsState.iso) || '—' }), 'err'); return; }
  sketchVM.polylineSymbol = { type: 'simple-line', color: [90, 90, 90], width: 3 };
  sketchVM.create('polyline', { mode: 'click' });
  $('infRoadDraw').classList.add('active');
  banner(t('infra.roadBanner'));
}
function editRoad(id) {
  stopModes();
  const frame = siteFrame(), rd = (store.project.infra.roads || []).find(x => x.id === id);
  if (!sketchVM || !frame || !rd) return;
  const { Graphic, Polyline, SpatialReference, projectOperator } = getSdk();
  const g = new Graphic({ geometry: projectOperator.execute(new Polyline({ paths: [rd.geometry.coordinates], spatialReference: SpatialReference.WGS84 }), view.spatialReference),
    symbol: { type: 'simple-line', color: [90, 90, 90], width: 3 } });
  sketchLayer.add(g);
  editingRoad = id;
  sketchVM.update(g, { tool: 'reshape' });
  banner(t('infra.roadEditBanner'));
}
const lineCoords = geom => { const { projectOperator, SpatialReference } = getSdk(); const g = projectOperator.execute(geom, SpatialReference.WGS84); return g && g.paths && g.paths[0] ? g.paths[0].map(p => [p[0], p[1]]) : null; };

export function initInfra(mapView) {
  view = mapView;
  const { GraphicsLayer, SketchViewModel } = getSdk();
  layer = new GraphicsLayer({ title: 'Infrastructure', listMode: 'hide' });
  sketchLayer = new GraphicsLayer({ title: 'Infrastructure sketch', listMode: 'hide' });
  view.map.addMany([layer, sketchLayer]);
  try {
    sketchVM = new SketchViewModel({ view, layer: sketchLayer, updateOnGraphicClick: false });
    try { sketchVM.snappingOptions = { enabled: true, featureSources: [{ layer, enabled: true }] }; } catch {}
    sketchVM.on('create', e => {
      if (e.state === 'complete') {
        const c = lineCoords(e.graphic.geometry);
        sketchLayer.remove(e.graphic);
        if (c && c.length > 1) addRoad(c, $('infRoadKind').value);
        stopModes();
      } else if (e.state === 'cancel') stopModes();
    });
    sketchVM.on('update', e => {
      if (e.state !== 'complete' || !editingRoad) return;
      const id = editingRoad, gr = e.graphics && e.graphics[0];
      const c = gr && !e.aborted ? lineCoords(gr.geometry) : null;
      if (gr) sketchLayer.remove(gr);
      editingRoad = null;
      banner(null);
      if (c && c.length > 1) updateRoad(id, c); else renderSoon();
    });
  } catch (e) { console.warn('[infra] sketch', e); }
  $('infFence').onchange = () => change('infra', p => { p.infra.fence = $('infFence').checked; });
  $('infClear').onchange = () => change('infra', p => { const v = $('infClear').value; p.infra.clearance = v === '' ? null : Math.max(0, Number(v) || 0); });
  $('infRoad').onchange = () => change('infra', p => { p.infra.perimeterRoad = $('infRoad').checked; });
  $('infLots').onchange = e => { const cb = e.target.closest('[data-lot]'); if (cb) { const n = Number(cb.dataset.lot); if (cb.checked) selectedLots.add(n); else selectedLots.delete(n); } };
  $('infJoin').onclick = () => { if (joinLots([...selectedLots])) selectedLots.clear(); };
  $('infSeparate').onclick = () => { if (selectedLots.size && separateLots([...selectedLots])) selectedLots.clear(); };
  for (const k of ['CC', 'CU', 'CT']) { $('inf' + k).dataset.place = k; $('inf' + k).onclick = () => startPlacing(k); }
  $('infAtAccess').onclick = () => placeAtAccess();
  $('infRoadDraw').onclick = () => startRoad();
  $('infRoadList').onclick = e => {
    const d = e.target.closest('[data-rdel]'), ed = e.target.closest('[data-redit]');
    if (d) removeRoad(d.dataset.rdel);
    if (ed) editRoad(ed.dataset.redit);
  };
  $('infStations').onclick = e => {
    const d = e.target.closest('[data-del]'), r = e.target.closest('[data-rot]'), m = e.target.closest('[data-move]');
    if (d) change('infra', p => { p.infra.stations = p.infra.stations.filter(s => s.id !== d.dataset.del); });
    if (r) change('infra', p => { const s = p.infra.stations.find(x => x.id === r.dataset.rot); if (s) s.rot = ((s.rot || 0) + 90) % 360; });
    if (m) startMoving(m.dataset.move);
  };
  clickHandle = view.on('click', e => {
    if ((!placing && !moving) || !e.mapPoint) return;
    e.stopPropagation?.();
    const { projectOperator, SpatialReference } = getSdk();
    const q = projectOperator.execute(e.mapPoint, SpatialReference.WGS84);
    if (moving) { moveStation(moving, q.x, q.y); stopModes(); return; }
    addStation(placing, q.x, q.y);
    if (placing !== 'CT') stopModes();   // one delivery / user station; transformer stations until Esc
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (placing || moving || editingRoad || sketchVM?.state === 'active')) { stopModes(); renderSoon(); } });
  for (const topic of ['infra', 'site', 'settings', 'project', 'crs', 'layout', 'terrain']) on(topic, () => renderSoon());
  // the rail: locked without a site, done once the layout has its fence (figure: its length)
  stepProvider('infra', () => {
    if (!siteFrame()) return { state: 'locked', reason: t('gate.needSite') };
    return last.result?.tables && store.project.infra.fence && infraState.fences ? { state: 'done', figure: `${fmt(infraState.fenceLength, 0)} m` } : { state: 'ready' };
  });
  render();
}
let tm = 0;
function renderSoon() { clearTimeout(tm); tm = setTimeout(render, 60); }
export function renderInfraNow() { clearTimeout(tm); render(); }
