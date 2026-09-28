// Quick predesign: once the site is loaded, one dialog and one click — the group standard of the chosen technology,
// the standard module at the power of the current semester, the toolkit minimum pitch of the country (fixed
// structures) or the pitch agreed with the farm (trackers), optionally the terrain with its slope limit, then the
// best grid position. Everything stays editable in 2 · Fields: these are defaults, never locks.
import { store, change } from './state.js';
import { t, fmt } from './i18n.js';
import { countryValue, countryName, standardFor } from './catalog.js';
import { siteFrame, crsState } from './areas.js';
import { applyStandard, toolkitMinPitch, optimise, generateNow, last } from './field.js';
import { moduleById, moduleLabel, defaultModuleId } from './modules.js';
import { loadTerrain } from './terrain/terrain.js';
import { suggestedRoad } from './infra.js';
import { showStep } from './ui/rail.js';
import { toast } from './ui/toast.js';

const TECHS = ['ground-fixed', 'agri-tracker', 'agri-fixed'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The field the quick predesign would use for a technology (the project is not changed)
export function quickField(technology) {
  const f = structuredClone(store.project.field);
  applyStandard(f, technology);
  f.moduleId = moduleById(f.moduleId) ? f.moduleId : defaultModuleId();
  f.powerPeriod = null;
  return f;
}

// Pitch proposed for a technology: { pitch, hint } — pitch null when the designer must type it
export function proposedPitch(technology) {
  const f = quickField(technology);
  const iso = crsState.iso;
  if (technology === 'agri-tracker') {
    const ex = iso ? countryValue(iso, 'tracker.pitchExamples') : null;
    return { pitch: null, hint: t('quick.pitchTracker') + (ex ? ' ' + t('field.trackerPitchEx', { country: countryName(iso), list: ex.value.map(v => fmt(v, 2)).join(' / ') }) : '') };
  }
  const m = toolkitMinPitch(f);
  if (m) return { pitch: m.pitch, hint: m.source === 'country' ? t('quick.pitchCountry', { country: m.country, angle: m.angle }) : t('quick.pitchPreset', { id: m.id }) };
  return { pitch: null, hint: iso ? t('field.noShadingRule', { country: countryName(iso) }) : t('field.noCountry') };
}

// Runs the quick predesign. opts: { technology, pitch (m, required when none is proposed), terrain (sample Esri
// World Elevation when no terrain is loaded) }. Returns the field result, or null with a message shown.
export async function runQuick({ technology = 'ground-fixed', pitch = null, terrain = false } = {}) {
  if (!siteFrame()) { toast(t('quick.noSite'), 'err'); return null; }
  const f = quickField(technology);
  if (!moduleById(f.moduleId)) { toast(t('quick.noModule'), 'err'); return null; }
  const p = pitch > 0 ? pitch : proposedPitch(technology).pitch;
  if (!(p > 0)) { toast(t('quick.noPitch'), 'err'); return null; }
  change('field', q => {
    Object.assign(q.field, f, { pitch: p, rowOffset: 0, columnOffset: 0, targetMWp: null, halfTables: false });
    const planned = new Set(q.plannedModules); planned.add(f.moduleId); q.plannedModules = [...planned];
  });
  if (terrain && !store.project.terrain.grid) {
    const ok = await loadTerrain('esri');
    if (ok) change('terrain', q => { q.terrain.applySlopeLimit = true; });
  }
  // perimeter road: the toolkit template for small plants — tried first, left out when the plant is larger
  change('infra', q => { q.infra.perimeterRoad = true; });
  optimise();
  let r = generateNow();
  if (r && suggestedRoad(r.dcMWp) === false) {
    change('infra', q => { q.infra.perimeterRoad = false; });
    optimise();
    r = generateNow();
  }
  showStep('fields');
  const res = document.getElementById('secResults');
  if (res) res.open = true;
  if (r && r.tables) {
    toast(t('quick.done', { mwp: fmt(r.dcMWp, 2), ha: fmt(r.siteArea / 1e4, 2), structure: store.project.field.structure,
      pitch: fmt(p, 2), module: moduleLabel(r.module, null) }), 'ok', 12000);
  } else toast(t('quick.nothing'), 'err', 10000);
  return r;
}

// ── dialog ──
export function openQuick() {
  if (!siteFrame()) { toast(t('quick.noSite'), 'err'); showStep('areas'); return Promise.resolve(null); }
  const cur = TECHS.includes(store.project.field.technology) ? store.project.field.technology : 'ground-fixed';
  const hasTerrain = !!store.project.terrain.grid;
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg quick';
  const opt = tech => {
    const std = standardFor(tech), f = quickField(tech);
    return `<label class="opt"><input type="radio" name="tech" value="${tech}" ${tech === cur ? 'checked' : ''}>
      <span><b>${esc(t('tech.' + tech))}</b><small>${esc(t('quick.techInfo', { structure: f.structure, tilt: tech === 'agri-tracker' ? `±${std?.rotationDeg ?? 55}` : fmt(f.tiltDeg, 0) }))}</small></span></label>`;
  };
  const mod = moduleById(quickField(cur).moduleId);
  dlg.innerHTML = `<form method="dialog">
    <h3>${esc(t('quick.title'))}</h3>
    <p class="hint">${esc(t('quick.intro'))}</p>
    <div class="opts">${TECHS.map(opt).join('')}</div>
    <label class="l" for="qPitch">${esc(t('quick.pitch'))}</label>
    <input id="qPitch" name="pitch" type="number" min="0.5" step="0.01">
    <p class="hint" data-hint></p>
    <p class="hint">${esc(t('quick.module', { module: mod ? moduleLabel(mod, null) : t('field.noModule') }))}</p>
    ${hasTerrain ? `<p class="hint">${esc(t('quick.terrainLoaded'))}</p>`
      : `<label class="chk"><input type="checkbox" name="terrain"> <span>${esc(t('quick.terrain'))}</span></label>`}
    <div class="btns">
      <button type="button" class="btn" data-cancel>${esc(t('crs.dlgCancel'))}</button>
      <button type="submit" class="btn primary">${esc(t('quick.run'))}</button>
    </div>
  </form>`;
  document.body.appendChild(dlg);
  const form = dlg.querySelector('form'), hint = form.querySelector('[data-hint]');
  const refresh = () => {
    const tech = form.tech.value, pp = proposedPitch(tech);
    form.pitch.value = pp.pitch ?? '';
    form.pitch.placeholder = tech === 'agri-tracker' ? t('quick.pitchPlaceholder') : '';
    form.pitch.required = true;
    hint.textContent = pp.hint;
  };
  form.addEventListener('change', e => { if (e.target.name === 'tech') refresh(); });
  refresh();
  return new Promise(resolve => {
    let run = null;
    form.querySelector('[data-cancel]').onclick = () => dlg.close();
    form.onsubmit = () => { run = { technology: form.tech.value, pitch: Number(form.pitch.value) || null, terrain: !!form.terrain?.checked }; };
    dlg.addEventListener('close', async () => { dlg.remove(); resolve(run ? await runQuick(run) : null); });
    dlg.showModal();
  });
}

export function initQuick() {
  for (const id of ['btnQuick', 'areasQuick', 'fQuick']) {
    const b = document.getElementById(id);
    if (b) b.onclick = () => openQuick();
  }
}
