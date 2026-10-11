// Snapping (phase 8, decisions L5–L7 of 2026-10-11): what the drawing tools snap to, chosen in a menu that the
// Snapping button of the status bar opens, remembered in this browser with the other drawing preferences.
// The SDK snaps to the vertices, edges and ends of the layers it is given (feature snapping) and shows guides on the
// drawing itself: right angles, parallels and extensions (self snapping, one switch: the SDK does not separate them).
// It has no snapping to midpoints or centres: a hidden layer of points (the midpoints of the edges and the centres of
// the objects of 1 · Site) gives them (L6). No grid (L7: the grid of the SDK is drawn in Web Mercator, not in true
// metres). Ctrl held down while drawing turns the snapping off or on (the SDK); the circle tool does not snap (the SDK).
import { getSdk } from '../sdk.js';
import { store, on } from '../state.js';
import { t } from '../i18n.js';
import { toSdk } from '../geo/convert.js';
import { drawPrefs, setDrawPref, onDrawPrefs } from './maptools.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let view = null, pointsLayer = null, menu = null;
const sketches = [];   // { vm, own }: the sketches of the app and the layers each one always snaps to
// the rows of the menu: the preference and its text (the first is the switch of everything)
export const SNAP_ROWS = [['snap', 'snap.all'], ['snapObjects', 'snap.objects'], ['snapPoints', 'snap.points'], ['snapGuides', 'snap.guides'],
  ['snapFence', 'snap.fence'], ['snapBuildable', 'snap.buildable'], ['snapTables', 'snap.tables']];
const MAX_VERTICES = 600;   // an outline with more vertices (an imported boundary) gives its centre only

const layerByTitle = title => view?.map?.layers?.find(l => l.title === title) || null;
// the sources of feature snapping for a sketch, from the menu
export function snapSources(own = []) {
  const p = drawPrefs, list = own.filter(Boolean).map(layer => ({ layer, enabled: true }));
  const add = (yes, layer) => { if (yes && layer && !list.some(s => s.layer === layer)) list.push({ layer, enabled: true }); };
  add(p.snapObjects, layerByTitle('Areas'));
  add(p.snapPoints, pointsLayer);
  add(p.snapFence, layerByTitle('Infrastructure'));
  add(p.snapBuildable, layerByTitle('Buildable area'));
  add(p.snapTables, layerByTitle('Tables'));
  return list;
}
function apply({ vm, own }) {
  try {
    const src = snapSources(own);
    vm.snappingOptions = { enabled: !!drawPrefs.snap, selfEnabled: !!drawPrefs.snapGuides, featureEnabled: src.length > 0, featureSources: src };
  } catch (e) { console.warn('[snapping]', e); }
}
// a sketch of the app takes the snapping of the menu; own: the layers it always snaps to (its own drawings)
let listening = false;
export function registerSketch(vm, own = []) {
  // every change of the preferences reaches the sketches, with or without the menu (the test pages have no menu);
  // subscribed at the first sketch, not when the module loads (ui/maptools.js may not be ready then: an import cycle)
  if (!listening) { listening = true; onDrawPrefs(() => applyAll()); }
  const s = { vm, own };
  sketches.push(s);
  apply(s);
}
const applyAll = () => sketches.forEach(apply);

// the midpoints of the edges and the centres of the objects of 1 · Site, as one multipoint per object
export function snapPointsOf(features) {
  const { centroidOperator } = getSdk();
  const out = [];
  for (const f of features || []) {
    const g = toSdk(f.geometry);
    const parts = g && (g.type === 'polygon' ? g.rings : g.type === 'polyline' ? g.paths : null);
    if (!parts) continue;
    const pts = [];
    if (g.type === 'polygon') {
      try { const c = centroidOperator.execute(g); if (c) pts.push([c.x, c.y]); } catch {}
    }
    const n = parts.reduce((s, p) => s + p.length, 0);
    if (n <= MAX_VERTICES) for (const p of parts) for (let i = 1; i < p.length; i++) pts.push([(p[i - 1][0] + p[i][0]) / 2, (p[i - 1][1] + p[i][1]) / 2]);
    if (pts.length) out.push({ id: f.id, points: pts, sr: g.spatialReference });
  }
  return out;
}
function refreshPoints() {
  if (!pointsLayer) return;
  const { Graphic, Multipoint } = getSdk();
  pointsLayer.removeAll();
  // invisible markers: the snapping reads the geometry, nobody sees them
  const symbol = { type: 'simple-marker', size: 4, color: [0, 0, 0, 0], outline: { color: [0, 0, 0, 0], width: 0 } };
  pointsLayer.addMany(snapPointsOf(store.project.features).map(o => new Graphic({ geometry: new Multipoint({ points: o.points, spatialReference: o.sr }), symbol, attributes: { id: o.id } })));
}

export function initSnapping(mapView) {
  view = mapView;
  const { GraphicsLayer } = getSdk();
  pointsLayer = new GraphicsLayer({ title: 'Snap points', listMode: 'hide' });
  if (view?.map) view.map.add(pointsLayer);
  refreshPoints();
  on('site', refreshPoints);
  on('project', refreshPoints);
  onDrawPrefs(() => { renderButton(); renderMenu(); });
  applyAll();   // the layers of the other steps exist now (main.js calls this after them)
  // the button of the status bar opens the menu
  const btn = $('sbSnap');
  if (!btn) return;
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.onclick = () => (menu && !menu.hidden ? closeMenu() : openMenu());
  menu = document.createElement('div');
  menu.className = 'catlist ctxmenu snapmenu';
  menu.id = 'snapMenu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', t('snap.title'));
  menu.hidden = true;
  document.body.append(menu);
  menu.addEventListener('change', e => { const cb = e.target.closest('input[data-snap]'); if (cb) setDrawPref(cb.dataset.snap, cb.checked); });
  menu.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); btn.focus(); } });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu(); }, true);
  renderButton();
}
function renderButton() {
  const btn = $('sbSnap');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(!!drawPrefs.snap));
  const span = btn.querySelector('span');
  if (span) span.textContent = t(drawPrefs.snap ? 'sb.snapOn' : 'sb.snapOff');
  btn.title = t('snap.buttonTitle');
}
function renderMenu() {
  if (!menu) return;
  const p = drawPrefs;
  menu.innerHTML = `<div class="snaphd">${esc(t('snap.title'))}</div>`
    + SNAP_ROWS.map(([key, label], i) => `<label class="chk${i ? ' sub' : ''}${i && !p.snap ? ' off' : ''}"><input type="checkbox" data-snap="${key}" ${p[key] ? 'checked' : ''}${i && !p.snap ? ' disabled' : ''}> <span>${esc(t(label))}</span></label>`).join('')
    + `<p class="hint">${esc(t('snap.hint'))}</p>`;
}
export function openMenu() {
  const btn = $('sbSnap');
  if (!menu || !btn) return;
  renderMenu();
  menu.hidden = false;
  const r = btn.getBoundingClientRect(), m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8))}px`;
  menu.style.top = `${Math.max(8, r.top - m.height - 6)}px`;
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('input')?.focus();
}
export function closeMenu() {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('sbSnap')?.setAttribute('aria-expanded', 'false');
}
export const snapPointsLayer = () => pointsLayer;
