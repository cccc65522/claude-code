// File menu, function picker, find & replace, help.

import { FUNCTIONS, FUNCTION_NAMES } from '../engine/functions.js';
import { Workbook } from '../engine/workbook.js';
import { formatAddress } from '../engine/address.js';
import { parseCSV, toCSV, decodeText } from '../io/csv.js';
import { exportXlsx, importXlsx } from '../io/xlsx.js';
import { showMenu, dialog, confirmDialog, toast, esc } from './widgets.js';
import { SAMPLE } from './sample.js';

const safeName = s => (s || '表格').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

export function download(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// On iPhone the share sheet ("存储到文件") is the friendliest way to save a file.
async function saveFile(bytes, name, type) {
  const file = new File([bytes], name, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  download(file, name, type);
}

export function installPanels(ctrl, { fileInput, titleInput }) {
  const wb = ctrl.wb;

  async function exportXLSX() {
    try {
      const bytes = await exportXlsx(wb, { activeSheetId: ctrl.sheetId });
      await saveFile(bytes, `${safeName(ctrl.title)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) {
      toast(`导出失败：${e.message}`);
    }
  }

  async function exportCSV() {
    const sheet = ctrl.sheet;
    const b = sheet.bounds();
    const rows = [];
    for (let r = 0; r <= b.maxRow; r++) {
      const row = [];
      for (let c = 0; c <= b.maxCol; c++) row.push(wb.getDisplay(sheet.id, r, c)?.text ?? '');
      rows.push(row);
    }
    // BOM so Excel opens UTF-8 Chinese text correctly.
    await saveFile('﻿' + toCSV(rows), `${safeName(ctrl.title)}-${safeName(sheet.name)}.csv`, 'text/csv;charset=utf-8');
  }

  async function exportJSON() {
    const data = { ...wb.toJSON(), title: ctrl.title };
    await saveFile(JSON.stringify(data), `${safeName(ctrl.title)}.gesuan.json`, 'application/json');
  }

  function replaceWorkbook(data, title, label) {
    ctrl.exec(label, () => wb.load(data), { snapshot: true });
    ctrl.clip = null;
    ctrl.sheetId = wb.sheets[0].id;
    ctrl.views = new Map();
    ctrl.select(0, 0);
    if (title) setTitle(title);
  }

  function setTitle(t) {
    ctrl.title = t;
    titleInput.value = t;
    ctrl.emit('change');
  }

  function isEmpty() {
    return wb.sheets.every(s => s.cells.size === 0);
  }

  async function openFile(file, { asSheet = false } = {}) {
    const name = file.name.replace(/\.[^.]+$/, '');
    const lower = file.name.toLowerCase();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
        const data = await importXlsx(bytes);
        if (!isEmpty() && !await confirmDialog('打开文件', `用“${file.name}”替换当前表格？（可以撤销）`, { okLabel: '打开' })) return;
        replaceWorkbook(data, name, '打开文件');
        toast(`已打开 ${file.name}：${data.sheets.length} 个工作表`);
      } else if (lower.endsWith('.json')) {
        const data = JSON.parse(decodeText(bytes));
        if (!isEmpty() && !await confirmDialog('打开文件', `用“${file.name}”替换当前表格？（可以撤销）`, { okLabel: '打开' })) return;
        replaceWorkbook(data, data.title || name.replace(/\.gesuan$/, ''), '打开文件');
        toast(`已打开 ${file.name}`);
      } else {
        const rows = parseCSV(decodeText(bytes));
        const cells = [];
        rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '') cells.push([r, c, v]); }));
        if (asSheet || !isEmpty()) {
          const data = wb.toJSON();
          let sheetName = name.slice(0, 31).replace(/[\\/?*[\]:]/g, '_') || 'CSV';
          for (let k = 2; data.sheets.some(s => s.name.toLowerCase() === sheetName.toLowerCase()); k++) sheetName = `${name.slice(0, 27)} ${k}`;
          data.sheets.push({ name: sheetName, cells });
          ctrl.exec('导入 CSV', () => wb.load(data), { snapshot: true });
          ctrl.showSheet(wb.sheets[wb.sheets.length - 1].id);
          ctrl.select(0, 0);
        } else {
          replaceWorkbook({ sheets: [{ name: name.slice(0, 31) || 'Sheet1', cells }] }, name, '导入 CSV');
        }
        toast(`已导入 ${rows.length} 行`);
      }
    } catch (e) {
      toast(`无法打开 ${file.name}：${e.message}`, { ms: 5000 });
    }
  }

  let openAsSheet = false;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) openFile(f, { asSheet: openAsSheet });
  });

  // Drag a file onto the page to open it.
  document.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    openFile(f);
  });

  function fileMenu(anchor) {
    showMenu([
      { label: '新建空白表格', action: async () => {
        if (!isEmpty() && !await confirmDialog('新建表格', '清空当前表格，开始一个新的？（可以撤销）', { okLabel: '新建' })) return;
        replaceWorkbook(Workbook.create().toJSON(), '未命名表格', '新建表格');
      } },
      { label: '打开文件…', hint: 'xlsx / csv / json', action: () => { openAsSheet = false; fileInput.click(); } },
      { label: '导入 CSV 为新工作表…', action: () => { openAsSheet = true; fileInput.click(); } },
      '-',
      { label: '导出为 Excel (.xlsx)', action: exportXLSX },
      { label: '导出当前工作表为 CSV', action: exportCSV },
      { label: '保存为格算文件 (.json)', action: exportJSON },
      '-',
      { label: '载入示例表格', action: async () => {
        if (!isEmpty() && !await confirmDialog('载入示例', '用示例表格替换当前内容？（可以撤销）', { okLabel: '载入' })) return;
        replaceWorkbook(SAMPLE, '示例：家庭账本', '载入示例');
      } }
    ], { anchor });
  }

  // ----- function picker -----

  const CATS = ['全部', '数学', '统计', '逻辑', '文本', '查找', '日期', '信息'];
  async function functionPicker() {
    const wasEditing = ctrl.editor.editing;
    const body = document.createElement('div');
    body.className = 'fn-picker';
    body.innerHTML = `<input type="search" placeholder="搜索函数，如 sum、查找、日期" aria-label="搜索函数" spellcheck="false">
      <div class="fn-cats" role="tablist">${CATS.map((c, i) => `<button class="chip${i === 0 ? ' on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
      <div class="fn-list" role="listbox"></div>`;
    let cat = '全部';
    const list = body.querySelector('.fn-list');
    const search = body.querySelector('input');
    const names = FUNCTION_NAMES.filter(n => !/\.(S|P|SNGL|EQ|INC)$/.test(n));
    const paint = () => {
      const q = search.value.trim().toUpperCase();
      const items = names.map(n => FUNCTIONS[n]).filter(f => (cat === '全部' || f.category === cat)
        && (!q || f.name.includes(q) || f.desc.toUpperCase().includes(q) || f.syntax.toUpperCase().includes(q)));
      list.innerHTML = items.length
        ? items.map(f => `<button class="fn-item" data-fn="${f.name}" role="option"><code>${esc(f.syntax)}</code><span>${esc(f.desc)}</span></button>`).join('')
        : '<p class="empty">没有找到</p>';
    };
    paint();
    search.addEventListener('input', paint);
    body.querySelector('.fn-cats').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      cat = b.dataset.cat;
      body.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
      paint();
    });
    const picked = await dialog({
      title: '插入函数',
      body,
      wide: true,
      buttons: [{ label: '关闭', value: null }],
      onOpen: (el, finish) => {
        list.addEventListener('click', e => {
          const b = e.target.closest('[data-fn]');
          if (b) finish(b.dataset.fn);
        });
      }
    });
    if (picked) {
      if (!wasEditing && ctrl.editor.editing) ctrl.editor.cancel();
      ctrl.editor.insertFunction(picked);
    }
  }

  // ----- find & replace (non-modal bar) -----

  let findBar = null;
  function openFind(withReplace = false) {
    if (ctrl.editor.editing) ctrl.editor.commit();
    if (findBar) {
      findBar.classList.toggle('with-replace', withReplace || findBar.classList.contains('with-replace'));
      findBar.querySelector('.f-find').focus();
      findBar.querySelector('.f-find').select();
      return;
    }
    findBar = document.createElement('div');
    findBar.className = `findbar${withReplace ? ' with-replace' : ''}`;
    findBar.setAttribute('role', 'search');
    findBar.innerHTML = `
      <div class="row"><input class="f-find" placeholder="查找" aria-label="查找内容" spellcheck="false">
        <button class="tb" data-f="prev" aria-label="上一个">↑</button><button class="tb" data-f="next" aria-label="下一个">↓</button>
        <button class="tb" data-f="toggle" title="替换">替换</button><button class="tb" data-f="close" aria-label="关闭">✕</button></div>
      <div class="row rep"><input class="f-rep" placeholder="替换为" aria-label="替换为" spellcheck="false">
        <button class="tb" data-f="one">替换</button><button class="tb" data-f="all">全部替换</button></div>
      <div class="row opts"><label><input type="checkbox" class="f-case"> 区分大小写</label><label><input type="checkbox" class="f-whole"> 整个单元格</label><label><input type="checkbox" class="f-formula"> 搜索公式</label><span class="f-count"></span></div>`;
    document.getElementById('grid-area').appendChild(findBar);
    const q = () => findBar.querySelector('.f-find').value;
    const opts = () => ({
      matchCase: findBar.querySelector('.f-case').checked,
      whole: findBar.querySelector('.f-whole').checked,
      formulas: findBar.querySelector('.f-formula').checked
    });
    const count = findBar.querySelector('.f-count');
    const update = () => {
      const hits = findAll(q(), opts());
      count.textContent = q() ? `${hits.length} 处` : '';
      return hits;
    };
    findBar.addEventListener('input', update);
    findBar.addEventListener('change', update);
    findBar.addEventListener('click', e => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      const f = b.dataset.f;
      if (f === 'close') closeFind();
      else if (f === 'toggle') findBar.classList.toggle('with-replace');
      else if (f === 'next' || f === 'prev') step(f === 'next' ? 1 : -1);
      else if (f === 'one') replaceOne();
      else if (f === 'all') replaceAll();
    });
    findBar.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (e.target.classList.contains('f-rep')) replaceOne();
        else step(e.shiftKey ? -1 : 1);
      }
    });
    findBar.querySelector('.f-find').focus();

    function matcher(text, o) {
      const needle = o.matchCase ? text : text.toLowerCase();
      return s => {
        const hay = o.matchCase ? s : s.toLowerCase();
        return o.whole ? hay === needle : hay.includes(needle);
      };
    }
    function cellText(sheet, r, c, o) {
      const cell = sheet.get(r, c);
      if (!cell || cell.input === '') return null;
      return o.formulas ? cell.input : wb.getDisplay(sheet.id, r, c).text;
    }
    // Every match across all sheets, in sheet order then row-major order.
    function findAll(text, o) {
      if (!text) return [];
      const test = matcher(text, o);
      const hits = [];
      for (const sheet of wb.sheets) {
        const keys = [...sheet.cells.keys()].sort((a, b) => a - b);
        for (const k of keys) {
          const r = Math.floor(k / 16384), c = k % 16384;
          const t = cellText(sheet, r, c, o);
          if (t !== null && test(t)) hits.push({ sheetId: sheet.id, r, c });
        }
      }
      return hits;
    }
    function step(dir) {
      const hits = update();
      if (!hits.length) { toast(`找不到“${q()}”`); return; }
      const order = wb.sheets.map(s => s.id);
      const pos = h => order.indexOf(h.sheetId) * 1e12 + h.r * 16384 + h.c;
      const a = ctrl.active();
      const cur = order.indexOf(ctrl.sheetId) * 1e12 + a.r * 16384 + a.c;
      let next = dir > 0 ? hits.find(h => pos(h) > cur) : [...hits].reverse().find(h => pos(h) < cur);
      if (!next) next = dir > 0 ? hits[0] : hits[hits.length - 1];
      ctrl.showSheet(next.sheetId);
      ctrl.select(next.r, next.c);
      count.textContent = `第 ${hits.indexOf(next) + 1} / ${hits.length} 处`;
      findBar.querySelector('.f-find').focus({ preventScroll: true });
    }
    function replaceIn(input, o) {
      const text = q();
      const rep = findBar.querySelector('.f-rep').value;
      if (o.whole) return rep;
      const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.matchCase ? 'g' : 'gi');
      return input.replace(re, () => rep);
    }
    function replaceOne() {
      const o = { ...opts(), formulas: true };
      const a = ctrl.active();
      const sheet = ctrl.sheet;
      const t = cellText(sheet, a.r, a.c, o);
      if (t !== null && matcher(q(), o)(t)) {
        ctrl.exec('替换', () => wb.setCells([{ sheetId: sheet.id, r: a.r, c: a.c, input: replaceIn(t, o) }]));
      }
      step(1);
    }
    function replaceAll() {
      const o = { ...opts(), formulas: true };
      const hits = findAll(q(), o);
      if (!hits.length) { toast(`找不到“${q()}”`); return; }
      ctrl.exec(`全部替换（${hits.length} 处）`, () => wb.setCells(hits.map(h => ({
        sheetId: h.sheetId, r: h.r, c: h.c, input: replaceIn(wb.getInput(h.sheetId, h.r, h.c), o)
      }))));
      toast(`已替换 ${hits.length} 处`);
      update();
    }
  }
  function closeFind() {
    findBar?.remove();
    findBar = null;
    ctrl.editor.focusSink();
  }

  // ----- help -----

  function help() {
    const keys = [
      ['方向键 / Ctrl+方向键', '移动 / 跳到数据边缘'], ['Shift+方向键', '扩展选区'],
      ['Enter / Tab', '确认并下移 / 右移'], ['F2 或双击', '编辑单元格'], ['Esc', '取消编辑'],
      ['F4', '编辑公式时切换 $ 绝对引用'], ['Alt+Enter', '单元格内换行'], ['Ctrl+Enter', '把输入填进整个选区'],
      ['Ctrl+Z / Ctrl+Y', '撤销 / 重做'], ['Ctrl+C / X / V', '复制 / 剪切 / 粘贴'],
      ['Ctrl+D / Ctrl+R', '向下 / 向右填充'], ['Alt+=', '自动求和'], ['Ctrl+;', '插入今天日期'],
      ['Ctrl+B / I / U', '加粗 / 倾斜 / 下划线'], ['Ctrl+F / Ctrl+H', '查找 / 替换'], ['Delete', '清除内容']
    ];
    dialog({
      title: '格算 · 帮助',
      wide: true,
      body: `<div class="help">
        <p>纯前端电子表格：数据只保存在这台设备的浏览器里，不会上传。公式引擎是自己写的，支持 ${Object.keys(FUNCTIONS).length} 个函数，语法与 Excel 一致。</p>
        <h3>用法</h3>
        <ul>
          <li>输入以 <code>=</code> 开头就是公式。编辑公式时<strong>点击或拖选单元格</strong>即可插入引用，引用会用颜色标出来。</li>
          <li>拖动选区右下角的小方块可以<strong>填充</strong>：数字序列、日期、“周一”“一月”“第1组”会自动递增。</li>
          <li>插入、删除行列，剪切粘贴时，所有引用到它们的公式会自动改写；被删掉的引用变成 <code>#REF!</code>。</li>
          <li>公式直接或间接引用自己时显示 <code>#CIRC!</code>（循环引用）。</li>
          <li>“文件”菜单可以打开、导出 Excel（.xlsx）和 CSV。</li>
          <li>iPhone 上：点一下选中，再点一下编辑；长按弹出菜单；拖动右下角圆点扩展选区。</li>
        </ul>
        <h3>快捷键（Mac 用 ⌘ 代替 Ctrl）</h3>
        <table class="keys">${keys.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table>
      </div>`,
      buttons: [{ label: '知道了', value: true, primary: true }]
    });
  }

  titleInput.addEventListener('change', () => setTitle(titleInput.value.trim() || '未命名表格'));
  titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); } });

  ctrl.openFind = openFind;
  ctrl.extraCommands = {
    'menu-file': el => fileMenu(el),
    'menu-help': () => help(),
    functions: () => functionPicker(),
    find: () => openFind()
  };
  return { openFile, exportXLSX, exportCSV, exportJSON, setTitle };
}

