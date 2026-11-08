// Menus, popovers, dialogs and toasts.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let openMenu = null;

export function closeMenus() {
  if (openMenu) {
    openMenu.close();
    openMenu = null;
  }
}

// items: [{ label, hint?, action, disabled?, checked?, danger? } | '-' | { heading }]
// at: { x, y } in client coordinates, or { anchor: element }.
export function showMenu(items, at, { className = '', onClose } = {}) {
  closeMenus();
  const el = document.createElement('div');
  el.className = `menu ${className}`;
  el.setAttribute('role', 'menu');
  el.innerHTML = items.map((it, i) => {
    if (it === '-') return '<div class="menu-sep" role="separator"></div>';
    if (it.heading) return `<div class="menu-heading">${esc(it.heading)}</div>`;
    if (it.html) return `<div class="menu-html">${it.html}</div>`;
    return `<button class="menu-item${it.danger ? ' danger' : ''}" role="menuitem" data-i="${i}"${it.disabled ? ' disabled' : ''}>`
      + `<span class="check">${it.checked ? '✓' : ''}</span><span class="label">${esc(it.label)}</span>`
      + `${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}</button>`;
  }).join('');
  document.body.appendChild(el);
  const prevFocus = document.activeElement;

  const vw = window.innerWidth, vh = window.innerHeight;
  let x, y;
  if (at.anchor) {
    const r = at.anchor.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
  } else {
    ({ x, y } = at);
  }
  const mw = el.offsetWidth, mh = el.offsetHeight;
  if (x + mw > vw - 8) x = Math.max(8, vw - mw - 8);
  if (y + mh > vh - 8) y = Math.max(8, (at.anchor ? at.anchor.getBoundingClientRect().top - mh - 4 : vh - mh - 8));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  const buttons = [...el.querySelectorAll('.menu-item:not([disabled])')];
  const onKey = e => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
  };
  const onDown = e => { if (!el.contains(e.target)) closeMenus(); };
  el.addEventListener('click', e => {
    const b = e.target.closest('.menu-item');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closeMenus();
    it.action?.();
  });
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('pointerdown', onDown, true));
  openMenu = {
    el,
    close() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      el.remove();
      // Give focus back (e.g. to the grid) so keyboard shortcuts keep working.
      if (prevFocus && prevFocus.isConnected && (document.activeElement === document.body || el.contains(document.activeElement))) {
        prevFocus.focus({ preventScroll: true });
      }
      onClose?.();
    }
  };
  if (!matchMedia('(pointer: coarse)').matches) buttons[0]?.focus({ preventScroll: true });
  return el;
}

export function colorPalette(colors, current, onPick) {
  const html = `<div class="palette">${colors.map(c => (c === null
    ? `<button class="sw none" data-c="" title="无" aria-label="无颜色"></button>`
    : `<button class="sw${c === current ? ' on' : ''}" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`)).join('')}</div>`;
  return { html, bind(el) {
    el.querySelector('.palette').addEventListener('click', e => {
      const b = e.target.closest('.sw');
      if (!b) return;
      closeMenus();
      onPick(b.dataset.c || null);
    });
  } };
}

// Modal dialog. Resolves with the clicked button's value (or null on Esc / backdrop).
export function dialog({ title, body = '', buttons = [{ label: '好', value: true, primary: true }], onOpen, wide = false }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>
      <div class="modal-body"></div>
      <div class="modal-actions">${buttons.map((b, i) => `<button class="btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
    </div>`;
    const bodyEl = back.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else bodyEl.appendChild(body);
    document.body.appendChild(back);
    const prev = document.activeElement;
    const finish = value => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      prev?.focus?.({ preventScroll: true });
      resolve(value);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.isComposing) {
        const primary = buttons.findIndex(b => b.primary);
        if (primary >= 0) { e.preventDefault(); e.stopPropagation(); click(primary); }
      }
    };
    const click = i => {
      const b = buttons[i];
      if (b.validate) {
        const err = b.validate(bodyEl);
        if (err) { showError(bodyEl, err); return; }
      }
      finish(typeof b.value === 'function' ? b.value(bodyEl) : b.value);
    };
    back.addEventListener('pointerdown', e => { if (e.target === back) finish(null); });
    back.querySelector('.modal-actions').addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) click(Number(b.dataset.i));
    });
    document.addEventListener('keydown', onKey, true);
    onOpen?.(bodyEl, finish);
    const focusable = bodyEl.querySelector('input, select, textarea') || back.querySelector('.btn.primary');
    focusable?.focus();
    if (focusable?.select) focusable.select();
  });
}

function showError(bodyEl, msg) {
  let e = bodyEl.querySelector('.form-error');
  if (!e) {
    e = document.createElement('p');
    e.className = 'form-error';
    bodyEl.appendChild(e);
  }
  e.textContent = msg;
}

export async function promptText(title, value = '', { label = '', validate, placeholder = '' } = {}) {
  const result = await dialog({
    title,
    body: `<label class="field">${esc(label)}<input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false"></label>`,
    buttons: [
      { label: '取消', value: null },
      {
        label: '确定', primary: true,
        validate: validate ? body => validate(body.querySelector('input').value) : undefined,
        value: body => body.querySelector('input').value
      }
    ]
  });
  return result;
}

export function confirmDialog(title, message, { okLabel = '确定', danger = false } = {}) {
  return dialog({
    title,
    body: `<p>${esc(message)}</p>`,
    buttons: [{ label: '取消', value: false }, { label: okLabel, value: true, primary: true, danger }]
  });
}

let toastTimer = null;
export function toast(message, { ms = 2600, action } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export { esc };
