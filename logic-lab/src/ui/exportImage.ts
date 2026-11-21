// Export the circuit being edited as a standalone SVG or PNG image: the drawing is
// copied out of the live canvas, cropped to the parts, and the page's styles (with
// the current theme's colours resolved) are embedded so it looks the same anywhere.
import { circuitBounds, currentCircuit, store } from '../store/store.ts';

const SCALE = 20; // pixels per grid unit in the exported image
const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif".replace(/'/g, '&apos;');

function collectCss(): string {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n';
    } catch {
      /* cross-origin sheet: skip */
    }
  }
  return css;
}

function themeVariables(): string {
  const cs = getComputedStyle(document.documentElement);
  const out: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i];
    if (name.startsWith('--')) out.push(`${name}: ${cs.getPropertyValue(name).trim()}`);
  }
  return out.join('; ');
}

/** Build the SVG document text, or null when the circuit is empty. */
export function circuitSvg(): string | null {
  const s = store.get();
  const c = currentCircuit(s);
  if (c.parts.length === 0) return null;
  const world = document.querySelector('[data-testid="canvas"] > g');
  if (!world) return null;
  const b = circuitBounds(c, s.project);
  const pad = 2;
  const x = b.x - pad;
  const y = b.y - pad;
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  const clone = world.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform');
  // Interaction-only pieces don't belong in a picture.
  clone.querySelectorAll('.hit, .sel-box, .wire-hit, .wire-halo, .pin-hit, .rubber, .box-select, title').forEach((el) => el.remove());
  clone.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#fff';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${Math.round(w * SCALE)}" height="${Math.round(h * SCALE)}" style="${themeVariables()}; font-family: ${FONT}">`,
    `<style>${collectCss().replace(/<\/style/gi, '<\\/style')}</style>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>`,
    `<g class="canvas">${clone.innerHTML}</g>`,
    '</svg>'
  ].join('\n');
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportSvg(name: string): boolean {
  const svg = circuitSvg();
  if (!svg) return false;
  download(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
  return true;
}

export async function exportPng(name: string): Promise<boolean> {
  const svg = circuitSvg();
  if (!svg) return false;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片生成失败'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    // Twice the SVG size for a sharp picture, capped to keep memory reasonable.
    const k = Math.min(2, 8000 / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    download(blob, `${name}.png`);
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}
