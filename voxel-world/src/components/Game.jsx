import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ChunkRenderer } from '../game/renderer.js';
import { raycast } from '../game/raycast.js';
import { EYE_HEIGHT, eyeInWater, overlapsBlock, stepPlayer } from '../game/player.js';
import { AIR, BLOCKS, WATER } from '../game/blocks.js';
import { DAY_SECONDS, clockText, skyAt, wrapTime } from '../game/daynight.js';

const REACH = 6;
const REPEAT_SECONDS = 0.22;
const SKY_DISTANCE = 200;

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

function Highlight({ targetRef }) {
  const ref = useRef();
  const geometry = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), []);
  useFrame(() => {
    const t = targetRef.current;
    if (!ref.current) return;
    ref.current.visible = !!t;
    if (t) ref.current.position.set(t.hit[0] + 0.5, t.hit[1] + 0.5, t.hit[2] + 0.5);
  });
  return (
    <lineSegments ref={ref} geometry={geometry} visible={false}>
      <lineBasicMaterial color="#111111" transparent opacity={0.7} />
    </lineSegments>
  );
}

function Controller({ world, renderer, input, playerRef, selectedRef, onEdit, statsRef, activeRef, onFlyingChange, timeRef, underwaterRef }) {
  const { camera } = useThree();
  const targetRef = useRef(null);
  const statsTimer = useRef(0);
  const lastFlying = useRef(playerRef.current.flying);

  const doAction = (kind) => {
    const t = targetRef.current;
    if (!t) return;
    if (kind === 'dig') {
      if (BLOCKS[t.block]?.unbreakable) return;
      const [x, y, z] = t.hit;
      if (world.set(x, y, z, AIR)) {
        renderer.rebuildAround(x, z);
        onEdit();
      }
    } else {
      const x = t.hit[0] + t.normal[0];
      const y = t.hit[1] + t.normal[1];
      const z = t.hit[2] + t.normal[2];
      const here = world.get(x, y, z);
      // 空气和水的位置都能放方块（放进水里就把水换掉）
      if (!world.inBounds(x, y, z) || (here !== AIR && here !== WATER)) return;
      const id = selectedRef.current;
      if (id !== WATER && overlapsBlock(playerRef.current, x, y, z)) return;
      if (world.set(x, y, z, id)) {
        renderer.rebuildAround(x, z);
        onEdit();
      }
    }
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
    stepPlayer(world, p, {
      forward: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - move.y,
      right: k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + move.x,
      jump: k('Space') || (active && input.touchJump),
      down: k('KeyC') || k('ControlLeft') || (active && input.touchDown),
      sprint: k('ShiftLeft') || k('ShiftRight') || Math.hypot(move.x, move.y) > 0.95,
    }, dt);

    if (p.flying !== lastFlying.current) {
      lastFlying.current = p.flying;
      onFlyingChange(p.flying);
    }

    camera.position.set(p.pos[0], p.pos[1] + EYE_HEIGHT, p.pos[2]);
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');

    // 准星对着的方块
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    targetRef.current = raycast(world, camera.position.toArray(), dir.toArray(), REACH);

    // 挖 / 放：点一下立即执行，按住持续执行
    while (input.actions.length) doAction(input.actions.shift());
    for (const kind of ['dig', 'place']) {
      if (!active || !input.held[kind]) continue;
      input.held[kind + 'Timer'] = (input.held[kind + 'Timer'] || 0) + dt;
      if (input.held[kind + 'Timer'] >= REPEAT_SECONDS) {
        input.held[kind + 'Timer'] = 0;
        doAction(kind);
      }
    }

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

  return <Highlight targetRef={targetRef} />;
}

function WorldScene(props) {
  const { world, texture } = props;
  const materials = useMemo(
    () => ({
      solid: new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: 0.5 }),
      water: new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide, // 在水下也能看到水面
      }),
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
      <Controller {...props} renderer={renderer} />
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
