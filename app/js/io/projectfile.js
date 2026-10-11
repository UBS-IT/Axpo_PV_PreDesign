// Project files (.pvpd): a zip holding project.json. Later versions will also carry DTM / DSM and other files.
import { t } from '../i18n.js';
import { store, replaceProject, PROJECT_FORMAT } from '../state.js';
import { toast } from '../ui/toast.js';
import { usedModules } from '../modules.js';
import { terrainData, setTerrainData, saveLocal } from '../terrain/store.js';
import { loadJsZip } from '../libs.js';
import { fileBase, isoDay, isUntitled, NAME_HINT } from './names.js';

export const PROJECT_EXT = '.pvpd';
let handle = null;   // file handle of the open project (File System Access API), to save in place

export async function projectBlob() {
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  // the modules the project uses travel with it: it opens with the same modules on any computer
  const p = { ...store.project, moduleDefs: usedModules(), saved: new Date().toISOString(), app: 'PV Predesign' };
  zip.file('project.json', JSON.stringify(p, null, 1));
  // the terrain grid of the project (step 0), as 32-bit floats row by row from the south-west cell
  if (p.terrain?.grid && terrainData.meta?.id === p.terrain.grid.id && terrainData.z) zip.file('terrain/grid.f32', terrainData.z.buffer);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

// L2: no file for an unnamed project; the name field says it
function askName() {
  const pn = document.getElementById('projName');
  if (pn) { pn.classList.add('need'); pn.focus(); }
  toast(t('proj.needName', { hint: NAME_HINT }), 'err', 9000);
}

async function writeTo(h, blob) {
  const w = await h.createWritable();
  await w.write(blob);
  await w.close();
  toast(t('proj.saved', { file: h.name }), 'ok');
}

// Save in place when the project came from (or went to) a file of today (its name ends with the day, L3); a file of
// another day, "Save as" or a file that cannot be written: ask where, with the name of today, so that every day
// of work keeps its own file. Browsers without the File System Access API download the file instead. An unnamed
// project is not saved (L2).
export async function saveProject(asNew = false) {
  if (isUntitled()) { askName(); return; }
  const blob = await projectBlob();
  if (window.showSaveFilePicker) {
    if (handle && !asNew && String(handle.name || '').includes('_' + isoDay())) {
      try { await writeTo(handle, blob); return; }
      catch (e) {
        if (e && e.name === 'AbortError') return;
        console.warn('[project] the open file cannot be written, asking where to save', e);
      }
    }
    try {
      const h = await window.showSaveFilePicker({ suggestedName: fileBase() + PROJECT_EXT,
        types: [{ description: 'PV Predesign project', accept: { 'application/zip': [PROJECT_EXT] } }] });
      await writeTo(h, blob);
      handle = h;
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.warn('[project] save picker failed, falling back to download', e);
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileBase() + PROJECT_EXT;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(t('proj.saved', { file: a.download }), 'ok');
}

export async function openProjectPick(input) {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'PV Predesign project', accept: { 'application/zip': [PROJECT_EXT] } }] });
      await openProjectFile(await h.getFile(), h);
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.warn('[project] open picker failed, using the file input', e);
    }
  }
  input.click();
}

export async function openProjectFile(file, fileHandle = null) {
  try {
    const JSZip = await loadJsZip();
    const zip = await JSZip.loadAsync(file);
    const pj = zip.file('project.json');
    if (!pj) throw new Error(t('err.notProject'));
    const p = JSON.parse(await pj.async('text'));
    if (!p || p.format !== PROJECT_FORMAT) throw new Error(t('err.notProject'));
    const grid = p.terrain?.grid, zf = zip.file('terrain/grid.f32');
    if (grid && zf) {
      const z = new Float32Array(await zf.async('arraybuffer'));
      if (z.length === grid.nx * grid.ny) { setTerrainData(grid, z); await saveLocal(grid, z); }
    }
    replaceProject(p);
    handle = fileHandle;
    toast(t('proj.opened', { name: store.project.name }), 'ok');
    return true;
  } catch (e) {
    console.error(e);
    toast(t('toast.importFail', { file: file.name, err: e.message || e }), 'err', 10000);
    return false;
  }
}

export function forgetHandle() { handle = null; }
