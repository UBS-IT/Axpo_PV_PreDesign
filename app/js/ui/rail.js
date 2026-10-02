// Left rail: the workflow steps as a stepper. Every step reports its state through a provider registered by its
// panel — locked (a prerequisite is missing: the step still opens, with a gate that says why and where to go),
// ready, optional, done (a tick and a key figure). Clicking the active step again folds the side panel away to
// give the map more room. The app reopens on the step last visited when it is not locked, else on the first step
// still to do.
import { on } from '../state.js';
import { t } from '../i18n.js';

const KEY = 'pvp.step';
export const STEPS = ['areas', 'terrain', 'fields', 'infra', 'output'];
const PREREQ = { areas: null, terrain: 'areas', fields: 'areas', infra: 'areas', output: 'fields' };
let current = null;
const providers = {};   // step -> () => { state: 'locked' | 'ready' | 'optional' | 'done', figure?, reason? }
const listeners = [];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A panel tells the rail how its step stands (called by the rail when anything changes, so keep it cheap)
export function stepProvider(step, fn) { providers[step] = fn; }
export function stepState(step) {
  try { return providers[step]?.() || { state: 'ready' }; } catch (e) { console.warn('[rail]', step, e); return { state: 'ready' }; }
}
// listeners of the step shown
export function onStep(fn) { listeners.push(fn); }
export const currentStep = () => current;

export function initRail() {
  const rail = document.getElementById('rail');
  rail.addEventListener('click', e => {
    const b = e.target.closest('button[data-step]');
    if (!b) return;
    if (b.dataset.step === current && !document.body.classList.contains('side-off')) {
      document.body.classList.add('side-off');
      return;
    }
    showStep(b.dataset.step);
  });
  // arrows move between the steps (roving tabindex, as in the Geoportale rail)
  rail.addEventListener('keydown', e => {
    const b = e.target.closest('button[data-step]');
    if (!b || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const all = [...rail.querySelectorAll('button[data-step]')], i = all.indexOf(b);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all[j].focus();
  });
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) { e.preventDefault(); showStep(go.dataset.goto); }
  });
  let tm = 0;
  on('*', () => { clearTimeout(tm); tm = setTimeout(refreshRail, 60); });
}

// The step to open at start: the one last visited unless it is locked now, else the first step still to do
export function startStep() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  if (STEPS.includes(saved) && stepState(saved).state !== 'locked') return saved;
  for (const s of ['areas', 'fields', 'infra', 'output']) if (stepState(s).state !== 'done') return s;
  return 'areas';
}

export function showStep(step) {
  if (!STEPS.includes(step)) step = 'areas';
  const before = current;
  current = step;
  if (before !== step) for (const fn of listeners) { try { fn(step, before); } catch (e) { console.error(e); } }
  document.body.classList.remove('side-off');
  document.querySelectorAll('#side .step').forEach(s => { s.hidden = s.dataset.step !== step; });
  const side = document.getElementById('side');
  if (side) side.scrollTop = 0;
  try { localStorage.setItem(KEY, step); } catch {}
  refreshRail();
}

// States on the rail buttons and the gate of the open step
export function refreshRail() {
  const states = Object.fromEntries(STEPS.map(s => [s, stepState(s)]));
  document.querySelectorAll('#rail button[data-step]').forEach(b => {
    const step = b.dataset.step, st = states[step] || { state: 'ready' }, isOn = step === current;
    b.classList.toggle('on', isOn);
    b.dataset.state = st.state;
    b.tabIndex = isOn || (!current && step === STEPS[0]) ? 0 : -1;
    if (isOn) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    const fig = b.querySelector('.fig');
    if (fig) fig.textContent = st.state === 'done' && st.figure ? st.figure : st.state === 'optional' ? t('rail.optional') : '';
    const sr = b.querySelector('.sr');
    if (sr) sr.textContent = t('rail.state.' + st.state);
    b.title = st.state === 'locked' && st.reason ? st.reason : '';
  });
  for (const sec of document.querySelectorAll('#side .step')) {
    const step = sec.dataset.step, st = states[step];
    if (!st) continue;
    let gate = sec.querySelector(':scope > .stepgate');
    if (st.state === 'locked') {
      if (!gate) { gate = document.createElement('div'); gate.className = 'stepgate'; sec.querySelector('.stephd')?.after(gate); }
      const pre = PREREQ[step];
      gate.innerHTML = `<p>${esc(st.reason || t('gate.generic'))}</p>${pre ? `<button type="button" class="btn primary" data-goto="${pre}">${esc(t('gate.go', { step: t('step.' + pre + '.num') + ' · ' + t('step.' + pre) }))}</button>` : ''}`;
      sec.classList.add('locked');
    } else {
      if (gate) gate.remove();
      sec.classList.remove('locked');
    }
  }
}
