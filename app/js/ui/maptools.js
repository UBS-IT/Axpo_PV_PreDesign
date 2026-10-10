// The Tools menu of the 2D map (bottom left, a round button that opens a column of entries, as on the Geoportale):
// the drawing support — snapping to the objects and to the drawing in progress, typed lengths and angles (Tab while
// drawing), the length labels of the segments — as switches remembered in this browser (preferences, not project
// data; areas.js applies them to the sketch), and Measure: distances and areas with the Esri widgets, loaded on
// demand, never saved. Dimensions (persistent, in the project) come with their own module.
import { getSdk, loadSdkMeasure } from '../sdk.js';
import { t } from '../i18n.js';
import { toast } from './toast.js';

const $ = id => document.getElementById(id);
// test pages set __PVP_TEST__ so that they never touch the settings of the app (same origin)
const KEY = globalThis.__PVP_TEST__ ? 'pvp.draw.test' : 'pvp.draw';
const DEFAULTS = { snap: true, typed: true, labels: true };

// ── the drawing support preferences ──
export const drawPrefs = { ...DEFAULTS, ...read() };
function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
const listeners = [];
// areas.js registers how the sketch takes the preferences; called at once with the current ones
export function onDrawPrefs(fn) { listeners.push(fn); fn(drawPrefs); }
export function setDrawPref(key, on) {
  if (!(key in DEFAULTS)) return;
  drawPrefs[key] = !!on;
  try { localStorage.setItem(KEY, JSON.stringify(drawPrefs)); } catch {}
  for (const fn of listeners) { try { fn(drawPrefs); } catch (e) { console.error('[maptools]', e); } }
  renderMenu();
}

// ── the menu ──
let view = null, open = false, measure = null;   // measure: { kind: 'distance' | 'area', widget }

export function initMapTools(mapView) {
  view = mapView;
  const fab = $('toolsFab'), menu = $('toolsMenu');
  if (!fab || !menu) return;
  fab.onclick = () => toggleMenu();
  menu.addEventListener('click', e => {
    const b = e.target.closest('button[data-pref]');
    if (b) { setDrawPref(b.dataset.pref, b.getAttribute('aria-pressed') !== 'true'); return; }
    const m = e.target.closest('button[data-measure]');
    if (m) { startMeasure(m.dataset.measure); return; }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { toggleMenu(false); fab.focus(); } });
  document.addEventListener('click', e => { if (open && !e.target.closest('#tools')) toggleMenu(false); });
  const mc = $('measureClose');
  if (mc) mc.onclick = () => stopMeasure();
  renderMenu();
}

export function toggleMenu(on = !open) {
  open = on;
  const fab = $('toolsFab'), menu = $('toolsMenu');
  if (!fab || !menu) return;
  menu.hidden = !open;
  fab.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button')?.focus();
}

function renderMenu() {
  for (const b of document.querySelectorAll('#toolsMenu button[data-pref]')) {
    const on = !!drawPrefs[b.dataset.pref];
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.st').textContent = on ? t('tools.on') : t('tools.off');
  }
  for (const b of document.querySelectorAll('#toolsMenu button[data-measure]')) b.setAttribute('aria-pressed', String(!!measure && measure.kind === b.dataset.measure));
}

// ── measure (temporary) ──
// The measurement widgets take the pointer: the drawing in progress stops (areas.js listens to pvp:measure).
export async function startMeasure(kind) {
  if (!view) return;
  if (measure && measure.kind === kind) { stopMeasure(); return; }
  stopMeasure();
  document.dispatchEvent(new CustomEvent('pvp:measure', { detail: { kind } }));
  toggleMenu(false);
  let S;
  try { S = await loadSdkMeasure(); }
  catch (e) { console.error(e); toast(t('tools.measureFail', { err: e.message || e }), 'err', 10000); return; }
  const card = $('measureCard'), box = $('measureBox');
  box.innerHTML = '';
  const W = kind === 'area' ? S.AreaMeasurement2D : S.DistanceMeasurement2D;
  const widget = new W({ view, container: box, unit: kind === 'area' ? 'square-meters' : 'meters' });
  measure = { kind, widget };
  $('measureTitle').textContent = t(kind === 'area' ? 'tools.area' : 'tools.distance');
  card.hidden = false;
  renderMenu();
  try { widget.viewModel.start(); } catch (e) { console.warn('[measure]', e); }
}

export function stopMeasure() {
  if (!measure) return;
  try { measure.widget.destroy(); } catch {}
  measure = null;
  const card = $('measureCard');
  if (card) card.hidden = true;
  renderMenu();
}
export const measuring = () => !!measure;
