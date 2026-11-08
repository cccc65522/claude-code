// Tiny synthesized sounds (no audio files): a wooden "tok" for moves, a heavier
// knock for captures, two rising notes for check. The AudioContext starts on first use,
// which always happens inside a tap, as iOS requires.

let ctx = null;
export const sound = { enabled: true };

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function knock(freq, dur, gain) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 5));
  const srcNode = a.createBufferSource();
  srcNode.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 6;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  srcNode.connect(bp).connect(g).connect(a.destination);
  srcNode.start(t);
}

function tone(freq, start, dur) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function playSound(kind) {
  if (!sound.enabled) return;
  try {
    if (kind === 'move') knock(1400, 0.12, 0.9);
    else if (kind === 'capture') { knock(700, 0.18, 1.2); knock(1600, 0.08, 0.5); }
    else if (kind === 'check') { knock(1400, 0.1, 0.8); tone(660, 0.05, 0.18); tone(880, 0.16, 0.22); }
    else if (kind === 'win') { tone(523, 0, 0.2); tone(659, 0.15, 0.2); tone(784, 0.3, 0.35); }
    else if (kind === 'lose') { tone(392, 0, 0.25); tone(330, 0.2, 0.4); }
  } catch { /* audio is best-effort */ }
}
