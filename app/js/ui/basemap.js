// Background map: satellite imagery without labels by default, a switch to the topographic map, and its opacity
// (a slider on the map, remembered in this browser), so the layout reads well over busy imagery.
import { getSdk } from '../sdk.js';
import { t } from '../i18n.js';

// test pages set __PVP_TEST__ so that they never touch the setting of the app (same origin)
const KEY = globalThis.__PVP_TEST__ ? 'pvp.test.basemapOpacity' : 'pvp.basemapOpacity';
const readOpacity = () => { try { const v = Number(localStorage.getItem(KEY)); return v >= 0 && v <= 1 && localStorage.getItem(KEY) !== null ? v : 1; } catch { return 1; } };

export function setBasemapOpacity(view, v) {
  for (const l of view.map.basemap?.baseLayers ?? []) l.opacity = v;
}

// view: a MapView (or a stand-in with map and ui). Returns the slider element.
export function initBasemap(view) {
  const { BasemapToggle, reactiveUtils } = getSdk();
  // one stack bottom right: the basemap toggle above, the opacity below (the attribution of the SDK sits under them)
  const stack = document.createElement('div');
  stack.className = 'bmstack';
  const toggleBox = document.createElement('div');
  stack.appendChild(toggleBox);
  new BasemapToggle({ view, nextBasemap: 'topo-vector', container: toggleBox });
  const box = document.createElement('label');
  box.className = 'esri-widget bm-opacity';
  box.title = t('map.opacityTitle');
  box.innerHTML = `<span></span><input type="range" min="0" max="100" step="5">`;
  const input = box.querySelector('input'), out = box.querySelector('span');
  input.setAttribute('aria-label', t('map.opacityTitle'));
  const show = v => { input.value = Math.round(v * 100); out.textContent = t('map.opacity', { pct: Math.round(v * 100) }); };
  let opacity = readOpacity();
  show(opacity);
  setBasemapOpacity(view, opacity);
  input.oninput = () => {
    opacity = Number(input.value) / 100;
    show(opacity);
    setBasemapOpacity(view, opacity);
    try { localStorage.setItem(KEY, String(opacity)); } catch {}
  };
  // the toggle replaces the basemap: the new one takes the same opacity
  reactiveUtils.watch(() => view.map.basemap, () => setBasemapOpacity(view, opacity));
  stack.appendChild(box);
  view.ui.add(stack, 'bottom-right');
  return box;
}
