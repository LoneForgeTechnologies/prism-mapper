import test from "node:test";
import assert from "node:assert/strict";
import { type Point, newSurface } from "../src/model.ts";
import {
  boundsQuad,
  createShapeSurface,
  insertSurfacePoint,
  moveSurfacePoint,
  pointInPolygon,
  removeSurfacePoint,
  surfacePoints,
  translateSurface,
  triangulatePolygon,
  validatePolygon,
} from "../src/polygon.ts";

const outline: Point[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.4 },
  { x: 0.4, y: 0.4 },
  { x: 0.4, y: 0.9 },
  { x: 0.1, y: 0.9 },
];
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const area = (points: readonly Point[]) =>
  Math.abs(
    points.reduce((sum, a, i) => {
      const b = points[(i + 1) % points.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0),
  ) / 2;

test("outline validation accepts concavity and both windings; rejects crossings, touching, duplicates and degenerate paths", () => {
  for (const points of [outline, [...outline].reverse()])
    assert.equal(validatePolygon(points).valid, true);
  const invalid = [
    [],
    outline.slice(0, 2),
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0 },
      { x: 0, y: 1 },
    ],
    [...outline, outline[0]],
    [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 0.001, y: 0 },
      { x: 0, y: 0.001 },
    ],
    [{ x: NaN, y: 0 }, ...outline.slice(1)],
    [{ x: Infinity, y: 0 }, ...outline.slice(1)],
    [{ x: -0.1, y: 0 }, ...outline.slice(1)],
    Array.from({ length: 65 }, (_, i) => ({
      x: 0.5 + 0.3 * Math.cos((i / 65) * 2 * Math.PI),
      y: 0.5 + 0.3 * Math.sin((i / 65) * 2 * Math.PI),
    })),
  ];
  for (const points of invalid) {
    assert.equal(validatePolygon(points).valid, false, JSON.stringify(points));
    assert.ok(validatePolygon(points).reason);
    assert.deepEqual(triangulatePolygon(points), []);
  }
});

test("hit testing follows concave borders and includes points on vertices and edges", () => {
  for (const points of [outline, [...outline].reverse()]) {
    assert.equal(pointInPolygon({ x: 0.2, y: 0.7 }, points), true);
    assert.equal(pointInPolygon({ x: 0.7, y: 0.2 }, points), true);
    assert.equal(pointInPolygon({ x: 0.7, y: 0.7 }, points), false);
    assert.equal(pointInPolygon({ x: 0.4, y: 0.7 }, points), true);
    assert.equal(pointInPolygon(points[0], points), true);
    assert.equal(pointInPolygon({ x: NaN, y: 0.2 }, points), false);
  }
});

test("triangles exactly cover convex, concave and straight-edge outlines in both windings", () => {
  const shapes = [
    outline,
    createShapeSurface("circle", 0).polygon!,
    createShapeSurface("triangle", 0).polygon!,
    [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  ];
  // Deterministic star-shaped outlines stress concave ear clipping at the maximum supported complexity.
  for (let count = 4; count <= 64; count += 3) {
    shapes.push(
      Array.from({ length: count }, (_, i) => {
        const radius = i % 2 ? 0.19 : 0.42;
        return {
          x: 0.5 + radius * Math.cos((i / count) * 2 * Math.PI),
          y: 0.5 + radius * Math.sin((i / count) * 2 * Math.PI),
        };
      }),
    );
  }
  for (const original of shapes)
    for (const points of [original, [...original].reverse()]) {
      assert.equal(validatePolygon(points).valid, true);
      const triangles = triangulatePolygon(points);
      assert.ok(triangles.length >= 3);
      assert.equal(triangles.length % 3, 0);
      let covered = 0;
      for (let i = 0; i < triangles.length; i += 3) {
        const vertices = triangles
          .slice(i, i + 3)
          .map((index) => points[index]);
        assert.equal(vertices.length, 3);
        covered += area(vertices);
        assert.equal(
          pointInPolygon(
            {
              x: vertices.reduce((s, p) => s + p.x, 0) / 3,
              y: vertices.reduce((s, p) => s + p.y, 0) / 3,
            },
            points,
          ),
          true,
        );
      }
      close(covered, area(points));
    }
});

test("polygon editing refreshes content bounds and rejects an invalid drag without mutation", () => {
  const surface = createShapeSurface("polygon", 0, outline);
  const before = structuredClone(surface);
  const moved = moveSurfacePoint(surface, 0, { x: 0.05, y: 0.05 });
  assert.deepEqual(moved.corners, boundsQuad(moved.polygon!));
  assert.deepEqual(moved.corners[0], { x: 0.05, y: 0.05 });
  assert.deepEqual(surface, before);
  assert.equal(moveSurfacePoint(surface, 0, { x: 0.8, y: 0.8 }), surface);
  assert.equal(moveSurfacePoint(surface, -1, { x: 0, y: 0 }), surface);
  assert.equal(moveSurfacePoint(surface, 0, { x: NaN, y: 0 }), surface);
  assert.deepEqual(surfacePoints(surface), outline);
});

test("whole-layer translation stops at the canvas without changing edge lengths or concavity", () => {
  const surface = createShapeSurface("polygon", 0, outline);
  const moved = translateSurface(surface, { x: 8, y: -8 });
  close(moved.corners[2].x, 1);
  close(moved.corners[0].y, 0);
  moved.polygon!.forEach((point, i) => {
    close(point.x - outline[i].x, 0.1);
    close(point.y - outline[i].y, -0.1);
  });
  close(area(moved.polygon!), area(outline));
  assert.equal(translateSurface(surface, { x: Infinity, y: 0 }), surface);
});

test("point insertion and removal keep valid outlines and protect perspective quads and triangles", () => {
  const rectangle = newSurface(0);
  const inserted = insertSurfacePoint(rectangle, 0, {
    x: 0.5,
    y: rectangle.corners[0].y,
  });
  assert.equal(inserted.polygon?.length, 5);
  assert.equal(validatePolygon(inserted.polygon!).valid, true);
  assert.equal(removeSurfacePoint(rectangle, 0), rectangle);
  const restored = removeSurfacePoint(inserted, 1);
  assert.deepEqual(restored.polygon, rectangle.corners);
  const triangle = createShapeSurface("triangle", 0);
  assert.equal(removeSurfacePoint(triangle, 0), triangle);
  assert.equal(insertSurfacePoint(triangle, 0, triangle.polygon![0]), triangle);
  assert.equal(insertSurfacePoint(triangle, -1, { x: 0.5, y: 0.5 }), triangle);
  assert.equal(removeSurfacePoint(inserted, 8), inserted);
  const foldedBridge = createShapeSurface("polygon", 0, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0.6, y: 0.2 },
    { x: 0.4, y: 1 },
    { x: 0, y: 1 },
  ]);
  // Removing this corner would make the new A→C edge cut across the inward notch.
  assert.equal(removeSurfacePoint(foldedBridge, 1), foldedBridge);
  const sixtyFour = createShapeSurface(
    "polygon",
    0,
    Array.from({ length: 64 }, (_, i) => ({
      x: 0.5 + 0.3 * Math.cos((i / 64) * 2 * Math.PI),
      y: 0.5 + 0.3 * Math.sin((i / 64) * 2 * Math.PI),
    })),
  );
  assert.equal(insertSurfacePoint(sixtyFour, 0, { x: 0.6, y: 0.6 }), sixtyFour);
});

test("shape presets create independent valid mapping layers with physical square and circle proportions", () => {
  const rectangle = createShapeSurface("rectangle", 0);
  assert.equal(rectangle.polygon, undefined);
  for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16]) {
    const square = createShapeSurface("square", 0, undefined, aspect);
    close(
      (square.corners[1].x - square.corners[0].x) * aspect,
      square.corners[2].y - square.corners[0].y,
    );
    const circle = createShapeSurface("circle", 0, undefined, aspect);
    assert.equal(circle.polygon!.length, 32);
    close(
      (circle.corners[1].x - circle.corners[0].x) * aspect,
      circle.corners[2].y - circle.corners[0].y,
    );
    assert.equal(validatePolygon(circle.polygon!).valid, true);
  }
  const polygon = createShapeSurface("polygon", 0, outline);
  polygon.polygon![0].x = 0;
  assert.equal(outline[0].x, 0.1);
  assert.notEqual(
    createShapeSurface("triangle", 0).id,
    createShapeSurface("triangle", 0).id,
  );
  assert.throws(() => createShapeSurface("polygon", 0, []), /3 and 64/);
});
