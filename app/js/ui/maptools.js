// The drawing support and the measures of the 2D map. The support — snapping to the objects and to the drawing in
// progress, typed lengths and angles (Tab while drawing), the length labels of the segments — are preferences
// remembered in this browser: snapping is the switch of the status bar, the other two are the boxes under the
// drawing block of 1 · Site; areas.js and dims.js apply them to their sketch. The map controls column (top left of
// the map, under the zoom and the north arrow of the SDK) holds Fit the site, Measure and Dimensions: Measure opens
// a card with the Esri distance / area widgets, loaded on demand, never saved; Dimensions arms dims.js.
import { getSdk, loadSdkMeasure } from '../sdk.js';
import { t } from '../i18n.js';
import { toast } from './toast.js';
import { icon } from './icons.js';
import { toggleDimension, isDrawingDimension } from '../dims.js';
import { zoomToFeatures } from '../areas.js';

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
// areas.js and dims.js register how their sketch takes the preferences; called at once with the current ones
export function onDrawPrefs(fn) { listeners.push(fn); fn(drawPrefs); }
export function setDrawPref(key, on) {
  if (!(key in DEFAULTS)) return;
  drawPrefs[key] = !!on;
  try { localStorage.setItem(KEY, JSON.stringify(drawPrefs)); } catch {}
  for (const fn of listeners) { try { fn(drawPrefs); } catch (e) { console.error('[maptools]', e); } }
}

// ── the controls column and the measure card ──
let view = null, measure = null;   // measure: { kind: 'distance' | 'area', widget }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initMapTools(mapView) {
  view = mapView;
  // the two boxes of 1 · Site
  for (const [id, key] of [['drawTyped', 'typed'], ['drawLabels', 'labels']]) {
    const box = $(id);
    if (!box) continue;
    box.onchange = () => setDrawPref(key, box.checked);
    onDrawPrefs(p => { box.checked = !!p[key]; });
  }
  // the controls column, a component of the view's UI under the zoom and the north arrow
  if (view && view.ui && typeof view.ui.add === 'function' && !$('mapCtl')) {
    const col = document.createElement('div');
    col.className = 'esri-widget mapctl';
    col.id = 'mapCtl';
    col.innerHTML = [['ctlFit', 'home', 'tools.fit'], ['ctlMeasure', 'measure', 'tools.measure'], ['ctlDim', 'dimension', 'tools.dimDraw']]
      .map(([id, ic, key]) => `<button type="button" id="${id}" class="mapctl-b" title="${esc(t(key))}" aria-label="${esc(t(key))}" aria-pressed="false">${icon(ic)}</button>`).join('');
    view.ui.add(col, 'top-left');
    col.querySelector('#ctlFit').onclick = () => zoomToFeatures();
    col.querySelector('#ctlMeasure').onclick = () => (measure ? stopMeasure() : startMeasure('distance'));
    col.querySelector('#ctlDim').onclick = () => { stopMeasure(); toggleDimension(); };
  }
  const card = $('measureCard');
  if (card) {
    card.addEventListener('click', e => { const b = e.target.closest('[data-measure]'); if (b) startMeasure(b.dataset.measure); });
    const mc = $('measureClose');
    if (mc) mc.onclick = () => stopMeasure();
  }
  document.addEventListener('pvp:dims-state', renderState);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && measure) stopMeasure(); });
  renderState();
}

function renderState() {
  const m = $('ctlMeasure'), d = $('ctlDim');
  if (m) m.setAttribute('aria-pressed', String(!!measure));
  if (d) d.setAttribute('aria-pressed', String(isDrawingDimension()));
  for (const b of document.querySelectorAll('#measureCard [data-measure]')) b.setAttribute('aria-checked', String(!!measure && measure.kind === b.dataset.measure));
}

// ── measure (temporary) ──
// The measurement widgets take the pointer: the drawing in progress stops (areas.js and dims.js listen to pvp:measure).
export async function startMeasure(kind) {
  if (!view) return;
  if (measure && measure.kind === kind) return;
  const card = $('measureCard'), box = $('measureBox');
  if (!card || !box) return;
  stopMeasure(true);
  document.dispatchEvent(new CustomEvent('pvp:measure', { detail: { kind } }));
  let S;
  try { S = await loadSdkMeasure(); }
  catch (e) { console.error(e); toast(t('tools.measureFail', { err: e.message || e }), 'err', 10000); return; }
  // the widget takes its container away when destroyed: each one gets its own host inside the box
  box.innerHTML = '';
  const host = document.createElement('div');
  box.appendChild(host);
  const W = kind === 'area' ? S.AreaMeasurement2D : S.DistanceMeasurement2D;
  const widget = new W({ view, container: host, unit: kind === 'area' ? 'square-meters' : 'meters' });
  measure = { kind, widget };
  card.hidden = false;
  document.dispatchEvent(new CustomEvent('pvp:mode', { detail: { mode: 'measure', label: t(kind === 'area' ? 'sb.measureArea' : 'sb.measureDistance') } }));
  renderState();
  try { widget.viewModel.start(); } catch (e) { console.warn('[measure]', e); }
}

export function stopMeasure(keepCard = false) {
  if (!measure) return;
  try { measure.widget.destroy(); } catch {}
  measure = null;
  const card = $('measureCard');
  if (card && !keepCard) card.hidden = true;
  if (!keepCard) document.dispatchEvent(new CustomEvent('pvp:mode', { detail: { mode: 'select', label: t('sb.select') } }));
  renderState();
}
export const measuring = () => !!measure;
