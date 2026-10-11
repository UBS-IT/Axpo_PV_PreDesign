// PV Predesign — bootstrap.
import { loadSdk } from './sdk.js';
import { loadCatalog } from './catalog.js';
import { applyI18n, t } from './i18n.js';
import { store, change, replaceProject, defaultProject, on } from './state.js';
import { loadCountries } from './crs.js';
import { initAreas, importFiles, pickFiles, zoomToFeatures } from './areas.js';
import { initModulesUi, renderModules } from './modules.js';
import { initField } from './field.js';
import { initOutput } from './output.js';
import { initTerrain } from './terrain/terrain.js';
import { initQuick } from './quick.js';
import { initInfra } from './infra.js';
import { initTabs, showStep, startStep, onStep } from './ui/tabs.js';
import { initRibbon } from './ui/ribbon.js';
import { confirmDialog } from './ui/dialog.js';
import { saveProject, openProjectPick, openProjectFile, forgetHandle, PROJECT_EXT } from './io/projectfile.js';
import { toast } from './ui/toast.js';
import { initBasemap } from './ui/basemap.js';
import { initView3d } from './view3d/scene.js';
import { initCollection } from './ui/layers.js';
import { initMapTools } from './ui/maptools.js';
import { initStatusBar } from './ui/statusbar.js';
import { initSearch } from './ui/search.js';
import { initGeoSearch } from './ui/geosearch.js';
import { initLayerMenu } from './ui/layermenu.js';
import { initDims } from './dims.js';
import { loadIcons, icon } from './ui/icons.js';

const $ = id => document.getElementById(id);

async function start() {
  loadIcons();   // the sprite of the design system; the buttons reference it by name before it arrives
  applyI18n();
  initTheme();
  initTabs();
  initRibbon();
  initPanels();
  initSaveState();
  let sdk;
  try {
    [sdk] = await Promise.all([loadSdk(), loadCatalog(),
      loadCountries().catch(e => console.warn('[crs] country outlines not loaded: no automatic system', e))]);
  } catch (e) {
    console.error(e);
    toast(t('toast.sdkFail', { err: e.message || e }), 'err', 30000);
    return;
  }
  const { Map, MapView, ScaleBar, Compass } = sdk;
  // the spatial reference is given, so the view starts even when the background map cannot be reached (company
  // proxies, offline): the site, the layout and the exports do not need it
  const view = new MapView({
    container: 'view',
    map: new Map({ basemap: 'satellite' }),
    spatialReference: { wkid: 3857 },
    center: [10.5, 46.5], zoom: 5,
    constraints: { snapToZoom: false },
  });
  // north arrow under the zoom (the map turns with a right drag; a click puts north back up), then the controls
  // column (ui/maptools.js); the scale bar at the bottom centre in its own container (the SDK has no such corner);
  // the basemap stack bottom right; the status bar reads the pointer and the scale of the view
  view.ui.add(new Compass({ view }), 'top-left');
  new ScaleBar({ view, unit: 'metric', container: $('scalebar') });
  initBasemap(view);
  initMapTools(view);
  initStatusBar(view);
  window.__view = view;   // debug hook
  view.map.basemap.load().then(b => Promise.all(b.baseLayers.map(l => l.load())))
    .catch(e => { console.warn('[map] background map not available', e); toast(t('toast.noBasemap'), '', 15000); });
  try { await view.when(); }
  catch (e) { console.warn('[map] view not ready', e); toast(t('toast.noBasemap'), '', 15000); }

  initCollection();   // the drawer of the objects, before the Site step fills it
  initAreas(view);
  initDims(view);     // dimensions on the map, after the Site step (they snap to its objects)
  initTerrain(view);
  initModulesUi();
  initField(view);
  initInfra(view);
  initOutput();
  initQuick();
  initSearch(view);      // Ctrl K: the objects of the project
  initGeoSearch(view);   // an address or coordinates, top right
  initLayerMenu(view);   // Zoom to, on a right click in the Layers panel
  try { initView3d(view); } catch (e) { console.error('[3d]', e); }   // the 3D step must never stop the app from starting
  on('modules', renderModules);
  on('project', renderModules);

  // project name
  const pn = $('projName');
  const showName = () => { pn.value = store.project.name; document.title = `${store.project.name} · PV Predesign`; };
  showName();
  pn.onchange = () => change('name', p => { p.name = pn.value.trim() || 'Untitled project'; });
  on('name', showName);
  on('project', showName);

  // project file, import, coordinate system
  const projIn = $('fileProject');
  $('btnNew').onclick = async () => {
    if (store.project.features.length && !(await confirmDialog({ title: t('top.newTitle'), text: t('confirm.new'), ok: t('top.new') }))) return;
    forgetHandle();
    replaceProject(defaultProject());
    showStep('areas');
  };
  $('btnOpen').onclick = () => openProjectPick(projIn);
  projIn.onchange = async () => { const f = projIn.files && projIn.files[0]; projIn.value = ''; if (f) await openProjectFile(f); };
  $('btnSave').onclick = () => saveProject(false);
  $('btnSaveAs').onclick = () => saveProject(true);
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveProject(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); openProjectPick(projIn); }
  });

  // files dropped on the map: a project file opens, anything else is imported and sorted into categories
  const vd = $('view');
  vd.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  vd.addEventListener('drop', async e => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    const proj = files.find(f => f.name.toLowerCase().endsWith(PROJECT_EXT));
    if (proj) { await openProjectFile(proj); return; }
    if (files.length) { showStep('areas'); await importFiles(files); }
  });

  showStep(startStep());
  if (store.project.features.length) zoomToFeatures();
}

// The two docked panels: Properties on the right (collapsed to a strip / reopened here), Layers on the left
// (ui/layers.js). The map sits between them and resizes with them, so the controls of the SDK never overlap.
function initPanels() {
  const close = $('rpClose'), open = $('rpOpen'), panel = $('rightPanel');
  const setRight = on => {
    document.body.classList.toggle('right-closed', !on);
    if (panel) panel.hidden = !on;
    if (open) open.hidden = on;
    document.dispatchEvent(new CustomEvent('pvp:panels'));
  };
  if (close) close.onclick = () => { setRight(false); open?.focus(); };
  if (open) open.onclick = () => { setRight(true); close?.focus(); };
  // a step opened from a link or a gate shows the Properties panel again, and so does a ribbon tool whose outcome is
  // written there (ui/ribbon.js)
  onStep(() => { if (panel && panel.hidden) setRight(true); });
  document.addEventListener('pvp:properties', () => { if (panel && panel.hidden) setRight(true); });
}

// «Saved 14:32» in the top bar, from the autosave of state.js
function initSaveState() {
  const el = $('saveStateText'), box = $('saveState');
  if (!el) return;
  el.textContent = t('top.unsaved');
  document.addEventListener('pvp:saved', e => {
    const d = e.detail instanceof Date ? e.detail : new Date();
    el.textContent = t('top.saved', { time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) });
    box?.classList.remove('dirty');
  });
  on('*', () => box?.classList.add('dirty'));
}

// light / dark (follows the system unless chosen), also switches the Esri widget theme
function initTheme() {
  const KEY = 'pvp.theme';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  const apply = mode => {
    if (mode) document.documentElement.dataset.theme = mode; else delete document.documentElement.dataset.theme;
    const dark = mode ? mode === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    $('esriTheme').href = `https://js.arcgis.com/4.34/esri/themes/${dark ? 'dark' : 'light'}/main.css`;
    $('btnTheme').innerHTML = icon(dark ? 'sun' : 'moon');
  };
  apply(saved);
  $('btnTheme').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch {}
    apply(next);
  };
}

start();
