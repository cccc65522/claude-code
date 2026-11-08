// Scenes in links: JSON → deflate (CompressionStream) → base64url, in the URL fragment so it never reaches a
// server. Browsers without CompressionStream fall back to plain base64url.

const b64url = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const unb64url = str => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeScene(scene) {
  const bytes = new TextEncoder().encode(JSON.stringify(scene));
  if (typeof CompressionStream !== 'undefined') {
    try {
      return 'z' + b64url(await pipe(bytes, new CompressionStream('deflate-raw')));
    } catch { /* fall through */ }
  }
  return 'j' + b64url(bytes);
}

export async function decodeScene(code) {
  const kind = code[0], data = unb64url(code.slice(1));
  let bytes;
  if (kind === 'z') bytes = await pipe(data, new DecompressionStream('deflate-raw'));
  else if (kind === 'j') bytes = data;
  else throw new Error('unknown link format');
  const scene = JSON.parse(new TextDecoder().decode(bytes));
  if (!scene || !Array.isArray(scene.bodies)) throw new Error('not a scene');
  return scene;
}

export function shareURL(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = 's=' + code;
  return u.toString();
}

export function readHash() {
  const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(location.hash);
  return m ? m[1] : null;
}
