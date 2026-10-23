import { TYPE_LABEL } from '../importer.js';
import { answerText, responseText } from '../quiz.js';
import { esc, toast, confirmDialog } from '../ui.js';
import { formatDateTime } from '../util.js';

const view = { bankId: '', limit: 50 };

export function renderWrong(root, app) {
  const { store } = app;
  const st = store.state;
  if (view.bankId && !store.bank(view.bankId)) view.bankId = '';
  const entries = [...st.wrong.values()]
    .filter(w => st.questions.has(w.qid) && (!view.bankId || w.bankId === view.bankId))
    .sort((a, b) => b.lastWrongAt - a.lastWrongAt);
  const threshold = st.settings.masterThreshold;

  root.innerHTML = `
    <div class="page">
      <header class="page-head"><h1>错题本</h1></header>
      <section class="card">
        <p class="big" data-testid="wrong-count">${entries.length} 道错题</p>
        <p class="muted small">答错的题会自动收进来；在任何练习里连续答对 ${threshold} 次就会移出（次数可以在“数据”页修改）。</p>
        ${st.banks.length > 1 ? `
        <label class="field"><span>题库</span>
          <select class="input" id="wrong-bank">
            <option value="">全部题库</option>
            ${st.banks.map(b => `<option value="${b.id}" ${b.id === view.bankId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select>
        </label>` : ''}
        <div class="stack top-gap">
          <button class="btn primary block" type="button" data-action="all" ${entries.length ? '' : 'disabled'}>重练全部错题</button>
          ${entries.length > 10 ? `<button class="btn block" type="button" data-action="ten">随机重练 10 题</button>` : ''}
        </div>
      </section>
      ${entries.length ? `
      <section class="card">
        <ol class="review-list" data-testid="wrong-list">
          ${entries.slice(0, view.limit).map(w => {
            const q = st.questions.get(w.qid);
            return `<li>
              <details>
                <summary>
                  <span class="badge">${TYPE_LABEL[q.type]}</span>
                  <span class="q-stem">${esc(q.stem)}</span>
                  <span class="item-sub">错 ${w.wrongCount} 次${w.correctStreak ? ` · 已连对 ${w.correctStreak} 次` : ''} · ${formatDateTime(w.lastWrongAt)}</span>
                </summary>
                <div class="q-body">
                  ${q.options.length && q.type !== 'judge' ? `<ul class="opt-list">${q.options.map(o => `<li class="${q.answer.includes(o.key) ? 'right' : ''}"><b>${o.key}.</b> ${esc(o.text)}</li>`).join('')}</ul>` : ''}
                  <p>上次的答案：<span class="bad">${esc(responseText(q, w.lastResponse))}</span></p>
                  <p>正确答案：<b class="ok pre">${esc(answerText(q))}</b></p>
                  ${q.explanation ? `<p class="muted pre">解析：${esc(q.explanation)}</p>` : ''}
                  <button class="btn small" type="button" data-remove="${q.id}">移出错题本</button>
                </div>
              </details>
            </li>`;
          }).join('')}
        </ol>
        ${entries.length > view.limit ? `<button class="btn block" type="button" data-action="more">再显示 50 题</button>` : ''}
        <button class="btn block danger-text top-gap" type="button" data-action="clear">清空${view.bankId ? '这个题库的' : ''}错题本</button>
      </section>` : `
      <section class="card empty"><p class="muted">没有错题。答错的题会出现在这里。</p></section>`}
    </div>`;

  root.querySelector('#wrong-bank')?.addEventListener('change', e => { view.bankId = e.target.value; view.limit = 50; app.refresh(); });
  root.querySelector('[data-action="all"]')?.addEventListener('click', () => app.startPractice({ source: 'wrong', bankId: view.bankId || null, order: 'random', count: 0 }));
  root.querySelector('[data-action="ten"]')?.addEventListener('click', () => app.startPractice({ source: 'wrong', bankId: view.bankId || null, order: 'random', count: 10 }));
  root.querySelector('[data-action="more"]')?.addEventListener('click', () => { view.limit += 50; app.refresh(); });
  root.querySelector('[data-action="clear"]')?.addEventListener('click', () => app.run(async () => {
    const ok = await confirmDialog({ title: '清空错题本？', message: `会移出 ${entries.length} 道错题，答题历史不受影响。`, confirmText: '清空', danger: true });
    if (!ok) return;
    const n = await store.clearWrong(view.bankId || null);
    toast(`已移出 ${n} 道错题`, 'ok');
    app.refresh();
  }));
  root.querySelector('[data-testid="wrong-list"]')?.addEventListener('click', e => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    app.run(async () => {
      await store.removeWrong(b.dataset.remove);
      toast('已移出错题本', 'ok');
      app.refresh();
    });
  });
}
