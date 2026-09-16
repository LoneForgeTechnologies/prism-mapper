import test from "node:test";
import assert from "node:assert/strict";
import {
  clampPoint,
  homographyFromQuad,
  inverseHomography,
  isValidQuad,
  matrixToGL,
  moveCorner,
  pointInQuad,
  transformPoint,
  translateQuad,
  validateQuad,
  type Quad,
} from "../src/geometry.ts";

const square: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const trapezoid: Quad = [
  { x: 0.2, y: 0.1 },
  { x: 0.8, y: 0.2 },
  { x: 0.95, y: 0.9 },
  { x: 0.05, y: 0.8 },
];
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("identity maps corners and interior without distortion", () => {
  const matrix = homographyFromQuad(square);
  for (const point of [...square, { x: 0.315, y: 0.786 }]) {
    const mapped = transformPoint(matrix, point);
    close(mapped.x, point.x);
    close(mapped.y, point.y);
  }
  assert.deepEqual([...matrixToGL(matrix)], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test("perspective warp maps all four corners and round-trips interior points", () => {
  const matrix = homographyFromQuad(trapezoid),
    inverse = inverseHomography(trapezoid);
  square.forEach((p, i) => {
    const q = transformPoint(matrix, p);
    close(q.x, trapezoid[i].x);
    close(q.y, trapezoid[i].y);
  });
  for (let y = 0; y <= 10; y++)
    for (let x = 0; x <= 10; x++) {
      const p = { x: x / 10, y: y / 10 },
        q = transformPoint(inverse, transformPoint(matrix, p));
      close(q.x, p.x);
      close(q.y, p.y);
    }
  // The midpoint of a line remains collinear but is generally not its arithmetic midpoint.
  const mapped = transformPoint(matrix, { x: 0.5, y: 0.5 });
  assert.ok(Math.abs(mapped.y - 0.5) > 0.01);
});

test("rejects reversed, crossed, concave, collinear, collapsed and non-finite corners", () => {
  const invalid: Quad[] = [
    [square[0], square[3], square[2], square[1]],
    [square[0], square[2], square[1], square[3]],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    [square[0], square[0], square[2], square[3]],
    [{ x: NaN, y: 0 }, square[1], square[2], square[3]],
    [{ x: Infinity, y: 0 }, square[1], square[2], square[3]],
    [
      { x: 0, y: 0 },
      { x: 0.001, y: 0 },
      { x: 0.001, y: 0.001 },
      { x: 0, y: 0.001 },
    ],
  ];
  for (const quad of invalid) {
    assert.equal(isValidQuad(quad), false);
    assert.ok(validateQuad(quad).reason);
    assert.throws(() => homographyFromQuad(quad));
  }
  assert.equal(validateQuad([]).valid, false);
});

test("corner drags clamp at bounds and reject folding without changing original", () => {
  const quad: Quad = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  assert.equal(moveCorner(quad, 0, { x: 0.95, y: 0.95 }), quad);
  assert.equal(moveCorner(quad, 0, { x: NaN, y: 0 }), quad);
  assert.deepEqual(moveCorner(quad, 0, { x: -0.1, y: -0.2 })[0], {
    x: 0,
    y: 0,
  });
  assert.deepEqual(quad[0], { x: 0.1, y: 0.1 });
  assert.deepEqual(clampPoint({ x: 1.3, y: -0.2 }), { x: 1, y: 0 });
});

test("whole-surface movement stops at bounds without skewing", () => {
  const moved = translateQuad(trapezoid, { x: 0.5, y: -0.5 });
  close(Math.max(...moved.map((p) => p.x)), 1);
  close(Math.min(...moved.map((p) => p.y)), 0);
  trapezoid.forEach((p, i) => {
    close(moved[i].x - p.x, 0.05);
    close(moved[i].y - p.y, -0.1);
  });
  assert.ok(isValidQuad(moved));
});

test("hit testing respects perspective boundaries and includes edges", () => {
  assert.ok(pointInQuad({ x: 0.5, y: 0.5 }, trapezoid));
  assert.ok(pointInQuad(trapezoid[0], trapezoid));
  assert.equal(pointInQuad({ x: 0.1, y: 0.1 }, trapezoid), false);
  assert.equal(pointInQuad({ x: NaN, y: 0 }, trapezoid), false);
});
