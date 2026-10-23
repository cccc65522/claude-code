// DOM helpers: toasts, in-page dialogs, file reading and downloading.

import { escapeHTML } from './util.js';
import { decodeBytes } from './importer.js';

export const esc = escapeHTML;

let toastTimer = null;
export function toast(message, kind = 'info', ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

function dialog(build) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${build.html}</div>`;
    document.body.appendChild(wrap);
    const close = value => { wrap.remove(); resolve(value); };
    wrap.addEventListener('click', e => {
      const act = e.target.closest('[data-dialog]')?.dataset.dialog;
      if (act === 'cancel' || e.target === wrap) close(build.cancelValue);
      if (act === 'ok') close(build.okValue(wrap));
    });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') close(build.cancelValue);
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') close(build.okValue(wrap));
    });
    const focus = wrap.querySelector('input') || wrap.querySelector('[data-dialog="ok"]');
    focus?.focus();
  });
}

export function confirmDialog({ title, message = '', confirmText = '确定', cancelText = '取消', danger = false }) {
  return dialog({
    html: `<h2>${esc(title)}</h2>${message ? `<p>${esc(message)}</p>` : ''}
      <div class="dialog-actions">
        <button type="button" class="btn" data-dialog="cancel">${esc(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-dialog="ok">${esc(confirmText)}</button>
      </div>`,
    cancelValue: false,
    okValue: () => true
  });
}

export function promptDialog({ title, value = '', placeholder = '', confirmText = '保存' }) {
  return dialog({
    html: `<h2>${esc(title)}</h2>
      <input class="input" id="dialog-input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
      <div class="dialog-actions">
        <button type="button" class="btn" data-dialog="cancel">取消</button>
        <button type="button" class="btn primary" data-dialog="ok">${esc(confirmText)}</button>
      </div>`,
    cancelValue: null,
    okValue: w => w.querySelector('input').value
  });
}

export async function readFileText(file) {
  return decodeBytes(await file.arrayBuffer());
}

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// iPhone: the share sheet offers "存储到文件", which is the most reliable way to keep a file.
export function canShareFiles() {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }));
  } catch { return false; }
}

export async function shareText(filename, text, mime = 'application/json') {
  const file = new File([text], filename, { type: mime });
  await navigator.share({ files: [file], title: filename });
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('复制失败');
}

export function fileStamp(ts = Date.now()) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export const ICONS = {
  home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>',
  wrong: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6m0-6-6 6"/>',
  chart: '<path d="M5 20V10m7 10V4m7 16v-7"/>',
  data: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>'
};

export function icon(name, cls = 'icon') {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}
