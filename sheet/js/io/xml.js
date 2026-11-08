// Small non-validating XML parser, enough for the parts of an .xlsx package.
// Produces { name, attrs, children, text }; namespace prefixes are dropped from
// element and attribute names (r:id -> id is kept as 'r:id' AND 'id').

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // characters XML 1.0 forbids
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

const local = name => name.slice(name.indexOf(':') + 1);

export function parseXml(src) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.text += m[1];
    } else if (m[2] !== undefined) {
      if (stack.length > 1) stack.pop();
    } else if (m[3] !== undefined) {
      const attrs = {};
      let a;
      attrRe.lastIndex = 0;
      while ((a = attrRe.exec(m[4]))) {
        const v = decodeEntities(a[2] ?? a[3]);
        attrs[a[1]] = v;
        attrs[local(a[1])] ??= v;
      }
      const node = { name: local(m[3]), attrs, children: [], text: '' };
      top.children.push(node);
      if (m[5] !== '/') stack.push(node);
    } else if (m[6] !== undefined) {
      top.text += decodeEntities(m[6]);
    }
  }
  return root;
}

export const child = (node, name) => node?.children.find(c => c.name === name) || null;
export const childrenOf = (node, name) => node?.children.filter(c => c.name === name) || [];

// All text under a node (rich-text runs, phonetic runs excluded).
export function textOf(node) {
  if (!node) return '';
  if (node.name === 'rPh' || node.name === 'phoneticPr') return '';
  let s = node.name === 't' ? node.text : '';
  for (const c of node.children) s += textOf(c);
  return s;
}
