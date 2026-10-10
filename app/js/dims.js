// Dimensions: measured lines kept in the project (project.dims, one polyline each in WGS 84), drawn on the map with
// the length of every segment in true metres (the local frame of the site, never Web Mercator), ticks at the
// vertices and the total of a chain; shown or hidden from the Tools menu, removed one by one (click, then Delete)
// or all at once. They are not objects of 1 · Site: they cut nothing and belong to no category. They go to the PDF
// report and to the DXF (layer PVP_DIM), see report.js and export/model.js.
import { getSdk } from './sdk.js';
import { store, change, on, uid } from './state.js';
import { t, fmt } from './i18n.js';
import { toast } from './ui/toast.js';
import { toGeoJSON } from './geo/convert.js';
import { makeLocalFrame } from './geo/localframe.js';
import { siteFrame, areasLayer, banner } from './areas.js';
import { onDrawPrefs } from './ui/maptools.js';
import { confirmDialog } from './ui/dialog.js';

let view = null, layer = null, scratch = null, sketchVM = null;
let drawing = false, selected = null, visible = true;
const TICK = 3;            // m: the tick at every vertex, across the dimension
const LINE = [20, 30, 40];

export function initDims(mapView) {
  view = mapView;
  const { GraphicsLayer, SketchViewModel } = getSdk();
  layer = new GraphicsLayer({ title: 'Dimensions' });
  scratch = new GraphicsLayer({ title: 'Dimension sketch', listMode: 'hide' });
  view.map.addMany([layer, scratch]);
  sketchVM = new SketchViewModel({ view, layer: scratch, updateOnGraphicClick: false });
  sketchVM.polylineSymbol = { type: 'simple-line', color: LINE, width: 1.5 };
  try {
    const src = [{ layer, enabled: true }];
    const al = areasLayer();
    if (al) src.unshift({ layer: al, enabled: true });
    sketchVM.snappingOptions = { enabled: true, selfEnabled: true, featureEnabled: true, featureSources: src };
    sketchVM.tooltipOptions = { enabled: true, inputEnabled: true };
    sketchVM.labelOptions = { enabled: true };
    onDrawPrefs(p => {
      sketchVM.snappingOptions.enabled = !!p.snap;
      sketchVM.tooltipOptions.enabled = !!p.typed; sketchVM.tooltipOptions.inputEnabled = !!p.typed;
      sketchVM.labelOptions.enabled = !!p.labels;
    });
  } catch (e) { console.warn('[dims] sketch options', e); }
  sketchVM.on('create', e => {
    if (e.state === 'complete') finish(e.graphic);
    else if (e.state === 'cancel' && sketchVM.state !== 'active') end();
  });
  // a drawing of 1 · Site or a measure takes the pointer: the dimension in progress stops
  for (const ev of ['pvp:draw', 'pvp:measure']) document.addEventListener(ev, () => { if (drawing) stopDimension(); });
  // click: select a dimension (then Delete removes it); click elsewhere: nothing selected
  if (typeof view.on === 'function') view.on('click', async e => {
    if (drawing || typeof view.hitTest !== 'function') return;
    try {
      const h = await view.hitTest(e, { include: [layer] });
      const g = h.results.find(x => x.graphic && x.graphic.attributes && x.graphic.attributes.dimId);
      const id = g ? g.graphic.attributes.dimId : null;
      if (id === selected) return;
      selected = id;
      render();
      if (id) { const d = store.project.dims.find(x => x.id === id); toast(t('dims.selected', { m: fmt(totalOf(d), 1) }), '', 8000, { action: { label: t('dims.remove'), fn: () => removeDimension(id) } }); }
    } catch (err) { console.warn('[dims] hit test', err); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawing) { stopDimension(); return; }
    if (e.key !== 'Delete' || !selected) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    e.preventDefault();
    removeDimension(selected);
  });
  on('dims', render);
  on('site', render);          // the frame of the site moves with the site
  on('project', () => { selected = null; if (drawing) stopDimension(); render(); });
  render();
}

// ── drawing ──
export const isDrawingDimension = () => drawing;
export function startDimension() {
  if (!sketchVM || drawing) return;
  document.dispatchEvent(new CustomEvent('pvp:dim'));   // 1 · Site ends its drawing, a measure closes
  drawing = true;
  selected = null;
  if (!visible) setDimsVisible(true);
  sketchVM.create('polyline', { mode: 'click' });
  banner(t('dims.banner'));
  notify();
}
export function stopDimension() {
  if (drawing && sketchVM) sketchVM.cancel();
  end();
}
export function toggleDimension() { if (drawing) stopDimension(); else startDimension(); }
function end() { drawing = false; banner(null); notify(); }
function finish(graphic) {
  scratch.remove(graphic);
  const g = toGeoJSON(graphic.geometry);
  const pts = g && g.type === 'LineString' ? g.coordinates : g && g.type === 'MultiLineString' ? g.coordinates[0] : null;
  if (pts && pts.length >= 2) {
    const d = { id: uid(), points: pts.map(p => [p[0], p[1]]) };
    change('dims', p => { (p.dims ||= []).push(d); });
    toast(t('dims.added', { m: fmt(totalOf(d), 1) }), 'ok', 5000);
  }
  if (drawing) sketchVM.create('polyline', { mode: 'click' });   // the tool stays armed, as in 1 · Site
}

// ── visibility, removal ──
export const dimsVisible = () => visible;
export function setDimsVisible(on) { visible = !!on; if (layer) layer.visible = visible; notify(); }
export function removeDimension(id) {
  const d = store.project.dims.find(x => x.id === id);
  if (!d) return;
  change('dims', p => { p.dims = p.dims.filter(x => x.id !== id); });
  if (selected === id) selected = null;
  toast(t('dims.removed', { m: fmt(totalOf(d), 1) }), '', 8000, { action: { label: t('dims.undo'), fn: () => change('dims', p => { p.dims.push(d); }) } });
}
export async function clearDimensions() {
  const all = store.project.dims || [];
  if (!all.length) return;
  if (!(await confirmDialog({ title: t('dims.clearTitle'), text: t('dims.clearText', { n: all.length }), ok: t('dims.clearOk'), danger: true }))) return;
  const kept = all.slice();
  change('dims', p => { p.dims = []; });
  selected = null;
  toast(t('dims.cleared', { n: kept.length }), '', 8000, { action: { label: t('dims.undo'), fn: () => change('dims', p => { p.dims = kept.slice(); }) } });
}
function notify() { document.dispatchEvent(new CustomEvent('pvp:dims-state')); }

// ── geometry in true metres ──
// The frame of the site, or one centred on the dimension when there is no site yet
function frameFor(d, frame = siteFrame()) { return frame || makeLocalFrame({ lon0: d.points[0][0], lat0: d.points[0][1] }); }
// { id, segments: [{ a, b, length, mid, ticks: [[p, q], [p, q]] }], total, frame } with every coordinate in the local
// frame (metres). frame: the one to use (exports pass the frame of the site)
export function dimensionParts(d, frame = null) {
  const F = frameFor(d, frame);
  const { Multipoint } = getSdk();
  const mp = F.toLocal(new Multipoint({ points: d.points.map(p => [p[0], p[1]]), spatialReference: { wkid: 4326 } }));
  const P = mp ? mp.points.map(p => [p[0], p[1]]) : [];
  const segments = [];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    const nx = -dy / length * TICK / 2, ny = dx / length * TICK / 2;
    segments.push({ a, b, length, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ticks: [[[a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]], [[b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny]]] });
  }
  return { id: d.id, segments, total: segments.reduce((s, x) => s + x.length, 0), frame: F };
}
export const totalOf = d => dimensionParts(d).total;
// every dimension of the project, for the report and the exports
export function allDimensionParts(frame = null) { return (store.project.dims || []).map(d => dimensionParts(d, frame)); }

// ── map ──
function render() {
  if (!layer) return;
  layer.removeAll();
  const { Graphic, Polyline, Point } = getSdk();
  const sr = view.spatialReference;
  const graphics = [];
  for (const d of store.project.dims || []) {
    let parts;
    try { parts = dimensionParts(d); } catch (e) { console.warn('[dims]', e); continue; }
    if (!parts.segments.length) continue;
    const F = parts.frame, sel = d.id === selected;
    const line = { type: 'simple-line', color: sel ? [57, 69, 207] : LINE, width: sel ? 2.5 : 1.3 };
    const paths = [parts.segments.map((s, i) => (i ? [s.b] : [s.a, s.b])).flat()];
    graphics.push(new Graphic({ geometry: F.toSr(new Polyline({ paths, spatialReference: F.sr }), sr), symbol: line, attributes: { dimId: d.id } }));
    const ticks = parts.segments.flatMap(s => s.ticks);
    graphics.push(new Graphic({ geometry: F.toSr(new Polyline({ paths: ticks, spatialReference: F.sr }), sr), symbol: line, attributes: { dimId: d.id } }));
    const label = (p, text, bold = false) => new Graphic({ geometry: F.toSr(new Point({ x: p[0], y: p[1], spatialReference: F.sr }), sr),
      symbol: { type: 'text', text, color: sel ? [57, 69, 207] : LINE, haloColor: [255, 255, 255, 0.9], haloSize: 2, yoffset: 7,
        font: { size: 10, weight: bold ? 'bold' : 'normal', family: 'sans-serif' } }, attributes: { dimId: d.id } });
    for (const s of parts.segments) graphics.push(label(s.mid, `${fmt(s.length, 1)} m`, parts.segments.length === 1));
    if (parts.segments.length > 1) graphics.push(label(parts.segments.at(-1).b, t('dims.total', { m: fmt(parts.total, 1) }), true));
  }
  layer.addMany(graphics);
  layer.visible = visible;
}
