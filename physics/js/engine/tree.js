// Dynamic AABB tree (the broad phase): a balanced bounding-volume hierarchy of "fat" boxes.
// Leaves hold fixtures. A box is enlarged by a margin and by the predicted motion, so a body that moves a little
// does not need to be re-inserted every step. Insertion picks a sibling with the surface-area heuristic and the
// tree is kept balanced with AVL rotations.

export const AABB_MARGIN = 0.1;
const AABB_MULTIPLIER = 4;

const perimeter = n => 2 * (n.maxX - n.minX + n.maxY - n.minY);
const unionPerimeter = (a, b) =>
  2 * (Math.max(a.maxX, b.maxX) - Math.min(a.minX, b.minX) + Math.max(a.maxY, b.maxY) - Math.min(a.minY, b.minY));

function setUnion(n, a, b) {
  n.minX = Math.min(a.minX, b.minX);
  n.minY = Math.min(a.minY, b.minY);
  n.maxX = Math.max(a.maxX, b.maxX);
  n.maxY = Math.max(a.maxY, b.maxY);
}

export class DynamicTree {
  constructor() {
    this.nodes = [];
    this.root = -1;
    this.freeList = -1;
    this.count = 0;
    this.stack = [];
  }

  alloc() {
    let id;
    if (this.freeList !== -1) {
      id = this.freeList;
      this.freeList = this.nodes[id].next;
    } else {
      id = this.nodes.length;
      this.nodes.push({ minX: 0, minY: 0, maxX: 0, maxY: 0, parent: -1, c1: -1, c2: -1, height: 0, data: null, next: -1 });
    }
    const n = this.nodes[id];
    n.parent = n.c1 = n.c2 = -1;
    n.height = 0;
    n.data = null;
    n.next = -1;
    n.moved = false;
    this.count++;
    return id;
  }

  free(id) {
    const n = this.nodes[id];
    n.next = this.freeList;
    n.height = -1;
    n.data = null;
    this.freeList = id;
    this.count--;
  }

  createProxy(minX, minY, maxX, maxY, data) {
    const id = this.alloc();
    const n = this.nodes[id];
    n.minX = minX - AABB_MARGIN;
    n.minY = minY - AABB_MARGIN;
    n.maxX = maxX + AABB_MARGIN;
    n.maxY = maxY + AABB_MARGIN;
    n.data = data;
    this.insertLeaf(id);
    return id;
  }

  destroyProxy(id) {
    this.removeLeaf(id);
    this.free(id);
  }

  // Returns true if the proxy had to be re-inserted (its fat box no longer contained the tight box).
  moveProxy(id, minX, minY, maxX, maxY, dx, dy) {
    const n = this.nodes[id];
    if (n.minX <= minX && n.minY <= minY && n.maxX >= maxX && n.maxY >= maxY) return false;
    this.removeLeaf(id);
    minX -= AABB_MARGIN; minY -= AABB_MARGIN; maxX += AABB_MARGIN; maxY += AABB_MARGIN;
    dx *= AABB_MULTIPLIER; dy *= AABB_MULTIPLIER;
    if (dx < 0) minX += dx; else maxX += dx;
    if (dy < 0) minY += dy; else maxY += dy;
    n.minX = minX; n.minY = minY; n.maxX = maxX; n.maxY = maxY;
    this.insertLeaf(id);
    return true;
  }

  fat(id) {
    return this.nodes[id];
  }

  insertLeaf(leaf) {
    const nodes = this.nodes;
    if (this.root === -1) {
      this.root = leaf;
      nodes[leaf].parent = -1;
      return;
    }
    const L = nodes[leaf];
    let index = this.root;
    while (nodes[index].c1 !== -1) {
      const N = nodes[index], C1 = nodes[N.c1], C2 = nodes[N.c2];
      const area = perimeter(N);
      const combined = unionPerimeter(N, L);
      const cost = 2 * combined;
      const inherit = 2 * (combined - area);
      const cost1 = (C1.c1 === -1 ? unionPerimeter(L, C1) : unionPerimeter(L, C1) - perimeter(C1)) + inherit;
      const cost2 = (C2.c1 === -1 ? unionPerimeter(L, C2) : unionPerimeter(L, C2) - perimeter(C2)) + inherit;
      if (cost < cost1 && cost < cost2) break;
      index = cost1 < cost2 ? N.c1 : N.c2;
    }
    const sibling = index;
    const oldParent = nodes[sibling].parent;
    const np = this.alloc();
    const P = nodes[np];
    P.parent = oldParent;
    setUnion(P, L, nodes[sibling]);
    P.height = nodes[sibling].height + 1;
    if (oldParent !== -1) {
      if (nodes[oldParent].c1 === sibling) nodes[oldParent].c1 = np;
      else nodes[oldParent].c2 = np;
    } else {
      this.root = np;
    }
    P.c1 = sibling;
    P.c2 = leaf;
    nodes[sibling].parent = np;
    L.parent = np;
    this.fixUpwards(L.parent);
  }

  fixUpwards(index) {
    const nodes = this.nodes;
    while (index !== -1) {
      index = this.balance(index);
      const N = nodes[index], C1 = nodes[N.c1], C2 = nodes[N.c2];
      N.height = 1 + Math.max(C1.height, C2.height);
      setUnion(N, C1, C2);
      index = N.parent;
    }
  }

  removeLeaf(leaf) {
    const nodes = this.nodes;
    if (leaf === this.root) {
      this.root = -1;
      return;
    }
    const parent = nodes[leaf].parent;
    const grand = nodes[parent].parent;
    const sibling = nodes[parent].c1 === leaf ? nodes[parent].c2 : nodes[parent].c1;
    if (grand !== -1) {
      if (nodes[grand].c1 === parent) nodes[grand].c1 = sibling;
      else nodes[grand].c2 = sibling;
      nodes[sibling].parent = grand;
      this.free(parent);
      this.fixUpwards(grand);
    } else {
      this.root = sibling;
      nodes[sibling].parent = -1;
      this.free(parent);
    }
  }

  // AVL rotation if node a is unbalanced. Returns the new root of this subtree.
  balance(iA) {
    const nodes = this.nodes;
    const A = nodes[iA];
    if (A.c1 === -1 || A.height < 2) return iA;
    const iB = A.c1, iC = A.c2;
    const B = nodes[iB], C = nodes[iC];
    const bal = C.height - B.height;
    if (bal > 1) {
      const iF = C.c1, iG = C.c2, F = nodes[iF], G = nodes[iG];
      C.c1 = iA;
      C.parent = A.parent;
      A.parent = iC;
      if (C.parent !== -1) {
        if (nodes[C.parent].c1 === iA) nodes[C.parent].c1 = iC;
        else nodes[C.parent].c2 = iC;
      } else this.root = iC;
      if (F.height > G.height) {
        C.c2 = iF; A.c2 = iG; G.parent = iA;
        setUnion(A, B, G); setUnion(C, A, F);
        A.height = 1 + Math.max(B.height, G.height);
        C.height = 1 + Math.max(A.height, F.height);
      } else {
        C.c2 = iG; A.c2 = iF; F.parent = iA;
        setUnion(A, B, F); setUnion(C, A, G);
        A.height = 1 + Math.max(B.height, F.height);
        C.height = 1 + Math.max(A.height, G.height);
      }
      return iC;
    }
    if (bal < -1) {
      const iD = B.c1, iE = B.c2, D = nodes[iD], E = nodes[iE];
      B.c1 = iA;
      B.parent = A.parent;
      A.parent = iB;
      if (B.parent !== -1) {
        if (nodes[B.parent].c1 === iA) nodes[B.parent].c1 = iB;
        else nodes[B.parent].c2 = iB;
      } else this.root = iB;
      if (D.height > E.height) {
        B.c2 = iD; A.c1 = iE; E.parent = iA;
        setUnion(A, C, E); setUnion(B, A, D);
        A.height = 1 + Math.max(C.height, E.height);
        B.height = 1 + Math.max(A.height, D.height);
      } else {
        B.c2 = iE; A.c1 = iD; D.parent = iA;
        setUnion(A, C, D); setUnion(B, A, E);
        A.height = 1 + Math.max(C.height, D.height);
        B.height = 1 + Math.max(A.height, E.height);
      }
      return iB;
    }
    return iA;
  }

  // Calls fn(proxyId) for every leaf whose fat box overlaps the query box. fn returns false to stop.
  query(minX, minY, maxX, maxY, fn) {
    if (this.root === -1) return;
    const nodes = this.nodes, stack = this.stack;
    let top = 0;
    stack[top++] = this.root;
    while (top > 0) {
      const id = stack[--top];
      const n = nodes[id];
      if (n.maxX < minX || n.minX > maxX || n.maxY < minY || n.minY > maxY) continue;
      if (n.c1 === -1) {
        if (fn(id) === false) return;
      } else {
        stack[top++] = n.c1;
        stack[top++] = n.c2;
      }
    }
  }

  height() {
    return this.root === -1 ? 0 : this.nodes[this.root].height;
  }

  // Checks every structural invariant; throws on the first violation. Used by the tests.
  validate() {
    const nodes = this.nodes;
    let leaves = 0;
    const walk = (id, parent) => {
      const n = nodes[id];
      if (n.parent !== parent) throw new Error(`node ${id}: wrong parent`);
      if (n.c1 === -1) {
        if (n.c2 !== -1 || n.height !== 0) throw new Error(`leaf ${id}: bad children/height`);
        leaves++;
        return;
      }
      walk(n.c1, id);
      walk(n.c2, id);
      const a = nodes[n.c1], b = nodes[n.c2];
      if (n.height !== 1 + Math.max(a.height, b.height)) throw new Error(`node ${id}: bad height`);
      if (n.minX !== Math.min(a.minX, b.minX) || n.maxX !== Math.max(a.maxX, b.maxX) ||
        n.minY !== Math.min(a.minY, b.minY) || n.maxY !== Math.max(a.maxY, b.maxY)) throw new Error(`node ${id}: box is not the union`);
    };
    if (this.root !== -1) walk(this.root, -1);
    const internal = this.root === -1 ? 0 : leaves - 1;
    if (leaves + internal !== this.count) throw new Error('node count mismatch');
    return leaves;
  }
}
