// Step 1 · Site: objects by category (gross, net, exclusions, linear infrastructure, obstacles, access,
// mitigation, agricultural zones, reference), import, drawing in two steps (what, then with which tool — the
// Geoportale's Disegna pattern, in the ribbon since phase 2: the Category and Type menus and five geometries;
// «Unclassified» is the default and keeps the objects aside until each one gets its category), undo / redo, the
// selection and the edits of phase 2B (a click or a box on the map, a click on a Layers row; Reshape, Move / rotate,
// Split, Merge, Copy, Delete; the Category, Type and Buffer of the ribbon act on the selection; edit.js does the
// geometry), and the buildable area in the local metric frame.
import { getSdk } from './sdk.js';
import { store, change, on, emit, uid, saveSoon, geomKind } from './state.js';
import { t, tn, fmt } from './i18n.js';
import { CATEGORIES, CATEGORY, POWER_TYPES, UNCLASSIFIED, accepts, classify } from './categories.js';
import { toSdk, toGeoJSON, reprojectToWgs84, projectPointToWgs84, wktName } from './geo/convert.js';
import { makeLocalFrame } from './geo/localframe.js';
import { readAnyFile } from './io/importers.js';
import { suggestCrs, candidatesForProjected, crsLabel } from './crs.js';
import { chooseCrs } from './ui/crsdialog.js';
import { toast } from './ui/toast.js';
import { stepProvider, refreshRail, showStep, currentTab } from './ui/tabs.js';
import { updateCollection } from './ui/layers.js';
import { onDrawPrefs } from './ui/maptools.js';
import { icon } from './ui/icons.js';
import { initCatMenu } from './ui/catmenu.js';
import { layerVisible, setLayerVisible, onVisibility } from './ui/visibility.js';
import { registerSketch } from './ui/snapping.js';
import { splitFeature, mergeFeatures, copyFeatures, measureFeature, frameFor } from './edit.js';

let view, featLayer, sketchLayer, sketchVM;
let selLayer = null;         // the outlines of the selected objects, over the objects
let drawing = null;          // { category, tool, free }
let editing = null;          // { ids, kind: 'reshape' | 'move' }: objects handed to the sketch
const selection = new Set(); // the selected objects (ids): the ribbon's Category, Type, Buffer and Edit group act on them
let op = null;               // a sketch made for the selection: 'box' (box selection) or 'split' (the cutting line)
let mode = 'select';         // the mode of the map (pvp:mode): objects are picked on the map only in 'select'
let drawCat = UNCLASSIFIED; // ① the category the next drawings go into (none by default: sorted later)
let catMenu = null;          // the category menu of the ribbon (ui/catmenu.js)
const drawDefaults = {};     // category -> attributes given to the next drawings (type, buffer, height, width)
const TOOLS = ['point', 'polyline', 'polygon', 'rectangle', 'circle', 'freehand'];
const TOOL_KIND = { point: 'point', polyline: 'line', polygon: 'polygon', rectangle: 'polygon', circle: 'polygon' };
// Freehand follows the pointer: an area when the category takes areas, else a line (thinned to 0.5 m)
const kindOf = (tool, c) => (tool === 'freehand' ? (c.geom.includes('polygon') ? 'polygon' : 'line') : TOOL_KIND[tool]);
const toolOk = (tool, c) => !!c && c.geom.includes(kindOf(tool, c));
export const crsState = { alerts: [], suggested: null, iso: null };
// figures of the step for the rail (buildable area in m², null without a site)
export const areasState = { buildableArea: null };
// Other cuts of the buildable area, registered by other steps (terrain: slopes over the limit of the structure;
// infrastructure: fence clearance, stations). fn(frame, { base, pre }) -> null | { geometry (polygon in the frame),
// kind, label } | { note } (a message for the results). pre = base minus the objects of the Areas step: the land
// the plant can use, around which the fence runs.
export const extraCuts = [];
// Called after a file was imported: fn(result of readAnyFile, features added). The terrain step adopts the
// elevation grid of a Geoportale project here (registered there, so that this module does not import it).
export const importHooks = [];
const openCats = new Set([UNCLASSIFIED, 'gross', 'net', 'exclusion']);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initAreas(mapView) {
  view = mapView;
  const { GraphicsLayer, SketchViewModel } = getSdk();
  featLayer = new GraphicsLayer({ title: 'Areas' });
  sketchLayer = new GraphicsLayer({ title: 'Sketch', listMode: 'hide' });
  selLayer = new GraphicsLayer({ title: 'Selection', listMode: 'hide' });
  view.map.addMany([featLayer, selLayer, sketchLayer]);
  sketchVM = new SketchViewModel({ view, layer: sketchLayer, updateOnGraphicClick: false });
  // the drawing support (snapping, typed lengths and angles, segment labels): the preferences of ui/maptools.js
  // (the snapping switch of the status bar, the two boxes under the drawing block)
  try {
    registerSketch(sketchVM);   // the snapping of the menu of the status bar (ui/snapping.js)
    sketchVM.tooltipOptions = { enabled: true, inputEnabled: true };
    sketchVM.labelOptions = { enabled: true };
    onDrawPrefs(p => {
      sketchVM.tooltipOptions.enabled = !!p.typed; sketchVM.tooltipOptions.inputEnabled = !!p.typed;
      sketchVM.labelOptions.enabled = !!p.labels;
    });
  } catch (e) { console.warn('[areas] sketch options', e); }
  // a measure or a dimension takes the pointer: the drawing or the reshaping in progress ends
  for (const ev of ['pvp:measure', 'pvp:dim']) document.addEventListener(ev, () => { if (op) cancelOp(); if (drawing) stopDraw(); if (editing) sketchVM.complete(); });
  sketchVM.on('create', e => {
    if (op) { if (e.state === 'complete') finishOp(e.graphic); else if (e.state === 'cancel') endOp(); return; }   // a box, a cutting line
    if (e.state === 'complete') finishDraw(e.graphic);
    else if (e.state === 'cancel' && sketchVM.state !== 'active') endDraw();   // not the cancel made to re-arm
  });
  sketchVM.on('update', e => { if (e.state === 'complete') finishEdit(e); });
  window.__sketch = sketchVM;   // debug hook
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && op) { cancelOp(); return; }
    if (e.key === 'Escape' && drawing) { stopDraw(); return; }
    // Esc clears the selection and Delete removes it (with Undo): not while typing, not while the sketch holds objects
    const tg = e.target && e.target.tagName;
    const typing = tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' || (e.target && e.target.isContentEditable);
    if (!typing && !editing && selection.size && (e.key === 'Escape' || e.key === 'Delete')) {
      if (e.key === 'Escape') clearSelection(); else { e.preventDefault(); deleteSelection(); }
      return;
    }
    // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) on the objects of the site while this step is open, not while typing
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    const sec = document.querySelector('.step[data-step="areas"]');
    if (sec && sec.hidden) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { if (undo()) e.preventDefault(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { if (redo()) e.preventDefault(); }
  });
  // the ribbon group Site definition: ① the Category and Type menus, ② the five geometries (and Freehand), undo /
  // redo, the values given to the next drawings (Buffer, and Height or Width when the category has one). With a
  // selection the same menus and fields show and change the selected objects
  if ($('drawTools')) {
    catMenu = initCatMenu({ btn: $('drawCatBtn'), list: $('drawCatList'), items: drawItems, mixed: () => t('sel.mixed'),
      value: () => (selection.size ? selCategory() : drawCat),
      onPick: id => (selection.size ? reclassifySelection(id) : selectDrawCat(id)) });
    $('drawTools').onclick = e => { const b = e.target.closest('[data-dtool]'); if (b && !b.disabled) toggleTool(b.dataset.dtool); };
    const num = el => (el.value === '' ? undefined : Math.max(0, Number(el.value)));
    $('drawType').onchange = () => setValue('type', $('drawType').value);
    $('drawBuffer').onchange = () => setValue('buffer', num($('drawBuffer')));
    $('drawSize').onchange = () => setValue($('drawSize').dataset.dattr, num($('drawSize')));
    $('drawUndo').onclick = () => undo();
    $('drawRedo').onclick = () => redo();
    // the group Selection: Select, Box, and the edits of the selected objects
    const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    on('selTool', () => { if (op) cancelOp(); if (drawing) stopDraw(); if (editing) sketchVM.complete(); renderEditTools(); });
    on('selBox', () => (op === 'box' ? cancelOp() : startBox()));
    on('edReshape', () => { const f = singleSelected(); if (f) startEdit(f.id); });
    on('edMove', () => startMove([...selection]));
    on('edSplit', () => (op === 'split' ? cancelOp() : startSplit()));
    on('edMerge', () => mergeSelection());
    on('edCopy', () => copySelection());
    on('edDelete', () => deleteSelection());
    // the «Selected object» card of the Properties panel: the name, and the voltage of a power line
    const sn = $('selName'), sv = $('selVolt');
    if (sn) sn.onchange = () => { const f = singleSelected(); if (f) renameFeature(f.id, sn.value); };
    if (sv) sv.onchange = () => {
      const f = singleSelected();
      if (!f) return;
      const v = sv.value === '' ? undefined : Math.max(0, Number(sv.value));
      mutate(p => { const g = p.features.find(x => x.id === f.id); if (!g) return; g.attrs = g.attrs || {}; if (v === undefined || !isFinite(v)) delete g.attrs.voltage; else g.attrs.voltage = v; });
    };
    renderDraw();
  }
  // a click on the map picks an object (Shift or Ctrl adds or removes it), a click elsewhere clears the selection: with
  // the Site area tab open and nothing else armed (drawing, measuring, a dimension, a box, a cutting line)
  document.addEventListener('pvp:mode', e => { mode = (e.detail && e.detail.mode) || 'select'; renderEditTools(); });
  if (typeof view.on === 'function') view.on('click', async e => {
    if (drawing || editing || op || mode !== 'select' || currentTab() !== 'areas' || typeof view.hitTest !== 'function') return;
    const add = !!(e.native && (e.native.shiftKey || e.native.ctrlKey || e.native.metaKey));
    let id = null;
    try {
      const h = await view.hitTest(e, { include: [featLayer] });
      const r = h.results.find(x => x.graphic && x.graphic.attributes && x.graphic.attributes.id);
      id = r ? r.graphic.attributes.id : null;
    } catch (err) { console.warn('[areas] hit test', err); }
    if (id) selectFeatures([id], { add, toggle: add }); else if (!add) clearSelection();
  });

  // the file picker of the Import tool
  const input = $('fileImport');
  $('areasImport').onclick = () => pickFiles(null);
  input.onchange = async () => {
    const files = [...(input.files || [])], cat = input.dataset.category || null;
    input.value = '';
    if (files.length) await importFiles(files, cat);
  };
  // the Layers panel (B5): groups and rows only; a click on a row selects its object (Shift or Ctrl adds), Enter or
  // Space too; the magnifier zooms to the object or to the group. No editing there: the ribbon does it
  const cats = $('areaCats');
  cats.addEventListener('click', onCatsClick);
  cats.addEventListener('keydown', e => {
    const row = e.target.closest && e.target.closest('.it[data-id]');
    if (!row || e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    pickRow(row, e);
  });
  cats.addEventListener('toggle', e => {
    const d = e.target;
    if (d.classList && d.classList.contains('cat')) { if (d.open) openCats.add(d.dataset.cat); else openCats.delete(d.dataset.cat); }
  }, true);

  const sb = $('boundarySetback');
  sb.onchange = () => change('settings', p => { p.settings.boundarySetback = Math.max(0, Number(sb.value) || 0); });

  on('site', () => {
    for (const id of [...selection]) if (!store.project.features.some(f => f.id === id)) selection.delete(id);   // removed objects
    render(); updateCrs(true);
  });
  on('terrain', renderSummarySoon);
  on('infra', renderSummarySoon);
  on('field', renderSummarySoon);   // the slope limit depends on the structure
  on('settings', () => { $('boundarySetback').value = store.project.settings.boundarySetback; renderSummarySoon(); });
  // the switch of a category in the Layers panel (phase 3): its objects and their buffers leave the map
  onVisibility(keys => { if (keys.some(k => k.startsWith('cat:'))) render(); });
  on('project', () => {
    history.undo.length = 0; history.redo.length = 0;
    selection.clear();
    if (op) cancelOp();
    if (drawing) stopDraw();
    render(); updateCrs(false); zoomToFeatures();
  });
  // the step is done once the site has a boundary; its figure is the buildable area
  stepProvider('areas', () => (sitePolygons().length
    ? { state: 'done', figure: areasState.buildableArea != null ? `${fmt(areasState.buildableArea / 1e4, 1)} ha` : '' }
    : { state: 'ready' }));
  render();
  updateCrs(false);
}

export function pickFiles(category = null) {
  const input = $('fileImport');
  input.dataset.category = category || '';
  input.click();
}

// ── import ──
// files: File[]; category: optional target category (files dropped on a card or imported from it)
export async function importFiles(files, category = null) {
  let total = 0;
  for (const file of files) {
    try {
      const r = await readAnyFile(file);
      // system of the file: declared (GeoJSON "crs"), or chosen by the user for coordinates in metres
      let fileWkid = r.declaredWkid || null;
      if (!fileWkid && r.needsCrs) {
        const sample = r.sample.slice(0, 20);
        const cands = candidatesForProjected(sample, projectPointToWgs84);
        const validate = w => sample.slice(0, 10).every(p => { const ll = projectPointToWgs84(w, p); return ll && Math.abs(ll[0]) <= 180 && Math.abs(ll[1]) <= 90; });
        fileWkid = await chooseCrs({ file: file.name, candidates: cands, current: store.project.crs.wkid, validate });
        if (!fileWkid) { toast(t('crs.importCancelled', { file: file.name }), 'err'); continue; }
      }
      // convert to WGS 84: with the file system, or with the layer's own .prj (Shapefiles)
      const used = new Set();
      let unreadable = 0;
      const feats = [];
      for (const f of r.features) {
        const sr = f.srcWkt ? { wkt: f.srcWkt } : fileWkid;
        if (!sr) { feats.push(f); continue; }
        let g = null;
        try { g = reprojectToWgs84(f.geometry, sr); } catch (e) { console.warn('[import] projection', e); }
        if (!g) { unreadable++; continue; }
        if (!(f.srcWkt && /^\s*GEOGCS\s*\[\s*"GCS_WGS_1984"/i.test(f.srcWkt))) used.add(f.srcWkt ? wktName(f.srcWkt) : `${crsLabel(fileWkid)} (EPSG:${fileWkid})`);
        feats.push({ ...f, geometry: g });
      }
      if (used.size) toast(t('crs.imported', { file: file.name, label: [...used].join(', ') }), '', 8000);
      if (unreadable) toast(tn('crs.unreadable', unreadable, { file: file.name }), 'err', 10000);
      if (!feats.length) continue;
      const ctx = { type: r.type, polygonsInFile: feats.filter(f => geomKind(f.geometry) === 'polygon').length };
      const added = [];
      let refused = 0;
      for (const f of feats) {
        let cls = classify(f, ctx);
        if (category) {
          if (accepts(category, f.geometry)) cls = { category, attrs: cls.category === category ? cls.attrs : defaultAttrs(category) };
          else refused++;
        }
        const feat = { id: uid(), name: f.name, category: cls.category, geometry: f.geometry, source: r.type,
          sourceCategory: f.sourceCategory || '', attrs: cls.attrs || {} };
        // a slope exclusion of the Geoportale keeps how it was computed (limit, grid), outside the attributes
        if (f.properties && f.properties.slope && cls.category === 'exclusion') feat.slope = f.properties.slope;
        added.push(feat);
      }
      const byCat = {};
      added.forEach(a => { byCat[a.category] = (byCat[a.category] || 0) + 1; });
      Object.keys(byCat).forEach(c => openCats.add(c));
      // an untitled project takes the name of a Geoportale project, or of the first file imported into it
      const rename = !store.project.name || store.project.name === 'Untitled project' ? (r.type === 'axpo' || !store.project.features.length ? r.name : null) : null;
      mutate(p => {
        p.features.push(...added);
        if (rename) p.name = rename;
      });
      if (rename) emit('name');
      total += added.length;
      const summary = CATEGORIES.filter(c => byCat[c.id]).map(c => `${t('cat.' + c.id)} ${byCat[c.id]}`).join(', ');
      toast(tn('areas.imported', added.length, { file: file.name, summary }), 'ok', 9000);
      if (refused) toast(tn('areas.refused', refused, { cat: t('cat.' + category) }), '', 9000);
      if (r.autoSkipped) toast(tn('areas.autoSkipped', r.autoSkipped), '', 10000);
      // the boundary setback of the Geoportale's automatic net area becomes this app's (same rule), when none was set
      if (r.netSetback > 0 && !(store.project.settings.boundarySetback > 0)) {
        change('settings', p => { p.settings.boundarySetback = r.netSetback; });
        toast(t('areas.setbackImported', { m: fmt(r.netSetback, 1) }), '', 9000);
      }
      for (const hook of importHooks) { try { await hook(r, added); } catch (e) { console.error('[import hook]', e); } }
    } catch (e) {
      console.error(e);
      toast(t('toast.importFail', { file: file.name, err: e.message || e }), 'err', 10000);
    }
  }
  if (total) zoomToFeatures();
  return total;
}

// ── undo / redo (the objects of the site; 40 steps, Ctrl+Z / Ctrl+Y as in the Geoportale) ──
const HIST = 40;
const history = { undo: [], redo: [] };
const snapshot = () => structuredClone(store.project.features);
// Every change of the objects made in this step goes through here, so that it can be undone
function mutate(fn) {
  history.undo.push(snapshot());
  if (history.undo.length > HIST) history.undo.shift();
  history.redo.length = 0;
  change('site', fn);
  renderHistory();
}
function restoreFeatures(feats) { change('site', p => { p.features = feats; }); renderHistory(); }
export function undo() {
  if (drawing && typeof sketchVM.canUndo === 'function' && sketchVM.canUndo()) { sketchVM.undo(); return true; }   // a vertex of the shape being drawn
  if (!history.undo.length) return false;
  history.redo.push(snapshot());
  restoreFeatures(history.undo.pop());
  toast(t('undone'), '', 2500);
  return true;
}
export function redo() {
  if (drawing && typeof sketchVM.canRedo === 'function' && sketchVM.canRedo()) { sketchVM.redo(); return true; }
  if (!history.redo.length) return false;
  history.undo.push(snapshot());
  restoreFeatures(history.redo.pop());
  toast(t('redone'), '', 2500);
  return true;
}
export const historySize = () => ({ undo: history.undo.length, redo: history.redo.length });
function renderHistory() {
  const u = $('drawUndo'), r = $('drawRedo');
  if (u) u.disabled = !history.undo.length;
  if (r) r.disabled = !history.redo.length;
}
// Removes objects with a way back: a message with ↶ Undo instead of a confirmation (they come back where they were)
export function removeFeatures(ids, text) {
  const removed = [];
  store.project.features.forEach((f, i) => { if (ids.includes(f.id)) removed.push({ i, f }); });
  if (!removed.length) return;
  mutate(p => { p.features = p.features.filter(f => !ids.includes(f.id)); });
  toast(text, '', 8000, { action: { label: t('undo'), fn: () => mutate(p => { for (const { i, f } of removed) p.features.splice(Math.min(i, p.features.length), 0, f); }) } });
}

// ── drawing: ① the category, ② the tool; the tool stays armed until clicked again or Esc ──
export function selectDrawCat(category) {
  if (!CATEGORY[category]) return;
  const tool = drawing && drawing.tool;
  drawCat = category;
  if (tool) { if (toolOk(tool, CATEGORY[category])) startDraw(category, tool); else stopDraw(); }
  else renderDraw();
}
function toggleTool(tool) {
  if (drawing && drawing.tool === tool) stopDraw(); else startDraw(drawCat, tool);
}
export function startDraw(category, tool) {
  if (!TOOLS.includes(tool) || !toolOk(tool, CATEGORY[category])) return;
  if (!layerVisible('cat:' + category)) setLayerVisible('cat:' + category, true);   // F8: nothing is drawn unseen
  if (op) cancelOp();
  if (selection.size) clearSelection();   // a drawing tool leaves the selection
  if (editing) sketchVM.complete();
  if (drawing) sketchVM.cancel();
  document.dispatchEvent(new CustomEvent('pvp:draw'));   // a dimension in progress stops (dims.js)
  const free = tool === 'freehand', sketchTool = free ? (kindOf(tool, CATEGORY[category]) === 'polygon' ? 'polygon' : 'polyline') : tool;
  drawing = { category, tool, free };
  drawCat = category;
  const c = CATEGORY[category].colour;
  sketchVM.polygonSymbol = { type: 'simple-fill', color: [...c, 0.12], outline: { color: c, width: 2 } };
  sketchVM.polylineSymbol = { type: 'simple-line', color: c, width: 2.5 };
  sketchVM.pointSymbol = { type: 'simple-marker', color: c, size: 9, outline: { color: [255, 255, 255], width: 1 } };
  sketchVM.create(sketchTool, tool === 'point' ? undefined : { mode: free ? 'freehand' : 'click' });
  renderDraw();
  const key = tool === 'point' ? 'areas.drawPointBanner' : tool === 'rectangle' ? 'areas.drawRectBanner' : tool === 'circle' ? 'areas.drawCircleBanner'
    : free ? 'areas.drawFreeBanner' : 'areas.drawBanner';
  banner(t(key, { cat: esc(t('cat.' + category)) }));
  setMode('draw', t('sb.draw', { cat: t('cat.' + category) }));
}
export function stopDraw() {
  if (drawing) sketchVM.cancel();
  endDraw();
}
export const drawingState = () => (drawing ? { ...drawing } : null);
function endDraw() {
  const was = drawing;
  drawing = null;
  renderDraw();
  banner(null);
  if (was) setMode('select', t('sb.select'));
}
// the mode shown in the status bar (ui/statusbar.js listens)
const setMode = (mode, label) => document.dispatchEvent(new CustomEvent('pvp:mode', { detail: { mode, label } }));
// the layer of the objects (dims.js snaps to it) and the mode banner on the top edge of the map (shared with dims.js)
export const areasLayer = () => featLayer;
export function banner(html) {
  const b = $('banner');
  if (!b) return;
  if (html) { b.innerHTML = html; b.hidden = false; } else b.hidden = true;
}
function finishDraw(graphic) {
  const d = drawing;
  sketchLayer.remove(graphic);
  const geometry = toGeoJSON(d && d.free ? thinned(graphic.geometry) : graphic.geometry);
  if (geometry && d) {
    const n = store.project.features.filter(f => f.category === d.category).length + 1;
    const name = `${t('cat.' + d.category + '.one')} ${n}`;
    const f = { id: uid(), name, category: d.category, geometry, source: 'drawn', sourceCategory: '', attrs: { ...defaultAttrs(d.category), ...(drawDefaults[d.category] || {}) } };
    openCats.add(d.category);
    mutate(p => p.features.push(f));
    flashRow(f.id);   // the new row lights up in the Layers panel
  }
  // the tool stays armed (points, lines and areas alike): click it again or Esc to stop
  if (d) { drawing = null; startDraw(d.category, d.tool); }
  else endDraw();
}
// A freehand line follows the pointer with hundreds of vertices: thinned to 0.5 m in true metres (the frame of the
// site, or one centred on the drawing when there is no site yet)
function thinned(g) {
  const S = getSdk();
  try {
    const c = S.projectOperator.execute(g.extent.center, S.SpatialReference.WGS84);
    const frame = siteFrame() || makeLocalFrame({ lon0: c.x, lat0: c.y });
    const l = S.generalizeOperator.execute(frame.toLocal(g), 0.5);
    return l ? frame.toSr(l, g.spatialReference) : g;
  } catch (e) { console.warn('[areas] freehand', e); return g; }
}
function flashRow(id) {
  requestAnimationFrame(() => {
    const row = document.querySelector(`#areaCats .it[data-id="${id}"]`);
    if (!row) return;
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    row.scrollIntoView({ block: 'nearest' });
  });
}
// a value of the ribbon (Type, Buffer, Height, Width): given to the selected objects when there is a selection,
// otherwise to the next drawings of the category
function setValue(attr, v) {
  if (!attr) return;
  if (selection.size) { applyToSelection(attr, v); return; }
  const d = drawDefaults[drawCat] || (drawDefaults[drawCat] = defaultAttrs(drawCat));
  if (v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) delete d[attr]; else d[attr] = v;
}
function defaultAttrs(category) {
  if (category === 'obstacle') return { type: 'tree' };
  if (category === 'access') return { type: 'site-access' };
  if (category === 'connection') return { type: 'estimated' };
  if (category === 'linear') return { type: 'other' };
  return {};
}

// the two steps of the drawing block, the status line and the history buttons. The tools of the ribbon: the area is
// the design system's «polygon»; the set has no point, line or rectangle, drawn here on its 24 px grid and stroke
const SVG24 = body => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const TOOL_SVG = {
  polygon: icon('polygon'),
  rectangle: SVG24('<rect x="4" y="6" width="16" height="12" rx="1.5"/>'),
  polyline: SVG24('<path d="M4.5 17.5l5-6.5 4.5 3 5.5-7"/><circle cx="4.5" cy="17.5" r="1.6"/><circle cx="9.5" cy="11" r="1.6"/><circle cx="14" cy="14" r="1.6"/><circle cx="19.5" cy="7" r="1.6"/>'),
  point: SVG24('<circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4"/>'),
  circle: SVG24('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  freehand: SVG24('<path d="M3.5 16.5c1.6-3.6 3.4-6.5 5.4-6.1 2.3.4.9 6.1 3.4 6.3 2.6.2 3.1-7.7 5.6-8.4 1.3-.4 2 .6 2.6 1.6"/>'),
};
// the entries of the category menu: Unclassified first (the default), then the categories of the model
const drawItems = () => [{ id: UNCLASSIFIED, label: t('cat.' + UNCLASSIFIED), hint: t('cat.' + UNCLASSIFIED + '.hint'), colour: null },
  ...CATEGORIES.map(c => ({ id: c.id, label: t('cat.' + c.id), hint: t('cat.' + c.id + '.hint'), colour: c.colour }))];
function renderDraw() {
  if (!$('drawTools')) return;
  catMenu?.render();
  const c = CATEGORY[drawCat];
  // the six tools of the ribbon: off when the category does not take that geometry, pressed while armed
  for (const b of $('drawTools').querySelectorAll('[data-dtool]')) {
    const tool = b.dataset.dtool, ok = toolOk(tool, c);
    const why = ok ? '' : t('areas.wrongGeom', { cat: t('cat.' + c.id), kind: t('geom.' + kindOf(tool, c)) });
    b.innerHTML = `${TOOL_SVG[tool]}<span>${esc(t('draw.tool.' + tool))}</span>`;
    b.disabled = !ok;
    b.title = ok ? `${t('draw.tool.' + tool)}: ${t('draw.tool.' + tool + '.sub')}` : why;
    b.setAttribute('aria-pressed', String(!!drawing && drawing.tool === tool));
  }
  if (selection.size) renderSelValues(selectedFeatures());
  else renderValues(c, drawDefaults[c.id] || (drawDefaults[c.id] = defaultAttrs(c.id)));
  // the label of the group says what the menus are about: the next drawings, or the selected objects
  const lab = $('rgSiteLabel');
  if (lab) lab.textContent = selection.size ? tn('sel.count', selection.size) : t('ribbon.g.site');
  $('drawTools').closest('.rgroup')?.classList.toggle('sel', !!selection.size);
  renderEditTools();
  renderHistory();
}
// the values of the selected objects: those they share, blank where they differ; objects of different categories
// share no type list, and a buffer only when every one of them takes one
function renderSelValues(fs) {
  const cats = [...new Set(fs.map(f => f.category))];
  const common = k => { const vs = [...new Set(fs.map(f => (f.attrs || {})[k] ?? ''))]; return vs.length === 1 ? vs[0] : ''; };
  if (cats.length === 1) { renderValues(CATEGORY[cats[0]] || CATEGORY.reference, { type: common('type'), buffer: common('buffer'), height: common('height'), width: common('width') }); return; }
  const ty = $('drawType');
  if (ty) { ty.innerHTML = `<option value="">${esc(t('sel.mixed'))}</option>`; ty.disabled = true; }
  const bf = $('drawBuffer');
  if (bf) { const on = fs.every(f => (CATEGORY[f.category]?.attrs || []).includes('buffer')); bf.disabled = !on; bf.value = on ? common('buffer') : ''; }
  const cap = $('drawSizeCap'), box = $('drawSizeBox');
  if (cap && box) cap.hidden = box.hidden = true;
}
// Type, Buffer and Height / Width of the ribbon for category c with the values v: Type is off for Unclassified and for
// the categories without types (gross, net), Buffer for those that do not cut with one; Height shows for obstacles,
// Width for the mitigation and agricultural strips
function renderValues(c, v) {
  const ty = $('drawType');
  if (ty) {
    const types = c.attrs.includes('type') ? c.types : [];
    const blank = !types.length || !types.includes(v.type) ? `<option value="" selected>${esc(t('type.none'))}</option>` : '';   // none, or mixed
    ty.innerHTML = blank + types.map(x => `<option value="${x}" ${v.type === x ? 'selected' : ''}>${esc(t('type.' + x))}</option>`).join('');
    ty.disabled = !types.length;
  }
  const bf = $('drawBuffer');
  if (bf) { const on = c.attrs.includes('buffer'); bf.disabled = !on; bf.value = on ? (v.buffer ?? '') : ''; }
  const size = c.attrs.includes('height') ? 'height' : c.attrs.includes('width') ? 'width' : null;
  const cap = $('drawSizeCap'), box = $('drawSizeBox'), inp = $('drawSize');
  if (cap && box && inp) {
    cap.hidden = box.hidden = !size;
    if (size) { cap.textContent = t('draw.' + size); inp.dataset.dattr = size; inp.value = v[size] ?? ''; }
  }
}
// ── selection (B1, B2) ──
export const selectedFeatures = () => store.project.features.filter(f => selection.has(f.id));
export const selectionIds = () => [...selection];
const singleSelected = () => (selection.size === 1 ? selectedFeatures()[0] || null : null);
const selCategory = () => { const cats = new Set(selectedFeatures().map(f => f.category)); return cats.size === 1 ? [...cats][0] : null; };
// ids: the objects; add: keep the current selection; toggle: an object already selected leaves it
export function selectFeatures(ids, { add = false, toggle = false } = {}) {
  if (!add) selection.clear();
  for (const id of ids) { if (toggle && selection.has(id)) selection.delete(id); else selection.add(id); }
  for (const id of [...selection]) if (!store.project.features.some(f => f.id === id)) selection.delete(id);
  renderSelection();
  renderDraw();
}
export function clearSelection() {
  if (!selection.size) return;
  selection.clear();
  renderSelection();
  renderDraw();
}
// every object a geometry touches (the box of the Box tool; any system)
export function selectByGeometry(g, { add = false } = {}) {
  const S = getSdk();
  const ids = [];
  for (const f of store.project.features) {
    const fg = toSdk(f.geometry);
    if (!fg) continue;
    try { if (S.intersectsOperator.execute(S.projectOperator.execute(fg, g.spatialReference), g)) ids.push(f.id); } catch (e) { console.warn('[areas] box', e); }
  }
  selectFeatures(ids, { add });
  return ids;
}
// the outlines of the selection on the map, its rows in the Layers panel, its card in the Properties panel
function renderSelection() {
  if (selLayer) {
    selLayer.removeAll();
    const { Graphic } = getSdk();
    const HL = [57, 69, 207];
    if (!editing) for (const f of selectedFeatures()) {
      const g = toSdk(f.geometry);
      if (!g) continue;
      const kind = geomKind(f.geometry);
      const symbol = kind === 'polygon' ? { type: 'simple-fill', color: [...HL, 0.10], outline: { color: HL, width: 3 } }
        : kind === 'line' ? { type: 'simple-line', color: [...HL, 0.85], width: 5 }
        : { type: 'simple-marker', style: 'circle', size: 18, color: [0, 0, 0, 0], outline: { color: HL, width: 2.5 } };
      selLayer.add(new Graphic({ geometry: g, symbol }));
    }
  }
  document.querySelectorAll('#areaCats .it[data-id]').forEach(r => { const on = selection.has(r.dataset.id); r.classList.toggle('sel', on); r.setAttribute('aria-selected', String(on)); });
  renderSelCard();
}
// B4: one selected object, its name, its voltage (power lines), its size in true metres and where it comes from
function renderSelCard() {
  const card = $('selCard');
  if (!card) return;
  const f = singleSelected();
  card.hidden = !f;
  if (!f) return;
  const c = CATEGORY[f.category] || CATEGORY.reference;
  $('selCat').innerHTML = `<span class="ctag" style="--c:rgb(${c.colour.join(',')})">${esc(t('cat.' + f.category))}</span>`;
  if (document.activeElement !== $('selName')) $('selName').value = f.name;
  const volt = c.attrs.includes('voltage') && POWER_TYPES.includes(f.attrs?.type);
  $('selVoltBox').hidden = !volt;
  if (volt && document.activeElement !== $('selVolt')) $('selVolt').value = f.attrs?.voltage ?? '';
  const m = measureFeature(f, frameFor([f], siteFrame()));
  const rows = [];
  if (m.area != null) rows.push([t('sel.area'), `${fmt(m.area / 1e4, 2)} ha · ${fmt(m.area, 0)} m²`]);
  if (m.length != null) rows.push([t('sel.length'), `${fmt(m.length, 1)} m`]);
  rows.push([t('sel.source'), f.sourceCategory || (f.source === 'drawn' ? t('sel.drawn') : String(f.source || '').toUpperCase())]);
  $('selInfo').innerHTML = rows.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
}
// the tools of the group Selection: on or off with the reason as their tooltip, pressed while armed
function renderEditTools() {
  const fs = selectedFeatures(), one = fs.length === 1 ? fs[0] : null;
  const set = (id, why, pressed = null) => {
    const b = $(id);
    if (!b) return;
    b.disabled = !!why;
    b.title = why || t(b.dataset.tip || '');
    if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
  };
  set('selTool', '', !drawing && !op && !editing && mode === 'select');
  set('selBox', '', op === 'box');
  const busy = editing ? t('edit.busy') : '';
  set('edReshape', busy || (one ? '' : t('edit.needOne')));
  set('edMove', busy || (fs.length ? '' : t('edit.needSel')));
  set('edSplit', busy || (one && ['polygon', 'line'].includes(geomKind(one.geometry)) ? '' : t('edit.needLine')), op === 'split');
  set('edMerge', busy || mergeWhy(fs));
  set('edCopy', busy || (fs.length ? '' : t('edit.needSel')));
  set('edDelete', busy || (fs.length ? '' : t('edit.needSel')));
}
const mergeWhy = fs => (fs.length < 2 ? t('edit.needTwo') : fs.some(f => geomKind(f.geometry) !== 'polygon') ? t('edit.needAreas')
  : new Set(fs.map(f => f.category)).size > 1 ? t('edit.needSameCat') : '');

// ── edits of the selection (B2, B3): every one through the undo history ──
function applyToSelection(attr, v) {
  const ids = [...selection];
  mutate(p => {
    for (const f of p.features) {
      if (!ids.includes(f.id)) continue;
      const c = CATEGORY[f.category];
      if (!c || !c.attrs.includes(attr)) continue;
      if (attr === 'type' && !(c.types || []).includes(v)) continue;
      f.attrs = f.attrs || {};
      if (v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) delete f.attrs[attr]; else f.attrs[attr] = v;
      if (attr === 'type' && !POWER_TYPES.includes(f.attrs.type)) delete f.attrs.voltage;   // a voltage only for power lines
    }
  });
}
// the category of the selected objects (this is how Unclassified objects get theirs); objects whose geometry the
// category does not take keep theirs, and a message says how many
export function reclassifySelection(category) {
  const fs = selectedFeatures();
  if (!fs.length || !CATEGORY[category]) return 0;
  const ok = fs.filter(f => f.category !== category && accepts(category, f.geometry)).map(f => f.id);
  const refused = fs.filter(f => !accepts(category, f.geometry)).length;
  if (ok.length) {
    openCats.add(category);
    if (!layerVisible('cat:' + category)) setLayerVisible('cat:' + category, true);   // the objects stay in sight
    mutate(p => { for (const g of p.features) if (ok.includes(g.id)) { g.category = category; g.attrs = { ...defaultAttrs(category), ...keepAttrs(g.attrs, category) }; } });
  }
  if (refused) toast(tn('sel.refused', refused, { cat: t('cat.' + category) }), 'err', 7000);
  renderDraw();
  return ok.length;
}
export function splitSelection(cutter) {
  const f = singleSelected();
  if (!f) return 0;
  const pieces = splitFeature(f, cutter, frameFor([f], siteFrame()));
  if (!pieces.length) { toast(t('edit.splitNone', { name: f.name }), 'err', 6000); return 0; }
  mutate(p => { const i = p.features.findIndex(x => x.id === f.id); if (i >= 0) p.features.splice(i, 1, ...pieces); });
  selectFeatures(pieces.map(x => x.id));
  toast(t('edit.splitDone', { name: f.name, n: pieces.length }), 'ok', 5000);
  return pieces.length;
}
export function mergeSelection() {
  const fs = selectedFeatures(), why = mergeWhy(fs);
  if (why) { toast(why, 'err', 6000); return null; }
  const m = mergeFeatures(fs, frameFor(fs, siteFrame()));
  if (!m) { toast(t('edit.mergeFail'), 'err'); return null; }
  const ids = fs.map(f => f.id);
  mutate(p => { const i = p.features.findIndex(x => ids.includes(x.id)); p.features = p.features.filter(x => !ids.includes(x.id)); p.features.splice(Math.max(0, i), 0, m); });
  selectFeatures([m.id]);
  toast(t('edit.merged', { n: fs.length, name: m.name }), 'ok', 5000);
  return m;
}
// copies in place, selected, then handed to Move / rotate so that they can be dragged away (move: false for the tests)
export function copySelection({ move = true } = {}) {
  const fs = selectedFeatures();
  if (!fs.length) return [];
  const copies = copyFeatures(fs, name => t('edit.copyName', { name }));
  mutate(p => { p.features.push(...copies); });
  selectFeatures(copies.map(f => f.id));
  toast(tn('edit.copied', copies.length), 'ok', 5000);
  if (move) startMove(copies.map(f => f.id));
  return copies;
}
export function deleteSelection() {
  const fs = selectedFeatures();
  if (!fs.length) return;
  selection.clear();
  removeFeatures(fs.map(f => f.id), fs.length === 1 ? t('areas.removed', { name: fs[0].name }) : tn('edit.removed', fs.length));
  renderDraw();
}
// a box or a cutting line drawn with the sketch
function startOp(kind, create, bannerHtml, label) {
  if (drawing) stopDraw();
  if (editing) sketchVM.complete();
  if (op) cancelOp();
  op = kind;
  create();
  banner(bannerHtml);
  setMode(kind, label);
  renderEditTools();
}
function startBox() {
  startOp('box', () => {
    sketchVM.polygonSymbol = { type: 'simple-fill', color: [57, 69, 207, 0.08], outline: { color: [57, 69, 207], width: 1.5, style: 'dash' } };
    sketchVM.create('rectangle', { mode: 'click' });
  }, t('sel.boxBanner'), t('sb.box'));
}
function startSplit() {
  const f = singleSelected();
  if (!f || !['polygon', 'line'].includes(geomKind(f.geometry))) return;
  startOp('split', () => {
    sketchVM.polylineSymbol = { type: 'simple-line', color: [229, 72, 77], width: 2, style: 'dash' };
    sketchVM.create('polyline', { mode: 'click' });
  }, t('edit.splitBanner', { name: esc(f.name) }), t('sb.split'));
}
function cancelOp() { if (op && sketchVM) sketchVM.cancel(); endOp(); }
function endOp() {
  if (!op) return;
  op = null;
  banner(null);
  setMode('select', t('sb.select'));
  renderEditTools();
}
function finishOp(graphic) {
  const kind = op;
  sketchLayer.remove(graphic);
  endOp();
  if (kind === 'box') selectByGeometry(graphic.geometry);
  else if (kind === 'split') splitSelection(graphic.geometry);
}

// ── reshaping one object, moving and turning several ──
function startEdit(id) {
  if (op) cancelOp();
  if (drawing) { sketchVM.cancel(); endDraw(); }
  if (editing) sketchVM.complete();
  const f = store.project.features.find(x => x.id === id);
  if (!f) return;
  const { Graphic, projectOperator } = getSdk();
  const g = toSdk(f.geometry);
  if (!g) return;
  const graphic = new Graphic({ geometry: projectOperator.execute(g, view.spatialReference), symbol: symbolFor(f), attributes: { id } });
  const orig = featLayer.graphics.find(x => x.attributes && x.attributes.id === id);
  if (orig) orig.visible = false;
  sketchLayer.add(graphic);
  editing = { ids: [id], kind: 'reshape' };
  renderSelection(); renderEditTools();
  sketchVM.update(graphic, { tool: geomKind(f.geometry) === 'point' ? 'move' : 'reshape' });
  banner(t('areas.editBanner', { name: esc(f.name) }));
  setMode('reshape', t('sb.reshape'));
}
// the selected objects to the sketch at once: Move / rotate (points only move)
function startMove(ids) {
  const fs = ids.map(id => store.project.features.find(x => x.id === id)).filter(Boolean);
  if (!fs.length) return;
  if (op) cancelOp();
  if (drawing) { sketchVM.cancel(); endDraw(); }
  if (editing) sketchVM.complete();
  const { Graphic, projectOperator } = getSdk();
  const grs = [];
  for (const f of fs) {
    const g = toSdk(f.geometry);
    if (!g) continue;
    grs.push(new Graphic({ geometry: projectOperator.execute(g, view.spatialReference), symbol: symbolFor(f), attributes: { id: f.id } }));
    const orig = featLayer.graphics.find(x => x.attributes && x.attributes.id === f.id);
    if (orig) orig.visible = false;
  }
  if (!grs.length) return;
  sketchLayer.addMany(grs);
  editing = { ids: fs.map(f => f.id), kind: 'move' };
  renderSelection(); renderEditTools();
  const points = fs.some(f => geomKind(f.geometry) === 'point');
  sketchVM.update(grs, points ? { tool: 'move' } : { tool: 'transform', enableRotation: true, enableScaling: false });
  banner(t('edit.moveBanner'));
  setMode('move', t('sb.move'));
}
// the end of a reshape or a move: the new geometries go to the project (one step of the history), Esc keeps the old
function finishEdit(e) {
  if (!editing) return;
  editing = null;
  banner(null);
  setMode('select', t('sb.select'));
  const grs = e.graphics || [];
  const geoms = e.aborted ? [] : grs.map(gr => [gr.attributes && gr.attributes.id, toGeoJSON(gr.geometry)]).filter(([id, g]) => id && g);
  for (const gr of grs) sketchLayer.remove(gr);
  if (geoms.length) mutate(p => { for (const [id, g] of geoms) { const f = p.features.find(x => x.id === id); if (f) f.geometry = g; } });
  else render();
}

// ── the Layers panel ──
function onCatsClick(e) {
  const zc = e.target.closest('[data-zoomcat]');
  if (zc) { e.preventDefault(); e.stopPropagation(); zoomToFeatures(store.project.features.filter(f => f.category === zc.dataset.zoomcat).map(f => f.id)); return; }
  const z = e.target.closest('[data-zoom]');
  if (z) { e.preventDefault(); zoomToFeatures([z.dataset.zoom]); return; }
  const row = e.target.closest('.it[data-id]');
  if (row) pickRow(row, e);
}
// a row picks its object (Shift or Ctrl adds or removes it); the edit tools are in the ribbon of Site area
function pickRow(row, e) {
  const add = !!(e.shiftKey || e.ctrlKey || e.metaKey);
  selectFeatures([row.dataset.id], { add, toggle: add });
  if (currentTab() !== 'areas') showStep('areas');
}
// a new name for an object (the Rename of the Layers panel, the card of the selected object): one step of Undo
export function renameFeature(id, name) {
  const v = String(name ?? '').trim(), f = store.project.features.find(x => x.id === id);
  if (!f || !v || v === f.name) return false;
  mutate(p => { const g = p.features.find(x => x.id === id); if (g) g.name = v; });
  return true;
}
export function moveFeature(id, category) {
  const f = store.project.features.find(x => x.id === id);
  if (!f || f.category === category) return;
  if (!accepts(category, f.geometry)) {
    toast(t('areas.wrongGeom', { cat: t('cat.' + category), kind: t('geom.' + geomKind(f.geometry)) }), 'err');
    render();
    return;
  }
  openCats.add(category);
  mutate(p => {
    const g = p.features.find(x => x.id === id);
    g.category = category;
    g.attrs = { ...defaultAttrs(category), ...keepAttrs(g.attrs, category) };
  });
}
// attributes that still make sense in the new category (the type lists differ between categories)
function keepAttrs(attrs, category) {
  const allowed = CATEGORY[category].attrs;
  return Object.fromEntries(Object.entries(attrs || {}).filter(([k]) => allowed.includes(k) && k !== 'type'));
}

// ── rendering ──
function symbolFor(f) {
  const c = (CATEGORY[f.category] || CATEGORY.reference).colour;
  const kind = geomKind(f.geometry);
  if (kind === 'polygon') {
    const fillA = { gross: 0.05, net: 0.10, exclusion: 0.30, obstacle: 0.45, mitigation: 0.30, agri: 0.25, reference: 0.03 }[f.category] ?? 0.1;
    const ref = f.category === 'reference' || f.category === UNCLASSIFIED;   // dashed: shown, not counted
    return { type: 'simple-fill', color: [...c, fillA], outline: { color: c, width: ref ? 1 : 2, style: ref ? 'dash' : 'solid' } };
  }
  if (kind === 'line') {
    // dashed: underground cables, and connection routes not confirmed yet
    const dashed = (f.category === 'linear' && f.attrs?.type === 'underground-power') || (f.category === 'connection' && f.attrs?.type !== 'confirmed') || f.category === UNCLASSIFIED;
    return { type: 'simple-line', color: c, width: f.category === 'reference' ? 1.5 : f.category === 'connection' ? 3 : 2.5, style: dashed ? 'dash' : 'solid' };
  }
  const style = f.category === 'obstacle' ? ({ tree: 'circle', pole: 'x', building: 'square' }[f.attrs?.type] || 'diamond') : f.category === 'access' ? 'triangle' : 'circle';
  return { type: 'simple-marker', style, color: c, size: f.category === 'obstacle' ? 9 : 10, outline: { color: style === 'x' ? c : [255, 255, 255], width: style === 'x' ? 2 : 1 } };
}

// Buffers drawn on the map (what is actually cut around lines, points and polygons)
const BUFFER_SYMBOL = c => ({ type: 'simple-fill', color: [...c, 0.12], outline: { color: [...c, 0.7], width: 1, style: 'short-dot' } });

export function render() {
  const { Graphic, bufferOperator } = getSdk();
  featLayer.removeAll();
  const order = { reference: 0, gross: 1, net: 2, agri: 3, mitigation: 4, exclusion: 5, linear: 6, connection: 7, obstacle: 8, access: 9, [UNCLASSIFIED]: 10 };
  const feats = [...store.project.features].sort((a, b) => (order[a.category] ?? 0) - (order[b.category] ?? 0));
  const frame = siteFrame();
  const graphics = [];
  for (const f of feats) {
    if (!layerVisible('cat:' + f.category)) continue;   // switched off in the Layers panel (a view: it still counts)
    const geometry = toSdk(f.geometry);
    if (!geometry) continue;
    const d = cutDistance(f);
    if (frame && d > 0) {
      try {
        const b = bufferOperator.execute(frame.toLocal(geometry), d);
        if (b) graphics.push(new Graphic({ geometry: frame.toSr(b, view.spatialReference), symbol: BUFFER_SYMBOL(CATEGORY[f.category].colour) }));
      } catch (e) { console.warn('[areas] buffer', e); }
    }
    graphics.push(new Graphic({ geometry, symbol: symbolFor(f), attributes: { id: f.id } }));
  }
  featLayer.addMany(graphics);

  const pending = pendingCount();
  // only the groups that hold objects, Unclassified first
  $('areaCats').innerHTML = (catCard(CATEGORY[UNCLASSIFIED]) + CATEGORIES.map(catCard).join('')) || `<p class="hint coll-empty">${esc(t('coll.empty'))}</p>`;
  updateCollection([...(pending ? [{ id: UNCLASSIFIED, colour: CATEGORY[UNCLASSIFIED].colour, label: t('cat.' + UNCLASSIFIED), n: pending }] : []),
    ...CATEGORIES.map(c => ({ id: c.id, colour: c.colour, label: t('cat.' + c.id), n: store.project.features.filter(f => f.category === c.id).length }))]);
  renderHistory();
  $('boundarySetback').value = store.project.settings.boundarySetback;
  const rb = $('railAreas');
  if (rb) rb.textContent = store.project.features.length || '';
  renderSelection();
  renderDraw();
  renderSummarySoon();
}

// a group of the Layers panel: its name, count and magnifier, then its rows (nothing to edit there)
function catCard(c) {
  const items = store.project.features.filter(f => f.category === c.id);
  if (!items.length) return '';
  const zoom = esc(t('coll.zoomGroup', { cat: t('cat.' + c.id) }));
  const on = layerVisible('cat:' + c.id), show = esc(t('lay.show', { name: t('cat.' + c.id) }));
  // a row of the LayerList: the switch (a checkbox inside the summary toggles itself, not the group), the symbol,
  // the name with its hint as tooltip, the count, the magnifier; the objects below it
  return `<details class="cat${c.pending ? ' pending' : ''}${on ? '' : ' off'}" data-cat="${c.id}" style="--c:rgb(${c.colour.join(',')})" ${openCats.has(c.id) ? 'open' : ''}>
    <summary title="${esc(t('cat.' + c.id + '.hint'))}"><input type="checkbox" data-lay="cat:${c.id}" ${on ? 'checked' : ''} aria-label="${show}" title="${show}">
      <span class="sw ${c.pending ? 'dash line' : 'fill'}"></span><span class="ttl"><b>${esc(t('cat.' + c.id))}</b></span>
      <span class="cnt">${items.length}</span>
      <button type="button" class="zx" data-zoomcat="${c.id}" title="${zoom}" aria-label="${zoom}">${icon('search', 'sm')}</button></summary>
    <div class="catbody" role="listbox" aria-multiselectable="true" aria-label="${esc(t('cat.' + c.id))}">${items.map(row).join('')}</div>
  </details>`;
}
function row(f) {
  const sub = [f.sourceCategory, f.category === 'connection' ? `${fmt(lineLengthKm(f.geometry), 2)} km` : ''].filter(Boolean).join(' · ');
  const zoom = esc(t('coll.zoomTo', { name: f.name })), on = selection.has(f.id);
  return `<div class="it${on ? ' sel' : ''}" data-id="${f.id}" role="option" aria-selected="${on}" tabindex="0" title="${esc(t('coll.rowTitle'))}">
    <span class="nm">${esc(f.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    <button type="button" class="zx" data-zoom="${f.id}" title="${zoom}" aria-label="${zoom}">${icon('search', 'sm')}</button>
  </div>`;
}

// ── summary (areas in hectares) ──
let sumTimer = 0;
function renderSummarySoon() { clearTimeout(sumTimer); sumTimer = setTimeout(renderSummary, 150); }
function renderSummary() {
  const el = $('areaSummary');
  const frame = siteFrame();
  const r = frame ? computeArea(frame) : { error: 'noSite' };
  areasState.buildableArea = r.error ? null : r.buildableArea;
  refreshRail();
  if (r.error) { el.innerHTML = `<div class="hint">${esc(t('areas.noSite'))}</div>`; return; }
  // the ledger: gross − setback (or the net area as given) − exclusions (of which …) = buildable, one row per
  // item, the numbers aligned on the right, the cuts of the other steps as indented rows with a link to their step
  const ha = m2 => `${fmt(Math.max(0, m2) / 1e4, 2)} ha`;
  const row = (label, m2, cls = '', sign = '', go = '') =>
    `<div class="r ${cls}"><span>${sign}${esc(label)}${go ? ` <a href="#" data-goto="${go}">${esc(t(go === 'terrain' ? 'areas.goTerrain' : 'areas.goInfra'))} ›</a>` : ''}</span><b>${ha(m2)}</b></div>`;
  const rows = [];
  if (r.grossArea) rows.push(row(t('areas.sumGross'), r.grossArea));
  if (r.netMode === 'given') rows.push(row(t('areas.sumNetGiven'), r.netGivenArea));
  else if (r.setbackArea > 0) rows.push(row(t('areas.sumSetback', { m: fmt(store.project.settings.boundarySetback, 1) }), r.setbackArea, '', '− '));
  rows.push(row(t('areas.sumExcluded'), Math.max(0, r.baseArea - r.buildableArea), '', '− '));
  const byKind = kind => (r.extras || []).filter(x => x.kind === kind).reduce((s, x) => s + x.area, 0);
  const MIN = 50;   // m²: smaller shares are not worth a row
  const slope = byKind('slope'), fence = byKind('fence'), stations = byKind('station'), roadsDrawn = byKind('road');
  if (slope >= MIN) rows.push(row(t('areas.ofSlope'), slope, 'sub', '', 'terrain'));
  if (fence >= MIN) rows.push(row(t('areas.ofFence'), fence, 'sub', '', 'infra'));
  if (roadsDrawn >= MIN) rows.push(row(t('areas.ofRoads'), roadsDrawn, 'sub', '', 'infra'));
  if (stations >= MIN) rows.push(row(t('areas.ofStations'), stations, 'sub', '', 'infra'));
  rows.push(row(t('areas.sumBuildable'), r.buildableArea, 'tot', '= '));
  const spread = siteSpreadKm();
  const routes = routeSummary();
  el.innerHTML = `<div class="ledger">${rows.join('')}</div>
    <div class="hint">${esc(t(r.netMode === 'given' ? 'areas.modeGiven' : 'areas.modeComputed'))}</div>
    ${(r.notes || []).map(n => `<div class="hint">${esc(n)}</div>`).join('')}
    ${routes ? `<div class="hint">${esc(routes)}</div>` : ''}
    ${spread > SPREAD_WARN_KM ? `<div class="notice warn">${esc(t('warn.spread', { km: fmt(spread, 0) }))}</div>` : ''}
    ${r.ignored ? `<div class="notice warn">${esc(tn('warn.lineNoBuffer', r.ignored))}</div>` : ''}
    ${pendingCount() ? `<div class="notice warn">${esc(tn('areas.pending', pendingCount()))}</div>` : ''}
    ${r.netMode === 'given' && store.project.settings.boundarySetback > 0 ? `<div class="hint">${esc(t('areas.setbackIgnored'))}</div>` : ''}`;
}

// One project is one site: areas spread over tens of kilometres are most likely two sites mixed up. The local
// metric frame also degrades with distance from its centre (scale error 0.01 % at 90 km, 0.7 % at 750 km).
const SPREAD_WARN_KM = 30;
function siteSpreadKm() {
  const pts = sitePoints();
  if (pts.length < 2) return 0;
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const [x, y] of pts) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const cy = (ymin + ymax) / 2 * Math.PI / 180;
  return Math.hypot((xmax - xmin) * 111.32 * Math.cos(cy), (ymax - ymin) * 110.57);
}

// Length in km of a line on the ellipsoid (grid connection routes can run for kilometres outside the site)
export function lineLengthKm(geometry) {
  const g = toSdk(geometry);
  return g && g.type === 'polyline' ? getSdk().geodeticLengthOperator.execute(g, { unit: 'kilometers' }) : 0;
}
// Total length of the grid connection routes by type: "3.42 km estimated · 1.10 km confirmed"
function routeSummary() {
  const byType = new Map();
  for (const f of store.project.features) {
    if (f.category !== 'connection') continue;
    const ty = CATEGORY.connection.types.includes(f.attrs?.type) ? f.attrs.type : '';
    byType.set(ty, (byType.get(ty) || 0) + lineLengthKm(f.geometry));
  }
  const parts = [...byType].map(([ty, km]) => `${fmt(km, 2)} km ${ty ? t('type.' + ty).toLowerCase() : t('areas.routeNoType')}`);
  return parts.length ? t('areas.sumRoute', { list: parts.join(' · ') }) : '';
}

// ── map helpers ──
export function zoomToFeatures(ids) {
  if (!view) return;
  const { Extent } = getSdk();
  let ext = null;
  for (const f of store.project.features) {
    if (ids && !ids.includes(f.id)) continue;
    const g = toSdk(f.geometry);
    if (!g) continue;
    const e = g.type === 'point'
      ? new Extent({ xmin: g.x - 0.0005, ymin: g.y - 0.0005, xmax: g.x + 0.0005, ymax: g.y + 0.0005, spatialReference: g.spatialReference })
      : g.extent;
    if (e) ext = ext ? ext.union(e) : e.clone();
  }
  if (ext) view.goTo(ext.expand(1.3)).catch(() => {});
}

// objects drawn without a category, waiting in the Layers panel (counted nowhere, exported nowhere)
export const pendingCount = () => store.project.features.filter(f => f.category === UNCLASSIFIED).length;
function sitePolygons() {
  return store.project.features.filter(f => (f.category === 'gross' || f.category === 'net') && geomKind(f.geometry) === 'polygon');
}
function sitePoints() {
  const pts = [];
  for (const f of sitePolygons()) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) for (const r of p) for (let i = 0; i < r.length; i += Math.max(1, Math.floor(r.length / 40))) pts.push(r[i]);
  }
  return pts;
}

// Local frame centred on the site (gross and net polygons); cached while the site centre does not move
let frameCache = { key: '', frame: null };
export function siteFrame() {
  const pts = sitePoints();
  if (!pts.length) return null;
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const [x, y] of pts) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const lon0 = +((xmin + xmax) / 2).toFixed(7), lat0 = +((ymin + ymax) / 2).toFixed(7);
  const key = `${lon0},${lat0}`;
  if (frameCache.key !== key) frameCache = { key, frame: makeLocalFrame({ lon0, lat0 }) };
  return frameCache.frame;
}

// Distance cut around an object: its buffer, or half the width of a mitigation / agricultural strip
export function cutDistance(f) {
  const c = CATEGORY[f.category];
  if (!c || !c.cuts) return 0;
  const a = f.attrs || {};
  if (f.category === 'mitigation' || f.category === 'agri') return geomKind(f.geometry) === 'polygon' ? 0 : (Number(a.width) || 0) / 2;
  return Number(a.buffer) || 0;
}

// Buildable area: the net areas if given, otherwise the gross area minus the boundary setback; then minus every
// object of a "cutting" category (exclusions, linear infrastructure, obstacles, mitigation, agricultural zones)
// with its own buffer. Lines and points need a buffer (or a width) to cut anything.
export function computeArea(frame) {
  const S = getSdk();
  const P = store.project;
  const toLocal = f => { const g = toSdk(f.geometry); const l = g && frame.toLocal(g); return l ? S.simplifyOperator.execute(l) : null; };
  const polys = cat => P.features.filter(f => f.category === cat && geomKind(f.geometry) === 'polygon').map(toLocal).filter(g => g && g.rings && g.rings.length);
  const union = arr => (arr.length > 1 ? S.unionOperator.executeMany(arr) : arr[0] || null);
  const area = g => (g && g.rings && g.rings.length ? S.areaOperator.execute(g) : 0);
  const gross = union(polys('gross'));
  const netGiven = union(polys('net'));
  let base, netMode;
  if (netGiven) { base = netGiven; netMode = 'given'; }
  else if (gross) { base = P.settings.boundarySetback > 0 ? S.bufferOperator.execute(gross, -P.settings.boundarySetback) : gross; netMode = 'computed'; }
  else return { error: 'noSite' };
  const cuts = [];
  let ignored = 0;
  for (const f of P.features) {
    const c = CATEGORY[f.category];
    if (!c || !c.cuts) continue;
    const l = toLocal(f);
    if (!l) continue;
    const d = cutDistance(f);
    if (l.type === 'polygon') cuts.push(d > 0 ? S.bufferOperator.execute(l, d) : l);
    else if (d > 0) cuts.push(S.bufferOperator.execute(l, d));
    else ignored++;
  }
  const catCuts = union(cuts.filter(g => g && g.rings && g.rings.length));
  const pre = catCuts ? S.differenceOperator.execute(base, catCuts) : base;
  const notes = [], extras = [];
  for (const fn of extraCuts) {
    let r = null;
    try { r = fn(frame, { base, pre }); } catch (e) { console.warn('[areas] extra cut', e); }
    for (const x of Array.isArray(r) ? r : [r]) {
      if (x && x.note) notes.push(x.note);
      if (x && x.geometry && x.geometry.rings && x.geometry.rings.length) extras.push(x);
    }
  }
  const extraAll = union(extras.map(x => x.geometry));
  const buildable = pre && extraAll ? S.differenceOperator.execute(pre, extraAll) : pre;
  const buildableArea = area(buildable);
  const grossArea = area(gross), baseArea = area(base);
  // area each extra cut takes from the base (it may overlap other cuts)
  for (const x of extras) { const i = S.intersectionOperator.execute(base, x.geometry); x.area = area(i); }
  return { gross, grossArea, netGivenArea: area(netGiven), base, baseArea, netMode, pre,
    setbackArea: netMode === 'computed' ? Math.max(0, grossArea - baseArea) : 0,
    buildable: buildableArea > 0 ? buildable : null, buildableArea, ignored, siteArea: grossArea || area(netGiven), notes, extras };
}

// ── coordinate system chosen from the site location ──
function updateCrs(announce) {
  const pts = sitePoints();
  if (!pts.length) { crsState.alerts = []; crsState.suggested = null; crsState.iso = null; emit('crs'); return; }
  const s = suggestCrs(pts);
  crsState.alerts = s.alerts;
  crsState.suggested = s.wkid;
  crsState.iso = s.iso;
  const c = store.project.crs;
  if (c.auto && s.wkid && c.wkid !== s.wkid) {
    c.wkid = s.wkid; c.country = s.iso; saveSoon();
    if (announce) toast(t('crs.autoToast', { label: crsLabel(s.wkid), wkid: s.wkid }), '', 9000);
  }
  emit('crs');
}
