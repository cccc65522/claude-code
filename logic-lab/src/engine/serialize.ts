// Validation of loaded projects, and compact share links.
import { GATE_KINDS } from './parts.ts';
import type { Circuit, Part, PartKind, Project, Rot, Wire } from './types.ts';

const KINDS = new Set<string>([
  'in', 'out', 'button', 'clock', 'const', 'led', 'hex', 'seg7', ...GATE_KINDS, 'tri', 'mux', 'dff', 'jkff', 'tff', 'rom', 'ram', 'reg', 'tunnel', 'bin', 'num', 'split', 'chip', 'text'
]);

export class ProjectError extends Error {}

/** Keys that can be bound to inputs: letters and digits, except the editor's own shortcuts. */
export function isBindableKey(k: string): boolean {
  return /^[a-z0-9]$/.test(k) && k !== 'r' && k !== 'f';
}

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined;

function cleanPart(raw: unknown): Part | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  const kind = str(r.kind);
  if (!id || !kind || !KINDS.has(kind)) return null;
  const part: Part = {
    id,
    kind: kind as PartKind,
    x: int(r.x, -100000, 100000) ?? 0,
    y: int(r.y, -100000, 100000) ?? 0,
    rot: (int(r.rot, 0, 3) ?? 0) as Rot
  };
  const label = str(r.label, 40);
  if (label) part.label = label;
  const n = int(r.n, 2, 8);
  if (n !== undefined) part.n = n;
  if (r.value === 0 || r.value === 1) part.value = r.value;
  const period = int(r.period, 1, 1000);
  if (period !== undefined) part.period = period;
  const color = str(r.color, 20);
  if (color) part.color = color;
  const chip = str(r.chip, 80);
  if (chip) part.chip = chip;
  const text = str(r.text, 2000);
  if (text !== undefined) part.text = text;
  if (r.locked === true) part.locked = true;
  if (typeof r.key === 'string' && isBindableKey(r.key)) part.key = r.key;
  const num = int(r.num, 0, 255);
  if (num !== undefined) part.num = num;
  const abits = int(r.abits, 1, 6);
  if (abits !== undefined) part.abits = abits;
  const dbits = int(r.dbits, 1, 8);
  if (dbits !== undefined) part.dbits = dbits;
  if (Array.isArray(r.data)) part.data = r.data.slice(0, 64).map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0));
  return part;
}

function cleanWire(raw: unknown): Wire | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ref = (v: unknown) => {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const part = str(o.part, 80);
    const pin = str(o.pin, 80);
    return part && pin ? { part, pin } : null;
  };
  const id = str(r.id, 80);
  const a = ref(r.a);
  const b = ref(r.b);
  if (!id || !a || !b) return null;
  const wire: Wire = { id, a, b };
  if (typeof r.bend === 'number' && Number.isFinite(r.bend)) wire.bend = Math.round(Math.max(-100000, Math.min(100000, r.bend)) * 2) / 2;
  return wire;
}

function cleanCircuit(raw: unknown, fallbackId: string): Circuit {
  if (!raw || typeof raw !== 'object') throw new ProjectError('电路数据格式不对');
  const r = raw as Record<string, unknown>;
  const parts = Array.isArray(r.parts) ? r.parts.map(cleanPart).filter((p): p is Part => p !== null) : [];
  const ids = new Set<string>();
  const uniqueParts = parts.filter((p) => (ids.has(p.id) ? false : (ids.add(p.id), true)));
  const wires = Array.isArray(r.wires) ? r.wires.map(cleanWire).filter((w): w is Wire => w !== null) : [];
  const wireIds = new Set<string>();
  return {
    id: str(r.id, 80) || fallbackId,
    name: str(r.name, 60) || '未命名',
    parts: uniqueParts,
    wires: wires.filter((w) => ids.has(w.a.part) && ids.has(w.b.part) && (wireIds.has(w.id) ? false : (wireIds.add(w.id), true)))
  };
}

export function parseProject(json: unknown): Project {
  if (!json || typeof json !== 'object') throw new ProjectError('不是有效的项目文件');
  const r = json as Record<string, unknown>;
  if (r.app !== undefined && r.app !== 'mendao') throw new ProjectError('这不是“门道”的项目文件');
  const main = cleanCircuit(r.main, 'main');
  main.id = 'main';
  const chips = Array.isArray(r.chips) ? r.chips.map((c, i) => cleanCircuit(c, `chip${i}`)) : [];
  const seen = new Set<string>(['main']);
  return { version: 1, main, chips: chips.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))) };
}

export function projectToJSON(p: Project): string {
  return JSON.stringify({ app: 'mendao', ...p });
}

// ---------------------------------------------------------------------------
// Share links: deflate-compressed JSON, base64url-encoded, in the URL hash.

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeShare(p: Project): Promise<string> {
  const raw = new TextEncoder().encode(projectToJSON(p));
  if (typeof CompressionStream !== 'undefined') return 'z' + toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')));
  return 'j' + toBase64Url(raw);
}

export async function decodeShare(s: string): Promise<Project> {
  try {
    const bytes = fromBase64Url(s.slice(1));
    const raw = s[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    return parseProject(JSON.parse(new TextDecoder().decode(raw)));
  } catch (e) {
    if (e instanceof ProjectError) throw e;
    throw new ProjectError('分享链接已损坏，无法打开');
  }
}
