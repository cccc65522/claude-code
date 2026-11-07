import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ChunkRenderer } from '../game/renderer.js';
import { raycast } from '../game/raycast.js';
import { EYE_HEIGHT, eyeInWater, overlapsBlock, stepPlayer } from '../game/player.js';
import { AIR, BLOCKS, TORCH, WATER, isLiquid } from '../game/blocks.js';
import {
  BUCKET, SURVIVAL_HOTBAR, WATER_BUCKET, addItem, countOf, dropFor, itemName, takeItem,
} from '../game/items.js';
import { digInfo, toolKindName } from '../game/tools.js';
import { fallDamage, hurt, regenerate } from '../game/health.js';
import { DAY_SECONDS, clockText, skyAt, wrapTime } from '../game/daynight.js';

const REACH = 6;
const REPEAT_SECONDS = 0.22;
const SKY_DISTANCE = 200;
const FLUID_STEP = 0.25; // 水每 0.25 秒流一格

// 给 Lambert 材质加上火把光：每个顶点带一个 blockLight（0–1），
// 片元颜色取“日光/月光照明”和“火把照明”里较亮的那个，所以白天火把不会把东西照得过曝。
function withBlockLight(material) {
  const torch = { value: new THREE.Color('#ffc27a') };
  material.userData.torch = torch;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTorchColor = torch;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float blockLight;\nvarying float vBlockLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlockLight = blockLight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTorchColor;\nvarying float vBlockLight;')
      .replace(
        '#include <opaque_fragment>',
        'outgoingLight = max(outgoingLight, diffuseColor.rgb * vBlockLight * uTorchColor);\n#include <opaque_fragment>',
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

function Controller({ world, sim, renderer, materials, input, playerRef, selectedRef, modeRef, inventory, onInventory, onEdit, onMessage, statsRef, activeRef, onFlyingChange, timeRef, underwaterRef, digUiRef, hurtUiRef, onHealth, onDeath }) {
  const { camera } = useThree();
  const targetRef = useRef(null);
  const statsTimer = useRef(0);
  const fluidTimer = useRef(0);
  const flicker = useMemo(() => ({ base: new THREE.Color('#ffc27a'), t: 0 }), []);
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
    const torchAbove = world.get(x, y + 1, z) === TORCH;
    const dirty = sim.edit(x, y, z, AIR);
    if (!dirty) return;
    renderer.rebuildKeys(dirty);
    if (survival) {
      pickUp(dropFor(t.block));
      if (torchAbove && world.get(x, y + 1, z) !== TORCH) pickUp(TORCH); // 掉下来的火把也捡起来
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
    takeItem(inventory, BUCKET);
    addItem(inventory, WATER_BUCKET);
    onInventory();
    onEdit();
  };

  const place = (t) => {
    const survival = modeRef.current === 'survival';
    const selected = selectedRef.current;
    if (survival && countOf(inventory, selected) <= 0) {
      return onMessage(`没有${itemName(selected)}了，${selected < 100 ? '去背包里合成或者挖一些' : '可以在背包里合成'}`);
    }
    if (selected === BUCKET) return fillBucket();
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
    if (!active || !input.held.dig || !t) {
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
    if (d.progress >= 1) {
      dig(t);
      d.key = null;
      d.progress = 0;
    }
  };

  const doAction = (kind) => {
    const t = targetRef.current;
    if (kind === 'place') return place(t);
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
    const landed = stepPlayer(world, p, {
      forward: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - move.y,
      right: k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + move.x,
      jump: k('Space') || (active && input.touchJump),
      down: k('KeyC') || k('ControlLeft') || (active && input.touchDown),
      sprint: k('ShiftLeft') || k('ShiftRight') || Math.hypot(move.x, move.y) > 0.95,
    }, dt);

    // 生存模式：摔落伤害和慢慢回血
    if (modeRef.current === 'survival' && p.health > 0) {
      const lost = hurt(p, fallDamage(landed));
      if (lost > 0) {
        const el = hurtUiRef.current;
        if (el) {
          el.classList.remove('hit');
          void el.offsetWidth; // 重新播放闪红动画
          el.classList.add('hit');
        }
        onHealth(p.health);
        if (p.health <= 0) onDeath(`从 ${Math.round(landed)} 格高的地方摔了下来`);
      } else if (active && regenerate(p, dt)) {
        onHealth(p.health);
      }
    }

    if (p.flying !== lastFlying.current) {
      lastFlying.current = p.flying;
      onFlyingChange(p.flying);
    }

    camera.position.set(p.pos[0], p.pos[1] + EYE_HEIGHT, p.pos[2]);
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
        (t ? `  · 对准：${BLOCKS[t.block]?.name ?? '?'}` : '');
    }
  });

  return <Highlight targetRef={targetRef} digRef={digRef} />;
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
  const renderer = useMemo(() => new ChunkRenderer(world, materials.solid, materials.water), [world, materials]);
  useEffect(() => () => {
    renderer.dispose();
    Object.values(materials).forEach((m) => m.dispose());
  }, [renderer, materials]);

  return (
    <>
      <Environment {...props} cloudMaterial={materials.cloud} />
      <primitive object={renderer.group} />
      <Clouds world={world} material={materials.cloud} />
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
