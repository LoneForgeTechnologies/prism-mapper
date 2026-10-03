import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Circle,
  Layers,
  Magnet,
  Pause,
  Play,
  Projector,
  Redo2,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Square,
  Triangle,
  Undo2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  COMPACT_QUERY,
  NUDGE_VECTORS,
  SHEETS,
  createDoubleTapDetector,
  isTap,
  type NudgeDirection,
  type NudgeStep,
  type SheetId,
} from "./compact-logic";

/** Reads the query synchronously, so the very first paint already has the right layout. */
export function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof matchMedia === "function" && matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
export const useCompactLayout = () => useMediaQuery(COMPACT_QUERY);

export const SHEET_META: Record<
  SheetId,
  { label: string; Icon: LucideIcon; panel: "left" | "right" }
> = {
  layers: { label: "Layers", Icon: Layers, panel: "left" },
  looks: { label: "Looks", Icon: Sparkles, panel: "left" },
  adjust: { label: "Adjust", Icon: SlidersHorizontal, panel: "right" },
  audio: { label: "Audio", Icon: AudioLines, panel: "right" },
  show: { label: "Show", Icon: Projector, panel: "right" },
};
const panelId = (sheet: SheetId) => `sheet-${SHEET_META[sheet].panel}`;
export const SHEET_PANEL_IDS = { left: "sheet-left", right: "sheet-right" };

/** Panels as a bottom navigation. The open panel's button reports aria-expanded. */
export function BottomNav({
  active,
  sheet,
  onSelect,
}: {
  active: boolean;
  sheet: SheetId | null;
  onSelect: (id: SheetId) => void;
}) {
  if (!active) return null;
  return (
    <nav className="bottom-nav" aria-label="Panels">
      {SHEETS.map((id) => {
        const { label, Icon } = SHEET_META[id];
        const open = sheet === id;
        return (
          <button
            key={id}
            id={`nav-${id}`}
            type="button"
            className={open ? "active" : ""}
            aria-expanded={open}
            aria-controls={panelId(id)}
            onClick={() => onSelect(id)}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Title row for an open sheet. Renders nothing for the other panel or on desktop. */
export function SheetBar({
  panel,
  sheet,
  meta,
  onClose,
}: {
  panel: "left" | "right";
  sheet: SheetId | null;
  meta?: React.ReactNode;
  onClose: () => void;
}) {
  if (!sheet || SHEET_META[sheet].panel !== panel) return null;
  const { label } = SHEET_META[sheet];
  return (
    <div className="sheet-bar">
      <span className="sheet-grip" aria-hidden="true" />
      <h2>{label}</h2>
      {meta ? <span className="sheet-meta">{meta}</span> : null}
      <button
        type="button"
        className="icon-button sheet-close"
        aria-label={`Close ${label} panel`}
        onClick={onClose}
      >
        <X size={18} />
      </button>
    </div>
  );
}

/**
 * Escape closes the open sheet before anything else reacts to it. Focus moves
 * into a sheet when it opens and returns to its tab when it closes.
 */
export function useSheetBehaviour(
  sheet: SheetId | null,
  close: () => void,
  blocked: boolean,
) {
  const lastOpen = useRef<SheetId | null>(null);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || blocked || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sheet, blocked, close]);
  useEffect(() => {
    if (sheet) {
      lastOpen.current = sheet;
      const frame = requestAnimationFrame(() =>
        document.getElementById(panelId(sheet))?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(frame);
    }
    const previous = lastOpen.current;
    lastOpen.current = null;
    if (!previous) return;
    const active = document.activeElement;
    if (!active || active === document.body)
      document
        .getElementById(`nav-${previous}`)
        ?.focus({ preventScroll: true });
  }, [sheet]);
}

/**
 * Touch double-tap for outline points, plus a context-menu guard so a long
 * press on the stage never opens a callout. Mouse keeps its native double-click.
 */
export function useStageTouch(
  onDoubleTap: (clientX: number, clientY: number) => void,
) {
  const down = useRef<{
    x: number;
    y: number;
    time: number;
    id: number;
  } | null>(null);
  const detector = useRef(createDoubleTapDetector());
  const lastType = useRef("mouse");
  const handler = useRef(onDoubleTap);
  handler.current = onDoubleTap;
  return useMemo(
    () => ({
      onPointerDownCapture: (e: React.PointerEvent) => {
        lastType.current = e.pointerType;
        down.current =
          e.pointerType === "touch" && e.isPrimary
            ? { x: e.clientX, y: e.clientY, time: e.timeStamp, id: e.pointerId }
            : null;
      },
      onPointerUp: (e: React.PointerEvent) => {
        const start = down.current;
        down.current = null;
        if (!start || e.pointerType !== "touch" || e.pointerId !== start.id)
          return;
        const end = { x: e.clientX, y: e.clientY, time: e.timeStamp };
        if (!isTap(start, end)) {
          detector.current.reset();
          return;
        }
        if (detector.current.tap(end, "touch")) handler.current(end.x, end.y);
      },
      onPointerCancel: () => {
        down.current = null;
        detector.current.reset();
      },
      onContextMenu: (e: React.MouseEvent) => {
        if (lastType.current !== "mouse") e.preventDefault();
      },
    }),
    [],
  );
}

interface ExtrasProps {
  active: boolean;
  canAddPoint: boolean;
  onAddPoint: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  playing: boolean;
  onTogglePlay: () => void;
  blackout: boolean;
  onBlackout: () => void;
}

/** Extra buttons that join the tool strip in the compact layout. */
export function CompactToolExtras(props: ExtrasProps) {
  if (!props.active) return null;
  return (
    <>
      {props.canAddPoint && (
        <button
          type="button"
          className="compact-extra add-point"
          aria-label="Add point"
          title="Split the edge after the selected point"
          onClick={props.onAddPoint}
        >
          <Spline size={18} />
          <span>Add point</span>
        </button>
      )}
      <button
        type="button"
        className="compact-extra first-right"
        aria-label="Undo"
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        <Undo2 size={18} />
      </button>
      <button
        type="button"
        className="compact-extra"
        aria-label="Redo"
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        <Redo2 size={18} />
      </button>
      <button
        type="button"
        className="compact-extra"
        aria-label={props.playing ? "Pause playback" : "Resume playback"}
        onClick={props.onTogglePlay}
      >
        {props.playing ? <Pause size={18} /> : <Play size={18} />}
        <span>{props.playing ? "Pause" : "Play"}</span>
      </button>
      <button
        type="button"
        className={`compact-extra ${props.blackout ? "alert" : ""}`}
        aria-label={props.blackout ? "Restore light" : "Blackout"}
        aria-pressed={props.blackout}
        onClick={props.onBlackout}
      >
        <Circle size={18} />
        <span>{props.blackout ? "Restore" : "Blackout"}</span>
      </button>
    </>
  );
}

const ARROWS: Record<NudgeDirection, { Icon: LucideIcon; label: string }> = {
  up: { Icon: ArrowUp, label: "Nudge up" },
  left: { Icon: ArrowLeft, label: "Nudge left" },
  right: { Icon: ArrowRight, label: "Nudge right" },
  down: { Icon: ArrowDown, label: "Nudge down" },
};

/** One arrow. A tap moves once; holding repeats like a held arrow key. */
function NudgeButton({
  direction,
  disabled,
  onNudge,
}: {
  direction: NudgeDirection;
  disabled: boolean;
  onNudge: (dx: number, dy: number, repeat?: boolean) => void;
}) {
  const timers = useRef<{ wait?: number; repeat?: number }>({});
  const latest = useRef(onNudge);
  latest.current = onNudge;
  const stop = useCallback(() => {
    window.clearTimeout(timers.current.wait);
    window.clearInterval(timers.current.repeat);
    timers.current = {};
  }, []);
  useEffect(() => stop, [stop]);
  const [dx, dy] = NUDGE_VECTORS[direction];
  const { Icon, label } = ARROWS[direction];
  return (
    <button
      type="button"
      className={`nudge-${direction}`}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
        stop();
        latest.current(dx, dy);
        timers.current.wait = window.setTimeout(() => {
          timers.current.repeat = window.setInterval(
            () => latest.current(dx, dy, true),
            70,
          );
        }, 380);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      // Pointer presses already moved the point. A click with no pointer
      // (detail 0) is the keyboard or a screen reader activating the button.
      onClick={(e) => {
        if (e.detail === 0) latest.current(dx, dy);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Icon size={22} />
    </button>
  );
}

interface DockProps {
  active: boolean;
  disabled: boolean;
  step: NudgeStep;
  onStep: (step: NudgeStep) => void;
  /** `repeat` is true for the steps after the first while an arrow is held down. */
  onNudge: (dx: number, dy: number, step: number, repeat?: boolean) => void;
  label: string;
  index: number;
  count: number;
  onPoint: (index: number) => void;
  x: number;
  y: number;
  snap: boolean;
  onSnap: () => void;
}

/** Fine alignment for touch: a 1 px / 10 px nudge pad and a point stepper. */
export function NudgeDock(props: DockProps) {
  if (!props.active) return null;
  const { index, count, step } = props;
  const nudge = (dx: number, dy: number, repeat?: boolean) =>
    props.onNudge(dx, dy, step, repeat);
  return (
    <div className="nudge-dock" role="group" aria-label="Fine alignment">
      <div className="nudge-pad">
        <NudgeButton direction="up" disabled={props.disabled} onNudge={nudge} />
        <NudgeButton
          direction="left"
          disabled={props.disabled}
          onNudge={nudge}
        />
        <span className="nudge-center" aria-hidden="true">
          {index + 1}
        </span>
        <NudgeButton
          direction="right"
          disabled={props.disabled}
          onNudge={nudge}
        />
        <NudgeButton
          direction="down"
          disabled={props.disabled}
          onNudge={nudge}
        />
      </div>
      <div className="nudge-side">
        <div className="nudge-point">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous point"
            disabled={count < 2}
            onClick={() => props.onPoint((index - 1 + count) % count)}
          >
            <ChevronLeft size={18} />
          </button>
          <span aria-live="polite">{props.label}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next point"
            disabled={count < 2}
            onClick={() => props.onPoint((index + 1) % count)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="nudge-steps" role="group" aria-label="Nudge step">
          {([1, 10] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={step === value}
              aria-label={`Nudge ${value} pixel${value === 1 ? "" : "s"}`}
              className={step === value ? "active" : ""}
              onClick={() => props.onStep(value)}
            >
              {value} px
            </button>
          ))}
        </div>
        <div className="nudge-foot">
          <span className="nudge-readout" aria-label="Point position">
            X <b>{props.x}</b> Y <b>{props.y}</b>
          </span>
          <button
            type="button"
            className={`snap-toggle ${props.snap ? "active" : ""}`}
            aria-pressed={props.snap}
            aria-label="Snap to other points"
            onClick={props.onSnap}
          >
            <Magnet size={15} />
            Snap
          </button>
        </div>
      </div>
    </div>
  );
}

/** Extra shapes for the Layers sheet; the rectangle and outline buttons already live there. */
export function ShapeRow({
  active,
  onAdd,
}: {
  active: boolean;
  onAdd: (shape: "square" | "triangle" | "circle" | "mask") => void;
}) {
  if (!active) return null;
  const shapes = [
    ["square", "Square", Square],
    ["triangle", "Triangle", Triangle],
    ["circle", "Circle", Circle],
    ["mask", "Cutout", Scissors],
  ] as const;
  return (
    <div className="layer-add-row shape-row">
      {shapes.map(([shape, label, Icon]) => (
        <button
          key={shape}
          type="button"
          className="add-surface"
          aria-label={shape === "mask" ? "Draw cutout mask" : `Add ${shape}`}
          onClick={() => onAdd(shape)}
        >
          <Icon size={15} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
