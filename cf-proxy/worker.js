// Cloudflare Worker: reverse-proxies the 复习本 site on GitHub Pages so it can be
// served from your own domain. Static site, so only GET and HEAD are forwarded.
//
// Optional Worker variables (Settings → Variables) override the defaults below:
//   UPSTREAM   e.g. https://cccc65522.github.io
//   BASE_PATH  e.g. /claude-code

const DEFAULT_UPSTREAM = 'https://cccc65522.github.io';
const DEFAULT_BASE_PATH = '/claude-code';

// Request headers worth passing on; everything else (cookies, CF headers) stays here.
const PASS_HEADERS = [
  'accept',
  'accept-encoding',
  'accept-language',
  'if-modified-since',
  'if-none-match',
  'range',
  'user-agent',
];

export default {
  async fetch(request, env = {}) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const upstream = (env.UPSTREAM || DEFAULT_UPSTREAM).replace(/\/+$/, '');
    const basePath = (env.BASE_PATH ?? DEFAULT_BASE_PATH).replace(/\/+$/, '');
    const url = new URL(request.url);

    const headers = new Headers();
    for (const name of PASS_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const upstreamResponse = await fetch(upstream + basePath + url.pathname + url.search, {
      method: request.method,
      headers,
      redirect: 'manual',
      // Cache at Cloudflare's edge for 5 minutes; the site's own service worker
      // still fetches network-first, so updates show up within minutes.
      cf: { cacheEverything: true, cacheTtl: 300 },
    });

    const response = new Response(upstreamResponse.body, upstreamResponse);
    const location = response.headers.get('location');
    if (location) {
      response.headers.set('location', rewriteLocation(location, upstream, basePath, url.origin));
    }
    return response;
  },
};

// GitHub Pages redirects e.g. /claude-code → /claude-code/; point such redirects
// back at the proxy's own origin so the browser never lands on github.io.
export function rewriteLocation(location, upstream, basePath, origin) {
  const target = new URL(location, upstream + basePath + '/');
  if (target.origin !== new URL(upstream).origin) return location;
  if (basePath && target.pathname !== basePath && !target.pathname.startsWith(basePath + '/')) {
    return location;
  }
  const path = target.pathname.slice(basePath.length) || '/';
  return origin + path + target.search + target.hash;
}
