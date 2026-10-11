// A right click on a row of the Layers panel (phase 5, asked by the user on 2026-10-11): a small menu with «Zoom to».
// It works on every row: an object, a category, the terrain image and the cut, the computed layers of Layout &
// Infrastructure, the dimensions; a hidden layer is zoomed to as well. The menu key of the keyboard (or Shift+F10)
// on a focused row opens it too. Nothing on the map yet: the item is off and says so.
import { getSdk } from '../sdk.js';
import { store } from '../state.js';
import { t } from '../i18n.js';
import { zoomToFeatures } from '../areas.js';
import { terrainData } from '../terrain/store.js';
import { makeLocalFrame } from '../geo/localframe.js';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let view = null, menu = null, current = null;

// which layer of the map draws a row of the panel (by title; the infrastructure layer holds three of them)
const layer = title => view?.map?.layers?.find(l => l.title === title) || null;
const GRAPHICS = {
  'layout:buildable': () => layer('Buildable area')?.graphics.toArray(),
  'layout:tables': () => layer('Tables')?.graphics.toArray(),
  'layout:fences': () => layer('Infrastructure')?.graphics.filter(g => g.attributes?.lay === 'layout:fences').toArray(),
  'layout:roads': () => layer('Infrastructure')?.graphics.filter(g => g.attributes?.lay === 'layout:roads').toArray(),
  'layout:stations': () => layer('Infrastructure')?.graphics.filter(g => g.attributes?.lay === 'layout:stations').toArray(),
  'terrain:cut': () => layer('Slopes')?.graphics.toArray(),
  'dims': () => layer('Dimensions')?.graphics.toArray(),
};

// the row under the pointer: { label, extent () -> Extent | null } or null (not a row)
export function rowTarget(el) {
  if (!el || !el.closest) return null;
  const it = el.closest('#areaCats .it[data-id]');
  if (it) return { ids: [it.dataset.id] };
  const cat = el.closest('#areaCats details.cat');
  if (cat && el.closest('summary')) return { ids: store.project.features.filter(f => f.category === cat.dataset.cat).map(f => f.id) };
  const row = el.closest('#collPanel .layer');
  if (!row) return null;
  if (row.id === 'dimsRow') return { key: 'dims' };
  if (row.querySelector('#layTerImage')) return { key: 'terrain:image' };
  const key = row.querySelector('input[data-lay]')?.dataset.lay;
  return key ? { key } : null;
}

// the extent of a target in the spatial reference of the view, or null when nothing of it is on the map
export function targetExtent(target) {
  if (!target || !view) return null;
  if (target.ids) return target.ids.length ? 'features' : null;
  const { Extent, projectOperator } = getSdk();
  const sr = view.spatialReference;
  if (target.key === 'terrain:image') {
    const m = terrainData.meta;
    if (!m || !terrainData.z || store.project.terrain.grid?.id !== m.id) return null;
    const e = new Extent({ xmin: m.x0, ymin: m.y0, xmax: m.x0 + m.nx * m.cell, ymax: m.y0 + m.ny * m.cell, spatialReference: makeLocalFrame(m).sr });
    try { return projectOperator.execute(e, sr); } catch { return null; }
  }
  const graphics = (GRAPHICS[target.key]?.() || []).filter(g => g.geometry);
  let ext = null;
  for (const g of graphics) {
    let e = g.geometry.type === 'point'
      ? new Extent({ xmin: g.geometry.x, ymin: g.geometry.y, xmax: g.geometry.x, ymax: g.geometry.y, spatialReference: g.geometry.spatialReference })
      : g.geometry.extent;
    if (!e) continue;
    if (!e.spatialReference?.equals?.(sr)) { try { e = projectOperator.execute(e, sr); } catch { e = null; } }
    if (e) ext = ext ? ext.union(e) : e.clone();
  }
  return ext;
}

export function zoomToTarget(target) {
  const e = targetExtent(target);
  if (!e) return false;
  if (e === 'features') { zoomToFeatures(target.ids); return true; }
  const w = e.xmax - e.xmin, h = e.ymax - e.ymin;
  view.goTo(w < 1 && h < 1 ? { target: e.center, scale: 1500 } : e.expand(1.3)).catch(() => {});
  return true;
}

export function initLayerMenu(mapView) {
  view = mapView;
  const panel = $('collPanel');
  if (!panel) return;
  menu = document.createElement('ul');
  menu.className = 'catlist ctxmenu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);
  panel.addEventListener('contextmenu', e => {
    const target = rowTarget(e.target);
    if (!target) return;
    e.preventDefault();
    let x = e.clientX, y = e.clientY;
    if (!x && !y) { const r = e.target.getBoundingClientRect(); x = r.left + 24; y = r.bottom; }   // from the keyboard
    openMenu(target, x, y);
  });
  menu.addEventListener('click', e => {
    const li = e.target.closest('[role="menuitem"]');
    if (!li || li.getAttribute('aria-disabled') === 'true') return;
    const target = current;
    closeMenu();
    zoomToTarget(target);
  });
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); menu.querySelector('[role="menuitem"]')?.click(); }
  });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
}
export function openMenu(target, x, y) {
  current = target;
  const can = !!targetExtent(target);
  menu.innerHTML = `<li role="menuitem" tabindex="-1" aria-disabled="${!can}" title="${esc(can ? '' : t('lay.nothing'))}">${icon('search', 'sm')}<span class="nm">${esc(t('lay.zoomTo'))}</span>`
    + (can ? '' : `<small>${esc(t('lay.nothing'))}</small>`) + '</li>';
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  menu.querySelector('[role="menuitem"]').focus();
}
export function closeMenu() { if (menu && !menu.hidden) { menu.hidden = true; current = null; } }
