import { parseImport, TYPE_LABEL, TYPES } from '../importer.js';
import { bankStats, questionStats } from '../stats.js';
import { answerText } from '../quiz.js';
import { toCSV } from '../csv.js';
import { SAMPLE_BANK, CSV_TEMPLATE_ROWS, TEXT_TEMPLATE } from '../sample.js';
import { esc, icon, toast, readFileText, downloadText, confirmDialog, promptDialog, fileStamp } from '../ui.js';
import { percent } from '../util.js';

const FORMAT_LABEL = { json: 'JSON', csv: 'CSV 表格', text: '文字题目' };
let pending = null; // import waiting for confirmation: { result, filename }

function importCard() {
  return `
    <section class="card" id="import">
      <h2>导入题库</h2>
      <div class="stack">
        <label class="btn primary block file-btn">选择文件导入
          <input class="visually-hidden" type="file" data-testid="import-file" accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain">
        </label>
        <details class="fold">
          <summary class="btn block">粘贴文字导入</summary>
          <textarea class="input" rows="8" id="paste-text" placeholder="例如：&#10;1. 中国的首都是？&#10;A. 上海  B. 北京&#10;答案：B&#10;解析：……"></textarea>
          <button class="btn primary block" type="button" data-action="parse-paste">识别题目</button>
        </details>
        <button class="btn block" type="button" data-action="sample">载入示例题库</button>
      </div>
      <details class="help">
        <summary>支持的格式和模板</summary>
        <dl>
          <dt>Excel / CSV</dt>
          <dd>第一行是表头：题型、题目、选项A…选项H（或一列“选项”，用 | 隔开）、答案、解析、标签。Excel 里“另存为 CSV”即可，UTF-8 和 GBK 编码都能识别。</dd>
          <dt>文字（从 Word、网页复制）</dt>
          <dd>每题用“1.”或“1、”编号，选项写成“A. …”（可以写在同一行），答案行写“答案：B”，解析行写“解析：…”。“一、单选题”这样的分节标题会作为下面题目的题型。</dd>
          <dt>JSON</dt>
          <dd><code>{"name":"题库名","questions":[{"type":"单选","question":"…","options":["…","…"],"answer":"B","explanation":"…"}]}</code></dd>
          <dt>答案怎么写</dt>
          <dd>选择题写字母（多选写 AC 或 A,C）；判断题写 对/错；填空题有多个可接受答案时用 | 隔开；简答题写参考答案，练习时自己判断对错。没写题型时会按选项和答案自动判断。</dd>
        </dl>
        <div class="row wrap">
          <button class="btn small" type="button" data-template="csv">下载 CSV 模板</button>
          <button class="btn small" type="button" data-template="text">下载文字模板</button>
          <button class="btn small" type="button" data-template="json">下载 JSON 示例</button>
        </div>
      </details>
    </section>`;
}

function previewCard({ result, filename }, banks) {
  const byType = TYPES.map(t => [t, result.questions.filter(q => q.type === t).length]).filter(([, n]) => n);
  const n = result.questions.length;
  return `
    <section class="card" data-testid="import-preview">
      <h2>导入预览</h2>
      <p class="muted">${filename ? `「${esc(filename)}」· ` : ''}识别为${FORMAT_LABEL[result.format]}</p>
      <p class="big ${n ? 'ok' : 'bad'}" data-testid="preview-count">可以导入 ${n} 题</p>
      ${byType.length ? `<div class="chips">${byType.map(([t, c]) => `<span class="chip">${TYPE_LABEL[t]} ${c}</span>`).join('')}</div>` : ''}
      ${result.duplicates ? `<p class="muted">文件里有 ${result.duplicates} 道重复的题，已合并。</p>` : ''}
      ${result.errors.length ? `
        <div class="errors" data-testid="preview-errors">
          <p><b>${result.errors.length} 处无法导入：</b></p>
          <ul>${result.errors.slice(0, 30).map(e => `<li>${esc(e.where)}：${esc(e.message)}</li>`).join('')}</ul>
          ${result.errors.length > 30 ? `<p class="muted">还有 ${result.errors.length - 30} 处未列出。</p>` : ''}
        </div>` : ''}
      ${n ? `
        <label class="field"><span>导入到</span>
          <select class="input" id="import-target">
            <option value="">新建题库</option>
            ${banks.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field" id="new-name-field"><span>新题库名称</span>
          <input class="input" id="import-name" type="text" value="${esc(result.bankName || '新题库')}" autocomplete="off">
        </label>
        <div class="row">
          <button class="btn" type="button" data-action="cancel-import">取消</button>
          <button class="btn primary grow" type="button" data-action="confirm-import">确认导入 ${n} 题</button>
        </div>` : `
        <button class="btn block" type="button" data-action="cancel-import">重新选择</button>`}
    </section>`;
}

export function renderBanks(root, app) {
  const { store } = app;
  const st = store.state;
  const stats = bankStats(st.banks, [...st.questions.values()], st.attempts);

  root.innerHTML = `
    <div class="page">
      <header class="page-head"><h1>题库</h1></header>
      ${pending ? previewCard(pending, st.banks) : importCard()}
      <section class="card">
        <h2>已有题库（${st.banks.length}）</h2>
        ${st.banks.length ? `<ul class="list" data-testid="bank-list">
          ${stats.map(s => `
            <li><a class="list-item" href="#/bank/${s.bankId}">
              <span class="grow"><span class="item-title">${esc(s.name)}</span>
              <span class="item-sub">${s.total} 题 · 做过 ${s.seen} 题 · 正确率 ${percent(s.accuracy)}</span></span>
              ${icon('chevron', 'icon sm muted')}
            </a></li>`).join('')}
        </ul>` : '<p class="muted">还没有题库。</p>'}
      </section>
    </div>`;

  const showPreview = (text, filename) => {
    pending = { result: parseImport(text, filename), filename };
    app.refresh().then(() => document.querySelector('[data-testid="import-preview"]')?.scrollIntoView({ block: 'start' }));
  };

  root.querySelector('[data-testid="import-file"]')?.addEventListener('change', e => app.run(async () => {
    const file = e.target.files[0];
    if (!file) return;
    showPreview(await readFileText(file), file.name);
  }));
  root.querySelector('[data-action="parse-paste"]')?.addEventListener('click', () => {
    const text = root.querySelector('#paste-text').value;
    if (!text.trim()) { toast('先粘贴题目文字', 'error'); return; }
    showPreview(text, '');
  });
  root.querySelector('[data-action="sample"]')?.addEventListener('click', () => app.run(async () => {
    const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
    const r = await store.importQuestions({ bankName: parsed.bankName, questions: parsed.questions });
    toast(`已载入示例题库（${r.added} 题）`, 'ok');
    app.refresh();
  }));
  for (const btn of root.querySelectorAll('[data-template]')) {
    btn.addEventListener('click', () => {
      const t = btn.dataset.template;
      if (t === 'csv') downloadText('question-bank-template.csv', '\uFEFF' + toCSV(CSV_TEMPLATE_ROWS), 'text/csv');
      if (t === 'text') downloadText('question-bank-template.txt', TEXT_TEMPLATE, 'text/plain');
      if (t === 'json') downloadText('sample-bank.json', JSON.stringify(SAMPLE_BANK, null, 2));
    });
  }

  const target = root.querySelector('#import-target');
  target?.addEventListener('change', () => { root.querySelector('#new-name-field').hidden = !!target.value; });
  root.querySelector('[data-action="cancel-import"]')?.addEventListener('click', () => { pending = null; app.refresh(); });
  root.querySelector('[data-action="confirm-import"]')?.addEventListener('click', () => app.run(async () => {
    const bankId = target.value || null;
    const bankName = root.querySelector('#import-name').value;
    const r = await store.importQuestions({ bankId, bankName, questions: pending.result.questions });
    pending = null;
    toast(`已导入 ${r.added} 题${r.skipped ? `，跳过题库里已有的 ${r.skipped} 题` : ''}`, 'ok', 3500);
    navigator.storage?.persist?.().catch(() => {});
    app.go(`#/bank/${r.bank.id}`);
  }));
}

// ---------------------------------------------------------------- bank detail

const listState = new Map(); // bankId -> { query, type, limit }

function exportBankJSON(bank, questions) {
  return JSON.stringify({
    name: bank.name,
    questions: questions.map(q => ({
      type: TYPE_LABEL[q.type],
      question: q.stem,
      ...(q.type === 'single' || q.type === 'multiple' ? { options: q.options.map(o => o.text) } : {}),
      answer: q.type === 'judge' ? (q.answer[0] === 'T' ? '对' : '错') : q.type === 'fill' ? q.answer.join('|') : q.type === 'short' ? q.answer[0] : q.answer.join(''),
      explanation: q.explanation,
      tags: q.tags
    }))
  }, null, 2);
}

export function renderBankDetail(root, app, { args: [id] }) {
  const { store } = app;
  const st = store.state;
  const bank = store.bank(id);
  if (!bank) {
    root.innerHTML = `<div class="page"><div class="card"><h2>找不到这个题库</h2><a class="btn primary" href="#/banks">返回题库</a></div></div>`;
    return;
  }
  const qs = store.questionsOf(id);
  const [s] = bankStats([bank], qs, st.attempts);
  const qstats = questionStats(st.attempts);
  const wrongHere = qs.filter(q => st.wrong.has(q.id)).length;
  const ls = listState.get(id) || { query: '', type: '', limit: 50 };
  listState.set(id, ls);
  const types = TYPES.filter(t => qs.some(q => q.type === t));

  root.innerHTML = `
    <div class="page">
      <header class="page-head with-back">
        <a class="back" href="#/banks" aria-label="返回题库">${icon('back')}</a>
        <h1 data-testid="bank-title">${esc(bank.name)}</h1>
      </header>
      <section class="tiles">
        <div class="tile"><span class="tile-num" data-testid="bank-count">${s.total}</span><span class="tile-label">题目</span></div>
        <div class="tile"><span class="tile-num">${s.seen}</span><span class="tile-label">做过</span></div>
        <div class="tile"><span class="tile-num">${percent(s.accuracy)}</span><span class="tile-label">正确率</span></div>
      </section>
      <section class="card">
        <div class="stack">
          <a class="btn primary block" href="#/practice?bank=${id}">练习这个题库</a>
          ${wrongHere ? `<button class="btn block" type="button" data-action="wrong">重练本题库错题（${wrongHere}）</button>` : ''}
        </div>
        <div class="row wrap top-gap">
          <button class="btn small" type="button" data-action="rename">重命名</button>
          <button class="btn small" type="button" data-action="export">导出题库</button>
          <a class="btn small" href="#/banks">继续导入</a>
          <button class="btn small danger-text" type="button" data-action="delete">删除题库</button>
        </div>
      </section>
      <section class="card">
        <h2>题目</h2>
        <input class="input" type="search" id="q-search" placeholder="搜索题目、选项、标签" value="${esc(ls.query)}" autocomplete="off">
        <div class="chips selectable top-gap" role="group" aria-label="按题型筛选">
          <button type="button" class="chip ${ls.type ? '' : 'on'}" data-type="">全部</button>
          ${types.map(t => `<button type="button" class="chip ${ls.type === t ? 'on' : ''}" data-type="${t}">${TYPE_LABEL[t]}</button>`).join('')}
        </div>
        <div id="q-list"></div>
      </section>
    </div>`;

  const listEl = root.querySelector('#q-list');
  const drawList = () => {
    const q = ls.query.trim().toLowerCase();
    const filtered = qs.filter(x => (!ls.type || x.type === ls.type) &&
      (!q || [x.stem, ...x.options.map(o => o.text), ...x.tags].some(t => t.toLowerCase().includes(q))));
    listEl.innerHTML = `
      <p class="muted small">${filtered.length} 题</p>
      <ol class="q-list">
        ${filtered.slice(0, ls.limit).map(x => {
          const qs1 = qstats.get(x.id);
          return `<li><details>
            <summary><span class="badge">${TYPE_LABEL[x.type]}</span><span class="q-stem">${esc(x.stem)}</span></summary>
            <div class="q-body">
              ${x.options.length && x.type !== 'judge' ? `<ul class="opt-list">${x.options.map(o => `<li class="${x.answer.includes(o.key) ? 'right' : ''}"><b>${o.key}.</b> ${esc(o.text)}</li>`).join('')}</ul>` : ''}
              <p><b>答案：</b><span class="pre">${esc(answerText(x))}</span></p>
              ${x.explanation ? `<p class="pre"><b>解析：</b>${esc(x.explanation)}</p>` : ''}
              ${x.tags.length ? `<p class="muted small">标签：${x.tags.map(esc).join('、')}</p>` : ''}
              <p class="muted small">${qs1 ? `答过 ${qs1.count} 次，答对 ${qs1.correct} 次` : '还没做过'}${st.wrong.has(x.id) ? ' · 在错题本中' : ''}</p>
              <button class="btn small danger-text" type="button" data-del="${x.id}">删除这道题</button>
            </div>
          </details></li>`;
        }).join('')}
      </ol>
      ${filtered.length > ls.limit ? `<button class="btn block" type="button" data-action="more">再显示 50 题</button>` : ''}`;
  };
  drawList();

  root.querySelector('#q-search').addEventListener('input', e => { ls.query = e.target.value; ls.limit = 50; drawList(); });
  for (const chip of root.querySelectorAll('[data-type]')) {
    chip.addEventListener('click', () => {
      ls.type = chip.dataset.type; ls.limit = 50;
      for (const c of root.querySelectorAll('[data-type]')) c.classList.toggle('on', c === chip);
      drawList();
    });
  }
  listEl.addEventListener('click', e => {
    if (e.target.closest('[data-action="more"]')) { ls.limit += 50; drawList(); return; }
    const del = e.target.closest('[data-del]');
    if (del) app.run(async () => {
      if (!await confirmDialog({ title: '删除这道题？', message: '它的错题记录也会删除，答题历史保留。', confirmText: '删除', danger: true })) return;
      await store.deleteQuestion(del.dataset.del);
      toast('已删除', 'ok');
      app.refresh();
    });
  });

  root.querySelector('[data-action="wrong"]')?.addEventListener('click', () => app.startPractice({ source: 'wrong', bankId: id, order: 'random', count: 0 }));
  root.querySelector('[data-action="rename"]').addEventListener('click', () => app.run(async () => {
    const name = await promptDialog({ title: '重命名题库', value: bank.name });
    if (name == null || !name.trim()) return;
    await store.renameBank(id, name);
    app.refresh();
  }));
  root.querySelector('[data-action="export"]').addEventListener('click', () => {
    // the bank name travels inside the file; the file name stays ASCII so every browser keeps it
    downloadText(`question-bank-${fileStamp()}.json`, exportBankJSON(bank, qs));
  });
  root.querySelector('[data-action="delete"]').addEventListener('click', () => app.run(async () => {
    const ok = await confirmDialog({
      title: `删除「${bank.name}」？`,
      message: `题库里的 ${qs.length} 道题和它们的错题记录会一起删除，答题历史仍保留在学习记录里。删除前可以先导出题库。`,
      confirmText: '删除题库',
      danger: true
    });
    if (!ok) return;
    await store.deleteBank(id);
    toast('题库已删除', 'ok');
    app.go('#/banks');
  }));
}
