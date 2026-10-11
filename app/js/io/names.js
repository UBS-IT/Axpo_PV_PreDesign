// The names of the files of a project (phase 7, decisions L2 and L3 of 2026-10-11): «<project name>_<YYYY-MM-DD>», the
// day of the save or of the export, then what the file is («.pvpd», «_report.pdf», «.kmz», «_EPSG6707.dxf»…). The ISO
// date puts the files of a project in order by themselves. A project is saved only once the designer has named it (L2).
import { store } from '../state.js';

export const DEFAULT_NAME = 'Untitled project';
export const NAME_HINT = 'C0000 Prova';   // site code and place (an invented example)
export function isUntitled(name = store.project.name) {
  const n = String(name ?? '').trim();
  return !n || n.toLowerCase() === DEFAULT_NAME.toLowerCase();
}
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const safe = s => String(s || 'pv-predesign').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'pv-predesign';
export const fileBase = (d = new Date()) => `${safe(store.project.name)}_${isoDay(d)}`;
export const fileName = (ext, d) => fileBase(d) + ext;
