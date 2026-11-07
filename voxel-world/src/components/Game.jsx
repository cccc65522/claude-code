import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ChunkRenderer } from '../game/renderer.js';
import { raycast } from '../game/raycast.js';
import { EYE_HEIGHT, overlapsBlock, stepPlayer } from '../game/player.js';
import { AIR, BLOCKS } from '../game/blocks.js';

const SKY = '#a8d8ff';
const REACH = 6;
const REPEAT_SECONDS = 0.22;

function Clouds({ world }) {
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
        <mesh key={i} position={[b.x, 0, b.z]}>
          <boxGeometry args={[b.w, 1.5, b.d]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.82} fog={false} />
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

function Controller({ world, renderer, input, playerRef, selectedRef, onEdit, statsRef, activeRef, onFlyingChange }) {
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
      if (!world.inBounds(x, y, z) || world.get(x, y, z) !== AIR) return;
      if (overlapsBlock(playerRef.current, x, y, z)) return;
      if (world.set(x, y, z, selectedRef.current)) {
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

    statsTimer.current += dt;
    if (statsTimer.current > 0.25 && statsRef.current) {
      statsTimer.current = 0;
      const t = targetRef.current;
      statsRef.current.textContent =
        `X ${p.pos[0].toFixed(1)}  Y ${p.pos[1].toFixed(1)}  Z ${p.pos[2].toFixed(1)}` +
        (p.flying ? '  · 飞行中' : '') +
        (t ? `  · 对准：${BLOCKS[t.block]?.name ?? '?'}` : '');
    }
  });

  return <Highlight targetRef={targetRef} />;
}

function WorldScene(props) {
  const { world, texture } = props;
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: 0.5, side: THREE.FrontSide }),
    [texture],
  );
  const renderer = useMemo(() => new ChunkRenderer(world, material), [world, material]);
  useEffect(() => () => {
    renderer.dispose();
    material.dispose();
  }, [renderer, material]);

  const sunDir = [world.sizeX * 0.6, 80, world.sizeZ * 0.3];
  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 28, 92]} />
      <hemisphereLight args={['#ffffff', '#9a8a70', 1.6]} />
      <directionalLight position={sunDir} intensity={1.7} />
      <primitive object={renderer.group} />
      <Clouds world={world} />
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
