import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Game from './components/Game.jsx';
import Hud from './components/Hud.jsx';
import TouchControls from './components/TouchControls.jsx';
import Inventory from './components/Inventory.jsx';
import Chest from './components/Chest.jsx';
import MapView from './components/MapView.jsx';
import { MapData, packExplored, unpackExplored } from './game/map.js';
import { sanitizeWeather, setWeather } from './game/weather.js';
import { World } from './game/world.js';
import { createPlayer } from './game/player.js';
import { createAtlasCanvas } from './game/atlas.js';
import { HOTBAR, HOTBAR_KEYS } from './game/blocks.js';
import { SEEDS, SURVIVAL_HOTBAR, bestFood, eat, itemName, sanitizeInventory } from './game/items.js';
import { craft } from './game/crafting.js';
import { deserializeAnimals, serializeAnimals } from './game/animals.js';
import {
  canUseCustomSlot, chestKey, deserializeChests, respawnPoint, serializeChests, sleepCheck, transfer,
} from './game/home.js';
import { MAX_AIR, MAX_HEALTH, MAX_HUNGER, sanitizeHealth, sanitizeHunger } from './game/health.js';
import { Sim } from './game/sim.js';
import { MORNING, NIGHT, clockText, skyAt, wrapTime } from './game/daynight.js';
import { clampVolume, sound } from './game/sound.js';

const SAVE_KEY = 'voxel-world:v1';
// 和平开关是玩家的设置，不跟着世界走：换新世界、重置世界都保留
const PEACEFUL_KEY = 'voxel-world:peaceful';

function loadPeaceful() {
  try {
    return localStorage.getItem(PEACEFUL_KEY) === '1';
  } catch {
    return false;
  }
}

function writePeaceful(on) {
  try {
    localStorage.setItem(PEACEFUL_KEY, on ? '1' : '0');
  } catch {
    // 存不了也没关系，这次打开期间照样有效
  }
}

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

// 音量设置也是玩家设置，不跟着世界走
const VOLUME_KEY = 'voxel-world:volume';
const MINIMAP_KEY = 'voxel-world:minimap';
function loadMinimap() {
  try {
    return localStorage.getItem(MINIMAP_KEY) !== '0';
  } catch {
    return true;
  }
}
function loadVolume() {
  try {
    const raw = JSON.parse(localStorage.getItem(VOLUME_KEY) || 'null');
    return { volume: clampVolume(raw?.volume ?? 0.7), muted: Boolean(raw?.muted) };
  } catch {
    return { volume: 0.7, muted: false };
  }
}
function writeVolume(v) {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(v));
  } catch {
    // 存不了也没关系
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
    player.health = sanitizeHealth(p.health);
    player.hunger = sanitizeHunger(p.hunger);
    // 睡过的床（重生点）
    if (Array.isArray(p.spawn) && p.spawn.length === 3 && p.spawn.every(Number.isInteger)) player.spawn = p.spawn;
  } else {
    player = createPlayer(world.spawnPoint(), Math.PI / 4, -0.2);
  }
  const time = Number.isFinite(save?.time) ? wrapTime(save.time) : MORNING;
  const sim = new Sim(world); // 算好火把光照，继续流没流完的水
  // 新世界默认生存模式；加合成之前的老存档没有 mode，保持原来的创造模式
  const mode = save ? (save.mode === 'survival' ? 'survival' : 'creative') : 'survival';
  const inventory = sanitizeInventory(save?.inventory);
  const monsters = []; // 怪物不存档，会重新出现
  const animals = deserializeAnimals(save?.animals, world); // 动物存档
  const chests = deserializeChests(save?.chests, world); // 箱子里的东西
  const custom = canUseCustomSlot(save?.custom) ? save.custom : SEEDS; // 快捷栏最后一格
  const map = new MapData(world, unpackExplored(save?.explored, world.sizeX * world.sizeZ)); // 地图和探索记录
  map.explore(player.pos[0], player.pos[2]);
  const weather = sanitizeWeather(save?.weather); // 天气
  return { world, sim, player, time, mode, inventory, monsters, animals, chests, custom, map, weather, id: Math.random().toString(36).slice(2) };
}

export default function App() {
  const [session, setSession] = useState(() => buildSession(loadSave()));
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(true);
  const [selected, setSelected] = useState(0);
  const [flying, setFlying] = useState(session.player.flying);
  const [toast, setToast] = useState(null);
  const [mode, setMode] = useState(session.mode);
  const [peaceful, setPeaceful] = useState(loadPeaceful);
  const peacefulRef = useRef(peaceful);
  peacefulRef.current = peaceful;
  const [bagOpen, setBagOpen] = useState(false);
  const [chestOpen, setChestOpen] = useState(null); // 打开的箱子的坐标 "x,y,z"
  const [custom, setCustom] = useState(session.custom);
  const [sleeping, setSleeping] = useState(false);
  const [audio, setAudio] = useState(loadVolume);
  const [mapOpen, setMapOpen] = useState(false);
  const [minimap, setMinimap] = useState(loadMinimap);
  const [, setTimeTick] = useState(0);
  const panelOpen = bagOpen || chestOpen !== null || mapOpen;
  const [health, setHealth] = useState(session.player.health);
  const [dead, setDead] = useState(null); // 死了的话是死因
  const [air, setAir] = useState(MAX_AIR);
  const [hunger, setHunger] = useState(session.player.hunger);
  const [, setInvVersion] = useState(0); // 背包变化时刷新界面

  // 快捷栏最后一格是自选的（默认麦种）
  const hotbar = useMemo(
    () => [...(mode === 'creative' ? HOTBAR : SURVIVAL_HOTBAR).slice(0, -1), custom],
    [mode, custom],
  );
  const hotbarRef = useRef(hotbar);
  hotbarRef.current = hotbar;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const bagOpenRef = useRef(false);
  bagOpenRef.current = panelOpen;

  const input = useMemo(makeInput, []);
  const selectedRef = useRef(hotbar[0]);
  const activeRef = useRef(false);
  const statsRef = useRef(null);
  const underwaterRef = useRef(null);
  const digUiRef = useRef(null);
  const hurtUiRef = useRef(null);
  const timeRef = useRef(session.time);
  const weatherRef = useRef(session.weather);
  weatherRef.current = session.weather;
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

  // 只在开发服务器里暴露，方便调试和浏览器测试；打包后的版本里没有
  if (import.meta.env.DEV) window.__voxel = Object.assign(window.__voxel || {}, { session });

  useEffect(() => {
    setFlying(session.player.flying);
    setHealth(session.player.health);
    setHunger(session.player.hunger);
    setAir(MAX_AIR);
    setDead(null);
    setMode(session.mode);
    setCustom(session.custom);
    setChestOpen(null);
    timeRef.current = session.time;
  }, [session]);

  // 换模式时快捷栏也换了，选中的格子要在范围内
  const slot = Math.min(selected, hotbar.length - 1);
  selectedRef.current = hotbar[slot];

  useEffect(() => {
    activeRef.current = started && !paused && !panelOpen && !dead && !sleeping;
    if (!activeRef.current) {
      input.keys.clear();
      input.held = {};
      input.move = { x: 0, y: 0 };
    }
  }, [started, paused, panelOpen, dead, sleeping, input]);

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
      player: { pos: p.pos, yaw: p.yaw, pitch: p.pitch, flying: p.flying, health: p.health, hunger: p.hunger, spawn: p.spawn ?? null },
      time: timeRef.current,
      mode: modeRef.current,
      inventory: session.inventory,
      animals: serializeAnimals(session.animals),
      chests: serializeChests(session.chests),
      explored: packExplored(session.map.explored),
      weather: session.weather,
      custom: session.custom,
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
      const bar = hotbarRef.current;
      const n = (i + bar.length) % bar.length;
      setSelected(n);
      showToast(itemName(bar[n]));
    },
    [showToast],
  );

  const onInventory = useCallback(() => setInvVersion((v) => v + 1), []);

  const lockPointer = useCallback(() => {
    if (isTouch) {
      setPaused(false);
      return;
    }
    const canvas = canvasRef.current;
    try {
      if (!canvas?.requestPointerLock) {
        setPaused(false); // 浏览器不支持锁定鼠标：只能用键盘玩
        return;
      }
      const r = canvas.requestPointerLock();
      // 浏览器有时会拒绝（比如刚松开鼠标又马上锁定）。这时停在暂停菜单，
      // 点“继续”会再锁一次；不能假装回到了游戏，不然点鼠标没有反应。
      if (r && typeof r.catch === 'function') r.catch(() => setPaused(true));
    } catch {
      setPaused(true);
    }
  }, []);

  // 打开背包：松开鼠标，游戏停下；关上时回到游戏
  // 创造模式打开的是方块选择器
  const openBag = useCallback(() => {
    setBagOpen(true);
    if (!isTouch && document.pointerLockElement) document.exitPointerLock();
  }, []);

  const openChest = useCallback((key) => {
    if (!session.chests.has(key)) session.chests.set(key, {});
    setChestOpen(key);
    if (!isTouch && document.pointerLockElement) document.exitPointerLock();
  }, [session]);

  // 把一样东西放到快捷栏最后一格
  const setCustomSlot = useCallback(
    (id) => {
      if (!canUseCustomSlot(id)) return;
      session.custom = id;
      setCustom(id);
      setSelected(hotbarRef.current.length - 1);
      showToast(`${itemName(id)} 放到了快捷栏最后一格（=）`);
    },
    [session, showToast],
  );

  const openMap = useCallback(() => {
    setMapOpen(true);
    if (!isTouch && document.pointerLockElement) document.exitPointerLock();
  }, []);

  const closeBag = useCallback(
    (resume = true) => {
      setBagOpen(false);
      setChestOpen(null);
      setMapOpen(false);
      if (resume) lockPointer();
      else setPaused(true);
    },
    [lockPointer],
  );

  const onDeath = useCallback((reason) => {
    setDead(reason);
    setBagOpen(false);
    setChestOpen(null);
    if (!isTouch && document.pointerLockElement) document.exitPointerLock();
  }, []);

  // 重生：回到出生点，满血，背包保留
  const respawn = () => {
    const p = playerRef.current;
    const r = respawnPoint(session.world, p.spawn);
    p.pos = r.pos;
    if (r.lostBed) {
      p.spawn = null;
      showToast('你的床不见了，回到了出生点');
    }
    p.vel = [0, 0, 0];
    p.flying = false;
    p.fallStartY = null;
    p.health = MAX_HEALTH;
    p.sinceHurt = 99;
    p.air = MAX_AIR;
    setAir(MAX_AIR);
    p.hunger = MAX_HUNGER;
    p.exhaustion = 0;
    setHunger(MAX_HUNGER);
    session.monsters.length = 0;
    setHealth(p.health);
    setFlying(false);
    setDead(null);
    save();
    lockPointer();
  };

  // 吃东西：id 不给就自动挑一样
  const eatFood = useCallback(
    (id) => {
      if (modeRef.current !== 'survival') return;
      const p = playerRef.current;
      const food = id ?? bestFood(session.inventory, p.hunger, MAX_HUNGER);
      if (food === null) {
        showToast('背包里没有吃的：砍树叶有时掉苹果，挖草方块有时挖到野莓');
        return;
      }
      const r = eat(session.inventory, p, food, MAX_HUNGER);
      if (!r.ok) {
        showToast(r.reason);
        return;
      }
      setHunger(p.hunger);
      onInventory();
      onEdit();
      sound.eat();
      showToast(`吃了${itemName(food)}，饱食度 +${r.gained / 2}`);
    },
    [session, showToast, onInventory, onEdit],
  );

  // 对着床右键：设重生点；晚上、附近没有夜影就睡到天亮
  const onSleep = useCallback(
    (pos) => {
      const p = playerRef.current;
      p.spawn = pos;
      const check = sleepCheck(skyAt(timeRef.current).day, session.monsters, pos);
      if (!check.ok) {
        showToast(`${check.reason}；重生点已设在这张床`);
        save();
        return;
      }
      setSleeping(true);
      sound.sleep();
      setTimeout(() => {
        timeRef.current = MORNING;
        setTimeTick((n) => n + 1);
        setSleeping(false);
        save();
        showToast('睡了一觉，天亮了。重生点设在这张床');
      }, 1600);
    },
    [session, save, showToast],
  );

  const moveChest = (fromChest, id, n) => {
    const box = session.chests.get(chestOpen);
    if (!box) return;
    const moved = fromChest ? transfer(box, session.inventory, id, n) : transfer(session.inventory, box, id, n);
    if (moved) {
      onInventory();
      onEdit();
    }
  };

  const onCraft = (recipe, times) => {
    const n = craft(session.inventory, recipe, times);
    if (!n) return;
    onInventory();
    onEdit();
    sound.craft();
    showToast(`合成了 ${itemName(recipe.output[0])} ×${recipe.output[1] * n}`);
  };

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
      if (bagOpenRef.current) {
        if (e.code === 'KeyE' || e.code === 'KeyM') closeBag(true);
        else if (e.code === 'Escape') closeBag(false);
        return;
      }
      if (!activeRef.current) return;
      if (e.code === 'KeyE' && !e.repeat) {
        openBag();
        return;
      }
      if (e.code === 'KeyM' && !e.repeat) {
        openMap();
        return;
      }
      const key = e.code.startsWith('Digit') ? e.code.slice(5) : e.code === 'Minus' ? '-' : e.code === 'Equal' ? '=' : null;
      const slot = key === null ? -1 : HOTBAR_KEYS.indexOf(key);
      if (slot >= 0 && slot < hotbarRef.current.length) selectSlot(slot);
      if (e.code === 'KeyF' && !e.repeat) toggleFly();
      if (e.code === 'KeyR' && !e.repeat) eatFood();
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
      const len = hotbarRef.current.length;
      setSelected((s) => (Math.min(s, len - 1) + (e.deltaY > 0 ? 1 : -1) + len) % len);
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
  }, [input, selectSlot, toggleFly, openBag, closeBag, eatFood, openMap]);

  useEffect(() => {
    sound.setVolume(audio.volume);
    sound.setMuted(audio.muted);
    writeVolume(audio);
  }, [audio]);

  const play = () => {
    sound.unlock(); // 浏览器要在点击之后才允许出声
    setStarted(true);
    lockPointer();
  };

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    modeRef.current = next;
    save();
    showToast(next === 'survival' ? '生存模式：挖到的方块进背包，放方块要消耗' : '创造模式：方块无限');
  };

  const togglePeaceful = (on) => {
    if (on === peaceful) return;
    setPeaceful(on);
    peacefulRef.current = on;
    writePeaceful(on);
    if (on) session.monsters.length = 0;
    showToast(on ? '和平：不会再出现夜影' : '夜里又会出现夜影了');
  };

  const newWorld = () => {
    if (!window.confirm('换一个新世界？当前世界的改动会被清除。')) return;
    const next = buildSession(null);
    setSession(next);
    writeSave({ seed: next.world.seed, edits: [], player: null, time: next.time, mode: next.mode });
    showToast('新世界已生成');
  };

  const resetWorld = () => {
    if (!window.confirm('把当前世界恢复成刚生成时的样子？')) return;
    // 重置世界会清空背包
    const next = buildSession({ seed: session.world.seed, edits: [], time: timeRef.current, mode });
    setSession(next);
    writeSave({ seed: next.world.seed, edits: [], player: null, time: next.time, mode: next.mode });
    showToast('世界已重置');
  };

  // 跳到白天 / 夜晚，用 timeTick 让面板上的时间刷新（setTimeTick 在上面定义）
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
        modeRef={modeRef}
        peacefulRef={peacefulRef}
        inventory={session.inventory}
        onInventory={onInventory}
        activeRef={activeRef}
        statsRef={statsRef}
        timeRef={timeRef}
        underwaterRef={underwaterRef}
        digUiRef={digUiRef}
        hurtUiRef={hurtUiRef}
        onHealth={setHealth}
        onDeath={onDeath}
        onAir={setAir}
        onHunger={setHunger}
        chests={session.chests}
        onOpenChest={openChest}
        onSleep={onSleep}
        map={session.map}
        weatherRef={weatherRef}
        monsters={session.monsters}
        animals={session.animals}
        onEdit={onEdit}
        onFlyingChange={setFlying}
        onCanvas={(c) => (canvasRef.current = c)}
      />

      <div className="underwater" ref={underwaterRef} />
      <div className="dig-ring" ref={digUiRef} aria-hidden="true" />
      <div className="hurt" ref={hurtUiRef} aria-hidden="true" />

      <Hud
        slots={hotbar}
        counts={mode === 'survival' ? session.inventory : null}
        selected={slot}
        onSelect={selectSlot}
        atlasUrl={atlas.url}
        statsRef={statsRef}
        toast={toast}
        hideHotbar={panelOpen}
        health={mode === 'survival' ? health : null}
        air={air}
        hunger={hunger}
      />

      {isTouch && started && !paused && !panelOpen && !dead && (
        <TouchControls
          input={input}
          flying={flying}
          onToggleFly={toggleFly}
          onPause={() => setPaused(true)}
          onBag={openBag}
          onMap={openMap}
          onEat={mode === 'survival' ? () => eatFood() : null}
        />
      )}

      {bagOpen && (
        <Inventory
          inventory={session.inventory}
          atlasUrl={atlas.url}
          onCraft={onCraft}
          onEat={eatFood}
          hunger={hunger}
          onClose={() => closeBag(true)}
          isTouch={isTouch}
          creative={mode === 'creative'}
          custom={custom}
          onSetCustom={setCustomSlot}
        />
      )}

      {chestOpen !== null && session.chests.has(chestOpen) && (
        <Chest
          box={session.chests.get(chestOpen)}
          inventory={session.inventory}
          atlasUrl={atlas.url}
          onTake={(id, n) => moveChest(true, id, n)}
          onStore={(id, n) => moveChest(false, id, n)}
          onClose={() => closeBag(true)}
          isTouch={isTouch}
        />
      )}

      {mapOpen && <MapView map={session.map} playerRef={playerRef} mode="full" onClose={() => closeBag(true)} isTouch={isTouch} />}
      {minimap && started && !panelOpen && !dead && <MapView map={session.map} playerRef={playerRef} mode="mini" />}

      {sleeping && <div className="sleep-fade" aria-label="正在睡觉" />}

      {dead && (
        <div className="overlay death">
          <div className="panel" role="alertdialog" aria-label="你死了">
            <h1>你死了</h1>
            <p className="sub">{dead}。</p>
            <button type="button" className="primary" onClick={respawn}>
              重生
            </button>
            <p className="mode-note">会回到出生点，生命值回满，背包里的东西都还在。</p>
          </div>
        </div>
      )}

      {(!started || paused) && !panelOpen && !dead && !sleeping && (
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
                <li>底部快捷栏：选方块；最后一格是麦种，对着草地按“放”种地</li>
                <li>生存模式点右上角“背包”合成、“吃”吃东西</li>
              </ul>
            ) : (
              <ul className="help">
                <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动，<kbd>Shift</kbd> 跑，<kbd>空格</kbd> 跳</li>
                <li>鼠标转视角，左键挖，右键放，按住可以连续</li>
                <li><kbd>1</kbd>–<kbd>9</kbd> 或滚轮选方块；<kbd>0</kbd>、<kbd>-</kbd>：生存模式是空桶、水桶，创造模式是火把、水；<kbd>=</kbd> 麦种</li>
                <li>选麦种对着草地或泥土右键种地（生存模式要有石锄），附近有水长得快</li>
                <li>拿着麦种，绒耳兔会跟着你；对着它右键喂麦种，两只喂过的靠在一起会生小兔</li>
                <li><kbd>E</kbd> 打开背包和合成（创造模式是方块选择器），<kbd>R</kbd> 吃东西，<kbd>M</kbd> 大地图</li>
                <li>对着床右键睡觉（晚上睡到天亮，也是重生点），对着箱子右键存东西</li>
                <li>快捷栏最后一格（<kbd>=</kbd>）可以在背包里换成别的东西</li>
                <li><kbd>F</kbd> 飞行，飞行时 <kbd>空格</kbd> 上升、<kbd>C</kbd> 下降</li>
                <li>水里按 <kbd>空格</kbd> 往上游、<kbd>C</kbd> 往下潜，贴着岸按 <kbd>空格</kbd> 上岸</li>
                <li>火把要立在方块上，晚上能照亮周围；水会往低处和四周流</li>
                <li><kbd>Esc</kbd> 暂停</li>
              </ul>
            )}
            <div className="row mode-row" role="group" aria-label="游戏模式">
              <span className="clock">模式</span>
              <button type="button" className={mode === 'survival' ? 'on' : ''} aria-pressed={mode === 'survival'} onClick={() => switchMode('survival')}>
                生存
              </button>
              <button type="button" className={mode === 'creative' ? 'on' : ''} aria-pressed={mode === 'creative'} onClick={() => switchMode('creative')}>
                创造
              </button>
            </div>
            <p className="mode-note">
              {mode === 'survival'
                ? '有 10 颗心和 10 个鸡腿（饱食度）：会慢慢饿，跑跳、游泳、挖东西饿得更快，饱食度够才回血，饿到底会掉血，砍树叶找苹果、挖草方块找野莓，按 R 吃；从 4 格以上摔下来会掉血，掉进水里不会；在水下待太久会溺水；夜里黑暗处会出现夜影（可以在下面切换成和平），左键打它们；不受伤一会儿会慢慢回血。按住才能挖，挖到的方块进背包，放方块要消耗。合成镐、铲、斧挖得更快（自动使用），铁矿石要用镐挖，铁锭能做水桶。'
                : '方块无限，随便放。'}
            </p>
            {mode === 'survival' && (
              <>
                <div className="row mode-row" role="group" aria-label="怪物">
                  <span className="clock">怪物</span>
                  <button type="button" className={!peaceful ? 'on' : ''} aria-pressed={!peaceful} onClick={() => togglePeaceful(false)}>
                    有夜影
                  </button>
                  <button type="button" className={peaceful ? 'on' : ''} aria-pressed={peaceful} onClick={() => togglePeaceful(true)}>
                    和平
                  </button>
                </div>
                <p className="mode-note">
                  {peaceful
                    ? '和平：不会出现夜影，已经出现的也会消失；不会饿，还会慢慢吃饱。摔落和溺水照样会受伤。'
                    : '夜里黑暗处会出现夜影，火把照着的地方不会有。'}
                </p>
              </>
            )}
            <div className="row mode-row volume-row">
              <span className="clock">音量</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(audio.volume * 100)}
                aria-label="音量"
                onChange={(e) => setAudio((a) => ({ ...a, volume: Number(e.target.value) / 100 }))}
              />
              <button type="button" className={audio.muted ? 'on' : ''} aria-pressed={audio.muted} onClick={() => setAudio((a) => ({ ...a, muted: !a.muted }))}>
                {audio.muted ? '已静音' : '静音'}
              </button>
            </div>
            <div className="row mode-row">
              <span className="clock">小地图</span>
              <button
                type="button"
                className={minimap ? 'on' : ''}
                aria-pressed={minimap}
                onClick={() => {
                  setMinimap((m) => {
                    try {
                      localStorage.setItem(MINIMAP_KEY, m ? '0' : '1');
                    } catch {
                      // 存不了也没关系
                    }
                    return !m;
                  });
                }}
              >
                {minimap ? '显示' : '隐藏'}
              </button>
              <button type="button" onClick={openMap}>看大地图</button>
            </div>
            <div className="row time-row">
              <span className="clock">游戏时间 {clockText(timeRef.current)}</span>
              <button type="button" onClick={() => setTime(MORNING, '天亮了')}>白天</button>
              <button type="button" onClick={() => setTime(NIGHT, '天黑了')}>夜晚</button>
            </div>
            <div className="row time-row" role="group" aria-label="天气">
              <span className="clock">天气</span>
              <button
                type="button"
                className={session.weather.state === 'clear' ? 'on' : ''}
                aria-pressed={session.weather.state === 'clear'}
                onClick={() => {
                  setWeather(session.weather, 'clear');
                  setTimeTick((n) => n + 1);
                  showToast('雨会慢慢停');
                }}
              >
                晴
              </button>
              <button
                type="button"
                className={session.weather.state === 'rain' ? 'on' : ''}
                aria-pressed={session.weather.state === 'rain'}
                onClick={() => {
                  setWeather(session.weather, 'rain');
                  setTimeTick((n) => n + 1);
                  showToast('要下雨了（雪原下雪，沙漠不下）');
                }}
              >
                下雨
              </button>
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
