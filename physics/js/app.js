// 造物 — the app: one world, a camera, tools, playback with a fixed time step, undo, rewind, levels.

import { buildWorld, saveScene, addBody, addJointBetween, setMaterial } from './engine/scene.js';
import { ropePieces } from './engine/build.js';
import { MATERIALS, MATERIAL_KEYS, material } from './engine/materials.js';
import { Recorder } from './engine/recorder.js';
import { WATER } from './engine/fluid.js';
import { DEMOS, demo } from './engine/demos.js';
import { allLevels, level as getLevel } from './engine/levels.js';
import { LevelRun, levelScene, usage, placementProblem } from './engine/level-run.js';
import { Camera } from './ui/camera.js';
import { Renderer, readTheme } from './ui/renderer.js';
import { Input, isTyping } from './ui/input.js';
import { makeTools, TOOL_ORDER, TOOL_INFO } from './ui/tools.js';
import { Sound } from './ui/sound.js';
import { encodeScene, decodeScene, shareURL, readHash } from './ui/share.js';
import * as store from './ui/storage.js';
import { applyIcons, icon } from './ui/icons.js';
import { $, h, toast, openDialog, closeDialog, dialogOpen, initDialog, openMenu, closeMenu } from './ui/ui.js';

const STEP = 1 / 60;
const MAX_HISTORY = 60;
const BLANK = { v: 1, g: [0, -10], bodies: [{ shape: { t: 'box', w: 80, h: 1 }, x: 0, y: -0.5, a: 0, m: 'stone', fixed: true }], joints: [] };
const SHAPE_NAMES = { circle: '圆', box: '方块', poly: '多边形', line: '线条' };
const JOINT_NAMES = { pin: '钉子', spring: '弹簧', rod: '连杆', weld: '粘合', rope: '绳子' };
const LIMIT_NAMES = { shapes: '形状', pins: '钉子', motors: '马达', ropes: '绳子', springs: '弹簧', welds: '粘合', water: '水' };
const TOOL_LIMIT = { pin: 'pins', motor: 'motors', rope: 'ropes', spring: 'springs', weld: 'welds', water: 'water' };
const params = new URLSearchParams(location.search);
const TOOL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
// where new drops go around the pointer, in units of the drop spacing
const POUR_PATTERN = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];

class App {
  constructor() {
    this.canvas = $('#stage');
    this.camera = new Camera();
    this.renderer = new Renderer(this.canvas, this.camera);
    this.sound = new Sound();
    this.recorder = new Recorder();
    this.world = buildWorld(BLANK);
    this.running = false;
    this.slow = false;
    this.acc = 0;
    this.last = performance.now();
    this.tool = 'draw';
    this.material = 'wood';
    this.fixedNew = false;
    this.selection = null;
    this.preview = null;
    this.history = [];
    this.future = [];
    this.editOpen = false;
    this.startScene = null;
    this.dirty = false;
    this.scrubIndex = null;
    this.needsRender = true;
    this.mode = 'sandbox';
    this.level = null;
    this.levelPhase = null;
    this.levelRun = null;
    this.levelEditScene = null;
    this.settings = { sound: true, tilt: false, debug: false, ...store.load('settings', {}) };
    this.settings.tilt = false; // needs a fresh permission each visit
    this.sound.enabled = this.settings.sound;
    this.renderer.debug = this.settings.debug;
    this.progress = store.load('progress', {});
    this.tools = makeTools(this);
    this.input = new Input(this.canvas, this);
    this.frame = this.frame.bind(this);
  }

  // ---------- startup ----------

  async init() {
    initDialog();
    this.buildToolbar();
    this.buildMatbar();
    this.wireCommands();
    this.wireKeys();
    applyIcons();
    this.resize();
    addEventListener('resize', () => this.resize());
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { this.renderer.theme = null; this.invalidate(); });
    addEventListener('pagehide', () => this.saveNow());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); });
    $('#scrub').addEventListener('input', e => this.scrub(Number(e.target.value)));
    $('#file-input').addEventListener('change', e => this.importFile(e.target.files[0]));

    const fresh = params.has('fresh');
    const code = readHash();
    let loaded = false;
    if (code) {
      try {
        const scene = await decodeScene(code);
        this.loadScene(scene, scene.view);
        toast('已打开分享的作品');
        loaded = true;
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        toast('链接里的作品打不开，可能不完整');
      }
    }
    if (!loaded && params.get('level') && getLevel(params.get('level'))) {
      this.loadScene(BLANK);
      this.enterLevel(params.get('level'));
      loaded = true;
    }
    if (!loaded && params.get('demo') && demo(params.get('demo'))) {
      this.loadDemo(params.get('demo'));
      loaded = true;
    }
    if (!loaded && params.has('blank')) {
      this.loadScene(BLANK, { x: 0, y: 5, w: 24 });
      loaded = true;
    }
    if (!loaded && !fresh) {
      const saved = store.load('sandbox');
      if (saved && saved.scene) {
        try {
          this.loadScene(saved.scene);
          if (saved.cam) Object.assign(this.camera, saved.cam);
          loaded = true;
        } catch { /* broken save: fall through */ }
      }
    }
    if (!loaded) {
      this.loadDemo('tower');
      if (!fresh && !store.load('welcomed')) {
        store.save('welcomed', true);
        setTimeout(() => toast('按「播放」看铁球拆楼；选个工具在画布上画画试试', 4200), 600);
      }
    }
    this.setTool(this.mode === 'level' ? this.tool : 'draw');
    requestAnimationFrame(this.frame);
  }

  resize() {
    this.renderer.resize();
    this.renderer.theme = null;
    this.invalidate();
  }

  // Screen space covered by the floating panels, so a view is framed in the free area.
  insets() {
    const top = ($('.topbar').getBoundingClientRect().bottom || 60) + (this.mode === 'level' ? 92 : 6);
    const tb = $('#toolbar').getBoundingClientRect();
    const phone = innerWidth <= 760;
    const bottomPanels = phone ? tb.height + 60 : 64;
    return { top, left: phone ? 0 : tb.right + 4, right: 0, bottom: bottomPanels };
  }

  fitView(view) {
    if (!view) return;
    if (view.scale) { Object.assign(this.camera, { x: view.x, y: view.y, scale: view.scale }); return; }
    this.camera.fit(view, this.insets());
    this.invalidate();
  }

  // ---------- scenes ----------

  // Replace the world with a scene. Clears selection, rewind and playback state.
  setWorld(world) {
    if (this.tools[this.tool]?.cancel) this.tools[this.tool].cancel();
    this.world = world;
    this.selection = null;
    this.recorder.clear();
    this.scrubIndex = null;
    this.renderInspector();
    this.updateChrome();
    this.invalidate();
  }

  loadScene(scene, view) {
    this.pause();
    this.setWorld(buildWorld(scene));
    this.history = [];
    this.future = [];
    this.startScene = null;
    this.dirty = false;
    if (view) this.fitView(view);
    if (this.settings.tilt && this.mode === 'sandbox') this.applyTilt();
  }

  loadDemo(id) {
    const d = demo(id);
    if (this.mode === 'level') this.exitLevel(false);
    this.loadScene(d.build(), d.view);
    this.scheduleSave();
    toast(`${d.name}：${d.desc}`, 3600);
  }

  snapshot() {
    return JSON.stringify(saveScene(this.world));
  }

  // ---------- editing API (used by tools) ----------

  beginEdit() {
    if (this.editOpen) return;
    this.history.push(this.snapshot());
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.future = [];
    this.editOpen = true;
  }

  dropEdit() {
    if (!this.editOpen) return;
    this.history.pop();
    this.editOpen = false;
    this.invalidate();
  }

  committed() {
    this.editOpen = false;
    this.dirty = true;
    this.recorder.clear();
    this.scrubIndex = null;
    this.scheduleSave();
    this.renderInspector();
    this.updateChrome();
    this.invalidate();
  }

  undo() {
    if (this.levelPhase === 'run') return;
    if (this.levelMode && this.levelPhase !== 'edit') this.levelStop(); // showing a result: back to editing first
    if (!this.history.length) { toast('没有可以撤销的了'); return; }
    this.pause();
    this.future.push(this.snapshot());
    this.setWorld(buildWorld(JSON.parse(this.history.pop())));
    this.dirty = true;
    this.scheduleSave();
  }

  redo() {
    if (this.levelPhase === 'run') return;
    if (this.levelMode && this.levelPhase !== 'edit') this.levelStop(); // showing a result: back to editing first
    if (!this.future.length) { toast('没有可以重做的了'); return; }
    this.pause();
    this.history.push(this.snapshot());
    this.setWorld(buildWorld(JSON.parse(this.future.pop())));
    this.dirty = true;
    this.scheduleSave();
  }

  get levelMode() {
    return this.mode === 'level';
  }

  get levelRunning() {
    return this.levelMode && this.levelPhase !== 'edit';
  }

  editable(b) {
    return !(this.levelMode && (b.locked || this.levelPhase !== 'edit'));
  }

  limitReached(kind) {
    if (!this.levelMode) return null;
    if (this.levelPhase !== 'edit') return '先按「重来」回到摆放状态';
    const key = kind === 'shape' ? 'shapes' : TOOL_LIMIT[kind];
    const max = this.level.limits[key] ?? 0;
    if (usage(this.world, this.level)[key] >= max) {
      if (key === 'water') return max ? '这一关的水用完了' : '这一关不能倒水';
      return max ? `这一关最多用 ${max} 个${LIMIT_NAMES[key]}` : `这一关不能用${LIMIT_NAMES[key]}`;
    }
    return null;
  }

  // Add water around (x, y) where there is room (so holding still doesn't pile drops on top of each other).
  // Returns how many drops were added.
  pour(x, y, vx, vy, max = 4) {
    const f = this.world.fluid, s = WATER.spacing;
    let added = 0;
    for (const [ox, oy] of POUR_PATTERN) {
      if (added >= max || this.limitReached('water')) break;
      const px = x + ox * s, py = y + oy * s;
      if (f.occupied(px, py, s * 0.9)) continue;
      if (this.world.bodiesAt(px, py).length) continue;
      if (!f.add(px, py, vx, vy)) { if (!added) toast('水太多了，先擦掉一些'); break; }
      added++;
    }
    if (added) this.invalidate();
    return added;
  }

  eraseWater(x, y, r) {
    if (this.levelMode && this.levelPhase !== 'edit') return 0;
    if (this.levelMode && this.level.scene.water) return 0; // the level's own water stays
    const n = this.world.fluid.removeInCircle(x, y, r);
    if (n) this.invalidate();
    return n;
  }

  addShape(spec) {
    const limit = this.limitReached('shape');
    if (limit) { toast(limit); this.invalidate(); return null; }
    spec.m = this.material;
    if (this.fixedNew && !this.levelMode) spec.fixed = true;
    this.beginEdit();
    const b = addBody(this.world, spec);
    if (this.levelMode) {
      const problem = placementProblem(this.world, b, this.level);
      if (problem) {
        this.world.destroyBody(b);
        this.dropEdit();
        toast(problem);
        return null;
      }
    }
    this.flash(b);
    this.committed();
    return b;
  }

  addJoint(spec, A, B, kind) {
    const limit = this.limitReached(kind);
    if (limit) { toast(limit); return null; }
    if (this.levelMode && kind !== 'spring' && B.locked && (A === this.world.ground || A.locked)) {
      toast('只能钉你自己画的东西');
      return null;
    }
    this.beginEdit();
    const j = addJointBetween(this.world, spec, A, B);
    this.committed();
    if (j && kind === 'motor') toast('马达装好了：选中它可以改转速和方向', 2600);
    return j;
  }

  addRope(p0, A, p1, B) {
    const limit = this.limitReached('rope');
    if (limit) { toast(limit); return; }
    const pieces = ropePieces(p0, p1);
    if (!pieces) return;
    this.beginEdit();
    const rid = 1 + Math.max(0, ...this.world.bodies.map(b => b.ropeId || 0));
    const links = pieces.bodies.map(s => addBody(this.world, { ...s, rid }));
    const pick = r => (r === 'start' ? A : r === 'end' ? B : links[r]);
    const ground = this.world.ground;
    for (const j of pieces.joints) {
      const a = pick(j.a), b = pick(j.b);
      if (j.t === 'pin') {
        const la = a.toLocal(j.p.x, j.p.y), lb = b.toLocal(j.p.x, j.p.y);
        addJointBetween(this.world, { t: 'pin', la: [la.x, la.y], lb: [lb.x, lb.y], ref: b.angle - a.angle, rope: j.rope }, a, b);
      } else if (!((a === ground || a.isStatic) && (b === ground || b.isStatic))) {
        const la = a.toLocal(j.pa.x, j.pa.y), lb = b.toLocal(j.pb.x, j.pb.y);
        addJointBetween(this.world, { t: 'rope', la: [la.x, la.y], lb: [lb.x, lb.y], len: j.len, rid }, a, b);
      }
    }
    this.committed();
  }

  removeBody(b) {
    if (b.ropeId) {
      for (const j of this.world.joints.slice()) if (j.ropeId === b.ropeId) this.world.destroyJoint(j);
    }
    for (const j of b.joints) if (this.selection?.joint === j) this.selection = null;
    if (this.selection?.body === b) this.selection = null;
    this.world.destroyBody(b);
  }

  removeJoint(j) {
    if (this.selection?.joint === j) this.selection = null;
    this.world.destroyJoint(j);
  }

  deleteSelection() {
    const s = this.selection;
    if (!s || this.levelRunning) return;
    if (s.body && !this.editable(s.body)) return;
    if (s.joint && this.levelMode && s.joint.locked) return;
    this.beginEdit();
    if (s.body) this.removeBody(s.body);
    else this.removeJoint(s.joint);
    this.selection = null;
    this.committed();
  }

  // Topmost body under a world point (not the background).
  pickBody(x, y, forErase = false) {
    const list = this.world.bodiesAt(x, y, b => (this.levelMode ? !b.locked : true));
    if (forErase && this.levelMode && this.levelPhase !== 'edit') return null;
    return list[0] || null;
  }

  bodiesAt(x, y) {
    return this.world.bodiesAt(x, y);
  }

  // The joint drawn nearest to a screen point (within a finger's reach).
  pickJoint(sx, sy, forErase = false) {
    const cam = this.camera;
    const reach = this.input.pointers.size && [...this.input.pointers.values()][0].pointerType === 'touch' ? 18 : 12;
    let best = null, bestD = reach;
    for (const j of this.world.joints) {
      if (!j.kind || j.rope || j.kind === 'rope') continue;
      if (this.levelMode && (j.locked || (forErase && this.levelPhase !== 'edit'))) continue;
      const b = cam.toScreen(...Object.values(j.worldAnchorB()));
      let d;
      if (j.kind === 'spring' || j.kind === 'rod') {
        const a = cam.toScreen(...Object.values(j.worldAnchorA()));
        d = segDist(sx, sy, a.x, a.y, b.x, b.y);
      } else d = Math.hypot(sx - b.x, sy - b.y);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  }

  // Bodies linked by joints (not through the background or fixed bodies) move together in the editor.
  connectedGroup(b) {
    const out = new Set([b]), stack = [b];
    while (stack.length) {
      const x = stack.pop();
      for (const j of x.joints) {
        if (j.type === 'mouse') continue;
        const o = j.bodyA === x ? j.bodyB : j.bodyA;
        if (o === this.world.ground || o.isStatic || out.has(o) || !this.editable(o)) continue;
        out.add(o);
        stack.push(o);
      }
    }
    return [...out];
  }

  checkMove(bodies) {
    if (!this.levelMode) return null;
    for (const b of bodies) {
      if (b.tag === 'link') continue;
      const p = placementProblem(this.world, b, this.level);
      if (p) return p;
    }
    return null;
  }

  shapeColor() {
    return this.fixedNew && !this.levelMode ? readTheme().static : material(this.material).color;
  }

  flash(b) {
    const bb = b.bounds();
    this.renderer.addEffect({ kind: 'spark', x: (bb.minX + bb.maxX) / 2, y: bb.maxY, n: 3, dir: Math.PI / 2, size: 0.6, life: 260, color: material(b.mat).color });
  }

  explode(x, y) {
    if (this.levelRunning) return;
    this.world.explode(x, y, 4, 12);
    this.renderer.addEffect({ kind: 'boom', x, y, r: 4, life: 450 });
    this.sound.boom();
    if (!this.running) this.play();
  }

  select(sel) {
    this.selection = sel;
    this.renderInspector();
    this.invalidate();
  }

  setDragging(on) {
    this.canvas.classList.toggle('dragging', on);
  }

  invalidate() {
    this.needsRender = true;
  }

  toast(msg) {
    toast(msg);
  }

  // ---------- tool dispatch ----------

  toolDown(p) {
    closeMenu();
    if (this.scrubIndex != null && this.tool !== 'hand') this.commitScrub();
    this.tools[this.tool].down(p);
    this.invalidate();
  }

  toolMove(p) {
    this.tools[this.tool].move(p);
  }

  toolUp(p) {
    this.tools[this.tool].up(p);
    this.invalidate();
  }

  toolCancel() {
    this.tools[this.tool].cancel?.();
    this.preview = null;
    this.invalidate();
  }

  setTool(id) {
    if (!this.tools[id]) return;
    if (this.levelMode && !this.levelTools().includes(id)) return;
    this.tools[this.tool]?.cancel?.();
    this.tool = id;
    for (const b of document.querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    this.canvas.className = `tool-${id}`;
    $('#matbar').hidden = !['draw', 'box', 'circle'].includes(id);
    this.invalidate();
  }

  levelTools() {
    return ['hand', ...this.level.tools, 'eraser'];
  }

  // ---------- playback ----------

  play() {
    this.sound.unlock();
    if (this.levelMode) { this.levelStart(); return; }
    if (this.running) return;
    if (this.scrubIndex != null) this.commitScrub();
    if (!this.startScene || this.dirty) {
      this.startScene = this.snapshot();
      this.dirty = false;
      this.recorder.clear();
    }
    this.running = true;
    this.acc = 0;
    this.select(null);
    this.updateChrome();
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    this.updateChrome();
    this.saveNow();
  }

  toggle() {
    if (this.levelMode) {
      if (this.levelPhase === 'edit') this.levelStart();
      else this.levelStop();
      return;
    }
    if (this.running) this.pause();
    else this.play();
  }

  reset() {
    if (this.levelMode) { this.levelStop(); return; }
    if (!this.startScene) { toast('还没有播放过'); return; }
    this.pause();
    this.setWorld(buildWorld(JSON.parse(this.startScene)));
    this.dirty = false;
    this.applyTilt();
    this.scheduleSave();
  }

  stepOnce() {
    if (this.levelRun) {
      const r = this.levelRun.step();
      this.afterStep();
      if (r) this.levelFinished(r);
      return;
    }
    this.world.step(STEP);
    this.afterStep();
    this.recorder.record(this.world);
  }

  singleStep() {
    if (this.levelMode) return;
    if (this.running) this.pause();
    if (!this.startScene || this.dirty) { this.startScene = this.snapshot(); this.dirty = false; }
    if (this.scrubIndex != null) this.commitScrub();
    this.stepOnce();
    this.updateChrome();
    this.invalidate();
  }

  afterStep() {
    const imp = this.world.impacts;
    for (let i = 0; i < imp.length; i++) {
      const e = imp[i];
      const a = e.a.body, b = e.b.body;
      const mover = a.isStatic ? b : b.isStatic ? a : a.mass < b.mass ? a : b;
      const other = mover === a ? b : a;
      const loud = material(mover.mat).sound === 'rubber' ? material(other.mat).sound : material(mover.mat).sound;
      this.sound.impact(loud, e.speed, mover.extent * 2);
      if (e.speed > 6 && i < 3) this.renderer.addEffect({ kind: 'spark', x: e.x, y: e.y, n: 4, dir: Math.random() * Math.PI * 2, size: Math.min(2, e.speed / 8), life: 320 });
    }
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.running) {
      this.acc += dt * (this.slow ? 0.25 : 1);
      let n = 0;
      while (this.acc >= STEP && n < 4 && this.running) {
        this.stepOnce();
        this.acc -= STEP;
        n++;
      }
      if (n === 4) this.acc = Math.min(this.acc, STEP);
      this.needsRender = true;
      if (this.settings.debug) this.updateStats();
      if (this.levelMode) this.updateChrome();
      if (this.recorder.length && (this.stepCounter = (this.stepCounter || 0) + 1) % 15 === 0) this.updateTimeline();
    }
    if (this.input.active != null) this.tools[this.tool].tick?.(dt);
    const animating = this.renderer.effects.length || this.levelMode || this.world.joints.some(j => j.enableMotor);
    if (!this.needsRender && !animating) return;
    this.needsRender = false;
    this.renderer.render({
      world: this.world,
      alpha: this.running ? Math.min(1, this.acc / STEP) : 1,
      selection: this.selection,
      preview: this.preview,
      level: this.levelMode ? this.level : null,
      time: now / 1000
    });
  }

  updateStats() {
    const el = $('#stats');
    const w = this.world;
    el.textContent = `物体 ${w.bodies.length}  醒着 ${w.stats.awake}  水 ${w.fluid.n}\n接触 ${w.stats.contacts}  关节 ${w.joints.length}\n每步 ${w.stats.ms.toFixed(2)} 毫秒  树高 ${w.tree.height()}`;
  }

  // ---------- rewind ----------

  updateTimeline() {
    const tl = $('#timeline');
    const show = !this.running && !this.levelMode && this.recorder.length > 1;
    tl.hidden = !show;
    if (!show) return;
    const s = $('#scrub');
    s.max = String(this.recorder.length - 1);
    if (this.scrubIndex == null) s.value = s.max;
    this.updateScrubLabel();
  }

  updateScrubLabel() {
    const i = this.scrubIndex ?? this.recorder.length - 1;
    const back = this.recorder.times[this.recorder.length - 1] - this.recorder.times[i];
    $('#scrub-time').textContent = back > 0.01 ? `−${back.toFixed(1)} 秒` : '现在';
  }

  scrub(i) {
    if (this.running) this.pause();
    if (!this.recorder.restore(this.world, i)) return;
    this.scrubIndex = i;
    this.updateScrubLabel();
    this.invalidate();
  }

  commitScrub() {
    if (this.scrubIndex != null && this.scrubIndex < this.recorder.length - 1) this.recorder.truncate(this.scrubIndex);
    this.scrubIndex = null;
  }

  // ---------- levels ----------

  enterLevel(id) {
    const lvl = getLevel(id);
    if (!lvl) return;
    if (this.mode === 'sandbox') {
      this.saveNow();
      this.sandboxCam = { x: this.camera.x, y: this.camera.y, scale: this.camera.scale };
    }
    this.pause();
    this.mode = 'level';
    this.level = lvl;
    this.levelPhase = 'edit';
    this.levelRun = null;
    this.world.setGravity(0, -10);
    this.loadScene(lvl.scene);
    this.buildToolbar();
    this.buildMatbar();
    this.setTool(lvl.tools[0]);
    this.material = 'wood';
    this.updateMatbar();
    $('#level-hud').hidden = false;
    this.updateChrome();
    this.fitView(lvl.view);
  }

  exitLevel(restore = true) {
    if (!this.levelMode) return;
    this.pause();
    this.mode = 'sandbox';
    this.level = null;
    this.levelPhase = null;
    this.levelRun = null;
    $('#level-hud').hidden = true;
    this.buildToolbar();
    this.buildMatbar();
    this.setTool('draw');
    if (restore) {
      const saved = store.load('sandbox');
      this.loadScene(saved?.scene || BLANK);
      if (this.sandboxCam) Object.assign(this.camera, this.sandboxCam);
      else this.fitView({ x: 0, y: 5, w: 30 });
    }
    this.updateChrome();
  }

  levelStart() {
    if (!this.levelMode || this.levelPhase !== 'edit') return;
    this.tools[this.tool]?.cancel?.();
    this.levelEditScene = saveScene(this.world);
    this.levelRun = new LevelRun(this.level, this.levelEditScene);
    this.world = this.levelRun.world;
    this.levelPhase = 'run';
    this.running = true;
    this.acc = 0;
    this.select(null);
    this.updateChrome();
  }

  levelStop() {
    if (!this.levelMode || this.levelPhase === 'edit') return;
    clearTimeout(this.lostTimer);
    this.running = false;
    this.levelRun = null;
    this.levelPhase = 'edit';
    this.setWorld(buildWorld(this.levelEditScene));
    this.updateChrome();
  }

  levelFinished(result) {
    this.running = false;
    this.levelPhase = result;
    this.updateChrome();
    if (result === 'won') {
      const used = usage(buildWorld(this.levelEditScene), this.level).shapes;
      const prev = this.progress[this.level.id];
      if (!prev || !prev.done || used < prev.shapes) this.progress[this.level.id] = { done: true, shapes: used };
      store.save('progress', this.progress);
      const g = this.level.goal;
      this.renderer.addEffect({ kind: 'win', x: g.x, y: g.y, life: 1200 });
      this.sound.chime();
      setTimeout(() => this.showWin(used), 700);
    } else {
      toast('没成功……调整一下再试', 2000);
      this.lostTimer = setTimeout(() => { if (this.levelPhase === 'lost') this.levelStop(); }, 1300);
    }
  }

  showWin(used) {
    const levels = allLevels();
    const i = levels.indexOf(this.level);
    const next = levels[i + 1];
    const body = h('div', {},
      h('p', {}, `用了 ${used} 个形状，${(this.levelRun?.steps * STEP || 0).toFixed(1)} 秒送进了终点。`),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', onclick: () => { closeDialog(); this.levelStop(); } }, '再玩一次'),
        h('button', { class: 'btn', onclick: () => { closeDialog(); this.openLevels(); } }, '选关'),
        next ? h('button', { class: 'btn primary', autofocus: true, onclick: () => { closeDialog(); this.enterLevel(next.id); } }, '下一关') :
          h('button', { class: 'btn primary', autofocus: true, onclick: () => { closeDialog(); this.exitLevel(); } }, '全部通关！回到沙盒')));
    openDialog(`过关：${this.level.name}`, body);
  }

  showSolution() {
    const body = h('div', {},
      h('p', {}, '会把参考答案摆到画布上（会替换你现在摆的东西）。答案不唯一，也可以先自己想想。'),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', onclick: closeDialog }, '再想想'),
        h('button', { class: 'btn primary', onclick: () => {
          closeDialog();
          if (this.levelPhase !== 'edit') this.levelStop();
          this.beginEdit();
          this.setWorld(buildWorld(levelScene(this.level, this.level.solution())));
          this.committed();
          toast('这是一种解法，按「开始」看看');
        } }, '看答案')));
    openDialog('参考答案', body);
  }

  clearLevel() {
    if (!this.levelMode) return;
    if (this.levelPhase !== 'edit') this.levelStop();
    this.beginEdit();
    for (const j of this.world.joints.slice()) if (!j.locked) this.world.destroyJoint(j);
    for (const b of this.world.bodies.slice()) if (!b.locked) this.world.destroyBody(b);
    this.committed();
  }

  // ---------- chrome: toolbar, materials, inspector, HUD ----------

  buildToolbar() {
    const bar = $('#toolbar');
    const ids = this.levelMode ? TOOL_ORDER.filter(t => this.levelTools().includes(t)) : TOOL_ORDER;
    bar.replaceChildren(...ids.map((id, i) => {
      const b = h('button', { class: 'tool', 'data-tool': id, 'aria-pressed': 'false', title: `${TOOL_INFO[id].name}（${(i + 1) % 10}）：${TOOL_INFO[id].tip}`, 'aria-label': TOOL_INFO[id].name });
      b.innerHTML = `${icon(id)}<span>${TOOL_INFO[id].name}</span>`;
      b.addEventListener('click', () => {
        this.setTool(id);
        toast(TOOL_INFO[id].tip, 2600);
      });
      return b;
    }));
    for (const b of bar.querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === this.tool));
  }

  buildMatbar() {
    const bar = $('#matbar');
    const chips = MATERIAL_KEYS.map(k => {
      const m = MATERIALS[k];
      const c = h('button', { class: 'chip', role: 'radio', 'data-mat': k, 'aria-checked': 'false', title: `${m.name}：密度 ${m.density}，摩擦 ${m.friction}，弹性 ${m.restitution}` },
        h('span', { class: 'swatch', style: `background:${m.color}` }), m.name);
      c.addEventListener('click', () => { this.material = k; this.fixedNew = false; this.updateMatbar(); });
      return c;
    });
    const items = [...chips];
    if (!this.levelMode) {
      const fixed = h('button', { class: 'chip fixed-toggle', role: 'checkbox', 'aria-checked': 'false', title: '新画的东西固定在原地，不会掉下去' }, h('span', { class: 'swatch' }), '固定');
      fixed.addEventListener('click', () => { this.fixedNew = !this.fixedNew; this.updateMatbar(); });
      items.push(h('span', { class: 'sep' }), fixed);
    }
    bar.replaceChildren(...items);
    this.updateMatbar();
  }

  updateMatbar() {
    for (const c of document.querySelectorAll('#matbar [data-mat]')) c.setAttribute('aria-checked', String(c.dataset.mat === this.material && !this.fixedNew));
    const f = $('#matbar .fixed-toggle');
    if (f) f.setAttribute('aria-checked', String(this.fixedNew));
  }

  updateChrome() {
    const app = $('#app');
    const running = this.running || (this.levelMode && this.levelPhase === 'run');
    app.classList.toggle('running', running);
    const label = this.levelMode ? (this.levelPhase === 'edit' ? '开始' : '重来') : running ? '暂停' : '播放';
    $('.play-label').textContent = label;
    $('#play').setAttribute('aria-label', label);
    if (this.levelMode) app.classList.toggle('running', this.levelPhase !== 'edit');
    $('[data-cmd="slow"]').setAttribute('aria-pressed', String(this.slow));
    for (const b of document.querySelectorAll('[data-cmd="step"], [data-cmd="slow"]')) b.disabled = this.levelMode;
    if (this.levelMode) {
      const lvl = this.level, u = usage(this.world, lvl);
      $('#hud-name').textContent = `第 ${allLevels().indexOf(lvl) + 1} 关 · ${lvl.name}`;
      $('#hud-hint').textContent = lvl.hint;
      $('#hud-usage').textContent = Object.entries(lvl.limits).map(([k, max]) => k === 'water' ? `水 ${Math.round(100 * Math.min(u[k], max) / max)}%` : `${LIMIT_NAMES[k]} ${Math.min(u[k], max)}/${max}`).join(' · ');
    }
    $('#stats').hidden = !this.settings.debug;
    if (this.settings.debug) this.updateStats();
    this.updateTimeline();
  }

  renderInspector() {
    const el = $('#inspector');
    const s = this.selection;
    if (!s || (s.body && !this.world.bodies.includes(s.body)) || (s.joint && !this.world.joints.includes(s.joint))) {
      el.hidden = true;
      this.selection = null;
      return;
    }
    const close = h('button', { class: 'btn icon small', 'aria-label': '关闭', 'data-icon': 'close', onclick: () => this.select(null) });
    const parts = [];
    if (s.body) {
      const b = s.body, sp = b.shapeSpec;
      const name = b.tag === 'link' ? '绳子的一节' : b.tag === 'ball' ? '小球' : SHAPE_NAMES[sp.t];
      const size = sp.t === 'circle' ? `半径 ${sp.r.toFixed(2)} 米` : sp.t === 'box' ? `${sp.w.toFixed(2)} × ${sp.h.toFixed(2)} 米` : `${b.fixtures.length} 块凸多边形`;
      parts.push(h('h3', {}, name, close));
      parts.push(h('div', { class: 'sub' }, b.isStatic ? `固定 · ${size}` : `${material(b.mat).name} · ${b.mass.toFixed(2)} 千克 · ${size}`));
      if (this.editable(b)) {
        const mats = h('div', { class: 'mats' }, ...MATERIAL_KEYS.map(k => {
          const c = h('button', { class: 'chip', role: 'radio', 'aria-checked': String(b.mat === k), onclick: () => {
            this.beginEdit();
            setMaterial(this.world, b, k);
            this.committed();
          } }, h('span', { class: 'swatch', style: `background:${MATERIALS[k].color}` }), MATERIALS[k].name);
          return c;
        }));
        parts.push(mats);
        if (!this.levelMode) {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = b.isStatic;
          cb.addEventListener('change', () => { this.beginEdit(); b.setType(cb.checked ? 'static' : 'dynamic'); this.committed(); });
          parts.push(h('label', { class: 'switch' }, cb, '固定在原地（不会动）'));
        }
        const rot = d => () => {
          if (this.running) return;
          this.beginEdit();
          const ox = b.x, oy = b.y, oa = b.angle;
          const c = b.cx, cy = b.cy, a = d * Math.PI / 12;
          const ca = Math.cos(a), sa = Math.sin(a);
          const nx = c + ca * (b.x - c) - sa * (b.y - cy), ny = cy + sa * (b.x - c) + ca * (b.y - cy);
          b.setTransform(nx, ny, b.angle + a);
          const problem = this.checkMove([b]);
          if (problem) { b.setTransform(ox, oy, oa); this.dropEdit(); toast(problem); return; }
          this.committed();
        };
        parts.push(h('div', { class: 'row actions' },
          h('button', { class: 'btn small', 'data-icon': 'rotl', title: '逆时针转 15°（Q）', onclick: rot(1) }, h('span', {}, '转')),
          h('button', { class: 'btn small', 'data-icon': 'rotr', title: '顺时针转 15°（E）', onclick: rot(-1) }, h('span', {}, '转')),
          this.levelMode ? null : h('button', { class: 'btn small', 'data-icon': 'copy', onclick: () => this.duplicate(b) }, h('span', {}, '复制')),
          h('button', { class: 'btn small danger', 'data-icon': 'trash', onclick: () => this.deleteSelection() }, h('span', {}, '删除'))));
      }
    } else {
      const j = s.joint;
      const editable = !(this.levelMode && (j.locked || this.levelPhase !== 'edit'));
      const motor = j.kind === 'pin' && j.enableMotor;
      parts.push(h('h3', {}, motor ? '马达' : JOINT_NAMES[j.kind] || '关节', close));
      if (j.kind === 'pin') {
        if (motor) {
          parts.push(this.range('转速', 0.5, 15, 0.5, Math.abs(j.motorSpeed), v => `${(v / (2 * Math.PI)).toFixed(2)} 圈/秒`, v => {
            this.world.setMotor(j, true, Math.sign(j.motorSpeed || -1) * v);
          }, editable));
          parts.push(this.range('力度', 0, 100, 1, Math.round(Math.log10(Math.max(1, j.maxMotorTorque)) * 20), v => `${Math.round(10 ** (v / 20))} 牛·米`, v => {
            this.world.setMotor(j, true, j.motorSpeed, Math.round(10 ** (v / 20)));
          }, editable));
          if (editable) parts.push(h('div', { class: 'row actions' },
            h('button', { class: 'btn small', 'data-icon': j.motorSpeed < 0 ? 'rotl' : 'rotr', onclick: () => { this.world.setMotor(j, true, -j.motorSpeed); this.dirty = true; this.renderInspector(); } }, h('span', {}, j.motorSpeed < 0 ? '改成逆时针' : '改成顺时针')),
            this.levelMode ? null : h('button', { class: 'btn small', onclick: () => { this.world.setMotor(j, false); this.dirty = true; this.renderInspector(); } }, '关掉马达')));
        } else if (editable && !this.levelMode) {
          parts.push(h('div', { class: 'sub' }, '两个物体可以绕这个点自由转动。'));
          parts.push(h('button', { class: 'btn small', 'data-icon': 'motor', onclick: () => {
            this.world.setMotor(j, true, -6, Math.max(10, Math.round(25 * (j.bodyA.mass + j.bodyB.mass))));
            this.dirty = true;
            this.renderInspector();
          } }, h('span', {}, '装上马达')));
        }
      } else if (j.kind === 'spring') {
        parts.push(this.range('硬度', 0.3, 10, 0.1, j.hertz, v => `${v.toFixed(1)} 赫兹`, v => { j.hertz = v; this.world.wake(j.bodyB); this.world.wake(j.bodyA); }, editable));
        parts.push(this.range('阻尼', 0, 1, 0.05, j.dampingRatio, v => v.toFixed(2), v => { j.dampingRatio = v; }, editable));
        parts.push(this.range('长度', 0.2, 20, 0.1, j.length, v => `${v.toFixed(1)} 米`, v => { j.length = v; this.world.wake(j.bodyB); this.world.wake(j.bodyA); }, editable));
      } else if (j.kind === 'weld') {
        parts.push(h('div', { class: 'sub' }, '两个物体粘成了一体。'));
      }
      if (editable) parts.push(h('div', { class: 'row actions' }, h('button', { class: 'btn small danger', 'data-icon': 'trash', onclick: () => this.deleteSelection() }, h('span', {}, '删除'))));
    }
    el.replaceChildren(...parts.filter(Boolean));
    applyIcons(el);
    el.hidden = false;
  }

  range(label, min, max, step, value, fmt, onChange, enabled = true) {
    const input = h('input', { type: 'range', min, max, step, value });
    input.disabled = !enabled;
    const out = h('output', {}, fmt(Number(value)));
    let began = false;
    input.addEventListener('input', () => {
      if (!began) { this.beginEdit(); began = true; }
      const v = Number(input.value);
      out.textContent = fmt(v);
      onChange(v);
      this.dirty = true;
      this.invalidate();
    });
    input.addEventListener('change', () => { if (began) { began = false; this.committed(); } });
    return h('label', { class: 'range' }, h('span', {}, label), input, out);
  }

  duplicate(b) {
    this.beginEdit();
    const spec = saveScene({ bodies: [b], joints: [], gravity: this.world.gravity }).bodies[0];
    delete spec.v;
    delete spec.w;
    delete spec.sleep;
    const bb = b.bounds();
    spec.x += Math.max(0.5, (bb.maxX - bb.minX) * 0.5);
    spec.y += 0.3;
    const copy = addBody(this.world, spec);
    this.committed();
    this.select({ body: copy });
  }

  // ---------- commands ----------

  wireCommands() {
    const cmds = {
      play: () => this.toggle(),
      reset: () => this.reset(),
      step: () => this.singleStep(),
      slow: () => { this.slow = !this.slow; this.updateChrome(); toast(this.slow ? '慢动作：四分之一速度' : '正常速度'); },
      undo: () => this.undo(),
      redo: () => this.redo(),
      menu: e => this.openMainMenu(e.currentTarget),
      scenes: () => this.openScenes(),
      levels: () => this.openLevels(),
      'level-hint': () => this.showSolution(),
      'level-clear': () => this.clearLevel(),
      'level-exit': () => this.exitLevel()
    };
    for (const el of document.querySelectorAll('[data-cmd]')) {
      const fn = cmds[el.dataset.cmd];
      if (fn) el.addEventListener('click', e => { this.sound.unlock(); fn(e); });
    }
  }

  wireKeys() {
    addEventListener('keydown', e => {
      if (isTyping(e) || dialogOpen()) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (mod) return;
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.toggle(); return; }
      if (k === 'r') this.reset();
      else if (k === '.') this.singleStep();
      else if (k === 'delete' || k === 'backspace') this.deleteSelection();
      else if (k === 'escape') { this.toolCancel(); this.select(null); }
      else if ((k === 'q' || k === 'e') && this.selection?.body) {
        const btn = document.querySelectorAll('#inspector [data-icon="rotl"], #inspector [data-icon="rotr"]')[k === 'q' ? 0 : 1];
        btn?.click();
      } else if (TOOL_KEYS.includes(k)) {
        const bar = document.querySelectorAll('.tool');
        const b = bar[TOOL_KEYS.indexOf(k)];
        if (b) this.setTool(b.dataset.tool);
      }
    });
  }

  openMainMenu(anchor) {
    const phone = innerWidth <= 760;
    const items = [];
    if (phone) items.push({ label: '重做', icon: 'redo', action: () => this.redo() });
    if (!this.levelMode) {
      items.push(
        { label: '保存到「我的作品」', icon: 'scenes', action: () => this.saveWork() },
        { label: '分享链接', icon: 'share', action: () => this.share() },
        { label: '导出文件', icon: 'copy', action: () => this.exportFile() },
        { label: '打开文件…', icon: 'scenes', action: () => $('#file-input').click() },
        { label: '看全部', icon: 'fit', action: () => this.fitAll() },
        { label: '清空画布', icon: 'trash', action: () => this.clearAll() },
        '-');
      if (phone) items.push({ label: '慢动作', toggle: this.slow, action: v => { this.slow = v; this.updateChrome(); } });
      if (typeof DeviceOrientationEvent !== 'undefined' && ('ontouchstart' in window)) {
        items.push({ label: '重力跟着手机倾斜', toggle: this.settings.tilt, action: v => this.setTilt(v) });
      }
    }
    items.push(
      { label: '音效', toggle: this.settings.sound, action: v => { this.settings.sound = v; this.sound.enabled = v; if (v) this.sound.unlock(); this.saveSettings(); } },
      { label: '显示引擎内部', toggle: this.settings.debug, action: v => { this.settings.debug = v; this.renderer.debug = v; this.saveSettings(); this.updateChrome(); this.invalidate(); } },
      '-',
      { label: '关于造物', icon: 'bulb', action: () => this.about() });
    openMenu(anchor, items);
  }

  saveSettings() {
    store.save('settings', { sound: this.settings.sound, debug: this.settings.debug });
  }

  fitAll() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of this.world.bodies) {
      const bb = b.bounds();
      if (bb.maxX - bb.minX > 60) continue; // ignore endless floors
      minX = Math.min(minX, bb.minX); minY = Math.min(minY, bb.minY);
      maxX = Math.max(maxX, bb.maxX); maxY = Math.max(maxY, bb.maxY);
    }
    if (minX === Infinity) { this.fitView({ x: 0, y: 5, w: 24 }); return; }
    this.camera.fit({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: Math.max(6, (maxX - minX) * 1.15), h: Math.max(4, (maxY - minY) * 1.2) }, this.insets());
    this.invalidate();
  }

  clearAll() {
    this.beginEdit();
    this.pause();
    this.setWorld(buildWorld(BLANK));
    this.committed();
    this.startScene = null;
    toast('画布清空了（可以撤销）');
  }

  // ---------- scenes dialog, levels dialog ----------

  thumb(scene, view, level = null) {
    const c = h('canvas', { width: 320, height: 180 });
    requestAnimationFrame(() => {
      try {
        const cam = new Camera();
        const r = new Renderer(c, cam);
        r.dpr = 1;
        cam.resize(320, 180);
        if (view) cam.fit(view);
        else cam.fit({ x: 0, y: 5, w: 30 });
        r.render({ world: buildWorld(scene), time: 0, level });
      } catch { /* a broken thumbnail is not worth an error */ }
    });
    return c;
  }

  openScenes() {
    const works = store.load('works', []);
    const demos = h('div', { class: 'cards' }, ...DEMOS.map(d => h('button', { class: 'card', onclick: () => { closeDialog(); this.loadDemo(d.id); } },
      this.thumb(d.build(), d.view), h('div', { class: 'card-text' }, h('b', {}, d.name), h('small', {}, d.desc)))));
    const mine = works.length ? h('div', { class: 'cards' }, ...works.map((w, i) => {
      const del = h('button', { class: 'btn icon card-del', 'aria-label': '删除', 'data-icon': 'trash', onclick: e => {
        e.stopPropagation();
        const list = store.load('works', []);
        list.splice(i, 1);
        store.save('works', list);
        this.openScenes();
      } });
      return h('div', { class: 'card', role: 'button', tabindex: '0', onclick: () => { closeDialog(); this.openWork(w); } },
        this.thumb(w.scene, w.scene.view), del, h('div', { class: 'card-text' }, h('b', {}, w.name), h('small', {}, new Date(w.time).toLocaleString('zh-CN'))));
    })) : h('p', {}, '还没有保存过作品。在右上角的「⋯」菜单里可以保存当前画布。');
    const body = h('div', {},
      h('div', { class: 'dialog-actions', style: 'justify-content:flex-start;margin-top:0' },
        h('button', { class: 'btn', 'data-icon': 'box', onclick: () => { closeDialog(); if (this.levelMode) this.exitLevel(false); this.loadScene(BLANK, { x: 0, y: 5, w: 24 }); this.scheduleSave(); } }, h('span', {}, '空白画布'))),
      h('h4', {}, '演示'), demos, h('h4', {}, '我的作品'), mine);
    openDialog('场景', body);
  }

  openWork(w) {
    if (this.levelMode) this.exitLevel(false);
    this.loadScene(w.scene, w.scene.view);
    this.scheduleSave();
    toast(`打开了「${w.name}」`);
  }

  openLevels() {
    const levels = allLevels();
    const done = levels.filter(l => this.progress[l.id]?.done).length;
    const cards = h('div', { class: 'cards' }, ...levels.map((l, i) => {
      const p = this.progress[l.id];
      return h('button', { class: 'card', onclick: () => { closeDialog(); this.enterLevel(l.id); } },
        this.thumb(l.scene, l.view, l), h('span', { class: 'num' }, String(i + 1)), p?.done ? h('span', { class: 'badge' }, '✓ 已过关') : null,
        h('div', { class: 'card-text' }, h('b', {}, l.name), h('small', {}, l.hint)));
    }));
    openDialog('闯关', h('div', {}, h('p', {}, `把红色小球送进绿色的星星框，停够 1 秒就算过关。已过 ${done} / ${levels.length} 关。`), cards));
  }

  // ---------- saving, sharing, files ----------

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 800);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    if (this.levelMode) return;
    store.save('sandbox', { scene: saveScene(this.world), cam: { x: this.camera.x, y: this.camera.y, scale: this.camera.scale } });
  }

  currentView() {
    return { x: Math.round(this.camera.x * 100) / 100, y: Math.round(this.camera.y * 100) / 100, w: Math.round(this.camera.width / this.camera.scale * 100) / 100 };
  }

  saveWork() {
    const works = store.load('works', []);
    const name = `作品 ${works.length + 1}`;
    const input = h('input', { class: 'share-link', value: name, autofocus: true, maxlength: 40 });
    const save = () => {
      const list = store.load('works', []);
      list.unshift({ name: input.value.trim() || name, time: Date.now(), scene: saveScene(this.world, { view: this.currentView() }) });
      if (!store.save('works', list.slice(0, 40))) { toast('保存失败：浏览器存储空间不够'); return; }
      closeDialog();
      toast('已保存到「我的作品」');
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    openDialog('保存作品', h('div', {}, h('p', {}, '作品只保存在这台设备的浏览器里。想发给别人用「分享链接」。'), input,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: closeDialog }, '取消'), h('button', { class: 'btn primary', onclick: save }, '保存'))));
  }

  async share() {
    const code = await encodeScene(saveScene(this.world, { view: this.currentView() }));
    const url = shareURL(code);
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch { /* not allowed: the dialog shows the link */ }
    const box = h('div', { class: 'share-link' }, url);
    const actions = h('div', { class: 'dialog-actions' });
    if (navigator.share) actions.append(h('button', { class: 'btn', 'data-icon': 'share', onclick: () => navigator.share({ title: '造物', url }).catch(() => {}) }, h('span', {}, '分享…')));
    actions.append(h('button', { class: 'btn primary', onclick: async () => {
      try { await navigator.clipboard.writeText(url); toast('已复制'); } catch { toast('复制不了，请手动选中链接复制'); }
    } }, '复制链接'));
    openDialog('分享链接', h('div', {},
      h('p', {}, `${copied ? '链接已经复制好了。' : ''}整个作品都编码在链接里（${url.length} 个字符），不经过任何服务器，打开就是同一个场景。`), box, actions));
  }

  exportFile() {
    const blob = new Blob([JSON.stringify(saveScene(this.world, { view: this.currentView() }))], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `造物-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async importFile(file) {
    if (!file) return;
    try {
      const scene = JSON.parse(await file.text());
      if (!Array.isArray(scene.bodies)) throw new Error('not a scene');
      if (this.levelMode) this.exitLevel(false);
      this.beginEdit();
      this.loadScene(scene, scene.view);
      this.scheduleSave();
      toast(`打开了 ${file.name}`);
    } catch {
      toast('这个文件不是造物的作品');
    }
    $('#file-input').value = '';
  }

  about() {
    const dl = (...rows) => h('dl', {}, ...rows.flatMap(([a, b]) => [h('dt', {}, a), h('dd', {}, b)]));
    openDialog('关于造物', h('div', { class: 'about' },
      h('p', {}, '一个二维物理沙盒。物理引擎是从零写的，没有用任何第三方库。'),
      dl(['碰撞检测', '动态 AABB 树做粗检测，分离轴定理和裁剪算法生成接触点，快速物体有预测接触，不会穿墙'],
        ['求解器', '软约束子步求解（每步 4 个子步，带热启动和松弛），能稳稳叠起 200 多个箱子'],
        ['关节', '铰链（马达、角度限制）、距离（连杆、弹簧、绳长限制）、焊接、鼠标拖拽'],
        ['休眠', '静止的物体按“岛”一起休眠，被碰到时整组唤醒'],
        ['画图', '随手画的凹形状用耳切法三角化，再合并成最多 8 个顶点的凸块'],
        ['确定性', '只用 IEEE 精确的运算（三角函数也是自己算的），同一个场景在任何浏览器里模拟结果逐位相同；关卡的参考答案在测试里跑过']),
      h('h4', {}, '快捷键'),
      dl(['空格', '播放 / 暂停'], ['R', '回到播放前'], ['.', '单步'], ['Ctrl+Z', '撤销（加 Shift 重做）'], ['1–9, 0', '切换工具'], ['Q / E', '旋转选中的物体'], ['Delete', '删除选中'], ['滚轮 / 双指', '缩放；右键或空格拖动平移'])));
  }

  // ---------- tilt gravity ----------

  async setTilt(on) {
    if (on) {
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          const r = await DeviceOrientationEvent.requestPermission();
          if (r !== 'granted') { toast('没有拿到方向传感器的权限'); return; }
        }
      } catch {
        toast('这台设备不支持重力感应');
        return;
      }
      this.onTilt = this.onTilt || (e => this.tilt(e));
      addEventListener('deviceorientation', this.onTilt);
      toast('倾斜手机试试');
    } else if (this.onTilt) {
      removeEventListener('deviceorientation', this.onTilt);
    }
    this.settings.tilt = on;
    this.tiltG = null;
    if (!on) this.world.setGravity(0, -10);
  }

  tilt(e) {
    if (!this.settings.tilt || this.levelMode || e.beta == null) return;
    const rad = Math.PI / 180, b = e.beta * rad, g = e.gamma * rad;
    // gravity in device coordinates (x right, y up the screen), then rotated into screen coordinates
    const dx = Math.cos(b) * Math.sin(g), dy = -Math.sin(b);
    const a = (screen.orientation?.angle ?? window.orientation ?? 0) * rad;
    let gx = dx * Math.cos(a) + dy * Math.sin(a), gy = -dx * Math.sin(a) + dy * Math.cos(a);
    const prev = this.tiltG || { x: gx, y: gy };
    gx = prev.x * 0.7 + gx * 0.3;
    gy = prev.y * 0.7 + gy * 0.3;
    this.tiltG = { x: gx, y: gy };
    const q = v => Math.round(v * 10 * 4) / 4;
    this.world.setGravity(q(gx), q(gy));
  }

  applyTilt() {
    if (this.settings.tilt && this.tiltG) this.world.setGravity(Math.round(this.tiltG.x * 40) / 4, Math.round(this.tiltG.y * 40) / 4);
  }
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const app = new App();
window.__zw = { app, DEMOS, levels: allLevels };
app.init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
