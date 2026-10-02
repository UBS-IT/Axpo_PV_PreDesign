// Non-blocking messages, bottom right. kind: '' | 'ok' | 'err'. opts.action = { label, fn }: a button in the
// message (undo, open…); the message then stays until its button, its × or the next one with an action.
let box = null;
export function toast(text, kind = '', ms = 6000, opts = {}) {
  box = box || document.getElementById('toast');
  if (!box) return null;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  if (kind === 'err') el.setAttribute('role', 'alert');
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  let timer = 0;
  const remove = () => { clearTimeout(timer); el.remove(); };
  if (opts.action) {
    box.querySelectorAll('.toast.action').forEach(x => x.remove());
    el.classList.add('action');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tact'; b.textContent = opts.action.label;
    b.onclick = () => { remove(); try { opts.action.fn(); } catch (e) { console.error(e); } };
    el.appendChild(b);
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'tx'; x.textContent = '×'; x.setAttribute('aria-label', 'Close');
    x.onclick = remove;
    el.appendChild(x);
    ms = Math.max(ms, 12000);
  }
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  timer = setTimeout(remove, ms);
  return el;
}
