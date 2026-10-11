// What goes to Engineering (Shapefile, DXF, Excel bill of quantities): every object of the project in the national
// coordinate system chosen in 4 · Output, with its attributes. Lengths and areas are measured before the projection,
// in the local frame of the site (true ground metres), never in the national grid.
import { getSdk } from '../sdk.js';
import { store } from '../state.js';
import { last } from '../field.js';
import { siteFrame } from '../areas.js';
import { layoutInfra } from '../infra.js';
import { toSdk } from '../geo/convert.js';
import { classified } from '../categories.js';
import { allDimensionParts } from '../dims.js';
import { terrainContours } from '../terrain/terrain.js';

// DXF layers: the defaults of the app, until Engineering gives its names (plan B3). [name, AutoCAD colour index]
export const DXF_LAYERS = {
  dimension: ['PVP_DIM', 2],
  'area-gross': ['PVP_AREA_GROSS', 30], 'area-net': ['PVP_AREA_NET', 3], 'area-connection': ['PVP_AREA_CONNECTION', 200],
  'area-exclusion': ['PVP_AREA_EXCLUSION', 1], 'area-linear': ['PVP_AREA_LINEAR', 6], 'area-obstacle': ['PVP_AREA_OBSTACLE', 34],
  'area-access': ['PVP_AREA_ACCESS', 4], 'area-mitigation': ['PVP_AREA_MITIGATION', 82], 'area-agri': ['PVP_AREA_AGRI', 50],
  'area-reference': ['PVP_AREA_REFERENCE', 8], buildable: ['PVP_BUILDABLE', 92], tables: ['PVP_TABLES', 5], 'tables-half': ['PVP_TABLES_HALF', 150],
  fence: ['PVP_FENCE', 7], 'road-perimeter': ['PVP_ROAD_PERIMETER', 9], 'road-internal': ['PVP_ROAD_INTERNAL', 9], 'road-drawn': ['PVP_ROAD_DRAWN', 9],
  'road-axis': ['PVP_ROAD_AXIS', 253], station: ['PVP_STATION', 40], gate: ['PVP_GATE', 7], text: ['PVP_TEXT', 7], contour: ['PVP_CONTOURS', 33],
};

const round = (v, d = 2) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// { wkid, sr, items: [{ layer, file, geometry (SDK, national system), attrs, label? }], result, infra, frame } or
// { error: 'noCrs' | 'nothing' }
export function exportModel() {
  const P = store.project, r = last.result;
  if (!P.crs.wkid) return { error: 'noCrs' };
  const S = getSdk();
  const target = new S.SpatialReference({ wkid: P.crs.wkid });
  const local = [], wgs = [];   // [geometry, meta] to project from the local frame / from WGS 84
  // 1 · Areas, as drawn or imported (with their buffers and attributes)
  for (const f of classified(P.features)) {   // objects without a category stay in the app
    const g = toSdk(f.geometry);
    if (!g) continue;
    const a = f.attrs || {};
    wgs.push([g, { layer: 'area-' + f.category, file: 'areas', fid: f.id, label: null,
      attrs: { name: f.name || '', category: f.category, type: a.type ?? '', buffer_m: a.buffer ?? null, height_m: a.height ?? null,
        width_m: a.width ?? null, voltage: a.voltage ?? '', source: f.sourceCategory || '' } }]);
  }
  const frame = r?.frame || siteFrame();
  let L = null;
  if (r && r.frame && r.area) {
    const area = r.area, f = P.field;
    if (area.buildable) local.push([area.buildable, { layer: 'buildable', file: 'buildable', attrs: { name: 'Buildable area', area_m2: round(r.buildableArea, 0) } }]);
    const { Polygon, Polyline, Point } = S;
    for (const tb of r.tablesLocal || []) {
      const half = !!tb.half, geom = half ? r.halfGeom : r.geom;
      local.push([new Polygon({ rings: [[tb.corners[0], tb.corners[3], tb.corners[2], tb.corners[1], tb.corners[0]]], spatialReference: frame.sr }),
        { layer: half ? 'tables-half' : 'tables', file: 'tables', attrs: { row: tb.row, col: tb.col, structure: half ? geom.notation : f.structure,
          half: half ? 1 : 0, modules: geom.modules, wp: r.power?.wp ?? null, kwp: round(geom.modules * (r.power?.wp || 0) / 1000, 3),
          tilt_deg: f.technology === 'agri-tracker' ? 0 : f.tiltDeg, azimuth: f.azimuthDeg } }]);
    }
    L = layoutInfra(frame, area.pre, area.base);
    for (const fc of L.fences) local.push([new Polyline({ paths: fc.rings, spatialReference: frame.sr }),
      { layer: 'fence', file: 'fences', label: fc.letter, attrs: { fence: fc.letter, lots: fc.lots.join(','), length_m: round(fc.length, 1) } }]);
    if (L.road) local.push([L.road, { layer: 'road-perimeter', file: 'roads',
      attrs: { kind: 'perimeter', width_m: null, length_m: round(L.roadLength, 1), area_m2: round(S.areaOperator.execute(L.road), 0) } }]);
    const tw = f.tracks?.width || null;
    for (const g of r.roads || []) {
      const a = S.areaOperator.execute(g);
      local.push([g, { layer: 'road-internal', file: 'roads', attrs: { kind: 'internal', width_m: tw, length_m: tw ? round(a / tw, 1) : null, area_m2: round(a, 0) } }]);
    }
    for (const rd of L.roads) {
      local.push([rd.strip, { layer: 'road-drawn', file: 'roads', attrs: { kind: 'drawn-' + rd.kind, width_m: rd.width, length_m: round(rd.length, 1), area_m2: round(S.areaOperator.execute(rd.strip), 0) } }]);
      local.push([rd.line, { layer: 'road-axis', file: 'road_axes', attrs: { kind: 'drawn-' + rd.kind, width_m: rd.width, length_m: round(rd.length, 1) } }]);
    }
    for (const s of L.stations) local.push([s.footprint, { layer: 'station', file: 'stations', label: s.kind,
      attrs: { kind: s.kind, building: s.building.id, length_m: s.building.length, width_m: s.building.width, rot_deg: round(s.rot || 0, 1), inside: s.inside ? 1 : 0 } }]);
    for (const gt of L.gates) local.push([new Point({ x: gt.point[0], y: gt.point[1], spatialReference: frame.sr }),
      { layer: 'gate', file: 'gates', label: gt.name || null, attrs: { name: gt.name || '', width_m: gt.width ?? null } }]);
  }
  // dimensions (dims.js): one item per segment with its length as the label, the ticks as plain lines, in the local
  // frame of the site (true metres); none without a site frame
  if (frame) {
    const { Polyline } = S;
    for (const dm of allDimensionParts(frame)) {
      dm.segments.forEach((sg, i) => {
        local.push([new Polyline({ paths: [[sg.a, sg.b]], spatialReference: frame.sr }),
          { layer: 'dimension', file: 'dimensions', label: `${round(sg.length, 1)} m`, attrs: { dimension: dm.id, segment: i + 1, length_m: round(sg.length, 2), total_m: round(dm.total, 2) } }]);
        local.push([new Polyline({ paths: sg.ticks, spatialReference: frame.sr }),
          { layer: 'dimension', file: 'dimensions', label: null, attrs: { dimension: dm.id, segment: i + 1, length_m: null, total_m: null } }]);
      });
    }
  }
  // the contours of 2 · Terrain while they are on (L14): one line per contour with its elevation, in the frame of the grid
  const ct = terrainContours(), contours = [];   // projected on their own: the frame of the grid is not the one of the site
  if (ct) for (const l of ct.lines) contours.push([new S.Polyline({ paths: [l.path], spatialReference: ct.sr }), { layer: 'contour', file: 'contours', z: l.z, label: null, attrs: { elev_m: l.z } }]);
  if (!local.length && !wgs.length) return { error: 'nothing' };
  const project = (pairs, from) => {
    if (!pairs.length) return [];
    const out = from ? from.toSrMany(pairs.map(p => p[0]), target) : S.projectOperator.executeMany(pairs.map(p => p[0]), target);
    return out.map((g, i) => ({ ...pairs[i][1], geometry: g && g.type === 'polygon' ? S.simplifyOperator.execute(g) : g })).filter(x => x.geometry);
  };
  const items = [...project(wgs, null), ...(local.length ? project(local, frame) : []), ...project(contours, null)];
  return { wkid: P.crs.wkid, sr: target, items, result: r, infra: L, frame };
}

// plain coordinates of an SDK geometry: { type: 'polygon' | 'polyline' | 'point', parts: [[[x, y], …], …] }
export function partsOf(g) {
  if (!g) return null;
  if (g.type === 'point') return { type: 'point', parts: [[[g.x, g.y]]] };
  if (g.type === 'multipoint') return { type: 'point', parts: g.points.map(p => [[p[0], p[1]]]) };
  if (g.type === 'polyline') return { type: 'polyline', parts: g.paths.map(p => p.map(q => [q[0], q[1]])) };
  if (g.type === 'polygon') return { type: 'polygon', parts: g.rings.map(p => p.map(q => [q[0], q[1]])) };
  return null;
}

// the names of the files: «<project name>_<YYYY-MM-DD>» + what the file is (io/names.js, decision L3)
export { fileName } from '../io/names.js';
