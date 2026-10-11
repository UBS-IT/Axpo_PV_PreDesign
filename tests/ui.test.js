// The panels of the app (1 · Areas, 0 · Terrain, 2 · Fields, 4 · Output) mounted from app/index.html on a stand-in
// map view (a real Map, no drawing on screen): the code that fills the panels, the layers and the results runs as in
// the app. The page of the app itself needs a real map view: check it in a browser too.
import { loadSdk, getSdk } from '../app/js/sdk.js';
import { loadCatalog } from '../app/js/catalog.js';
import { applyI18n } from '../app/js/i18n.js';
import { store, defaultProject, replaceProject, change, emit } from '../app/js/state.js';
import { loadCountries } from '../app/js/crs.js';
import { initAreas, historySize, undo, redo, selectDrawCat, pendingCount, computeArea, siteFrame, selectFeatures, selectionIds, selectedFeatures,
  selectByGeometry, splitSelection, mergeSelection, copySelection, deleteSelection } from '../app/js/areas.js';
import { measureFeature } from '../app/js/edit.js';
import { layerVisible, setLayerVisible, KIND_3D } from '../app/js/ui/visibility.js';
import { initRibbon } from '../app/js/ui/ribbon.js';
import { stepState, refreshRail, currentTab, showStep, TABS } from '../app/js/ui/tabs.js';
import { initSearch, searchItems, matchItems, highlight, fold } from '../app/js/ui/search.js';
import { initGeoSearch, parseCoordinates, setGeocoder, run as geoRun, pinCount, clearPin, goToPlace } from '../app/js/ui/geosearch.js';
import { initMapNav, projectBox, lockedScale, nearestScale, SCALES } from '../app/js/ui/mapnav.js';
import { isUntitled, fileBase, fileName as projectFileName } from '../app/js/io/names.js';
import { saveProject } from '../app/js/io/projectfile.js';
import { initLayerMenu, rowTarget, targetExtent, renameRow } from '../app/js/ui/layermenu.js';
import { initSnapping, snapPointsOf, snapPointsLayer } from '../app/js/ui/snapping.js';
import { initCollection, toggleCollection, isOpen, showInCollection } from '../app/js/ui/layers.js';
import { drawPrefs, setDrawPref } from '../app/js/ui/maptools.js';
import { initDims, dimensionParts, removeDimension } from '../app/js/dims.js';
import { structurePresets } from '../app/js/catalog.js';
import { initTerrain, sampleDtm, gridForSite, useGrid, setLimit } from '../app/js/terrain/terrain.js';
import { initStatusBar, statusAt } from '../app/js/ui/statusbar.js';
import { initModulesUi, library } from '../app/js/modules.js';
import { initField, last } from '../app/js/field.js';
import { initOutput, buildGeoJSON, buildKmz, exportEngineering } from '../app/js/output.js';
import { exportModel } from '../app/js/export/model.js';
import { buildShapefiles, prjFor } from '../app/js/export/shp.js';
import { buildDxf } from '../app/js/export/dxf.js';
import { buildBoq } from '../app/js/export/boq.js';
import { buildGeoPackage } from '../app/js/export/gpkg.js';
import { srsDefinition } from '../app/js/export/shp.js';
import { readWorkbook } from '../app/js/io/xlsx.js';
import { loadJsZip, loadShp, loadSqlJs } from '../app/js/libs.js';
import { buildReport } from '../app/js/report.js';
import { initQuick, runQuick } from '../app/js/quick.js';
import { initInfra, addStation } from '../app/js/infra.js';
import { makeLocalFrame } from '../app/js/geo/localframe.js';
import { initBasemap } from '../app/js/ui/basemap.js';
import { initView3d } from '../app/js/view3d/scene.js';
import { model3d } from '../app/js/view3d/model.js';
import { layoutGlb, readGlb } from '../app/js/view3d/glb.js';
import { terrainData, setTerrainData } from '../app/js/terrain/store.js';
import { toGeoJSON, projectPointToWgs84 } from '../app/js/geo/convert.js';

const results = [];
async function test(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); }
  catch (e) { console.error(name, e); results.push({ name, ok: false, note: e && e.message || String(e) }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const text = id => document.getElementById(id).innerText;
const eq = (a, b, w) => assert(JSON.stringify(a) === JSON.stringify(b), `${w}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const close = (a, b, tol, w) => assert(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);

await loadSdk();
await loadCatalog();
await loadCountries();
// the side panel and the hidden inputs of the app, in a hidden box
const html = await (await fetch('../app/index.html')).text();
const doc = new DOMParser().parseFromString(html, 'text/html');
const box = document.createElement('div');
box.style.display = 'none';
// the shell: top bar, tabs, ribbon (the tools of the steps keep their ids there), the two docked panels, the status bar
box.append(doc.getElementById('top'), doc.getElementById('tabs'), doc.getElementById('ribbon'), doc.getElementById('leftPanel'), doc.getElementById('collTab'),
  doc.getElementById('rightPanel'), doc.getElementById('rpOpen'), doc.getElementById('statusbar'), ...doc.querySelectorAll('body > input[type=file]'), ...doc.querySelectorAll('body > dialog'), doc.getElementById('toast'),
  doc.querySelector('#mapStack .mapchips'), doc.getElementById('d3Card'), doc.getElementById('objSearch'), doc.getElementById('geoSearch'));
const banner = document.createElement('div'); banner.id = 'banner'; box.append(banner);
const railAreas = document.createElement('span'); railAreas.id = 'railAreas'; box.append(railAreas);
document.body.append(box);
applyI18n(box);

const { Map, SpatialReference } = getSdk();
const view = { map: new Map(), spatialReference: SpatialReference.WebMercator, ui: { add() {} }, goTo: async () => {}, on() { return { remove() {} }; }, when: async () => {} };
library.modules = [];

// a 400 m square site around a point of the terrain fixture (EPSG:32633), in Italy
const [lon, lat] = projectPointToWgs84(32633, [317500, 5063500]);
const f = makeLocalFrame({ lon0: lon, lat0: lat });
const { Polygon } = getSdk();
const sq = new Polygon({ rings: [[[-200, -200], [-200, 200], [200, 200], [200, -200], [-200, -200]]], spatialReference: f.sr });
const p = defaultProject();
p.name = 'UI';
p.features = [{ id: 'g', name: 'gross', category: 'gross', geometry: toGeoJSON(f.toSr(sq, SpatialReference.WGS84)), attrs: {}, source: 'test', sourceCategory: '' }];
store.project = p;

await test('panels start: areas, terrain, modules, fields, output', async () => {
  try { initAreas(view); } catch (e) { throw new Error('areas: ' + e.message); }
  try { initDims(view); } catch (e) { throw new Error('dims: ' + e.message); }
  initTerrain(view); initModulesUi(); initField(view); initInfra(view); initOutput(); initQuick();
  await wait(600);
  assert(/Italy|RDN2008/.test(document.getElementById('outCrsAlerts').innerText + document.getElementById('outCrs').selectedOptions[0].text), 'national system proposed');
  assert(document.getElementById('fStruct').value === '3V9', 'standard structure');
  assert(/TOPCon/.test(document.getElementById('fModule').selectedOptions[0].text), 'standard module chosen');
  assert(/29° shading angle/.test(text('fPitchHint')), 'Italian minimum pitch: ' + text('fPitchHint'));
  return text('fPitchHint');
});

await test('stepper: states from the panels, gate of a locked step with its link', async () => {
  const st = Object.fromEntries(['areas', 'terrain', 'fields', 'infra', 'output'].map(k => [k, stepState(k)]));
  assert(st.areas.state === 'done' && /ha$/.test(st.areas.figure), `site drawn: ${JSON.stringify(st.areas)}`);
  assert(st.terrain.state === 'optional' && st.fields.state === 'ready' && st.infra.state === 'ready', JSON.stringify(st));
  assert(st.output.state === 'locked' && /3 · Layout/.test(st.output.reason), 'outputs wait for the layout: ' + JSON.stringify(st.output));
  refreshRail();
  const gate = document.querySelector('.step[data-step="output"] > .stepgate');
  assert(gate && /Layout/.test(gate.textContent) && gate.querySelector('[data-goto="fields"]'), 'gate with a link to 3 · Layout');
  assert(!document.querySelector('.step[data-step="fields"] > .stepgate'), 'no gate on an open step');
  // without a site every step but the first is locked
  const feats = store.project.features;
  change('site', q => { q.features = []; });
  await wait(250);
  const locked = ['terrain', 'fields', 'infra', 'output'].map(k => stepState(k).state);
  assert(stepState('areas').state === 'ready' && locked.every(x => x === 'locked'), `no site: ${locked}`);
  change('site', q => { q.features = feats; });
  await wait(250);
  return `${st.areas.figure} buildable · outputs: ${st.output.reason}`;
});

await test('Layers panel: the objects by category out of the Site panel, counters, open by default, collapsible, opened on one object', async () => {
  initCollection();
  const panel = document.getElementById('leftPanel');
  assert(panel && panel.contains(document.getElementById('areaCats')), 'the category cards live in the Layers panel');
  assert(!document.querySelector('.step[data-step="areas"] #areaCats'), 'and not in the Site panel any more');
  assert(isOpen() && !panel.hidden && document.getElementById('collTab').hidden, 'open by default, the reopen button hidden');
  const dots = document.querySelectorAll('#collDots .dot');
  assert(dots.length === 1 && /1/.test(dots[0].textContent) && document.getElementById('collTot').textContent === '1', `counters: one dot for the gross area, total 1 (${dots.length})`);
  toggleCollection(false);
  assert(!isOpen() && panel.hidden && !document.getElementById('collTab').hidden && document.body.classList.contains('left-closed'), 'collapsed to its button');
  showInCollection('g', 'gross');
  const row = document.querySelector('#areaCats .it[data-id="g"]');
  assert(isOpen() && !panel.hidden && document.querySelector('#areaCats .cat[data-cat="gross"]').open && row.classList.contains('flash'), 'opened on the object, its card unfolded, its row highlighted');
  toggleCollection(false);
  assert(!isOpen() && document.getElementById('collTab').getAttribute('aria-expanded') === 'false', 'collapsed again');
  toggleCollection(true);
  return `${dots.length} dot, total ${text('collTot')}`;
});

await test('drawing support (snapping switch of the status bar, boxes of the drawing block) reaches the sketch and is remembered', async () => {
  const vm = window.__sketch;
  assert(vm && vm.snappingOptions.enabled && vm.tooltipOptions.inputEnabled && vm.labelOptions.enabled, 'all on by default');
  setDrawPref('snap', false); setDrawPref('typed', false);
  assert(!vm.snappingOptions.enabled && !vm.tooltipOptions.inputEnabled && !vm.tooltipOptions.enabled && vm.labelOptions.enabled, 'snapping and typed measures off, labels still on');
  assert(JSON.parse(localStorage.getItem('pvp.draw.test')).snap === false, 'remembered under the test key');
  setDrawPref('snap', true); setDrawPref('typed', true);
  assert(vm.snappingOptions.enabled && vm.tooltipOptions.inputEnabled && drawPrefs.snap && drawPrefs.typed, 'back on');
  return 'snap, typed, labels';
});

await test('drawing in two steps from the ribbon: the category menu (Unclassified first), the tools of the category, defaults, undo / redo of a removal', async () => {
  const btn = document.getElementById('drawCatBtn'), list = document.getElementById('drawCatList');
  const tool = id => document.querySelector(`#drawTools [data-dtool="${id}"]`);
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const all = ['point', 'polyline', 'polygon', 'rectangle', 'circle', 'freehand'];
  const off = id => document.getElementById(id).disabled;
  // the menu: Unclassified, then the ten categories of the model; Unclassified is the default and takes every tool
  btn.click();
  const opts = list.querySelectorAll('[role=option]');
  assert(!list.hidden && btn.getAttribute('aria-expanded') === 'true', 'the menu opens');
  assert(opts.length === 11 && opts[0].dataset.id === 'unclassified' && opts[0].getAttribute('aria-selected') === 'true', 'Unclassified first and chosen: ' + opts.length);
  assert(opts[1].querySelector('.dot').style.getPropertyValue('--c') && opts[0].querySelector('.dot.none'), 'colour dots, a dashed one for Unclassified');
  assert(all.every(k => !tool(k).disabled), 'without a category every tool is on');
  assert(off('drawType') && off('drawBuffer'), 'Unclassified: no type and no buffer yet');
  key(list, 'Escape');
  assert(list.hidden && btn.getAttribute('aria-expanded') === 'false', 'Esc closes the menu');
  // a click picks a category: the tools follow it
  btn.click(); list.querySelector('[data-id="gross"]').click();
  assert(list.hidden && /Gross area/.test(btn.textContent), 'gross chosen: ' + btn.textContent);
  assert(tool('point').disabled && tool('polyline').disabled && !tool('polygon').disabled && !tool('rectangle').disabled && !tool('circle').disabled && !tool('freehand').disabled, 'a gross area takes polygons only (circle and freehand too)');
  assert(/polygons|points/.test(tool('point').title), 'the disabled tool says why: ' + tool('point').title);
  assert(off('drawType') && off('drawBuffer') && document.getElementById('drawSizeBox').hidden, 'no type, buffer or size for the gross area');
  // the keyboard: Arrow down opens, End goes to the last category, Enter picks it
  key(btn, 'ArrowDown'); key(list, 'End'); key(list, 'Enter');
  assert(list.hidden && /Reference/.test(btn.textContent), 'keyboard pick: ' + btn.textContent);
  selectDrawCat('exclusion');
  assert(all.every(k => !tool(k).disabled), 'exclusions take every geometry');
  const ty = document.getElementById('drawType'), buf = document.getElementById('drawBuffer');
  assert(!ty.disabled && ty.options.length === 14 && ty.value === '' && !buf.disabled && document.getElementById('drawSizeBox').hidden, 'exclusions: type (13 and «— type —») and buffer on, no size');
  buf.value = '7'; buf.dispatchEvent(new Event('change'));
  selectDrawCat('obstacle');
  assert(!document.getElementById('drawSizeBox').hidden && text('drawSizeCap') === 'Height' && ty.value === 'tree', 'obstacles: height next to the buffer, tree by default');
  selectDrawCat('exclusion');
  assert(buf.value === '7', 'the buffer given to the next exclusions is remembered');
  assert(!document.getElementById('drawFreehand') && [...document.querySelectorAll('#drawTools [data-dtool]')].map(b => b.dataset.dtool).join() === 'polygon,polyline,point,rectangle,circle,freehand',
    'six tools in two rows of three, Freehand one of them (no box)');
  assert(document.getElementById('drawUndo').disabled && historySize().undo === 0, 'nothing to undo yet');
  // the Layers panel has nothing to edit any more (B5): the ribbon draws and edits
  assert(!document.querySelector('#areaCats .drawbtn, #areaCats [data-del], #areaCats select, #areaCats input:not([data-lay])'), 'Layers: nothing to edit on the cards (only the visibility switches)');
  // remove the site through the selection: a message with Undo instead of a confirmation; Undo brings it back
  selectFeatures(['g']);
  deleteSelection();
  await wait(250);
  assert(store.project.features.length === 0 && stepState('areas').state === 'ready', 'site removed, step back to ready');
  const tb = document.querySelector('#toast .toast.action .tact');
  assert(tb && tb.textContent === 'Undo' && /removed/.test(document.querySelector('#toast .toast.action').textContent), 'toast with Undo');
  tb.click();
  await wait(250);
  assert(store.project.features.length === 1 && store.project.features[0].id === 'g', 'site back');
  assert(historySize().undo === 2 && !document.getElementById('drawUndo').disabled, 'two steps in the history');
  assert(undo() && store.project.features.length === 0 && redo() && store.project.features.length === 1, 'undo / redo');
  assert([...document.querySelectorAll('#toast .toast')].some(x => /Redone/.test(x.textContent)), 'a message says Redone');
  selectDrawCat('gross');
  await wait(300);
  return `${opts.length} entries in the menu · ${historySize().undo} undo steps`;
});

await test('objects without a category: first card of the Layers panel, counted nowhere, exported nowhere, then classified', async () => {
  const frame = siteFrame(), before = computeArea(frame).buildableArea;
  const { Polygon } = getSdk();
  const blob = new Polygon({ rings: [[[-50, -50], [-50, 50], [50, 50], [50, -50], [-50, -50]]], spatialReference: f.sr });
  change('site', q => { q.features.push({ id: 'u1', name: 'Object 1', category: 'unclassified', geometry: toGeoJSON(f.toSr(blob, SpatialReference.WGS84)), attrs: {}, source: 'drawn', sourceCategory: '' }); });
  await wait(400);
  const first = document.querySelector('#areaCats .cat');
  assert(first && first.dataset.cat === 'unclassified' && first.classList.contains('pending') && /1/.test(first.querySelector('.cnt').textContent), 'the Unclassified card comes first with its count');
  assert(pendingCount() === 1 && Math.abs(computeArea(frame).buildableArea - before) < 0.01, 'the buildable area does not move');
  assert(/1 object has no category/.test(text('areaSummary')), 'the ledger says so: ' + text('areaSummary'));
  assert(!buildGeoJSON().features.some(x => x.properties.category === 'unclassified'), 'not in the GeoJSON / KMZ');
  const m = exportModel();
  assert(!m.error && !m.items.some(i => i.fid === 'u1'), 'not in the files for Engineering');
  // a click on its row selects it; the Category menu of the ribbon then gives it a category (one that takes an area)
  first.querySelector('.it[data-id="u1"]').click();
  const btn = document.getElementById('drawCatBtn'), list = document.getElementById('drawCatList');
  assert(selectionIds().join() === 'u1' && /1 selected/.test(text('rgSiteLabel')) && /Unclassified/.test(btn.textContent), 'selected from its row, the menu shows Unclassified');
  btn.click(); list.querySelector('[data-id="connection"]').click();
  await wait(200);
  assert(store.project.features.find(x => x.id === 'u1').category === 'unclassified', 'a line category does not take an area');
  btn.click(); list.querySelector('[data-id="exclusion"]').click();
  await wait(400);
  assert(pendingCount() === 0 && store.project.features.find(x => x.id === 'u1').category === 'exclusion', 'classified');
  assert(document.querySelector('#areaCats .cat').dataset.cat !== 'unclassified' && computeArea(frame).buildableArea < before - 9000, 'card gone, the exclusion cuts');
  change('site', q => { q.features = q.features.filter(x => x.id !== 'u1'); });
  await wait(300);
  assert(!selectionIds().length, 'a removed object leaves the selection');
  return 'counted and exported only once classified';
});

await test('selection and edits (2B): rows and box, values on the selection, the card, split, merge, copy, delete with Undo, Esc', async () => {
  const { Polygon, Polyline } = getSdk();
  const sq = (x, y, d) => toGeoJSON(f.toSr(new Polygon({ rings: [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]], spatialReference: f.sr }), SpatialReference.WGS84));
  change('site', q => { q.features.push(
    { id: 'e1', name: 'Excl A', category: 'exclusion', geometry: sq(-150, -150, 100), attrs: { type: 'woodland' }, source: 'drawn', sourceCategory: '' },
    { id: 'e2', name: 'Excl B', category: 'exclusion', geometry: sq(50, 50, 60), attrs: { type: 'flood' }, source: 'drawn', sourceCategory: '' }); });
  await wait(300);
  const rowOf = id => document.querySelector(`#areaCats .it[data-id="${id}"]`);
  const on = id => !document.getElementById(id).disabled;
  assert(rowOf('e1') && !rowOf('e1').querySelector('select, input, [data-del]') && rowOf('e1').querySelector('[data-zoom]'), 'a row: its name and a magnifier only');
  assert(!on('edReshape') && !on('edDelete'), 'the edits are off without a selection');
  // a click selects, Shift+click adds
  rowOf('e1').click();
  rowOf('e2').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert(selectionIds().sort().join() === 'e1,e2' && rowOf('e1').classList.contains('sel') && rowOf('e2').getAttribute('aria-selected') === 'true', 'two selected');
  // the ribbon shows what they share: the category, no common type, the buffer on; reshape needs one, merge is on
  assert(/Exclusion zones/.test(text('drawCatBtn')) && document.getElementById('drawType').value === '' && on('drawBuffer'), 'shared values');
  assert(/2 selected/.test(text('rgSiteLabel')) && !on('edReshape') && on('edMerge') && on('edMove') && !on('edSplit'), 'the edit tools follow the selection');
  const bf = document.getElementById('drawBuffer');
  bf.value = '4'; bf.dispatchEvent(new Event('change'));
  assert(['e1', 'e2'].every(id => store.project.features.find(x => x.id === id).attrs.buffer === 4), 'the buffer goes to both');
  // a box around the first square: it and the site under it, not the second square
  const box = f.toSr(new Polygon({ rings: [[[-160, -160], [-160, -40], [-40, -40], [-40, -160], [-160, -160]]], spatialReference: f.sr }), SpatialReference.WGS84);
  const boxed = selectByGeometry(box);
  assert(boxed.includes('e1') && boxed.includes('g') && !boxed.includes('e2'), 'box selection: ' + boxed.join());
  // the card of one object: its name (renamed there), its area, its source
  selectFeatures(['e1']);
  assert(!document.getElementById('selCard').hidden && document.getElementById('selName').value === 'Excl A' && /1\.00 ha/.test(text('selInfo')), 'card: ' + text('selInfo'));
  const sn = document.getElementById('selName');
  sn.value = 'Wood'; sn.dispatchEvent(new Event('change'));
  assert(store.project.features.find(x => x.id === 'e1').name === 'Wood' && on('edReshape') && on('edSplit'), 'renamed from the card, reshape and split on');
  // split with a line across the square: two pieces with the name, category and values, the area kept
  const area = x => measureFeature(x, siteFrame()).area;
  const cutter = f.toSr(new Polyline({ paths: [[[-100, -170], [-100, -30]]], spatialReference: f.sr }), SpatialReference.WGS84);
  assert(splitSelection(cutter) === 2, 'two pieces');
  const pieces = selectedFeatures();
  assert(pieces.length === 2 && pieces.every(x => /^Wood \(\d\)$/.test(x.name) && x.attrs.buffer === 4 && x.category === 'exclusion'), 'pieces keep name, category, values');
  assert(Math.abs(pieces.reduce((a, x) => a + area(x), 0) - 10000) < 1, 'area kept: ' + pieces.map(area).join(' + '));
  const missed = f.toSr(new Polyline({ paths: [[[300, 300], [320, 320]]], spatialReference: f.sr }), SpatialReference.WGS84);
  selectFeatures([pieces[0].id]);
  assert(splitSelection(missed) === 0 && store.project.features.some(x => x.id === pieces[0].id), 'a line that does not cross: nothing split');
  // merge them back into one
  selectFeatures(pieces.map(x => x.id));
  const m = mergeSelection();
  assert(m && Math.abs(area(m) - 10000) < 1 && selectionIds().join() === m.id, 'merged into one');
  selectFeatures([m.id, 'e2', 'g']);
  assert(!on('edMerge') && /one category/.test(document.getElementById('edMerge').title), 'no merge across categories: ' + document.getElementById('edMerge').title);
  // copy (the app then moves it; not here), delete the copy, Undo brings it back
  selectFeatures([m.id]);
  const n0 = store.project.features.length;
  const copies = copySelection({ move: false });
  assert(copies.length === 1 && store.project.features.length === n0 + 1 && /\(copy\)$/.test(copies[0].name) && selectionIds().join() === copies[0].id, 'a copy, selected');
  deleteSelection();
  await wait(200);
  assert(store.project.features.length === n0 && !selectionIds().length, 'deleted');
  document.querySelector('#toast .toast.action .tact').click();
  await wait(200);
  assert(store.project.features.length === n0 + 1, 'Undo brings it back');
  // Esc clears the selection and its card
  selectFeatures([m.id]);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert(!selectionIds().length && document.getElementById('selCard').hidden && /Site definition/.test(text('rgSiteLabel')), 'Esc clears');
  change('site', q => { q.features = q.features.filter(x => x.id === 'g'); });
  await wait(300);
  return 'rows, box, values, card, split, merge, copy, delete, undo, Esc';
});

await test('layout: structure chosen from the toolkit presets, custom notation on request', async () => {
  const sel = document.getElementById('fStructSel'), box = document.getElementById('fStructBox');
  const presets = structurePresets('ground-fixed');
  assert(sel.value === '3V9' && sel.options.length === presets.length + 1 && sel.options[sel.options.length - 1].value === '__custom', `options ${sel.options.length}`);
  assert(box.hidden, 'notation box hidden for a preset');
  sel.value = '__custom'; sel.dispatchEvent(new Event('change'));
  assert(!box.hidden, 'notation box shown');
  const inp = document.getElementById('fStruct');
  inp.value = '4V7'; inp.dispatchEvent(new Event('change'));
  await wait(400);
  assert(store.project.field.structure === '4V7' && sel.value === '__custom' && /4 × 7 modules/.test(text('fStructHint')), 'custom structure: ' + text('fStructHint'));
  sel.value = '3V9'; sel.dispatchEvent(new Event('change'));
  await wait(400);
  assert(store.project.field.structure === '3V9' && box.hidden, 'back to the preset');
  assert(document.getElementById('fAdv') && document.getElementById('fAdv').contains(document.getElementById('fTarget')), 'target and gaps under Advanced');
  return `${presets.length} presets + custom`;
});

// the quick predesign dialog: open it, check what it proposes, run it
async function quickDialog(set = () => {}) {
  document.getElementById('btnQuick').click();
  await wait(100);
  const dlg = document.querySelector('dialog.quick');
  assert(dlg && dlg.open, 'dialog open');
  const form = dlg.querySelector('form');
  set(form);
  const seen = { pitch: form.pitch.value, hint: form.querySelector('[data-hint]').textContent, tech: form.tech.value };
  dlg.querySelector('button[type=submit]').click();
  await wait(1500);
  return seen;
}

await test('quick predesign, fixed: 3V9, Italian minimum pitch, optimised position, in one click', async () => {
  change('field', q => { q.field.structure = '2V13'; q.field.pitch = null; q.field.moduleId = null; });
  const seen = await quickDialog(form => { form.tech.value = 'ground-fixed'; form.dispatchEvent(new Event('change')); });
  assert(seen.pitch === '10.3' && /Italy \(29° shading angle\)/.test(seen.hint), `proposed ${seen.pitch}: ${seen.hint}`);
  const f = store.project.field, r = last.result;
  assert(f.structure === '3V9' && f.tiltDeg === 15 && f.pitch === 10.3, `field ${f.structure} ${f.tiltDeg} ${f.pitch}`);
  assert(r && r.tables > 100 && r.power.wp === 650, `result ${r && r.tables}`);
  assert(store.project.plannedModules.includes(f.moduleId), 'the module is planned for the project');
  assert(!document.querySelector('dialog.quick'), 'dialog closed');
  assert(store.project.infra.perimeterRoad === false && r.dcMWp > 9, 'over 9 MWp: no perimeter road');
  await wait(300);
  assert(/1,600 m/.test(text('infFenceInfo')) && /4\.0 m/.test(text('infClearHint')), 'fence panel: ' + text('infFenceInfo') + ' · ' + text('infClearHint'));
  assert(/Suggested without/.test(text('infRoadInfo')), 'road panel: ' + text('infRoadInfo'));
  const st = ['fields', 'infra', 'output'].map(k => stepState(k));
  assert(st[0].state === 'done' && /MWp$/.test(st[0].figure) && st[1].state === 'done' && /m$/.test(st[1].figure) && st[2].state === 'ready', 'rail after the layout: ' + JSON.stringify(st));
  return `${r.tables} tables, ${r.dcMWp.toFixed(2)} MWp, offsets ${f.rowOffset} / ${f.columnOffset}, no perimeter road · rail ${st[0].figure}, fence ${st[1].figure}`;
});

await test('fields: 3V9 at the Italian minimum pitch fills the site', async () => {
  document.querySelector('#fPitchHint button[data-pitch]').click();
  await wait(600);
  const r = last.result;
  assert(r && r.tables > 100, `tables ${r && r.tables}`);
  assert(Math.abs(store.project.field.pitch - 10.3) < 0.01, `pitch ${store.project.field.pitch}`);
  assert(r.power.wp === 650 || r.power.period, 'roadmap power of the period');
  return `${r.tables} tables, ${r.dcMWp.toFixed(2)} MWp at ${r.power.wp} Wp (${r.power.period})`;
});

await test('terrain: DTM loaded, slope map drawn, 3V cut (10 %), tracker kept (15 %)', async () => {
  const file = new File([await (await fetch('./fixtures/it_dtm_plane.tif')).blob()], 'it_dtm_plane.tif');
  change('terrain', q => { q.terrain.cellSize = 10; });
  const g = gridForSite(10);
  const r = await sampleDtm(file, g.frame, g.def);
  await useGrid({ id: 'ui', lon0: g.frame.lon0, lat0: g.frame.lat0, ...g.def, source: 'dtm', name: file.name, loadedAt: new Date().toISOString(), zmin: 100, zmax: 220, missing: 0 }, r.z, { persist: false });
  await wait(800);
  const slopes = view.map.layers.find(l => l.title === 'Slopes'), img = view.map.layers.find(l => l.title === 'Terrain image');
  assert(slopes && slopes.graphics.length === 1, `outline of the cut: ${slopes && slopes.graphics.length}`);
  assert(img && img.source && img.source.elements.length === 1 && img.source.elements.getItemAt(0).image.width > 0, 'terrain image on the map');
  assert(/Inside the site: mean slope 12\.0 %/.test(text('terStats')) && /100 % of the site/.test(text('terStats')), 'figures inside the site: ' + text('terStats'));
  const vs = document.getElementById('terViewS'), vz = document.getElementById('terViewZ');
  assert(!vs.disabled && !vz.disabled && document.getElementById('terClear').disabled === false, 'the view switches and Remove are on with a terrain');
  vz.click();
  await wait(300);
  assert(store.project.terrain.view === 'z' && vz.getAttribute('aria-pressed') === 'true' && /\d+ – \d+ m/.test(text('terLegend')), 'elevation view with its legend: ' + text('terLegend'));
  vs.click();
  await wait(300);
  assert(store.project.terrain.view === 's' && vs.getAttribute('aria-pressed') === 'true' && vz.getAttribute('aria-pressed') === 'false', 'slope view');
  vs.click();
  await wait(300);
  assert(!store.project.terrain.showSlope && vs.getAttribute('aria-pressed') === 'false', 'a second click hides the image');
  vs.click();
  await wait(300);
  assert(store.project.terrain.showSlope && store.project.terrain.view === 's', 'and a third shows it again');
  assert(/Fixed 3V/.test(text('terRule')) && /Ground-mounted, fixed/.test(text('terRule')), 'rule shown with its technology: ' + text('terRule'));
  assert(text('terPill') === 'loaded' && document.getElementById('terTech').value === 'ground-fixed' && /again/.test(text('terEsri')), 'panel: loaded, technology mirrored, «analyse again»');
  const ts = stepState('terrain');
  assert(ts.state === 'done' && /ha cut$/.test(ts.figure), 'rail: ' + JSON.stringify(ts));
  assert(/over the slope limit/.test(text('warns')), 'field warning: ' + text('warns'));
  assert(!last.result || last.result.tables === 0, 'no table on a 12 % slope for 3V');
  document.getElementById('fTech').value = 'agri-tracker';
  document.getElementById('fTech').dispatchEvent(new Event('change'));
  await wait(600);
  assert(store.project.field.structure === '1V28' && store.project.field.pitch === null, 'tracker standard, pitch left to the farm');
  assert(/agreed with the farm/.test(text('warns') + text('fPitchHint')), 'pitch message');
  document.getElementById('fPitch').value = '6';
  document.getElementById('fPitch').dispatchEvent(new Event('change'));
  await wait(800);
  const t = last.result;
  assert(t && t.tables > 20, `trackers ${t && t.tables}`);
  assert(!/over the slope limit/.test(text('warns')), 'nothing cut for trackers');
  return `${t.tables} trackers 1V28 (${(t.geom.tableLength).toFixed(2)} m), ${t.dcMWp.toFixed(2)} MWp`;
});

await test('status bar (phase 4): elevation and slope under the pointer, as the limit reads them, red over it, «—» outside and in 3D, hidden without a grid', async () => {
  initStatusBar(view);
  const it = id => document.getElementById(id);
  assert(!it('sbZIt').hidden && !it('sbSlopeIt').hidden, 'shown with a terrain grid');
  const { Point, SpatialReference, projectOperator } = getSdk();
  const f = siteFrame(), wm = (x, y) => projectOperator.execute(new Point({ x, y, spatialReference: f.sr }), SpatialReference.WebMercator);
  // the field is a tracker now (15 % in every direction): one figure, under the limit
  statusAt(wm(10, 20));
  const z1 = text('sbZ'), s1 = text('sbSlope');
  assert(/^\d+\.\d m$/.test(z1) && /^12\.0 %$/.test(s1) && !it('sbSlope').classList.contains('over'), `tracker: ${z1} · ${s1}`);
  assert(/^\d/.test(text('sbE')) && /^\d/.test(text('sbN')), 'the coordinates too');
  // a limit north–south / east–west of 10 %: the two components, red, the limit in the tooltip
  const before = store.project.terrain.limit, from = store.project.terrain.limitFrom;
  setLimit({ maxNS: 10, maxEW: 10 });
  statusAt(wm(10, 20));
  const s2 = text('sbSlope');
  assert(/^N-S 1[12]\.\d · E-W \d\.\d %$/.test(s2) && it('sbSlope').classList.contains('over') && /cut from the buildable area/.test(it('sbSlope').title), `split: ${s2} · ${it('sbSlope').title}`);
  setLimit(before, from || 'custom');
  // outside the grid, then the pointer gone, then in 3D
  statusAt(wm(5000, 5000));
  assert(text('sbZ') === '—' && text('sbSlope') === '—' && /^\d/.test(text('sbE')), 'outside the grid: «—», the coordinates still shown');
  statusAt(wm(10, 20));
  document.dispatchEvent(new CustomEvent('pvp:view3d', { detail: { on: true } }));
  assert(text('sbZ') === '—' && text('sbE') === '—', 'in 3D: «—»');
  // without a grid in memory the two items leave the bar, and come back with it
  const meta = terrainData.meta, z = terrainData.z;
  setTerrainData(null, null); emit('terrain');
  assert(it('sbZIt').hidden && it('sbSlopeIt').hidden, 'hidden without a grid');
  setTerrainData(meta, z); emit('terrain');
  await wait(300);
  assert(!it('sbZIt').hidden, 'back with the grid');
  return `${z1} · ${s1} · ${s2}`;
});

await test('quick predesign, tracker: the pitch agreed with the farm is asked, then 1V28 fills the site', async () => {
  let blocked = false;
  const seen = await quickDialog(form => {
    form.tech.value = 'agri-tracker'; form.dispatchEvent(new Event('change'));
    blocked = !form.checkValidity();          // empty pitch: the form does not run
    form.pitch.value = '5.5';
  });
  assert(blocked && seen.pitch === '5.5' && /agreed with the farm/.test(seen.hint) && /5.50 \/ 6.00/.test(seen.hint), seen.hint);
  const f = store.project.field, r = last.result;
  assert(f.structure === '1V28' && f.pitch === 5.5 && f.tracks.tables === 4, `field ${f.structure} ${f.pitch} ${f.tracks.tables}`);
  assert(r && r.tables > 20, `trackers ${r && r.tables}`);
  return `${r.tables} trackers at 5.50 m, ${r.dcMWp.toFixed(2)} MWp`;
});

await test('internal roads from the corridors of the trackers (4 in line, then 4 m)', async () => {
  await wait(300);
  const r = last.result;
  assert(r.roads.length > 0 && r.roadsLength > 300, `roads ${r.roads.length}, ${r.roadsLength} m`);
  assert(/roads from the corridors/.test(text('infRoads')), text('infRoads'));
  return `${r.roads.length} roads, ${r.roadsLength.toFixed(0)} m`;
});

await test('half tables option and GeoJSON export', async () => {
  const half = document.getElementById('fHalf');
  assert(!half.disabled, 'half tracker defined for 1V28');
  half.checked = true; half.dispatchEvent(new Event('change'));
  await wait(800);
  const r = last.result;
  const fc = buildGeoJSON();
  const tables = fc.features.filter(x => x.properties.category === 'table');
  assert(tables.length === r.tables, 'every table exported');
  assert(tables.every(x => x.properties.wp === r.power.wp), 'power of the period');
  assert(fc.features.some(x => x.properties.category === 'fence') && fc.features.some(x => x.properties.kind === 'internal'), 'fence and roads exported');
  return `${r.halves} halves (1V14) of ${r.tables}`;
});

await test('dimensions: true metres per segment and total, drawn on the map, in the export model and the DXF, removed', async () => {
  const { Point, SpatialReference } = getSdk();
  const wgs = (x, y) => { const q = f.toSr(new Point({ x, y, spatialReference: f.sr }), SpatialReference.WGS84); return [q.x, q.y]; };
  const d = { id: 'dimTest', points: [wgs(-100, -150), wgs(0, -150), wgs(0, -90)] };
  change('dims', q => { q.dims = [d]; });
  await wait(200);
  const parts = dimensionParts(d, f);
  assert(parts.segments.length === 2 && Math.abs(parts.segments[0].length - 100) < 0.01 && Math.abs(parts.segments[1].length - 60) < 0.01 && Math.abs(parts.total - 160) < 0.01, `segments ${parts.segments.map(s => s.length.toFixed(2))}, total ${parts.total.toFixed(2)}`);
  const layer = view.map.layers.find(l => l.title === 'Dimensions');
  const labels = layer ? layer.graphics.filter(g => g.symbol && g.symbol.type === 'text').map(g => g.symbol.text) : [];
  assert(labels.join('|') === '100.0 m|60.0 m|total 160.0 m', 'labels on the map: ' + labels.join('|'));
  const { exportModel } = await import('../app/js/export/model.js'), { buildDxf } = await import('../app/js/export/dxf.js');
  const m = exportModel(), items = m.items.filter(i => i.layer === 'dimension');
  assert(items.length === 4 && items.map(i => i.label).filter(Boolean).join('|') === '100 m|60 m', 'export model: 2 segments with labels + 2 tick pairs: ' + items.map(i => i.label));
  assert(/PVP_DIM/.test(buildDxf(m)), 'DXF layer PVP_DIM');
  removeDimension('dimTest');
  await wait(200);
  assert(store.project.dims.length === 0 && layer.graphics.length === 0, 'removed from the project and the map');
  return `${parts.segments.length} segments, ${parts.total.toFixed(1)} m, ${items.length} DXF items`;
});

await test('KMZ for Google Earth and the one-page PDF report', async () => {
  const r = last.result;
  const out = await buildKmz();
  assert(out && out.blob.size > 1000, 'kmz written');
  const dom = new DOMParser().parseFromString(out.kml, 'application/xml');
  assert(!dom.querySelector('parsererror'), 'valid KML');
  const folders = [...dom.querySelectorAll('Folder > name')].map(n => n.textContent);
  assert(folders.includes('Tables') && folders.includes('Fence') && folders.includes('Gross area'), folders.join(', '));
  const tables = [...dom.querySelectorAll('Placemark')].find(p => /^Tables \(/.test(p.querySelector('name').textContent));
  assert(tables.querySelectorAll('Polygon').length === r.tables, 'one polygon per table in one placemark');
  const rep = await buildReport();
  assert(rep && rep.blob.size > 5000, `pdf ${rep && rep.blob.size} bytes`);
  const pdf = rep.doc.output();
  assert(pdf.startsWith('%PDF') && pdf.includes(`${r.dcMWp.toFixed(2)} MWp`) && pdf.includes('PV Predesign'), 'capacity and title in the PDF');
  assert(rep.data.assumptions.some(a => /agreed with the farm/.test(a)) && rep.data.checks.some(c => /topographic survey/.test(c)), 'assumptions and checks');
  window.__reportPdf = btoa(pdf);
  return `KMZ ${(out.blob.size / 1024).toFixed(0)} KB, ${folders.length} folders · PDF ${(rep.blob.size / 1024).toFixed(0)} KB`;
});

await test('for Engineering: Shapefile, GeoPackage, DXF and bill of quantities in the national system', async () => {
  const wkid = store.project.crs.wkid;
  assert(wkid, 'export system set from the site');
  addStation('CT', lon, lat, 0, { snap: false });
  await wait(800);
  const r = last.result, model = exportModel();
  assert(!model.error, 'model: ' + model.error);
  const { Point, SpatialReference: SR } = getSdk();
  const target = new SR({ wkid });
  const c0 = r.frame.toSr(new Point({ x: r.tablesLocal[0].corners[0][0], y: r.tablesLocal[0].corners[0][1], spatialReference: r.frame.sr }), target);
  const near = (pts, [x, y], tol) => pts.some(p => Math.hypot(p[0] - x, p[1] - y) < tol);
  // Shapefile: read back with shpjs (raw coordinates, no reprojection) and its dBase reader
  const shp = await buildShapefiles(model);
  const [JSZip, shpjs] = await Promise.all([loadJsZip(), loadShp()]);
  const zip = await JSZip.loadAsync(shp.blob);
  for (const n of ['tables', 'fences', 'roads', 'stations', 'buildable', 'areas_polygon']) assert(shp.files.includes(n), `layer ${n} in ${shp.files}`);
  for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg']) assert(zip.file('tables.' + ext), 'tables.' + ext);
  eq(await zip.file('tables.prj').async('text'), await prjFor(wkid), '.prj = ESRI WKT of EPSG:' + wkid);
  const geoms = shpjs.parseShp(await zip.file('tables.shp').async('arraybuffer'));
  const rows = shpjs.parseDbf(await zip.file('tables.dbf').async('arraybuffer'), 'UTF-8');
  assert(geoms.length === r.tables && rows.length === r.tables, `${geoms.length} shapes, ${rows.length} rows, ${r.tables} tables`);
  assert(near(geoms[0].coordinates[0], [c0.x, c0.y], 0.001), 'first table corner at the SDK projection (1 mm)');
  const halves = rows.filter(x => x.HALF === 1);
  assert(halves.length === r.halves && halves.every(x => x.STRUCTURE === r.halfGeom.notation && x.MODULES === r.halfGeom.modules), 'half tables with their notation');
  assert(rows.filter(x => x.HALF === 0).every(x => x.STRUCTURE === store.project.field.structure && x.WP === r.power.wp), 'attributes');
  const shx = new DataView(await zip.file('tables.shx').async('arraybuffer'));
  assert(shx.getInt32(24, false) * 2 === shx.byteLength && shx.byteLength === 100 + 8 * r.tables, 'index length');
  const st = shpjs.parseDbf(await zip.file('stations.dbf').async('arraybuffer'), 'UTF-8');
  assert(st.length === 1 && st[0].KIND === 'CT' && st[0].BUILDING === 'CT-IT', 'station row: ' + JSON.stringify(st[0]));
  // DXF: group codes in pairs, layers declared, one closed polyline per table
  const dxf = buildDxf(model), lines = dxf.split('\r\n');
  assert(lines.length % 2 === 1 && lines.at(-2) === 'EOF', 'pairs and EOF');
  const pairs = []; for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
  const ents = []; let cur = null;
  for (const [c, v] of pairs) { if (c === '0') { cur = { type: v, g: [] }; ents.push(cur); } else if (cur) cur.g.push([c, v]); }
  const layerOf = e => e.g.find(x => x[0] === '8')?.[1];
  const declared = new Set(ents.filter(e => e.type === 'LAYER').map(e => e.g.find(x => x[0] === '2')[1]));
  const usedL = new Set(ents.filter(e => ['POLYLINE', 'POINT', 'TEXT'].includes(e.type)).map(layerOf));
  assert([...usedL].every(l => declared.has(l)), `layers declared: ${[...usedL].filter(l => !declared.has(l))}`);
  const polys = ents.filter(e => e.type === 'POLYLINE');
  const tablesDxf = polys.filter(e => /^PVP_TABLES/.test(layerOf(e)));
  assert(tablesDxf.length === r.tables && tablesDxf.every(e => e.g.some(x => x[0] === '70' && x[1] === '1')), `${tablesDxf.length} closed table polylines`);
  assert(ents.filter(e => e.type === 'VERTEX').length === ents.filter(e => e.type === 'VERTEX').length && polys.length === ents.filter(e => e.type === 'SEQEND').length, 'one SEQEND per polyline');
  const verts = []; let i0 = ents.indexOf(tablesDxf[0]);
  for (let k = i0 + 1; ents[k].type === 'VERTEX'; k++) verts.push([+ents[k].g.find(x => x[0] === '10')[1], +ents[k].g.find(x => x[0] === '20')[1]]);
  assert(verts.length === 4 && near(verts, [c0.x, c0.y], 0.002), 'first table in the DXF at the SDK projection');
  assert(ents.some(e => e.type === 'TEXT' && layerOf(e) === 'PVP_TEXT' && e.g.some(x => x[0] === '1' && x[1] === 'CT')), 'station label');
  // bill of quantities: read back with the app's own Excel reader
  const book = await readWorkbook(await (await buildBoq(model)).arrayBuffer());
  eq(book.map(b => b.name), ['Summary', 'Tables', 'Infrastructure', 'Areas'], 'sheets');
  const sum = book[0].aoa, val = label => sum.find(x => x[0] === label)?.[1];
  assert(val('DC capacity') === Math.round(r.dcMWp * 1000) / 1000 && val('Modules') === r.modules && val('Half tables') === (r.halves || undefined), 'summary figures: ' + JSON.stringify(sum.slice(0, 26)));
  assert(sum.some(x => /^Fence A/.test(x[0]) && x[1] > 1000) && sum.some(x => x[0] === 'Transformer station' && x[1] === 1), 'fence and station quantities');
  assert(sum.some(x => /Foundations and piles/.test(x[0])), 'what is not included is said');
  assert(book[1].aoa.length === r.tables + 1 && Math.abs(book[1].aoa[1][6] - c0.x) < 5, 'one row per table with X, Y');
  // GeoPackage: opened again with SQLite, checked against the OGC rules that readers rely on
  const gp = await buildGeoPackage(model);
  const SQL = await loadSqlJs(), db = new SQL.Database(gp.bytes);
  const one = sql => db.exec(sql)[0]?.values ?? [];
  try {
    eq(one('PRAGMA application_id')[0][0], 0x47504B47, 'application id GPKG');
    eq(one('PRAGMA user_version')[0][0], 10300, 'GeoPackage 1.3');
    eq(one('PRAGMA integrity_check')[0][0], 'ok', 'SQLite integrity');
    eq(one('PRAGMA foreign_key_check'), [], 'foreign keys');
    const srs = one(`SELECT organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys WHERE srs_id = ${wkid}`)[0];
    eq([srs[0], srs[1], srs[2]], ['EPSG', wkid, (await srsDefinition(wkid)).wkt], 'system with its OGC WKT');
    const contents = Object.fromEntries(one('SELECT table_name, data_type FROM gpkg_contents'));
    for (const n of gp.tables) assert(contents[n] === 'features', 'contents: ' + n);
    eq(one("SELECT geometry_type_name, srs_id FROM gpkg_geometry_columns WHERE table_name = 'tables'")[0], ['MULTIPOLYGON', wkid], 'geometry column');
    eq(one('SELECT COUNT(*), SUM(half) FROM "tables"')[0], [r.tables, r.halves || 0], 'one row per table');
    const blob = one('SELECT geom FROM "tables" ORDER BY fid LIMIT 1')[0][0];
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    eq([String.fromCharCode(blob[0], blob[1]), blob[2], blob[3], dv.getInt32(4, true)], ['GP', 0, 3, wkid], 'blob header');
    eq([blob[40], dv.getUint32(41, true), dv.getUint32(45, true), blob[49], dv.getUint32(50, true), dv.getUint32(54, true), dv.getUint32(58, true)], [1, 6, 1, 1, 3, 1, 5], 'WKB multipolygon of one ring of 5 points');
    const ring = [0, 1, 2, 3, 4].map(k => [dv.getFloat64(62 + 16 * k, true), dv.getFloat64(70 + 16 * k, true)]);
    assert(near(ring, [c0.x, c0.y], 0.001), 'first table corner at the SDK projection (1 mm)');
    const area2 = ring.slice(0, 4).reduce((a, p, k) => a + p[0] * ring[k + 1][1] - ring[k + 1][0] * p[1], 0);
    assert(area2 > 0, 'outer ring anticlockwise (OGC)');
    const [minx, maxx, miny, maxy] = [8, 16, 24, 32].map(o => dv.getFloat64(o, true));
    assert(minx === Math.min(...ring.map(p => p[0])) && maxy === Math.max(...ring.map(p => p[1])) && maxx > minx && maxy > miny, 'envelope');
    eq(one('SELECT kind, building FROM stations')[0], ['CT', 'CT-IT'], 'station attributes');
  } finally { db.close(); }
  // the button: no real download (anchor click intercepted), no system -> a message
  const click = HTMLAnchorElement.prototype.click, got = [];
  HTMLAnchorElement.prototype.click = function () { got.push(this.download); };
  try {
    const out = await exportEngineering('dxf');
    assert(out && got[0] === out.name && out.name.endsWith(`_EPSG${wkid}.dxf`), 'download ' + got);
    change('crs', q => { q.crs.auto = false; q.crs.wkid = null; });
    assert(await exportEngineering('shp') === null && got.length === 1, 'no system: nothing written');
    change('crs', q => { q.crs.auto = true; q.crs.wkid = wkid; });
  } finally { HTMLAnchorElement.prototype.click = click; }
  change('infra', q => { q.infra.stations = []; });
  await wait(400);
  return `EPSG:${wkid} · ${shp.files.length} shapefiles · GeoPackage ${(gp.bytes.length / 1024).toFixed(0)} KB, ${gp.tables.length} layers · DXF ${(dxf.length / 1024).toFixed(0)} KB, ${polys.length} polylines, layers ${[...usedL].join(' ')}`;
});

await test('4b · 3D: panel, trackers on the terrain of step 0 at the IT axis height, glTF, report with a 3D view', async () => {
  initView3d(view);
  const narrow = matchMedia('(max-width: 760px)').matches;
  assert(document.querySelector('.mapchips [data-mode="3d"]').getAttribute('aria-disabled') === String(narrow), `the 3D chip knows whether the window is too narrow (${innerWidth} px)`);
  const panel = document.getElementById('d3Panel');
  const cat = panel.querySelector('#d3Cat');
  assert(cat && /1\.50 m/.test(cat.options[0].textContent) && /3\.10 m/.test(cat.options[2].textContent), 'IT categories with their axis heights');
  assert(/IT-PC/.test(panel.textContent) && panel.querySelector('#d3Glb') && panel.querySelector('[data-sun="12-21-9"]'), 'toolkit source, sun buttons, glTF');
  assert(terrainData.meta, 'terrain of step 0 still loaded');
  change('infra', q => { q.infra.stations = []; });
  addStation('CT', lon, lat, 0, { snap: false });
  await wait(800);
  const r = last.result;
  const date = new Date('2026-12-21T09:00:00Z');
  const m = await model3d({ date, query: null });
  eq([m.h.tracker, m.h.axis.value, m.tables.positions.length / 12, m.stations.length], [true, 1.5, r.tables, 1], 'model');
  assert(m.angle < -30, `trackers towards the east in the morning: ${m.angle.toFixed(1)}°`);
  // every tracker end: its axis 1.50 m over the terrain (the midpoint of the two long edges)
  const p = m.tables.positions, k = 7;
  const axisZ = (p[12 * k + 2] + p[12 * k + 11]) / 2;
  const g = (m.tableGround[4 * k] + m.tableGround[4 * k + 3]) / 2;
  close(axisZ - g, 1.5, 1e-6, 'axis height over the ground');
  assert(m.gaps === 0 && m.fences.length >= 1, `ground known everywhere (${m.gaps} gaps), fence walls`);
  // changing category moves the axis
  change('view3d', q => { q.view3d.trackerCategory = 'grazing'; });
  const m2 = await model3d({ date, query: null });
  close((m2.tables.positions[12 * k + 2] + m2.tables.positions[12 * k + 11]) / 2 - g, 2.3, 1e-6, 'grazing: 2.30 m');
  change('view3d', q => { q.view3d.trackerCategory = 'standard'; });
  // glTF of the layout: nodes and extras
  const glb = layoutGlb(m, null, { wkid: 6708, x: 1, y: 2 });
  const { json } = readGlb(glb.buffer);
  eq(json.nodes.map(n => n.name), ['Modules', 'Stations', 'Fence'], 'nodes');
  eq(json.accessors[0].count, r.tables * 4, 'module vertices');
  eq([json.asset.extras.national.wkid, json.asset.extras.axes], [6708, 'x east, y up, z south'], 'extras');
  // the PDF report with a picture of the 3D view on a second page
  const c = document.createElement('canvas'); c.width = 400; c.height = 240;
  const cx = c.getContext('2d'); cx.fillStyle = '#3b5'; cx.fillRect(0, 0, 400, 240);
  const rep = await buildReport({ views: [{ name: 'From the road', dataUrl: c.toDataURL('image/jpeg', 0.8), width: 400, height: 240, note: 'test' }] });
  eq(rep.doc.getNumberOfPages(), 2, 'second page with the 3D view');
  change('infra', q => { q.infra.stations = []; });
  await wait(400);
  return `${r.tables} trackers at ${m.angle.toFixed(1)}° on 21 Dec 09:00 UTC, GLB ${(glb.buffer.byteLength / 1024).toFixed(0)} KB`;
});

await test('background map: satellite without labels, opacity slider kept when switching to topographic', async () => {
  try { localStorage.removeItem('pvp.test.basemapOpacity'); } catch {}
  const added = [];
  // basemaps from ids load their layers from the network (not in the test bench): stand-in basemaps with a layer each
  const { GraphicsLayer } = getSdk();
  const v = { map: new Map({ basemap: { baseLayers: [new GraphicsLayer()] } }), ui: { add: (w, pos) => added.push([w, pos]) } };
  const box = initBasemap(v);
  // one stack bottom right: the basemap toggle above, the opacity slider below
  assert(added.length === 1 && added[0][1] === 'bottom-right' && added[0][0].classList.contains('bmstack'), 'one stack bottom right');
  assert(added[0][0].lastElementChild === box && added[0][0].children.length === 2, 'the toggle above the slider');
  assert(/basemap: 'satellite'/.test(await (await fetch('../app/js/main.js')).text()), 'the app starts on satellite imagery without labels');
  const input = box.querySelector('input');
  eq(input.value, '100', 'opaque by default');
  input.value = '40'; input.dispatchEvent(new Event('input'));
  assert(v.map.basemap.baseLayers.every(l => l.opacity === 0.4) && /40 %/.test(box.textContent), 'opacity applied: ' + box.textContent);
  v.map.basemap = { baseLayers: [new GraphicsLayer()] };
  await wait(50);
  assert(v.map.basemap.baseLayers.length && v.map.basemap.baseLayers.every(l => l.opacity === 0.4), 'the other basemap takes the same opacity');
  eq(localStorage.getItem('pvp.test.basemapOpacity'), '0.4', 'remembered in this browser (test key)');
  localStorage.removeItem('pvp.test.basemapOpacity');
  return box.textContent;
});

await test('infrastructure panel: lots numbered, two of them joined in one fence with the check boxes', async () => {
  const { Polyline } = getSdk();
  const line = (pts, type, buffer) => ({ id: type, name: type, category: 'linear', attrs: { type, buffer }, source: 'test', sourceCategory: '',
    geometry: toGeoJSON(f.toSr(new Polyline({ paths: [pts], spatialReference: f.sr }), SpatialReference.WGS84)) });
  change('site', q => { q.features.push(line([[-260, 0], [260, 0]], 'road', 10), line([[0, 0], [0, 260]], 'ditch', 5)); });
  await wait(800);
  const boxes = [...document.querySelectorAll('#infLots [data-lot]')];
  assert(boxes.length === 3 && !document.getElementById('infLotsBox').hidden, `lots in the panel: ${boxes.length}`);
  for (const b of boxes.slice(0, 2)) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); }
  document.getElementById('infJoin').click();
  await wait(800);
  assert(store.project.infra.fenceGroups.length === 1, 'one group');
  assert(/fence A/.test(text('infLots')) && (text('infLots').match(/fence A/g) || []).length === 2, text('infLots'));
  const labels = view.map.layers.find(l => l.title === 'Infrastructure').graphics.filter(g => g.symbol?.type === 'text').map(g => g.symbol.text);
  assert(labels.includes('1 · A') && labels.includes('2 · A') && labels.includes('3'), 'labels on the map: ' + labels.join(' '));
  // the tools of the ribbon: a station tool is pressed while it places, the road kinds are a radio pair with their widths
  const cc = document.getElementById('infCC');
  cc.click();
  assert(cc.getAttribute('aria-pressed') === 'true' && document.getElementById('infCT').getAttribute('aria-pressed') === 'false', 'the station tool is pressed');
  cc.click();
  assert(cc.getAttribute('aria-pressed') === 'false', 'a second click releases it');
  const kinds = [...document.querySelectorAll('#infRoadKind [data-roadkind]')];
  assert(kinds.length === 2 && kinds[0].getAttribute('aria-checked') === 'true' && /Heavy · \d/.test(kinds[0].textContent), 'road kinds: ' + kinds.map(k => k.textContent).join(' / '));
  kinds[1].click();
  await wait(400);
  assert(document.querySelector('#infRoadKind [data-roadkind="light"]').getAttribute('aria-checked') === 'true', 'light chosen');
  document.querySelector('#infRoadKind [data-roadkind="heavy"]').click();
  await wait(300);
  // a tool of tabs 1-3 asks for the Properties panel (main.js reopens it when collapsed)
  initRibbon();
  let asked = 0;
  const ask = () => { asked++; };
  document.addEventListener('pvp:properties', ask);
  document.getElementById('modAddBtn').click();
  document.getElementById('modAddBtn').click();   // and closes the module form again
  document.removeEventListener('pvp:properties', ask);
  assert(asked === 2 && document.getElementById('modForm').hidden, 'ribbon tools ask for the Properties panel: ' + asked);
  change('site', q => { q.features = q.features.filter(x => x.category !== 'linear'); q.infra.fenceGroups = []; });
  await wait(500);
  return labels.join(' | ');
});

await test('Layers panel (phase 3): a switch per layer, its figure, Hide all / Show all, remembered in this browser, the 3D kinds', async () => {
  const box = key => document.querySelector(`#collPanel input[data-lay="${key}"]`);
  const fig = key => (document.querySelector(`#collPanel [data-fig="${key}"]`)?.textContent || '').trim();
  const layer = title => view.map.layers.find(l => l.title === title);
  const flip = (key, on) => { const b = box(key); b.checked = on; b.dispatchEvent(new Event('change', { bubbles: true })); };
  const keys = ['terrain:cut', 'layout:buildable', 'layout:tables', 'layout:fences', 'layout:roads', 'layout:stations'];
  assert(keys.every(k => box(k) && box(k).checked), 'a row per computed layer, all on');
  assert(['areas', 'terrain', 'fields', 'infra'].every(tab => document.querySelector(`#collPanel .lgroup[data-tab="${tab}"]`)), 'a group per tab, in their order');
  assert(/ha$/.test(fig('layout:buildable')) && /^\d[\d,]*$/.test(fig('layout:tables')) && /km$/.test(fig('layout:fences')), `figures: ${fig('layout:buildable')} · ${fig('layout:tables')} · ${fig('layout:fences')}`);
  // a category: its objects leave the map, they still count
  const before = computeArea(siteFrame()).buildableArea;
  flip('cat:gross', false);
  await wait(200);
  assert(!layerVisible('cat:gross') && !layer('Areas').graphics.some(x => x.attributes?.id === 'g') && document.querySelector('#areaCats .cat[data-cat="gross"]').classList.contains('off'), 'the gross area leaves the map');
  assert(Math.abs(computeArea(siteFrame()).buildableArea - before) < 0.01, 'and still counts');
  flip('cat:gross', true);
  await wait(200);
  assert(layer('Areas').graphics.some(x => x.attributes?.id === 'g'), 'back on the map');
  // a computed layer: the tables, the fences of the infrastructure layer
  flip('layout:tables', false); flip('layout:fences', false);
  const lay = g => g.attributes?.lay;
  assert(!layer('Tables').visible && layer('Infrastructure').graphics.filter(g => lay(g) === 'layout:fences').every(g => !g.visible)
    && layer('Infrastructure').graphics.filter(g => lay(g) === 'layout:roads').every(g => g.visible), 'tables and fences hidden, roads still shown');
  // Hide all: every switch off, the terrain image too; remembered under the test key; Show all brings them back
  document.getElementById('layHide').click();
  await wait(300);
  assert([...document.querySelectorAll('#collPanel input[data-lay]')].every(i => !i.checked) && !layer('Buildable area').visible && !layer('Slopes').visible
    && !store.project.terrain.showSlope && !document.getElementById('layTerImage').checked, 'all hidden');
  assert(JSON.parse(localStorage.getItem('pvp.test.layerVis'))['layout:tables'] === false, 'remembered in this browser (test key)');
  document.getElementById('layShow').click();
  await wait(300);
  assert([...document.querySelectorAll('#collPanel input[data-lay]')].every(i => i.checked) && layer('Tables').visible && layer('Slopes').visible
    && store.project.terrain.showSlope && document.getElementById('layTerImage').checked && !document.getElementById('terLegend').hidden, 'all shown, the image and its legend');
  assert(KIND_3D.tables === 'layout:tables' && KIND_3D.fence === 'layout:fences' && KIND_3D.stations === 'layout:stations', 'the 3D model follows the same switches');
  return `${keys.length} computed layers · ${fig('layout:tables')} tables · ${fig('layout:fences')}`;
});

await test('search (phase 5): Ctrl K and the objects of the project, addresses and coordinates top right, Zoom to on a right click in Layers', async () => {
  initSearch(view); initGeoSearch(view); initLayerMenu(view);
  const it = id => document.getElementById(id), input = it('objSearchIn');
  const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const type = v => { input.value = v; input.dispatchEvent(new Event('input')); };
  // the matching: every word, case and accents ignored, the words found in bold
  const sample = [{ name: 'Città di prova', catLabel: 'Exclusion', typeLabel: '', source: '' }, { name: 'Other', catLabel: 'Gross area', typeLabel: '', source: '' }];
  assert(fold('Città') === 'citta' && matchItems('CITTA', sample).list.length === 1 && matchItems('prova citta', sample).list.length === 1
    && !matchItems('prova gross', sample).list.length && matchItems('gross', sample).list[0].name === 'Other', 'every word, no case, no accents, the category too');
  assert(highlight('Città di prova', 'citta') === '<b>Città</b> di prova', highlight('Città di prova', 'citta'));
  // only Ctrl K opens it; a pick selects, opens Site area, shows the row
  assert(it('objSearch').hidden, 'closed until Ctrl K');
  const f0 = store.project.features.find(f => f.category !== 'unclassified');
  it('banner').hidden = true;   // no tool armed (the banner of the app is hidden then)
  key('k', { ctrlKey: true });
  assert(!it('objSearch').hidden, 'Ctrl K opens it');
  type('zz no such thing');
  assert(/No object matches/.test(text('objSearchRes')), 'nothing found is said');
  type(f0.name);
  const first = matchItems(f0.name, searchItems()).list[0];
  assert(document.querySelectorAll('#objSearchRes [data-i]').length >= 1 && first, 'found by its name');
  showStep('terrain');
  it('objSearch').requestSubmit();
  await wait(300);
  assert(it('objSearch').hidden && selectionIds().join() === first.id && currentTab() === 'areas', `picked: ${selectionIds().join()} in ${currentTab()}`);
  // a hidden category: found, marked, the category stays off
  setLayerVisible('cat:' + f0.category, false);
  key('k', { ctrlKey: true }); type(f0.name);
  assert(document.querySelector('#objSearchRes .hid'), 'marked hidden');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(it('objSearch').hidden && !layerVisible('cat:' + f0.category), 'Esc closes it, the category stays off');
  setLayerVisible('cat:' + f0.category, true);
  // a tool armed: Ctrl K does nothing
  document.dispatchEvent(new CustomEvent('pvp:mode', { detail: { mode: 'draw', label: 'Draw' } }));
  key('k', { ctrlKey: true });
  assert(it('objSearch').hidden, 'not while drawing');
  document.dispatchEvent(new CustomEvent('pvp:mode', { detail: { mode: 'select' } }));
  // coordinates read in the browser
  const c1 = parseCoordinates('45.4642, 9.19'), c2 = parseCoordinates('9.19E 45.4642N'), c3 = parseCoordinates(`45°27'51"N 9°11'24"E`);
  const c4 = parseCoordinates('45,4642 9,19'), c5 = parseCoordinates('684621.30 4873020.48');
  assert(c1.lat === 45.4642 && c1.lon === 9.19 && c2.lat === 45.4642 && c2.lon === 9.19 && Math.abs(c3.lat - 45.464167) < 1e-5 && Math.abs(c3.lon - 9.19) < 1e-5
    && c4.lat === 45.4642 && c5.x === 684621.3 && c5.y === 4873020.48, JSON.stringify({ c1, c2, c3, c4, c5 }));
  assert(parseCoordinates('Via Roma 10, Milano') === null && parseCoordinates('95, 200') === null && parseCoordinates('45.1') === null, 'an address, out of range, one number: not coordinates');
  // the address service, stood in: the list, the attribution, a pin on Enter; coordinates go straight to a pin
  let asked = null;
  setGeocoder(async (q, box) => { asked = { q, box }; return [{ name: 'Test place', detail: 'Somewhere, Italy', lon: 9.19, lat: 45.46, bbox: null }]; });
  it('geoBtn').click();
  assert(!it('geoIn').hidden && it('geoSearch').classList.contains('open'), 'the magnifier opens the box');
  it('geoIn').value = 'Test place';
  await geoRun('Test place');
  assert(asked && asked.q === 'Test place' && /Test place/.test(text('geoRes')) && /OpenStreetMap/.test(text('geoRes')), 'results with the attribution: ' + text('geoRes'));
  it('geoSearch').requestSubmit();
  await wait(100);
  assert(pinCount() === 1 && it('geoRes').hidden, 'Enter on the first result: a pin');
  clearPin();
  await geoRun('45.4642, 9.19');
  assert(pinCount() === 1, 'coordinates: a pin, nothing asked');
  it('geoClear').click();
  assert(pinCount() === 0, '× clears the pin');
  setGeocoder(null);
  // Zoom to on a right click: an object, a computed layer; nothing to zoom to says so
  let gone = 0;
  const goTo = view.goTo;
  view.goTo = async () => { gone++; };
  const tablesRow = document.querySelector('#collPanel input[data-lay="layout:tables"]').closest('.layer');
  tablesRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 300 }));
  const menu = document.querySelector('.ctxmenu');
  assert(menu && !menu.hidden && /Zoom to/.test(menu.textContent) && menu.querySelector('[role="menuitem"]').getAttribute('aria-disabled') === 'false', 'the menu of the Tables row');
  menu.querySelector('[role="menuitem"]').click();
  const objRow = document.querySelector('#areaCats .it[data-id]');
  objRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 200 }));
  menu.querySelector('[role="menuitem"]').click();
  assert(gone === 2 && menu.hidden, `zoomed twice: ${gone}`);
  assert(rowTarget(objRow).ids[0] === objRow.dataset.id && targetExtent({ key: 'no-such-layer' }) === null, 'the target of a row; nothing to zoom to');
  view.goTo = goTo;
  return `searchable items: ${searchItems().length} · ${c3.lat.toFixed(5)}, ${c3.lon.toFixed(5)}`;
});

await test('project logic (phase 7): the box of the project and its widest scale, the scale menu and its lock, no save without a name, the names of the files', async () => {
  const it = id => document.getElementById(id);
  // the stand-in view gets the constraints of a MapView
  view.constraints = {}; view.scale = 2500;
  initMapNav(view);
  const { Point, SpatialReference, projectOperator } = getSdk();
  const box = projectBox(store.project.features, SpatialReference.WebMercator);
  const f = siteFrame(), centre = projectOperator.execute(new Point({ longitude: f.lon0, latitude: f.lat0 }), SpatialReference.WebMercator);
  assert(box && box.width > 10000 && box.height > 10000 && box.contains(centre), `a box of 5 km around the gross area: ${box && Math.round(box.width)} × ${box && Math.round(box.height)} map units`);
  assert(view.constraints.geometry && view.constraints.minScale === 50000 && !view.constraints.maxScale, 'the view held in the box, zoomed out to 1:50,000 at most');
  assert(projectBox([], SpatialReference.WebMercator) === null, 'no gross area: no box');
  // the scale menu and its lock
  const sel = it('sbScaleSel'), lock = it('sbScaleLock');
  assert(SCALES.every(v => [...sel.options].some(o => o.value === String(v))) && sel.options.length >= SCALES.length, 'the scales of the menu, 1:100 to 1:25,000');
  lock.click();
  assert(lockedScale() === nearestScale(2500) && view.constraints.minScale === 2500 && view.constraints.maxScale === 2500 && lock.getAttribute('aria-pressed') === 'true', 'locked at the scale of the view');
  sel.value = '500'; sel.dispatchEvent(new Event('change'));
  assert(lockedScale() === 500 && view.constraints.minScale === 500 && view.constraints.maxScale === 500, 'the menu moves the lock');
  lock.click();
  assert(lockedScale() === null && view.constraints.minScale === 50000 && !view.constraints.maxScale, 'unlocked: free again, inside the box');
  assert(nearestScale(36112) === 25000 && nearestScale(140) === 100, 'the nearest scale of the list');
  // a place outside the box: said, not reached
  const outside = await goToPlace({ lon: 12.5, lat: 41.9, name: 'far' });
  assert(outside === false && /Outside the area of the project/.test(text('geoRes')), 'an address outside the box: ' + text('geoRes'));
  // the names of the files and no save without a name
  assert(isUntitled('') && isUntitled('Untitled project') && !isUntitled('C0000 Prova'), 'what counts as unnamed');
  const before = store.project.name;
  change('name', q => { q.name = 'C0000 Prova'; });
  assert(/^C0000 Prova_\d{4}-\d{2}-\d{2}$/.test(fileBase()) && projectFileName('.kmz') === fileBase() + '.kmz', 'name and day: ' + fileBase());
  change('name', q => { q.name = 'Untitled project'; });
  const click = HTMLAnchorElement.prototype.click, pick = window.showSaveFilePicker, got = [];
  HTMLAnchorElement.prototype.click = function () { got.push(this.download); };
  window.showSaveFilePicker = async () => { got.push('picker'); throw Object.assign(new Error('test'), { name: 'AbortError' }); };
  try { await saveProject(false); } finally { HTMLAnchorElement.prototype.click = click; window.showSaveFilePicker = pick; }
  assert(!got.length && it('projName').classList.contains('need') && [...document.querySelectorAll('#toast .toast')].some(x => /Name the project before saving/.test(x.textContent)), 'unnamed: nothing saved, the name asked');
  change('name', q => { q.name = before; });
  view.constraints = undefined;
  return `${fileBase()} · box ${Math.round(box.width / 1000)} km wide`;
});

await test('drawing aids and Layers (phase 8): the snapping menu and its sources, midpoints and centres, Rename, rows only when they hold something, Buffer in Constraints', async () => {
  const it = id => document.getElementById(id);
  initSnapping(view);
  const sk = window.__sketch, titles = () => sk.snappingOptions.featureSources.map(x => x.layer.title);
  assert(sk.snappingOptions.enabled && sk.snappingOptions.selfEnabled && ['Areas', 'Snap points', 'Infrastructure', 'Buildable area'].every(x => titles().includes(x)) && !titles().includes('Tables'),
    'the default sources: ' + titles().join(', '));
  // a square: its centre and the midpoints of its four sides
  const sq = { id: 'sq', geometry: { type: 'Polygon', coordinates: [[[9, 45], [9.001, 45], [9.001, 45.001], [9, 45.001], [9, 45]]] } };
  const pts = snapPointsOf([sq])[0].points;
  assert(pts.length === 5 && Math.abs(pts[0][0] - 9.0005) < 1e-6 && Math.abs(pts[0][1] - 45.0005) < 1e-6 && pts.some(q => Math.abs(q[0] - 9.0005) < 1e-9 && q[1] === 45), 'centre and midpoints: ' + JSON.stringify(pts));
  assert(snapPointsLayer().graphics.length === store.project.features.filter(f => f.geometry.type !== 'Point').length, 'one multipoint per line or area of the project');
  // the menu of the status bar
  it('sbSnap').click();
  const menu = it('snapMenu');
  assert(!menu.hidden && menu.querySelectorAll('input[data-snap]').length === 7, 'the menu opens with its seven rows');
  const box = key => menu.querySelector(`input[data-snap="${key}"]`);
  box('snapGuides').click();
  assert(!sk.snappingOptions.selfEnabled, 'guides off');
  box('snapTables').click();
  assert(titles().includes('Tables'), 'the tables added');
  box('snapGuides').click(); box('snapTables').click();
  assert(sk.snappingOptions.selfEnabled && !titles().includes('Tables'), 'back as they were');
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(menu.hidden, 'Esc closes it');
  // Rename in place, one step of Undo
  const f = store.project.features.find(x => x.category !== 'unclassified'), old = f.name;
  const row = document.querySelector(`#areaCats .it[data-id="${f.id}"]`);
  assert(rowTarget(row).rename === f.id, 'an object row can be renamed');
  const input = renameRow(f.id);
  input.value = 'Renamed site';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(200);
  assert(store.project.features.find(x => x.id === f.id).name === 'Renamed site', 'renamed');
  assert(undo() && store.project.features.find(x => x.id === f.id).name === old, 'and back with Undo');
  // rows only when they hold something (L9)
  const rowOf = key => document.querySelector(`#collPanel input[data-lay="${key}"]`).closest('.layer');
  const fig = key => (document.querySelector(`#collPanel [data-fig="${key}"]`)?.textContent || '').trim();
  assert(['layout:roads', 'layout:stations', 'layout:tables', 'terrain:cut'].every(k => rowOf(k).hidden === !fig(k)), 'a row shows with its figure: ' + ['layout:roads', 'layout:stations', 'layout:tables', 'terrain:cut'].map(k => `${k}=${fig(k) || '-'}${rowOf(k).hidden ? ' hidden' : ''}`).join(', '));
  // Buffer above the boundary setback, in Constraints
  const group = it('drawBuffer').closest('.rgroup');
  assert(group && group.contains(it('boundarySetback')) && !it('drawTools').closest('.rgroup').contains(it('drawBuffer')), 'Buffer in Constraints with the setback');
  return `${titles().length} snapping sources · ${pts.length} points on a square`;
});

await test('the Terrain ribbon (phase 9): four images one at a time, the limit set in the ribbon, the contours on the map, in Layers and in the DXF', async () => {
  const it = id => document.getElementById(id), T = () => store.project.terrain;
  // the slope classes are on: the other three in turn, then back to the slope classes (a click on the one on hides it)
  const ids = ['terViewZ', 'terViewA', 'terViewH', 'terViewS'];
  for (const id of ids) {
    it(id).click();
    await wait(200);
    assert(T().showSlope && T().view === it(id).dataset.view && ids.every(x => it(x).getAttribute('aria-pressed') === String(x === id)), `${id}: one image at a time`);
    if (id === 'terViewH') assert(/shaded relief/.test(text('terLegend')), 'the legend follows the image: ' + text('terLegend'));
  }
  // the limit in the ribbon: the menu shows the values it needs
  const sel = it('terLimitSel');
  sel.value = 'nsew'; sel.dispatchEvent(new Event('change')); await wait(200);
  assert(T().limit && T().limit.maxNS != null && !it('terLimitNsew').hidden && it('terLimitAny').hidden, 'north–south and east–west');
  sel.value = 'toolkit'; sel.dispatchEvent(new Event('change')); await wait(200);
  assert(!T().limit && it('terLimitNsew').hidden && it('terLimitAny').hidden, 'back to the toolkit rule');
  assert(it('terTech').closest('.rgroup') && it('terApply').closest('.rgroup') && !it('terRule').closest('.rgroup'), 'the settings in the ribbon, the explanations in the panel');
  // the contours: the tool, the step, the row of Layers, the DXF
  change('terrain', q => { q.terrain.contours = false; });   // «Show all» of an earlier test switched them on: start from off
  it('terContours').click(); await wait(400);
  const cl = view.map.layers.find(l => l.title === 'Contours');
  assert(T().contours && cl.visible && cl.graphics.length > 0 && it('layContours').checked && /every 1/.test(text('layContoursFig')), `contours drawn and listed: on ${T().contours}, layer ${!!cl} ${cl && cl.visible} ${cl && cl.graphics.length}, row ${it('layContours').checked}, fig «${text('layContoursFig')}», tool disabled ${it('terContours').disabled}`);
  const step = it('terContourStep'); step.value = '5'; step.dispatchEvent(new Event('change')); await wait(400);
  assert(T().contourStep === 5 && /every 5/.test(text('layContoursFig')), 'the step');
  const { exportModel } = await import('../app/js/export/model.js'), { buildDxf } = await import('../app/js/export/dxf.js');
  const md = exportModel(), cts = md.items ? md.items.filter(x => x.layer === 'contour') : [];
  const dxf = md.items ? buildDxf(md) : '';
  assert(cts.length > 0 && cts.every(x => x.attrs.elev_m === x.z) && dxf.includes('PVP_CONTOURS'), `contours in the export: ${cts.length}`);
  it('layContours').click(); await wait(300);
  assert(!T().contours && !cl.visible, 'the Layers row switches them off');
  return `4 images · ${cts.length} contours every 5 m in the DXF`;
});

await test('Layout and Infrastructure (phase 10A): five tabs, the field set in the ribbon, Advanced… and Modules… as windows, Quick predesign on the right', async () => {
  const it = id => document.getElementById(id);
  const tabs = TABS.map(x => x.id);   // the bar itself is not built on this page
  assert(tabs.join() === 'areas,terrain,fields,infra,output', 'five tabs: ' + tabs.join());
  const fieldGroup = it('fTech').closest('.rgroup');
  assert(fieldGroup && fieldGroup.dataset.tab === 'fields' && ['fStructSel', 'fModule', 'fPeriod', 'fTilt', 'fAz', 'fPitch', 'fOptimise', 'fAdvBtn'].every(id => fieldGroup.contains(it(id))), 'the field in the ribbon of Layout');
  assert(!document.querySelector('#side [data-step="fields"] select, #side [data-step="fields"] input'), 'the panel of Layout has no setting left');
  assert(it('btnQuick').closest('.rgroup').classList.contains('end') && it('infRoadDraw').closest('.rgroup').dataset.tab === 'infra' && it('infCC').closest('.rgroup').dataset.tab === 'infra', 'Quick on the right; roads and stations in Infrastructure');
  // the windows
  it('fAdvBtn').click();
  assert(it('dlgAdvanced').open && it('dlgAdvanced').contains(it('fTarget')) && it('dlgAdvanced').contains(it('specYield')), 'Advanced… opens with the gaps, the target and the specific yield');
  it('dlgAdvanced').close();
  it('modLibBtn').click();
  assert(it('dlgModules').open && it('dlgModules').contains(it('modList')) && it('modList').children.length > 0, 'Modules… opens the library');
  it('dlgModules').close();
  // a setting of the ribbon still drives the layout
  const pitch = it('fPitch'), before = store.project.field.pitch;
  pitch.value = String((before || 10) + 0.5); pitch.dispatchEvent(new Event('change'));
  await wait(500);
  assert(store.project.field.pitch === (before || 10) + 0.5, 'the pitch set from the ribbon');
  pitch.value = before == null ? '' : String(before); pitch.dispatchEvent(new Event('change'));
  await wait(500);
  return tabs.length + ' tabs';
});

await test('area summary shows the slope cut and the terrain panel its figures', async () => {
  change('field', q => { q.field.technology = 'ground-fixed'; q.field.structure = '3V9'; q.field.pitch = 10.3; });
  await wait(800);
  assert(/slopes over the limit/.test(text('areaSummary')), 'summary: ' + text('areaSummary'));
  assert(/Over the limit: 1\d\.\d\d ha, 100 % of the site/.test(text('terStats')), 'terrain panel: ' + text('terStats'));
  assert(/it_dtm_plane.tif/.test(text('terInfo')), 'terrain info');
  replaceProject(defaultProject());
  await wait(400);
  assert(await runQuick({ technology: 'ground-fixed' }) === null, 'no site: the quick predesign says so');
  // a small site: the quick predesign keeps the perimeter road of the template (up to ~9 MWp)
  const small = new Polygon({ rings: [[[-80, -80], [-80, 80], [80, 80], [80, -80], [-80, -80]]], spatialReference: f.sr });
  const q = defaultProject();
  q.features = [{ id: 's', name: 'small', category: 'gross', geometry: toGeoJSON(f.toSr(small, SpatialReference.WGS84)), attrs: {}, source: 'test', sourceCategory: '' }];
  replaceProject(q);
  await wait(500);
  const rs = await runQuick({ technology: 'ground-fixed' });
  assert(rs && rs.dcMWp < 9 && store.project.infra.perimeterRoad === true, `small site ${rs && rs.dcMWp} MWp, road ${store.project.infra.perimeterRoad}`);
  replaceProject(defaultProject());
  await wait(300);
  return text('terStats') || 'terrain panel empty after a new project';
});

const ok = results.filter(r => r.ok).length;
document.getElementById('sum').innerHTML = `<b class="${ok === results.length ? 'ok' : 'err'}">${ok} / ${results.length} passed</b>`;
document.getElementById('out').innerHTML = results.map(r => `<tr><td class="s ${r.ok ? 'ok' : 'err'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}<br><code>${String(r.note).replace(/</g, '&lt;')}</code></td></tr>`).join('');
window.__results = results;
