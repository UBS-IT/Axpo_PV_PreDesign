// The ribbon under the tabs: the tools of the active tab, in groups (phase 2: the actions of the panels — import, the
// drawing menu and tools, the terrain and its image, roads, stations, modules, the exports). They live in the ribbon
// markup of index.html, grouped by tab (data-tab on the group), with their ids, so the step modules wire them. The
// ribbon shows the groups of the active tab and the key figure of the tab in its context block on the right. A tool of
// tabs 1–4 writes its outcome in the Properties panel, so it asks for the panel when it is collapsed (pvp:properties,
// main.js); the exports of tab 5 answer with a message and leave the panel as it is. Since phase 10 the ribbon sets
// and the panel shows: the settings of a step are in its ribbon, the panel keeps its figures, notices and lists.
import { onStep, onRefresh, currentTab, tabState, TABS } from './tabs.js';
import { t } from '../i18n.js';

export function initRibbon() {
  const ribbon = document.getElementById('ribbon');
  if (!ribbon) return;
  onStep(show);
  onRefresh(context);
  ribbon.addEventListener('click', e => {
    const b = e.target.closest('button, [role=option]'), g = e.target.closest('.rgroup');
    if (!b || b.disabled || !g || g.dataset.tab === 'output') return;
    document.dispatchEvent(new CustomEvent('pvp:properties'));
  });
  show();
}

function show() {
  const tab = currentTab();
  document.querySelectorAll('#ribbon .rgroup[data-tab]').forEach(g => { g.hidden = g.dataset.tab !== tab; });
  const ribbon = document.getElementById('ribbon');
  const tb = TABS.find(x => x.id === tab);
  if (ribbon && tb) ribbon.setAttribute('aria-labelledby', `tab-${tb.id}`);
  context();
}

// the key figure of the active tab (the buildable hectares, the MWp …) or its state
function context() {
  const ctx = document.getElementById('ribbonCtx');
  const tab = currentTab();
  if (!ctx || !tab) return;
  const st = tabState(tab);
  const fig = st.state === 'done' && st.figure ? st.figure : '';
  ctx.innerHTML = fig ? `<span>${t('ribbon.ctx.' + tab)}</span><strong>${fig}</strong>` : `<span>${t('rail.state.' + st.state)}</span>`;
}
