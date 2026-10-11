// The editing operations of 1 · Site (phase 2B, decisions B1–B6 of 2026-10-11): split one object with a line, merge
// areas, copy objects, and the measure of one object for the «Selected object» card. They take the objects of the
// project (GeoJSON in WGS 84), work in the local metric frame of the site (true metres, never Web Mercator) and return
// new objects; areas.js applies them through its undo history, so that every edit can be undone.
import { getSdk } from './sdk.js';
import { uid, geomKind } from './state.js';
import { toSdk, toGeoJSON } from './geo/convert.js';
import { makeLocalFrame } from './geo/localframe.js';

// the stored rings keep the orientation of their source (GeoJSON is counter-clockwise, the SDK clockwise): every
// geometry is simplified before an operation and after it, as computeArea() does, so that areas come out positive
const simple = g => (g ? getSdk().simplifyOperator.execute(g) : g);
const empty = g => !g || (g.type === 'polygon' ? !(g.rings && g.rings.length) : g.type === 'polyline' ? !(g.paths && g.paths.length) : false);

// the frame of the site, or one centred on the objects when there is no site yet
export function frameFor(features, siteFrame = null) {
  if (siteFrame) return siteFrame;
  const S = getSdk();
  const g = features.map(f => toSdk(f.geometry)).find(Boolean);
  if (!g) return null;
  const c = g.type === 'point' ? g : S.projectOperator.execute(g.extent.center, S.SpatialReference.WGS84);
  return makeLocalFrame({ lon0: c.x, lat0: c.y });
}

// Splits an area or a line with a cutting line (an SDK polyline, any system). Returns the pieces, each a copy of the
// object with its own id and the name «name (1)», «name (2)»…, or [] when the line does not cross it.
export function splitFeature(f, cutter, frame, nameOf = (name, i) => `${name} (${i})`) {
  const S = getSdk();
  const g = toSdk(f.geometry);
  if (!g || !cutter || !frame || !['polygon', 'line'].includes(geomKind(f.geometry))) return [];
  let parts = [];
  try { parts = (S.cutOperator.execute(simple(frame.toLocal(g)), frame.toLocal(cutter)) || []).map(simple).filter(p => !empty(p)); }
  catch (e) { console.warn('[edit] split', e); return []; }
  if (parts.length < 2) return [];
  return parts.map((p, i) => ({ ...structuredClone(f), id: uid(), name: nameOf(f.name, i + 1),
    geometry: toGeoJSON(frame.toSr(p, S.SpatialReference.WGS84)) }));
}

// Merges two or more areas into one: the name, category and values of the first. null when they are not all areas.
export function mergeFeatures(fs, frame) {
  const S = getSdk();
  if (fs.length < 2 || !frame || fs.some(f => geomKind(f.geometry) !== 'polygon')) return null;
  const ls = fs.map(f => simple(frame.toLocal(toSdk(f.geometry))));
  let u = null;
  try { u = simple(S.unionOperator.executeMany(ls)); } catch (e) { console.warn('[edit] merge', e); }
  if (empty(u)) return null;
  return { ...structuredClone(fs[0]), id: uid(), geometry: toGeoJSON(frame.toSr(u, S.SpatialReference.WGS84)) };
}

// Copies of the objects in place, with new ids (areas.js moves them right after)
export function copyFeatures(fs, nameOf = name => name) {
  return fs.map(f => ({ ...structuredClone(f), id: uid(), name: nameOf(f.name) }));
}

// The size of one object in true metres: { kind, area (m²), length (m) }
export function measureFeature(f, frame) {
  const S = getSdk();
  const g = toSdk(f.geometry), kind = geomKind(f.geometry);
  if (!g || !frame) return { kind };
  const l = frame.toLocal(g);
  if (kind === 'polygon') return { kind, area: Math.abs(S.areaOperator.execute(simple(l))) };
  if (kind === 'line') return { kind, length: l.paths.reduce((s, p) => s + p.slice(1).reduce((q, v, k) => q + Math.hypot(v[0] - p[k][0], v[1] - p[k][1]), 0), 0) };
  return { kind };
}
