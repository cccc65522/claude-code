import { esc, toast, confirmDialog, readFileText, downloadText, canShareFiles, shareText, copyText, fileStamp } from '../ui.js';
import { formatDateTime } from '../util.js';

const LABELS = { banks: '题库', questions: '题目', attempts: '答题记录', sessions: '练习', wrong: '错题' };
let pendingRestore = null; // { backup, check, source }

function countsLine(counts) {
  return Object.keys(LABELS).map(k => `${LABELS[k]} ${counts[k] ?? 0}`).join(' · ');
}

function bytes(n) {
  if (n == null) return '未知';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function renderData(root, app) {
  const { store } = app;
  const st = store.state;
  const s = st.settings;
  const current = { banks: st.banks.length, questions: st.questions.size, attempts: st.attempts.length, sessions: st.sessions.size, wrong: st.wrong.size };
  const share = canShareFiles();

  root.innerHTML = `
    <div class="page">
      <header class="page-head"><h1>数据</h1></header>

      <section class="card">
        <h2>备份</h2>
        <p class="muted small">数据只存在这台设备的浏览器里。换手机、清理 Safari 数据之前，请先导出备份文件。</p>
        <p class="small">当前：${countsLine(current)}</p>
        <p class="small muted" data-testid="last-backup">上次备份：${st.lastBackupAt ? formatDateTime(st.lastBackupAt) : '从未备份'}</p>
        <div class="stack">
          ${share ? '<button class="btn primary block" type="button" data-action="share">导出备份（存储到“文件”）</button>' : ''}
          <button class="btn ${share ? '' : 'primary'} block" type="button" data-action="export">下载备份文件</button>
          <button class="btn block" type="button" data-action="copy">复制备份内容</button>
        </div>
      </section>

      <section class="card">
        <h2>恢复</h2>
        ${pendingRestore ? restorePreview(pendingRestore) : `
        <p class="muted small">选择之前导出的备份文件（.json），或者把备份内容粘贴进来。</p>
        <div class="stack">
          <label class="btn block file-btn">选择备份文件
            <input class="visually-hidden" type="file" data-testid="restore-file" accept=".json,application/json,text/plain">
          </label>
          <details class="fold">
            <summary class="btn block">粘贴备份内容</summary>
            <textarea class="input mono" rows="6" id="restore-text" placeholder='{"schema":"review-app-backup", ...}'></textarea>
            <button class="btn primary block" type="button" data-action="check-paste">检查备份</button>
          </details>
        </div>`}
      </section>

      <section class="card form">
        <h2>练习设置</h2>
        <label class="field row-between"><span>连续答对几次移出错题本</span>
          <select class="input narrow" id="set-threshold">
            ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${n === s.masterThreshold ? 'selected' : ''}>${n} 次</option>`).join('')}
          </select>
        </label>
        <label class="field row-between"><span>默认题量</span>
          <select class="input narrow" id="set-count">
            ${[[10, '10 题'], [20, '20 题'], [50, '50 题'], [0, '全部']].map(([n, l]) => `<option value="${n}" ${n === s.defaultCount ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="field row-between switch"><span>单选、判断点选即判分</span>
          <input type="checkbox" id="set-instant" ${s.instantSingle ? 'checked' : ''}>
        </label>
        <label class="field row-between switch"><span>打乱选项顺序</span>
          <input type="checkbox" id="set-shuffle" ${s.shuffleOptions ? 'checked' : ''}>
        </label>
      </section>

      <section class="card">
        <h2>存储</h2>
        <p class="small" id="storage-usage">已用空间：读取中…</p>
        <p class="small" id="storage-persist">持久存储：读取中…</p>
        <button class="btn block" type="button" data-action="persist">申请持久存储</button>
        <p class="muted small top-gap">在 iPhone 上，用 Safari 打开本站后点“分享 → 添加到主屏幕”，从主屏幕图标打开，数据更不容易被系统清理（Safari 会清理 7 天没访问过的网站数据）。</p>
      </section>

      <section class="card">
        <h2>清空</h2>
        <p class="muted small">删除这台设备上的全部题库、记录和错题，无法撤销。</p>
        <button class="btn block danger" type="button" data-action="wipe">清空全部数据</button>
      </section>

      <p class="foot muted">复习本 v${esc(app.version)} · 存储方式：${app.storage === 'indexeddb' ? 'IndexedDB' : '内存（不会保存）'}</p>
    </div>`;

  const backupText = async () => JSON.stringify(await store.exportBackup());
  // ASCII file names: some browsers replace non-ASCII download names with "download".
  const name = () => `review-backup-${fileStamp()}.json`;

  const on = (action, fn) => root.querySelector(`[data-action="${action}"]`)?.addEventListener('click', () => app.run(fn));
  on('export', async () => {
    downloadText(name(), await backupText());
    toast('备份文件已生成', 'ok');
    app.refresh();
  });
  on('share', async () => {
    try {
      await shareText(name(), await backupText());
      app.refresh();
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
  });
  on('copy', async () => {
    await copyText(await backupText());
    toast('备份内容已复制，可以粘贴到备忘录保存', 'ok', 3500);
    app.refresh();
  });

  const check = (text, source) => {
    let obj;
    try { obj = JSON.parse(text); } catch { toast('不是有效的备份内容（JSON 解析失败）', 'error', 4000); return; }
    const result = store.checkBackup(obj);
    if (!result.ok) { toast(result.errors.join('；'), 'error', 5000); return; }
    pendingRestore = { backup: obj, check: result, source };
    app.refresh();
  };
  root.querySelector('[data-testid="restore-file"]')?.addEventListener('change', e => app.run(async () => {
    const file = e.target.files[0];
    if (file) check(await readFileText(file), file.name);
  }));
  on('check-paste', async () => {
    const text = root.querySelector('#restore-text').value;
    if (!text.trim()) { toast('先粘贴备份内容', 'error'); return; }
    check(text, '粘贴的内容');
  });
  on('cancel-restore', async () => { pendingRestore = null; app.refresh(); });
  on('do-restore', async () => {
    const mode = root.querySelector('input[name="restore-mode"]:checked').value;
    if (mode === 'replace') {
      const ok = await confirmDialog({
        title: '覆盖恢复？',
        message: `这台设备上现有的数据（${countsLine(current)}）会被备份里的内容替换。`,
        confirmText: '覆盖恢复',
        danger: true
      });
      if (!ok) return;
    }
    const r = await store.restoreBackup(pendingRestore.backup, mode);
    pendingRestore = null;
    toast(`已恢复：${countsLine(r.counts)}${r.warnings.length ? `（${r.warnings.join('；')}）` : ''}`, 'ok', 5000);
    app.go('#/');
  });

  const saveSetting = patch => app.run(async () => { await store.updateSettings(patch); toast('已保存', 'ok', 1200); });
  root.querySelector('#set-threshold').addEventListener('change', e => saveSetting({ masterThreshold: Number(e.target.value) }));
  root.querySelector('#set-count').addEventListener('change', e => saveSetting({ defaultCount: Number(e.target.value) }));
  root.querySelector('#set-instant').addEventListener('change', e => saveSetting({ instantSingle: e.target.checked }));
  root.querySelector('#set-shuffle').addEventListener('change', e => saveSetting({ shuffleOptions: e.target.checked }));

  on('persist', async () => {
    if (!navigator.storage?.persist) { toast('这个浏览器不支持申请持久存储', 'error'); return; }
    const ok = await navigator.storage.persist();
    toast(ok ? '已开启持久存储' : '浏览器没有同意（添加到主屏幕后通常会自动保留数据）', ok ? 'ok' : 'info', 4000);
    showStorage();
  });
  on('wipe', async () => {
    const ok = await confirmDialog({ title: '清空全部数据？', message: `将删除：${countsLine(current)}。建议先导出备份。`, confirmText: '全部删除', danger: true });
    if (!ok) return;
    await store.clearAll();
    pendingRestore = null;
    toast('已清空', 'ok');
    app.go('#/');
  });

  async function showStorage() {
    const usage = root.querySelector('#storage-usage');
    const persist = root.querySelector('#storage-persist');
    try {
      const est = await navigator.storage?.estimate?.();
      if (usage) usage.textContent = est ? `已用空间：${bytes(est.usage)}（上限约 ${bytes(est.quota)}）` : '已用空间：浏览器不提供';
      const p = await navigator.storage?.persisted?.();
      if (persist) persist.textContent = `持久存储：${p === undefined ? '浏览器不提供' : p ? '已开启' : '未开启'}`;
    } catch {
      if (usage) usage.textContent = '已用空间：读取失败';
    }
  }
  showStorage();
}

function restorePreview({ backup, check, source }) {
  const counts = Object.fromEntries(Object.keys(LABELS).map(k => [k, check.data[k].length]));
  return `
    <div data-testid="restore-preview">
      <p class="small">来源：${esc(source)}</p>
      <p class="small">备份时间：${esc(backup.exportedAt ? formatDateTime(Date.parse(backup.exportedAt)) : '未知')}</p>
      <p class="small">内容：${countsLine(counts)}</p>
      ${check.warnings.length ? `<ul class="errors small">${check.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <fieldset class="choices">
        <legend class="small muted">恢复方式</legend>
        <label class="choice"><input type="radio" name="restore-mode" value="replace" checked>
          <span><b>覆盖</b><span class="muted small">用备份替换这台设备上的全部数据</span></span></label>
        <label class="choice"><input type="radio" name="restore-mode" value="merge">
          <span><b>合并</b><span class="muted small">两边的数据都保留，同一条记录以较新的为准</span></span></label>
      </fieldset>
      <div class="row">
        <button class="btn" type="button" data-action="cancel-restore">取消</button>
        <button class="btn primary grow" type="button" data-action="do-restore">开始恢复</button>
      </div>
    </div>`;
}
