import { openIndexedDB, createMemoryDB } from './db.js';
import { createStore } from './store.js';
import { toast, icon, esc, confirmDialog } from './ui.js';
import { renderHome } from './views/home.js';
import { renderBanks, renderBankDetail } from './views/banks.js';
import { renderPracticeSetup, renderQuiz, renderSummary } from './views/practice.js';
import { renderWrong } from './views/wrong.js';
import { renderRecords } from './views/records.js';
import { renderData } from './views/data.js';

export const APP_VERSION = '1.0.0';

const TABS = [
  { id: 'home', hash: '#/', label: '首页', icon: 'home' },
  { id: 'banks', hash: '#/banks', label: '题库', icon: 'book' },
  { id: 'wrong', hash: '#/wrong', label: '错题', icon: 'wrong' },
  { id: 'records', hash: '#/records', label: '记录', icon: 'chart' },
  { id: 'data', hash: '#/data', label: '数据', icon: 'data' }
];

const ROUTES = [
  { re: /^\/?$/, tab: 'home', view: renderHome },
  { re: /^\/banks$/, tab: 'banks', view: renderBanks },
  { re: /^\/bank\/([\w-]+)$/, tab: 'banks', view: renderBankDetail },
  { re: /^\/practice$/, tab: 'home', view: renderPracticeSetup },
  { re: /^\/quiz$/, tab: null, view: renderQuiz },
  { re: /^\/summary\/([\w-]+)$/, tab: 'home', view: renderSummary },
  { re: /^\/wrong$/, tab: 'wrong', view: renderWrong },
  { re: /^\/records$/, tab: 'records', view: renderRecords },
  { re: /^\/data$/, tab: 'data', view: renderData }
];

const app = {
  version: APP_VERSION,
  store: null,
  storage: 'indexeddb',
  storageError: '',
  go,
  refresh,
  run,
  startPractice
};
window.__app = app; // handy for debugging from the console

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path, params: Object.fromEntries(new URLSearchParams(query)) };
}

let routing = Promise.resolve();
function route(keepScroll = false) {
  routing = routing.then(() => renderRoute(keepScroll)).catch(e => console.error(e));
  return routing;
}

async function renderRoute(keepScroll) {
  const { path, params } = parseHash();
  const r = ROUTES.find(x => x.re.test(path)) || ROUTES[0];
  const args = (path.match(r.re) || []).slice(1);
  const y = window.scrollY;
  document.body.classList.toggle('immersive', r.tab === null);
  for (const a of document.querySelectorAll('.tabbar a')) {
    const on = a.dataset.tab === r.tab;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const view = document.getElementById('view');
  try {
    view.innerHTML = '';
    await r.view(view, app, { params, args });
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="page"><div class="card"><h2>页面出错了</h2><p class="muted">${esc(e.message)}</p><a class="btn primary" href="#/">回到首页</a></div></div>`;
  }
  if (app.storage === 'memory') {
    view.insertAdjacentHTML('afterbegin', `<div class="banner danger">浏览器不允许本地存储（${esc(app.storageError)}），关闭页面后数据会丢失。请关闭“无痕浏览”后再使用。</div>`);
  }
  window.scrollTo(0, keepScroll ? y : 0);
}

function go(hash) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) route();
  else location.hash = hash;
}

function refresh() {
  return route(true);
}

// Runs an action and shows its error message instead of failing silently.
async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), 'error', 4000);
    return undefined;
  }
}

async function startPractice(opts) {
  const { store } = app;
  const active = store.activeSession();
  if (active && Object.keys(active.answers).length && !opts.force) {
    const ok = await confirmDialog({
      title: '开始新的练习？',
      message: `上次的练习还没做完（${Object.keys(active.answers).length}/${active.qids.length}）。已答的题会保留在记录里，但不能再继续。`,
      confirmText: '开始新练习'
    });
    if (!ok) return;
  }
  const s = await run(() => store.startSession(opts));
  if (s) go('#/quiz');
}

function renderTabbar() {
  document.getElementById('tabbar').innerHTML = TABS.map(t =>
    `<a href="${t.hash}" data-tab="${t.id}">${icon(t.icon)}<span>${t.label}</span></a>`).join('');
}

function registerServiceWorker() {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || local)) return;
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
}

async function boot() {
  let db;
  try {
    db = await openIndexedDB();
  } catch (e) {
    db = createMemoryDB();
    app.storage = 'memory';
    app.storageError = e.message;
  }
  app.store = createStore(db);
  await app.store.init();
  renderTabbar();
  window.addEventListener('hashchange', () => route());
  await route();
  document.body.classList.add('ready');
  registerServiceWorker();
}

boot().catch(e => {
  console.error(e);
  document.getElementById('view').innerHTML = `<div class="page"><div class="card"><h2>启动失败</h2><p class="muted">${esc(e.message)}</p></div></div>`;
});
