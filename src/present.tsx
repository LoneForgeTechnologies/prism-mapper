import React, { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Crosshair, Sun, X } from "lucide-react";
import type { Point, Project } from "./model";
import { ProjectionRenderer } from "./renderer";
import { readAudioFrame } from "./audio";
import {
  bufferLongSide,
  capBufferSize,
  fitAspect,
  type NudgeStep,
} from "./compact-logic";
import { ownsActivationKeys } from "./keys";
import { hideStatusBar, onBackButton } from "./native-glue";

export interface PresentGuide {
  id: string;
  points: Point[];
  selected: boolean;
  mask: boolean;
}

interface PresentProps {
  project: Project;
  /** The element the shared drag logic measures while presenting. */
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** The same move/up/cancel/double-tap handlers the editor stage uses. */
  stageHandlers: React.HTMLAttributes<HTMLDivElement>;
  guides: PresentGuide[];
  points: Point[];
  corner: number;
  locked: boolean;
  onOverlayDown: (e: React.PointerEvent) => void;
  onHandleDown: (e: React.PointerEvent, index: number) => void;
  onSelectCorner: (index: number) => void;
  onNudge: (dx: number, dy: number, step: NudgeStep) => void;
  onBlackout: () => void;
  onTogglePlay: () => void;
  onBrightness: (value: number) => void;
  onExit: () => void;
}

/** Call from the click that starts presenting: browsers only allow fullscreen from a gesture. */
export function requestPresentFullscreen() {
  try {
    const request = document.documentElement.requestFullscreen?.({
      navigationUI: "hide",
    });
    request?.catch(() => {});
  } catch {}
}
function leaveFullscreen() {
  try {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
  } catch {}
}

function keyboardFocusInside(container: HTMLElement | null) {
  const active = document.activeElement;
  if (!container || !active || !container.contains(active)) return false;
  try {
    return active.matches(":focus-visible");
  } catch {
    return true;
  }
}

const HIDE_AFTER_MS = 3500;
const IDLE_FRAME_MS = 250;

/**
 * Shows only the mapped output, full screen, with a renderer of its own. The
 * editor's renderer is paused by the caller while this is mounted. With Align
 * on, the editor's own pointer handlers drive the points drawn here.
 */
export function PresentMode(props: PresentProps) {
  const { project } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [shown, setShown] = useState(true);
  const [align, setAlign] = useState(false);
  const [brightness, setBrightness] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(props);
  latest.current = props;
  const sticky = useRef(false);
  sticky.current = align || brightness;
  const dirty = useRef(true);
  const hideTimer = useRef<number | undefined>(undefined);

  const poke = useCallback(() => {
    setShown(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      // Align and Brightness keep the bar open, and so does keyboard focus on
      // a button. A tap leaves focus on a button too, so that must not count.
      if (sticky.current || keyboardFocusInside(controlsRef.current)) return;
      setShown(false);
    }, HIDE_AFTER_MS);
  }, []);
  useEffect(() => {
    if (!align && !brightness) poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [align, brightness, poke]);

  // Size: the largest rectangle with the project's ratio that fits the screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const fit = fitAspect(box.width, box.height, project.width / project.height);
  const cssWidth = Math.floor(fit.width),
    cssHeight = Math.floor(fit.height);
  const buffer = capBufferSize(
    cssWidth,
    cssHeight,
    window.devicePixelRatio,
    bufferLongSide(
      matchMedia("(pointer: coarse)").matches,
      Math.min(innerWidth, innerHeight) <= 600,
    ),
  );
  useEffect(() => {
    dirty.current = true;
  }, [buffer.width, buffer.height]);

  // Own renderer. It stops while the page is hidden and idles when nothing moves.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: ProjectionRenderer;
    try {
      renderer = new ProjectionRenderer(canvas, {
        onError: (message) => setError(message),
      });
    } catch (e) {
      setError(String(e));
      return;
    }
    let frame = 0,
      elapsed = 0,
      previous = 0,
      lastDraw = 0,
      lastProject: Project | null = null;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const current = latest.current.project;
      elapsed += current.playing ? (now - previous) / 1000 : 0;
      previous = now;
      const moving = current.playing || readAudioFrame().active;
      if (
        !moving &&
        !dirty.current &&
        current === lastProject &&
        now - lastDraw < IDLE_FRAME_MS
      )
        return;
      dirty.current = false;
      lastDraw = now;
      lastProject = current;
      renderer.render(current, elapsed);
    };
    const start = () => {
      if (frame || document.hidden) return;
      previous = performance.now();
      dirty.current = true;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const visibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", visibility);
    start();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      stop();
      renderer.destroy();
    };
  }, []);

  // Best-effort fullscreen, wake lock, status bar and back button.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    let cancelled = false;
    let wasFullscreen = !!document.fullscreenElement;
    let sentinel: WakeLockSentinel | null = null;
    const undo: Array<() => void> = [];
    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock?.request("screen");
        if (!lock) return;
        if (cancelled) void lock.release().catch(() => {});
        else sentinel = lock;
      } catch {}
    };
    const reacquire = () => {
      if (!document.hidden) void acquire();
    };
    const fullscreen = () => {
      if (document.fullscreenElement) wasFullscreen = true;
      else if (wasFullscreen) latest.current.onExit();
    };
    void acquire();
    document.addEventListener("visibilitychange", reacquire);
    document.addEventListener("fullscreenchange", fullscreen);
    void hideStatusBar().then((restore) =>
      cancelled ? restore() : undo.push(restore),
    );
    void onBackButton(() => latest.current.onExit()).then((remove) =>
      cancelled ? remove() : undo.push(remove),
    );
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", reacquire);
      document.removeEventListener("fullscreenchange", fullscreen);
      try {
        void sentinel?.release().catch(() => {});
      } catch {}
      undo.forEach((fn) => fn());
      leaveFullscreen();
    };
  }, []);

  // Keyboard: B blackout, Esc exit, Space play/pause, arrows nudge while aligning.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target?.matches?.("input,textarea,select");
      if (e.key === "Escape") {
        e.preventDefault();
        latest.current.onExit();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        latest.current.onBlackout();
        poke();
      } else if (e.code === "Space" && !ownsActivationKeys(target)) {
        e.preventDefault();
        latest.current.onTogglePlay();
        poke();
      } else if (e.key.startsWith("Arrow") && align) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        latest.current.onNudge(
          e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0,
          e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0,
          step,
        );
      } else poke();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [align, poke]);

  const visible = shown || align || brightness;
  const blackout = project.blackout;
  const viewBox = `0 0 ${project.width} ${project.height}`;
  const toPoints = (points: Point[]) =>
    points
      .map((p) => `${p.x * project.width},${p.y * project.height}`)
      .join(" ");
  return (
    <div
      ref={rootRef}
      className={`present-root ${visible ? "controls-on" : ""} ${align ? "aligning" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Presenting this screen"
      tabIndex={-1}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse") poke();
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".present-controls")) return;
        if (align || brightness) return;
        if (shown) setShown(false);
        else poke();
      }}
    >
      <div
        className="stage present-stage"
        ref={props.stageRef}
        style={{ width: cssWidth, height: cssHeight }}
        {...(align ? props.stageHandlers : {})}
      >
        <canvas ref={canvasRef} width={buffer.width} height={buffer.height} />
        {align && (
          <>
            <svg
              className="mapping-overlay present-guides"
              viewBox={viewBox}
              preserveAspectRatio="none"
              onPointerDown={props.onOverlayDown}
            >
              {props.guides.map((g) => (
                <g
                  key={g.id}
                  className={`${g.selected ? "active-quad" : "inactive-quad"} ${g.mask ? "mask-quad" : ""}`}
                >
                  <polygon
                    points={toPoints(g.points)}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </svg>
            {props.points.map((p, i) => (
              <button
                key={i}
                type="button"
                className={`corner-handle ${props.corner === i ? "active" : ""} ${props.locked ? "locked" : ""}`}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                aria-label={`Point ${i + 1}`}
                onPointerDown={(e) => props.onHandleDown(e, i)}
                onClick={() => props.onSelectCorner(i)}
              >
                <span>{i + 1}</span>
              </button>
            ))}
          </>
        )}
      </div>
      {error && <div className="output-error">Output unavailable: {error}</div>}
      <div
        ref={controlsRef}
        className={`present-controls ${visible ? "visible" : ""}`}
        role="toolbar"
        aria-label="Presentation controls"
      >
        {align && (
          <p className="present-hint">
            {props.locked
              ? "This layer is locked. Unlock it to move its points."
              : "Drag a point to move it. Double-tap an edge to add one."}
          </p>
        )}
        {brightness && (
          <label className="present-brightness">
            <Sun size={18} aria-hidden="true" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              aria-label="Output brightness"
              value={project.brightness}
              onChange={(e) => {
                props.onBrightness(Number(e.target.value));
                dirty.current = true;
              }}
            />
            <output>{Math.round(project.brightness * 100)}%</output>
          </label>
        )}
        <div className="present-buttons">
          <button
            type="button"
            className={blackout ? "alert" : ""}
            aria-label={blackout ? "Restore light" : "Blackout"}
            aria-pressed={blackout}
            onClick={props.onBlackout}
          >
            <Circle size={20} />
            <span>{blackout ? "Restore" : "Blackout"}</span>
          </button>
          <button
            type="button"
            className={align ? "active" : ""}
            aria-label="Align"
            aria-pressed={align}
            onClick={() => setAlign((value) => !value)}
          >
            <Crosshair size={20} />
            <span>Align</span>
          </button>
          <button
            type="button"
            className={brightness ? "active" : ""}
            aria-label="Brightness"
            aria-expanded={brightness}
            onClick={() => setBrightness((value) => !value)}
          >
            <Sun size={20} />
            <span>Brightness</span>
          </button>
          <button type="button" aria-label="Exit" onClick={props.onExit}>
            <X size={20} />
            <span>Exit</span>
          </button>
        </div>
      </div>
    </div>
  );
}
