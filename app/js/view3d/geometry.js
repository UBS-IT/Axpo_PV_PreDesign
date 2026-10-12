// Geometry of the 3D view, in the local metric frame of the site (x east, y north, z elevation in metres): heights of
// the structures from the toolkit of the country (or typed in by the designer), ground elevations from the terrain
// of step 0 or from Esri World Elevation, and the vertices of tables, trackers, stations, fences and terrain. The
// scene (scene.js) projects them with the SDK; the glTF export (glb.js) keeps them local.
import { getSdk } from '../sdk.js';
import { store } from '../state.js';
import { countryValue, standardFor } from '../catalog.js';
import { crsState } from '../areas.js';
import { makeLocalFrame } from '../geo/localframe.js';
import { terrainData } from '../terrain/store.js';
import { bilinear } from '../terrain/slope.js';
import { axisFrame, trackerAngle, sunPosition } from './sun.js';

const ESRI_ELEVATION = 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';
const D = Math.PI / 180;

// ── heights ──
// { tracker, lowEdge: { value, source } | null, axis: { value, source, category } | null, maxRotation, fence, missing }
// missing: the height the view needs and neither the toolkit of the country nor the designer gives
export function heights3d(P = store.project, iso = crsState.iso) {
  const v = P.view3d, f = P.field, tracker = f.technology === 'agri-tracker';
  const out = { tracker, lowEdge: null, axis: null, missing: null,
    maxRotation: countryValue(iso, 'tracker.rotationDeg')?.value ?? standardFor('agri-tracker')?.rotationDeg ?? null,
    fence: P.infra?.fenceHeight > 0 ? P.infra.fenceHeight : countryValue(iso, 'fence.height')?.value ?? null };   // typed in the ribbon, else the toolkit
  if (tracker) {
    const ah = countryValue(iso, 'tracker.axisHeights')?.value;
    if (v.axisHeight > 0) out.axis = { value: v.axisHeight, source: 'custom', category: null };
    else if (ah?.[v.trackerCategory] > 0) out.axis = { value: ah[v.trackerCategory], source: ah.source, category: v.trackerCategory };
    else out.missing = 'axis';
  } else {
    // the toolkit low edge is the one of ground-mounted structures; AgriPV fixed structures are higher: typed in
    const le = f.technology === 'ground-fixed' ? countryValue(iso, 'fixed.lowEdgeHeight') : null;
    if (v.lowEdge > 0) out.lowEdge = { value: v.lowEdge, source: 'custom' };
    else if (le?.value > 0) out.lowEdge = { value: le.value, source: le.source };
    else out.missing = 'lowEdge';
  }
  return out;
}

// ── ground ──
// Elevations at local points [[x, y], …] of the frame: bilinear on the terrain grid of step 0 where it covers them,
// Esri World Elevation elsewhere (query(wgsPoints) -> elevations, injectable for the tests; null = no Esri).
// Float64Array, NaN where nothing is known.
export async function groundAt(frame, pts, { query = esriQuery } = {}) {
  const z = new Float64Array(pts.length).fill(NaN);
  const meta = terrainData.meta, grid = terrainData.z;
  if (meta && grid) {
    let q = pts;
    if (Math.abs(meta.lon0 - frame.lon0) > 1e-9 || Math.abs(meta.lat0 - frame.lat0) > 1e-9) {
      const { Multipoint, projectOperator } = getSdk();
      q = projectOperator.execute(new Multipoint({ points: pts, spatialReference: frame.sr }), makeLocalFrame(meta).sr).points;
    }
    q.forEach(([x, y], i) => { z[i] = bilinear(grid, meta.nx, meta.ny, (x - meta.x0) / meta.cell - 0.5, (y - meta.y0) / meta.cell - 0.5); });
  }
  const miss = [];
  z.forEach((v, i) => { if (!Number.isFinite(v)) miss.push(i); });
  if (miss.length && query) {
    const { Multipoint, SpatialReference, projectOperator } = getSdk();
    const wgs = projectOperator.execute(new Multipoint({ points: miss.map(i => pts[i]), spatialReference: frame.sr }), SpatialReference.WGS84).points;
    try {
      const got = await query(wgs);
      miss.forEach((k, i) => { const v = got[i]; z[k] = Number.isFinite(v) && v !== -99999 ? v : NaN; });
    } catch (e) { console.warn('[3d] ground elevations not available', e); }
  }
  return z;
}
let esriLayer = null;
async function esriQuery(wgs) {
  const { ElevationLayer, Multipoint, SpatialReference } = getSdk();
  if (!esriLayer) { esriLayer = new ElevationLayer({ url: ESRI_ELEVATION }); await esriLayer.load(); }
  const out = [];
  for (let s = 0; s < wgs.length; s += 5000) {
    const r = await esriLayer.queryElevation(new Multipoint({ points: wgs.slice(s, s + 5000), spatialReference: SpatialReference.WGS84 }),
      { demResolution: 'finest-contiguous', noDataValue: -99999 });
    out.push(...r.geometry.points.map(p => p[2]));
  }
  return out;
}
// unknown elevations take the mean of the known ones (flat where nothing is known); the count is returned
export function fillGaps(z) {
  let s = 0, n = 0;
  for (const v of z) if (Number.isFinite(v)) { s += v; n++; }
  const m = n ? s / n : 0;
  let gaps = 0;
  for (let i = 0; i < z.length; i++) if (!Number.isFinite(z[i])) { z[i] = m; gaps++; }
  return gaps;
}

// ── tables and trackers ──
// Axis azimuth of the trackers of a layout: along the tables, pointing to the southern half (pvlib convention)
export function axisAzimuth(tables) {
  const c = tables[0]?.corners;
  if (!c) return 180;
  let az = Math.atan2(c[1][0] - c[0][0], c[1][1] - c[0][1]) / D;
  az = ((az % 360) + 360) % 360;
  return az > 90 && az <= 270 ? az : (az + 180) % 360;
}
// Tracker angle for the view: following the sun at `date` (site at lon, lat) or the angle set by hand
export function trackerAngleFor(P, tables, date, lon, lat, maxRotation) {
  if (P.view3d.trackerMode === 'manual') return Math.max(-maxRotation, Math.min(maxRotation, P.view3d.trackerAngle || 0));
  return trackerAngle(sunPosition(date, lat, lon).vector, axisAzimuth(tables), maxRotation);
}

// The corners of the tables, 4 per table, for the ground query
export const tableCorners = tables => tables.flatMap(t => t.corners);

// Module surfaces: { positions: Float64Array [x, y, z …], faces: Uint32Array } — 4 vertices and 2 triangles per table.
// Fixed: low edge (corners 0-1, towards the facing direction) at lowEdge above the ground under it, high edge
// raised by depth × tan(tilt), each corner on its own ground as the piles follow the terrain. Trackers: the axis runs
// along the table at axisHeight above the ground of each end, the modules turned by angleDeg (pvlib sign).
// ground: elevations of the corners (tableCorners order).
export function tableMesh(tables, ground, { tracker, tiltDeg = 0, lowEdge = 0, axisHeight = 0, angleDeg = 0 }) {
  const pos = new Float64Array(tables.length * 12), faces = new Uint32Array(tables.length * 6);
  const axisAz = tracker ? axisAzimuth(tables) : 0, { right } = axisFrame(axisAz);
  const th = angleDeg * D, rise = Math.tan(tiltDeg * D);
  tables.forEach((t, k) => {
    const c = t.corners, g = [0, 1, 2, 3].map(i => ground[4 * k + i]);
    let v;
    if (!tracker) {
      const depth = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]);
      v = c.map(([x, y], i) => [x, y, g[i] + lowEdge + (i >= 2 ? depth * rise : 0)]);
    } else {
      // ends of the axis: middle of the short sides (0-3 and 1-2), on the ground under them
      const ends = [[0, 3], [1, 2]].map(([a, b]) => [(c[a][0] + c[b][0]) / 2, (c[a][1] + c[b][1]) / 2, (g[a] + g[b]) / 2 + axisHeight]);
      const w = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]) / 2;
      const dx = w * Math.cos(th) * right[0], dy = w * Math.cos(th) * right[1], dz = -w * Math.sin(th);
      // the right-hand edge goes down when the modules turn towards the right (positive angle)
      v = [[ends[0][0] - dx, ends[0][1] - dy, ends[0][2] - dz], [ends[1][0] - dx, ends[1][1] - dy, ends[1][2] - dz],
        [ends[1][0] + dx, ends[1][1] + dy, ends[1][2] + dz], [ends[0][0] + dx, ends[0][1] + dy, ends[0][2] + dz]];
    }
    v.forEach((p, i) => pos.set(p, 12 * k + 3 * i));
    faces.set([4 * k, 4 * k + 1, 4 * k + 2, 4 * k, 4 * k + 2, 4 * k + 3], 6 * k);
  });
  return { positions: pos, faces };
}

// ── boxes, walls, terrain ──
// A box on a plan ring (4 corners, local) from base to base + height: 8 vertices, 12 triangles
export function boxMesh(ring, base, height) {
  const r = ring.length > 4 ? ring.slice(0, 4) : ring;
  const pos = new Float64Array(24);
  r.forEach(([x, y], i) => { pos.set([x, y, base], 3 * i); pos.set([x, y, base + height], 12 + 3 * i); });
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; f.push(i, j, 4 + j, i, 4 + j, 4 + i); }
  return { positions: pos, faces: Uint32Array.from(f) };
}
// A vertical wall along a path from the ground (elevations per vertex) up to height: 2 vertices per point
export function wallMesh(path, ground, height) {
  const pos = new Float64Array(path.length * 6), faces = [];
  path.forEach(([x, y], i) => { pos.set([x, y, ground[i]], 6 * i); pos.set([x, y, ground[i] + height], 6 * i + 3); });
  for (let i = 0; i + 1 < path.length; i++) { const a = 2 * i; faces.push(a, a + 2, a + 3, a, a + 3, a + 1); }
  return { positions: pos, faces: Uint32Array.from(faces) };
}
// The terrain grid of step 0 inside a local box: a triangulated surface (cells with unknown corners are left out)
export function terrainMesh(box) {
  const meta = terrainData.meta, z = terrainData.z;
  if (!meta || !z) return null;
  const i0 = Math.max(0, Math.floor((box.xmin - meta.x0) / meta.cell)), i1 = Math.min(meta.nx - 1, Math.ceil((box.xmax - meta.x0) / meta.cell));
  const j0 = Math.max(0, Math.floor((box.ymin - meta.y0) / meta.cell)), j1 = Math.min(meta.ny - 1, Math.ceil((box.ymax - meta.y0) / meta.cell));
  if (i1 <= i0 || j1 <= j0) return null;
  const w = i1 - i0 + 1, h = j1 - j0 + 1, pos = new Float64Array(w * h * 3), faces = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    pos.set([meta.x0 + (i0 + i + 0.5) * meta.cell, meta.y0 + (j0 + j + 0.5) * meta.cell, z[(j0 + j) * meta.nx + i0 + i]], 3 * (j * w + i));
  }
  const ok = k => Number.isFinite(pos[3 * k + 2]);
  for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
    const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
    if (ok(a) && ok(b) && ok(c) && ok(d)) faces.push(a, b, d, a, d, c);
  }
  return faces.length ? { positions: pos, faces: Uint32Array.from(faces) } : null;
}
