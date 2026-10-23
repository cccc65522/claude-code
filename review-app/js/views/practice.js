import { TYPES, TYPE_LABEL } from '../importer.js';
import { answerText, responseText, summarize } from '../quiz.js';
import { esc, icon, toast, confirmDialog } from '../ui.js';
import { formatDuration, formatDateTime } from '../util.js';

// ---------------------------------------------------------------- setup

const setup = { bankId: '', source: 'all', order: 'random', count: null, types: null };

function seg(name, value, options) {
  return `<div class="segmented" role="group" data-seg="${name}">
    ${options.map(([v, label]) => `<button type="button" data-value="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join('')}
  </div>`;
}

export function renderPracticeSetup(root, app, { params }) {
  const { store } = app;
  const st = store.state;
  if (params.bank !== undefined) setup.bankId = store.bank(params.bank) ? params.bank : '';
  if (params.source) setup.source = params.source;
  if (setup.bankId && !store.bank(setup.bankId)) setup.bankId = '';
  if (setup.count === null) setup.count = st.settings.defaultCount;

  if (!st.banks.length) {
    root.innerHTML = `<div class="page"><div class="card empty"><h2>还没有题库</h2><a class="btn primary block" href="#/banks">去导入题库</a></div></div>`;
    return;
  }

  const draw = () => {
    const pool = store.poolFor({ source: setup.source, bankId: setup.bankId || null });
    const available = TYPES.filter(t => pool.some(q => q.type === t));
    const types = (setup.types || available).filter(t => available.includes(t));
    const matched = pool.filter(q => types.includes(q.type)).length;
    const n = setup.count ? Math.min(setup.count, matched) : matched;

    root.innerHTML = `
      <div class="page">
        <header class="page-head with-back">
          <a class="back" href="#/" aria-label="返回首页">${icon('back')}</a>
          <h1>练习设置</h1>
        </header>
        <section class="card form">
          <label class="field"><span>题库</span>
            <select class="input" id="setup-bank">
              <option value="">全部题库</option>
              ${st.banks.map(b => `<option value="${b.id}" ${b.id === setup.bankId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>
          </label>
          <div class="field"><span>范围</span>${seg('source', setup.source, [['all', '全部题目'], ['wrong', `错题（${st.wrong.size}）`], ['unseen', '没做过的']])}</div>
          <div class="field"><span>顺序</span>${seg('order', setup.order, [['random', '随机'], ['sequential', '按题库顺序']])}</div>
          <div class="field"><span>题量</span>${seg('count', setup.count, [[10, '10'], [20, '20'], [50, '50'], [0, '全部']])}</div>
          <div class="field"><span>题型</span>
            ${available.length ? `<div class="chips selectable" role="group">
              ${available.map(t => `<button type="button" class="chip ${types.includes(t) ? 'on' : ''}" data-type="${t}" aria-pressed="${types.includes(t)}">${TYPE_LABEL[t]}</button>`).join('')}
            </div>` : '<p class="muted">这个范围里没有题目</p>'}
          </div>
        </section>
        <p class="center muted" data-testid="setup-count">符合条件 ${matched} 题，本次练习 ${n} 题</p>
        <button class="btn primary block big" type="button" data-action="start" ${n ? '' : 'disabled'}>开始练习</button>
      </div>`;

    root.querySelector('#setup-bank').addEventListener('change', e => { setup.bankId = e.target.value; setup.types = null; draw(); });
    for (const group of root.querySelectorAll('[data-seg]')) {
      group.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        const key = group.dataset.seg;
        setup[key] = key === 'count' ? Number(b.dataset.value) : b.dataset.value;
        if (key === 'source') setup.types = null;
        draw();
      });
    }
    for (const chip of root.querySelectorAll('[data-type]')) {
      chip.addEventListener('click', () => {
        const t = chip.dataset.type;
        const next = types.includes(t) ? types.filter(x => x !== t) : [...types, t];
        setup.types = next;
        draw();
      });
    }
    root.querySelector('[data-action="start"]').addEventListener('click', () => app.startPractice({
      source: setup.source, bankId: setup.bankId || null, order: setup.order, count: setup.count, types
    }));
  };
  draw();
}

// ---------------------------------------------------------------- answering

export function renderQuiz(root, app) {
  const { store } = app;
  let s = store.activeSession();
  if (!s) {
    root.innerHTML = `<div class="page"><div class="card empty"><h2>没有进行中的练习</h2><a class="btn primary block" href="#/practice">开始练习</a><a class="btn block" href="#/">回到首页</a></div></div>`;
    return;
  }
  const ids = () => s.qids.filter(id => store.state.questions.has(id));
  const firstOpen = () => { const list = ids(); const i = list.findIndex(id => !s.answers[id]); return i === -1 ? list.length - 1 : i; };
  let pos = firstOpen();
  let ui = fresh();
  function fresh() { return { selected: new Set(), fill: '', shortText: '', revealed: false, busy: false, change: null }; }

  function optionState(q, key, rec) {
    if (!rec) return ui.selected.has(key) ? 'picked' : '';
    const chosen = Array.isArray(rec.response) && rec.response.includes(key);
    if (q.answer.includes(key)) return chosen ? 'right picked' : 'right';
    return chosen ? 'wrong picked' : 'dim';
  }

  function body(q, rec) {
    if (q.type === 'fill') {
      return `<input class="input big" id="fill-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"
        placeholder="输入答案" value="${esc(rec ? rec.response : ui.fill)}" ${rec ? 'disabled' : ''}>`;
    }
    if (q.type === 'short') {
      const text = rec ? (rec.response?.text ?? '') : ui.shortText;
      return `<textarea class="input" id="short-input" rows="4" placeholder="先写下你的答案（可选），再看参考答案" ${rec || ui.revealed ? 'readonly' : ''}>${esc(text)}</textarea>
        ${rec || ui.revealed ? `<div class="reference"><b>参考答案</b><p class="pre">${esc(q.answer[0])}</p></div>` : ''}`;
    }
    const order = s.optionOrder?.[q.id] || q.options.map(o => o.key);
    const byKey = Object.fromEntries(q.options.map(o => [o.key, o]));
    return `<div class="options ${q.type === 'judge' ? 'judge' : ''}" role="group" aria-label="选项">
      ${order.map((key, i) => {
        const o = byKey[key];
        const label = q.type === 'judge' ? (key === 'T' ? '✓' : '✗') : String.fromCharCode(65 + i);
        const stateCls = optionState(q, key, rec);
        return `<button type="button" class="option ${stateCls}" data-key="${key}" aria-pressed="${stateCls.includes('picked')}" ${rec ? 'disabled' : ''}>
          <span class="opt-key">${label}</span><span class="opt-text">${esc(o.text)}</span></button>`;
      }).join('')}
    </div>`;
  }

  // Shuffled options are shown with fresh letters, so the answer is spelled in display letters.
  function shownAnswer(q, keys) {
    const order = s.optionOrder?.[q.id];
    if (!order || (q.type !== 'single' && q.type !== 'multiple')) return null;
    return keys.map(k => String.fromCharCode(65 + order.indexOf(k))).sort().join('');
  }

  function feedback(q, rec) {
    if (!rec) return '';
    const right = rec.correct;
    const correctText = shownAnswer(q, q.answer) ?? answerText(q);
    const yourText = Array.isArray(rec.response) ? (shownAnswer(q, rec.response) ?? responseText(q, rec.response)) : responseText(q, rec.response);
    const threshold = store.state.settings.masterThreshold;
    const note = ui.change === 'added' ? '已加入错题本'
      : ui.change === 'removed' ? `连续答对 ${threshold} 次，已从错题本移出`
      : ui.change === 'updated' && right ? `错题本：再答对 ${threshold - (store.state.wrong.get(q.id)?.correctStreak ?? 0)} 次即可移出` : '';
    return `<section class="feedback ${right ? 'right' : 'wrong'}" data-testid="feedback" aria-live="polite">
      <p class="fb-title">${right ? '回答正确' : '回答错误'}</p>
      ${q.type !== 'short' ? `<p>正确答案：<b class="pre">${esc(correctText)}</b></p>` : ''}
      ${!right && q.type !== 'short' ? `<p>你的答案：${esc(yourText)}</p>` : ''}
      ${note ? `<p class="small">${note}</p>` : ''}
      ${q.explanation ? `<div class="explain"><b>解析</b><p class="pre">${esc(q.explanation)}</p></div>` : ''}
    </section>`;
  }

  function primary(q, rec, isLast, allDone) {
    if (rec) {
      if (allDone) return `<button class="btn primary grow" type="button" data-action="finish">查看结果</button>`;
      return `<button class="btn primary grow" type="button" data-action="next">${isLast ? '去未答的题' : '下一题'}</button>`;
    }
    if (q.type === 'short') {
      return ui.revealed
        ? `<button class="btn danger grow" type="button" data-action="self-wrong">我答错了</button><button class="btn success grow" type="button" data-action="self-right">我答对了</button>`
        : `<button class="btn primary grow" type="button" data-action="reveal">查看参考答案</button>`;
    }
    if (q.type === 'fill') return `<button class="btn primary grow" type="button" data-action="submit">提交答案</button>`;
    if ((q.type === 'single' || q.type === 'judge') && store.state.settings.instantSingle) return `<p class="grow hint">点选一个选项即判分</p>`;
    return `<button class="btn primary grow" type="button" data-action="submit" ${ui.selected.size ? '' : 'disabled'}>提交答案</button>`;
  }

  function draw({ scroll = true } = {}) {
    const list = ids();
    if (!list.length) {
      root.innerHTML = `<div class="page"><div class="card empty"><h2>这次练习的题目都被删除了</h2><button class="btn primary block" type="button" data-action="finish">结束练习</button></div></div>`;
      root.querySelector('[data-action="finish"]').addEventListener('click', finish);
      return;
    }
    pos = Math.min(pos, list.length - 1);
    const qid = list[pos];
    const q = store.state.questions.get(qid);
    const rec = s.answers[qid];
    const done = list.filter(id => s.answers[id]).length;
    const allDone = done === list.length;
    const isLast = pos === list.length - 1;

    root.innerHTML = `
      <div class="quiz">
        <header class="quiz-bar">
          <button class="icon-btn" type="button" data-action="exit" aria-label="退出并保存进度">${icon('back')}</button>
          <div class="quiz-title"><span class="ellipsis">${esc(s.title)}</span><span class="muted small" data-testid="quiz-pos">${pos + 1} / ${list.length}</span></div>
          <button class="link" type="button" data-action="end">结束</button>
        </header>
        <div class="progress thin" aria-hidden="true"><span style="width:${Math.round(done / list.length * 100)}%"></span></div>
        <main class="quiz-main">
          <article class="q-card" data-testid="question" data-qid="${qid}" data-type="${q.type}">
            <div class="q-meta"><span class="badge">${TYPE_LABEL[q.type]}</span>${store.state.wrong.has(qid) ? '<span class="badge warn">错题本</span>' : ''}</div>
            <p class="q-text pre">${esc(q.stem)}</p>
            ${body(q, rec)}
          </article>
          ${feedback(q, rec)}
        </main>
        <footer class="quiz-foot">
          <button class="btn" type="button" data-action="prev" ${pos === 0 ? 'disabled' : ''} aria-label="上一题">上一题</button>
          ${primary(q, rec, isLast, allDone)}
        </footer>
      </div>`;

    const optionsEl = root.querySelector('.options');
    optionsEl?.addEventListener('click', e => {
      const b = e.target.closest('.option');
      if (!b || rec || ui.busy) return;
      const key = b.dataset.key;
      if (q.type === 'multiple') {
        if (ui.selected.has(key)) ui.selected.delete(key); else ui.selected.add(key);
        draw({ scroll: false });
      } else if (store.state.settings.instantSingle) {
        submit(q, [key]);
      } else {
        ui.selected = new Set([key]);
        draw({ scroll: false });
      }
    });
    const fillEl = root.querySelector('#fill-input');
    if (fillEl && !rec) {
      fillEl.addEventListener('input', () => { ui.fill = fillEl.value; });
      fillEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitFill(q); } });
    }
    const shortEl = root.querySelector('#short-input');
    if (shortEl && !rec) shortEl.addEventListener('input', () => { ui.shortText = shortEl.value; });

    const on = (action, fn) => root.querySelector(`[data-action="${action}"]`)?.addEventListener('click', fn);
    on('submit', () => (q.type === 'fill' ? submitFill(q) : submit(q, [...ui.selected])));
    on('reveal', () => { ui.revealed = true; draw({ scroll: false }); });
    on('self-right', () => submit(q, { text: ui.shortText, self: true }));
    on('self-wrong', () => submit(q, { text: ui.shortText, self: false }));
    on('next', () => {
      const l = ids();
      const after = l.findIndex((id, i) => i > pos && !s.answers[id]);
      pos = after !== -1 ? after : Math.max(0, l.findIndex(id => !s.answers[id]));
      ui = fresh();
      draw();
    });
    on('prev', () => { if (pos > 0) { pos--; ui = fresh(); draw(); } });
    on('finish', finish);
    on('exit', () => { toast('进度已保存，可以在首页继续', 'info'); app.go('#/'); });
    on('end', () => app.run(async () => {
      const left = ids().length - ids().filter(id => s.answers[id]).length;
      if (left > 0) {
        const ok = await confirmDialog({ title: '结束这次练习？', message: `还有 ${left} 题没答，结束后不计入成绩。`, confirmText: '结束并查看结果' });
        if (!ok) return;
      }
      await finish();
    }));

    if (scroll) window.scrollTo(0, 0);
  }

  async function submit(q, response) {
    if (ui.busy) return;
    if (Array.isArray(response) && !response.length) { toast('先选择答案', 'error'); return; }
    ui.busy = true;
    const res = await app.run(() => store.answer(s.id, q.id, response));
    ui.busy = false;
    if (!res) return;
    s = store.state.sessions.get(s.id);
    ui.change = res.change;
    draw({ scroll: false });
    root.querySelector('[data-testid="feedback"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function submitFill(q) {
    const v = (root.querySelector('#fill-input')?.value ?? '').trim();
    if (!v) { toast('先填写答案', 'error'); return; }
    submit(q, v);
  }

  async function finish() {
    await app.run(async () => {
      await store.finishSession(s.id);
      app.go(`#/summary/${s.id}`);
    });
  }

  draw();
}

// ---------------------------------------------------------------- results

export function renderSummary(root, app, { args: [id] }) {
  const { store } = app;
  const s = store.state.sessions.get(id);
  if (!s) {
    root.innerHTML = `<div class="page"><div class="card"><h2>找不到这次练习</h2><a class="btn primary" href="#/">回到首页</a></div></div>`;
    return;
  }
  const sum = summarize(s);
  const wrongQs = sum.wrongIds.map(qid => store.state.questions.get(qid)).filter(Boolean);
  const score = sum.accuracy == null ? '—' : Math.round(sum.accuracy * 100);

  root.innerHTML = `
    <div class="page">
      <header class="page-head with-back">
        <a class="back" href="#/records" aria-label="返回记录">${icon('back')}</a>
        <h1>练习结果</h1>
      </header>
      <section class="card result">
        <p class="muted">${esc(s.title)} · ${formatDateTime(s.startedAt)}</p>
        <p class="score" data-testid="score">${score}<small>${sum.accuracy == null ? '' : '%'}</small></p>
        <p class="score-sub" data-testid="summary-line">答对 ${sum.correct} / ${sum.answered} 题${sum.answered < sum.total ? `（共 ${sum.total} 题，${sum.total - sum.answered} 题未答）` : ''} · 用时 ${formatDuration(sum.durationMs)}</p>
        <div class="stack">
          ${wrongQs.length ? `<button class="btn primary block" type="button" data-action="retry">重练这次的 ${wrongQs.length} 道错题</button>` : '<p class="center ok">全部答对！</p>'}
          <a class="btn block" href="#/practice">再练一组</a>
          <a class="btn block" href="#/">回到首页</a>
        </div>
      </section>
      ${wrongQs.length ? `
      <section class="card">
        <h2>答错的题</h2>
        <ol class="review-list">
          ${wrongQs.map(q => `<li>
            <p class="pre"><span class="badge">${TYPE_LABEL[q.type]}</span> ${esc(q.stem)}</p>
            ${q.options.length && q.type !== 'judge' ? `<ul class="opt-list">${q.options.map(o => `<li class="${q.answer.includes(o.key) ? 'right' : ''}"><b>${o.key}.</b> ${esc(o.text)}</li>`).join('')}</ul>` : ''}
            <p>你的答案：<span class="bad">${esc(responseText(q, s.answers[q.id]?.response))}</span></p>
            <p>正确答案：<b class="ok pre">${esc(answerText(q))}</b></p>
            ${q.explanation ? `<p class="muted pre">解析：${esc(q.explanation)}</p>` : ''}
          </li>`).join('')}
        </ol>
      </section>` : ''}
    </div>`;

  root.querySelector('[data-action="retry"]')?.addEventListener('click', () => app.startPractice({
    qids: wrongQs.map(q => q.id), kind: 'retry', title: `重练错题 · ${s.title}`, order: 'sequential'
  }));
}

