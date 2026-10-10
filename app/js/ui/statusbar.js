// The status bar: the coordinates of the pointer in the coordinate system chosen for the exports (the select of
// 5 · Report & exports lives here, output.js wires it), the scale of the view, the mode of the map (select, draw,
// reshape, measure, dimension: the modules announce it with a pvp:mode event), the snapping switch (a preference of
// ui/maptools.js) and the autosave state. Elevation and slope under the pointer come in a later phase.
import { getSdk } from '../sdk.js';
import { store, on } from '../state.js';
import { t, fmt } from '../i18n.js';
import { drawPrefs, setDrawPref, onDrawPrefs } from './maptools.js';

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
  if (view && typeof view.on === 'function') view.on('pointer-leave', () => coords(null));
  // scale
  try { S.reactiveUtils.watch(() => view.scale, s => { const el = $('sbScale'); if (el) el.textContent = s ? `1:${fmt(Math.round(s))}` : '—'; }, { initial: true }); } catch {}
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
  if (!p) { coords(null); return; }
  const wkid = store.project.crs.wkid;
  if (!wkid) { coords(null); return; }
  const S = getSdk();
  if (targetWkid !== wkid) { target = new S.SpatialReference({ wkid }); targetWkid = wkid; }
  let q = null;
  try { q = S.projectOperator.execute(p, target); } catch {}
  coords(q);
}

function coords(q) {
  const e = $('sbE'), n = $('sbN');
  if (!e || !n) return;
  if (!q) { e.textContent = '—'; n.textContent = '—'; return; }
  const geographic = q.spatialReference && q.spatialReference.isGeographic;
  e.textContent = geographic ? `${q.x.toFixed(5)}°` : fmt(q.x, 2);
  n.textContent = geographic ? `${q.y.toFixed(5)}°` : fmt(q.y, 2);
}
