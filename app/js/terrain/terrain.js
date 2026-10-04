// Step 2 · Terrain (optional). The terrain is sampled on a grid in the local metric frame of the site, from Esri World
// Elevation or from a DTM / DSM of the user (GeoTIFF). From the grid come the slope map (classes in percent) and,
// with the slope limit of the chosen structure (catalog slopeLimits: fixed 3V 10 % N-S and E-W, tracker 1V 15 % in
// every direction), the areas cut from the buildable area. No terrain, no cut: the step is optional. It needs the
// site (1 · Site) and the structure of 3 · Layout, which can also be chosen here.
import { getSdk } from '../sdk.js';
import { store, change, on, emit, uid } from '../state.js';
import { t, tn, fmt } from '../i18n.js';
import { siteFrame, extraCuts, importHooks, removeFeatures } from '../areas.js';
import { makeLocalFrame } from '../geo/localframe.js';
import { toSdk } from '../geo/convert.js';
import { slopeLimitFor } from '../catalog.js';
import { parseNotation } from '../layout/structures.js';
import { candidatesForProjected, crsLabel, looksProjected } from '../crs.js';
import { projectPointToWgs84 } from '../geo/convert.js';
import { chooseCrs } from '../ui/crsdialog.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { stepProvider } from '../ui/rail.js';
import { applyStandard } from '../field.js';
import { gradients, limitMask, classMask, dropSmallPatches, maskToRings, SLOPE_CLASSES, gridOver, bilinear } from './slope.js';
import { terrainData, setTerrainData, saveLocal, loadLocal, clearLocal } from './store.js';
import { openGeoTiff } from './dtm.js';

const ESRI_ELEVATION = 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';
const CLASS_COLOURS = [[46, 160, 67], [160, 200, 60], [240, 190, 40], [235, 110, 40], [190, 30, 60]];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let view = null, layer = null, busy = false;

// ── grid of the site ──
// Local bounding box of the gross and net areas in the frame of the site
function siteBox(frame) {
  let b = null;
  for (const f of store.project.features) {
    if (f.category !== 'gross' && f.category !== 'net') continue;
    const g = toSdk(f.geometry), l = g && frame.toLocal(g);
    const e = l && l.extent;
    if (!e) continue;
    b = b ? { xmin: Math.min(b.xmin, e.xmin), ymin: Math.min(b.ymin, e.ymin), xmax: Math.max(b.xmax, e.xmax), ymax: Math.max(b.ymax, e.ymax) }
      : { xmin: e.xmin, ymin: e.ymin, xmax: e.xmax, ymax: e.ymax };
  }
  return b;
}
export function gridForSite(cellSize = store.project.terrain.cellSize) {
  const frame = siteFrame();
  if (!frame) return null;
  const box = siteBox(frame);
  return box ? { frame, def: gridOver(box, cellSize) } : null;
}
// centres of the cells as an SDK multipoint in the frame (k × k points per cell when k > 1, for averaging)
function centres(frame, def, k = 1) {
  const { Multipoint } = getSdk();
  const pts = [];
  for (let j = 0; j < def.ny; j++) for (let i = 0; i < def.nx; i++) for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) {
    pts.push([def.x0 + (i + (a + 0.5) / k) * def.cell, def.y0 + (j + (b + 0.5) / k) * def.cell]);
  }
  return new Multipoint({ points: pts, spatialReference: frame.sr });
}
function describe(frame, def, z, extra) {
  let zmin = Infinity, zmax = -Infinity, missing = 0;
  for (const v of z) { if (Number.isFinite(v)) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; } else missing++; }
  return { id: uid(), lon0: frame.lon0, lat0: frame.lat0, x0: def.x0, y0: def.y0, cell: def.cell, nx: def.nx, ny: def.ny,
    zmin: Number.isFinite(zmin) ? zmin : null, zmax: Number.isFinite(zmax) ? zmax : null, missing, loadedAt: new Date().toISOString(), ...extra };
}

// ── sources ──
// Esri World Elevation (global service; resolution depends on the country)
export async function sampleEsri(frame, def, query = null) {
  const { ElevationLayer, Multipoint, SpatialReference, projectOperator } = getSdk();
  const wgs = projectOperator.execute(centres(frame, def), SpatialReference.WGS84).points;
  let run = query;
  if (!run) {
    const el = new ElevationLayer({ url: ESRI_ELEVATION });
    await el.load();
    run = mp => el.queryElevation(mp, { demResolution: 'finest-contiguous', noDataValue: -99999 }).then(r => r.geometry.points.map(p => p[2]));
  }
  const z = new Float32Array(wgs.length);
  const CHUNK = 5000;
  for (let s = 0; s < wgs.length; s += CHUNK) {
    const part = wgs.slice(s, s + CHUNK);
    const zs = await run(new Multipoint({ points: part, spatialReference: SpatialReference.WGS84 }));
    zs.forEach((v, i) => { z[s + i] = v === -99999 || !Number.isFinite(v) ? NaN : v; });
  }
  return z;
}

// A GeoTIFF of the user, in any system the projection engine knows (datum shifts applied by the SDK)
export async function sampleDtm(file, frame, def, askCrs = askTiffCrs) {
  const { SpatialReference, projectOperator } = getSdk();
  const tif = await openGeoTiff(file);
  let wkid = tif.epsg;
  if (!wkid) wkid = await askCrs(file, tif);
  if (!wkid) return null;
  const sr = new SpatialReference({ wkid });
  // averaging: up to 4 × 4 points per cell when the model is finer than the grid
  const k = Math.max(1, Math.min(4, Math.round(def.cell / Math.abs(tif.res[0])), Math.floor(Math.sqrt(4e6 / (def.nx * def.ny)))));
  const pts = projectOperator.execute(centres(frame, def, k), sr)?.points;
  if (!pts) throw new Error(t('err.tiffProjection', { wkid }));
  // pixel positions (from the centre of the first pixel) and the window that holds them
  const u = new Float64Array(pts.length), v = new Float64Array(pts.length);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let n = 0; n < pts.length; n++) {
    u[n] = (pts[n][0] - tif.origin[0]) / tif.res[0]; v[n] = (pts[n][1] - tif.origin[1]) / tif.res[1];
    if (u[n] < umin) umin = u[n]; if (u[n] > umax) umax = u[n]; if (v[n] < vmin) vmin = v[n]; if (v[n] > vmax) vmax = v[n];
  }
  const c0 = Math.max(0, Math.floor(umin) - 1), r0 = Math.max(0, Math.floor(vmin) - 1);
  const c1 = Math.min(tif.width, Math.ceil(umax) + 2), r1 = Math.min(tif.height, Math.ceil(vmax) + 2);
  if (c1 <= c0 || r1 <= r0) throw new Error(t('err.tiffOutside'));
  if ((c1 - c0) * (r1 - r0) > 60e6) throw new Error(t('err.tiffTooLarge'));
  const win = await tif.read(c0, r0, c1, r1), w = c1 - c0, h = r1 - r0;
  const z = new Float32Array(def.nx * def.ny);
  const kk = k * k;
  for (let cellIx = 0; cellIx < z.length; cellIx++) {
    let s = 0, n = 0;
    for (let q = 0; q < kk; q++) {
      const p = cellIx * kk + q;
      const val = bilinear(win, w, h, u[p] - c0, v[p] - r0, tif.noData);
      if (Number.isFinite(val)) { s += val; n++; }
    }
    // a cell only partly covered by the model is unknown: the mean of part of it is not the elevation of its centre
    z[cellIx] = n === kk ? s / n : NaN;
  }
  return { z, wkid, res: Math.abs(tif.res[0]) };
}

// A GeoTIFF that does not say its system: the national systems that put it in their own country are proposed
async function askTiffCrs(file, tif) {
  const [xmin, ymin, xmax, ymax] = tif.bbox;
  const sample = [[xmin, ymin], [xmax, ymax], [(xmin + xmax) / 2, (ymin + ymax) / 2]];
  if (!looksProjected(sample)) return 4326;
  const cands = candidatesForProjected(sample, projectPointToWgs84);
  return chooseCrs({ file: file.name, candidates: cands, current: store.project.crs.wkid,
    validate: w => sample.every(p => { const ll = projectPointToWgs84(w, p); return ll && Math.abs(ll[0]) <= 180 && Math.abs(ll[1]) <= 90; }) });
}

// ── keeping the grid ──
export async function useGrid(meta, z, { persist = true } = {}) {
  setTerrainData(meta, z);
  if (persist) await saveLocal(meta, z);
  cache.clear();
  change('terrain', p => { p.terrain.grid = meta; p.terrain.source = meta.source; });
}
export async function removeTerrain() {
  setTerrainData(null, null);
  cache.clear();
  await clearLocal();
  change('terrain', p => { p.terrain.grid = null; p.terrain.source = null; });
}
// kind 'esri' or 'dtm' (with the file); true when a terrain was loaded
export async function loadTerrain(kind, file = null) {
  if (busy) return false;
  const g = gridForSite();
  if (!g) { toast(t('terrain.noSite'), 'err'); return false; }
  busy = true;
  status(t(kind === 'esri' ? 'terrain.loadingEsri' : 'terrain.loadingDtm', { cells: fmt(g.def.nx * g.def.ny) }));
  try {
    let meta, z;
    if (kind === 'esri') {
      z = await sampleEsri(g.frame, g.def);
      meta = describe(g.frame, g.def, z, { source: 'esri', name: 'Esri World Elevation' });
    } else {
      const r = await sampleDtm(file, g.frame, g.def);
      if (!r) { status(''); return false; }
      z = r.z;
      meta = describe(g.frame, g.def, z, { source: 'dtm', name: file.name, epsg: r.wkid, resolution: r.res });
    }
    if (meta.zmin === null) throw new Error(t('err.tiffOutside'));
    await useGrid(meta, z);
    if (g.def.grown) toast(t('terrain.cellGrown', { cell: fmt(g.def.cell, 2) }), '', 9000);
    toast(t('terrain.loaded', { name: meta.name, cells: fmt(meta.nx * meta.ny), cell: fmt(meta.cell, 2) }), 'ok', 8000);
    replaceImportedSlopeExclusions();
    return true;
  } catch (e) {
    console.error(e);
    toast(t('terrain.loadFail', { err: e.message || e }), 'err', 12000);
    return false;
  } finally { busy = false; status(''); render(); }
}

// ── analysis ──
const cache = new Map();
function memo(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }
function grads() {
  const m = terrainData.meta;
  return m && terrainData.z ? memo('g:' + m.id, () => gradients({ ...m, z: terrainData.z })) : null;
}
export function currentSlopeRule() {
  const f = store.project.field;
  return slopeLimitFor(f.technology, parseNotation(f.structure));
}
// the limit of a toolkit rule as the object the mask takes: { maxAny } or { maxNS, maxEW }
export function ruleLimit(rule) {
  if (!rule) return null;
  if (rule.maxAny != null) return { maxAny: rule.maxAny };
  if (rule.maxNS != null || rule.maxEW != null) return { maxNS: rule.maxNS ?? rule.maxEW, maxEW: rule.maxEW ?? rule.maxNS };
  return null;
}
export function sameLimit(a, b) {
  if (!a || !b) return false;
  if (a.maxAny != null || b.maxAny != null) return a.maxAny != null && b.maxAny != null && Math.abs(a.maxAny - b.maxAny) < 1e-9;
  return Math.abs(a.maxNS - b.maxNS) < 1e-9 && Math.abs(a.maxEW - b.maxEW) < 1e-9;
}
export function limitText(l) {
  if (!l) return '';
  return l.maxAny != null ? t('terrain.limitAny', { v: fmt(l.maxAny, l.maxAny % 1 ? 1 : 0) }) : t('terrain.limitNsew', { ns: fmt(l.maxNS, l.maxNS % 1 ? 1 : 0), ew: fmt(l.maxEW, l.maxEW % 1 ? 1 : 0) });
}
// The slope limit in force: the toolkit rule of the structure of 3 · Layout unless the designer (or a Geoportale
// project) chose one. { limit, rule (toolkit rule of the structure or null), custom, same (custom equals the rule),
// from: 'toolkit' | 'custom' | 'geoportale', text }
export function effectiveLimit() {
  const T = store.project.terrain, rule = currentSlopeRule(), tk = ruleLimit(rule);
  if (T.limit) return { limit: T.limit, rule, custom: true, same: sameLimit(T.limit, tk), from: T.limitFrom || 'custom', text: limitText(T.limit) };
  return { limit: tk, rule, custom: false, same: !!tk, from: 'toolkit', text: limitText(tk) };
}
// chosen by hand (limit null = back to the toolkit rule)
export function setLimit(limit, from = 'custom') {
  change('terrain', p => { p.terrain.limit = limit ? { ...limit } : null; p.terrain.limitFrom = limit ? from : null; });
}
function gridFrame(m) { return memo('f:' + m.id, () => makeLocalFrame({ lon0: m.lon0, lat0: m.lat0 })); }
function minCells(m) { return Math.ceil((store.project.terrain.minPatch || 0) / (m.cell * m.cell)); }
// polygon (in the frame of the grid) of the cells of a mask; null when empty
function maskPolygon(m, mask) {
  const { Polygon, simplifyOperator } = getSdk();
  const rings = maskToRings(mask, m.nx, m.ny, m.x0, m.y0, m.cell);
  if (!rings.length) return null;
  return simplifyOperator.execute(new Polygon({ rings, spatialReference: gridFrame(m).sr }));
}
// The cells over the slope limit in force, as a polygon in the frame of the grid:
// { polygon, limit, rule, cells, text, own (not the toolkit rule) }
export function overLimit() {
  const m = terrainData.meta, g = grads(), L = effectiveLimit();
  if (!m || !g || !L.limit) return null;
  const key = `o:${m.id}:${JSON.stringify(L.limit)}:${store.project.terrain.minPatch}`;
  return memo(key, () => {
    const { mask } = limitMask(g, L.limit);
    dropSmallPatches(mask, m.nx, m.ny, minCells(m));
    let cells = 0; for (const v of mask) cells += v;
    return { polygon: cells ? maskPolygon(m, mask) : null, limit: L.limit, rule: L.rule, cells, text: L.text, own: L.custom && !L.same };
  });
}

// Cut for the buildable area (areas.js computeArea): the cells over the limit, in the frame of the site
extraCuts.push(frame => {
  const P = store.project;
  if (!P.terrain.grid || !terrainData.z || P.terrain.grid.id !== terrainData.meta?.id) {
    return P.terrain.grid && !terrainData.z ? { note: t('terrain.noteMissing') } : null;
  }
  const L = effectiveLimit();
  if (!L.limit) return { note: t('terrain.noteNoRule', { structure: P.field.structure }) };
  if (!P.terrain.applySlopeLimit) return null;
  if (!coversSite()) return { note: t('terrain.noteOutside') };
  const o = overLimit();
  if (!o || !o.polygon) return null;
  const { projectOperator } = getSdk();
  const m = terrainData.meta;
  const same = Math.abs(m.lon0 - frame.lon0) < 1e-9 && Math.abs(m.lat0 - frame.lat0) < 1e-9;
  const geometry = memo(`c:${m.id}:${JSON.stringify(L.limit)}:${P.terrain.minPatch}:${frame.lon0},${frame.lat0}`, () => same ? o.polygon : projectOperator.execute(o.polygon, frame.sr));
  // label: the limit in use (the toolkit rule's own words when it is the rule); own + rule: for the warnings
  return { geometry, kind: 'slope', label: o.own || !L.rule ? o.text : L.rule.text, own: o.own, rule: L.rule ? L.rule.text : null };
});

// Does the grid still cover the gross and net areas? (they may have grown since the terrain was loaded)
function coversSite(m = terrainData.meta) {
  if (!m) return true;
  const box = siteBox(gridFrame(m));
  if (!box) return true;
  const tol = m.cell;
  return box.xmin >= m.x0 - tol && box.ymin >= m.y0 - tol && box.xmax <= m.x0 + m.nx * m.cell + tol && box.ymax <= m.y0 + m.ny * m.cell + tol;
}

// ── a Geoportale project with slopes from its DTM (import hook, 2026-10-04) ──
// The elevation grid of the project becomes the terrain of this step (no new download), its limit the limit in
// use (chosen by hand on the Geoportale: compared with the toolkit here), and the imported «steep slope» exclusion
// gives way to the live cut, so that the slope is cut once. Without a usable grid the exclusion stays as it is.
async function adoptGeoportaleTerrain(r, added) {
  if (r.type !== 'axpo' || !r.terrain || !r.terrain.length) return;
  if (store.project.terrain.grid) { toast(t('terrain.geoKept'), '', 9000); return; }
  const gross = added.find(f => f.category === 'gross');
  const sameGeom = rec => gross && rec.areaGeom && JSON.stringify(rec.areaGeom.coordinates) === JSON.stringify(gross.geometry.coordinates);
  const rec = r.terrain.find(sameGeom) || r.terrain[0];
  if (!siteFrame() || !coversSite(rec.meta)) { toast(t('terrain.geoNoCover'), '', 10000); return; }
  await useGrid(rec.meta, rec.z);
  change('terrain', p => {
    p.terrain.cellSize = rec.meta.cell;
    if (rec.minPatch != null) p.terrain.minPatch = rec.minPatch;
    p.terrain.applySlopeLimit = true;
    if (rec.limit) { p.terrain.limit = { ...rec.limit }; p.terrain.limitFrom = 'geoportale'; }
  });
  toast(t('terrain.geoAdopted', { cells: fmt(rec.meta.nx * rec.meta.ny), cell: fmt(rec.meta.cell, 2), limit: limitText(rec.limit) || '—' }), 'ok', 10000);
  replaceImportedSlopeExclusions();
}
importHooks.push(adoptGeoportaleTerrain);
// With a terrain loaded and the cut on, an imported slope exclusion would cut the same ground twice: it is removed
// (with Undo), the live cut of this step takes its place
function replaceImportedSlopeExclusions() {
  if (!store.project.terrain.grid || !store.project.terrain.applySlopeLimit) return;
  const slope = store.project.features.filter(f => f.slope && f.category === 'exclusion');
  if (!slope.length) return;
  removeFeatures(slope.map(f => f.id), slope.length === 1 ? t('terrain.slopeReplaced', { name: slope[0].name }) : t('terrain.slopeDropped', { n: slope.length }));
}

// ── map ──
function drawMap() {
  if (!layer) return;
  const { Graphic, projectOperator } = getSdk();
  layer.removeAll();
  const m = terrainData.meta, g = grads(), P = store.project;
  if (!m || !g) return;
  const out = [];
  if (P.terrain.showSlope) {
    SLOPE_CLASSES.forEach(([lo, hi], c) => {
      const mask = memo(`k:${m.id}:${c}:${P.terrain.minPatch}`, () => { const x = classMask(g, lo, hi); dropSmallPatches(x, m.nx, m.ny, minCells(m)); return x; });
      const poly = memo(`kp:${m.id}:${c}:${P.terrain.minPatch}`, () => maskPolygon(m, mask));
      if (poly) out.push(new Graphic({ geometry: projectOperator.execute(poly, view.spatialReference), symbol: { type: 'simple-fill', color: [...CLASS_COLOURS[c], 0.38], outline: { color: [0, 0, 0, 0], width: 0 } } }));
    });
  }
  const o = P.terrain.applySlopeLimit ? overLimit() : null;
  if (o && o.polygon) out.push(new Graphic({ geometry: projectOperator.execute(o.polygon, view.spatialReference),
    symbol: { type: 'simple-fill', style: 'backward-diagonal', color: [190, 30, 60, 0.75], outline: { color: [190, 30, 60, 0.9], width: 1.2, style: 'dash' } } }));
  layer.addMany(out);
}

// The grid no longer matches the site (it grew beyond it) or the grid cell chosen: the terrain is to be loaded again
export function terrainStale() {
  const m = store.project.terrain.grid;
  if (!m || !terrainData.z || terrainData.meta?.id !== m.id) return false;
  if (!coversSite()) return true;
  const g = gridForSite();
  return !!g && Math.abs(g.def.cell - m.cell) > 1e-6;
}

// ── panel ──
// the status line while a terrain loads; the two source buttons wait in the meantime
function status(text) {
  const el = $('terStatus');
  if (el) { el.textContent = text; el.hidden = !text; el.setAttribute('aria-busy', text ? 'true' : 'false'); }
  for (const id of ['terEsri', 'terDtm']) { const b = $(id); if (b) b.disabled = !!text; }
}
function render() {
  if (!$('terInfo')) return;
  const P = store.project, m = P.terrain.grid, have = !!(m && terrainData.z && terrainData.meta?.id === m.id);
  const stale = have && terrainStale();
  $('terCell').value = P.terrain.cellSize;
  $('terShow').checked = !!P.terrain.showSlope;
  $('terApply').checked = !!P.terrain.applySlopeLimit;
  $('terMinPatch').value = P.terrain.minPatch;
  $('terTech').value = P.field.technology;
  $('terClear').hidden = !m;
  $('terEsri').textContent = t(m ? 'terrain.esriAgain' : 'terrain.esriBtn');
  $('terPill').textContent = t(stale ? 'terrain.pillStale' : have ? 'terrain.pillOn' : m ? 'terrain.pillMissing' : 'terrain.pillOff');
  $('terPill').className = 'pill' + (have && !stale ? ' ok' : '');
  $('terInfo').innerHTML = m ? `<div class="hint">${esc(t('terrain.info', { name: m.name, date: m.loadedAt.slice(0, 10), cells: fmt(m.nx * m.ny),
    cell: fmt(m.cell, 2), zmin: fmt(m.zmin, 1), zmax: fmt(m.zmax, 1) }))}${m.epsg ? esc(' · ' + crsLabel(m.epsg) + ' (EPSG:' + m.epsg + ')') : ''}</div>`
    + (m.missing ? `<div class="warn">${esc(tn('terrain.missingCells', m.missing))}</div>` : '')
    + (stale ? `<div class="warn">${esc(t('terrain.stale'))}</div>` : '')
    + (!have ? `<div class="warn">${esc(t('terrain.noteMissing'))}</div>` : '') : `<div class="hint">${esc(t('terrain.none'))}</div>`;
  // legend
  $('terLegend').innerHTML = SLOPE_CLASSES.map(([lo, hi], c) => `<span class="lg"><i style="background:rgb(${CLASS_COLOURS[c].join(',')})"></i>${hi === Infinity ? `> ${lo}` : `${lo}–${hi}`} %</span>`).join('');
  // the slope limit: what the toolkit says for the structure, the limit in use, and whether they agree
  const L = effectiveLimit(), rule = L.rule, S = P.field.structure;
  $('terRule').innerHTML = rule ? `<div class="hint"><b>${esc(S)}</b> (${esc(t('tech.' + P.field.technology))}): ${esc(rule.text)} <small>(${esc(t('terrain.source', { src: rule.source }))})</small></div>`
    : `<div class="warn">${esc(t('terrain.noRuleChoose', { structure: S }))}</div>`;
  const mode = !L.custom ? 'toolkit' : L.limit.maxAny != null ? 'any' : 'nsew';
  document.querySelectorAll('#terLimitMode [data-lmode]').forEach(b => { b.setAttribute('aria-checked', String(b.dataset.lmode === mode)); b.tabIndex = b.dataset.lmode === mode ? 0 : -1; });
  $('terLimitAny').hidden = mode !== 'any';
  $('terLimitNsew').hidden = mode !== 'nsew';
  if (mode === 'any' && document.activeElement !== $('terMaxAny')) $('terMaxAny').value = L.limit.maxAny;
  if (mode === 'nsew') {
    if (document.activeElement !== $('terMaxNS')) $('terMaxNS').value = L.limit.maxNS;
    if (document.activeElement !== $('terMaxEW')) $('terMaxEW').value = L.limit.maxEW;
  }
  const st = $('terLimitStatus');
  let text, cls = 'status';
  if (!L.custom) { text = rule ? t('terrain.toolkitRule', { structure: S, rule: rule.text }) : t('terrain.noRuleChoose', { structure: S }); cls += rule ? ' ok' : ' err'; }
  else if (!rule) { text = `${L.text}. ${t('terrain.noRuleCustom', { structure: S })}`; }
  else if (L.same) { text = `${L.text}. ${t('terrain.sameToolkit', { structure: S })}`; cls += ' ok'; }
  else { text = `${L.text}. ${t('terrain.diffToolkit', { structure: S, rule: rule.text })}`; cls += ' err'; }
  if (L.from === 'geoportale') text += ' ' + t('terrain.fromGeoportale');
  st.textContent = text; st.className = cls;
  const o = have ? overLimit() : null;
  $('terCut').innerHTML = o ? `<div class="hint">${esc(t('terrain.overArea', { ha: fmt(o.cells * terrainData.meta.cell ** 2 / 1e4, 2) }))}</div>` : '';
  drawMap();
}

export function initTerrain(mapView) {
  view = mapView;
  const { GraphicsLayer } = getSdk();
  layer = new GraphicsLayer({ title: 'Slopes', listMode: 'hide' });
  view.map.add(layer, 0);
  const input = $('fileDtm');
  $('terEsri').onclick = () => loadTerrain('esri');
  $('terDtm').onclick = () => input.click();
  input.onchange = () => { const f = input.files && input.files[0]; input.value = ''; if (f) loadTerrain('dtm', f); };
  $('terClear').onclick = async () => {
    if (await confirmDialog({ title: t('terrain.clear'), text: t('terrain.clearConfirm'), ok: t('terrain.clear'), danger: true })) removeTerrain();
  };
  // the structure decides the slope limit: chosen here as in 3 · Layout (same group standard applied)
  $('terTech').onchange = () => change('field', p => applyStandard(p.field, $('terTech').value));
  // the limit in use: the toolkit rule, or one chosen by hand in the two ways of the Geoportale
  const pct = (id, fallback) => { const v = Number($(id).value); return Number.isFinite(v) && v >= 0 ? v : fallback; };
  $('terLimitMode').onclick = e => {
    const b = e.target.closest('[data-lmode]');
    if (!b) return;
    const L = effectiveLimit(), tk = ruleLimit(L.rule), cur = L.limit;
    const any = cur?.maxAny ?? tk?.maxAny ?? (cur ? Math.max(cur.maxNS, cur.maxEW) : null) ?? (tk ? Math.max(tk.maxNS, tk.maxEW) : 10);
    const ns = cur?.maxNS ?? tk?.maxNS ?? any, ew = cur?.maxEW ?? tk?.maxEW ?? any;
    if (b.dataset.lmode === 'toolkit') setLimit(null);
    else if (b.dataset.lmode === 'any') setLimit({ maxAny: any });
    else setLimit({ maxNS: ns, maxEW: ew });
    b.focus();
  };
  $('terLimitMode').onkeydown = e => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const all = [...$('terLimitMode').querySelectorAll('[data-lmode]')], i = all.findIndex(b => b.getAttribute('aria-checked') === 'true');
    all[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].click();
  };
  $('terMaxAny').onchange = () => setLimit({ maxAny: pct('terMaxAny', 10) });
  $('terMaxNS').onchange = () => setLimit({ maxNS: pct('terMaxNS', 10), maxEW: pct('terMaxEW', 10) });
  $('terMaxEW').onchange = () => setLimit({ maxNS: pct('terMaxNS', 10), maxEW: pct('terMaxEW', 10) });
  $('terCell').onchange = () => change('terrain', p => { p.terrain.cellSize = Math.min(50, Math.max(1, Number($('terCell').value) || 5)); });
  $('terShow').onchange = () => change('terrain', p => { p.terrain.showSlope = $('terShow').checked; });
  $('terApply').onchange = () => change('terrain', p => { p.terrain.applySlopeLimit = $('terApply').checked; });
  $('terMinPatch').onchange = () => change('terrain', p => { p.terrain.minPatch = Math.max(0, Number($('terMinPatch').value) || 0); });
  for (const topic of ['terrain', 'field', 'site']) on(topic, render);
  on('project', () => { cache.clear(); restore(); });
  // the rail: locked without a site, optional until a terrain is loaded, then done with what it cuts
  stepProvider('terrain', () => {
    if (!siteFrame()) return { state: 'locked', reason: t('gate.needSite') };
    const m = store.project.terrain.grid;
    if (!m) return { state: 'optional' };
    if (terrainStale()) return { state: 'done', figure: t('terrain.figStale') };
    const o = terrainData.z && terrainData.meta?.id === m.id && store.project.terrain.applySlopeLimit ? overLimit() : null;
    return { state: 'done', figure: o && o.cells ? t(o.own ? 'terrain.figCutOwn' : 'terrain.figCut', { ha: fmt(o.cells * m.cell ** 2 / 1e4, 1) }) : (m.source === 'esri' ? 'Esri' : 'DTM') };
  });
  restore();
}

// the grid described by the project: from memory (a project file just opened) or from this browser
async function restore() {
  const m = store.project.terrain.grid;
  if (!m) { if (terrainData.meta) setTerrainData(null, null); render(); return; }
  if (terrainData.meta?.id !== m.id || !terrainData.z) {
    const z = await loadLocal(m.id);
    setTerrainData(m, z);
    cache.clear();
    if (z) emit('terrain');
  }
  render();
}
