import { overview, daily, bankStats } from '../stats.js';
import { summarize } from '../quiz.js';
import { esc, icon } from '../ui.js';
import { percent, formatDateTime, formatDuration } from '../util.js';

const KIND = { practice: '练习', wrong: '错题重练', retry: '重练' };

export function renderRecords(root, app) {
  const { store } = app;
  const st = store.state;
  const now = Date.now();
  const o = overview(st.attempts, now);
  const days = daily(st.attempts, 14, now);
  const max = Math.max(1, ...days.map(d => d.total));
  const banks = bankStats(st.banks, [...st.questions.values()], st.attempts);
  const sessions = [...st.sessions.values()]
    .filter(s => Object.keys(s.answers).length)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 30);

  root.innerHTML = `
    <div class="page">
      <header class="page-head"><h1>学习记录</h1></header>
      <section class="tiles four">
        <div class="tile"><span class="tile-num" data-testid="total-answered">${o.total}</span><span class="tile-label">累计答题</span></div>
        <div class="tile"><span class="tile-num" data-testid="total-accuracy">${percent(o.accuracy)}</span><span class="tile-label">总正确率</span></div>
        <div class="tile"><span class="tile-num">${o.activeDays}</span><span class="tile-label">学习天数</span></div>
        <div class="tile"><span class="tile-num">${o.streak}</span><span class="tile-label">连续天数</span></div>
      </section>

      <section class="card">
        <h2>最近 14 天</h2>
        <div class="bars" role="img" aria-label="最近 14 天每天答题数">
          ${days.map(d => {
            const h = Math.round(d.total / max * 100);
            const ch = d.total ? Math.round(d.correct / d.total * h) : 0;
            return `<div class="bar-col" title="${d.date}：答 ${d.total} 题，对 ${d.correct} 题">
              <span class="bar-num">${d.total || ''}</span>
              <div class="bar"><span class="bar-total" style="height:${h}%"></span><span class="bar-right" style="height:${ch}%"></span></div>
              <span class="bar-day">${Number(d.date.slice(-2))}</span>
            </div>`;
          }).join('')}
        </div>
        <p class="legend small muted"><span class="dot right"></span>答对 <span class="dot total"></span>答错</p>
      </section>

      <section class="card">
        <h2>各题库进度</h2>
        ${banks.length ? `<ul class="list">
          ${banks.map(b => `<li class="list-item static">
            <span class="grow"><span class="item-title">${esc(b.name)}</span>
            <span class="item-sub">做过 ${b.seen}/${b.total} · 最近一次答对 ${b.latestRight} 题 · 正确率 ${percent(b.accuracy)}</span>
            <span class="progress"><span style="width:${b.total ? Math.round(b.seen / b.total * 100) : 0}%"></span></span></span>
          </li>`).join('')}
        </ul>` : '<p class="muted">还没有题库。</p>'}
      </section>

      <section class="card">
        <h2>练习历史</h2>
        ${sessions.length ? `<ul class="list" data-testid="session-list">
          ${sessions.map(s => {
            const sum = summarize(s);
            return `<li><a class="list-item" href="#/summary/${s.id}">
              <span class="grow"><span class="item-title">${esc(s.title)}</span>
              <span class="item-sub">${formatDateTime(s.startedAt)} · ${KIND[s.kind] || '练习'} · 对 ${sum.correct}/${sum.answered}${s.finishedAt ? ` · ${formatDuration(sum.durationMs)}` : ' · 未完成'}</span></span>
              <span class="pill ${sum.accuracy >= 0.8 ? 'ok' : sum.accuracy >= 0.6 ? 'warn' : 'bad'}">${percent(sum.accuracy)}</span>
              ${icon('chevron', 'icon sm muted')}
            </a></li>`;
          }).join('')}
        </ul>` : '<p class="muted">还没有练习记录。</p>'}
      </section>
    </div>`;
}
