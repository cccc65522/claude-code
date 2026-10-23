import { overview } from '../stats.js';
import { esc, icon, confirmDialog } from '../ui.js';
import { percent } from '../util.js';
import { parseImport } from '../importer.js';
import { SAMPLE_BANK } from '../sample.js';

const DAY = 86400000;

export function renderHome(root, app) {
  const { store } = app;
  const st = store.state;
  const now = Date.now();
  const o = overview(st.attempts, now);
  const active = store.activeSession();
  const count = st.settings.defaultCount || 0;

  if (!st.banks.length) {
    root.innerHTML = `
      <div class="page">
        <header class="page-head"><h1>复习本</h1></header>
        <section class="card empty" data-testid="empty-home">
          <h2>先导入一份题库</h2>
          <p class="muted">支持 JSON、CSV（Excel 另存为）和从文档复制的文字题目。也可以先用示例题库试一试。</p>
          <div class="stack">
            <a class="btn primary block" href="#/banks">导入题库</a>
            <button class="btn block" type="button" data-action="sample">载入示例题库</button>
          </div>
        </section>
      </div>`;
    root.querySelector('[data-action="sample"]').addEventListener('click', () => app.run(async () => {
      const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
      await store.importQuestions({ bankName: parsed.bankName, questions: parsed.questions });
      app.refresh();
    }));
    return;
  }

  const answered = active ? Object.keys(active.answers).length : 0;
  const backupDays = st.lastBackupAt ? Math.floor((now - st.lastBackupAt) / DAY) : null;
  const needBackup = st.attempts.length > 0 && (backupDays === null || backupDays >= 7);

  root.innerHTML = `
    <div class="page">
      <header class="page-head"><h1>今日复习</h1></header>

      <section class="tiles" aria-label="今日概况">
        <div class="tile"><span class="tile-num" data-testid="today-count">${o.todayTotal}</span><span class="tile-label">今日答题</span></div>
        <div class="tile"><span class="tile-num">${percent(o.todayAccuracy)}</span><span class="tile-label">今日正确率</span></div>
        <div class="tile"><span class="tile-num">${o.streak}</span><span class="tile-label">连续天数</span></div>
      </section>

      ${active ? `
      <section class="card resume" data-testid="resume-card">
        <div class="row-between">
          <div>
            <h2>继续上次练习</h2>
            <p class="muted">${esc(active.title)} · 已答 ${answered}/${active.qids.length}</p>
          </div>
        </div>
        <div class="progress"><span style="width:${Math.round(answered / active.qids.length * 100)}%"></span></div>
        <div class="row">
          <a class="btn primary grow" href="#/quiz" data-testid="resume">继续</a>
          <button class="btn" type="button" data-action="abandon">放弃</button>
        </div>
      </section>` : ''}

      ${needBackup ? `
      <a class="banner warn" href="#/data" data-testid="backup-reminder">
        ${backupDays === null ? '还没有备份过学习数据' : `已经 ${backupDays} 天没有备份了`}，点这里导出一份备份文件 ${icon('chevron', 'icon sm')}
      </a>` : ''}

      <section class="card">
        <h2>开始练习</h2>
        <div class="stack">
          <button class="btn primary block" type="button" data-action="quick">随机练习 ${count ? `${count} 题` : '全部题目'}</button>
          <button class="btn block" type="button" data-action="wrong" ${st.wrong.size ? '' : 'disabled'}>错题重练（${st.wrong.size} 题）</button>
          <a class="btn block" href="#/practice">自定义练习…</a>
        </div>
      </section>

      <section class="card">
        <div class="row-between"><h2>我的题库</h2><a class="link" href="#/banks">管理</a></div>
        <ul class="list">
          ${st.banks.map(b => `
            <li><a class="list-item" href="#/practice?bank=${b.id}">
              <span class="grow"><span class="item-title">${esc(b.name)}</span>
              <span class="item-sub">${store.questionsOf(b.id).length} 题</span></span>
              ${icon('chevron', 'icon sm muted')}
            </a></li>`).join('')}
        </ul>
      </section>

      <p class="foot muted">累计答题 ${o.total} 道 · 总正确率 ${percent(o.accuracy)} · 学习 ${o.activeDays} 天</p>
    </div>`;

  root.querySelector('[data-action="quick"]').addEventListener('click', () => app.startPractice({ order: 'random', count }));
  root.querySelector('[data-action="wrong"]').addEventListener('click', () => app.startPractice({ source: 'wrong', order: 'random', count: 0 }));
  root.querySelector('[data-action="abandon"]')?.addEventListener('click', () => app.run(async () => {
    const ok = await confirmDialog({ title: '放弃这次练习？', message: '已答的题会保留在学习记录里，剩下的题不再继续。', confirmText: '放弃', danger: true });
    if (!ok) return;
    await store.abandonSession(active.id);
    app.refresh();
  }));
}
