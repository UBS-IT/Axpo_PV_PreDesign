// Step 1 · Areas: objects by category (gross, net, exclusions, linear infrastructure, obstacles, access,
// mitigation, agricultural zones, reference), import and drawing, drag and drop between categories, and the
// buildable area in the local metric frame.
import { getSdk } from './sdk.js';
import { store, change, on, emit, uid, saveSoon, geomKind } from './state.js';
import { t, tn, fmt } from './i18n.js';
import { CATEGORIES, CATEGORY, POWER_TYPES, accepts, classify } from './categories.js';
import { toSdk, toGeoJSON, reprojectToWgs84, projectPointToWgs84, wktName } from './geo/convert.js';
import { makeLocalFrame } from './geo/localframe.js';
import { readAnyFile } from './io/importers.js';
import { suggestCrs, candidatesForProjected, crsLabel } from './crs.js';
import { chooseCrs } from './ui/crsdialog.js';
import { toast } from './ui/toast.js';

let view, featLayer, sketchLayer, sketchVM;
let drawing = null;          // { category, tool }
let editing = null;          // { id }
export const crsState = { alerts: [], suggested: null, iso: null };
// Other cuts of the buildable area, registered by other steps (terrain: slopes over the limit of the structure;
// infrastructure: fence clearance, stations). fn(frame, { base, pre }) -> null | { geometry (polygon in the frame),
// kind, label } | { note } (a message for the results). pre = base minus the objects of the Areas step: the land
// the plant can use, around which the fence runs.
export const extraCuts = [];
const openCats = new Set(['gross', 'net', 'exclusion']);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DRAG_TYPE = 'application/x-pvp-feature';

export function initAreas(mapView) {
  view = mapView;
  const { GraphicsLayer, SketchViewModel } = getSdk();
  featLayer = new GraphicsLayer({ title: 'Areas' });
  sketchLayer = new GraphicsLayer({ title: 'Sketch', listMode: 'hide' });
  view.map.addMany([featLayer, sketchLayer]);
  sketchVM = new SketchViewModel({ view, layer: sketchLayer, updateOnGraphicClick: false });
  try {
    sketchVM.snappingOptions = { enabled: true, selfEnabled: true, featureEnabled: true, featureSources: [{ layer: featLayer, enabled: true }] };
    sketchVM.tooltipOptions = { enabled: true, inputEnabled: true };
    sketchVM.labelOptions = { enabled: true };
  } catch (e) { console.warn('[areas] sketch options', e); }
  sketchVM.on('create', e => {
    if (e.state === 'complete') finishDraw(e.graphic);
    else if (e.state === 'cancel') endDraw();
  });
  sketchVM.on('update', e => { if (e.state === 'complete') finishEdit(e); });
  window.__sketch = sketchVM;   // debug hook
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawing) { sketchVM.cancel(); endDraw(); } });

  // file picker (the Import buttons) and drop on the category cards
  const input = $('fileImport');
  $('areasImport').onclick = () => pickFiles(null);
  input.onchange = async () => {
    const files = [...(input.files || [])], cat = input.dataset.category || null;
    input.value = '';
    if (files.length) await importFiles(files, cat);
  };
  const cats = $('areaCats');
  cats.addEventListener('click', onCatsClick);
  cats.addEventListener('change', onCatsChange);
  cats.addEventListener('dblclick', onRename);
  cats.addEventListener('toggle', e => {
    const d = e.target;
    if (d.classList && d.classList.contains('cat')) { if (d.open) openCats.add(d.dataset.cat); else openCats.delete(d.dataset.cat); }
  }, true);
  cats.addEventListener('dragstart', e => {
    const row = e.target.closest && e.target.closest('.it[data-id]');
    if (!row) return;
    e.dataTransfer.setData(DRAG_TYPE, row.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setDragImage(row, 12, 12); } catch {}
    row.classList.add('dragging');
    cats.classList.add('dragging');
  });
  cats.addEventListener('dragend', e => {
    const r = e.target.closest && e.target.closest('.it');
    if (r) r.classList.remove('dragging');
    cats.classList.remove('dragging');
    clearDrop();
  });
  cats.addEventListener('dragover', e => {
    const card = e.target.closest('.cat');
    if (!card) return;
    const types = [...e.dataTransfer.types];
    if (types.includes(DRAG_TYPE) || types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = types.includes(DRAG_TYPE) ? 'move' : 'copy';
      clearDrop(card);
      card.classList.add('drop');
    }
  });
  cats.addEventListener('dragleave', e => { const card = e.target.closest('.cat'); if (card && !card.contains(e.relatedTarget)) card.classList.remove('drop'); });
  cats.addEventListener('drop', async e => {
    const card = e.target.closest('.cat');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    clearDrop();
    const cat = card.dataset.cat;
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (id) moveFeature(id, cat);
    else if (e.dataTransfer.files && e.dataTransfer.files.length) await importFiles([...e.dataTransfer.files], cat);
  });

  const sb = $('boundarySetback');
  sb.onchange = () => change('settings', p => { p.settings.boundarySetback = Math.max(0, Number(sb.value) || 0); });

  on('site', () => { render(); updateCrs(true); });
  on('terrain', renderSummarySoon);
  on('infra', renderSummarySoon);
  on('field', renderSummarySoon);   // the slope limit depends on the structure
  on('settings', () => { $('boundarySetback').value = store.project.settings.boundarySetback; renderSummarySoon(); });
  on('project', () => { render(); updateCrs(false); zoomToFeatures(); });
  render();
  updateCrs(false);
}

function clearDrop(except) { document.querySelectorAll('#areaCats .cat.drop').forEach(c => { if (c !== except) c.classList.remove('drop'); }); }

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
        added.push({ id: uid(), name: f.name, category: cls.category, geometry: f.geometry, source: r.type,
          sourceCategory: f.sourceCategory || '', attrs: cls.attrs || {} });
      }
      const byCat = {};
      added.forEach(a => { byCat[a.category] = (byCat[a.category] || 0) + 1; });
      Object.keys(byCat).forEach(c => openCats.add(c));
      // an untitled project takes the name of a Geoportale project, or of the first file imported into it
      const rename = !store.project.name || store.project.name === 'Untitled project' ? (r.type === 'axpo' || !store.project.features.length ? r.name : null) : null;
      change('site', p => {
        p.features.push(...added);
        if (rename) p.name = rename;
      });
      if (rename) emit('name');
      total += added.length;
      const summary = CATEGORIES.filter(c => byCat[c.id]).map(c => `${t('cat.' + c.id)} ${byCat[c.id]}`).join(', ');
      toast(tn('areas.imported', added.length, { file: file.name, summary }), 'ok', 9000);
      if (refused) toast(tn('areas.refused', refused, { cat: t('cat.' + category) }), '', 9000);
    } catch (e) {
      console.error(e);
      toast(t('toast.importFail', { file: file.name, err: e.message || e }), 'err', 10000);
    }
  }
  if (total) zoomToFeatures();
  return total;
}

// ── drawing ──
function startDraw(category, tool) {
  if (editing) sketchVM.complete();
  if (drawing && drawing.category === category && drawing.tool === tool) { sketchVM.cancel(); endDraw(); return; }
  if (drawing) sketchVM.cancel();
  drawing = { category, tool };
  const c = CATEGORY[category].colour;
  sketchVM.polygonSymbol = { type: 'simple-fill', color: [...c, 0.12], outline: { color: c, width: 2 } };
  sketchVM.polylineSymbol = { type: 'simple-line', color: c, width: 2.5 };
  sketchVM.pointSymbol = { type: 'simple-marker', color: c, size: 9, outline: { color: [255, 255, 255], width: 1 } };
  sketchVM.create(tool, tool === 'point' ? undefined : { mode: 'click' });
  markDrawButtons();
  banner(t(tool === 'point' ? 'areas.drawPointBanner' : 'areas.drawBanner', { cat: esc(t('cat.' + category)) }));
}
function markDrawButtons() {
  document.querySelectorAll('#areaCats .drawbtn[data-tool]').forEach(b => b.classList.toggle('active', !!drawing && b.dataset.cat === drawing.category && b.dataset.tool === drawing.tool));
}
function endDraw() {
  drawing = null;
  markDrawButtons();
  banner(null);
}
function banner(html) {
  const b = $('banner');
  if (html) { b.innerHTML = html; b.hidden = false; } else b.hidden = true;
}
function finishDraw(graphic) {
  const d = drawing;
  sketchLayer.remove(graphic);
  const geometry = toGeoJSON(graphic.geometry);
  if (geometry && d) {
    const n = store.project.features.filter(f => f.category === d.category).length + 1;
    openCats.add(d.category);
    change('site', p => p.features.push({ id: uid(), name: `${t('cat.' + d.category + '.one')} ${n}`, category: d.category, geometry, source: 'drawn', sourceCategory: '', attrs: defaultAttrs(d.category) }));
  }
  // points (trees, poles…) are placed one after the other until Esc; shapes stop after one
  if (d && d.tool === 'point') { drawing = null; startDraw(d.category, d.tool); }
  else endDraw();
}
function defaultAttrs(category) {
  if (category === 'obstacle') return { type: 'tree' };
  if (category === 'access') return { type: 'site-access' };
  if (category === 'connection') return { type: 'estimated' };
  if (category === 'linear') return { type: 'other' };
  return {};
}

// ── reshaping an existing object ──
function startEdit(id) {
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
  editing = { id };
  sketchVM.update(graphic, { tool: geomKind(f.geometry) === 'point' ? 'move' : 'reshape' });
  banner(t('areas.editBanner', { name: esc(f.name) }));
}
function finishEdit(e) {
  if (!editing) return;
  const id = editing.id;
  editing = null;
  banner(null);
  const gr = e.graphics && e.graphics[0];
  const geometry = gr && !e.aborted ? toGeoJSON(gr.geometry) : null;
  if (gr) sketchLayer.remove(gr);
  if (geometry) change('site', p => { const f = p.features.find(x => x.id === id); if (f) f.geometry = geometry; });
  else render();
}

// ── list events ──
function onCatsClick(e) {
  const draw = e.target.closest('.drawbtn[data-tool]');
  if (draw) { e.preventDefault(); startDraw(draw.dataset.cat, draw.dataset.tool); return; }
  const imp = e.target.closest('.drawbtn[data-imp]');
  if (imp) { e.preventDefault(); pickFiles(imp.dataset.imp); return; }
  const del = e.target.closest('button[data-del]');
  if (del) { change('site', p => { p.features = p.features.filter(x => x.id !== del.dataset.del); }); return; }
  const ed = e.target.closest('button[data-edit]');
  if (ed) { startEdit(ed.dataset.edit); return; }
  const clr = e.target.closest('button[data-clear]');
  if (clr) {
    const c = clr.dataset.clear, n = store.project.features.filter(f => f.category === c).length;
    if (confirm(t('areas.clearConfirm', { n, cat: t('cat.' + c) }))) change('site', p => { p.features = p.features.filter(f => f.category !== c); });
    return;
  }
  const zoom = e.target.closest('[data-zoom]');
  if (zoom) zoomToFeatures([zoom.dataset.zoom]);
}
function onCatsChange(e) {
  const el = e.target;
  const id = el.dataset.id;
  if (!id) return;
  if (el.classList.contains('mv')) { moveFeature(id, el.value); return; }
  const attr = el.dataset.attr;
  if (attr) change('site', p => {
    const f = p.features.find(x => x.id === id);
    if (!f) return;
    f.attrs = f.attrs || {};
    const v = el.type === 'number' ? (el.value === '' ? undefined : Math.max(0, Number(el.value))) : el.value;
    if (v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) delete f.attrs[attr]; else f.attrs[attr] = v;
    if (attr === 'type' && !POWER_TYPES.includes(f.attrs.type)) delete f.attrs.voltage;   // tension only for power lines
  });
}
function onRename(e) {
  const nm = e.target.closest('.nm[data-zoom]');
  if (!nm) return;
  const f = store.project.features.find(x => x.id === nm.dataset.zoom);
  if (!f) return;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.value = f.name; inp.className = 'rename';
  nm.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (ok && v && v !== f.name) change('site', p => { const g = p.features.find(x => x.id === f.id); if (g) g.name = v; });
    else render();
  };
  inp.onkeydown = ev => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
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
  change('site', p => {
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
    const ref = f.category === 'reference';
    return { type: 'simple-fill', color: [...c, fillA], outline: { color: c, width: ref ? 1 : 2, style: ref ? 'dash' : 'solid' } };
  }
  if (kind === 'line') {
    // dashed: underground cables, and connection routes not confirmed yet
    const dashed = (f.category === 'linear' && f.attrs?.type === 'underground-power') || (f.category === 'connection' && f.attrs?.type !== 'confirmed');
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
  const order = { reference: 0, gross: 1, net: 2, agri: 3, mitigation: 4, exclusion: 5, linear: 6, connection: 7, obstacle: 8, access: 9 };
  const feats = [...store.project.features].sort((a, b) => (order[a.category] ?? 0) - (order[b.category] ?? 0));
  const frame = siteFrame();
  const graphics = [];
  for (const f of feats) {
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

  $('areaCats').innerHTML = CATEGORIES.map(catCard).join('');
  markDrawButtons();
  $('boundarySetback').value = store.project.settings.boundarySetback;
  const rb = $('railAreas');
  if (rb) rb.textContent = store.project.features.length || '';
  renderSummarySoon();
}

const TOOL_ICON = {
  polygon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5l6-3 5 4-2 7-8 1z"/></svg>',
  polyline: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13l4-6 4 3 4-7"/></svg>',
  point: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/></svg>',
  import: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11V2M4.5 5.5L8 2l3.5 3.5M2.5 11v3h11v-3"/></svg>',
};
function catCard(c) {
  const items = store.project.features.filter(f => f.category === c.id);
  const tools = c.geom.map(g => (g === 'line' ? 'polyline' : g));
  const tip = tool => esc(t('areas.drawTool', { tool: t('tool.' + tool), cat: t('cat.' + c.id) }));
  const imp = esc(t('areas.importInto', { cat: t('cat.' + c.id) }));
  const draw = tools.map(tool => `<button type="button" class="drawbtn" data-cat="${c.id}" data-tool="${tool}" title="${tip(tool)}" aria-label="${tip(tool)}">${TOOL_ICON[tool]}<span>${esc(t('tool.' + tool + '.short'))}</span></button>`).join('')
    + `<button type="button" class="drawbtn" data-imp="${c.id}" title="${imp}" aria-label="${imp}">${TOOL_ICON.import}<span>${esc(t('tool.import.short'))}</span></button>`;
  return `<details class="cat" data-cat="${c.id}" style="--c:rgb(${c.colour.join(',')})" ${openCats.has(c.id) ? 'open' : ''}>
    <summary><span class="ttl"><b>${esc(t('cat.' + c.id))}</b><small>${esc(t('cat.' + c.id + '.hint'))}</small></span>
      <span class="cnt">${items.length || ''}</span></summary>
    <div class="draws">${draw}</div>
    <div class="catbody">${items.length ? items.map(f => row(f, c)).join('') : `<div class="empty">${esc(t('areas.emptyCat'))}</div>`}</div>
    ${items.length > 1 ? `<div class="catfoot"><button type="button" class="linkbtn" data-clear="${c.id}">${esc(t('areas.clearAll', { n: items.length }))}</button></div>` : ''}
  </details>`;
}

function row(f, c) {
  const a = f.attrs || {};
  const kind = geomKind(f.geometry);
  const inputs = [];
  if (c.attrs.includes('type')) {
    const none = c.types.includes(a.type) ? '' : `<option value="" selected>${esc(t('type.none'))}</option>`;
    inputs.push(`<select data-id="${f.id}" data-attr="type" title="${esc(t('attr.type'))}" aria-label="${esc(t('attr.type'))}">${none}${c.types.map(ty => `<option value="${ty}" ${a.type === ty ? 'selected' : ''}>${esc(t('type.' + ty))}</option>`).join('')}</select>`);
  }
  if (c.attrs.includes('height')) inputs.push(num(f, 'height', a.height, t('attr.height')));
  if (c.attrs.includes('buffer')) inputs.push(num(f, 'buffer', a.buffer, t('attr.buffer'), kind !== 'polygon' && !(a.buffer > 0)));
  if (c.attrs.includes('voltage') && POWER_TYPES.includes(a.type)) inputs.push(num(f, 'voltage', a.voltage, t('attr.voltage')));
  if (c.attrs.includes('width') && kind === 'line') inputs.push(num(f, 'width', a.width, t('attr.width'), !(a.width > 0)));
  const moveOpts = CATEGORIES.filter(x => x.geom.includes(kind)).map(x => `<option value="${x.id}" ${x.id === f.category ? 'selected' : ''}>${esc(t('cat.' + x.id))}</option>`).join('');
  const sub = [f.sourceCategory, f.category === 'connection' ? `${fmt(lineLengthKm(f.geometry), 2)} km` : ''].filter(Boolean).join(' · ');
  return `<div class="it" data-id="${f.id}">
    <span class="grip" draggable="true" title="${esc(t('areas.dragTitle'))}" aria-hidden="true">⠿</span>
    <span class="nm" data-zoom="${f.id}" draggable="true" title="${esc(t('areas.rowTitle'))}">${esc(f.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    <select class="mv" data-id="${f.id}" title="${esc(t('areas.moveTo'))}" aria-label="${esc(t('areas.moveTo'))}">${moveOpts}</select>
    <button type="button" class="x ed" data-edit="${f.id}" title="${esc(t('areas.edit'))}" aria-label="${esc(t('areas.edit'))}">✎</button>
    <button type="button" class="x" data-del="${f.id}" title="${esc(t('areas.remove'))}" aria-label="${esc(t('areas.remove'))}">×</button>
    ${inputs.length ? `<span class="attrs">${inputs.join('')}</span>` : ''}
  </div>`;
}
function num(f, attr, v, label, missing = false) {
  return `<label class="ai${missing ? ' miss' : ''}"><span>${esc(label)}</span><input type="number" min="0" step="0.5" data-id="${f.id}" data-attr="${attr}" value="${v ?? ''}"></label>`;
}

// ── summary (areas in hectares) ──
let sumTimer = 0;
function renderSummarySoon() { clearTimeout(sumTimer); sumTimer = setTimeout(renderSummary, 150); }
function renderSummary() {
  const el = $('areaSummary');
  const frame = siteFrame();
  if (!frame) { el.innerHTML = `<div class="hint">${esc(t('areas.noSite'))}</div>`; return; }
  const r = computeArea(frame);
  if (r.error) { el.innerHTML = `<div class="hint">${esc(t('areas.noSite'))}</div>`; return; }
  const ha = m2 => `${fmt(m2 / 1e4, 2)} ha`;
  const minus = m2 => (m2 >= 5 ? `− ${fmt(m2 / 1e4, 2)} ha` : '0 ha');
  const k = [];
  if (r.grossArea) k.push(kpi(ha(r.grossArea), t('areas.sumGross')));
  if (r.netMode === 'given') k.push(kpi(ha(r.netGivenArea), t('areas.sumNetGiven')));
  else if (r.setbackArea > 0) k.push(kpi(minus(r.setbackArea), t('areas.sumSetback', { m: fmt(store.project.settings.boundarySetback, 1) })));
  k.push(kpi(minus(Math.max(0, r.baseArea - r.buildableArea)), t('areas.sumExcluded')));
  const byKind = kind => (r.extras || []).filter(x => x.kind === kind).reduce((s, x) => s + x.area, 0);
  const slope = byKind('slope'), fence = byKind('fence'), stations = byKind('station'), roadsDrawn = byKind('road');
  k.push(kpi(ha(r.buildableArea), t('areas.sumBuildable'), 'big'));
  const spread = siteSpreadKm();
  const routes = routeSummary();
  el.innerHTML = `<div class="kpis">${k.join('')}</div>
    <div class="hint">${esc(t(r.netMode === 'given' ? 'areas.modeGiven' : 'areas.modeComputed'))}</div>
    ${slope >= 5 ? `<div class="hint">${esc(t('areas.sumSlope', { ha: fmt(slope / 1e4, 2) }))}</div>` : ''}
    ${fence + stations + roadsDrawn >= 5 ? `<div class="hint">${esc(t('areas.sumInfra', { fence: fmt(fence / 1e4, 2), roads: fmt(roadsDrawn / 1e4, 2), stations: fmt(stations / 1e4, 2) }))}</div>` : ''}
    ${(r.notes || []).map(n => `<div class="hint">${esc(n)}</div>`).join('')}
    ${routes ? `<div class="hint">${esc(routes)}</div>` : ''}
    ${spread > SPREAD_WARN_KM ? `<div class="warn">${esc(t('warn.spread', { km: fmt(spread, 0) }))}</div>` : ''}
    ${r.ignored ? `<div class="warn">${esc(tn('warn.lineNoBuffer', r.ignored))}</div>` : ''}
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
const kpi = (v, k, cls = '') => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="k">${esc(k)}</div></div>`;

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
