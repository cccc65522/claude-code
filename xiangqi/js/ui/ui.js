// Dialogs, menus and toasts.

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Modal dialog. `body` is HTML or an element; resolves with a button's value (null on dismiss).
export function dialog({ title, body = '', buttons = [{ label: '好', value: true, primary: true }], onOpen, className = '' }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2><div class="modal-body"></div>
      <div class="modal-actions">${buttons.map((b, i) => `<button class="btn${b.primary ? ' primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const bodyEl = back.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else bodyEl.appendChild(body);
    document.body.appendChild(back);
    const prev = document.activeElement;
    const finish = v => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      prev?.focus?.({ preventScroll: true });
      resolve(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
    };
    back.addEventListener('pointerdown', e => { if (e.target === back) finish(null); });
    back.querySelector('.modal-actions').addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const spec = buttons[Number(b.dataset.i)];
      finish(typeof spec.value === 'function' ? spec.value(bodyEl) : spec.value);
    });
    document.addEventListener('keydown', onKey, true);
    onOpen?.(bodyEl, finish);
    if (!matchMedia('(pointer: coarse)').matches) (back.querySelector('.btn.primary') || back.querySelector('.btn'))?.focus();
  });
}

let menuEl = null;
export function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

export function menu(items, anchor) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = items.map((it, i) => (it === '-' ? '<div class="menu-sep"></div>'
    : `<button class="menu-item" role="menuitem" data-i="${i}">${esc(it.label)}${it.checked !== undefined ? `<span class="check">${it.checked ? '开' : '关'}</span>` : ''}</button>`)).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.top = `${r.bottom + 6}px`;
  el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  menuEl = el;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closeMenu();
    items[Number(b.dataset.i)].action();
  });
  setTimeout(() => document.addEventListener('pointerdown', function off(e) {
    if (!el.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); }
  }, true));
}

let toastTimer = 0;
export function toast(text, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
