import {
  BED, BEDROCK, BRICK, CACTUS, CHEST, COAL_ORE, DIRT, EGG, FARMLAND, GLASS, GRASS, ICE, IRON_ORE, LEAVES, LOG, PLANKS, SAND,
  SANDSTONE, SNOW, STONE, TORCH, isCrop, isDoor, isLadder, isLiquid,
} from './blocks.js';

// 音效：全部用 Web Audio 当场合成（噪声加滤波、振荡器加包络），没有音频文件。
// 这个文件前半部分是纯计算（可以在 Node 里测试），后半部分是播放。

// ---------- 纯计算 ----------

// 方块听起来像什么材质
export function soundMaterial(id) {
  if (id === STONE || id === COAL_ORE || id === IRON_ORE || id === BRICK || id === BEDROCK || id === SANDSTONE) return 'stone';
  if (id === LOG || id === PLANKS || id === CHEST || id === BED || id === TORCH || isDoor(id) || isLadder(id)) return 'wood';
  if (id === ICE) return 'glass';
  if (id === CACTUS) return 'leaves';
  if (id === SAND) return 'sand';
  if (id === SNOW) return 'snow';
  if (id === LEAVES || isCrop(id)) return 'leaves';
  if (id === GLASS) return 'glass';
  if (id === EGG) return 'egg';
  if (isLiquid(id)) return 'water';
  if (id === DIRT || id === GRASS || id === FARMLAND) return 'dirt';
  return 'dirt';
}

export const HEAR_DISTANCE = 24;

/**
 * 声音从 source 传到听的人（位置 listener、朝向 yaw）：音量和左右声道。
 * 返回 { gain: 0–1, pan: -1（左）… 1（右） }；太远就是 gain 0。
 */
export function spatial(listener, yaw, source) {
  if (!source) return { gain: 1, pan: 0 };
  const dx = source[0] - listener[0];
  const dy = source[1] - listener[1];
  const dz = source[2] - listener[2];
  const d = Math.hypot(dx, dy, dz);
  if (d >= HEAR_DISTANCE) return { gain: 0, pan: 0 };
  const gain = (1 / (1 + d / 6)) * (1 - d / HEAR_DISTANCE);
  if (Math.hypot(dx, dz) < 0.5) return { gain, pan: 0 };
  // yaw = 0 时面朝 -z，右手边是 +x
  const right = [Math.cos(yaw), -Math.sin(yaw)];
  const len = Math.hypot(dx, dz);
  const pan = Math.max(-1, Math.min(1, (dx * right[0] + dz * right[1]) / len));
  return { gain, pan: pan * 0.8 };
}

/**
 * 脚步：在地上走过一定距离响一下。state 记着走了多远。返回这一步要不要响。
 */
export function stepFootsteps(state, distance, { onGround, sprinting }) {
  if (!onGround) return false;
  state.walked = (state.walked ?? 0) + distance;
  const stride = sprinting ? 2.1 : 1.7;
  if (state.walked < stride) return false;
  state.walked = 0;
  return true;
}

export function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(1, n));
}

// ---------- 播放 ----------

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.muted = false;
    this.listener = [0, 0, 0];
    this.yaw = 0;
    this.played = 0; // 播放了多少个声音（测试和调试用）
  }

  // 浏览器要求在用户点击之后才能出声：在“开始”按钮里调用
  unlock() {
    if (typeof window === 'undefined') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
      // 一秒的白噪声，各种“沙沙”“咔”的声音都从这里截一段
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const ch = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = clampVolume(v);
    this.applyVolume();
  }

  setMuted(m) {
    this.muted = Boolean(m);
    this.applyVolume();
  }

  applyVolume() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.8;
  }

  setListener(pos, yaw) {
    this.listener = pos;
    this.yaw = yaw;
  }

  // 给一个声音准备好输出：按距离算音量、按方向分左右
  out(at, loud = 1) {
    if (!this.ctx || this.muted || this.volume === 0 || this.ctx.state !== 'running') return null;
    const { gain, pan } = spatial(this.listener, this.yaw, at);
    if (gain * loud < 0.01) return null;
    const g = this.ctx.createGain();
    g.gain.value = gain * loud;
    let node = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    node.connect(this.master);
    this.played++;
    return g;
  }

  // 一段滤过的噪声：attack 秒淡入，decay 秒淡出
  burst(dest, { type = 'bandpass', freq = 1000, q = 1, gain = 0.5, attack = 0.003, decay = 0.12, delay = 0, rate = 1 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(env).connect(dest);
    src.start(t, Math.random() * 0.5, attack + decay + 0.05);
  }

  // 一个音：频率从 from 滑到 to
  tone(dest, { type = 'sine', from = 440, to = from, gain = 0.3, attack = 0.005, decay = 0.2, delay = 0, filter = null }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + attack + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = filter;
      f.Q.value = 4;
      node = osc.connect(f);
    }
    node.connect(env).connect(dest);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  // ---------- 具体的声音 ----------

  // 方块被挖掉 / 放下 / 踩上去 / 挖的过程中一下下的敲击
  block(material, at, kind = 'break') {
    const loud = { break: 1, place: 0.8, step: 0.35, hit: 0.3 }[kind] ?? 1;
    const d = this.out(at, loud);
    if (!d) return;
    const r = 0.9 + Math.random() * 0.2;
    const short = kind === 'step' || kind === 'hit';
    switch (material) {
      case 'stone':
        this.burst(d, { freq: 1800 * r, q: 2.5, gain: 0.6, decay: short ? 0.05 : 0.11 });
        if (!short) this.burst(d, { freq: 700 * r, q: 1.5, gain: 0.35, decay: 0.08, delay: 0.03 });
        break;
      case 'wood':
        this.tone(d, { type: 'triangle', from: 190 * r, to: 140 * r, gain: 0.45, decay: short ? 0.06 : 0.13 });
        this.burst(d, { freq: 900 * r, q: 2, gain: 0.25, decay: 0.06 });
        break;
      case 'sand':
        this.burst(d, { type: 'highpass', freq: 2200 * r, q: 0.7, gain: 0.35, attack: 0.01, decay: short ? 0.07 : 0.16 });
        break;
      case 'snow':
        this.burst(d, { type: 'lowpass', freq: 1400 * r, q: 0.7, gain: 0.35, attack: 0.012, decay: short ? 0.07 : 0.14 });
        break;
      case 'leaves':
        this.burst(d, { type: 'highpass', freq: 3500 * r, q: 0.8, gain: 0.3, attack: 0.008, decay: short ? 0.06 : 0.14 });
        this.burst(d, { type: 'highpass', freq: 4500 * r, q: 0.8, gain: 0.2, decay: 0.08, delay: 0.05 });
        break;
      case 'glass':
        if (kind === 'break') {
          for (let i = 0; i < 4; i++) {
            this.tone(d, { type: 'sine', from: (2400 + Math.random() * 1600) * r, gain: 0.12, decay: 0.25, delay: i * 0.03 });
          }
          this.burst(d, { type: 'highpass', freq: 5000, gain: 0.25, decay: 0.12 });
        } else {
          this.tone(d, { type: 'sine', from: 2200 * r, gain: 0.12, decay: 0.08 });
        }
        break;
      case 'egg':
        this.tone(d, { type: 'sine', from: 900 * r, to: 500 * r, gain: 0.3, decay: 0.07 });
        break;
      default: // 泥土、草
        this.burst(d, { type: 'lowpass', freq: 700 * r, q: 1, gain: 0.55, attack: 0.006, decay: short ? 0.06 : 0.13 });
        if (!short) this.burst(d, { freq: 1500 * r, q: 1, gain: 0.15, decay: 0.08, delay: 0.02 });
    }
  }

  land(at, height) {
    const d = this.out(at, Math.min(1, 0.4 + height * 0.08));
    if (!d) return;
    this.burst(d, { type: 'lowpass', freq: 400, q: 1, gain: 0.7, decay: 0.16 });
    this.tone(d, { type: 'sine', from: 110, to: 60, gain: 0.4, decay: 0.15 });
  }

  splash(at, big = true) {
    const d = this.out(at, big ? 1 : 0.4);
    if (!d) return;
    this.burst(d, { type: 'bandpass', freq: 900, q: 0.8, gain: 0.5, attack: 0.01, decay: big ? 0.35 : 0.15 });
    this.burst(d, { type: 'highpass', freq: 3000, q: 0.6, gain: 0.25, attack: 0.02, decay: big ? 0.3 : 0.12, delay: 0.03 });
  }

  hurt() {
    const d = this.out(null, 0.9);
    if (!d) return;
    this.tone(d, { type: 'sawtooth', from: 320, to: 150, gain: 0.25, decay: 0.2, filter: 700 });
    this.burst(d, { type: 'lowpass', freq: 500, gain: 0.3, decay: 0.08 });
  }

  eat() {
    const d = this.out(null, 0.8);
    if (!d) return;
    for (let i = 0; i < 3; i++) this.burst(d, { freq: 1600 + Math.random() * 600, q: 1.5, gain: 0.4, decay: 0.06, delay: i * 0.13 });
  }

  chime(notes = [660, 880, 1320], spacing = 0.07) {
    const d = this.out(null, 0.6);
    if (!d) return;
    notes.forEach((f, i) => this.tone(d, { type: 'triangle', from: f, gain: 0.2, decay: 0.35, delay: i * spacing }));
  }

  craft() {
    this.chime([660, 990]);
  }

  sleep() {
    this.chime([392, 494, 587, 784], 0.22);
  }

  bucket(fill) {
    const d = this.out(null, 0.7);
    if (!d) return;
    this.burst(d, { freq: fill ? 600 : 900, q: 1, gain: 0.4, attack: 0.02, decay: 0.25 });
    this.tone(d, { type: 'sine', from: fill ? 300 : 500, to: fill ? 500 : 300, gain: 0.12, decay: 0.2 });
  }

  // 雨声：一直循环的滤过的噪声，level 0–1 控制大小（在屋里小一点）
  setRain(level) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (!this.rain) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1400;
      band.Q.value = 0.5;
      const low = this.ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 5000;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(band).connect(low).connect(gain).connect(this.master);
      src.start();
      this.rain = { gain, low };
    }
    const t = this.ctx.currentTime;
    this.rain.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.35, t, 0.5);
  }

  // 开门：吱呀一声；关门：咚一下
  door(open, at) {
    const d = this.out(at, 0.9);
    if (!d) return;
    if (open) {
      this.tone(d, { type: 'sawtooth', from: 380, to: 520, gain: 0.08, attack: 0.04, decay: 0.3, filter: 900 });
      this.tone(d, { type: 'triangle', from: 160, to: 130, gain: 0.25, decay: 0.12 });
    } else {
      this.tone(d, { type: 'triangle', from: 150, to: 90, gain: 0.45, decay: 0.15 });
      this.burst(d, { type: 'lowpass', freq: 600, gain: 0.4, decay: 0.1 });
    }
  }

  pickup() {
    const d = this.out(null, 0.5);
    if (!d) return;
    this.tone(d, { type: 'sine', from: 700, to: 1100, gain: 0.15, decay: 0.08 });
  }

  // 夜影：低沉的咕噜声 / 被打 / 消散
  monster(at, kind = 'growl') {
    const d = this.out(at, kind === 'growl' ? 0.8 : 1);
    if (!d) return;
    if (kind === 'growl') {
      this.tone(d, { type: 'sawtooth', from: 85, to: 60, gain: 0.3, attack: 0.08, decay: 0.6, filter: 220 });
      this.tone(d, { type: 'square', from: 43, to: 38, gain: 0.12, attack: 0.08, decay: 0.55, filter: 120 });
    } else if (kind === 'hit') {
      this.tone(d, { type: 'sawtooth', from: 180, to: 90, gain: 0.3, decay: 0.15, filter: 400 });
    } else {
      this.burst(d, { type: 'lowpass', freq: 600, gain: 0.5, attack: 0.02, decay: 0.45 });
      this.tone(d, { type: 'sine', from: 300, to: 60, gain: 0.25, decay: 0.4 });
    }
  }

  // 动物：兔子吱吱、野猪哼哼、鸭子嘎嘎
  animal(species, at, kind = 'idle') {
    const d = this.out(at, kind === 'hit' ? 1 : 0.6);
    if (!d) return;
    const r = 0.92 + Math.random() * 0.16;
    if (species === 'rabbit') {
      this.tone(d, { type: 'sine', from: 1500 * r, to: 2300 * r, gain: 0.2, decay: 0.08 });
      if (kind === 'hit') this.tone(d, { type: 'sine', from: 2200 * r, to: 1400 * r, gain: 0.2, decay: 0.1, delay: 0.09 });
    } else if (species === 'boar') {
      const n = kind === 'hit' ? 1 : 2;
      for (let i = 0; i < n; i++) {
        this.tone(d, { type: 'square', from: (kind === 'hit' ? 260 : 120) * r, to: 80 * r, gain: 0.18, attack: 0.01, decay: 0.12, delay: i * 0.17, filter: 500 });
        this.burst(d, { type: 'lowpass', freq: 500, gain: 0.2, decay: 0.1, delay: i * 0.17 });
      }
    } else if (species === 'lizard') {
      // 沙丘蜥：短短的“嘶”一声
      this.burst(d, { type: 'highpass', freq: 3500 * r, q: 0.8, gain: kind === 'hit' ? 0.35 : 0.18, attack: 0.01, decay: 0.12 });
    } else if (species === 'duck') {
      const n = kind === 'hit' ? 1 : 2;
      for (let i = 0; i < n; i++) {
        this.tone(d, { type: 'sawtooth', from: 620 * r, to: 470 * r, gain: 0.22, attack: 0.01, decay: 0.14, delay: i * 0.2, filter: 1300 });
      }
    }
  }
}

export const sound = new SoundEngine();
