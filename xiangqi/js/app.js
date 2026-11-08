// 弈 · 中国象棋 — app controller.

import { Position, START_FEN, RED, BLACK, sideOf, typeOf, src, dst, sideTag } from './engine/board.js';
import { Game, SIDE_NAME } from './engine/game.js';
import { toChinese, fromChinese, fromIccs, toIccs, pieceName } from './engine/notation.js';
import { LEVELS, MATE, WIN } from './engine/search.js';
import { bookMoves } from './engine/book.js';
import { PUZZLES } from './engine/puzzles.js';
import { BoardView } from './ui/board-view.js';
import { EngineClient } from './ui/engine-client.js';
import { dialog, menu, toast, esc } from './ui/ui.js';
import { sound, playSound } from './ui/sound.js';

const STORE = 'yi.state.v1';
const $ = id => document.getElementById(id);
const HINT_LEVEL = { timeMs: 1500, maxDepth: 64, noise: 0, book: true };
const DEFENSE_LEVEL = { timeMs: 900, maxDepth: 64, noise: 0, book: false };

const app = {
  game: new Game(),
  mode: 'ai',          // 'ai' | 'pvp' | 'puzzle'
  humanSide: RED,
  levelId: 'medium',
  puzzleId: null,
  solved: [],
  manualFlip: false,
  showAnalysis: true,
  reviewIndex: null,   // record index being reviewed (-1 = start position), null = live
  selected: null,
  hint: 0,
  thinking: false,
  info: null,
  opening: '',
  busyToken: 0,
  demo: false
};

const engine = new EngineClient();
const board = new BoardView($('board'), {
  canDrag: s => canMoveFrom(s),
  onTap: s => onTap(s),
  onDrop: (from, to) => tryMove(from, to),
  onDragStart: s => select(s),
  onDragCancel: () => render()
});

const level = () => LEVELS.find(l => l.id === app.levelId) || LEVELS[2];
const puzzle = () => PUZZLES.find(p => p.id === app.puzzleId) || null;
const engineSide = () => (app.mode === 'pvp' ? null : app.humanSide ^ 1);

// ---------- persistence ----------

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      game: app.game.toJSON(), mode: app.mode, humanSide: app.humanSide, levelId: app.levelId,
      puzzleId: app.puzzleId, solved: app.solved, manualFlip: app.manualFlip,
      showAnalysis: app.showAnalysis, sound: sound.enabled
    }));
  } catch { /* private mode: fine */ }
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!s) return;
    app.game = Game.fromJSON(s.game);
    Object.assign(app, {
      mode: s.mode || 'ai', humanSide: s.humanSide ?? RED, levelId: s.levelId || 'medium',
      puzzleId: s.puzzleId || null, solved: s.solved || [], manualFlip: !!s.manualFlip,
      showAnalysis: s.showAnalysis !== false
    });
    sound.enabled = s.sound !== false;
  } catch {
    app.game = new Game();
  }
}

// ---------- helpers ----------

const isLive = () => app.reviewIndex === null;
const humanToMove = () => isLive() && !app.game.result && !app.demo && (app.mode === 'pvp' || app.game.side === app.humanSide);

function canMoveFrom(s) {
  if (!humanToMove() || app.thinking) return false;
  const pc = app.game.pos.squares[s];
  return !!pc && sideOf(pc) === app.game.side;
}

function targetsFrom(s) {
  return app.game.legalMoves().filter(m => src(m) === s).map(m => ({ sq: dst(m), capture: !!app.game.pos.squares[dst(m)] }));
}

function select(s) {
  app.selected = s;
  app.hint = 0;
  renderMarks();
}

function onTap(s) {
  if (!isLive()) { toast('正在复盘，点“回到对局”继续下棋'); return; }
  if (app.game.result) { toast(app.game.result.text); return; }
  if (!humanToMove() || app.thinking) { if (app.thinking) toast('电脑正在思考…'); return; }
  if (app.selected !== null && app.selected !== s && tryMove(app.selected, s)) return;
  if (canMoveFrom(s)) select(app.selected === s ? null : s);
  else if (app.selected !== null) select(null);
}

function tryMove(from, to) {
  if (!humanToMove() || app.thinking) return false;
  const mv = app.game.legalMoves().find(m => src(m) === from && dst(m) === to);
  if (mv === undefined) {
    // Explain the common illegal cases instead of failing silently.
    const pc = app.game.pos.squares[from];
    if (pc && sideOf(pc) === app.game.side && app.game.pos.isPseudoLegalFast(from | (to << 8))) {
      toast(app.game.pos.inCheck() ? '正在被将军，这步不能解将' : '这步会让自己的将帅被吃（或将帅照面）');
    }
    return false;
  }
  playMove(mv);
  afterMove();
  return true;
}

function playMove(mv) {
  const g = app.game;
  const book = bookMoves(g.pos).find(e => e.mv === mv);
  if (book) app.opening = book.name;
  const rec = g.play(mv);
  if (!rec) return null;
  board.setPosition(g.pos, { mv });
  playSound(g.result ? 'check' : rec.check ? 'check' : rec.captured ? 'capture' : 'move');
  app.selected = null;
  app.hint = 0;
  $('live').textContent = `${SIDE_NAME[rec.mover]}：${rec.notation}${rec.check ? '，将军' : ''}`;
  save();
  render();
  return rec;
}

function afterMove() {
  const g = app.game;
  if (g.result) { gameOver(); return; }
  if (app.mode === 'puzzle') {
    const pz = puzzle();
    const redMoves = g.records.filter(r => r.mover === RED).length;
    if (g.side === BLACK && redMoves >= pz.moves) { puzzleFailed(); return; }
  }
  maybeEngine();
}

function maybeEngine() {
  const g = app.game;
  if (!isLive() || g.result || app.mode === 'pvp' || app.demo) return;
  if (g.side !== engineSide()) return;
  engineMove();
}

async function engineMove() {
  const g = app.game;
  const token = ++app.busyToken;
  app.thinking = true;
  app.info = null;
  render();
  const lvl = app.mode === 'puzzle' ? DEFENSE_LEVEL : level();
  try {
    const started = performance.now();
    const res = await engine.think({
      startFen: g.startFen, moves: g.records.map(r => r.iccs), level: lvl,
      onInfo: info => { if (token === app.busyToken) { app.info = { ...info, side: g.side, ply: g.records.length }; renderAnalysis(); renderPlayers(); } }
    });
    if (token !== app.busyToken) return;
    // Don't snap instantly on book moves: give the human a beat to see their move land.
    const wait = 350 - (performance.now() - started);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (token !== app.busyToken) return;
    app.thinking = false;
    app.info = { ...res, side: g.side, ply: g.records.length };
    if (!res.mv) { render(); return; }
    playMove(fromIccs(res.mv));
    afterMove();
  } catch (e) {
    if (token !== app.busyToken) return;
    app.thinking = false;
    if (!e.cancelled) toast(`引擎出错：${e.message}`);
    render();
  }
}

function stopEngine() {
  app.busyToken++;
  engine.stop();
  app.thinking = false;
}

// ---------- commands ----------

function undo() {
  if (app.demo) return;
  if (!isLive()) exitReview();
  const g = app.game;
  stopEngine();
  if (!g.records.length) { toast('已经是开局了'); render(); return; }
  g.undo();
  if (app.mode !== 'pvp') while (g.records.length && g.side !== app.humanSide) g.undo();
  recomputeOpening();
  board.setPosition(g.pos, { animate: false });
  save();
  render();
  maybeEngine();
}

async function hint() {
  if (!humanToMove()) { toast(app.game.result ? '对局已经结束' : '现在不是你走棋'); return; }
  const pz = puzzle();
  if (app.mode === 'puzzle' && pz && !app.game.records.length) toast(`提示：${pz.hint}`, 3500);
  const g = app.game;
  const token = ++app.busyToken;
  app.thinking = true;
  render();
  try {
    const res = await engine.think({
      startFen: g.startFen, moves: g.records.map(r => r.iccs), level: app.mode === 'puzzle' ? { ...HINT_LEVEL, book: false } : HINT_LEVEL,
      onInfo: info => { if (token === app.busyToken) { app.info = { ...info, side: g.side, ply: g.records.length }; renderAnalysis(); } }
    });
    if (token !== app.busyToken) return;
    app.thinking = false;
    app.info = { ...res, side: g.side, ply: g.records.length };
    if (res.mv) {
      app.hint = fromIccs(res.mv);
      app.selected = null;
      toast(`建议：${toChinese(g.pos, app.hint)}${res.book ? `（${res.book}）` : ''}`);
    }
    render();
  } catch (e) {
    if (token !== app.busyToken) return;
    app.thinking = false;
    render();
  }
}

function moveNow() {
  if (app.thinking) engine.stop({ useBest: true });
}

function flip() {
  app.manualFlip = !app.manualFlip;
  save();
  render();
}

async function resign() {
  const g = app.game;
  if (g.result || !isLive()) return;
  const side = app.mode === 'pvp' ? g.side : app.humanSide;
  const ok = await dialog({
    title: '认输',
    body: `<p>确定${app.mode === 'pvp' ? `让${SIDE_NAME[side]}` : ''}认输吗？</p>`,
    buttons: [{ label: '取消', value: false }, { label: '认输', value: true, primary: true }]
  });
  if (!ok) return;
  stopEngine();
  g.resign(side);
  save();
  render();
  gameOver();
}

function startGame({ mode = app.mode, humanSide = app.humanSide, levelId = app.levelId, fen = START_FEN, puzzleId = null } = {}) {
  stopEngine();
  app.demo = false;
  Object.assign(app, { mode, humanSide, levelId, puzzleId, reviewIndex: null, selected: null, hint: 0, info: null, opening: '' });
  app.manualFlip = false;
  try {
    app.game = new Game(fen);
  } catch (e) {
    toast(`局面有误：${e.message}`, 4000);
    app.game = new Game();
  }
  board.setPosition(app.game.pos, { animate: false });
  save();
  render();
  maybeEngine();
}

async function newGameDialog() {
  const body = document.createElement('div');
  body.className = 'newgame';
  body.innerHTML = `
    <fieldset><legend>对手</legend>
      <label class="chip"><input type="radio" name="mode" value="ai"> 电脑</label>
      <label class="chip"><input type="radio" name="mode" value="pvp"> 双人对弈</label></fieldset>
    <fieldset class="ai-only"><legend>我执</legend>
      <label class="chip"><input type="radio" name="side" value="0"> 红方（先走）</label>
      <label class="chip"><input type="radio" name="side" value="1"> 黑方</label></fieldset>
    <fieldset class="ai-only"><legend>难度</legend>
      ${LEVELS.map(l => `<label class="chip"><input type="radio" name="level" value="${l.id}"> ${l.name}</label>`).join('')}
      <p class="note" id="level-note"></p></fieldset>`;
  const notes = {
    novice: '只看两步，还会犯错，适合刚学会规则。', easy: '看四步左右，会用开局库。', medium: '每步约 1 秒，业余爱好者水平。',
    hard: '每步约 3 秒，会主动找杀。', master: '每步约 8 秒，全力计算。'
  };
  const sync = () => {
    const mode = body.querySelector('[name=mode]:checked').value;
    body.querySelectorAll('.ai-only').forEach(f => { f.hidden = mode !== 'ai'; });
    body.querySelector('#level-note').textContent = notes[body.querySelector('[name=level]:checked').value];
  };
  body.querySelector(`[name=mode][value=${app.mode === 'pvp' ? 'pvp' : 'ai'}]`).checked = true;
  body.querySelector(`[name=side][value="${app.humanSide}"]`).checked = true;
  body.querySelector(`[name=level][value=${app.levelId}]`).checked = true;
  body.addEventListener('change', sync);
  sync();
  const res = await dialog({
    title: '新局',
    body,
    buttons: [{ label: '取消', value: null }, {
      label: '开始', primary: true,
      value: b => ({
        mode: b.querySelector('[name=mode]:checked').value,
        humanSide: Number(b.querySelector('[name=side]:checked').value),
        levelId: b.querySelector('[name=level]:checked').value
      })
    }]
  });
  if (res) startGame(res);
}

async function puzzlesDialog() {
  const body = document.createElement('div');
  body.className = 'puzzles';
  body.innerHTML = `<p class="note">红先，在规定步数内将死黑方。黑方由电脑防守。</p><ul>${PUZZLES.map((p, i) => `
    <li><button class="puzzle-item" data-id="${p.id}"><span class="num">${i + 1}</span><span class="name">${esc(p.name)}</span>
    <span class="len">${p.moves} 步杀</span><span class="done">${app.solved.includes(p.id) ? '✓' : ''}</span></button></li>`).join('')}</ul>`;
  const picked = await dialog({
    title: '残局练习', body, buttons: [{ label: '关闭', value: null }],
    onOpen: (el, finish) => el.addEventListener('click', e => {
      const b = e.target.closest('[data-id]');
      if (b) finish(b.dataset.id);
    })
  });
  if (picked) startPuzzle(picked);
}

function startPuzzle(id) {
  const pz = PUZZLES.find(p => p.id === id);
  startGame({ mode: 'puzzle', humanSide: RED, fen: pz.fen, puzzleId: id });
  toast(`${pz.name}：红先，${pz.moves} 步之内将死黑方`, 3000);
}

async function puzzleFailed() {
  const pz = puzzle();
  render();
  const choice = await dialog({
    title: '再试一次？',
    body: `<p>没能在 ${pz.moves} 步之内将死黑方。</p>`,
    buttons: [{ label: '看答案', value: 'solution' }, { label: '重来', value: 'retry', primary: true }]
  });
  if (choice === 'retry') startPuzzle(pz.id);
  else if (choice === 'solution') showSolution(pz);
}

// Let the engine play the puzzle out for both sides, slowly.
async function showSolution(pz) {
  startGame({ mode: 'puzzle', humanSide: RED, fen: pz.fen, puzzleId: pz.id });
  app.demo = true;
  render();
  const token = app.busyToken;
  while (!app.game.result && app.demo && token === app.busyToken && app.game.records.length < pz.moves * 2) {
    const g = app.game;
    app.thinking = true;
    render();
    let res;
    try {
      res = await engine.think({ startFen: g.startFen, moves: g.records.map(r => r.iccs), level: { ...DEFENSE_LEVEL, timeMs: 1500 } });
    } catch { break; }
    if (token !== app.busyToken || !app.demo) return;
    app.thinking = false;
    if (!res.mv) break;
    playMove(fromIccs(res.mv));
    await new Promise(r => setTimeout(r, 650));
  }
  app.demo = false;
  app.thinking = false;
  render();
  if (app.game.result) toast(`答案演示完毕：${app.game.movetext().replace(/\n/g, ' ')}`, 5000);
}

async function gameOver() {
  const g = app.game;
  const r = g.result;
  render();
  if (app.mode === 'puzzle') {
    const pz = puzzle();
    if (app.demo) return;
    if (r.winner === RED) {
      if (!app.solved.includes(pz.id)) app.solved.push(pz.id);
      save();
      playSound('win');
      const idx = PUZZLES.indexOf(pz);
      const next = PUZZLES[idx + 1];
      const choice = await dialog({
        title: '成功！',
        body: `<p>${esc(pz.name)}：${g.records.filter(x => x.mover === RED).length} 步将死。</p><p class="movetext">${esc(g.movetext())}</p>`,
        buttons: [{ label: '选题', value: 'list' }, ...(next ? [{ label: '下一题', value: 'next', primary: true }] : [{ label: '好', value: null, primary: true }])]
      });
      if (choice === 'next') startPuzzle(next.id);
      else if (choice === 'list') puzzlesDialog();
    } else {
      puzzleFailed();
    }
    return;
  }
  const humanWon = app.mode === 'ai' && r.winner === app.humanSide;
  const humanLost = app.mode === 'ai' && r.winner === (app.humanSide ^ 1);
  playSound(humanLost ? 'lose' : 'win');
  const title = app.mode === 'pvp' ? r.text : humanWon ? '你赢了！' : humanLost ? '电脑获胜' : '和棋';
  const choice = await dialog({
    title,
    body: `<p>${esc(r.text)}，共 ${g.records.length} 步。</p>`,
    buttons: [{ label: '复盘', value: 'review' }, { label: '再来一局', value: 'again', primary: true }]
  });
  if (choice === 'again') startGame({});
  else if (choice === 'review') enterReview(-1);
}

// ---------- review ----------

function enterReview(index) {
  if (app.demo) return;
  stopEngine();
  app.reviewIndex = Math.max(-1, Math.min(index, app.game.records.length - 1));
  app.selected = null;
  app.hint = 0;
  render();
}

function exitReview() {
  app.reviewIndex = null;
  board.setPosition(app.game.pos, { animate: false });
  render();
  maybeEngine();
}

function reviewStep(delta) {
  if (isLive()) enterReview(app.game.records.length - 1 + Math.min(0, delta));
  else {
    const prev = app.reviewIndex;
    app.reviewIndex = Math.max(-1, Math.min(app.game.records.length - 1, app.reviewIndex + delta));
    const rec = app.game.records[app.reviewIndex];
    render(delta === 1 && rec && app.reviewIndex === prev + 1 ? rec.mv : 0);
  }
}

// ---------- menu ----------

function moreMenu(anchor) {
  menu([
    { label: '复制棋谱', action: copyRecord },
    { label: '复制局面（FEN）', action: () => copyText(app.game.pos.toFen(), '已复制局面') },
    { label: '从局面开始…', action: importFen },
    '-',
    { label: '声音', checked: sound.enabled, action: () => { sound.enabled = !sound.enabled; save(); toast(sound.enabled ? '声音已打开' : '声音已关闭'); } },
    { label: '引擎分析', checked: app.showAnalysis, action: () => { app.showAnalysis = !app.showAnalysis; save(); render(); } },
    '-',
    { label: '规则与帮助', action: help }
  ], anchor);
}

async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    dialog({ title: '复制', body: `<textarea class="copybox" readonly>${esc(text)}</textarea>`, buttons: [{ label: '好', value: null, primary: true }], onOpen: el => el.querySelector('textarea').select() });
  }
}

function copyRecord() {
  const g = app.game;
  const head = g.startFen === new Position().toFen() ? '' : `[FEN "${g.startFen}"]\n`;
  const tail = g.result ? `\n${g.result.text}` : '';
  copyText(`${head}${g.movetext()}${tail}`, '已复制棋谱');
}

async function importFen() {
  const res = await dialog({
    title: '从局面开始',
    body: `<p class="note">粘贴 FEN，例如 <code>${START_FEN}</code></p><textarea class="copybox" id="fen-in" spellcheck="false"></textarea>`,
    buttons: [{ label: '取消', value: null }, { label: '开始', primary: true, value: b => b.querySelector('textarea').value.trim() }]
  });
  if (!res) return;
  try {
    new Position(res);
  } catch (e) {
    toast(`局面有误：${e.message}`, 4000);
    return;
  }
  startGame({ mode: app.mode === 'puzzle' ? 'ai' : app.mode, fen: res });
}

function help() {
  dialog({
    title: '规则与帮助',
    className: 'wide',
    body: `<div class="help">
      <p><b>走法</b>：点一下自己的棋子，再点要去的位置；电脑上也可以直接拖动。可以走的位置会显示圆点。</p>
      <p><b>胜负</b>：将死对方，或者对方无子可动（困毙）都算赢。60 回合没有吃子判和。</p>
      <p><b>重复局面</b>：同一局面出现第三次时按最近一轮来判：一直将军的一方“长将”判负；不将军、但每步都在追捉同一个子（或一将一捉）的一方“长捉”判负；长将比长捉更重；双方犯同样的规则或都没犯就判和。</p>
      <p><b>什么算“捉”</b>：走完这步后，新出现了吃掉对方某个子的威胁，而且吃了能得子——那个子没有保护，或者价值比捉它的子高（比如马捉有保护的车）。以下不算：将帅和兵卒去捉；捉对方的将帅或没过河的兵卒；同等子力互相对着、对方也能吃回来（兑子）；原本就存在的威胁。</p>
      <p><b>记谱</b>：红方用中文数字从右往左数路（一到九），黑方用阿拉伯数字。“进”是向对方走，“退”是往回走，“平”是横走。马、相、仕后面的数字是到达的路，车、炮、兵、帅是走的步数。同一路上有两个相同的棋子时用“前”“后”区分。</p>
      <p><b>输入着法</b>：在右边的输入框里输入“炮二平五”“马8进7”或坐标“h2e2”也能走棋。</p>
      <p><b>引擎</b>：迭代加深的 alpha-beta 搜索，带置换表、空着裁剪、静态搜索和开局库，在后台线程计算，不会卡住界面。</p>
    </div>`
  });
}

// ---------- rendering ----------

function viewPosition() {
  const g = app.game;
  if (isLive()) return { pos: g.pos, last: g.records[g.records.length - 1]?.mv || 0 };
  const rec = g.records[app.reviewIndex];
  return { pos: new Position(rec ? rec.fenAfter : g.startFen), last: rec ? rec.mv : 0 };
}

function renderMarks() {
  const { pos, last } = viewPosition();
  const check = pos.inCheck() ? pos.kingSq[pos.side] : null;
  board.setMarks({
    selected: isLive() ? app.selected : null,
    targets: isLive() && app.selected !== null ? targetsFrom(app.selected) : [],
    lastMove: last, hint: isLive() ? app.hint : 0, check
  });
}

function capturedBy(side) {
  return app.game.records.filter((r, i) => r.captured && r.mover === side && (isLive() || i <= app.reviewIndex)).map(r => r.captured);
}

function playerLabel(side) {
  if (app.mode === 'pvp') return SIDE_NAME[side];
  if (app.mode === 'puzzle') return side === RED ? '你（红方）' : '黑方（电脑防守）';
  return side === app.humanSide ? `你（${SIDE_NAME[side]}）` : `电脑 · ${level().name}（${SIDE_NAME[side]}）`;
}

function renderPlayers() {
  const flipped = (app.mode !== 'pvp' && app.humanSide === BLACK) !== app.manualFlip;
  board.setFlipped(flipped);
  const g = app.game;
  const toMove = isLive() ? g.side : (app.reviewIndex >= 0 ? g.records[app.reviewIndex].mover ^ 1 : new Position(g.startFen).side);
  for (const [el, side] of [[$('player-top'), flipped ? RED : BLACK], [$('player-bottom'), flipped ? BLACK : RED]]) {
    const caps = capturedBy(side).sort((a, b) => (a & 7) - (b & 7));
    let status = '';
    if (isLive() && !g.result && toMove === side) {
      if (app.thinking && (side === engineSide() || app.demo)) {
        const d = app.info?.depth ? ` · 深度 ${app.info.depth}` : '';
        status = `<span class="status thinking">思考中${d}</span>`;
      } else status = `<span class="status turn">${app.mode === 'pvp' || side !== app.humanSide ? '走棋' : '轮到你'}</span>`;
    }
    if (g.result && isLive() && g.result.winner === side) status = '<span class="status win">胜</span>';
    el.innerHTML = `<span class="dot ${side === RED ? 'red' : 'black'}"></span><span class="name">${esc(playerLabel(side))}</span>${status}
      <span class="caps">${caps.map(pc => `<span class="cap ${sideOf(pc) === RED ? 'red' : 'black'}">${pieceName(pc)}</span>`).join('')}</span>`;
  }
}

function renderMoves() {
  const g = app.game;
  const list = $('moves');
  const cur = isLive() ? g.records.length - 1 : app.reviewIndex;
  let html = '';
  let num = 1;
  const firstBlack = g.records[0]?.mover === BLACK;
  for (let i = 0; i < g.records.length;) {
    let row = `<li><span class="n">${num}.</span>`;
    if (i === 0 && firstBlack) row += '<span class="mv empty">……</span>';
    else { row += moveBtn(i, cur); i++; }
    if (i < g.records.length && g.records[i].mover === BLACK) { row += moveBtn(i, cur); i++; }
    html += `${row}</li>`;
    num++;
  }
  if (!g.records.length) html = '<li class="empty-note">还没有着法</li>';
  if (g.result) html += `<li class="result">${esc(g.result.text)}</li>`;
  list.innerHTML = html;
  // Keep the current move visible inside the list without scrolling the page.
  const curEl = list.querySelector('.mv.current');
  if (curEl) {
    const top = curEl.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + curEl.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - list.clientHeight / 2;
  }
  $('opening').textContent = app.opening;
}

function moveBtn(i, cur) {
  const r = app.game.records[i];
  return `<button class="mv${i === cur ? ' current' : ''}${r.check ? ' check' : ''}" data-ply="${i}">${esc(r.notation)}</button>`;
}

function scoreText(info) {
  if (!info || info.depth === undefined) return '';
  const red = info.side === RED ? info.score : -info.score;
  if (Math.abs(red) > WIN) {
    const plies = MATE - Math.abs(red);
    return `${red > 0 ? '红' : '黑'}方 ${Math.ceil(plies / 2)} 步杀`;
  }
  const v = (red / 100).toFixed(1);
  return red === 0 ? '均势 0.0' : `${red > 0 ? '红优' : '黑优'} ${red > 0 ? '+' : ''}${v}`;
}

function pvText(info) {
  if (!info?.pv?.length) return '';
  const g = app.game;
  // The line starts from the position the search was given, which may be a move or two back.
  if (info.ply === undefined || info.ply > g.records.length) return '';
  const p = new Position(g.startFen);
  for (const r of g.records.slice(0, info.ply)) p.makeMove(r.mv);
  const out = [];
  for (const m of info.pv) {
    const mv = fromIccs(m);
    if (!p.isPseudoLegalFast(mv)) break;
    const t = toChinese(p, mv);
    if (!p.makeMove(mv)) break;
    out.push(t);
  }
  return out.join(' ');
}

function renderAnalysis() {
  const box = $('analysis');
  $('show-analysis').checked = app.showAnalysis;
  box.classList.toggle('off', !app.showAnalysis);
  const body = $('analysis-body');
  if (!app.showAnalysis) { body.innerHTML = ''; return; }
  const i = app.info;
  if (!i) { body.innerHTML = '<p class="note">电脑思考或点“提示”时，这里显示它的计算。</p>'; return; }
  if (i.book) { body.innerHTML = `<p>开局库：<b>${esc(i.book)}</b></p>`; return; }
  const nps = i.timeMs ? Math.round(i.nodes / (i.timeMs / 1000)) : 0;
  body.innerHTML = `<div class="stats"><span>${esc(scoreText(i))}</span><span>深度 ${i.depth}</span><span>${(i.nodes / 1000).toFixed(0)}k 节点</span>${nps ? `<span>${Math.round(nps / 1000)}k/秒</span>` : ''}</div>
    <p class="pv">${esc(pvText(i))}</p>`;
}

// Persistent status goes in the title; the over-the-board pill only flashes for checks.
let flashTimer = 0;
let flashedPly = -1;
function renderBanner() {
  const g = app.game;
  const title = document.querySelector('.title');
  if (app.mode === 'puzzle' && puzzle()) {
    const pz = puzzle();
    const used = g.records.filter(r => r.mover === RED).length;
    title.textContent = app.demo ? `答案演示 · ${pz.name}` : g.result ? `${pz.name} · ${g.result.winner === RED ? '成功' : '未完成'}` : `${pz.name} · 第 ${Math.min(used + 1, pz.moves)}/${pz.moves} 步`;
  } else {
    title.textContent = g.result && isLive() ? g.result.text : '中国象棋';
  }
  const el = $('banner');
  const last = g.records[g.records.length - 1];
  if (isLive() && last?.check && !g.result && flashedPly !== g.records.length) {
    flashedPly = g.records.length;
    el.textContent = '将军！';
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.hidden = true; }, 1200);
  } else if (!last?.check || !isLive()) {
    el.hidden = true;
  }
}

function render(animateMv = 0) {
  const { pos } = viewPosition();
  board.setPosition(pos, { mv: animateMv, animate: !!animateMv });
  renderPlayers();
  renderMarks();
  renderMoves();
  renderAnalysis();
  renderBanner();
  const live = isLive();
  $('controls').hidden = !live;
  $('review').hidden = live;
  if (!live) $('review-label').textContent = app.reviewIndex < 0 ? '开局' : `第 ${app.reviewIndex + 1} / ${app.game.records.length} 手`;
  const ctl = $('controls');
  ctl.querySelector('[data-cmd=move-now]').hidden = !(app.thinking && app.mode !== 'pvp' && app.game.side === engineSide());
  ctl.querySelector('[data-cmd=hint]').hidden = app.thinking && app.game.side === engineSide();
  ctl.querySelector('[data-cmd=resign]').hidden = app.mode === 'puzzle';
  ctl.querySelector('[data-cmd=undo]').disabled = !app.game.records.length || app.demo;
  $('move-input').hidden = !live;
}

function recomputeOpening() {
  app.opening = '';
  const p = new Position(app.game.startFen);
  for (const r of app.game.records) {
    const b = bookMoves(p).find(e => e.mv === r.mv);
    if (b) app.opening = b.name;
    p.makeMove(r.mv);
  }
}

// ---------- wiring ----------

const COMMANDS = {
  new: () => newGameDialog(),
  puzzles: () => puzzlesDialog(),
  menu: el => moreMenu(el),
  undo, hint, flip, resign,
  'move-now': moveNow,
  'review-first': () => { if (isLive()) enterReview(-1); else { app.reviewIndex = -1; render(); } },
  'review-prev': () => reviewStep(-1),
  'review-next': () => reviewStep(1),
  'review-last': () => { if (!isLive()) { app.reviewIndex = app.game.records.length - 1; render(); } },
  'review-exit': () => exitReview()
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  if (b && !b.disabled) COMMANDS[b.dataset.cmd]?.(b);
  const mv = e.target.closest('[data-ply]');
  if (mv) enterReview(Number(mv.dataset.ply));
});

$('show-analysis').addEventListener('change', e => { app.showAnalysis = e.target.checked; save(); render(); });

$('move-input').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('move-text');
  const text = input.value.trim();
  if (!text) return;
  if (!humanToMove() || app.thinking) { toast('现在不能走棋'); return; }
  const g = app.game;
  const mv = /^[a-i]\d-?[a-i]\d$/i.test(text) ? fromIccs(text) : fromChinese(g.pos, text);
  if (mv === null || !g.legalMoves().includes(mv)) { toast(`“${text}”不是合法着法`); return; }
  input.value = '';
  playMove(mv);
  afterMove();
});

document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea') || document.querySelector('.modal-back')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); reviewStep(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); if (!isLive()) reviewStep(1); }
  else if (e.key === 'Escape') { if (!isLive()) exitReview(); else select(null); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
});

// ---------- boot ----------

load();
recomputeOpening();
board.setPosition(app.game.pos, { animate: false });
render();
maybeEngine();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

window.__xq = { app, board, engine, startGame, startPuzzle, PUZZLES };

export { typeOf, sideTag };
