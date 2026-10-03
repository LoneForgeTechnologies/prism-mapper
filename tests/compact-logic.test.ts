import test from "node:test";
import assert from "node:assert/strict";
import { createShapeSurface, insertSurfacePoint } from "../src/polygon.ts";
import {
  MAX_DEVICE_PIXEL_RATIO,
  NUDGE_VECTORS,
  bufferLongSide,
  capBufferSize,
  createDoubleTapDetector,
  createRepeatGuard,
  edgeMidpoint,
  fitAspect,
  isTap,
  nudgedPoint,
  toggleSheet,
} from "../src/compact-logic.ts";

const near = (a: number, b: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test("tapping the open sheet closes it and any other tab switches", () => {
  assert.equal(toggleSheet(null, "layers"), "layers");
  assert.equal(toggleSheet("layers", "layers"), null);
  assert.equal(toggleSheet("layers", "adjust"), "adjust");
});

test("nudge moves exactly 1 or 10 output pixels on any canvas size", () => {
  const start = { x: 0.4, y: 0.6 };
  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
    [3840, 2160],
    [1024, 768],
  ])
    for (const step of [1, 10])
      for (const [name, [dx, dy]] of Object.entries(NUDGE_VECTORS)) {
        const moved = nudgedPoint(start, dx, dy, step, width, height);
        near((moved.x - start.x) * width, dx * step, 1e-6);
        near((moved.y - start.y) * height, dy * step, 1e-6);
        assert.ok(name.length > 0);
      }
});

test("nudge uses the same arithmetic as the arrow keys", () => {
  // The keyboard handler adds (+/-amount or 0) / canvas size to the point.
  const keyboard = (
    p: { x: number; y: number },
    key: string,
    amount: number,
  ) => ({
    x:
      p.x +
      (key === "ArrowRight" ? amount : key === "ArrowLeft" ? -amount : 0) /
        1920,
    y:
      p.y +
      (key === "ArrowDown" ? amount : key === "ArrowUp" ? -amount : 0) / 1080,
  });
  const p = { x: 0.123456789, y: 0.987654321 };
  const keys: [string, string][] = [
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
  ];
  for (const [key, direction] of keys)
    for (const amount of [1, 10]) {
      const [dx, dy] = NUDGE_VECTORS[direction as keyof typeof NUDGE_VECTORS];
      assert.deepEqual(
        nudgedPoint(p, dx, dy, amount, 1920, 1080),
        keyboard(p, key, amount),
      );
    }
});

test("edge midpoint covers the closing edge and rejects bad indexes", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  assert.deepEqual(edgeMidpoint(square, 0), { x: 0.5, y: 0 });
  assert.deepEqual(edgeMidpoint(square, 3), { x: 0, y: 0.5 });
  assert.equal(edgeMidpoint(square, 4), null);
  assert.equal(edgeMidpoint(square, -1), null);
  assert.equal(edgeMidpoint(square, 0.5), null);
  assert.equal(edgeMidpoint([{ x: 0, y: 0 }], 0), null);
});

test("splitting an edge at its midpoint follows insertSurfacePoint rules", () => {
  const triangle = createShapeSurface("triangle", 0);
  const points = triangle.polygon!;
  const mid = edgeMidpoint(points, 1)!;
  const next = insertSurfacePoint(triangle, 1, mid);
  assert.equal(next.polygon!.length, 4);
  assert.deepEqual(next.polygon![2], mid);
  // The new point sits between the two ends of the edge it split.
  assert.deepEqual(next.polygon![1], points[1]);
  assert.deepEqual(next.polygon![3], points[2]);
  // At the 64 point limit the surface is returned untouched.
  const circle = createShapeSurface("circle", 0);
  let full = circle;
  // Each original edge starts at an even index once its neighbours are split.
  for (let i = 0; i < 32; i++)
    full = insertSurfacePoint(full, 2 * i, edgeMidpoint(full.polygon!, 2 * i)!);
  assert.equal(full.polygon!.length, 64);
  assert.equal(
    insertSurfacePoint(full, 0, edgeMidpoint(full.polygon!, 0)!),
    full,
  );
});

test("a tap is short and still; a drag or a hold is not", () => {
  const down = { x: 100, y: 100, time: 1000 };
  assert.equal(isTap(down, { x: 103, y: 104, time: 1120 }), true);
  assert.equal(isTap(down, { x: 140, y: 100, time: 1100 }), false);
  assert.equal(isTap(down, { x: 100, y: 100, time: 1600 }), false);
});

test("double-tap needs two touch taps close in time and place", () => {
  const detector = createDoubleTapDetector();
  assert.equal(detector.tap({ x: 50, y: 50, time: 0 }, "touch"), false);
  assert.equal(detector.tap({ x: 56, y: 52, time: 250 }, "touch"), true);
  // A third tap starts a fresh pair instead of counting again.
  assert.equal(detector.tap({ x: 56, y: 52, time: 300 }, "touch"), false);
  assert.equal(detector.tap({ x: 56, y: 52, time: 900 }, "touch"), false);
  // Too far apart or too slow is not a double-tap.
  detector.reset();
  detector.tap({ x: 50, y: 50, time: 0 }, "touch");
  assert.equal(detector.tap({ x: 200, y: 50, time: 200 }, "touch"), false);
  detector.reset();
  detector.tap({ x: 50, y: 50, time: 0 }, "touch");
  assert.equal(detector.tap({ x: 50, y: 50, time: 900 }, "touch"), false);
});

test("mouse and pen never count as double-taps", () => {
  const detector = createDoubleTapDetector();
  for (const type of ["mouse", "pen"]) {
    assert.equal(detector.tap({ x: 10, y: 10, time: 0 }, type), false);
    assert.equal(detector.tap({ x: 10, y: 10, time: 100 }, type), false);
  }
  // A mouse click between two touch taps breaks the pair.
  detector.tap({ x: 10, y: 10, time: 0 }, "touch");
  detector.tap({ x: 10, y: 10, time: 50 }, "mouse");
  assert.equal(detector.tap({ x: 10, y: 10, time: 100 }, "touch"), false);
});

test("a synthesised double-click cannot insert a second point", () => {
  const allow = createRepeatGuard();
  assert.equal(allow({ x: 200, y: 120, time: 5000 }), true);
  assert.equal(allow({ x: 203, y: 121, time: 5040 }), false);
  assert.equal(allow({ x: 205, y: 118, time: 5400 }), false);
  // A different place, or much later, is a deliberate new insertion.
  assert.equal(allow({ x: 400, y: 120, time: 5450 }), true);
  assert.equal(allow({ x: 400, y: 120, time: 6300 }), true);
});

test("aspect fit never overflows its box", () => {
  const wide = fitAspect(390, 600, 16 / 9);
  near(wide.width, 390);
  near(wide.height, 390 / (16 / 9));
  const tall = fitAspect(900, 300, 16 / 9);
  near(tall.height, 300);
  near(tall.width, 300 * (16 / 9));
  assert.deepEqual(fitAspect(0, 100, 1), { width: 0, height: 0 });
  assert.deepEqual(fitAspect(100, 100, Number.NaN), { width: 0, height: 0 });
});

test("drawing buffers are capped by device pixel ratio and long side", () => {
  assert.equal(MAX_DEVICE_PIXEL_RATIO, 2);
  assert.equal(bufferLongSide(true, false), 1280);
  assert.equal(bufferLongSide(false, true), 1280);
  assert.equal(bufferLongSide(false, false), 1920);
  // A 3x phone is treated as 2x.
  assert.deepEqual(capBufferSize(400, 225, 3, 1280), {
    width: 800,
    height: 450,
  });
  // A big tablet viewport is cut down to the long-side cap, keeping the shape.
  const tablet = capBufferSize(820, 461, 2, 1280);
  assert.equal(tablet.width, 1280);
  assert.ok(Math.abs(tablet.width / tablet.height - 820 / 461) < 0.01);
  // Desktop-class cap and a 4K-ish request.
  assert.deepEqual(capBufferSize(1920, 1080, 2, 1920), {
    width: 1920,
    height: 1080,
  });
  // Bad input falls back to a 1x buffer and never returns zero.
  assert.deepEqual(capBufferSize(300, 100, Number.NaN, 1280), {
    width: 300,
    height: 100,
  });
  assert.deepEqual(capBufferSize(0, 0, 2, 1280), { width: 1, height: 1 });
});
