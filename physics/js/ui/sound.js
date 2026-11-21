// Impact sounds synthesised with Web Audio: a short filtered noise burst plus a decaying tone, tuned per
// material and scaled by the impact speed and the size of the body.

const VOICES = {
  wood: { freq: 380, q: 6, decay: 0.07, tone: 0.5, noise: 0.6, type: 'triangle' },
  metal: { freq: 1250, q: 18, decay: 0.32, tone: 0.55, noise: 0.25, type: 'sine', partial: 2.76 },
  rubber: { freq: 150, q: 3, decay: 0.09, tone: 0.8, noise: 0.15, type: 'sine' },
  ice: { freq: 2100, q: 10, decay: 0.12, tone: 0.35, noise: 0.5, type: 'sine', partial: 1.5 },
  stone: { freq: 220, q: 2, decay: 0.06, tone: 0.25, noise: 0.9, type: 'triangle' }
};

export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.noise = null;
    this.recent = [];
  }

  // Must be called from a user gesture on iOS.
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  // speed: m/s, size: metres (bigger bodies sound lower), kind: material sound name.
  impact(kind, speed, size = 1) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.recent = this.recent.filter(t => now - t < 0.08);
    if (this.recent.length >= 6) return;
    this.recent.push(now);
    const v = VOICES[kind] || VOICES.wood;
    const gain = Math.min(1, (speed - 0.8) / 8) * 0.6;
    if (gain <= 0.01) return;
    const pitch = v.freq * Math.min(2, Math.max(0.45, 1 / Math.sqrt(Math.max(0.05, size)))) * (0.94 + Math.random() * 0.12);
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(gain, now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + v.decay * 2.5);
    out.connect(this.master);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = pitch * 1.5;
    bp.Q.value = v.q;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(v.noise, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + v.decay);
    src.connect(bp).connect(ng).connect(out);
    src.start(now, Math.random() * 0.3, v.decay * 2);

    const osc = ctx.createOscillator();
    osc.type = v.type;
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.8, now + v.decay * 2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(v.tone, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + v.decay * 2.2);
    osc.connect(og).connect(out);
    osc.start(now);
    osc.stop(now + v.decay * 2.5);
    if (v.partial) {
      const o2 = ctx.createOscillator();
      o2.frequency.value = pitch * v.partial;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(v.tone * 0.4, now);
      g2.gain.exponentialRampToValueAtTime(0.0001, now + v.decay * 1.4);
      o2.connect(g2).connect(out);
      o2.start(now);
      o2.stop(now + v.decay * 2);
    }
  }

  boom() {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, now);
    lp.frequency.exponentialRampToValueAtTime(80, now + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    src.connect(lp).connect(g).connect(this.master);
    src.start(now, 0, 0.6);
  }

  chime() {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t = now + i * 0.09;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.55);
    });
  }
}
