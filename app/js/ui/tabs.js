// The workflow tabs: five tabs over the ribbon (Site area, Terrain Analysis, Layout, Infrastructure, Report & exports;
// Layout and Infrastructure are apart since phase 10, decision L15, so that each has room for its settings in the
// ribbon). The steps of the app stay what they were (areas, terrain, fields, infra, output): a tab holds one
// of them, and the Properties panel shows the sections of the steps of the active tab. Every step reports its state
// through a provider registered by its panel — locked (a prerequisite is missing: the step still opens, with a gate
// that says why and where to go), ready, optional, done (a tick and a key figure) — and the tab combines the states
// of its steps. The app reopens on the step last visited when it is not locked, else on the first step still to do.
import { on } from '../state.js';
import { t } from '../i18n.js';

const KEY = 'pvp.step';
export const STEPS = ['areas', 'terrain', 'fields', 'infra', 'output'];
export const TABS = [
  { id: 'areas', num: 1, steps: ['areas'] },
  { id: 'terrain', num: 2, steps: ['terrain'] },
  { id: 'fields', num: 3, steps: ['fields'] },
  { id: 'infra', num: 4, steps: ['infra'] },
  { id: 'output', num: 5, steps: ['output'] },
];
export const TAB_OF = Object.fromEntries(TABS.flatMap(tb => tb.steps.map(s => [s, tb.id])));
const PREREQ = { areas: null, terrain: 'areas', fields: 'areas', infra: 'areas', output: 'fields' };
let current = null;
const providers = {};   // step -> () => { state: 'locked' | 'ready' | 'optional' | 'done', figure?, reason? }
const listeners = [], refreshers = [];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A panel tells the tabs how its step stands (called whenever anything changes, so keep it cheap)
export function stepProvider(step, fn) { providers[step] = fn; }
export function stepState(step) {
  try { return providers[step]?.() || { state: 'ready' }; } catch (e) { console.warn('[tabs]', step, e); return { state: 'ready' }; }
}
// The state of a tab from the states of its steps: locked if any is locked, done if all are done, optional if the
// only step is optional, else ready; the figure is the first key figure of its steps (the MWp of 3 · Layout)
export function tabState(id) {
  const tb = TABS.find(x => x.id === id);
  if (!tb) return { state: 'ready' };
  const states = tb.steps.map(s => stepState(s));
  const locked = states.find(s => s.state === 'locked');
  if (locked) return { state: 'locked', reason: locked.reason };
  if (states.every(s => s.state === 'done')) return { state: 'done', figure: states.find(s => s.figure)?.figure || '' };
  if (states.length === 1 && states[0].state === 'optional') return { state: 'optional' };
  return { state: 'ready' };
}
export function onStep(fn) { listeners.push(fn); }
export function onRefresh(fn) { refreshers.push(fn); }
export const currentStep = () => current;
export const currentTab = () => (current ? TAB_OF[current] : null);

export function initTabs() {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  nav.innerHTML = TABS.map(tb => `<button type="button" class="tab" role="tab" id="tab-${tb.id}" data-tab="${tb.id}" aria-selected="false" tabindex="-1">
      <span class="num">${tb.num}</span><span class="lb">${esc(t('tab.' + tb.id))}</span><span class="fig"></span><span class="sr-only"></span></button>`).join('');
  nav.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) showStep(TABS.find(x => x.id === b.dataset.tab).steps[0]);
  });
  // arrows move between the tabs (roving tabindex)
  nav.addEventListener('keydown', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const all = [...nav.querySelectorAll('button[data-tab]')], i = all.indexOf(b);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    all[j].focus();
    showStep(TABS[j].steps[0]);
  });
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) { e.preventDefault(); showStep(go.dataset.goto); }
  });
  let tm = 0;
  on('*', () => { clearTimeout(tm); tm = setTimeout(refreshTabs, 60); });
}

// The step to open at start: the one last visited unless it is locked now, else the first step still to do
export function startStep() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  if (STEPS.includes(saved) && stepState(saved).state !== 'locked') return saved;
  for (const s of ['areas', 'fields', 'infra', 'output']) if (stepState(s).state !== 'done') return s;
  return 'areas';
}

// Shows the tab of a step and the sections of the tab's steps in the Properties panel; a step that shares its tab
// (infra) scrolls into view
export function showStep(step) {
  if (!STEPS.includes(step)) step = 'areas';
  const before = current;
  current = step;
  const tab = TAB_OF[step];
  if (before !== step) for (const fn of listeners) { try { fn(step, before); } catch (e) { console.error(e); } }
  document.querySelectorAll('#side .step').forEach(s => { s.hidden = TAB_OF[s.dataset.step] !== tab; });
  const side = document.getElementById('side');
  if (side) {
    const sec = side.querySelector(`.step[data-step="${step}"]`);
    const first = TABS.find(x => x.id === tab).steps[0];
    if (sec && step !== first) sec.scrollIntoView({ block: 'start' }); else side.scrollTop = 0;
  }
  const title = document.getElementById('rpTitle'), sub = document.getElementById('rpSub');
  if (title) title.textContent = t('tab.' + tab);
  if (sub) sub.textContent = t('tab.' + tab + '.sub');
  try { localStorage.setItem(KEY, step); } catch {}
  refreshTabs();
}

// States on the tab buttons and the gate of every locked section
export function refreshTabs() {
  const states = Object.fromEntries(STEPS.map(s => [s, stepState(s)]));
  const tab = currentTab();
  document.querySelectorAll('#tabs button[data-tab]').forEach(b => {
    const id = b.dataset.tab, st = tabState(id), isOn = id === tab;
    b.setAttribute('aria-selected', String(isOn));
    b.dataset.state = st.state;
    b.tabIndex = isOn || (!tab && id === TABS[0].id) ? 0 : -1;
    const fig = b.querySelector('.fig');
    if (fig) fig.textContent = st.state === 'done' && st.figure ? st.figure : st.state === 'optional' ? t('rail.optional') : '';
    const sr = b.querySelector('.sr-only');
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
      gate.innerHTML = `<p>${esc(st.reason || t('gate.generic'))}</p>${pre ? `<button type="button" class="btn primary" data-goto="${pre}">${esc(t('gate.go', { step: t('tab.' + TAB_OF[pre]) }))}</button>` : ''}`;
      sec.classList.add('locked');
    } else {
      if (gate) gate.remove();
      sec.classList.remove('locked');
    }
  }
  for (const fn of refreshers) { try { fn(); } catch (e) { console.error('[tabs]', e); } }
}
export const refreshRail = refreshTabs;   // the name the panels have always used
