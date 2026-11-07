import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Game from './components/Game.jsx';
import Hud from './components/Hud.jsx';
import TouchControls from './components/TouchControls.jsx';
import { World } from './game/world.js';
import { createPlayer } from './game/player.js';
import { createAtlasCanvas } from './game/atlas.js';
import { BLOCKS, HOTBAR, HOTBAR_KEYS } from './game/blocks.js';
import { Sim } from './game/sim.js';
import { MORNING, NIGHT, clockText, wrapTime } from './game/daynight.js';

const SAVE_KEY = 'voxel-world:v1';

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    return s && Number.isInteger(s.seed) ? s : null;
  } catch {
    return null;
  }
}

function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // 隐私模式或存储满了：照样能玩，只是不保存
  }
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function makeInput() {
  return { keys: new Set(), move: { x: 0, y: 0 }, lookX: 0, lookY: 0, actions: [], held: {}, touchJump: false, touchDown: false };
}

function buildSession(save) {
  const seed = save?.seed ?? randomSeed();
  const world = new World({ seed });
  if (save) world.applyEdits(save.edits);
  let player;
  const p = save?.player;
  if (p && Array.isArray(p.pos) && p.pos.length === 3 && p.pos.every(Number.isFinite) &&
      world.inBounds(Math.floor(p.pos[0]), 0, Math.floor(p.pos[2]))) {
    player = createPlayer(p.pos, Number(p.yaw) || 0, Number(p.pitch) || 0);
    player.flying = !!p.flying;
  } else {
    player = createPlayer(world.spawnPoint(), Math.PI / 4, -0.2);
  }
  const time = Number.isFinite(save?.time) ? wrapTime(save.time) : MORNING;
  const sim = new Sim(world); // 算好火把光照，继续流没流完的水
  return { world, sim, player, time, id: Math.random().toString(36).slice(2) };
}

export default function App() {
  const [session, setSession] = useState(() => buildSession(loadSave()));
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(true);
  const [selected, setSelected] = useState(0);
  const [flying, setFlying] = useState(session.player.flying);
  const [toast, setToast] = useState(null);

  const input = useMemo(makeInput, []);
  const selectedRef = useRef(HOTBAR[0]);
  const activeRef = useRef(false);
  const statsRef = useRef(null);
  const underwaterRef = useRef(null);
  const timeRef = useRef(session.time);
  const canvasRef = useRef(null);
  const saveTimer = useRef(null);

  const atlas = useMemo(() => {
    const canvas = createAtlasCanvas();
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, url: canvas.toDataURL() };
  }, []);

  const showToast = useCallback((text) => setToast({ text, key: Date.now() }), []);

  // 让 Game 里的每帧逻辑总能拿到当前玩家
  const playerRef = useRef(session.player);
  playerRef.current = session.player;

  useEffect(() => {
    setFlying(session.player.flying);
    timeRef.current = session.time;
  }, [session]);

  useEffect(() => {
    selectedRef.current = HOTBAR[selected];
  }, [selected]);

  useEffect(() => {
    activeRef.current = started && !paused;
    if (!activeRef.current) {
      input.keys.clear();
      input.held = {};
      input.move = { x: 0, y: 0 };
    }
  }, [started, paused, input]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(id);
  }, [toast]);

  const save = useCallback(() => {
    const p = playerRef.current;
    writeSave({
      seed: session.world.seed,
      edits: session.world.exportEdits(),
      player: { pos: p.pos, yaw: p.yaw, pitch: p.pitch, flying: p.flying },
      time: timeRef.current,
    });
  }, [session]);

  const onEdit = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 600);
  }, [save]);

  // 定时保存位置，关页面时也保存
  useEffect(() => {
    const id = setInterval(save, 5000);
    const onHide = () => save();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [save]);

  const selectSlot = useCallback(
    (i) => {
      const n = (i + HOTBAR.length) % HOTBAR.length;
      setSelected(n);
      showToast(BLOCKS[HOTBAR[n]].name);
    },
    [showToast],
  );

  const toggleFly = useCallback(() => {
    const p = playerRef.current;
    p.flying = !p.flying;
    p.vel[1] = 0;
    setFlying(p.flying);
    showToast(p.flying ? '飞行：开（空格上升，C 下降）' : '飞行：关');
  }, [showToast]);

  // 键盘和鼠标
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!activeRef.current) return;
      const key = e.code.startsWith('Digit') ? e.code.slice(5) : e.code === 'Minus' ? '-' : null;
      const slot = key === null ? -1 : HOTBAR_KEYS.indexOf(key);
      if (slot >= 0 && slot < HOTBAR.length) selectSlot(slot);
      if (e.code === 'KeyF' && !e.repeat) toggleFly();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      input.keys.add(e.code);
    };
    const onKeyUp = (e) => input.keys.delete(e.code);
    const onBlur = () => input.keys.clear();
    const onMouseMove = (e) => {
      if (document.pointerLockElement !== canvasRef.current) return;
      // 有的浏览器偶尔会给出一个特别大的跳变，限制一下单次的量
      const clamp = (v) => Math.max(-120, Math.min(120, v));
      input.lookX += clamp(e.movementX) * 0.0022;
      input.lookY += clamp(e.movementY) * 0.0022;
    };
    const onMouseDown = (e) => {
      if (document.pointerLockElement !== canvasRef.current) return;
      const kind = e.button === 0 ? 'dig' : e.button === 2 ? 'place' : null;
      if (!kind) return;
      input.actions.push(kind);
      input.held[kind] = true;
      input.held[kind + 'Timer'] = -0.15;
    };
    const onMouseUp = (e) => {
      if (e.button === 0) input.held.dig = false;
      if (e.button === 2) input.held.place = false;
    };
    const onWheel = (e) => {
      if (!activeRef.current || isTouch) return;
      setSelected((s) => {
        const n = (s + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length;
        return n;
      });
    };
    const onLockChange = () => {
      if (isTouch) return;
      setPaused(document.pointerLockElement !== canvasRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }, [input, selectSlot, toggleFly]);

  const play = () => {
    setStarted(true);
    if (isTouch) {
      setPaused(false);
      return;
    }
    const canvas = canvasRef.current;
    try {
      const r = canvas?.requestPointerLock?.();
      // 有的浏览器拒绝锁定鼠标时返回被拒绝的 Promise
      if (r && typeof r.catch === 'function') r.catch(() => setPaused(false));
      if (!canvas?.requestPointerLock) setPaused(false);
    } catch {
      setPaused(false);
    }
  };

  const newWorld = () => {
    if (!window.confirm('换一个新世界？当前世界的改动会被清除。')) return;
    const next = buildSession(null);
    setSession(next);
    writeSave({ seed: next.world.seed, edits: [], player: null, time: next.time });
    showToast('新世界已生成');
  };

  const resetWorld = () => {
    if (!window.confirm('把当前世界恢复成刚生成时的样子？')) return;
    const next = buildSession({ seed: session.world.seed, edits: [], time: timeRef.current });
    setSession(next);
    writeSave({ seed: next.world.seed, edits: [], player: null, time: next.time });
    showToast('世界已重置');
  };

  // 跳到白天 / 夜晚，用 timeTick 让面板上的时间刷新
  const [, setTimeTick] = useState(0);
  const setTime = (t, text) => {
    timeRef.current = t;
    setTimeTick((n) => n + 1);
    save();
    showToast(text);
  };

  const editCount = session.world.edits.size;

  return (
    <div className="app">
      <Game
        key={session.id}
        world={session.world}
        sim={session.sim}
        onMessage={showToast}
        texture={atlas.texture}
        input={input}
        playerRef={playerRef}
        selectedRef={selectedRef}
        activeRef={activeRef}
        statsRef={statsRef}
        timeRef={timeRef}
        underwaterRef={underwaterRef}
        onEdit={onEdit}
        onFlyingChange={setFlying}
        onCanvas={(c) => (canvasRef.current = c)}
      />

      <div className="underwater" ref={underwaterRef} />

      <Hud selected={selected} onSelect={selectSlot} atlasUrl={atlas.url} statsRef={statsRef} toast={toast} />

      {isTouch && started && !paused && (
        <TouchControls input={input} flying={flying} onToggleFly={toggleFly} onPause={() => setPaused(true)} />
      )}

      {(!started || paused) && (
        <div className="overlay">
          <div className="panel">
            <h1>方块小镇</h1>
            <p className="sub">挖方块、放方块，盖一座自己的小房子。</p>
            <button type="button" className="primary" onClick={play}>
              {started ? '继续' : '开始'}
            </button>
            {isTouch ? (
              <ul className="help">
                <li>左下角摇杆：移动（推到底会跑）</li>
                <li>在屏幕上拖动：转视角</li>
                <li>右下角：挖 / 放 / 跳，按住可以连续</li>
                <li>水里按“跳”往上游，贴着岸按“跳”上岸</li>
                <li>火把要立在方块上，晚上能照亮周围；水会往低处和四周流</li>
                <li>底部快捷栏：选方块</li>
              </ul>
            ) : (
              <ul className="help">
                <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动，<kbd>Shift</kbd> 跑，<kbd>空格</kbd> 跳</li>
                <li>鼠标转视角，左键挖，右键放，按住可以连续</li>
                <li><kbd>1</kbd>–<kbd>9</kbd>、<kbd>0</kbd>、<kbd>-</kbd> 或滚轮选方块（<kbd>0</kbd> 火把，<kbd>-</kbd> 水）</li>
                <li><kbd>F</kbd> 飞行，飞行时 <kbd>空格</kbd> 上升、<kbd>C</kbd> 下降</li>
                <li>水里按 <kbd>空格</kbd> 往上游、<kbd>C</kbd> 往下潜，贴着岸按 <kbd>空格</kbd> 上岸</li>
                <li>火把要立在方块上，晚上能照亮周围；水会往低处和四周流</li>
                <li><kbd>Esc</kbd> 暂停</li>
              </ul>
            )}
            <div className="row time-row">
              <span className="clock">游戏时间 {clockText(timeRef.current)}</span>
              <button type="button" onClick={() => setTime(MORNING, '天亮了')}>白天</button>
              <button type="button" onClick={() => setTime(NIGHT, '天黑了')}>夜晚</button>
            </div>
            <p className="meta">
              种子 {session.world.seed} · 已改动 {editCount} 个方块 · 自动保存在这个浏览器里
            </p>
            <div className="row">
              <button type="button" onClick={resetWorld}>重置世界</button>
              <button type="button" onClick={newWorld}>新世界</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
