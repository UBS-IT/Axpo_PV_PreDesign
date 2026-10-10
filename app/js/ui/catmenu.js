// The category menu of the ribbon (1 · Site, group Site definition): a button that shows the category the next
// drawings go into, with its colour, and a list of every category under it (a listbox, as a select would be, but with
// the colour dots a native select cannot draw). The list is position: fixed, so the ribbon (overflow hidden) does not
// clip it. Keyboard: Enter / Space / Arrow down open it; arrows, Home, End and the first letter move; Enter or Space
// picks; Esc or Tab closes; a click outside closes.
import { icon } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// btn, list: the elements of index.html. items(): [{ id, label, hint, colour: [r, g, b] | null }]; value(): the id
// shown, or null when several are (a selection of objects of different categories: the button then shows mixed());
// onPick(id): called with the chosen id. Returns { render } to call when the items or the value change.
export function initCatMenu({ btn, list, items, value, onPick, mixed = () => '—' }) {
  if (!btn || !list) return { render() {} };
  let active = -1;   // index of the highlighted option while the list is open
  const opts = () => [...list.querySelectorAll('[role=option]')];
  const dot = it => `<span class="dot${it.colour ? '' : it.mixed ? ' mixed' : ' none'}"${it.colour ? ` style="--c:rgb(${it.colour.join(',')})"` : ''}></span>`;

  function render() {
    const all = items(), v = value();
    const cur = v === null ? { id: null, label: mixed(), hint: '', colour: null, mixed: true } : all.find(x => x.id === v) || all[0];
    btn.innerHTML = `${dot(cur)}<span class="nm">${esc(cur.label)}</span>${icon('chevron-down', 'sm')}`;
    btn.title = cur.hint || cur.label;
    list.innerHTML = all.map((it, i) => `<li role="option" id="${list.id}-${it.id}" data-id="${esc(it.id)}" aria-selected="${it.id === cur.id}" title="${esc(it.hint || '')}">${dot(it)}<span class="nm">${esc(it.label)}</span></li>`).join('');
    if (!list.hidden) highlight(Math.max(0, all.findIndex(x => x.id === cur.id)));
  }
  function highlight(i) {
    const o = opts();
    if (!o.length) return;
    active = (i + o.length) % o.length;
    o.forEach((x, k) => x.classList.toggle('active', k === active));
    list.setAttribute('aria-activedescendant', o[active].id);
    o[active].scrollIntoView({ block: 'nearest' });
  }
  function place() {
    const r = btn.getBoundingClientRect();
    list.style.left = `${Math.round(r.left)}px`;
    list.style.top = `${Math.round(r.bottom + 4)}px`;
    list.style.minWidth = `${Math.round(r.width)}px`;
  }
  function open() {
    if (!list.hidden) return;
    render();
    list.hidden = false;
    place();
    btn.setAttribute('aria-expanded', 'true');
    highlight(Math.max(0, opts().findIndex(o => o.getAttribute('aria-selected') === 'true')));
    list.focus();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
  }
  function close(refocus = false) {
    if (list.hidden) return;
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    list.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', close);
    if (refocus === true) btn.focus();
  }
  function pick(i) {
    const o = opts()[i];
    close(true);
    if (o) onPick(o.dataset.id);
  }
  function outside(e) { if (!list.contains(e.target) && !btn.contains(e.target)) close(); }

  btn.addEventListener('click', () => (list.hidden ? open() : close(true)));
  btn.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
  });
  list.addEventListener('click', e => { const o = e.target.closest('[role=option]'); if (o) pick(opts().indexOf(o)); });
  list.addEventListener('keydown', e => {
    const n = opts().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); highlight(0); }
    else if (e.key === 'End') { e.preventDefault(); highlight(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
    else if (e.key.length === 1 && /\S/.test(e.key)) {   // the first letter jumps to the next option starting with it
      const k = e.key.toLowerCase(), o = opts();
      for (let d = 1; d <= n; d++) { const i = (active + d) % n; if (o[i].textContent.trim().toLowerCase().startsWith(k)) { highlight(i); break; } }
    }
  });
  render();
  return { render, open, close };
}
