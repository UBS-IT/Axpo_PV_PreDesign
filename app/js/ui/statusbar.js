// The status bar: the coordinates of the pointer in the coordinate system chosen for the exports (the select of
// 5 · Report & exports lives here, output.js wires it), the scale of the view, the mode of the map (select, draw,
// reshape, measure, dimension: the modules announce it with a pvp:mode event), the snapping switch (a preference of
// ui/maptools.js) and the autosave state. With a terrain grid (2 · Terrain) the elevation and the slope under the
// pointer (phase 4, decisions G1–G7): the slope as the limit in use reads it, one figure or north–south and east–west,
// red where the cell is cut (as the hatching); the two items are hidden without a grid, «—» outside it and in 3D.
import { getSdk } from '../sdk.js';
import { store, on } from '../state.js';
import { t, fmt } from '../i18n.js';
import { drawPrefs, setDrawPref, onDrawPrefs } from './maptools.js';
import { terrainAt, terrainReady, limitText } from '../terrain/terrain.js';

const $ = id => document.getElementById(id);
let view = null, target = null, targetWkid = null;

export function initStatusBar(mapView) {
  view = mapView;
  const S = getSdk();
  // coordinates: the pointer projected into the export system, at most every 60 ms
  let last = 0, pending = null;
  if (view && typeof view.on === 'function') view.on('pointer-move', e => {
    pending = e;
    const now = performance.now();
    if (now - last < 60) return;
    last = now;
    showPoint(pending);
  });
  if (view && typeof view.on === 'function') view.on('pointer-leave', () => statusAt(null));
  // in 3D the pointer is on the scene, not on this map: nothing to show
  document.addEventListener('pvp:view3d', () => statusAt(null));
  // elevation and slope: shown while the project has a terrain grid in memory
  on('terrain', groundItems);
  on('project', groundItems);
  groundItems();
  // the scale is a menu with a lock: ui/mapnav.js
  on('crs', () => { targetWkid = null; });
  // mode
  document.addEventListener('pvp:mode', e => { const el = $('sbMode'); if (el) el.textContent = e.detail?.label || t('sb.select'); });
  // snapping
  const snap = $('sbSnap');
  if (snap) {
    snap.title = t('sb.snapTitle');
    snap.onclick = () => setDrawPref('snap', !drawPrefs.snap);
    onDrawPrefs(p => { snap.setAttribute('aria-pressed', String(!!p.snap)); snap.querySelector('span').textContent = t(p.snap ? 'sb.snapOn' : 'sb.snapOff'); });
  }
  // autosave
  document.addEventListener('pvp:saved', e => {
    const el = $('sbSave'), d = e.detail instanceof Date ? e.detail : new Date();
    if (el) el.textContent = t('sb.saved', { time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) });
  });
}

function showPoint(e) {
  if (!view || typeof view.toMap !== 'function') return;
  let p = null;
  try { p = view.toMap(e); } catch {}
  statusAt(p);
}
// what the status bar shows for a point of the map (null: the pointer left it); the tests call it directly
export function statusAt(p) {
  coords(p ? projected(p) : null);
  ground(p);
}
function projected(p) {
  const wkid = store.project.crs.wkid;
  if (!wkid) return null;
  const S = getSdk();
  if (targetWkid !== wkid) { target = new S.SpatialReference({ wkid }); targetWkid = wkid; }
  let q = null;
  try { q = S.projectOperator.execute(p, target); } catch {}
  return q;
}

function coords(q) {
  const e = $('sbE'), n = $('sbN');
  if (!e || !n) return;
  if (!q) { e.textContent = '—'; n.textContent = '—'; return; }
  const geographic = q.spatialReference && q.spatialReference.isGeographic;
  e.textContent = geographic ? `${q.x.toFixed(5)}°` : fmt(q.x, 2);
  n.textContent = geographic ? `${q.y.toFixed(5)}°` : fmt(q.y, 2);
}

// ── elevation and slope under the pointer (phase 4) ──
function groundItems() {
  const on = terrainReady();
  for (const id of ['sbZIt', 'sbSlopeIt']) { const el = $(id); if (el) el.hidden = !on; }
  if (!on) ground(null);
}
function ground(p) {
  const z = $('sbZ'), s = $('sbSlope');
  if (!z || !s) return;
  const h = p && !$('sbZIt')?.hidden ? terrainAt(p) : null;
  z.textContent = h && h.z != null ? `${fmt(h.z, 1)} m` : '—';
  const known = !!h && h.slope != null;
  s.textContent = !known ? '—' : h.split ? t('sb.slopeSplit', { ns: fmt(h.ns, 1), ew: fmt(h.ew, 1) }) : `${fmt(h.slope, 1)} %`;
  s.classList.toggle('over', known && h.over);
  s.title = !known ? '' : t('sb.slopeTitle', { v: fmt(h.slope, 1), ns: fmt(h.ns, 1), ew: fmt(h.ew, 1) })
    + (h.beyond ? ' · ' + t(h.over ? 'sb.slopeOver' : 'sb.slopeBeyond', { limit: limitText(h.limit) }) : '');
}
