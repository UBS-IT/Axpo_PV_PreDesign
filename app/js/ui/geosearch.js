// Search of an address or of coordinates (phase 5, asked by the user on 2026-10-11): a compact magnifier at the top
// right of the map, left of the 2D / 3D chips, that opens a box. Enter runs it:
//   - coordinates are read in the browser, nothing is sent: «45.4642, 9.19» (latitude first, as Google Maps), with
//     N / S / E / W in any order, degrees-minutes-seconds «45°27'51"N 9°11'24"E», or a pair E N in metres in the
//     coordinate system of the status bar (the one of the exports);
//   - anything else is an address, asked to Nominatim (OpenStreetMap, free, no key): the typed text goes to its
//     servers. Its rules: at most one request a second and no search while typing, hence Enter only; the results
//     carry «© OpenStreetMap contributors».
// A result puts a pin on the map and zooms to it; × or Esc clears it. Not in 3D (the box hides).
import { getSdk } from '../sdk.js';
import { store } from '../state.js';
import { t, fmt } from '../i18n.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
let view = null, pinLayer = null, results = [], active = -1, lastAsk = 0;
// the address service (the tests put a stand-in here): (query, viewbox | null) -> [{ name, detail, lon, lat, bbox }]
let geocoder = askNominatim;
export function setGeocoder(fn) { geocoder = fn || askNominatim; }

// ── pure: coordinates typed by hand ──
const num = s => Number(String(s).replace(',', '.'));
// { lon, lat } for geographic coordinates, { x, y } for a pair in metres (E then N), or null
export function parseCoordinates(text) {
  let s = String(text ?? '').trim().toUpperCase().replace(/[′’‘`´]/g, "'").replace(/[″“”]/g, '"').replace(/''/g, '"');
  if (!s || /[A-DF-MO-RT-VX-Z]/.test(s.replace(/[NSEW]/g, ''))) return null;   // letters other than N S E W: an address
  // degrees, minutes, seconds: two of them, each with its hemisphere before or after
  if (s.includes('°')) {
    const re = /([NSEW])?\s*(\d{1,3}(?:[.,]\d+)?)\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*')?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*")?\s*([NSEW])?/g;
    const parts = [...s.matchAll(re)].filter(m => m[2] != null);
    if (parts.length !== 2) return null;
    const vals = parts.map(m => {
      const v = num(m[2]) + (m[3] ? num(m[3]) / 60 : 0) + (m[4] ? num(m[4]) / 3600 : 0);
      const h = m[1] || m[5] || '';
      return { v: h === 'S' || h === 'W' ? -v : v, h };
    });
    return geographic(vals);
  }
  // decimal numbers: a comma is a decimal mark only when no point is used and the numbers are apart
  if (!s.includes('.') && /\d,\d/.test(s) && /\d,\d+[\s;]+[+-]?\d/.test(s)) s = s.replace(/(\d),(\d)/g, '$1.$2');
  const re = /([NSEW])?\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?/g;
  const parts = [...s.matchAll(re)];
  if (parts.length !== 2 || s.replace(re, '').replace(/[\s,;]/g, '') !== '') return null;
  const vals = parts.map(m => { const h = m[1] || m[3] || ''; const v = Number(m[2]); return { v: h === 'S' || h === 'W' ? -Math.abs(v) : v, h }; });
  if (Math.abs(vals[0].v) > 1000 && Math.abs(vals[1].v) > 1000 && !vals[0].h && !vals[1].h) return { x: vals[0].v, y: vals[1].v };
  return geographic(vals);
}
function geographic([a, b]) {
  let lat = a.v, lon = b.v;
  if (a.h === 'E' || a.h === 'W' || b.h === 'N' || b.h === 'S') [lat, lon] = [b.v, a.v];
  else if (!a.h && !b.h && Math.abs(a.v) > 90 && Math.abs(b.v) <= 90) [lat, lon] = [b.v, a.v];
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lon, lat };
}

// ── the address service ──
async function askNominatim(query, viewbox) {
  const u = new URL(NOMINATIM);
  u.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', 'accept-language': 'en', ...(viewbox ? { viewbox: viewbox.join(',') } : {}) }).toString();
  const r = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const a = await r.json();
  return (Array.isArray(a) ? a : []).map(x => {
    const parts = String(x.display_name || '').split(', ');
    const [s, n, w, e] = (x.boundingbox || []).map(Number);
    return { name: x.name || parts[0] || '—', detail: parts.slice(1).join(', '),
      lon: Number(x.lon), lat: Number(x.lat), bbox: [w, s, e, n].every(Number.isFinite) ? [w, s, e, n] : null };
  }).filter(x => Number.isFinite(x.lon) && Number.isFinite(x.lat));
}

// ── the box ──
export function initGeoSearch(mapView) {
  view = mapView;
  const form = $('geoSearch'), btn = $('geoBtn'), input = $('geoIn'), clear = $('geoClear'), list = $('geoRes');
  if (!form || !btn || !input || !list) return;
  const { GraphicsLayer } = getSdk();
  pinLayer = new GraphicsLayer({ title: 'Search result', listMode: 'hide' });
  view.map.add(pinLayer);
  btn.onclick = () => { if (form.classList.contains('open')) collapse(); else expand(); };
  form.addEventListener('submit', e => { e.preventDefault(); if (active >= 0 && results[active]) choose(active); else run(input.value); });
  input.addEventListener('input', () => { results = []; active = -1; list.hidden = true; list.innerHTML = ''; });
  input.addEventListener('keydown', e => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) {
      e.preventDefault();
      active = e.key === 'ArrowDown' ? (active + 1) % results.length : (active <= 0 ? results.length - 1 : active - 1);
      list.querySelectorAll('[data-i]').forEach(li => li.classList.toggle('active', Number(li.dataset.i) === active));
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (!list.hidden) { list.hidden = true; return; }
      clearPin(); collapse();
    }
  });
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) choose(Number(li.dataset.i)); });
  if (clear) clear.onclick = () => { clearPin(); input.value = ''; list.hidden = true; input.focus(); };
  // leaving the box hides the list; an empty box without a pin folds back to the magnifier
  form.addEventListener('focusout', e => {
    if (form.contains(e.relatedTarget)) return;
    list.hidden = true;
    if (!input.value.trim() && !pinLayer.graphics.length) collapse();
  });
  // left of the 2D / 3D chips
  const chips = document.querySelector('#mapStack .mapchips');
  if (chips && chips.offsetWidth) form.style.right = `${12 + chips.offsetWidth + 8}px`;
}
function expand() {
  const form = $('geoSearch'), input = $('geoIn');
  form.classList.add('open');
  input.hidden = false;
  $('geoClear').hidden = false;
  $('geoBtn').setAttribute('aria-expanded', 'true');
  input.focus();
}
function collapse() {
  const form = $('geoSearch');
  form.classList.remove('open');
  $('geoIn').hidden = true;
  $('geoClear').hidden = true;
  $('geoRes').hidden = true;
  $('geoBtn').setAttribute('aria-expanded', 'false');
}

// Enter: coordinates at once, else the address service (at most once a second)
export async function run(text) {
  const q = String(text ?? '').trim();
  if (!q) return;
  const c = parseCoordinates(q);
  if (c) {
    const p = c.x != null ? metresPoint(c) : { lon: c.lon, lat: c.lat };
    if (!p) { show([], t('geo.noCrs')); return; }
    results = [];
    show([], '');
    await goToPlace({ lon: p.lon, lat: p.lat, name: c.x != null ? `E ${fmt(c.x, 2)} · N ${fmt(c.y, 2)}` : `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}` });
    return;
  }
  const now = Date.now();
  if (now - lastAsk < 1000) return;
  lastAsk = now;
  show([], t('geo.searching'));
  try {
    results = await geocoder(q, viewbox());
    active = results.length ? 0 : -1;
    show(results, results.length ? '' : t('geo.none', { q }));
  } catch (e) {
    console.warn('[geosearch]', e);
    results = [];
    show([], t('geo.fail'));
  }
}
// a pair in metres in the coordinate system of the status bar -> { lon, lat }, or null without one
function metresPoint({ x, y }) {
  const wkid = store.project.crs?.wkid;
  if (!wkid) return null;
  const { Point, SpatialReference, projectOperator } = getSdk();
  try {
    const sr = new SpatialReference({ wkid });
    if (sr.isGeographic) return null;
    const g = projectOperator.execute(new Point({ x, y, spatialReference: sr }), SpatialReference.WGS84);
    return g && Number.isFinite(g.x) ? { lon: g.x, lat: g.y } : null;
  } catch { return null; }
}
// the view in WGS 84 (the service prefers places inside it, it does not exclude the others)
function viewbox() {
  try {
    const { SpatialReference, projectOperator } = getSdk();
    const e = view && view.extent && projectOperator.execute(view.extent, SpatialReference.WGS84);
    return e ? [e.xmin, e.ymax, e.xmax, e.ymin].map(v => v.toFixed(5)) : null;
  } catch { return null; }
}
function show(list, message) {
  const ul = $('geoRes');
  ul.innerHTML = list.map((r, i) => `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}"><span class="nm">${esc(r.name)}<small>${esc(r.detail)}</small></span></li>`).join('')
    + (message ? `<li class="more" aria-disabled="true">${esc(message)}</li>` : '')
    + (list.length ? `<li class="more attr" aria-disabled="true">${esc(t('geo.attribution'))}</li>` : '');
  ul.hidden = !list.length && !message;
}
function choose(i) {
  const r = results[i];
  if (!r) return;
  $('geoRes').hidden = true;
  goToPlace(r);
}
// the pin and the zoom (to the box of a place when the service gives one)
export async function goToPlace({ lon, lat, name, bbox }) {
  if (!view || !pinLayer) return;
  const { Graphic, Point, Extent } = getSdk();
  const pt = new Point({ longitude: lon, latitude: lat });
  // L1: with a project the map stays in its box; a place outside it is said, not reached
  const box = view.constraints && view.constraints.geometry;
  if (box) {
    let inside = true;
    try { inside = box.contains(getSdk().projectOperator.execute(pt, box.spatialReference)); } catch {}
    if (!inside) { show([], t('geo.outside')); return false; }
  }
  pinLayer.removeAll();
  pinLayer.add(new Graphic({ geometry: pt, attributes: { name },
    symbol: { type: 'simple-marker', style: 'circle', size: 13, color: [37, 99, 235, 1], outline: { color: [255, 255, 255, 1], width: 2 } } }));
  const big = bbox && (bbox[2] - bbox[0] > 0.002 || bbox[3] - bbox[1] > 0.002);
  const target = big ? new Extent({ xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3], spatialReference: { wkid: 4326 } }) : { target: pt, scale: 2500 };
  try { await view.goTo(target); } catch {}
  return true;
}
export function clearPin() { if (pinLayer) pinLayer.removeAll(); }
export const pinCount = () => (pinLayer ? pinLayer.graphics.length : 0);
