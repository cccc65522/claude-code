import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

// Fail any test that logs a page error or console error.
test.beforeEach(async ({ page }, info) => {
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  info.problems = problems;
});
test.afterEach(async ({}, info) => {
  expect(info.problems, 'no errors in the page').toEqual([]);
});

async function loadSample(page) {
  await page.goto('/');
  await expect(page.getByTestId('empty-home')).toBeVisible();
  await page.getByRole('button', { name: '载入示例题库' }).tap();
  await expect(page.getByRole('heading', { name: '今日复习' })).toBeVisible();
}

// Uses the app's own data to know the right answer, then answers through the UI.
async function currentQuestion(page) {
  const qid = await page.getByTestId('question').getAttribute('data-qid');
  return page.evaluate(id => window.__app.store.state.questions.get(id), qid);
}

async function answer(page, right) {
  const q = await currentQuestion(page);
  const other = q.options.find(o => !q.answer.includes(o.key))?.key;
  if (q.type === 'single' || q.type === 'judge') {
    await page.locator(`.option[data-key="${right ? q.answer[0] : other}"]`).tap();
  } else if (q.type === 'multiple') {
    for (const k of right ? q.answer : [other]) await page.locator(`.option[data-key="${k}"]`).tap();
    await page.getByRole('button', { name: '提交答案' }).tap();
  } else if (q.type === 'fill') {
    await page.locator('#fill-input').fill(right ? q.answer[0] : '不知道');
    await page.getByRole('button', { name: '提交答案' }).tap();
  } else {
    await page.getByRole('button', { name: '查看参考答案' }).tap();
    await page.getByRole('button', { name: right ? '我答对了' : '我答错了' }).tap();
  }
  await expect(page.getByTestId('feedback')).toContainText(right ? '回答正确' : '回答错误');
}

async function next(page) {
  const btn = page.locator('[data-action="next"], [data-action="finish"]');
  const isFinish = (await btn.getAttribute('data-action')) === 'finish';
  await btn.tap();
  return isFinish;
}

async function startSequentialAll(page) {
  await page.goto('/#/practice');
  await page.locator('[data-seg="count"] button', { hasText: '全部' }).tap();
  await page.locator('[data-seg="order"] button', { hasText: '按题库顺序' }).tap();
  await page.getByRole('button', { name: '开始练习' }).tap();
  await expect(page.getByTestId('question')).toBeVisible();
}

test('import the sample bank, practise, review mistakes and see the study record', async ({ page }) => {
  await loadSample(page);
  await startSequentialAll(page);
  await expect(page.getByTestId('quiz-pos')).toHaveText('1 / 12');

  for (let i = 0; ; i++) {
    await answer(page, i >= 3); // first three wrong
    if (await next(page)) break;
  }
  await expect(page.getByTestId('summary-line')).toContainText('答对 9 / 12 题');
  await expect(page.getByTestId('score')).toContainText('75');
  await expect(page.locator('.review-list > li')).toHaveCount(3);

  await page.getByRole('link', { name: '错题', exact: true }).tap();
  await expect(page.getByTestId('wrong-count')).toHaveText('3 道错题');

  // Two rounds of right answers take the questions out of the wrong book (default threshold 2).
  for (let round = 1; round <= 2; round++) {
    await page.getByRole('button', { name: '重练全部错题' }).tap();
    await expect(page.getByTestId('quiz-pos')).toHaveText('1 / 3');
    while (true) {
      await answer(page, true);
      if (await next(page)) break;
    }
    await expect(page.getByTestId('summary-line')).toContainText('答对 3 / 3 题');
    await page.getByRole('link', { name: '错题', exact: true }).tap();
    await expect(page.getByTestId('wrong-count')).toHaveText(round === 1 ? '3 道错题' : '0 道错题');
  }

  await page.getByRole('link', { name: '记录', exact: true }).tap();
  await expect(page.getByTestId('total-answered')).toHaveText('18');
  await expect(page.getByTestId('total-accuracy')).toHaveText('83%');
  await expect(page.getByTestId('session-list').locator('li')).toHaveCount(3);

  await page.getByRole('link', { name: '首页', exact: true }).tap();
  await expect(page.getByTestId('today-count')).toHaveText('18');
  await expect(page.getByTestId('backup-reminder')).toContainText('还没有备份过');
});

test('an interrupted practice resumes after reloading the page', async ({ page }) => {
  await loadSample(page);
  await page.getByRole('button', { name: /随机练习/ }).tap();
  await answer(page, true);
  await next(page);
  await answer(page, false);
  // reloading on the quiz page (e.g. Safari dropped the tab) comes back to the next question
  await page.reload();
  await expect(page.getByTestId('quiz-pos')).toHaveText('3 / 12');
  // and the home page offers to continue
  await page.goto('/#/');
  await page.reload();
  await expect(page.getByTestId('resume-card')).toContainText('已答 2/12');
  await page.getByTestId('resume').tap();
  await expect(page.getByTestId('quiz-pos')).toHaveText('3 / 12');
  // going back shows the answered question with its result
  await page.getByRole('button', { name: '上一题' }).tap();
  await expect(page.getByTestId('feedback')).toContainText('回答错误');
  await page.getByRole('button', { name: '退出并保存进度' }).tap();
  await page.getByRole('button', { name: '放弃' }).tap();
  await page.getByRole('button', { name: '放弃' }).last().tap();
  await expect(page.getByTestId('resume-card')).toHaveCount(0);
});

test('import an Excel CSV saved as GBK, then paste text questions into the same bank', async ({ page }) => {
  await page.goto('/#/banks');
  await page.getByTestId('import-file').setInputFiles(path.join(FIXTURES, 'excel-gbk.csv'));
  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('识别为CSV 表格');
  await expect(page.getByTestId('preview-count')).toHaveText('可以导入 2 题');
  await expect(page.getByTestId('preview-errors')).toContainText('第 4 行：答案 D 超出了选项范围');
  await expect(page.locator('#import-name')).toHaveValue('excel-gbk');
  await page.getByRole('button', { name: '确认导入 2 题' }).tap();
  await expect(page.getByTestId('bank-title')).toHaveText('excel-gbk');
  await expect(page.getByTestId('bank-count')).toHaveText('2');
  await expect(page.locator('.q-list')).toContainText('Excel 默认的文件扩展名是？');

  await page.goto('/#/banks');
  await page.locator('summary', { hasText: '粘贴文字导入' }).tap();
  await page.locator('#paste-text').fill([
    '一、单选题',
    '1. 1 + 1 = ?',
    'A. 1  B. 2  C. 3',
    '答案：B',
    '二、填空题',
    '1. 水的化学式是____',
    '答案：H2O|H₂O'
  ].join('\n'));
  await page.getByRole('button', { name: '识别题目' }).tap();
  await expect(page.getByTestId('preview-count')).toHaveText('可以导入 2 题');
  await page.locator('#import-target').selectOption({ label: 'excel-gbk' });
  await expect(page.locator('#new-name-field')).toBeHidden();
  await page.getByRole('button', { name: '确认导入 2 题' }).tap();
  await expect(page.getByTestId('bank-count')).toHaveText('4');

  // the fill-in answer accepts either spelling
  await page.getByRole('link', { name: '练习这个题库' }).tap();
  await page.locator('[data-seg="order"] button', { hasText: '按题库顺序' }).tap();
  await page.locator('.chip', { hasText: '填空' }).isVisible();
  for (const t of ['单选', '判断']) await page.locator('[data-type]', { hasText: t }).tap();
  await expect(page.getByTestId('setup-count')).toContainText('符合条件 1 题');
  await page.getByRole('button', { name: '开始练习' }).tap();
  await page.locator('#fill-input').fill('h2o');
  await page.locator('#fill-input').press('Enter');
  await expect(page.getByTestId('feedback')).toContainText('回答正确');
});

test('export a backup, wipe everything, restore it (replace), then merge another device', async ({ page }) => {
  await loadSample(page);
  await page.getByRole('button', { name: /随机练习/ }).tap();
  for (let i = 0; i < 4; i++) { await answer(page, i % 2 === 0); await next(page); }
  await page.goto('/#/data');
  await expect(page.getByTestId('last-backup')).toHaveText('上次备份：从未备份');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载备份文件' }).tap()
  ]);
  expect(download.suggestedFilename()).toMatch(/^review-backup-\d{8}-\d{4}\.json$/);
  const file = test.info().outputPath('backup.json');
  await download.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(backup.schema).toBe('review-app-backup');
  expect(backup.counts).toMatchObject({ banks: 1, questions: 12, attempts: 4, wrong: 2 });
  await expect(page.getByTestId('last-backup')).not.toHaveText('上次备份：从未备份');

  await page.getByRole('button', { name: '清空全部数据' }).tap();
  await page.getByRole('button', { name: '全部删除' }).tap();
  await expect(page.getByTestId('empty-home')).toBeVisible();

  await page.goto('/#/data');
  await page.getByTestId('restore-file').setInputFiles(file);
  await expect(page.getByTestId('restore-preview')).toContainText('题库 1 · 题目 12 · 答题记录 4');
  await page.getByRole('button', { name: '开始恢复' }).tap();
  await page.getByRole('button', { name: '覆盖恢复' }).tap();
  await expect(page.getByRole('heading', { name: '今日复习' })).toBeVisible();
  await page.getByRole('link', { name: '记录', exact: true }).tap();
  await expect(page.getByTestId('total-answered')).toHaveText('4');
  await page.getByRole('link', { name: '错题', exact: true }).tap();
  await expect(page.getByTestId('wrong-count')).toHaveText('2 道错题');

  // Merge: add a second bank here, then merge the backup back in; both banks stay.
  await page.goto('/#/banks');
  await page.getByTestId('import-file').setInputFiles(path.join(FIXTURES, 'excel-gbk.csv'));
  await page.getByRole('button', { name: '确认导入 2 题' }).tap();
  await expect(page.getByTestId('bank-title')).toHaveText('excel-gbk');
  await page.goto('/#/data');
  await page.locator('summary', { hasText: '粘贴备份内容' }).tap();
  await page.locator('#restore-text').fill(fs.readFileSync(file, 'utf8'));
  await page.getByRole('button', { name: '检查备份' }).tap();
  await page.locator('input[value="merge"]').check();
  await page.getByRole('button', { name: '开始恢复' }).tap();
  await expect(page.locator('#toast')).toContainText('已恢复');
  await page.goto('/#/banks');
  await expect(page.getByTestId('bank-list').locator('li')).toHaveCount(2);

  // A question-bank file is not accepted as a backup.
  await page.goto('/#/data');
  await page.getByTestId('restore-file').setInputFiles(path.join(FIXTURES, 'excel-gbk.csv'));
  await expect(page.locator('#toast')).toContainText('不是有效的备份内容');
});

test('bank management: rename, delete a question, delete the bank', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/banks');
  await page.getByTestId('bank-list').locator('a').first().tap();
  await page.getByRole('button', { name: '重命名' }).tap();
  await page.locator('#dialog-input').fill('常识题');
  await page.getByRole('button', { name: '保存' }).tap();
  await expect(page.getByTestId('bank-title')).toHaveText('常识题');

  await page.locator('#q-search').fill('红楼梦');
  await expect(page.locator('.q-list > li')).toHaveCount(1);
  await page.locator('.q-list summary').first().tap();
  await page.getByRole('button', { name: '删除这道题' }).tap();
  await page.getByRole('button', { name: '删除', exact: true }).tap();
  await expect(page.getByTestId('bank-count')).toHaveText('11');

  await page.getByRole('button', { name: '删除题库' }).tap();
  await page.locator('.dialog').getByRole('button', { name: '删除题库' }).tap();
  await expect(page.getByTestId('bank-list')).toHaveCount(0);
});

test('settings persist, and threshold 1 clears a wrong question after one right answer', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/data');
  await page.locator('#set-threshold').selectOption('1');
  await page.locator('#set-instant').uncheck();
  // A reload aborts a write that is still in flight, so wait until both changes are stored.
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('review-app');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('meta').objectStore('meta').get('settings');
      get.onsuccess = () => { const v = get.result?.value; open.result.close(); resolve(v && [v.masterThreshold, v.instantSingle]); };
    };
  }))).toEqual([1, false]);
  await page.reload();
  await expect(page.locator('#set-threshold')).toHaveValue('1');
  await expect(page.locator('#set-instant')).not.toBeChecked();

  await startSequentialAll(page);
  // with instant grading off, a single-choice answer needs the submit button
  const q = await currentQuestion(page);
  const wrongKey = q.options.find(o => !q.answer.includes(o.key)).key;
  await page.locator(`.option[data-key="${wrongKey}"]`).tap();
  await expect(page.getByTestId('feedback')).toHaveCount(0);
  await page.getByRole('button', { name: '提交答案' }).tap();
  await expect(page.getByTestId('feedback')).toContainText('已加入错题本');
  await page.getByRole('button', { name: '结束' }).tap();
  await page.getByRole('button', { name: '结束并查看结果' }).tap();
  await expect(page.getByTestId('summary-line')).toContainText('11 题未答');

  await page.getByRole('button', { name: /重练这次的 1 道错题/ }).tap();
  await page.locator(`.option[data-key="${q.answer[0]}"]`).tap();
  await page.getByRole('button', { name: '提交答案' }).tap();
  await expect(page.getByTestId('feedback')).toContainText('连续答对 1 次，已从错题本移出');
});

test('fits an iPhone screen: no sideways scrolling, tab bar reachable, no zoom-on-focus inputs', async ({ page }) => {
  await loadSample(page);
  for (const hash of ['#/', '#/banks', '#/practice', '#/wrong', '#/records', '#/data']) {
    await page.goto('/' + hash);
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallInputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')]
        .filter(el => el.offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 16).length,
      smallButtons: [...document.querySelectorAll('.btn:not(.small), .tabbar a, .option')]
        .filter(el => el.offsetParent !== null && el.getBoundingClientRect().height < 44).length
    }));
    expect(m, hash).toEqual({ overflow: 0, smallInputs: 0, smallButtons: 0 });
    if (hash !== '#/practice') {
      const box = await page.locator('.tabbar').boundingBox();
      expect(box.y + box.height, `${hash} tab bar inside the viewport`).toBeLessThanOrEqual(page.viewportSize().height + 1);
    }
  }
  await startSequentialAll(page);
  await expect(page.locator('.tabbar')).toBeHidden();
  const foot = await page.locator('.quiz-foot').boundingBox();
  expect(foot.y + foot.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test('works offline after the first visit (service worker)', async ({ page, context }) => {
  await loadSample(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the worker control the page and cache everything
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '今日复习' })).toBeVisible();
  await page.getByRole('link', { name: '题库', exact: true }).tap();
  await expect(page.getByTestId('bank-list').locator('li')).toHaveCount(1);
  await context.setOffline(false);
});

test('the service worker leaves the other apps on the site alone', async ({ page, context }) => {
  // Other apps (格算 under sheet/, 弈 under xiangqi/, ...) share the origin's Cache Storage.
  await page.goto('/manifest.webmanifest');
  await page.evaluate(async () => {
    for (const name of ['gesuan-v1', 'yi-xiangqi-v1', 'review-app-v0']) await (await caches.open(name)).put('/x-' + name, new Response('x'));
  });
  await loadSample(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const keys = await page.evaluate(() => caches.keys());
  expect(keys.sort()).toEqual(['gesuan-v1', 'review-app-v1', 'yi-xiangqi-v1']);
  // Offline, a page in another app's folder must not be answered with 复习本's index.html.
  await context.setOffline(true);
  await expect(page.goto('/other-app/')).rejects.toThrow();
  await context.setOffline(false);
});

test('downloaded templates and an exported bank import back without errors', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/banks');
  await page.locator('.help summary').tap();
  for (const [label, name, count] of [['下载 CSV 模板', 'question-bank-template.csv', 5], ['下载文字模板', 'question-bank-template.txt', 2], ['下载 JSON 示例', 'sample-bank.json', 12]]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).tap()]);
    expect(download.suggestedFilename()).toBe(name);
    const file = test.info().outputPath(name);
    await download.saveAs(file);
    await page.getByTestId('import-file').setInputFiles(file);
    await expect(page.getByTestId('preview-count')).toHaveText(`可以导入 ${count} 题`);
    await expect(page.getByTestId('preview-errors')).toHaveCount(0);
    await page.getByRole('button', { name: '取消' }).tap();
    await page.locator('.help summary').tap();
  }

  await page.getByTestId('bank-list').locator('a').first().tap();
  const [exported] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出题库' }).tap()]);
  const file = test.info().outputPath('bank.json');
  await exported.saveAs(file);
  await page.goto('/#/banks');
  await page.getByTestId('import-file').setInputFiles(file);
  await expect(page.getByTestId('preview-count')).toHaveText('可以导入 12 题');
  await expect(page.locator('#import-name')).toHaveValue('示例题库（常识）');
  // importing into the same bank adds nothing new
  await page.locator('#import-target').selectOption({ index: 1 });
  await page.getByRole('button', { name: '确认导入 12 题' }).tap();
  await expect(page.locator('#toast')).toContainText('已导入 0 题，跳过题库里已有的 12 题');
});

test('shuffled options: letters follow the shown order and grading still uses the real answer', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/data');
  await page.locator('#set-shuffle').check();
  await page.goto('/#/practice');
  await page.locator('[data-seg="count"] button', { hasText: '全部' }).tap();
  for (const t of ['单选', '判断', '填空', '简答']) await page.locator('[data-type]', { hasText: t }).tap();
  await page.getByRole('button', { name: '开始练习' }).tap();
  for (let i = 0; i < 2; i++) {
    const q = await currentQuestion(page);
    expect(q.type).toBe('multiple');
    const shownKeys = await page.locator('.option').evaluateAll(els => els.map(e => e.dataset.key));
    const letters = q.answer.map(k => String.fromCharCode(65 + shownKeys.indexOf(k))).sort().join('');
    for (const k of q.answer) await page.locator(`.option[data-key="${k}"]`).tap();
    await page.getByRole('button', { name: '提交答案' }).tap();
    await expect(page.getByTestId('feedback')).toContainText('回答正确');
    await expect(page.getByTestId('feedback')).toContainText(`正确答案：${letters}`);
    await next(page);
  }
  await expect(page.getByTestId('summary-line')).toContainText('答对 2 / 2 题');
});
