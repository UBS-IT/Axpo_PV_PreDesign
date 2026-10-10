// A confirmation in the app's own dialog (instead of the browser's confirm): title, text, one primary button.
// Resolves true when confirmed. The focus goes to the cancel button (the safe choice) and comes back afterwards.
import { t } from '../i18n.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// What to do once a <dialog> has closed, done exactly once. The handlers that close the dialog (OK, Cancel) call the
// returned function themselves; the dialog's close event and its toggle event cover the other ways out (Escape,
// a click outside). The close event alone is not enough: Chromium does not deliver it while the tab is hidden
// (seen in the browser pane of the desktop app, 2026-10-10), and a dialog waiting for it never resolved.
export function whenClosed(dlg, fn) {
  let done = false;
  const once = () => { if (done) return; done = true; fn(); };
  dlg.addEventListener('close', once);
  dlg.addEventListener('toggle', e => { if (e.newState === 'closed') once(); });
  return once;
}

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
    const finish = whenClosed(dlg, () => { dlg.remove(); try { opener?.focus?.(); } catch {} resolve(result); });
    dlg.querySelector('[data-cancel]').onclick = () => { dlg.close(); finish(); };
    dlg.querySelector('form').onsubmit = e => { e.preventDefault(); result = true; dlg.close(); finish(); };
    dlg.showModal();
    dlg.querySelector('[data-cancel]').focus();
  });
}
