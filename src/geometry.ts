import type { Point, Surface } from "./model";

export type Quad = Surface["corners"];
/** Row-major 3×3 projective transform. */
export type Matrix3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
const EPSILON = 1e-9;
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

/** Corners run clockwise on screen: top-left, top-right, bottom-right, bottom-left. */
export function validateQuad(corners: readonly Point[]): {
  valid: boolean;
  reason?: string;
} {
  if (corners.length !== 4)
    return { valid: false, reason: "A surface needs four corners." };
  if (corners.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return {
      valid: false,
      reason: "Corner coordinates must be finite numbers.",
    };
  let twiceArea = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i],
      b = corners[(i + 1) % 4],
      c = corners[(i + 2) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-5)
      return { valid: false, reason: "Surface corners must be separated." };
    if (cross(a, b, c) <= EPSILON)
      return {
        valid: false,
        reason:
          "Keep corners clockwise without crossing or folding the surface.",
      };
    twiceArea += a.x * b.y - b.x * a.y;
  }
  if (twiceArea < 2e-5)
    return { valid: false, reason: "The surface is too small to project." };
  return { valid: true };
}

export const isValidQuad = (corners: readonly Point[]): boolean =>
  validateQuad(corners).valid;

export function clampPoint(point: Point): Point {
  return {
    x: Math.max(0, Math.min(1, Number.isFinite(point.x) ? point.x : 0)),
    y: Math.max(0, Math.min(1, Number.isFinite(point.y) ? point.y : 0)),
  };
}

/** Reject a folding drag instead of letting the projected texture invert. */
export function moveCorner(corners: Quad, index: number, point: Point): Quad {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > 3 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  )
    return corners;
  const result = corners.map((p, i) =>
    i === index ? clampPoint(point) : { ...p },
  ) as Quad;
  return isValidQuad(result) ? result : corners;
}

/** Move the entire surface while preserving its shape at the canvas edges. */
export function translateQuad(corners: Quad, delta: Point): Quad {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return corners;
  const dx = Math.max(
    -Math.min(...corners.map((p) => p.x)),
    Math.min(1 - Math.max(...corners.map((p) => p.x)), delta.x),
  );
  const dy = Math.max(
    -Math.min(...corners.map((p) => p.y)),
    Math.min(1 - Math.max(...corners.map((p) => p.y)), delta.y),
  );
  return corners.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
}

export function pointInQuad(point: Point, corners: Quad): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    corners.every((a, i) => cross(a, corners[(i + 1) % 4], point) >= -EPSILON)
  );
}

/** Unit square → arbitrary convex quad. The projective denominator removes triangle seams. */
export function homographyFromQuad(corners: Quad): Matrix3 {
  const validity = validateQuad(corners);
  if (!validity.valid) throw new Error(validity.reason);
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0,
    h = 0;
  if (Math.abs(dx3) > EPSILON || Math.abs(dy3) > EPSILON) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) < EPSILON)
      throw new Error("The surface cannot be mapped at this angle.");
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

export function invertMatrix3(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const determinant =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new Error("The surface transform is singular.");
  return [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
}

export const inverseHomography = (corners: Quad): Matrix3 =>
  invertMatrix3(homographyFromQuad(corners));

export function transformPoint(matrix: Matrix3, point: Point): Point {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const denominator = g * point.x + h * point.y + i;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12)
    throw new Error("Point is on the projective horizon.");
  return {
    x: (a * point.x + b * point.y + c) / denominator,
    y: (d * point.x + e * point.y + f) / denominator,
  };
}

/** WebGL uniforms take column-major data and forbid transposing at upload. */
export const matrixToGL = (m: Matrix3): Float32Array =>
  new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
