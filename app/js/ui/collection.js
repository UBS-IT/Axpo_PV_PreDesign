// The Collection: the objects of the site by category (the cards of #areaCats, drawn by areas.js), in a drawer on
// the right edge of the map. It is a module of the whole app, not of one step: the drawer is reachable from every
// step, closed by default, opened from its tab (a strip with one dot per category and the number of objects) or
// from «See in the collection ›» in the Last drawing box of 1 · Site. The side panel of 1 · Site keeps the actions
// (import, drawing) and the account of the buildable area; the drawer keeps the archive. Its state is remembered in
// this browser. On narrow screens the drawer is a sheet over the bottom of the page.
const $ = id => document.getElementById(id);
// test pages set __PVP_TEST__ so that they never touch the setting of the app (same origin)
const KEY = globalThis.__PVP_TEST__ ? 'pvp.coll.test' : 'pvp.coll';

export function initCollection() {
  const tab = $('collTab'), coll = $('coll');
  if (!tab || !coll) return;
  tab.onclick = () => toggleCollection();
  $('collClose').onclick = () => { toggleCollection(false); tab.focus(); };
  coll.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); toggleCollection(false); tab.focus(); } });
  // «Open the collection ›» links anywhere in the app (the hint of 1 · Site)
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-coll-open]');
    if (a) { e.preventDefault(); toggleCollection(true); $('collClose')?.focus(); }
  });
  let open = false;
  try { open = localStorage.getItem(KEY) === '1'; } catch {}
  toggleCollection(open, false);
}

export const isOpen = () => document.body.classList.contains('coll-open');

// open (true), close (false) or flip the drawer; the choice is remembered unless `remember` is false
export function toggleCollection(open = !isOpen(), remember = true) {
  document.body.classList.toggle('coll-open', open);
  const tab = $('collTab');
  if (tab) tab.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (remember) { try { localStorage.setItem(KEY, open ? '1' : '0'); } catch {} }
}

// the tab: one dot per category that holds objects (its colour, its count) and the total
// counts: [{ id, colour: [r, g, b], n }] in the order of the categories
export function updateCollection(counts) {
  const dots = $('collDots'), tot = $('collTot');
  if (!dots || !tot) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  dots.innerHTML = counts.filter(c => c.n > 0)
    .map(c => `<span class="dot" style="--c:rgb(${c.colour.join(',')})" title="${esc(c.label)}: ${c.n}"><i></i>${c.n}</span>`).join('');
  const total = counts.reduce((s, c) => s + c.n, 0);
  tot.textContent = total || '';
}

// open the drawer on one object: its category card unfolds, its row scrolls into view and flashes
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
