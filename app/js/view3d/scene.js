// Step 4b · 3D: a SceneView on the same map as the 2D view (same background and opacity), shown in place of it while
// the step is open. The ground is the terrain of step 0 (a custom elevation layer over Esri World Elevation) or Esri
// World Elevation; tables, trackers, stations, fences, gates and obstacles are meshes at their real heights
// (model.js). The sun of the view (Daylight widget, quick solstice buttons) casts the shadows, turns the trackers
// and gives the row-to-row shading; ShadowCast adds the hours of shadow over a period; viewpoints are saved in the
// project, taken as pictures and put in the PDF report; the layout goes out as glTF. Editing stays in 2D.
import { getSdk, loadSdk3d } from '../sdk.js';
import { store, change, on } from '../state.js';
import { t, fmt } from '../i18n.js';
import { countryValue, countryName } from '../catalog.js';
import { crsState, siteFrame } from '../areas.js';
import { last } from '../field.js';
import { terrainData } from '../terrain/store.js';
import { bilinear } from '../terrain/slope.js';
import { makeLocalFrame } from '../geo/localframe.js';
import { toSdk } from '../geo/convert.js';
import { onStep, currentStep } from '../ui/rail.js';
import { toast } from '../ui/toast.js';
import { exportReport } from '../report.js';
import { fileName } from '../export/model.js';
import { heights3d, terrainMesh, axisAzimuth } from './geometry.js';
import { model3d, retilt } from './model.js';
import { sunPosition, solarTimeDate, rowShading, axisFrame } from './sun.js';
import { layoutGlb, mergeMeshes } from './glb.js';

const ESRI_ELEVATION = 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';
const LOOK = { tables: [24, 38, 84, 1], stations: [222, 216, 202, 1], fence: [95, 110, 95, 0.5], gates: [55, 90, 68, 1], obstacles: [80, 120, 66, 1] };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = Math.PI / 180;

let mapView = null, scene = null, layer3d = null, current = null, active = false, groundId = undefined, timer = null, building = null;
const widgets = {};
export const view3dState = { get scene() { return scene; }, get model() { return current; }, get active() { return active; } };

// ── ground from the terrain of step 0 ──
// Elevations of a tile (values: width × height, row 0 at the top, bounds [xmin, ymin, xmax, ymax] of the tiling
// system) replaced by the terrain grid where it covers them. toGrid(points) -> the points in the frame of the grid.
// Returns the number of values replaced.
export function fillTileFromGrid(values, width, height, bounds, toGrid, meta, grid) {
  const pts = new Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    pts[r * width + c] = [bounds[0] + (bounds[2] - bounds[0]) * c / (width - 1), bounds[3] - (bounds[3] - bounds[1]) * r / (height - 1)];
  }
  let n = 0;
  toGrid(pts).forEach(([x, y], i) => {
    const v = bilinear(grid, meta.nx, meta.ny, (x - meta.x0) / meta.cell - 0.5, (y - meta.y0) / meta.cell - 0.5);
    if (Number.isFinite(v)) { values[i] = v; n++; }
  });
  return n;
}
function dtmGround() {
  const { BaseElevationLayer, ElevationLayer, Multipoint, Polygon, SpatialReference, projectOperator } = getSdk();
  const meta = terrainData.meta, grid = terrainData.z, gridSr = makeLocalFrame(meta).sr;
  const x1 = meta.x0 + meta.nx * meta.cell, y1 = meta.y0 + meta.ny * meta.cell;
  const box = projectOperator.execute(new Polygon({ rings: [[[meta.x0, meta.y0], [meta.x0, y1], [x1, y1], [x1, meta.y0], [meta.x0, meta.y0]]], spatialReference: gridSr }),
    SpatialReference.WebMercator).extent;
  const Layer = BaseElevationLayer.createSubclass({
    load() {
      this._base = new ElevationLayer({ url: ESRI_ELEVATION });
      this.addResolvingPromise(this._base.load().then(() => {
        this.tileInfo = this._base.tileInfo; this.spatialReference = this._base.spatialReference; this.fullExtent = this._base.fullExtent;
      }));
    },
    fetchTile(level, row, col, options) {
      return this._base.fetchTile(level, row, col, options).then(data => {
        const b = this.getTileBounds(level, row, col);
        if (b[2] < box.xmin || b[0] > box.xmax || b[3] < box.ymin || b[1] > box.ymax) return data;
        fillTileFromGrid(data.values, data.width, data.height, b,
          pts => projectOperator.execute(new Multipoint({ points: pts, spatialReference: this.spatialReference }), gridSr).points, meta, grid);
        return data;
      });
    },
  });
  return new Layer({ title: meta.name || 'Terrain' });
}
function setGround() {
  const id = terrainData.meta ? terrainData.meta.id : null;
  if (id === groundId) return;
  groundId = id;
  mapView.map.ground = id ? { layers: [dtmGround()] } : 'world-elevation';
}

// ── meshes on the map ──
function toMesh(mesh, colour) {
  const { Mesh, Multipoint, SpatialReference, projectOperator } = getSdk();
  const n = mesh.positions.length / 3, xy = new Array(n);
  for (let i = 0; i < n; i++) xy[i] = [mesh.positions[3 * i], mesh.positions[3 * i + 1]];
  const wm = projectOperator.execute(new Multipoint({ points: xy, spatialReference: current.frame.sr }), SpatialReference.WebMercator).points;
  const pos = new Float64Array(n * 3);
  wm.forEach((p, i) => { pos[3 * i] = p[0]; pos[3 * i + 1] = p[1]; pos[3 * i + 2] = mesh.positions[3 * i + 2]; });
  return new Mesh({ spatialReference: SpatialReference.WebMercator, vertexAttributes: { position: pos },
    components: [{ faces: mesh.faces, shading: 'flat', material: { color: colour, doubleSided: true } }] });
}
function graphic(mesh, colour, kind) {
  const { Graphic } = getSdk();
  return mesh && new Graphic({ geometry: toMesh(mesh, colour), attributes: { kind }, symbol: { type: 'mesh-3d', symbolLayers: [{ type: 'fill' }] } });
}
function draw() {
  layer3d.removeAll();
  const m = current;
  if (!m) return;
  layer3d.addMany([
    graphic(m.tables, LOOK.tables, 'tables'),
    graphic(mergeMeshes(m.stations.map(s => s.mesh)), LOOK.stations, 'stations'),
    graphic(mergeMeshes(m.fences.map(f => f.mesh)), LOOK.fence, 'fence'),
    graphic(mergeMeshes(m.gates), LOOK.gates, 'gates'),
    graphic(mergeMeshes(m.obstacles.map(o => o.mesh)), LOOK.obstacles, 'obstacles'),
  ].filter(Boolean));
}
function redrawTables() {
  const old = layer3d.graphics.find(g => g.attributes?.kind === 'tables');
  if (old) layer3d.remove(old);
  const g = graphic(current.tables, LOOK.tables, 'tables');
  if (g) layer3d.add(g);
}
const viewDate = () => scene?.environment?.lighting?.date || new Date();

// ── open / close ──
async function enter() {
  active = true;
  document.body.classList.add('in-3d');
  let S;
  try { S = await loadSdk3d(); }
  catch (e) { console.error(e); toast(t('d3.fail', { err: e.message || e }), 'err', 12000); return leave(); }
  if (!active) return;
  if (!scene) {
    const { SceneView, GraphicsLayer, Daylight, reactiveUtils } = S;
    layer3d = new GraphicsLayer({ title: '3D layout', listMode: 'hide', elevationInfo: { mode: 'absolute-height' } });
    mapView.map.add(layer3d);
    try {
      scene = new SceneView({ container: 'view3d', map: mapView.map,
        environment: { lighting: { type: 'sun', date: new Date(), directShadowsEnabled: true }, atmosphereEnabled: true } });
    } catch (e) { console.error(e); toast(t('d3.fail', { err: e.message || e }), 'err', 12000); return leave(); }
    widgets.daylight = new Daylight({ view: scene });
    scene.ui.add(widgets.daylight, 'top-right');
    reactiveUtils.watch(() => scene.environment.lighting.date?.getTime?.(), () => onTime());
    scene.when().catch(e => { console.error(e); toast(t('d3.fail', { err: e.message || e }), 'err', 12000); });
  }
  layer3d.visible = true;
  tablesLayer2d(false);
  setGround();
  const first = !current;
  await refresh();
  if (first) goToSite();
}
function leave() {
  active = false;
  document.body.classList.remove('in-3d');
  if (layer3d) layer3d.visible = false;
  tablesLayer2d(true);
}
// the flat tables of 2D would show under the 3D ones
function tablesLayer2d(visible) {
  const l = mapView?.map.layers.find(x => x.title === 'Tables');
  if (l) l.visible = visible;
}
function goToSite() {
  const g = store.project.features.find(f => f.category === 'gross') || store.project.features.find(f => f.category === 'net');
  const geom = g && toSdk(g.geometry);
  if (scene && geom) scene.goTo({ target: geom, tilt: 60 }, { animate: false }).catch(() => {});
}

// ── model ──
async function refresh() {
  if (!active || !scene) return;
  const run = building = (async () => {
    let m = null;
    try { m = await model3d({ date: viewDate() }); }
    catch (e) { console.error(e); toast(t('d3.fail', { err: e.message || e }), 'err', 10000); }
    if (run !== building) return;   // a newer refresh started meanwhile
    current = m;
    draw();
    renderPanel();
  })();
  await run;
}
const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (active) { setGround(); refresh(); } }, 250); };
function onTime() {
  if (current && store.project.view3d.trackerMode === 'sun' && retilt(current, viewDate())) redrawTables();
  renderSun();
}

// ── panel ──
function initPanel() {
  const p = $('d3Panel');
  p.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'd3LowEdge') change('view3d', q => { q.view3d.lowEdge = el.value === '' ? null : Math.max(0, Number(el.value)); });
    else if (el.id === 'd3Axis') change('view3d', q => { q.view3d.axisHeight = el.value === '' ? null : Math.max(0, Number(el.value)); });
    else if (el.id === 'd3Cat') change('view3d', q => { q.view3d.trackerCategory = el.value; q.view3d.axisHeight = null; });
    else if (el.name === 'd3Mode') { change('views3d', q => { q.view3d.trackerMode = el.value; }); if (current && retilt(current, viewDate())) redrawTables(); renderPanel(); }
    else if (el.id === 'd3Shadow') toggleWidget('shadow', el.checked);
    else if (el.id === 'd3Los') toggleWidget('los', el.checked);
  });
  p.addEventListener('input', e => {
    if (e.target.id !== 'd3Angle') return;
    store.project.view3d.trackerAngle = Number(e.target.value);
    if (current && retilt(current, viewDate())) redrawTables();
    renderSun();
  });
  p.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sun) { const [mo, d, h] = b.dataset.sun.split('-').map(Number); setSun(mo, d, h); }
    else if (b.id === 'd3Save') saveViewpoint();
    else if (b.dataset.go) goToViewpoint(b.dataset.go);
    else if (b.dataset.del) change('views3d', q => { q.view3d.viewpoints = q.view3d.viewpoints.filter(v => v.id !== b.dataset.del); });
    else if (b.id === 'd3Png') savePicture();
    else if (b.id === 'd3Report') reportWithViews();
    else if (b.id === 'd3Glb') exportGlb();
    else if (b.id === 'd3Site') goToSite();
  });
  p.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'd3Angle') e.preventDefault(); });
  // angle set by hand: saved when the slider is released
  p.addEventListener('pointerup', e => { if (e.target.id === 'd3Angle') change('views3d', q => { q.view3d.trackerAngle = Number(e.target.value); }); });
}
function renderPanel() {
  const p = $('d3Panel');
  if (!p) return;
  const P = store.project, v = P.view3d, h = heights3d(P), iso = crsState.iso, country = countryName(iso) || '—';
  const r = last.result, m = current;
  const parts = [];
  if (!siteFrame()) { p.innerHTML = `<div class="card"><p class="hint">${esc(t('d3.noSite'))}</p></div>`; return; }
  // structures and heights
  let hts = '';
  if (h.tracker) {
    const ah = iso ? countryValue(iso, 'tracker.axisHeights')?.value : null;
    const opts = ['standard', 'grazing', 'advanced'].map(c => `<option value="${c}" ${v.trackerCategory === c ? 'selected' : ''}>${esc(t('d3.cat.' + c))}${ah?.[c] ? ` · ${fmt(ah[c], 2)} m` : ''}</option>`).join('');
    hts = `<label class="l" for="d3Cat">${esc(t('d3.category'))}</label><select id="d3Cat">${opts}</select>
      <label class="l" for="d3Axis">${esc(t('d3.axis'))}</label><input id="d3Axis" type="number" min="0" step="0.05" value="${v.axisHeight ?? ''}" placeholder="${h.axis?.source !== 'custom' && h.axis ? fmt(h.axis.value, 2) : ''}">
      <p class="hint">${esc(h.axis ? t(h.axis.source === 'custom' ? 'd3.axisCustom' : 'd3.axisToolkit', { m: fmt(h.axis.value, 2), country, src: h.axis.source }) : t('d3.axisMissing', { country }))}</p>
      <div class="opts row"><label><input type="radio" name="d3Mode" value="sun" ${v.trackerMode === 'sun' ? 'checked' : ''}> ${esc(t('d3.modeSun'))}</label>
      <label><input type="radio" name="d3Mode" value="manual" ${v.trackerMode === 'manual' ? 'checked' : ''}> ${esc(t('d3.modeManual'))}</label></div>
      <input id="d3Angle" type="range" min="${-(h.maxRotation ?? 55)}" max="${h.maxRotation ?? 55}" step="1" value="${v.trackerAngle || 0}" ${v.trackerMode === 'manual' ? '' : 'disabled'}>
      <p class="hint" id="d3AngleOut"></p>`;
  } else {
    hts = `<label class="l" for="d3LowEdge">${esc(t('d3.lowEdge'))}</label><input id="d3LowEdge" type="number" min="0" step="0.05" value="${v.lowEdge ?? ''}" placeholder="${h.lowEdge && h.lowEdge.source !== 'custom' ? fmt(h.lowEdge.value, 2) : ''}">
      <p class="hint">${esc(h.lowEdge ? t(h.lowEdge.source === 'custom' ? 'd3.lowCustom' : 'd3.lowToolkit', { m: fmt(h.lowEdge.value, 2), country, src: h.lowEdge.source }) : t(P.field.technology === 'agri-fixed' ? 'd3.lowAgri' : 'd3.lowMissing', { country }))}</p>`;
  }
  const ground = terrainData.meta ? t('d3.groundDtm', { name: terrainData.meta.name || terrainData.meta.source || 'DTM' }) : t('d3.groundEsri');
  const notes = (m?.notes || []).map(k => `<div class="warn">${esc(t(k, { country, n: m.gaps }))}</div>`).join('');
  parts.push(`<div class="card"><div class="cardhd"><b>${esc(t('d3.title'))}</b></div>
    <p class="hint">${esc(ground)}${r?.tables ? '' : ' ' + esc(t('d3.noLayout'))}</p>${notes}${hts}
    <p class="hint">${esc(t('d3.obstacleNote'))}</p>
    <div class="btns"><button type="button" class="btn" id="d3Site">${esc(t('d3.site'))}</button></div></div>`);
  // sun and shadows
  parts.push(`<div class="card"><div class="cardhd"><b>${esc(t('d3.sunTitle'))}</b></div>
    <div class="btns wrap">${[['12-21-9', 'd3.decMorning'], ['12-21-12', 'd3.decNoon'], ['12-21-15', 'd3.decAfternoon'], ['6-21-12', 'd3.junNoon']]
      .map(([k, l]) => `<button type="button" class="btn sm" data-sun="${k}">${esc(t(l))}</button>`).join('')}</div>
    <p class="hint" id="d3Sun"></p>
    <label class="chk"><input type="checkbox" id="d3Shadow" ${widgets.shadow ? 'checked' : ''}> <span>${esc(t('d3.shadowCast'))}</span></label>
    <p class="hint">${esc(t('d3.sunHint'))}</p></div>`);
  // views
  const vps = v.viewpoints.map(x => `<li><span>${esc(x.name)}</span><button type="button" class="x" data-go="${x.id}" title="${esc(t('d3.go'))}">➜</button><button type="button" class="x" data-del="${x.id}" title="${esc(t('d3.del'))}">×</button></li>`).join('');
  parts.push(`<div class="card"><div class="cardhd"><b>${esc(t('d3.viewsTitle'))}</b></div>
    <div class="row"><input id="d3Name" type="text" placeholder="${esc(t('d3.viewName', { n: v.viewpoints.length + 1 }))}"><button type="button" class="btn" id="d3Save">${esc(t('d3.save'))}</button></div>
    ${vps ? `<ul class="list">${vps}</ul>` : `<p class="hint">${esc(t('d3.noViews'))}</p>`}
    <div class="btns wrap"><button type="button" class="btn" id="d3Png">${esc(t('d3.png'))}</button>
    <button type="button" class="btn" id="d3Report" ${v.viewpoints.length ? '' : 'disabled'}>${esc(t('d3.report'))}</button></div>
    <label class="chk"><input type="checkbox" id="d3Los" ${widgets.los ? 'checked' : ''}> <span>${esc(t('d3.los'))}</span></label></div>`);
  // export
  parts.push(`<div class="card"><div class="cardhd"><b>${esc(t('d3.glbTitle'))}</b></div>
    <div class="btns col"><button type="button" class="btn" id="d3Glb">${esc(t('d3.glb'))}</button></div>
    <p class="hint">${esc(t(terrainData.meta ? 'd3.glbHint' : 'd3.glbNoTerrain'))}</p></div>`);
  p.innerHTML = parts.join('');
  renderSun();
}
// sun position, tracker angle and row-to-row shading at the time of the view
function renderSun() {
  const out = $('d3Sun');
  const frame = current?.frame || siteFrame();
  if (!out || !frame) return;
  const date = viewDate(), s = sunPosition(date, frame.lat0, frame.lon0), f = store.project.field, r = last.result, h = current?.h || heights3d();
  const lines = [t('d3.sunAt', { date: date.toISOString().slice(0, 16).replace('T', ' '), el: fmt(s.elevation, 1), az: fmt(s.azimuth, 0) })];
  if (s.elevation <= 0) lines.push(t('d3.night'));
  else if (r?.tablesLocal?.length && f.pitch > 0) {
    let share;
    if (h.tracker) {
      const { right } = axisFrame(axisAzimuth(r.tablesLocal));
      share = rowShading(s.vector, right, r.geom.planDepth, f.pitch, current?.angle ?? 0);
    } else {
      const a = f.azimuthDeg * D;
      share = rowShading(s.vector, [Math.sin(a), Math.cos(a)], r.geom.planDepth / Math.cos(f.tiltDeg * D), f.pitch, f.tiltDeg);
    }
    lines.push(share > 0.001 ? t('d3.shaded', { pct: fmt(share * 100, 0) }) : t('d3.notShaded'));
  }
  out.textContent = lines.join(' · ');
  const ao = $('d3AngleOut');
  if (ao && current) ao.textContent = t('d3.angleNow', { a: fmt(current.angle, 0) });
}
function setSun(month, day, hours) {
  const frame = current?.frame || siteFrame();
  if (!scene || !frame) return;
  const y = viewDate().getUTCFullYear();
  scene.environment.lighting.date = solarTimeDate(y, month, day, hours, frame.lon0);
}
function toggleWidget(kind, on) {
  const S = getSdk();
  if (!scene) return;
  if (!on) { if (widgets[kind]) { scene.ui.remove(widgets[kind]); widgets[kind].destroy(); widgets[kind] = null; } return; }
  if (widgets[kind]) return;
  widgets[kind] = kind === 'shadow' ? new S.ShadowCast({ view: scene }) : new S.LineOfSight({ view: scene });
  scene.ui.add(widgets[kind], kind === 'shadow' ? 'top-left' : 'bottom-left');
}

// ── viewpoints, pictures, report ──
function saveViewpoint() {
  if (!scene) return;
  const name = ($('d3Name')?.value || '').trim() || t('d3.viewName', { n: store.project.view3d.viewpoints.length + 1 });
  const id = Math.random().toString(36).slice(2, 10);
  change('views3d', q => { q.view3d.viewpoints = [...q.view3d.viewpoints, { id, name, camera: scene.camera.toJSON() }]; });
  toast(t('d3.saved', { name }), 'ok');
}
async function goToViewpoint(id, animate = true) {
  const vp = store.project.view3d.viewpoints.find(v => v.id === id);
  if (!scene || !vp) return;
  await scene.goTo(getSdk().Camera.fromJSON(vp.camera), { animate }).catch(() => {});
}
async function picture(format = 'png') {
  const { reactiveUtils } = getSdk();
  await reactiveUtils.whenOnce(() => !scene.updating);
  return scene.takeScreenshot({ format, quality: 88, width: 2000 });
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function savePicture() {
  if (!scene) return;
  const shot = await picture('png');
  download(await (await fetch(shot.dataUrl)).blob(), fileName(' - 3D.png'));
}
export async function reportWithViews() {
  if (!scene) return null;
  const views = [];
  const note = t('d3.reportNote', { time: viewDate().toISOString().slice(0, 16).replace('T', ' ') });
  for (const vp of store.project.view3d.viewpoints) {
    await goToViewpoint(vp.id, false);
    const s = await picture('jpg');
    views.push({ name: vp.name, dataUrl: s.dataUrl, width: s.data.width, height: s.data.height, note });
  }
  return exportReport({ views });
}

// ── glTF ──
export async function buildGlbFile() {
  const m = current || await model3d({ date: viewDate() });
  if (!m) return null;
  let box = null;
  for (const mesh of [m.tables, ...m.stations.map(s => s.mesh), ...m.fences.map(f => f.mesh)].filter(Boolean)) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i], y = mesh.positions[i + 1];
      box = box ? { xmin: Math.min(box.xmin, x), ymin: Math.min(box.ymin, y), xmax: Math.max(box.xmax, x), ymax: Math.max(box.ymax, y) } : { xmin: x, ymin: y, xmax: x, ymax: y };
    }
  }
  const pad = 30, terrain = box ? terrainMesh({ xmin: box.xmin - pad, ymin: box.ymin - pad, xmax: box.xmax + pad, ymax: box.ymax + pad }) : null;
  let national = null;
  const wkid = store.project.crs.wkid;
  if (wkid) {
    const { Point, SpatialReference, projectOperator } = getSdk();
    const o = projectOperator.execute(new Point({ x: 0, y: 0, spatialReference: m.frame.sr }), new SpatialReference({ wkid }));
    if (o && Number.isFinite(o.x)) national = { wkid, x: Math.round(o.x * 1000) / 1000, y: Math.round(o.y * 1000) / 1000 };
  }
  const out = layoutGlb(m, terrain, national);
  return { ...out, name: fileName('_3D.glb'), terrain: !!terrain };
}
async function exportGlb() {
  try {
    const out = await buildGlbFile();
    if (!out) { toast(t('toast.nothingToExport'), 'err'); return; }
    download(new Blob([out.buffer], { type: 'model/gltf-binary' }), out.name);
    toast(t('d3.glbDone', { file: out.name, parts: out.parts.join(', ') }), 'ok', 9000);
  } catch (e) { console.error(e); toast(t('out.fail', { err: e.message || e }), 'err', 10000); }
}

// ── start ──
export function initView3d(view) {
  mapView = view;
  initPanel();
  renderPanel();
  onStep(step => { if (step === '3d') enter(); else if (active) leave(); });
  for (const ev of ['layout', 'infra', 'terrain', 'site', 'field', 'crs', 'project']) on(ev, () => { if (active) later(); else renderPanel(); });
  // heights change the model; the tracker mode, the angle set by hand and the viewpoints only the panel
  on('view3d', () => { renderPanel(); if (active) later(); });
  on('views3d', renderPanel);
  if (currentStep() === '3d') enter();
}
