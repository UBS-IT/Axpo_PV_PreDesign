// Search of the objects of the project (phase 5, decisions H1–H7 of 2026-10-11). Only Ctrl K opens it: the kit's
// search box at the top centre of the map, the results under it as one types. It finds the objects of 1 · Site (by
// name, category, type, file of origin) and the stations of Layout & Infrastructure; every word must appear, case and
// accents ignored. Picking an object does what a click on its row of the Layers panel does (select, Site area, zoom,
// the row shown in the panel); a station zooms and opens its tab. Objects of a hidden category are found and marked
// «hidden» and are selected with their outline, the category stays off (F2). While a tool is armed (the mode banner
// holds the top of the map) Ctrl K does nothing and an open box closes; in 3D it does nothing either.
import { getSdk } from '../sdk.js';
import { store } from '../state.js';
import { t, fmt } from '../i18n.js';
import { CATEGORY } from '../categories.js';
import { selectFeatures, zoomToFeatures, siteFrame } from '../areas.js';
import { measureFeature } from '../edit.js';
import { layerVisible } from './visibility.js';
import { showStep, currentTab } from './tabs.js';
import { showInCollection } from './layers.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const MAX_RESULTS = 8;
let view = null, items = null, shown = [], active = -1, mode = 'select';

// ── pure: what is searched and how ──
// lower case without accents: «Città» and «citta» are the same word
export const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// what the box can find: { kind: 'feature' | 'station', id, name, cat, catLabel, typeLabel, source, colour, measure, hidden }
export function searchItems(p = store.project, frame = siteFrame()) {
  const out = [];
  for (const f of p.features || []) {
    let m = {};
    try { m = frame ? measureFeature(f, frame) : {}; } catch {}
    out.push({ kind: 'feature', id: f.id, name: f.name || '—', cat: f.category, catLabel: t('cat.' + f.category),
      typeLabel: f.attrs?.type ? t('type.' + f.attrs.type) : '', source: [f.source !== 'drawn' ? f.source : '', f.sourceCategory].filter(Boolean).join(' '),
      colour: CATEGORY[f.category]?.colour || null, hidden: !layerVisible('cat:' + f.category),
      measure: m.area != null ? `${fmt(m.area / 1e4, 2)} ha` : m.length != null ? `${fmt(m.length / 1000, 2)} km` : '' });
  }
  // the stations: «Transformer station 2» when there are several of a kind
  const stations = p.infra?.stations || [], count = {}, seen = {};
  for (const s of stations) count[s.kind] = (count[s.kind] || 0) + 1;
  for (const s of stations) {
    seen[s.kind] = (seen[s.kind] || 0) + 1;
    const name = t('infra.kind.' + s.kind) + (count[s.kind] > 1 ? ' ' + seen[s.kind] : '');
    out.push({ kind: 'station', id: s.id, name, cat: 'station', catLabel: t('lay.stations'), typeLabel: '', source: '',
      colour: null, hidden: !layerVisible('layout:stations'), measure: '', lon: s.lon, lat: s.lat });
  }
  return out;
}

// the items whose text holds every word of the query, those whose name starts with it first: { list, more }
export function matchItems(query, list, max = MAX_RESULTS) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return { list: [], more: 0 };
  const hits = list.filter(it => { const hay = fold([it.name, it.catLabel, it.typeLabel, it.source].join(' ')); return words.every(w => hay.includes(w)); });
  const starts = it => fold(it.name).startsWith(words[0]) ? 1 : 0;
  hits.sort((a, b) => (starts(b) - starts(a)) || a.name.localeCompare(b.name, 'en', { numeric: true }));
  return { list: hits.slice(0, max), more: Math.max(0, hits.length - max) };
}

// the name with the words found in bold (HTML, escaped)
export function highlight(name, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  let folded = '';
  const at = [];
  for (let i = 0; i < name.length; i++) for (const ch of fold(name[i])) { folded += ch; at.push(i); }
  const mark = new Array(name.length).fill(false);
  for (const w of words) {
    const k = folded.indexOf(w);
    if (k >= 0) for (let j = k; j < k + w.length; j++) mark[at[j]] = true;
  }
  let out = '', open = false;
  for (let i = 0; i < name.length; i++) {
    if (mark[i] !== open) { out += mark[i] ? '<b>' : '</b>'; open = mark[i]; }
    out += esc(name[i]);
  }
  return out + (open ? '</b>' : '');
}

// ── the box ──
export function initSearch(mapView) {
  view = mapView;
  const form = $('objSearch'), input = $('objSearchIn'), list = $('objSearchRes');
  if (!form || !input || !list) return;
  form.addEventListener('submit', e => { e.preventDefault(); pick(active >= 0 ? active : 0); });
  input.addEventListener('input', () => { active = -1; renderResults(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      active = e.key === 'ArrowDown' ? (active + 1) % shown.length : (active <= 0 ? shown.length - 1 : active - 1);
      markActive();
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
  });
  // a click on a result: mousedown keeps the focus in the box (no blur before the click)
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) pick(Number(li.dataset.i)); });
  form.addEventListener('focusout', e => { if (!form.contains(e.relatedTarget)) closeSearch(); });
  // Ctrl K, and nothing else, opens it (H1)
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
    e.preventDefault();
    if (armed()) return;
    openSearch();
  });
  // a tool armed while the box is open closes it (H7)
  document.addEventListener('pvp:mode', e => { mode = (e.detail && e.detail.mode) || 'select'; if (armed()) closeSearch(); });
  const banner = $('banner');
  if (banner && typeof MutationObserver === 'function') new MutationObserver(() => { if (armed()) closeSearch(); }).observe(banner, { attributes: true, attributeFilter: ['hidden'] });
}

// a tool holds the map (or the 3D view is on): no search
function armed() {
  const b = $('banner');
  return mode !== 'select' || (b && !b.hidden) || document.body.classList.contains('in-3d');
}
export const isSearchOpen = () => !$('objSearch')?.hidden;
export function openSearch() {
  const form = $('objSearch'), input = $('objSearchIn');
  if (!form || !input) return;
  items = searchItems();
  form.hidden = false;
  input.focus();
  input.select();
  renderResults();
}
export function closeSearch() {
  const form = $('objSearch');
  if (!form || form.hidden) return;
  form.hidden = true;
  $('objSearchRes').hidden = true;
  $('objSearchIn').setAttribute('aria-expanded', 'false');
  shown = []; active = -1; items = null;
}

function renderResults() {
  const input = $('objSearchIn'), list = $('objSearchRes');
  const q = input.value;
  if (!q.trim()) { list.hidden = true; list.innerHTML = ''; shown = []; input.setAttribute('aria-expanded', 'false'); return; }
  const r = matchItems(q, items || (items = searchItems()));
  shown = r.list;
  const row = (it, i) => {
    const dot = it.colour ? `<span class="dot" style="--c:rgb(${it.colour.join(',')})"></span>` : `<span class="dot none"></span>`;
    const sub = [it.catLabel, it.typeLabel].filter(Boolean).join(' · ');
    return `<li role="option" id="objSearchRes-${i}" data-i="${i}" aria-selected="false">${dot}<span class="nm">${highlight(it.name, q)}<small>${esc(sub)}</small></span>`
      + (it.hidden ? `<span class="hid">${esc(t('search.hidden'))}</span>` : '')
      + (it.measure ? `<span class="cnt">${esc(it.measure)}</span>` : '') + '</li>';
  };
  list.innerHTML = shown.length
    ? shown.map(row).join('') + (r.more ? `<li class="more" aria-disabled="true">${esc(t('search.more', { n: r.more }))}</li>` : '')
    : `<li class="more" aria-disabled="true">${esc(t('search.none', { q: q.trim() }))}</li>`;
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  if (shown.length && active < 0) active = 0;
  markActive();
}
function markActive() {
  const input = $('objSearchIn');
  document.querySelectorAll('#objSearchRes [data-i]').forEach(li => li.classList.toggle('active', Number(li.dataset.i) === active));
  if (active >= 0 && shown[active]) { input.setAttribute('aria-activedescendant', 'objSearchRes-' + active); $('objSearchRes-' + active)?.scrollIntoView({ block: 'nearest' }); }
  else input.removeAttribute('aria-activedescendant');
}

// what a pick does (H5 a): as a click on the row of the Layers panel; a station zooms and opens its tab
export function pickItem(it) {
  if (!it) return;
  if (it.kind === 'feature') {
    selectFeatures([it.id]);
    if (currentTab() !== 'areas') showStep('areas');
    zoomToFeatures([it.id]);
    showInCollection(it.id, it.cat);
  } else if (it.kind === 'station') {
    showStep('infra');
    if (view && Number.isFinite(it.lon) && Number.isFinite(it.lat)) {
      const { Point } = getSdk();
      view.goTo({ target: new Point({ longitude: it.lon, latitude: it.lat }), scale: 1500 }).catch(() => {});
    }
  }
}
function pick(i) {
  const it = shown[i];
  if (!it) return;
  closeSearch();
  pickItem(it);
}
