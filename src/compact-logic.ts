import type { Point } from "./model";

/** The desktop shell needs 1050px. Anything narrower gets the compact touch layout. */
export const COMPACT_QUERY = "(max-width: 1049.98px)";
/** Short landscape screens, such as a phone on its side, use a side drawer. */
export const DRAWER_QUERY = "(orientation: landscape) and (max-height: 520px)";

export const SHEETS = ["layers", "looks", "adjust", "audio", "show"] as const;
export type SheetId = (typeof SHEETS)[number];

/** Tapping the open sheet's tab closes it; any other tab switches to it. */
export const toggleSheet = (
  current: SheetId | null,
  next: SheetId,
): SheetId | null => (current === next ? null : next);

export type NudgeStep = 1 | 10;
export type NudgeDirection = "left" | "right" | "up" | "down";
export const NUDGE_VECTORS: Record<NudgeDirection, readonly [number, number]> =
  {
    left: [-1, 0],
    right: [1, 0],
    up: [0, -1],
    down: [0, 1],
  };

/**
 * A normalised point moved by `step` output pixels. This is the same math the
 * arrow keys use, so the nudge pad and the keyboard can never disagree.
 */
export function nudgedPoint(
  point: Point,
  dx: number,
  dy: number,
  step: number,
  width: number,
  height: number,
): Point {
  return {
    x: point.x + (dx * step) / width,
    y: point.y + (dy * step) / height,
  };
}

/** The middle of the edge that starts at `edgeIndex`, or null for a bad index. */
export function edgeMidpoint(
  points: readonly Point[],
  edgeIndex: number,
): Point | null {
  if (
    points.length < 2 ||
    !Number.isInteger(edgeIndex) ||
    edgeIndex < 0 ||
    edgeIndex >= points.length
  )
    return null;
  const a = points[edgeIndex],
    b = points[(edgeIndex + 1) % points.length];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export interface TapSample {
  x: number;
  y: number;
  time: number;
}
export const TAP_MAX_MOVE = 10;
export const TAP_MAX_DURATION = 350;
export const DOUBLE_TAP_WINDOW = 400;
export const DOUBLE_TAP_RADIUS = 32;

/** A tap is a short press that barely moved; anything else is a drag or a hold. */
export function isTap(
  down: TapSample,
  up: TapSample,
  maxMove = TAP_MAX_MOVE,
  maxDuration = TAP_MAX_DURATION,
): boolean {
  return (
    up.time - down.time <= maxDuration &&
    Math.hypot(up.x - down.x, up.y - down.y) <= maxMove
  );
}

/**
 * Recognises two quick touch taps in nearly the same place. Mouse and pen are
 * ignored on purpose: a mouse already gets a native double-click event.
 */
export function createDoubleTapDetector(
  windowMs = DOUBLE_TAP_WINDOW,
  radius = DOUBLE_TAP_RADIUS,
) {
  let previous: TapSample | null = null;
  return {
    tap(sample: TapSample, pointerType: string): boolean {
      if (pointerType !== "touch") {
        previous = null;
        return false;
      }
      if (
        previous &&
        sample.time - previous.time <= windowMs &&
        Math.hypot(sample.x - previous.x, sample.y - previous.y) <= radius
      ) {
        previous = null;
        return true;
      }
      previous = sample;
      return false;
    },
    reset() {
      previous = null;
    },
  };
}

/**
 * Some browsers also synthesise a double-click from a double-tap. Both paths
 * ask this guard first, so one gesture inserts at most one point.
 */
export function createRepeatGuard(windowMs = 700, radius = 24) {
  let last: TapSample | null = null;
  return (sample: TapSample): boolean => {
    if (
      last &&
      sample.time - last.time < windowMs &&
      Math.hypot(sample.x - last.x, sample.y - last.y) <= radius
    )
      return false;
    last = sample;
    return true;
  };
}

/** Largest rectangle of the given aspect ratio that fits inside a box. */
export function fitAspect(boxWidth: number, boxHeight: number, ratio: number) {
  if (!(boxWidth > 0 && boxHeight > 0 && ratio > 0))
    return { width: 0, height: 0 };
  const width = Math.min(boxWidth, boxHeight * ratio);
  return { width, height: width / ratio };
}

export const MAX_DEVICE_PIXEL_RATIO = 2;
/** Phones and tablets get a smaller drawing buffer to protect battery and GPU. */
export const bufferLongSide = (coarsePointer: boolean, smallScreen: boolean) =>
  coarsePointer || smallScreen ? 1280 : 1920;

/** Drawing-buffer size for a canvas shown at a CSS size: DPR capped, long side capped. */
export function capBufferSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  longSide: number,
) {
  const ratio = Math.min(
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1,
    MAX_DEVICE_PIXEL_RATIO,
  );
  let width = cssWidth * ratio,
    height = cssHeight * ratio;
  const long = Math.max(width, height);
  if (long > longSide) {
    width *= longSide / long;
    height *= longSide / long;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}
