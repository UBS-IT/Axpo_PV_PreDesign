// The Layers panel: the objects of the site by category (the cards of #areaCats, drawn by areas.js), floating over
// the map on the left. Open by default, collapsible to a button in its corner, remembered in this browser; opened
// from «See in the collection ›» in the Last drawing box of 1 · Site. The function names come from the drawer this
// panel replaced (the Collection): toggleCollection, updateCollection, showInCollection are what the modules call.
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
