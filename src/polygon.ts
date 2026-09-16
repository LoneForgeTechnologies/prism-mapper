import { newSurface, type Point, type Surface } from "./model";
import { clampPoint, moveCorner, translateQuad } from "./geometry";

const EPSILON = 1e-9;
const MIN_SEPARATION = 1e-5;
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const finitePoint = (p: Point) =>
  p && Number.isFinite(p.x) && Number.isFinite(p.y);
const twiceArea = (points: readonly Point[]) =>
  points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0);

function onSegment(p: Point, a: Point, b: Point): boolean {
  return (
    Math.abs(cross(a, b, p)) <= EPSILON &&
    p.x >= Math.min(a.x, b.x) - EPSILON &&
    p.x <= Math.max(a.x, b.x) + EPSILON &&
    p.y >= Math.min(a.y, b.y) - EPSILON &&
    p.y <= Math.max(a.y, b.y) + EPSILON
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c),
    abD = cross(a, b, d);
  const cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  if (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  )
    return true;
  return (
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d)
  );
}

/** A single closed outline, in either winding direction. Holes are separate mask layers. */
export function validatePolygon(points: readonly Point[]): {
  valid: boolean;
  reason?: string;
} {
  if (!Array.isArray(points) || points.length < 3 || points.length > 64)
    return {
      valid: false,
      reason: "An outline needs between 3 and 64 points.",
    };
  if (points.some((p) => !finitePoint(p)))
    return {
      valid: false,
      reason: "Point coordinates must be finite numbers.",
    };
  if (points.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1))
    return {
      valid: false,
      reason: "Keep all points inside the output canvas.",
    };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (
        Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) <
        MIN_SEPARATION
      )
        return { valid: false, reason: "Outline points must be separated." };
    }
    const a = points[i],
      b = points[(i + 1) % points.length],
      c = points[(i + 2) % points.length];
    if (
      Math.abs(cross(a, b, c)) <= EPSILON &&
      (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0
    )
      return {
        valid: false,
        reason: "Outline edges cannot fold back on themselves.",
      };
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsIntersect(a, b, points[j], points[(j + 1) % points.length]))
        return {
          valid: false,
          reason: "Outline edges cannot cross or touch each other.",
        };
    }
  }
  if (Math.abs(twiceArea(points)) < 2e-5)
    return { valid: false, reason: "The outline is too small to project." };
  return { valid: true };
}

export function surfacePoints(surface: Surface): Point[] {
  return surface.polygon ?? surface.corners;
}

/** Polygon content uses a rectangular UV box; every outline edit refreshes it. */
export function boundsQuad(points: readonly Point[]): Surface["corners"] {
  if (!points.length || points.some((p) => !finitePoint(p)))
    throw new Error("Cannot find bounds without finite points.");
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y));
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** Includes the boundary, even for concave outlines or reversed winding. */
export function pointInPolygon(
  point: Point,
  points: readonly Point[],
): boolean {
  if (
    !finitePoint(point) ||
    points.length < 3 ||
    points.some((p) => !finitePoint(p))
  )
    return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j],
      b = points[i];
    if (onSegment(point, a, b)) return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function withPolygon(surface: Surface, polygon: Point[]): Surface {
  return validatePolygon(polygon).valid
    ? { ...surface, polygon, corners: boundsQuad(polygon) }
    : surface;
}

export function moveSurfacePoint(
  surface: Surface,
  index: number,
  point: Point,
): Surface {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= surfacePoints(surface).length ||
    !finitePoint(point)
  )
    return surface;
  if (!surface.polygon) {
    const corners = moveCorner(surface.corners, index, point);
    return corners === surface.corners ? surface : { ...surface, corners };
  }
  return withPolygon(
    surface,
    surface.polygon.map((p, i) => (i === index ? clampPoint(point) : { ...p })),
  );
}

/** Translate every point by the same bounded delta, so dragging an edge never squashes a shape. */
export function translateSurface(surface: Surface, delta: Point): Surface {
  if (!finitePoint(delta)) return surface;
  if (!surface.polygon)
    return { ...surface, corners: translateQuad(surface.corners, delta) };
  const bounds = boundsQuad(surface.polygon);
  const dx = Math.max(-bounds[0].x, Math.min(1 - bounds[2].x, delta.x));
  const dy = Math.max(-bounds[0].y, Math.min(1 - bounds[2].y, delta.y));
  return withPolygon(
    surface,
    surface.polygon.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  );
}

/** Adding a point to a quad explicitly converts it to a flat polygon mapping. */
export function insertSurfacePoint(
  surface: Surface,
  edgeIndex: number,
  point: Point,
): Surface {
  const points = surfacePoints(surface);
  if (
    points.length >= 64 ||
    !Number.isInteger(edgeIndex) ||
    edgeIndex < 0 ||
    edgeIndex >= points.length ||
    !finitePoint(point)
  )
    return surface;
  const polygon = points.map((p) => ({ ...p }));
  polygon.splice(edgeIndex + 1, 0, clampPoint(point));
  return withPolygon(surface, polygon);
}

export function removeSurfacePoint(surface: Surface, index: number): Surface {
  if (
    !surface.polygon ||
    surface.polygon.length <= 3 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= surface.polygon.length
  )
    return surface;
  return withPolygon(
    surface,
    surface.polygon.filter((_, i) => i !== index).map((p) => ({ ...p })),
  );
}

export type ShapePreset =
  "rectangle" | "square" | "triangle" | "circle" | "polygon";
export function createShapeSurface(
  preset: ShapePreset,
  index: number,
  points?: Point[],
  aspect = 16 / 9,
): Surface {
  const surface = newSurface(index);
  surface.name = `${preset[0].toUpperCase()}${preset.slice(1)} ${String(index + 1).padStart(2, "0")}`;
  if (preset === "rectangle") return surface;
  if (!Number.isFinite(aspect) || aspect <= 0) aspect = 16 / 9;
  const width = Math.min(0.4, 0.72 / aspect),
    height = width * aspect;
  const left = 0.5 - width / 2,
    right = 0.5 + width / 2,
    top = 0.5 - height / 2,
    bottom = 0.5 + height / 2;
  if (preset === "square")
    return {
      ...surface,
      corners: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    };
  const polygon =
    preset === "circle"
      ? Array.from({ length: 32 }, (_, i) => ({
          x: 0.5 + (width / 2) * Math.cos((i / 32) * 2 * Math.PI),
          y: 0.5 + (height / 2) * Math.sin((i / 32) * 2 * Math.PI),
        }))
      : preset === "triangle"
        ? [
            { x: 0.5, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
          ]
        : (
            points ?? [
              { x: 0.2, y: 0.2 },
              { x: 0.8, y: 0.2 },
              { x: 0.8, y: 0.5 },
              { x: 0.5, y: 0.5 },
              { x: 0.5, y: 0.8 },
              { x: 0.2, y: 0.8 },
            ]
          ).map((p) => ({ ...p }));
  const validity = validatePolygon(polygon);
  if (!validity.valid) throw new Error(validity.reason);
  return { ...surface, polygon, corners: boundsQuad(polygon) };
}

/** Ear clipping keeps concave shapes closed without covering their cutouts. Indices refer to original points. */
export function triangulatePolygon(points: readonly Point[]): number[] {
  if (!validatePolygon(points).valid) return [];
  const direction = Math.sign(twiceArea(points));
  const remaining = points.map((_, i) => i),
    triangles: number[] = [];
  // Redundant straight-edge points can be edited, but need no zero-area triangles.
  for (let i = remaining.length - 1; i >= 0 && remaining.length > 3; i--) {
    const a = points[remaining[(i + remaining.length - 1) % remaining.length]],
      b = points[remaining[i]],
      c = points[remaining[(i + 1) % remaining.length]];
    if (Math.abs(cross(a, b, c)) <= EPSILON) remaining.splice(i, 1);
  }
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const ia = remaining[(i + remaining.length - 1) % remaining.length],
        ib = remaining[i],
        ic = remaining[(i + 1) % remaining.length];
      const a = points[ia],
        b = points[ib],
        c = points[ic];
      if (cross(a, b, c) * direction <= EPSILON) continue;
      const containsPoint = remaining.some((index) => {
        if (index === ia || index === ib || index === ic) return false;
        const p = points[index];
        return (
          cross(a, b, p) * direction >= -EPSILON &&
          cross(b, c, p) * direction >= -EPSILON &&
          cross(c, a, p) * direction >= -EPSILON
        );
      });
      if (containsPoint) continue;
      triangles.push(ia, ib, ic);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return [];
  }
  triangles.push(...remaining);
  return triangles;
}
