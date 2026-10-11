// The Layers panel, docked on the left of the map: the design system's LayerList (phase 3, decisions F1–F9). Three
// groups in the order of the tabs — Site area (the categories of #areaCats, drawn by areas.js, each with its objects),
// Terrain, Layout & Infrastructure — and the Dimensions row; every row has a visibility switch (ui/visibility.js,
// remembered in this browser), its symbol and a count or a key figure the modules write with setLayerFigure. The
// group of the active tab is open and marked. Open by default, collapsible to a strip, remembered in this browser.
// The function names come from the drawer this panel replaced (the Collection): toggleCollection, updateCollection,
// showInCollection are what the modules call.
import { layerVisible, setLayersVisible, onVisibility } from './visibility.js';
import { onStep, currentTab } from './tabs.js';
import { CATEGORIES, UNCLASSIFIED } from '../categories.js';
const $ = id => document.getElementById(id);
// test pages set __PVP_TEST__ so that they never touch the setting of the app (same origin)
const KEY = globalThis.__PVP_TEST__ ? 'pvp.layers.test' : 'pvp.layers';

export function initCollection() {
  const panel = $('leftPanel'), tab = $('collTab');
  if (!panel || !tab) return;
  tab.onclick = () => toggleCollection(true);
  const close = $('collClose');
  if (close) close.onclick = () => { toggleCollection(false); tab.focus(); };
  // «Open the collection ›» links anywhere in the app (the hint of 1 · Site)
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-coll-open]');
    if (a) { e.preventDefault(); toggleCollection(true); $('collClose')?.focus(); }
  });
  let open = true;
  try { open = localStorage.getItem(KEY) !== '0'; } catch {}
  toggleCollection(open, false);
  // the switches of the rows (the categories are drawn by areas.js inside #areaCats: same attribute)
  const list = $('collPanel');
  if (list) list.addEventListener('change', e => {
    const cb = e.target.closest('input[data-lay]');
    if (cb) setLayersVisible([cb.dataset.lay], cb.checked);
  });
  onVisibility(syncSwitches);
  // Hide all / Show all (F1): every switch of the panel, the terrain image included (terrain.js listens)
  const all = on => {
    setLayersVisible(allKeys(), on);
    document.dispatchEvent(new CustomEvent('pvp:layers-all', { detail: { on } }));
  };
  const hide = $('layHide'), show = $('layShow');
  if (hide) hide.onclick = () => all(false);
  if (show) show.onclick = () => all(true);
  // the group of the active tab: open and marked (the others keep how the designer left them)
  onStep(markCurrent);
  markCurrent();
  syncSwitches();
}

// every key of the panel: the categories (also those without objects yet), the computed layers, the dimensions
const allKeys = () => [...CATEGORIES.map(c => 'cat:' + c.id), 'cat:' + UNCLASSIFIED,
  ...[...document.querySelectorAll('#collPanel input[data-lay]')].map(i => i.dataset.lay), 'dims'];
// the boxes follow the switches (a switch can change from elsewhere: Hide all, a drawing in a hidden category)
function syncSwitches() {
  document.querySelectorAll('#collPanel input[data-lay]').forEach(i => { i.checked = layerVisible(i.dataset.lay); });
}
function markCurrent() {
  const tab = currentTab();
  document.querySelectorAll('#collPanel .lgroup[data-tab]').forEach(g => {
    const on = g.dataset.tab === tab;
    g.classList.toggle('current', on);
    if (on) g.open = true;
  });
}
// the count or key figure on the right of a row («580», «1.60 km»); '' clears it
// (L9) a row of a computed layer shows only while it holds something: its figure says so
export function setLayerFigure(key, text) {
  const el = document.querySelector(`#collPanel [data-fig="${key}"]`);
  if (!el) return;
  el.textContent = text || '';
  const row = el.closest('.layer');
  if (row) row.hidden = !text;
  syncGroups();
}
// (L9) a group shows only while one of its rows does; with nothing at all the panel says how to start
export function syncGroups() {
  let any = false;
  document.querySelectorAll('#collPanel .lgroup').forEach(g => {
    const on = !!g.querySelector('#areaCats .cat') || [...g.querySelectorAll('.layer')].some(r => !r.hidden);
    g.hidden = !on;
    any = any || on;
  });
  const empty = $('layEmpty');
  if (empty) empty.hidden = any || !$('dimsRow')?.hidden;
  const tools = document.querySelector('#collPanel .layer-tools');
  if (tools) tools.hidden = !any;
}

export const isOpen = () => document.body.classList.contains('coll-open');

// open (true), close (false) or flip the panel; the choice is remembered unless `remember` is false
export function toggleCollection(open = !isOpen(), remember = true) {
  document.body.classList.toggle('coll-open', open);
  document.body.classList.toggle('left-closed', !open);
  const panel = $('leftPanel'), tab = $('collTab');
  if (panel) panel.hidden = !open;
  if (tab) { tab.hidden = open; tab.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  if (remember) { try { localStorage.setItem(KEY, open ? '1' : '0'); } catch {} }
  document.dispatchEvent(new CustomEvent('pvp:panels'));
}

// the counters: the total in the panel header and on the reopen button, one dot per category that holds objects
// counts: [{ id, colour: [r, g, b], label, n }] in the order of the categories
export function updateCollection(counts) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const tot = $('collTot');
  if (tot) tot.textContent = total || '';
  const dots = $('collDots');
  if (dots) dots.innerHTML = counts.filter(c => c.n > 0).map(c => `<span class="dot" style="--c:rgb(${c.colour.join(',')})" title="${esc(c.label)}: ${c.n}"><i></i>${c.n}</span>`).join('');
  const sub = $('collSub');
  if (sub) sub.textContent = total ? (total === 1 ? '1 object' : `${total} objects`) : '';
  const grp = $('layCntAreas');
  if (grp) grp.textContent = total || '';
  syncGroups();
}

// open the panel on one object: its category card unfolds, its row scrolls into view and flashes
export function showInCollection(id, category) {
  toggleCollection(true);
  const card = document.querySelector(`#areaCats .cat[data-cat="${category}"]`);
  if (card) card.open = true;
  const row = document.querySelector(`#areaCats .it[data-id="${id}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.remove('flash');
  void row.offsetWidth;   // restart the animation when the same row is shown twice
  row.classList.add('flash');
  row.querySelector('.nm')?.focus?.();
}
