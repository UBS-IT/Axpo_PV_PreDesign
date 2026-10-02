// A confirmation in the app's own dialog (instead of the browser's confirm): title, text, one primary button.
// Resolves true when confirmed. The focus goes to the cancel button (the safe choice) and comes back afterwards.
import { t } from '../i18n.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function confirmDialog({ title, text = '', ok = t('dlg.ok'), cancel = t('dlg.cancel'), danger = false }) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg confirm';
    dlg.innerHTML = `<form method="dialog">
      <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      <div class="btns">
        <button type="button" class="btn" value="cancel" data-cancel>${esc(cancel)}</button>
        <button type="submit" class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(ok)}</button>
      </div></form>`;
    document.body.appendChild(dlg);
    let result = false;
    dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
    dlg.querySelector('form').onsubmit = () => { result = true; };
    dlg.addEventListener('close', () => { dlg.remove(); try { opener?.focus?.(); } catch {} resolve(result); });
    dlg.showModal();
    dlg.querySelector('[data-cancel]').focus();
  });
}
