// DOM helpers: toast, modal dialog, popup menu.

import { applyIcons } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

let toastTimer = 0;
export function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

let onDialogClose = null;
export function openDialog(title, body, { onClose } = {}) {
  closeMenu();
  const bd = $('#dialog');
  $('#dialog-title').textContent = title;
  const b = $('#dialog-body');
  b.replaceChildren(body);
  applyIcons(bd);
  bd.hidden = false;
  onDialogClose = onClose || null;
  bd.querySelector('.dialog').setAttribute('aria-label', title);
  requestAnimationFrame(() => (bd.querySelector('[autofocus]') || bd.querySelector('[data-close]')).focus());
}

export function closeDialog() {
  const bd = $('#dialog');
  if (bd.hidden) return;
  bd.hidden = true;
  const cb = onDialogClose;
  onDialogClose = null;
  if (cb) cb();
}

export const dialogOpen = () => !$('#dialog').hidden;

export function initDialog() {
  const bd = $('#dialog');
  bd.addEventListener('click', e => {
    if (e.target === bd || e.target.closest('[data-close]')) closeDialog();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!bd.hidden) closeDialog();
      else closeMenu();
    }
  });
  document.addEventListener('pointerdown', e => {
    const m = $('#menu');
    if (!m.hidden && !m.contains(e.target) && !e.target.closest('[data-cmd="menu"]')) closeMenu();
  });
}

export function openMenu(anchor, items) {
  const m = $('#menu');
  m.replaceChildren(...items.map(it => {
    if (it === '-') return h('hr');
    if (it.toggle !== undefined) {
      const input = h('input', { type: 'checkbox' });
      input.checked = it.toggle;
      input.addEventListener('change', () => it.action(input.checked));
      return h('label', { class: 'switch', role: 'menuitemcheckbox' }, input, it.label);
    }
    return h('button', { class: 'btn', role: 'menuitem', 'data-icon': it.icon, onclick: () => { closeMenu(); it.action(); } }, h('span', {}, it.label));
  }));
  applyIcons(m);
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, hgt = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${Math.min(innerHeight - hgt - 8, r.bottom + 6)}px`;
}

export function closeMenu() {
  $('#menu').hidden = true;
}
