// Boot: restore the last workbook (or the sample), build the UI, autosave.

import { Workbook } from './engine/workbook.js';
import { History } from './engine/history.js';
import { Controller } from './ui/controller.js';
import { installPanels } from './ui/panels.js';
import { createStorage } from './ui/storage.js';
import { SAMPLE } from './ui/sample.js';
import { toast } from './ui/widgets.js';

const $ = id => document.getElementById(id);

async function main() {
  const params = new URLSearchParams(location.search);
  const storage = createStorage();
  const saved = params.has('fresh') ? null : await storage.load();

  const wb = new Workbook();
  let title = '示例：家庭账本';
  let ui = null;
  try {
    if (saved?.data) {
      wb.load(saved.data);
      title = saved.title || '未命名表格';
      ui = saved.ui || null;
    } else if (params.has('blank')) {
      wb.load(Workbook.create().toJSON());
      title = '未命名表格';
    } else {
      wb.load(SAMPLE);
    }
  } catch (e) {
    console.warn('could not restore workbook', e);
    wb.load(SAMPLE);
    toast('上次的数据无法读取，已载入示例');
  }

  const history = new History(wb);
  const ctrl = new Controller({
    wb, history, title,
    els: {
      viewport: $('viewport'), canvas: $('sheet-canvas'), colhdr: $('colhdr'), rowhdr: $('rowhdr'), layer: $('cells-layer'),
      cellWrap: $('cell-editor'), cellInput: $('cell-input'), barWrap: $('bar-wrap'), barInput: $('bar-input'),
      suggest: $('suggest'), arghint: $('arghint'), area: $('grid-area'),
      toolbar: $('toolbar'), tabs: $('tabs'), status: $('status'), namebox: $('namebox'), keybar: $('keybar'), live: $('live')
    }
  });
  const titleInput = $('doc-title');
  titleInput.value = title;
  const panels = installPanels(ctrl, { fileInput: $('file-input'), titleInput });

  if (ui && wb.sheetById(ui.sheetId)) {
    ctrl.sheetId = ui.sheetId;
    if (ui.anchor) { ctrl.anchor = ui.anchor; ctrl.focus = ui.focus || ui.anchor; }
  }
  ctrl.render();
  if (ui) {
    $('viewport').scrollTop = ui.top || 0;
    $('viewport').scrollLeft = ui.left || 0;
  }
  ctrl.editor.focusSink();
  ctrl.onEditStateChange();

  // ----- autosave -----
  const stateEl = $('save-state');
  let timer = null;
  let lastVersion = wb.version;
  let lastTitle = ctrl.title;
  const save = async () => {
    timer = null;
    const ok = await storage.save({
      title: ctrl.title,
      data: wb.toJSON(),
      ui: { sheetId: ctrl.sheetId, anchor: ctrl.anchor, focus: ctrl.focus, top: $('viewport').scrollTop, left: $('viewport').scrollLeft },
      savedAt: Date.now()
    });
    stateEl.textContent = ok ? '已保存' : '保存失败';
    stateEl.classList.toggle('bad', !ok);
    if (!ok) toast('自动保存失败（存储空间不足？），请用“文件 → 导出”保存一份。', { ms: 6000 });
  };
  const schedule = () => {
    const dirty = wb.version !== lastVersion || ctrl.title !== lastTitle;
    if (dirty) {
      lastVersion = wb.version;
      lastTitle = ctrl.title;
      stateEl.textContent = '保存中…';
      stateEl.classList.remove('bad');
    }
    clearTimeout(timer);
    timer = setTimeout(save, dirty ? 400 : 1500);
  };
  ctrl.on('change', schedule);
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); save(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) { clearTimeout(timer); save(); } });

  // ----- iPhone keyboard: keep the symbol bar just above the on-screen keyboard -----
  const vv = window.visualViewport;
  if (vv) {
    const place = () => {
      const bar = $('keybar');
      const offset = window.innerHeight - (vv.height + vv.offsetTop);
      bar.style.bottom = `${Math.max(0, offset)}px`;
    };
    vv.addEventListener('resize', place);
    vv.addEventListener('scroll', place);
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // For automated tests and the curious.
  window.__app = { wb, history, ctrl, panels };
}

main();
