// Talks to the search worker. One search at a time; starting a new one or calling
// stop() terminates the old worker (a running search can't be interrupted otherwise).

export class EngineClient {
  constructor() {
    this.seq = 0;
    this.pending = null;
    this.worker = null;
  }

  spawn() {
    this.worker = new Worker(new URL('../engine/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => this.onMessage(e.data);
    this.worker.onerror = e => {
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        p.reject(new Error(e.message || '引擎出错'));
      }
    };
  }

  onMessage(msg) {
    const p = this.pending;
    if (!p || msg.id !== p.id) return;
    if (msg.type === 'info') {
      p.last = msg;
      p.onInfo?.(msg);
    } else if (msg.type === 'done') {
      this.pending = null;
      p.resolve(msg);
    } else if (msg.type === 'error') {
      this.pending = null;
      p.reject(new Error(msg.message));
    }
  }

  // Resolves with { mv, score, depth, nodes, timeMs, pv, book? } (moves in ICCS).
  think({ startFen, moves, level, onInfo }) {
    this.stop();
    if (!this.worker) this.spawn();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject, onInfo, last: null };
      this.worker.postMessage({ id, startFen, moves, level });
    });
  }

  get busy() { return this.pending !== null; }

  // Cancel the current search. Resolves it with the best move found so far (if any).
  stop({ useBest = false } = {}) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    if (useBest && p.last && p.last.pv.length) p.resolve({ ...p.last, mv: p.last.pv[0], stopped: true });
    else p.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
  }
}
