// The ribbon under the tabs: the tools of the active tab, in groups (phase 2: the actions of the panels — import, the
// drawing menu and tools, the terrain and its image, roads, stations, modules, the exports). They live in the ribbon
// markup of index.html, grouped by tab (data-tab on the group), with their ids, so the step modules wire them. The
// ribbon shows the groups of the active tab and the key figure of the tab in its context block on the right. A tool of
// tabs 1–4 writes its outcome in the Properties panel, so it asks for the panel when it is collapsed (pvp:properties,
// main.js); the exports of tab 5 answer with a message and leave the panel as it is. Since phase 10 the ribbon sets
// and the panel shows: the settings of a step are in its ribbon, the panel keeps its figures, notices and lists.
// Since phase 11 every group has an ⓘ beside its name that says in a few lines what is done there (L22).
import { onStep, onRefresh, currentTab, tabState, TABS } from './tabs.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';

export function initRibbon() {
  const ribbon = document.getElementById('ribbon');
  if (!ribbon) return;
  onStep(show);
  onRefresh(context);
  addInfo(ribbon);
  ribbon.addEventListener('click', e => {
    const b = e.target.closest('button, [role=option]'), g = e.target.closest('.rgroup');
    if (!b || b.disabled || !g || g.dataset.tab === 'output' || b.classList.contains('rinfo')) return;   // an ⓘ only explains
    document.dispatchEvent(new CustomEvent('pvp:properties'));
  });
  show();
}

function show() {
  const tab = currentTab();
  document.querySelectorAll('#ribbon .rinfo-pop').forEach(p => { if (p.matches(':popover-open')) p.hidePopover(); });   // another tab, other groups
  document.querySelectorAll('#ribbon .rgroup[data-tab]').forEach(g => { g.hidden = g.dataset.tab !== tab; });
  const ribbon = document.getElementById('ribbon');
  const tb = TABS.find(x => x.id === tab);
  if (ribbon && tb) ribbon.setAttribute('aria-labelledby', `tab-${tb.id}`);
  context();
}

// The ⓘ of every group (N1–N3): a button beside the name of the group (the name and the button share a footer, the
// name keeps its element, which areas.js may rename), and a popover of the browser with the name and a few lines
// (i18n 'ribbon.i.<group>', the group being 'ribbon.g.<group>'): a second click, Esc or a click elsewhere closes it,
// and opening another closes the first. The popovers sit in the ribbon, under the group when they open.
function addInfo(ribbon) {
  ribbon.querySelectorAll('.rgroup').forEach((g, i) => {
    const lab = g.querySelector('.rgroup-label'), key = lab?.dataset.i18n;
    if (!key || !key.startsWith('ribbon.g.') || g.querySelector('.rinfo')) return;
    const name = t(key), text = t(key.replace('ribbon.g.', 'ribbon.i.'));
    const foot = document.createElement('div');
    foot.className = 'rgroup-foot';
    lab.replaceWith(foot);
    foot.append(lab);
    const pop = document.createElement('div');
    pop.id = `rinfo-${i}`;
    pop.className = 'rinfo-pop';
    pop.setAttribute('popover', 'auto');
    pop.setAttribute('role', 'note');
    const b = document.createElement('b'), p = document.createElement('p');
    b.textContent = name; p.textContent = text;
    pop.append(b, p);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rinfo';
    btn.innerHTML = icon('info');
    btn.title = t('ribbon.info', { group: name });
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', pop.id);
    btn.setAttribute('popovertarget', pop.id);
    foot.append(btn);
    ribbon.append(pop);
    // under the ⓘ, below the ribbon, within the window
    pop.addEventListener('beforetoggle', e => {
      if (e.newState !== 'open') return;
      const r = btn.getBoundingClientRect(), top = ribbon.getBoundingClientRect().bottom + 4, w = Math.min(300, innerWidth - 16);
      pop.style.width = `${w}px`;
      pop.style.top = `${Math.round(top)}px`;
      pop.style.left = `${Math.round(Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)))}px`;
    });
    pop.addEventListener('toggle', e => btn.setAttribute('aria-expanded', String(e.newState === 'open')));
  });
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
