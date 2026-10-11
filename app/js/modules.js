// Module library (kept in this browser, shared by all projects) and the modules planned for the project.
// Modules are entered by hand, come from the catalog (the group's standard module with its power roadmap) or are
// imported from roadmaps: the group roadmap by semester («Roadmap Module- Standard») or a supplier table (CSV /
// Excel, one row per module). Powers of a roadmap are kept by period (S1 / S2 of a year) and the power of the
// chosen period is used; the roadmap is updated every six months, so older powers raise a warning.
// The modules a project uses travel inside it (project.moduleDefs), so a project opens with the same modules on
// any computer.
import { t, fmt } from './i18n.js';
import { store, change, emit, on, uid } from './state.js';
import { catalogModules, standardFor } from './catalog.js';
import { toast } from './ui/toast.js';
import { icon } from './ui/icons.js';
import { readWorkbook } from './io/xlsx.js';
import { parseCsv } from './io/csv.js';

// test pages set __PVP_TEST__ so that they never touch the library of the app (same origin)
const LIB_KEY = globalThis.__PVP_TEST__ ? 'pvp.modules.test' : 'pvp.modules.v1';
export const STALE_DAYS = 183;   // six months

export const library = { modules: loadLibrary() };

function loadLibrary() {
  try {
    const a = JSON.parse(localStorage.getItem(LIB_KEY) || '[]');
    return Array.isArray(a) ? a.filter(validModule) : [];
  } catch { return []; }
}
function saveLibrary() {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(library.modules)); }
  catch (e) { console.warn('[modules] save failed', e); }
}

export function validModule(m) { return !!m && (m.wp > 0 || (Array.isArray(m.powers) && m.powers.length > 0)) && m.length > 0 && m.width > 0; }
export function moduleById(id) { return library.modules.find(m => m.id === id) || null; }
export function moduleLabel(m, period) {
  const p = modulePower(m, period);
  return `${m.manufacturer ? m.manufacturer + ' ' : ''}${m.model || 'Module'} · ${fmt(p.wp)} Wp${p.period ? ` (${periodLabel(p.period)})` : ''}`;
}

// ── periods of a roadmap: 'YYYY-S1', 'YYYY-S2' or a whole year 'YYYY' ──
export function periodOf(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-S${d.getMonth() < 6 ? 1 : 2}`;
}
export function periodLabel(p) { const m = /^(\d{4})(?:-S([12]))?$/.exec(p || ''); return m ? (m[2] ? `S${m[2]} ${m[1]}` : m[1]) : String(p || ''); }
// [start, end) of a period in half-years since year 0 (S1 2026 = 4052, S2 2026 = 4053, 2026 = 4052…4054)
function span(p) {
  const m = /^(\d{4})(?:-S([12]))?$/.exec(p || '');
  if (!m) return null;
  const y = Number(m[1]) * 2;
  return m[2] ? [y + Number(m[2]) - 1, y + Number(m[2])] : [y, y + 2];
}
// Text such as "S1 2026", "S2 2024 old", "2029", " S1 2027" -> period, or null
export function parsePeriod(text) {
  const s = String(text ?? '').trim();
  let m = /\bS\s*([12])\s*[-/ ]?\s*((?:19|20)\d{2})\b/i.exec(s);
  if (m) return `${m[2]}-S${m[1]}`;
  m = /^((?:19|20)\d{2})$/.exec(s);
  return m ? m[1] : null;
}

// Power of a module for a period (default: the current one).
// { wp, period (the roadmap period used, null for a single power), exact, beyond (the period is after the last
// one of the roadmap), before }
export function modulePower(m, period = null) {
  const list = Array.isArray(m?.powers) ? m.powers.filter(x => span(x[0]) && x[1] > 0) : [];
  if (!list.length) return { wp: m?.wp || 0, period: null, exact: true, beyond: false, before: false };
  const want = span(period || periodOf());
  const sorted = [...list].sort((a, b) => span(a[0])[0] - span(b[0])[0]);
  const hit = sorted.find(([p]) => { const s = span(p); return want[0] >= s[0] && want[0] < s[1]; });
  if (hit) return { wp: hit[1], period: hit[0], exact: true, beyond: false, before: false };
  const earlier = sorted.filter(([p]) => span(p)[0] <= want[0]);
  if (earlier.length) { const e = earlier[earlier.length - 1]; return { wp: e[1], period: e[0], exact: false, beyond: true, before: false }; }
  return { wp: sorted[0][1], period: sorted[0][0], exact: false, beyond: false, before: true };
}
export function modulePeriods(m) { return (m?.powers || []).map(x => x[0]); }

// Powers loaded more than six months ago: { stale, days, date } (date: 'YYYY-MM-DD' of the loading)
export function powerAge(m, now = new Date()) {
  if (!m?.importedAt) return { stale: false, days: null, date: null };
  const days = Math.floor((now - new Date(m.importedAt + 'T00:00:00')) / 864e5);
  return { stale: days > STALE_DAYS, days, date: m.importedAt };
}
const today = () => new Date().toISOString().slice(0, 10);

// numbers written as 2382, "2 382", "2,382", "2382 mm" …
export function parseNum(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const m = /-?\d+(\.\d+)?/.exec(s);
  return m ? Number(m[0]) : NaN;
}
// metres from metres or millimetres (a module side is never over 20 m)
export function toMetres(v) {
  const n = parseNum(v);
  if (!(n > 0)) return NaN;
  return n > 20 ? n / 1000 : n;
}

export function addModule(m) {
  let L = toMetres(m.length), W = toMetres(m.width);
  if (L < W) [L, W] = [W, L];
  const mod = { id: m.id || uid(), manufacturer: (m.manufacturer || '').trim(), model: (m.model || '').trim(),
    wp: parseNum(m.wp), length: L, width: W, bifacial: !!m.bifacial, source: m.source || 'manual' };
  for (const k of ['powers', 'importedAt', 'sourceFile', 'sheet', 'roadmapColumn']) if (m[k] != null) mod[k] = m[k];
  if (!(mod.wp > 0) && mod.powers?.length) mod.wp = modulePower(mod).wp;
  if (!validModule(mod)) return null;
  library.modules.push(mod);
  saveLibrary();
  return mod;
}

export function removeModule(id) {
  library.modules = library.modules.filter(m => m.id !== id);
  saveLibrary();
  change('modules', p => {
    p.plannedModules = p.plannedModules.filter(x => x !== id);
    if (p.field.moduleId === id) p.field.moduleId = null;
  });
}

export function setPlanned(id, planned) {
  change('modules', p => {
    const s = new Set(p.plannedModules);
    if (planned) s.add(id); else s.delete(id);
    p.plannedModules = [...s];
  });
}

// ── catalog modules and modules carried by a project ──
// A module with powers is replaced by another copy of it only when that copy was loaded later.
function adopt(m, source) {
  if (!m || !m.id) return false;
  const have = moduleById(m.id);
  if (!have) return !!addModule({ ...m, source: m.source && m.source !== 'ROADMAP' ? m.source : source });
  if ((m.importedAt || '') > (have.importedAt || '')) { Object.assign(have, { ...m, source: have.source }); saveLibrary(); return true; }
  return false;
}
export function seedCatalogModules() {
  let n = 0;
  for (const m of catalogModules()) if (adopt({ ...m, source: 'catalog' }, 'catalog')) n++;
  if (n) emit('modules');
  return n;
}
// modules used by the project (planned and chosen), stored in the project file
export function usedModules(p = store.project) {
  const ids = new Set([...(p.plannedModules || []), p.field?.moduleId].filter(Boolean));
  return library.modules.filter(m => ids.has(m.id)).map(m => ({ ...m }));
}
export function adoptProjectModules(p = store.project) {
  let n = 0;
  for (const m of p.moduleDefs || []) if (adopt(m, 'project')) n++;
  if (n) emit('modules');
  return n;
}
on('project', () => adoptProjectModules());

// The module to use when the project has none yet: the group standard, else the first planned, else the first
export function defaultModuleId(p = store.project) {
  const std = standardFor('module');
  const planned = library.modules.filter(m => (p.plannedModules || []).includes(m.id));
  return (moduleById(std) || planned[0] || library.modules[0] || {}).id || null;
}

// ── roadmap import ──
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Group roadmap by semester (sheet « Roadmap Module- Standard»): blocks that start with a «Date | S1 2026» row,
// then rows «Type de projets», «Puissance (Wc) biface…», «Dimensions (mm)» with one column per kind of project.
// target: { column: RegExp on the project type, length, width (m) } picks the column. Prices are never read.
// Returns { powers: [[period, wp]], column } (powers empty when nothing matches).
export function parseSemesterRoadmap(aoa, target) {
  const label = row => { for (let j = 0; j < row.length; j++) { const v = row[j]; if (v !== null && v !== undefined && String(v).trim() !== '') return [j, String(v).trim()]; } return [-1, '']; };
  const blocks = [];
  let cur = null;
  for (const row of aoa) {
    if (!Array.isArray(row)) continue;
    const [j, text] = label(row);
    if (j < 0) continue;
    if (/^date$/i.test(text)) {
      const p = parsePeriod(row.slice(j + 1).find(v => String(v ?? '').trim() !== ''));
      cur = p ? { period: p, rows: [] } : null;
      if (cur) blocks.push(cur);
      continue;
    }
    if (cur) cur.rows.push({ text: norm(text), row });
  }
  const dimsOf = v => { const n = (String(v ?? '').match(/\d+(?:[.,]\d+)?/g) || []).map(toMetres).filter(x => x > 0.3).sort((a, b) => b - a); return n.length >= 2 ? n : null; };
  const same = (d) => d && Math.abs(d[0] - target.length) < 0.003 && Math.abs(d[1] - target.width) < 0.003;
  const powers = new Map();
  let column = null;
  for (const b of blocks) {
    const type = b.rows.find(r => /^type de projet/.test(r.text));
    const dims = b.rows.find(r => /^dimension/.test(r.text));
    const pow = b.rows.find(r => /^puissance/.test(r.text) && /biface/.test(r.text));
    if (!type || !dims || !pow) continue;
    for (let j = 0; j < type.row.length; j++) {
      const tv = String(type.row[j] ?? '');
      if (!target.column.test(tv) || !same(dimsOf(dims.row[j]))) continue;
      const wp = parseNum(pow.row[j]);
      if (wp > 0 && !powers.has(b.period)) { powers.set(b.period, wp); column = column || tv.trim(); }
      break;
    }
  }
  const order = p => { const m = /^(\d{4})(?:-S([12]))?$/.exec(p); return Number(m[1]) * 2 + (m[2] ? Number(m[2]) - 1 : 0); };
  return { powers: [...powers].sort((a, b) => order(a[0]) - order(b[0])), column };
}

// Supplier roadmap as a table (one row per module): the header row is found, then the modules are read.
const COLUMN_PATTERNS = {
  wp: [/\bwp\b/, /\bpmax\b/, /nominal power/, /rated power/, /\bpower\b/, /potenza/, /puissance/, /leistung/, /\bmoc\b/, /\bwatt/],
  length: [/length/, /lunghezza/, /longueur/, /\blange\b/, /laenge/, /\bheight\b/],
  width: [/width/, /larghezza/, /largeur/, /breite/],
  dims: [/dimension/, /\bsize\b/, /formato/, /\bformat\b/, /abmessung/],
  manufacturer: [/manufacturer/, /\bbrand\b/, /\bmaker\b/, /produttore/, /fabricant/, /hersteller/, /supplier/, /fornitore/, /fournisseur/, /vendor/],
  model: [/\bmodel/, /modello/, /modele/, /\bname\b/, /\bnome\b/, /product/, /reference/, /\bref\b/, /\btype\b/, /\bmodule\b/],
  bifacial: [/bifacial/, /bifacc/, /biface/, /bi facial/],
};
const NOT_POWER = /toler|coeff|temp|percent|\bpct\b|\bkwh\b|degrad|voc|isc|vmp|imp/;

export function detectColumns(headers) {
  const col = {};
  const used = new Set();
  for (const key of ['wp', 'length', 'width', 'dims', 'manufacturer', 'bifacial', 'model']) {
    for (const re of COLUMN_PATTERNS[key]) {
      const h = headers.find(h => !used.has(h) && re.test(norm(h)) && !(key === 'wp' && NOT_POWER.test(norm(h))));
      if (h !== undefined) { col[key] = h; used.add(h); break; }
    }
  }
  return col;
}

// rows: arrays of cells (first rows may be titles). Finds the header row, then reads the modules.
export function parseRoadmap(aoa) {
  let h = -1, col = null;
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const headers = aoa[i].map(c => String(c ?? '').trim());
    const c = detectColumns(headers.filter(Boolean));
    if (c.wp && ((c.length && c.width) || c.dims)) { h = i; col = c; break; }
  }
  if (h < 0) return { mods: [], skipped: 0, headers: (aoa[0] || []).map(String).filter(Boolean) };
  const headers = aoa[h].map(c => String(c ?? '').trim());
  const at = (row, name) => name === undefined ? '' : row[headers.indexOf(name)];
  const mods = [];
  let skipped = 0;
  for (const row of aoa.slice(h + 1)) {
    if (!row.some(c => String(c ?? '').trim())) continue;
    let wp = parseNum(at(row, col.wp));
    if (wp > 0 && wp < 10) wp *= 1000;             // kWp
    let L = toMetres(at(row, col.length)), W = toMetres(at(row, col.width));
    if (!(L > 0 && W > 0) && col.dims) {
      const dims = (String(at(row, col.dims)).match(/\d+(?:[.,]\d+)?/g) || []).map(toMetres).filter(x => x > 0.3).sort((a, b) => b - a);
      if (dims.length >= 2) { L = dims[0]; W = dims[1]; }
    }
    if (L < W) [L, W] = [W, L];
    if (!(wp > 0 && L > 0 && W > 0)) { skipped++; continue; }
    const b = norm(at(row, col.bifacial));
    mods.push({
      manufacturer: String(at(row, col.manufacturer) ?? '').trim(),
      model: String(at(row, col.model) ?? '').trim() || `${Math.round(wp)} Wp`,
      wp, length: L, width: W,
      bifacial: /^(y|yes|si|oui|ja|true|1|x|bifacial)/.test(b),
      source: 'roadmap',
    });
  }
  return { mods, skipped, headers: headers.filter(Boolean), col };
}

// Group roadmap in a workbook: the visible sheet with the most periods for the catalog modules that name a
// roadmap column (the NZIA sheet only if nothing else matches). sheets: [{ name, aoa, hidden }]
export function readGroupRoadmap(sheets, modules = catalogModules()) {
  const out = [];
  for (const cm of modules.filter(m => m.roadmapColumn)) {
    const column = new RegExp('^\\s*' + cm.roadmapColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*') + '\\s*$', 'i');
    let best = null;
    for (const s of sheets) {
      if (s.hidden) continue;
      const r = parseSemesterRoadmap(s.aoa, { column, length: cm.length, width: cm.width });
      const score = r.powers.length - (/nzia/i.test(s.name) ? 0.5 : 0);
      if (r.powers.length && (!best || score > best.score)) best = { ...r, sheet: s.name, score };
    }
    if (best) out.push({ module: cm, powers: best.powers, sheet: best.sheet, column: best.column });
  }
  return out;
}

// sheets of a roadmap file: [{ name, hidden, aoa }], or null (message shown) when the file cannot be read
export async function readRoadmapSheets(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  try {
    if (ext === 'csv' || ext === 'txt') return [{ name: file.name, hidden: false, aoa: parseCsv(await file.text()) }];
    if (ext === 'xls') { toast(t('mod.xlsOld', { file: file.name }), 'err', 12000); return null; }
    return await readWorkbook(await file.arrayBuffer());
  } catch (e) {
    toast(t('toast.importFail', { file: file.name, err: e.message || e }), 'err', 12000);
    return null;
  }
}

export async function importRoadmapFile(file) {
  const sheets = await readRoadmapSheets(file);
  if (!sheets) return 0;
  // 1) the group roadmap by semester
  const group = readGroupRoadmap(sheets);
  if (group.length) {
    for (const g of group) {
      const m = { ...g.module, powers: g.powers, importedAt: today(), sourceFile: file.name, sheet: g.sheet, source: 'roadmap' };
      const have = moduleById(m.id);
      if (have) { Object.assign(have, m); saveLibrary(); } else addModule(m);
      const now = modulePower(m);
      toast(t('mod.roadmapRead', { file: file.name, n: g.powers.length, sheet: g.sheet.trim(), column: g.column,
        first: periodLabel(g.powers[0][0]), last: periodLabel(g.powers[g.powers.length - 1][0]),
        period: periodLabel(now.period), wp: fmt(now.wp) }), 'ok', 12000);
    }
    emit('modules');
    return group.length;
  }
  // 2) a supplier table, one row per module (visible sheets only)
  let best = null;
  for (const s of sheets) {
    if (s.hidden) continue;
    const res = parseRoadmap(s.aoa);
    if (!best || res.mods.length > best.mods.length) best = res;
  }
  if (!best || !best.mods.length) {
    toast(t('mod.importNone', { file: file.name, cols: (best?.headers || []).slice(0, 12).join(', ') || '—' }), 'err', 12000);
    return 0;
  }
  const key = m => `${norm(m.manufacturer)}|${norm(m.model)}|${m.wp}`;
  const have = new Set(library.modules.map(key));
  let added = 0;
  for (const m of best.mods) if (!have.has(key(m))) { addModule({ ...m, importedAt: today(), sourceFile: file.name }); have.add(key(m)); added++; }
  emit('modules');
  toast(best.skipped ? t('mod.importedSkipped', { n: added, file: file.name, skipped: best.skipped })
    : t('mod.imported', { n: added, file: file.name }), 'ok');
  return added;
}

// ── UI ──
export function initModulesUi() {
  const list = document.getElementById('modList');
  const form = document.getElementById('modForm');
  const input = document.getElementById('fileRoadmap');

  seedCatalogModules();
  adoptProjectModules();
  // the module library is a window opened from the ribbon (phase 10, L17): «Modules…» opens it, «Add module» opens it
  // on the form (a second click closes the form), «Import roadmap» reads a file
  const dlg = document.getElementById('dlgModules');
  const openLib = () => { try { if (dlg && !dlg.open) dlg.showModal(); } catch (e) { console.warn('[modules] window', e); } };
  const addForm = () => {
    form.hidden = !form.hidden;
    if (form.hidden) return;
    openLib();
    setTimeout(() => { form.scrollIntoView({ block: 'nearest' }); document.getElementById('mfMan').focus(); }, 0);
  };
  document.getElementById('modAddBtn').onclick = addForm;
  const inDlg = id => document.getElementById(id);
  if (inDlg('modLibBtn')) inDlg('modLibBtn').onclick = openLib;
  if (inDlg('modAddInDlg')) inDlg('modAddInDlg').onclick = () => { if (form.hidden) addForm(); };
  document.getElementById('mfCancel').onclick = () => { form.hidden = true; };
  form.onsubmit = e => {
    e.preventDefault();
    const m = addModule({
      manufacturer: document.getElementById('mfMan').value, model: document.getElementById('mfModel').value,
      wp: document.getElementById('mfWp').value, length: document.getElementById('mfLen').value,
      width: document.getElementById('mfWid').value, bifacial: document.getElementById('mfBif').checked, importedAt: today(),
    });
    if (!m) { toast(t('mod.invalid'), 'err'); return; }
    form.reset(); form.hidden = true;
    setPlanned(m.id, true);   // a module added by hand is meant for this project
  };
  document.getElementById('modImportBtn').onclick = () => input.click();
  if (inDlg('modImportInDlg')) inDlg('modImportInDlg').onclick = () => input.click();
  input.onchange = async () => {
    const f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    try { await importRoadmapFile(f); }
    catch (e) { console.error(e); toast(t('toast.importFail', { file: f.name, err: e.message || e }), 'err'); }
  };
  list.onchange = e => {
    const cb = e.target.closest('input[type=checkbox][data-id]');
    if (cb) setPlanned(cb.dataset.id, cb.checked);
  };
  list.onclick = e => {
    const x = e.target.closest('button[data-del]');
    if (x) removeModule(x.dataset.del);
  };
  renderModules();
}

export function renderModules() {
  const list = document.getElementById('modList');
  if (!list) return;
  const planned = new Set(store.project.plannedModules);
  const mods = [...library.modules].sort((a, b) => (planned.has(b.id) - planned.has(a.id)) || (modulePower(a).wp - modulePower(b).wp));
  list.innerHTML = '';
  for (const m of mods) {
    const row = document.createElement('div');
    row.className = 'it';
    row.innerHTML = `<input type="checkbox" data-id="${m.id}" ${planned.has(m.id) ? 'checked' : ''} title="${t('mod.planned')}" aria-label="${t('mod.planned')}">
      <span class="nm"></span><button class="x" data-del="${m.id}" title="${t('mod.remove')}" aria-label="${t('mod.remove')}">${icon('close')}</button>`;
    const nm = row.querySelector('.nm');
    nm.textContent = moduleLabel(m);
    const sm = document.createElement('small');
    const bits = [`${fmt(m.length, 3)} × ${fmt(m.width, 3)} m${m.bifacial ? ' · ' + t('mod.bifacial').toLowerCase() : ''}`];
    if (m.powers?.length) bits.push(t('mod.roadmapSpan', { first: periodLabel(m.powers[0][0]), last: periodLabel(m.powers[m.powers.length - 1][0]) }));
    const age = powerAge(m);
    if (age.date) bits.push(t('mod.loadedOn', { date: age.date }));
    sm.textContent = bits.join(' · ');
    nm.appendChild(sm);
    if (age.stale) {
      const w = document.createElement('small');
      w.className = 'stale';
      w.textContent = t('mod.stale', { date: age.date, months: Math.floor(age.days / 30.4) });
      nm.appendChild(w);
    }
    list.appendChild(row);
  }
  const cnt = document.getElementById('modCnt');
  if (cnt) cnt.textContent = planned.size ? `${planned.size} / ${library.modules.length}` : (library.modules.length || '');
}
