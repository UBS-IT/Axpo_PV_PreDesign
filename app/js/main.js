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
import { initRail, showStep } from './ui/rail.js';
import { saveProject, openProjectPick, openProjectFile, forgetHandle, PROJECT_EXT } from './io/projectfile.js';
import { toast } from './ui/toast.js';

const $ = id => document.getElementById(id);

async function start() {
  applyI18n();
  initTheme();
  initRail();
  let sdk;
  try {
    [sdk] = await Promise.all([loadSdk(), loadCatalog(),
      loadCountries().catch(e => console.warn('[crs] country outlines not loaded: no automatic system', e))]);
  } catch (e) {
    console.error(e);
    toast(t('toast.sdkFail', { err: e.message || e }), 'err', 30000);
    return;
  }
  const { Map, MapView, ScaleBar, BasemapToggle } = sdk;
  const view = new MapView({
    container: 'view',
    map: new Map({ basemap: 'hybrid' }),
    center: [10.5, 46.5], zoom: 5,
    constraints: { snapToZoom: false },
  });
  view.ui.add(new ScaleBar({ view, unit: 'metric' }), 'bottom-left');
  view.ui.add(new BasemapToggle({ view, nextBasemap: 'topo-vector' }), 'bottom-right');
  window.__view = view;   // debug hook
  await view.when();

  initAreas(view);
  initTerrain(view);
  initModulesUi();
  initField(view);
  initInfra(view);
  initOutput();
  initQuick();
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
  $('btnNew').onclick = () => {
    if (store.project.features.length && !confirm(t('confirm.new'))) return;
    forgetHandle();
    replaceProject(defaultProject());
    showStep('areas');
  };
  $('btnOpen').onclick = () => openProjectPick(projIn);
  projIn.onchange = async () => { const f = projIn.files && projIn.files[0]; projIn.value = ''; if (f) await openProjectFile(f); };
  $('btnSave').onclick = () => saveProject(false);
  $('btnSaveAs').onclick = () => saveProject(true);
  $('btnImport').onclick = () => { showStep('areas'); pickFiles(null); };
  $('crsBadge').onclick = () => { showStep('output'); $('outCrs').focus(); };
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

  if (store.project.features.length) zoomToFeatures();
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
    $('btnTheme').textContent = dark ? '☀' : '☾';
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
