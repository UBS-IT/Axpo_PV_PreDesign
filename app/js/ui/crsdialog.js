// Dialog: which coordinate system is a file with projected coordinates (metres) and no declared system in?
// The candidates are the national systems that place every sampled point inside their own country.
import { t } from '../i18n.js';
import { NATIONAL, crsLabel } from '../crs.js';
import { whenClosed } from './dialog.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// candidates: [{ iso, country, wkid, label }]; validate(wkid) -> true if the file's points project somewhere sensible.
// Resolves to the chosen wkid, or null if cancelled.
export function chooseCrs({ file, candidates = [], current = null, validate = () => true }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';
    const pre = candidates.find(c => c.wkid === current)?.wkid ?? candidates[0]?.wkid ?? null;
    const radios = candidates.map(c => `<label class="opt"><input type="radio" name="crsc" value="${c.wkid}" ${c.wkid === pre ? 'checked' : ''}>
      <span><b>${esc(c.label)}</b><small>EPSG:${c.wkid} · ${esc(c.country)}</small></span></label>`).join('');
    const groups = Object.entries(NATIONAL).map(([, n]) => `<optgroup label="${esc(n.name)}">${n.options.map(([w, l]) => `<option value="${w}">${esc(l)} · EPSG:${w}</option>`).join('')}</optgroup>`).join('');
    dlg.innerHTML = `<form method="dialog">
      <h3>${esc(t('crs.dlgTitle', { file }))}</h3>
      <p>${esc(t('crs.dlgText'))}</p>
      ${candidates.length ? `<p class="mut">${esc(t('crs.dlgCandidates'))}</p><div class="opts">${radios}</div>
        ${candidates.length > 1 ? `<p class="hint">${esc(t('crs.dlgSame'))}</p>` : ''}`
        : `<div class="warn">${esc(t('crs.dlgNone'))}</div>`}
      <label class="opt other"><input type="radio" name="crsc" value="other" ${candidates.length ? '' : 'checked'}>
        <span><b>${esc(t('crs.dlgOther'))}</b></span></label>
      <div class="otherbox">
        <select name="list"><option value="">—</option>${groups}</select>
        <input name="epsg" type="number" min="1000" max="999999" step="1" placeholder="${esc(t('crs.dlgEpsg'))}" aria-label="${esc(t('crs.dlgEpsg'))}">
      </div>
      <div class="warn err" data-bad hidden></div>
      <div class="btns">
        <button type="button" class="btn" value="cancel" data-cancel>${esc(t('crs.dlgCancel'))}</button>
        <button type="submit" class="btn primary" value="ok">${esc(t('crs.dlgImport'))}</button>
      </div>
    </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const other = form.querySelector('input[value=other]');
    const bad = form.querySelector('[data-bad]');
    // typing or picking in the "other" box selects that option
    form.list.onchange = () => { other.checked = true; if (form.list.value) form.epsg.value = ''; };
    form.epsg.oninput = () => { other.checked = true; if (form.epsg.value) form.list.value = ''; };
    let result = null;
    const finish = whenClosed(dlg, () => { dlg.remove(); resolve(result); });
    form.querySelector('[data-cancel]').onclick = () => { dlg.close(); finish(); };
    form.onsubmit = e => {
      e.preventDefault();
      const sel = form.querySelector('input[name=crsc]:checked');
      let wkid = null;
      if (sel && sel.value !== 'other') wkid = Number(sel.value);
      else wkid = Number(form.epsg.value || form.list.value) || null;
      if (!wkid || !validate(wkid)) {
        bad.textContent = t('crs.dlgBad', { wkid: wkid || '—', label: wkid ? crsLabel(wkid) : '' });
        bad.hidden = false;
        return;
      }
      result = wkid;
      dlg.close();
      finish();
    };
    dlg.showModal();
  });
}
