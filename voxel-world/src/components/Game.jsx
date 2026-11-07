import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ChunkRenderer } from '../game/renderer.js';
import { lightBrightness } from '../game/light.js';
import { sound, soundMaterial, stepFootsteps } from '../game/sound.js';
import { raycast } from '../game/raycast.js';
import { EYE_HEIGHT, eyeInWater, overlapsBlock, stepPlayer } from '../game/player.js';
import { AIR, BLOCKS, CHEST, EGG, FARMLAND, TORCH, WATER, WHEAT_BASE, isCrop, isLiquid } from '../game/blocks.js';
import { chestKey, emptyChestInto } from '../game/home.js';
import { doorPlacement, ladderPlacement, toggleDoor } from '../game/building.js';
import { GROW_STEP, cropDrops, plantTarget } from '../game/farming.js';
import {
  BUCKET, SURVIVAL_HOTBAR, WATER_BUCKET, addItem, countOf, dropFor, itemName, takeItem,
} from '../game/items.js';
import { digInfo, toolKindName } from '../game/tools.js';
import { EXHAUSTION, addExhaustion, fallDamage, hurt, regenerate, updateAir, updateHunger } from '../game/health.js';
import { attackDamage } from '../game/tools.js';
import { COAL, DOOR_ITEM, LADDER_ITEM, SEEDS, STONE_HOE, bonusDrop } from '../game/items.js';
import {
  damageMonster, rayHitMonster, shouldRemove, stepMonster, trySpawn, DISSOLVE_SECONDS, SUNLIT,
} from '../game/monsters.js';
import {
  BABY_SCALE, SPECIES, animalDrops, animalName, breed, damageAnimal, feedAnimal, foodFor, shouldRemoveAnimal,
  stepAnimal, trySpawnAnimal,
} from '../game/animals.js';
import { DAY_SECONDS, clockText, skyAt, wrapTime } from '../game/daynight.js';

const REACH = 6;
const REPEAT_SECONDS = 0.22;
const SKY_DISTANCE = 200;
const FLUID_STEP = 0.25; // 水每 0.25 秒流一格

// 给 Lambert 材质加上天光和火把光：每个顶点带 skyLight 和 blockLight（0–1）。
// 日光/月光照明先乘上天光（洞里、屋里是暗的），再和火把照明取较亮的那个，
// 所以白天火把不会把东西照得过曝，洞里只有火把能照亮。
function withBlockLight(material) {
  const torch = { value: new THREE.Color('#ffc27a') };
  material.userData.torch = torch;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTorchColor = torch;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float blockLight;\nattribute float skyLight;\nvarying float vBlockLight;\nvarying float vSkyLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlockLight = blockLight;\nvSkyLight = skyLight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTorchColor;\nvarying float vBlockLight;\nvarying float vSkyLight;')
      .replace(
        '#include <opaque_fragment>',
        'outgoingLight *= max(vSkyLight, 0.035);\noutgoingLight = max(outgoingLight, diffuseColor.rgb * vBlockLight * uTorchColor);\n#include <opaque_fragment>',
      );
  };
  return material;
}

// ---------- 天空：颜色、光照、太阳、月亮、星星、雾、水下 ----------
function Environment({ world, playerRef, timeRef, activeRef, cloudMaterial }) {
  const { scene, camera } = useThree();
  const sun = useRef();
  const hemi = useRef();
  const sunMesh = useRef();
  const moonMesh = useRef();
  const stars = useRef();

  const { background, fog, starGeometry } = useMemo(() => {
    const pts = [];
    let s = 12345;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 700; i++) {
      // 只在上半球撒星星
      const u = rand() * 2 * Math.PI;
      const v = rand() * 0.95 + 0.05;
      const r = Math.sqrt(1 - v * v);
      pts.push(Math.cos(u) * r * SKY_DISTANCE, v * SKY_DISTANCE, Math.sin(u) * r * SKY_DISTANCE);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return { background: new THREE.Color(), fog: new THREE.Fog(0xffffff, 28, 92), starGeometry: g };
  }, []);

  useEffect(() => {
    scene.background = background;
    scene.fog = fog;
    return () => {
      scene.background = null;
      scene.fog = null;
      starGeometry.dispose();
    };
  }, [scene, background, fog, starGeometry]);

  const tmp = useMemo(() => ({ c: new THREE.Color(), warm: new THREE.Color('#ffc890'), white: new THREE.Color('#fffaf0'), moon: new THREE.Color('#a8bcff'), night: new THREE.Color('#6676b0'), deep: new THREE.Color('#06213f'), shallow: new THREE.Color('#1557a0') }), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    if (activeRef.current) timeRef.current = wrapTime(timeRef.current + dt / DAY_SECONDS);
    const s = skyAt(timeRef.current);
    const p = playerRef.current;

    // 天空和雾同色，远处的地形会融进天空
    background.setRGB(s.sky[0], s.sky[1], s.sky[2], THREE.SRGBColorSpace);
    const underwater = eyeInWater(world, p);
    if (underwater) {
      tmp.c.copy(tmp.deep).lerp(tmp.shallow, s.day);
      background.copy(tmp.c);
      fog.color.copy(tmp.c);
      fog.near = 0.5;
      fog.far = 9;
    } else {
      fog.color.copy(background);
      fog.near = 28;
      fog.far = 92;
    }

    // 白天用太阳当主光源，晚上换成蓝白色的月光
    const isDay = s.elevation > -0.05;
    const dir = isDay ? s.sunDir : s.sunDir.map((v) => -v);
    if (sun.current) {
      sun.current.position.set(dir[0] * 100, dir[1] * 100, dir[2] * 100);
      sun.current.intensity = isDay ? s.sunIntensity : s.moonIntensity;
      if (isDay) sun.current.color.copy(tmp.white).lerp(tmp.warm, s.dusk);
      else sun.current.color.copy(tmp.moon);
    }
    if (hemi.current) {
      hemi.current.intensity = s.ambient;
      hemi.current.color.copy(tmp.white).lerp(tmp.night, 1 - s.day);
    }

    // 太阳、月亮、星星跟着镜头走，看起来在无限远
    const cam = camera.position;
    if (sunMesh.current) {
      sunMesh.current.position.set(cam.x + s.sunDir[0] * SKY_DISTANCE, cam.y + s.sunDir[1] * SKY_DISTANCE, cam.z + s.sunDir[2] * SKY_DISTANCE);
      sunMesh.current.lookAt(cam);
      sunMesh.current.visible = s.sunDir[1] > -0.15 && !underwater;
    }
    if (moonMesh.current) {
      moonMesh.current.position.set(cam.x - s.sunDir[0] * SKY_DISTANCE, cam.y - s.sunDir[1] * SKY_DISTANCE, cam.z - s.sunDir[2] * SKY_DISTANCE);
      moonMesh.current.lookAt(cam);
      moonMesh.current.visible = s.sunDir[1] < 0.15 && !underwater;
    }
    if (stars.current) {
      stars.current.position.copy(cam);
      stars.current.material.opacity = underwater ? 0 : s.stars;
      stars.current.visible = s.stars > 0.01 && !underwater;
    }
    cloudMaterial.color.setRGB(0.07 + 0.93 * s.day, 0.08 + 0.92 * s.day, 0.13 + 0.87 * s.day);
    cloudMaterial.color.lerp(tmp.warm, s.dusk * 0.35);
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#ffffff', '#9a8a70', 1.6]} />
      <directionalLight ref={sun} intensity={1.7} />
      <mesh ref={sunMesh} renderOrder={-1}>
        <planeGeometry args={[18, 18]} />
        <meshBasicMaterial color="#fff2b0" fog={false} depthWrite={false} />
      </mesh>
      <mesh ref={moonMesh} renderOrder={-1}>
        <planeGeometry args={[12, 12]} />
        <meshBasicMaterial color="#e6ecff" fog={false} depthWrite={false} />
      </mesh>
      <points ref={stars} geometry={starGeometry} renderOrder={-2}>
        <pointsMaterial color="#ffffff" size={2} sizeAttenuation={false} transparent opacity={0} fog={false} depthWrite={false} />
      </points>
    </>
  );
}

function Clouds({ world, material }) {
  const ref = useRef();
  const boxes = useMemo(() => {
    let s = world.seed;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return Array.from({ length: 36 }, () => ({
      x: rand() * world.sizeX * 1.6 - world.sizeX * 0.3,
      z: rand() * world.sizeZ * 1.6 - world.sizeZ * 0.3,
      w: 6 + rand() * 14,
      d: 4 + rand() * 10,
    }));
  }, [world]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.position.x += dt * 0.8;
    if (ref.current.position.x > world.sizeX) ref.current.position.x -= world.sizeX * 1.6;
  });
  return (
    <group ref={ref} position={[0, world.sizeY + 14, 0]}>
      {boxes.map((b, i) => (
        <mesh key={i} position={[b.x, 0, b.z]} material={material}>
          <boxGeometry args={[b.w, 1.5, b.d]} />
        </mesh>
      ))}
    </group>
  );
}

// 准星对着的方块：黑色线框；生存模式挖的时候方块慢慢变暗，表示挖的进度
function Highlight({ targetRef, digRef }) {
  const ref = useRef();
  const crack = useRef();
  const geometry = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), []);
  useFrame(() => {
    const t = targetRef.current;
    if (!ref.current) return;
    ref.current.visible = !!t;
    if (t) ref.current.position.set(t.hit[0] + 0.5, t.hit[1] + 0.5, t.hit[2] + 0.5);
    const progress = digRef.current.progress;
    if (crack.current) {
      crack.current.visible = !!t && progress > 0;
      if (t) crack.current.position.copy(ref.current.position);
      crack.current.material.opacity = Math.min(0.6, progress * 0.6);
      // 越挖越碎：稍微缩一点
      crack.current.scale.setScalar(1.006 - progress * 0.03);
    }
  });
  return (
    <>
      <lineSegments ref={ref} geometry={geometry} visible={false}>
        <lineBasicMaterial color="#111111" transparent opacity={0.7} />
      </lineSegments>
      <mesh ref={crack} visible={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#000000" transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}

function Controller({ world, sim, renderer, materials, input, playerRef, selectedRef, modeRef, inventory, onInventory, onEdit, onMessage, statsRef, activeRef, onFlyingChange, timeRef, underwaterRef, digUiRef, hurtUiRef, onHealth, onDeath, onAir, onHunger, monsters, animals, peacefulRef, chests, onOpenChest, onSleep, map }) {
  const { camera } = useThree();
  const targetRef = useRef(null);
  const statsTimer = useRef(0);
  const fluidTimer = useRef(0);
  const growTimer = useRef(0);
  const animalTimer = useRef(0);
  const mapTimer = useRef(0);
  // 音效用到的状态：脚步走了多远、上一帧在不在水里、挖方块的敲击、游泳划水
  const sfx = useRef({ walked: 0, wasInWater: false, digTick: 0, swim: 0, lastPos: null });
  const flicker = useMemo(() => ({ base: new THREE.Color('#ffc27a'), t: 0 }), []);
  const lastAir = useRef(null);
  const lastHunger = useRef(null);
  const spawnTimer = useRef(0);
  const attackTimer = useRef(0);
  const lastFlying = useRef(playerRef.current.flying);
  // 生存模式挖方块的进度：key 是正在挖的方块坐标
  const digRef = useRef({ key: null, progress: 0, warned: null });

  // 生存模式：挖到的东西放进背包
  const pickUp = (id) => {
    if (id === null) return;
    addItem(inventory, id);
    if (!SURVIVAL_HOTBAR.includes(id)) onMessage(`+1 ${itemName(id)}`);
  };

  const lookDir = () => new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

  const dig = (t) => {
    const survival = modeRef.current === 'survival';
    const [x, y, z] = t.hit;
    const dirty = sim.edit(x, y, z, AIR);
    if (!dirty) return;
    const fell = sim.lastRemoved; // 因为没了支撑一起掉下来的东西
    renderer.rebuildKeys(dirty);
    sound.block(soundMaterial(t.block), [x + 0.5, y + 0.5, z + 0.5], 'break');
    // 挖掉箱子：里面的东西倒进背包
    if (t.block === CHEST) {
      const n = emptyChestInto(chests, chestKey(x, y, z), inventory);
      if (n) {
        onMessage(`箱子里的 ${n} 件东西放进了背包`);
        onInventory();
      }
    }
    if (survival) {
      if (isCrop(t.block)) {
        for (const [id, n] of cropDrops(t.block)) for (let i = 0; i < n; i++) pickUp(id); // 收割
      } else {
        pickUp(dropFor(t.block));
        pickUp(bonusDrop(t.block)); // 树叶里的苹果、草里的野莓和麦种
      }
      addExhaustion(playerRef.current, EXHAUSTION.dig);
      // 跟着掉下来的火把、庄稼、蛋、门、梯子也捡起来
      for (const id of fell) {
        if (isCrop(id)) for (const [d, n] of cropDrops(id)) for (let i = 0; i < n; i++) pickUp(d);
        else pickUp(dropFor(id));
      }
      onInventory();
    }
    onEdit();
  };

  // 空桶：对着水源装水
  const fillBucket = () => {
    const w = raycast(world, camera.position.toArray(), lookDir().toArray(), REACH, { liquids: true });
    if (!w || !isLiquid(w.block)) return onMessage('对着水用空桶，可以装一桶水');
    if (w.block !== WATER) return onMessage('只能装不流动的水（水源）');
    const dirty = sim.edit(w.hit[0], w.hit[1], w.hit[2], AIR);
    if (!dirty) return;
    renderer.rebuildKeys(dirty);
    sound.bucket(true);
    takeItem(inventory, BUCKET);
    addItem(inventory, WATER_BUCKET);
    onInventory();
    onEdit();
  };

  // 用麦种对着草地 / 泥土 / 耕地右键：需要的话先用锄头翻土，再种下
  const plant = (t) => {
    if (!t) return;
    const survival = modeRef.current === 'survival';
    const target = plantTarget(world, t.hit);
    if (target.error) return onMessage(target.error);
    if (target.till && survival && countOf(inventory, STONE_HOE) <= 0) {
      return onMessage('要先翻土：用石头和木棍合成石锄');
    }
    const dirty = new Set();
    const add = (d) => d && d.forEach((k) => dirty.add(k));
    if (target.till) add(sim.edit(...target.base, FARMLAND));
    add(sim.edit(...target.above, WHEAT_BASE));
    if (!dirty.size) return;
    renderer.rebuildKeys(dirty);
    sound.block('leaves', [target.above[0] + 0.5, target.above[1] + 0.5, target.above[2] + 0.5], 'place');
    if (survival) {
      takeItem(inventory, SEEDS);
      addExhaustion(playerRef.current, EXHAUSTION.dig);
      onInventory();
    }
    onEdit();
  };

  // 对着动物右键：用背包里它爱吃的东西喂它（创造模式不消耗）
  const feed = (e) => {
    const survival = modeRef.current === 'survival';
    const sp = SPECIES[e.species];
    const food = foodFor(e);
    if (e.baby) return onMessage(`${animalName(e)}还太小，不用喂`);
    if (survival && countOf(inventory, food) <= 0) return onMessage(`${sp.name}爱吃${itemName(food)}，背包里没有`);
    if (!feedAnimal(e)) {
      return onMessage(e.love > 0 ? `它已经吃过了，再喂一只${sp.name}` : `它刚生过${sp.babyName}，过一会儿再喂`);
    }
    if (survival) {
      takeItem(inventory, food);
      onInventory();
    }
    sound.eat();
    sound.animal(e.species, e.pos, 'idle');
    onMessage(`喂了${sp.name}${itemName(food)}：再喂一只靠近它的${sp.name}，就会生${sp.babyName}`);
  };

  // 改好几格，一起重建、出声、扣东西
  const applyCells = (cells, item, material) => {
    const dirty = new Set();
    for (const [x, y, z, id] of cells) sim.edit(x, y, z, id)?.forEach((k) => dirty.add(k));
    if (!dirty.size) return false;
    renderer.rebuildKeys(dirty);
    const [x, y, z] = cells[0];
    sound.block(material, [x + 0.5, y + 0.5, z + 0.5], 'place');
    if (item !== null && modeRef.current === 'survival') {
      takeItem(inventory, item);
      onInventory();
    }
    onEdit();
    return true;
  };

  // 放门（两格高，门板朝着玩家面对的方向）和梯子（贴在点中的墙上）
  const build = (t, item) => {
    if (!t) return;
    const p = playerRef.current;
    if (item === DOOR_ITEM) {
      const r = doorPlacement(world, t.hit[0] + t.normal[0], t.hit[1] + t.normal[1], t.hit[2] + t.normal[2], p.yaw);
      if (r.error) return onMessage(r.error);
      if (r.cells.some(([x, y, z]) => overlapsBlock(p, x, y, z))) return onMessage('站开一点再放门');
      return applyCells(r.cells, item, 'wood');
    }
    const r = ladderPlacement(world, t.hit, t.normal);
    if (r.error) return onMessage(r.error);
    return applyCells([r.cell], item, 'wood');
  };

  // 开关门：站在门口时关不上
  const useDoor = (t) => {
    const cells = toggleDoor(world, ...t.hit);
    if (!cells) return;
    const closing = !BLOCKS[cells[0][3]].passable;
    if (closing && cells.some(([x, y, z]) => overlapsBlock(playerRef.current, x, y, z))) return onMessage('站在门口关不上门');
    const dirty = new Set();
    for (const [x, y, z, id] of cells) sim.edit(x, y, z, id)?.forEach((k) => dirty.add(k));
    renderer.rebuildKeys(dirty);
    sound.door(!closing, [cells[0][0] + 0.5, cells[0][1] + 1, cells[0][2] + 0.5]);
    onEdit();
  };

  const place = (t) => {
    const survival = modeRef.current === 'survival';
    const selected = selectedRef.current;
    const target = entityInSight();
    if (target && isAnimal(target)) return feed(target);
    // 对着床 / 箱子右键是用它，不是放方块
    const use = t && BLOCKS[t.block]?.interact;
    if (use === 'chest') return onOpenChest(chestKey(...t.hit));
    if (use === 'sleep') return onSleep([...t.hit]);
    if (use === 'door') return useDoor(t);
    if (survival && countOf(inventory, selected) <= 0) {
      if (selected === SEEDS) return onMessage('没有麦种了：挖草方块有时能挖到，收割小麦也会给');
      return onMessage(`没有${itemName(selected)}了，${selected < 100 ? '去背包里合成或者挖一些' : '可以在背包里合成'}`);
    }
    if (selected === BUCKET) return fillBucket();
    if (selected === SEEDS) return plant(t);
    if (selected === DOOR_ITEM || selected === LADDER_ITEM) return build(t, selected);
    if (!t) return;
    const x = t.hit[0] + t.normal[0];
    const y = t.hit[1] + t.normal[1];
    const z = t.hit[2] + t.normal[2];
    const here = world.get(x, y, z);
    // 空气和水的位置都能放方块（放进水里就把水换掉）
    if (!world.inBounds(x, y, z) || (here !== AIR && !isLiquid(here))) return;
    // 水桶倒出来的是一格水源
    const id = selected === WATER_BUCKET ? WATER : selected;
    if (id === TORCH) {
      if (here !== AIR) return onMessage('火把不能放在水里');
      if (!world.isSolidBlock(x, y - 1, z)) return onMessage('火把要立在方块上面');
    } else if (!BLOCKS[id]?.passable && overlapsBlock(playerRef.current, x, y, z)) {
      return;
    }
    const dirty = sim.edit(x, y, z, id);
    if (!dirty) return;
    renderer.rebuildKeys(dirty);
    if (id === WATER) sound.bucket(false);
    else sound.block(soundMaterial(id), [x + 0.5, y + 0.5, z + 0.5], 'place');
    if (survival) {
      takeItem(inventory, selected);
      if (selected === WATER_BUCKET) addItem(inventory, BUCKET);
      onInventory();
    }
    onEdit();
  };

  // 生存模式按住挖：按方块硬度和背包里的工具算时间
  const updateDigging = (dt, active) => {
    const d = digRef.current;
    const t = targetRef.current;
    // 按住时对着怪物 / 动物就连续打它，不挖后面的方块
    const m = active && input.held.dig ? entityInSight() : null;
    if (!active || !input.held.dig || !t || m) {
      if (m) attack(m);
      d.key = null;
      d.progress = 0;
      return;
    }
    const key = t.hit.join(',');
    if (d.key !== key) {
      d.key = key;
      d.progress = 0;
    }
    const info = digInfo(t.block, inventory);
    if (info.time === Infinity) {
      if (d.warned !== key) {
        d.warned = key;
        onMessage(info.needs ? `挖${itemName(t.block)}需要${toolKindName(info.needs)}` : `${itemName(t.block)}挖不动`);
      }
      d.progress = 0;
      return;
    }
    d.progress += info.time > 0 ? dt / info.time : 1;
    // 挖的过程中一下下地敲
    sfx.current.digTick -= dt;
    if (sfx.current.digTick <= 0 && d.progress < 1) {
      sfx.current.digTick = 0.24;
      sound.block(soundMaterial(t.block), [t.hit[0] + 0.5, t.hit[1] + 0.5, t.hit[2] + 0.5], 'hit');
    }
    if (d.progress >= 1) {
      dig(t);
      d.key = null;
      d.progress = 0;
    }
  };

  // 准星对着的怪物（比方块近才算）
  // 准星对着的怪物或动物（比方块近才算）。怪物只在生存模式里有。
  const entityInSight = () => {
    const list = modeRef.current === 'survival' ? [...monsters, ...animals] : animals;
    if (!list.length) return null;
    const hit = rayHitMonster(camera.position.toArray(), lookDir().toArray(), 3.5, list);
    const t = targetRef.current;
    if (!hit || (t && t.distance < hit.distance)) return null;
    return hit.monster;
  };
  const isAnimal = (e) => Boolean(e.species);

  const attack = (e) => {
    if (attackTimer.current > 0) return;
    attackTimer.current = 0.35;
    const survival = modeRef.current === 'survival';
    if (survival) addExhaustion(playerRef.current, EXHAUSTION.attack);
    const from = playerRef.current.pos;
    if (isAnimal(e)) {
      sound.animal(e.species, e.pos, 'hit');
      if (!damageAnimal(e, attackDamage(inventory), from, { hostile: survival && !peacefulRef.current })) return;
      e.dissolve = 0.01;
      if (survival) {
        for (const [id, n] of animalDrops(e)) for (let i = 0; i < n; i++) pickUp(id);
        onInventory();
      }
      return;
    }
    sound.monster(e.pos, 'hit');
    if (damageMonster(e, attackDamage(inventory), from)) {
      sound.monster(e.pos, 'die');
      e.dissolve = 0.01; // 被打死：消散掉
      if (Math.random() < 0.5) {
        pickUp(COAL);
        onInventory();
      }
    }
  };

  const doAction = (kind) => {
    const t = targetRef.current;
    if (kind === 'place') return place(t);
    const m = entityInSight();
    if (m) return attack(m);
    if (!t || BLOCKS[t.block]?.unbreakable) return;
    // 生存模式靠按住慢慢挖（见 updateDigging），只有火把这种一碰就掉的直接挖
    if (modeRef.current === 'survival' && digInfo(t.block, inventory).time > 0) return;
    dig(t);
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const p = playerRef.current;
    const keys = input.keys;
    const active = activeRef.current;

    // 视角
    p.yaw -= input.lookX;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - input.lookY));
    input.lookX = 0;
    input.lookY = 0;

    const k = (c) => (active && keys.has(c) ? 1 : 0);
    const move = active ? input.move : { x: 0, y: 0 };
    const control = {
      forward: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - move.y,
      right: k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + move.x,
      jump: k('Space') || (active && input.touchJump),
      down: k('KeyC') || k('ControlLeft') || (active && input.touchDown),
      sprint: k('ShiftLeft') || k('ShiftRight') || Math.hypot(move.x, move.y) > 0.95,
    };
    const prev = sfx.current.lastPos ?? p.pos;
    const landed = stepPlayer(world, p, control, dt);
    const moving = Math.hypot(control.forward, control.right) > 0.1;
    // 脚步、落地、落水、划水
    {
      const st = sfx.current;
      const moved = Math.hypot(p.pos[0] - prev[0], p.pos[2] - prev[2]);
      st.lastPos = [...p.pos];
      const feet = [p.pos[0], p.pos[1], p.pos[2]];
      const below = world.get(Math.floor(p.pos[0]), Math.floor(p.pos[1] - 0.05), Math.floor(p.pos[2]));
      if (active && !p.flying && !p.inWater && stepFootsteps(st, moved, { onGround: p.onGround, sprinting: control.sprint })) {
        sound.block(soundMaterial(below), feet, 'step');
      }
      if (landed > 1.2) sound.land(feet, landed);
      if (p.inWater && !st.wasInWater && Math.abs(p.vel[1]) > 2) sound.splash(feet, true);
      st.wasInWater = p.inWater;
      if (p.inWater && moving) {
        st.swim -= dt;
        if (st.swim <= 0) {
          st.swim = 0.9;
          sound.splash(feet, false);
        }
      }
    }
    const jumps = p.jumps;
    p.jumps = 0;

    // 生存模式：摔落、溺水、怪物，以及慢慢回血
    attackTimer.current = Math.max(0, attackTimer.current - dt);
    const takeDamage = (amount, cause) => {
      if (modeRef.current !== 'survival' || p.health <= 0 || hurt(p, amount) <= 0) return;
      sound.hurt();
        const el = hurtUiRef.current;
        if (el) {
          el.classList.remove('hit');
          void el.offsetWidth; // 重新播放闪红动画
          el.classList.add('hit');
        }
        onHealth(p.health);
        if (p.health <= 0) onDeath(cause);
    };
    if (modeRef.current === 'survival' && p.health > 0) {
      const health0 = p.health;
      takeDamage(fallDamage(landed), `从 ${Math.round(landed)} 格高的地方摔了下来`);
      if (active) {
        takeDamage(updateAir(p, eyeInWater(world, p), dt), '淹死了');
        const hunger0 = p.hunger;
        takeDamage(
          updateHunger(p, dt, {
            sprinting: control.sprint && moving && !p.inWater && !p.flying,
            swimming: p.inWater && moving,
            jumps,
            peaceful: peacefulRef.current,
          }),
          '饿死了',
        );
        if (p.hunger !== lastHunger.current) {
          lastHunger.current = p.hunger;
          onHunger(p.hunger);
          if (hunger0 > 6 && p.hunger <= 6) onMessage('肚子饿了，快吃点东西');
        }
        const air = Math.ceil(p.air);
        if (air !== lastAir.current) {
          lastAir.current = air;
          onAir(air);
        }

        // 怪物：夜里在黑暗处出现，天亮后消散；和平模式下没有怪物
        if (peacefulRef.current) monsters.length = 0;
        const day = skyAt(timeRef.current).day > 0.5;
        spawnTimer.current += dt;
        if (!peacefulRef.current && spawnTimer.current > 2) {
          spawnTimer.current = 0;
          trySpawn(world, monsters, p, Math.random, { night: !day }); // 洞里白天也会有
        }
        for (const m of monsters) {
          // 只有晒得到太阳的才会消散（洞里的不会）
          const sunlit = day && world.skyAt(Math.floor(m.pos[0]), Math.floor(m.pos[1] + 0.4), Math.floor(m.pos[2])) >= SUNLIT;
          const bite = stepMonster(world, m, p, dt, { day: sunlit });
          // 离得近时偶尔咕噜一声
          m.growl = (m.growl ?? 2 + Math.random() * 4) - dt;
          if (m.growl <= 0 && m.dissolve === 0) {
            m.growl = 3 + Math.random() * 5;
            sound.monster(m.pos, 'growl');
          }
          if (bite) {
            // 被咬到往后弹一下
            const dx = p.pos[0] - m.pos[0];
            const dz = p.pos[2] - m.pos[2];
            const len = Math.hypot(dx, dz) || 1;
            p.vel[0] += (dx / len) * 7;
            p.vel[2] += (dz / len) * 7;
            p.vel[1] = Math.max(p.vel[1], 5);
            takeDamage(bite, '被夜影咬倒了');
          }
          if (m.dissolve > 0) m.dissolve += dt * (m.health <= 0 ? 2 : 0); // 被打死的消散得更快
        }
        for (let i = monsters.length - 1; i >= 0; i--) {
          if (shouldRemove(monsters[i], p)) monsters.splice(i, 1);
        }
      }
      if (active && p.health === health0 && regenerate(p, dt)) onHealth(p.health);
    } else if (monsters.length) {
      monsters.length = 0; // 创造模式没有怪物
    }

    if (p.flying !== lastFlying.current) {
      lastFlying.current = p.flying;
      onFlyingChange(p.flying);
    }

    camera.position.set(p.pos[0], p.pos[1] + EYE_HEIGHT, p.pos[2]);
    // 远处还没建好的区块每帧建一点；离太远的区块不画
    renderer.update(p.pos[0], p.pos[2], 6);
    // 地图：每半秒点亮走过的地方、更新改过的区块
    mapTimer.current += dt;
    if (map && mapTimer.current > 0.5) {
      mapTimer.current = 0;
      map.explore(p.pos[0], p.pos[2]);
      map.flush();
    }
    sound.setListener([p.pos[0], p.pos[1] + EYE_HEIGHT, p.pos[2]], p.yaw);
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');

    // 准星对着的方块
    targetRef.current = raycast(world, camera.position.toArray(), lookDir().toArray(), REACH);

    // 挖 / 放：点一下立即执行，按住持续执行（生存模式的挖另外按进度算）
    const survival = modeRef.current === 'survival';
    while (input.actions.length) doAction(input.actions.shift());
    if (survival) updateDigging(dt, active);
    else digRef.current.progress = 0;
    if (digUiRef.current) {
      const pr = digRef.current.progress;
      digUiRef.current.style.setProperty('--dig', String(pr));
      digUiRef.current.classList.toggle('on', pr > 0);
    }
    for (const kind of ['dig', 'place']) {
      if (!active || !input.held[kind]) continue;
      if (kind === 'dig' && survival) continue;
      input.held[kind + 'Timer'] = (input.held[kind + 'Timer'] || 0) + dt;
      if (input.held[kind + 'Timer'] >= REPEAT_SECONDS) {
        input.held[kind + 'Timer'] = 0;
        doAction(kind);
      }
    }

    // 动物：白天在各自住的地方出现（两种模式都有）
    if (active) {
      const daylight = skyAt(timeRef.current).day > 0.5;
      animalTimer.current += dt;
      const every = animals.length < 4 ? 1 : 5;
      if (daylight && animalTimer.current > every) {
        animalTimer.current = 0;
        trySpawnAnimal(world, animals, p);
      }
      // 选着麦种那一格时，背包里有它爱吃的东西的动物会跟过来
      const survival = modeRef.current === 'survival';
      const holdingFeed = selectedRef.current === SEEDS;
      const lure = (species) => holdingFeed && (!survival || countOf(inventory, SPECIES[species].food) > 0);
      const hostile = survival && !peacefulRef.current;
      for (const a of animals) {
        const ev = stepAnimal(world, a, p, dt, { lure, hostile });
        if (a.dissolve > 0) a.dissolve += dt * 2;
        // 野猪和鸭子时不时叫一声（兔子很安静）
        if (a.species !== 'rabbit' && a.dissolve === 0) {
          a.call = (a.call ?? 3 + Math.random() * 8) - dt;
          if (a.call <= 0) {
            a.call = 6 + Math.random() * 10;
            sound.animal(a.species, a.pos, 'idle');
          }
        }
        if (ev.damage) {
          const dx = p.pos[0] - a.pos[0];
          const dz = p.pos[2] - a.pos[2];
          const len = Math.hypot(dx, dz) || 1;
          p.vel[0] += (dx / len) * 6;
          p.vel[2] += (dz / len) * 6;
          p.vel[1] = Math.max(p.vel[1], 4.5);
          takeDamage(ev.damage, `被${SPECIES[a.species].name}撞倒了`);
        }
        // 下蛋：脚下那格空着、下面是实心方块才放得下
        if (ev.egg) {
          const [ex, ey, ez] = ev.egg;
          if (world.get(ex, ey, ez) === AIR && world.isSolidBlock(ex, ey - 1, ez)) {
            const dirty = sim.edit(ex, ey, ez, EGG);
            if (dirty) {
              sound.block('egg', [ex + 0.5, ey + 0.2, ez + 0.5], 'place');
              renderer.rebuildKeys(dirty);
              onEdit();
            }
          }
        }
      }
      const born = breed(animals);
      if (born) onMessage(`生了一只${SPECIES[born.species].babyName}！`);
      for (let i = animals.length - 1; i >= 0; i--) {
        if (shouldRemoveAnimal(animals[i])) animals.splice(i, 1);
      }
    }

    // 庄稼生长
    if (active) {
      growTimer.current += dt;
      if (growTimer.current >= GROW_STEP) {
        growTimer.current = 0;
        const dirty = sim.grow();
        if (dirty) {
          renderer.rebuildKeys(dirty);
          onEdit();
        }
      }
    }

    // 水流
    if (active) {
      fluidTimer.current += dt;
      if (fluidTimer.current >= FLUID_STEP) {
        fluidTimer.current = 0;
        const dirty = sim.tick();
        if (dirty) {
          renderer.rebuildKeys(dirty);
          onEdit();
        }
      }
    }

    // 火光轻轻闪烁
    flicker.t += dt;
    const f = 1 + Math.sin(flicker.t * 9) * 0.03 + Math.sin(flicker.t * 23.7) * 0.025;
    materials.solid.userData.torch.value.copy(flicker.base).multiplyScalar(f);
    materials.water.userData.torch.value.copy(flicker.base).multiplyScalar(f);

    if (underwaterRef.current) {
      underwaterRef.current.classList.toggle('on', eyeInWater(world, p));
    }

    statsTimer.current += dt;
    if (statsTimer.current > 0.25 && statsRef.current) {
      statsTimer.current = 0;
      const t = targetRef.current;
      statsRef.current.textContent =
        `${clockText(timeRef.current)}  X ${p.pos[0].toFixed(1)}  Y ${p.pos[1].toFixed(1)}  Z ${p.pos[2].toFixed(1)}` +
        (p.flying ? '  · 飞行中' : p.inWater ? '  · 游泳中' : '') +
        ((e) => (e ? `  · 对准：${isAnimal(e) ? animalName(e) : '夜影'}` : t ? `  · 对准：${BLOCKS[t.block]?.name ?? '?'}` : ''))(entityInSight());
    }
  });

  return <Highlight targetRef={targetRef} digRef={digRef} />;
}

// 怪物和动物站的地方有多亮：天光和火把光取亮的那个（洞里很暗）
function entityBrightness(world, pos, height) {
  const x = Math.floor(pos[0]);
  const y = Math.floor(pos[1] + height * 0.5);
  const z = Math.floor(pos[2]);
  return Math.max(0.06, lightBrightness(world.skyAt(x, y, z)), lightBrightness(world.lightAt(x, y, z)));
}

// 夜影的样子：深紫色的方块身体，两只发黄光的眼睛，跳的时候会被拉长、压扁
function Monsters({ monsters, world }) {
  const group = useRef();
  const shared = useMemo(
    () => ({
      body: new THREE.BoxGeometry(0.8, 0.8, 0.8),
      eye: new THREE.BoxGeometry(0.14, 0.12, 0.04),
      eyeMat: new THREE.MeshBasicMaterial({ color: '#ffe14d', fog: false }),
      red: new THREE.Color('#ff3030'),
      base: new THREE.Color('#3b2a55'),
    }),
    [],
  );
  const meshes = useRef(new Map());

  useEffect(
    () => () => {
      for (const obj of meshes.current.values()) obj.userData.mat.dispose();
      meshes.current.clear();
      Object.values(shared).forEach((v) => v.dispose?.());
    },
    [shared],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const alive = new Set();
    for (const m of monsters) {
      alive.add(m.id);
      let obj = meshes.current.get(m.id);
      if (!obj) {
        obj = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: shared.base, emissive: '#160c26', transparent: true });
        const body = new THREE.Mesh(shared.body, mat);
        body.position.y = 0.4;
        const left = new THREE.Mesh(shared.eye, shared.eyeMat);
        const right = new THREE.Mesh(shared.eye, shared.eyeMat);
        left.position.set(-0.17, 0.52, 0.41);
        right.position.set(0.17, 0.52, 0.41);
        obj.add(body, left, right);
        obj.userData.mat = mat;
        meshes.current.set(m.id, obj);
        g.add(obj);
      }
      obj.position.set(m.pos[0], m.pos[1], m.pos[2]);
      obj.rotation.y = m.yaw;
      const stretch = Math.max(-0.2, Math.min(0.25, m.vel[1] * 0.035));
      const sy = 1 + stretch;
      const fade = 1 - Math.min(1, m.dissolve / DISSOLVE_SECONDS);
      obj.scale.set(fade / Math.sqrt(sy), sy * fade, fade / Math.sqrt(sy));
      const mat = obj.userData.mat;
      mat.color.copy(shared.base).lerp(shared.red, m.hurtFlash > 0 ? 0.8 : 0).multiplyScalar(entityBrightness(world, m.pos, m.height));
      mat.opacity = fade;
    }
    for (const [id, obj] of meshes.current) {
      if (alive.has(id)) continue;
      g.remove(obj);
      obj.userData.mat.dispose();
      meshes.current.delete(id);
    }
  });

  return <group ref={group} />;
}

// 动物模型（都由方块拼成）。每种的主材质会在被打时闪红，头上有喂食后的红心。
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const lambert = (color) => new THREE.MeshLambertMaterial({ color });

function part(geometry, material, x, y, z) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

const MODELS = {
  // 绒耳兔：奶油色身体和头，两只长耳朵，白色小尾巴
  rabbit: (mat, shared) => {
    const g = new THREE.Group();
    const earL = part(shared.rabbitEar, shared.earMat, -0.1, 0.74, 0.3);
    const earR = part(shared.rabbitEar, shared.earMat, 0.1, 0.74, 0.3);
    earL.rotation.z = 0.15;
    earR.rotation.z = -0.15;
    g.add(
      part(box(0.5, 0.4, 0.66), mat, 0, 0.22, -0.04),
      part(box(0.36, 0.34, 0.32), mat, 0, 0.42, 0.34),
      earL, earR,
      part(shared.tail, shared.white, 0, 0.3, -0.4),
      part(shared.eye, shared.dark, -0.1, 0.46, 0.505),
      part(shared.eye, shared.dark, 0.1, 0.46, 0.505),
    );
    return { group: g, heartY: 1.05, flop: [earL, earR] };
  },
  // 鬃毛野猪：深棕色壮实身体，背上一道深色鬃毛，前面的猪鼻子和两颗白獠牙，四条短腿
  boar: (mat, shared) => {
    const g = new THREE.Group();
    g.add(
      part(box(0.8, 0.55, 1.05), mat, 0, 0.55, -0.05),
      part(box(0.6, 0.5, 0.42), mat, 0, 0.6, 0.62),
      part(box(0.18, 0.14, 0.95), shared.mane, 0, 0.88, -0.05),
      part(box(0.3, 0.2, 0.1), shared.snout, 0, 0.5, 0.87),
      part(box(0.06, 0.14, 0.06), shared.white, -0.18, 0.42, 0.86),
      part(box(0.06, 0.14, 0.06), shared.white, 0.18, 0.42, 0.86),
      part(shared.eye, shared.dark, -0.17, 0.7, 0.835),
      part(shared.eye, shared.dark, 0.17, 0.7, 0.835),
      part(box(0.18, 0.28, 0.18), mat, -0.24, 0.14, 0.3),
      part(box(0.18, 0.28, 0.18), mat, 0.24, 0.14, 0.3),
      part(box(0.18, 0.28, 0.18), mat, -0.24, 0.14, -0.4),
      part(box(0.18, 0.28, 0.18), mat, 0.24, 0.14, -0.4),
    );
    return { group: g, heartY: 1.25 };
  },
  // 圆圆鸭：圆滚滚的奶白色身体，绿色的头，橙色扁嘴和脚掌，翘起的小尾巴
  duck: (mat, shared) => {
    const g = new THREE.Group();
    g.add(
      part(box(0.44, 0.32, 0.56), mat, 0, 0.26, -0.03),
      part(box(0.26, 0.26, 0.26), shared.duckHead, 0, 0.52, 0.2),
      part(box(0.16, 0.06, 0.14), shared.orange, 0, 0.47, 0.39),
      part(box(0.2, 0.1, 0.1), mat, 0, 0.38, -0.33),
      part(box(0.1, 0.1, 0.12), shared.orange, -0.1, 0.05, 0.02),
      part(box(0.1, 0.1, 0.12), shared.orange, 0.1, 0.05, 0.02),
      part(shared.eye, shared.dark, -0.08, 0.57, 0.335),
      part(shared.eye, shared.dark, 0.08, 0.57, 0.335),
    );
    return { group: g, heartY: 0.85 };
  },
};

const BASE_COLOR = { rabbit: '#d8bf98', boar: '#6e4b33', duck: '#f1e8cf' };

function Animals({ animals, world }) {
  const group = useRef();
  const shared = useMemo(
    () => ({
      rabbitEar: box(0.08, 0.34, 0.06),
      tail: box(0.16, 0.16, 0.12),
      eye: box(0.06, 0.06, 0.02),
      heart: box(0.16, 0.16, 0.04),
      earMat: lambert('#e7b9a6'),
      white: lambert('#f6f2ea'),
      dark: new THREE.MeshBasicMaterial({ color: '#2a1f1a' }),
      mane: lambert('#3a2618'),
      snout: lambert('#b07a66'),
      duckHead: lambert('#3e8a62'),
      orange: lambert('#f0962e'),
      heartMat: new THREE.MeshBasicMaterial({ color: '#ff4d6a', fog: false }),
      red: new THREE.Color('#ff3b3b'),
    }),
    [],
  );
  const meshes = useRef(new Map());
  // 删掉一只动物时，释放它自己的材质和形状（共用的不动）
  const release = (obj) => {
    const keep = new Set([shared.rabbitEar, shared.tail, shared.eye, shared.heart]);
    obj.userData.mat.dispose();
    obj.traverse((o) => o.isMesh && !keep.has(o.geometry) && o.geometry.dispose());
  };

  useEffect(
    () => () => {
      for (const obj of meshes.current.values()) release(obj);
      meshes.current.clear();
      Object.values(shared).forEach((v) => v.dispose?.());
    },
    [shared],
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const alive = new Set();
    for (const a of animals) {
      alive.add(a.id);
      let obj = meshes.current.get(a.id);
      if (!obj) {
        const base = new THREE.Color(BASE_COLOR[a.species]);
        const mat = new THREE.MeshLambertMaterial({ color: base.clone(), transparent: true });
        const model = MODELS[a.species](mat, shared);
        obj = model.group;
        const heart = part(shared.heart, shared.heartMat, 0, model.heartY, 0.3);
        heart.rotation.z = Math.PI / 4;
        obj.add(heart);
        obj.userData = { mat, base, heart, heartY: model.heartY, flop: model.flop ?? [] };
        meshes.current.set(a.id, obj);
        g.add(obj);
      }
      obj.position.set(a.pos[0], a.pos[1], a.pos[2]);
      obj.rotation.y = a.yaw;
      const size = a.baby ? BABY_SCALE : 1;
      const stretch = Math.max(-0.15, Math.min(0.2, a.vel[1] * 0.03));
      const fade = 1 - Math.min(1, a.dissolve / 0.8);
      obj.scale.set(size * fade, size * (1 + stretch) * fade, size * fade);
      const { mat, base, heart, heartY, flop } = obj.userData;
      // 被打闪红；生气的野猪一直带点红
      const redness = a.hurtFlash > 0 ? 0.7 : a.anger > 0 ? 0.25 : 0;
      mat.color.copy(base).lerp(shared.red, redness).multiplyScalar(entityBrightness(world, a.pos, a.height));
      mat.opacity = fade;
      heart.visible = a.love > 0;
      heart.position.y = heartY + Math.sin(state.clock.elapsedTime * 4) * 0.05;
      for (const ear of flop) ear.rotation.x = a.onGround ? 0 : -0.35; // 跳起来时耳朵往后甩
    }
    for (const [id, obj] of meshes.current) {
      if (alive.has(id)) continue;
      g.remove(obj);
      release(obj);
      meshes.current.delete(id);
    }
  });

  return <group ref={group} />;
}

function WorldScene(props) {
  const { world, texture } = props;
  const materials = useMemo(
    () => ({
      solid: withBlockLight(new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: 0.5 })),
      water: withBlockLight(
        new THREE.MeshLambertMaterial({
          map: texture,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          side: THREE.DoubleSide, // 在水下也能看到水面
        }),
      ),
      cloud: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.82, fog: false }),
    }),
    [texture],
  );
  const renderer = useMemo(() => {
    const r = new ChunkRenderer(world, materials.solid, materials.water);
    // 先把玩家身边的区块建好，远处的在 Controller 里每帧建一些
    const p = props.playerRef.current;
    r.buildAround(p.pos[0], p.pos[2], 2);
    r.onRebuild = (cx, cz) => props.map?.markChunk(cx, cz);
    return r;
  }, [world, materials]); // eslint-disable-line react-hooks/exhaustive-deps
  // 开发服务器里方便调试：可以手动重建区块（打包后没有）
  if (import.meta.env.DEV && window.__voxel) window.__voxel.renderer = renderer;
  useEffect(() => () => {
    renderer.dispose();
    Object.values(materials).forEach((m) => m.dispose());
  }, [renderer, materials]);

  return (
    <>
      <Environment {...props} cloudMaterial={materials.cloud} />
      <primitive object={renderer.group} />
      <Clouds world={world} material={materials.cloud} />
      <Monsters monsters={props.monsters} world={world} />
      <Animals animals={props.animals} world={world} />
      <Controller {...props} renderer={renderer} materials={materials} />
    </>
  );
}

export default function Game({ onCanvas, ...props }) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 75, near: 0.05, far: 260 }}
      onCreated={({ gl }) => onCanvas(gl.domElement)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <WorldScene {...props} />
    </Canvas>
  );
}
