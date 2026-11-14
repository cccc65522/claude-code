import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bendAxis, distToPolyline, route, type Pt } from '../../src/engine/geometry.ts';

const orthogonal = (pts: Pt[]) => pts.every((p, i) => i === 0 || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);

test('forward wires bend once in the middle, or run straight', () => {
  assert.deepEqual(route([0, 0], 'E', [10, 0], 'W'), [[0, 0], [10, 0]]);
  assert.deepEqual(route([0, 0], 'E', [10, 4], 'W'), [[0, 0], [5, 0], [5, 4], [10, 4]]);
  assert.equal(bendAxis([0, 0], 'E', [10, 4], 'W'), 'x');
  // A manual bend moves the vertical segment.
  assert.deepEqual(route([0, 0], 'E', [10, 4], 'W', 8), [[0, 0], [8, 0], [8, 4], [10, 4]]);
  assert.deepEqual(route([0, 0], 'E', [10, 0], 'W', 3), [[0, 0], [10, 0]], 'collinear points are merged');
});

test('backward wires leave and enter each pin the way it faces', () => {
  const pts = route([10, 0], 'E', [0, 6], 'W');
  assert.ok(orthogonal(pts));
  assert.deepEqual(pts[1], [11, 0], 'leaves to the right');
  assert.deepEqual(pts[pts.length - 2], [-1, 6], 'enters from the left');
  assert.equal(bendAxis([10, 0], 'E', [0, 6], 'W'), 'y');
  assert.deepEqual(route([10, 0], 'E', [0, 6], 'W', 9)[2], [11, 9]);
});

test('vertical pins and mixed directions', () => {
  // Output facing east into an enable pin facing south (below the source).
  const pts = route([0, 0], 'E', [6, 4], 'S');
  assert.ok(orthogonal(pts));
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts[pts.length - 1], [6, 4]);
  // A pin facing south above the target: single corner.
  assert.deepEqual(route([0, 0], 'S', [6, 4], 'W'), [[0, 0], [0, 4], [6, 4]]);
  assert.equal(bendAxis([0, 0], 'S', [6, 4], 'W'), null);
  assert.ok(orthogonal(route([0, 0], 'S', [3, 8], 'N')));
});

test('distance to a polyline', () => {
  const pts: Pt[] = [[0, 0], [10, 0], [10, 10]];
  assert.equal(distToPolyline(5, 3, pts), 3);
  assert.equal(distToPolyline(12, 5, pts), 2);
  assert.equal(distToPolyline(10, 0, pts), 0);
});

test('wires turning back into a column of pins use separate vertical runs', () => {
  // Three feedback wires from the right into pins at rows 1, 3, 5 of the same column.
  const runs = [1, 3, 5].map((y, i) => route([20, y + 8], 'E', [0, y], 'W', -2 - i));
  const targetVerticals = runs.map((pts) => pts[pts.length - 3][0]);
  assert.equal(new Set(targetVerticals).size, 3, `distinct x: ${targetVerticals}`);
  runs.forEach((pts) => assert.ok(orthogonal(pts)));
  // Branches leaving the same pin still share their first run.
  const b1 = route([10, 4], 'E', [0, 0], 'W');
  const b2 = route([10, 4], 'E', [0, 20], 'W');
  assert.deepEqual(b1[1], b2[1]);
});
