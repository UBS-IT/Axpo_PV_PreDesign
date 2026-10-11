// The navigation of the map (phase 7, decisions L1 and L4 of 2026-10-11).
// - L1: the app draws one project. Once it has a gross area, the map stays inside a box around the gross areas plus
//   5 km and is not zoomed out beyond 1:50,000; without a gross area it is free. In 3D only the height of the camera is
//   limited (view3d/scene.js asks projectBox()).
// - L4: the scale of the status bar is a menu of the usual scales, 1:100 to 1:25,000, with a lock: locked, the zoom
//   stays at the chosen scale while the map still pans; unlocked, the navigation is free again (inside the box of L1).
//   A scale that is not in the menu is shown as it is at the top of it.
import { getSdk } from '../sdk.js';
import { store, on } from '../state.js';
import { t, fmt } from '../i18n.js';
import { siteFrame } from '../areas.js';
import { toSdk } from '../geo/convert.js';

export const SCALES = [100, 200, 500, 1000, 2000, 2500, 5000, 10000, 25000];
export const BOX_MARGIN = 5000;     // m around the gross areas
export const MIN_SCALE = 50000;     // the widest view with a project
const $ = id => document.getElementById(id);
let view = null, locked = null;
// a padlock, drawn as the icons of the design system (stroke 1.6); the set has none yet (docs/design-feedback.md)
const LOCK = open => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="${open ? 'M8 11V7.5a4 4 0 0 1 7.6-1.7' : 'M8 11V7.5a4 4 0 0 1 8 0V11'}"/></svg>`;

// The box of the project in the spatial reference sr: the gross areas plus the margin in true metres (the local frame
// of the site), or null without a gross area
export function projectBox(features = store.project.features, sr = view?.spatialReference) {
  const frame = siteFrame();
  if (!frame || !sr) return null;
  const { Extent, Polygon, projectOperator } = getSdk();
  let box = null;
  for (const f of features) {
    if (f.category !== 'gross') continue;
    const g = toSdk(f.geometry);
    const l = g && frame.toLocal(g);
    const e = l && l.extent;
    if (e) box = box ? box.union(e) : e.clone();
  }
  if (!box) return null;
  const m = BOX_MARGIN;
  const ring = [[box.xmin - m, box.ymin - m], [box.xmin - m, box.ymax + m], [box.xmax + m, box.ymax + m], [box.xmax + m, box.ymin - m], [box.xmin - m, box.ymin - m]];
  const p = frame.toSr(new Polygon({ rings: [ring], spatialReference: frame.sr }), sr);
  if (p && p.extent) return p.extent;
  try { return projectOperator.execute(new Extent({ ...box.toJSON(), spatialReference: frame.sr }), sr); } catch { return null; }
}

// the limits of the view: the box of the project and its widest scale, or the locked scale
export function applyConstraints() {
  const c = view && view.constraints;
  if (!c) return;
  const box = projectBox();
  c.geometry = box || null;
  c.minScale = locked || (box ? MIN_SCALE : 0);
  c.maxScale = locked || 0;
  // a project opened far from where the map is: back to it
  if (box && view.center && typeof box.contains === 'function' && !box.contains(view.center)) view.goTo(box.center).catch(() => {});
}

export const lockedScale = () => locked;
// lock the zoom at a scale (null unlocks)
export function lockScale(scale) {
  locked = scale ? Number(scale) : null;
  if (locked && view && typeof view.goTo === 'function') view.goTo({ scale: locked }).catch(() => {});
  applyConstraints();
  renderScale();
}
// the menu scale nearest to a free one (the lock takes it when the map is between two)
export const nearestScale = s => SCALES.reduce((a, b) => (Math.abs(Math.log(b / s)) < Math.abs(Math.log(a / s)) ? b : a));

export function initMapNav(mapView) {
  view = mapView;
  const sel = $('sbScaleSel'), lock = $('sbScaleLock');
  if (sel) sel.onchange = () => {
    const s = Number(sel.value);
    if (!s) return;
    if (locked) lockScale(s);
    else if (view && typeof view.goTo === 'function') view.goTo({ scale: s }).catch(() => {});
  };
  if (lock) lock.onclick = () => lockScale(locked ? null : nearestScale(view?.scale || 2500));
  try { getSdk().reactiveUtils.watch(() => view.scale, () => renderScale(), { initial: true }); } catch {}
  on('site', applyConstraints);
  on('project', applyConstraints);
  applyConstraints();
  renderScale();
}

// the menu: the scale of the view on top when it is not one of the list, then the list
function renderScale() {
  const sel = $('sbScaleSel'), lock = $('sbScaleLock');
  if (!sel) return;
  const s = locked || Math.round(view?.scale || 0);
  const label = v => `1:${fmt(v)}`;
  const free = s && !SCALES.includes(s) ? `<option value="" selected>${label(s)}</option>` : '';
  sel.innerHTML = free + SCALES.map(v => `<option value="${v}" ${v === s ? 'selected' : ''}>${label(v)}</option>`).join('');
  if (lock) {
    lock.setAttribute('aria-pressed', String(!!locked));
    lock.innerHTML = LOCK(!locked);
    lock.title = t(locked ? 'sb.unlockTitle' : 'sb.lockTitle');
    lock.setAttribute('aria-label', lock.title);
  }
}
