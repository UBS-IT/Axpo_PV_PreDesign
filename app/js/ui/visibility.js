// The visibility of the map layers (phase 3, decisions F1–F9 of 2026-10-11): one switch per row of the Layers panel,
// a view preference remembered in this browser (F6): not in the project file, never in a calculation or an export.
// Keys: 'cat:<category>' for the objects of 1 · Site, 'terrain:cut', 'layout:buildable', 'layout:tables',
// 'layout:fences', 'layout:strip' (the mitigation strip inside the fence), 'layout:roads', 'layout:stations', 'dims'. The terrain image is not here: its switch is the
// project's terrain.showSlope, as before (the ribbon of Terrain and the Layers panel show the same state).
// The modules that draw a layer ask layerVisible(key) and are told of a change by onVisibility(fn(keys)).
const KEY = globalThis.__PVP_TEST__ ? 'pvp.test.layerVis' : 'pvp.layerVis';
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
let state = read();
const listeners = [];

// visible unless switched off
export const layerVisible = key => state[key] !== false;
export function setLayerVisible(key, on) { setLayersVisible([key], on); }
export function setLayersVisible(keys, on) {
  const changed = keys.filter(k => layerVisible(k) !== !!on);
  if (!changed.length) return;
  for (const k of changed) { if (on) delete state[k]; else state[k] = false; }
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  for (const fn of listeners) { try { fn(changed); } catch (e) { console.error('[visibility]', e); } }
}
export function onVisibility(fn) { listeners.push(fn); }
// the 3D model has its own graphics: the switch each kind of them follows (F5)
export const KIND_3D = { tables: 'layout:tables', fence: 'layout:fences', gates: 'layout:fences', stations: 'layout:stations', obstacles: 'cat:obstacle' };
