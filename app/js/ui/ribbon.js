// The ribbon under the tabs: the tools of the active tab, in groups. In this phase the groups hold the buttons that
// used to sit at the top of the step panels (Import; Analyse the slopes, Own model; Quick predesign, Optimise,
// the stations; the exports): they live in the ribbon markup of index.html, grouped by tab (data-tab on the group),
// with their ids, so the step modules wire them as before. The ribbon shows the groups of the active tab and the
// key figure of the tab in its context block on the right.
import { onStep, onRefresh, currentTab, tabState, TABS } from './tabs.js';
import { t } from '../i18n.js';

export function initRibbon() {
  const ribbon = document.getElementById('ribbon');
  if (!ribbon) return;
  onStep(show);
  onRefresh(context);
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
