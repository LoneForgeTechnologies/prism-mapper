import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Film,
  FilePlus,
  Pause,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { Project, RecentProject, Scene, Show } from "./model";
import { newId } from "./compat";
import { cueAt, showDuration } from "./timeline";
import "./show.css";

export function showTime(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function DurationInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const textFor = (number: number) => {
    const tenths = Math.round(number * 10);
    const seconds = (tenths % 600) / 10;
    return `${Math.floor(tenths / 600)}:${seconds % 1 ? seconds.toFixed(1).padStart(4, "0") : String(seconds).padStart(2, "0")}`;
  };
  const [text, setText] = useState(textFor(value));
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(textFor(value));
    setError(false);
  }, [value]);
  const commit = () => {
    const parts = text.trim().split(":");
    const number =
      parts.length === 2 &&
      /^\d+$/.test(parts[0]) &&
      /^\d{1,2}(?:\.\d+)?$/.test(parts[1]) &&
      Number(parts[1]) < 60
        ? Number(parts[0]) * 60 + Number(parts[1])
        : parts.length === 1 && /^\d+(?:\.\d+)?$/.test(parts[0])
          ? Number(parts[0])
          : NaN;
    if (!Number.isFinite(number) || number < 0.1 || number > 7200) {
      setError(true);
      return;
    }
    setError(false);
    onChange(number);
    setText(textFor(number));
  };
  return (
    <span className="show-duration-input">
      <input
        aria-label="Clip length, minutes and seconds"
        aria-invalid={error}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setText(textFor(value));
            setError(false);
            event.stopPropagation();
          }
        }}
      />
      {error && (
        <small role="alert">Use m:ss or seconds, up to 120 minutes.</small>
      )}
    </span>
  );
}

interface Props {
  project: Project;
  recent: RecentProject[];
  busy: boolean;
  position: number;
  playing: boolean;
  active: boolean;
  /** The height the person chose for the dock, in pixels. A short window shrinks it. */
  height: number;
  collapsed: boolean;
  onHeightChange(height: number): void;
  onCollapsedChange(collapsed: boolean): void;
  onClose(): void;
  onShowChange(show: Show): void;
  onCapture(): void;
  onLoadScene(scene: Scene): void;
  onUpdateScene(scene: Scene): void;
  onImportVideos(): void;
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  onSeek(position: number): void;
  onSave(): void;
  onNew(): void;
  onOpenRecent(id: string): void;
}

/**
 * The dock's real height, and the tallest it can be before the preview above it
 * would run out of room. The page's CSS owns both limits (the dock's own
 * min-height and the preview area's min-height), so they are read, not repeated.
 */
function useDockMetrics(panel: React.RefObject<HTMLElement | null>) {
  const [metrics, setMetrics] = useState({
    width: 0,
    height: 0,
    min: 0,
    max: 0,
  });
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const measure = () => {
      const area =
        element.parentElement?.querySelector<HTMLElement>(".canvas-area");
      const min = parseFloat(getComputedStyle(element).minHeight) || 0;
      const room = area ? parseFloat(getComputedStyle(area).minHeight) || 0 : 0;
      const { width, height } = element.getBoundingClientRect();
      const max = area
        ? Math.max(
            min,
            Math.floor(
              Math.round(height) + area.getBoundingClientRect().height - room,
            ),
          )
        : Math.round(height);
      setMetrics((previous) =>
        previous.width === Math.round(width) &&
        previous.height === Math.round(height) &&
        previous.min === min &&
        previous.max === max
          ? previous
          : { width: Math.round(width), height: Math.round(height), min, max },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [panel]);
  return metrics;
}

/**
 * Scenes and timeline, docked under the preview. The layers, the preview and
 * the inspector stay on screen and in use while it is open. Drag its top edge
 * (or use the arrow keys on it) to resize it, or collapse it to a single bar
 * that keeps the show transport.
 */
export function ShowPanel(props: Props) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    return () =>
      document.querySelector<HTMLButtonElement>(".show-toggle")?.focus();
  }, []);
  const { collapsed } = props;
  const metrics = useDockMetrics(panelRef);
  const resize = useRef<{ startY: number; startHeight: number } | null>(null);
  const setHeight = (value: number) =>
    props.onHeightChange(
      Math.round(Math.min(metrics.max, Math.max(metrics.min, value))),
    );
  const show = props.project.show ?? { scenes: [], cues: [], loop: false };
  const duration = showDuration(show);
  const current = props.active ? cueAt(show, props.position) : null;
  const [dragging, setDragging] = useState<string | null>(null);
  const [limitError, setLimitError] = useState(false);
  useEffect(() => setLimitError(false), [props.project.show]);
  const missing = show.cues.some((cue) =>
    show.scenes
      .find((scene) => scene.id === cue.sceneId)
      ?.surfaces.some((surface) => {
        const media = props.project.media.find(
          (entry) => entry.id === surface.source.replace(/^media:/, ""),
        );
        return (
          surface.visible && surface.kind !== "mask" && media && !media.url
        );
      }),
  );
  const change = (next: Show) => {
    const tooLong = showDuration(next) > 86400;
    setLimitError(tooLong);
    if (!tooLong) props.onShowChange(next);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= show.cues.length || from === to) return;
    const cues = [...show.cues];
    const [item] = cues.splice(from, 1);
    cues.splice(to, 0, item);
    change({ ...show, cues });
  };
  let start = 0;
  let timelineStart = 0;
  const timelineClips = show.cues.map((cue, index) => {
    const begins = timelineStart;
    timelineStart += cue.duration;
    return {
      cue,
      index,
      begins,
      scene: show.scenes.find((item) => item.id === cue.sceneId),
    };
  });
  const tickStep =
    [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400].find(
      (step) => step >= duration / 8,
    ) ?? 14400;
  const ticks = [0];
  for (let tick = tickStep; tick < duration; tick += tickStep) {
    if (duration - tick >= tickStep * 0.6) ticks.push(tick);
  }
  if (duration) ticks.push(duration);
  const playhead = duration
    ? Math.min(1, Math.max(0, props.position / duration))
    : 0;
  const nowPlaying = current
    ? (timelineClips[current.index]?.scene?.name ?? "Missing scene")
    : "";
  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="show-panel"
      aria-label="Scenes and timeline"
      data-collapsed={collapsed ? "true" : undefined}
      // Container queries are too new for the old web views, so the bar's
      // layout follows the panel's own measured width.
      data-stacked={
        metrics.width > 0 && metrics.width < (collapsed ? 540 : 720)
          ? "true"
          : undefined
      }
      data-short-title={
        metrics.width >= (collapsed ? 540 : 720) &&
        metrics.width < (collapsed ? 700 : 860)
          ? "true"
          : undefined
      }
      data-narrow={
        metrics.width > 0 && metrics.width < 540 ? "true" : undefined
      }
      style={{ "--show-dock-h": `${props.height}px` } as React.CSSProperties}
    >
      {!collapsed && (
        <div
          className="show-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize scenes and timeline"
          aria-valuemin={metrics.min}
          aria-valuemax={metrics.max}
          aria-valuenow={metrics.height}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resize.current = {
              startY: event.clientY,
              startHeight: metrics.height,
            };
          }}
          onPointerMove={(event) => {
            if (resize.current)
              setHeight(
                resize.current.startHeight +
                  resize.current.startY -
                  event.clientY,
              );
          }}
          onPointerUp={() => {
            resize.current = null;
          }}
          onPointerCancel={() => {
            resize.current = null;
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 96 : 24;
            const next =
              event.key === "ArrowUp"
                ? metrics.height + step
                : event.key === "ArrowDown"
                  ? metrics.height - step
                  : event.key === "Home"
                    ? metrics.min
                    : event.key === "End"
                      ? metrics.max
                      : null;
            if (next === null) return;
            // The editor's arrow keys move the selected layer; these are ours.
            event.preventDefault();
            event.stopPropagation();
            setHeight(next);
          }}
        />
      )}
      <div className="show-bar">
        <h2>
          <Film size={16} /> <span>Scenes & timeline</span>
        </h2>
        <div className="show-transport">
          <button
            className="show-play"
            onClick={props.playing ? props.onPause : props.onPlay}
            disabled={!show.cues.length || missing || props.busy}
            title={
              missing
                ? "Some scene videos are missing. Load the scene and relink its media before playing."
                : undefined
            }
          >
            {props.playing ? <Pause size={16} /> : <Play size={16} />}
            {props.playing ? "Pause show" : "Play show"}
          </button>
          <button
            className="show-stop"
            onClick={props.onStop}
            disabled={!props.active}
            title="Stop show"
          >
            <Square size={13} /> Stop show
          </button>
          <output aria-label="Show position">
            {showTime(props.position)} / {showTime(duration)}
          </output>
          <label>
            <input
              type="checkbox"
              checked={show.loop}
              onChange={(event) =>
                change({ ...show, loop: event.target.checked })
              }
            />{" "}
            Loop show
          </label>
          {collapsed && nowPlaying && (
            <span className="show-now" title={nowPlaying}>
              {nowPlaying}
            </span>
          )}
        </div>
        <div className="show-heading-actions">
          {!collapsed && (
            <>
              <button onClick={props.onNew} title="New show">
                <FilePlus size={14} /> New show
              </button>
              <button
                onClick={props.onSave}
                disabled={props.busy}
                title="Save project"
              >
                <Save size={14} /> Save project
              </button>
            </>
          )}
          <button
            className="icon-button"
            onClick={() => props.onCollapsedChange(!collapsed)}
            aria-label={
              collapsed
                ? "Expand scenes and timeline"
                : "Collapse scenes and timeline"
            }
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          <button
            className="icon-button"
            onClick={props.onClose}
            aria-label="Close scenes and timeline"
          >
            <X size={18} />
          </button>
        </div>
        {collapsed && duration > 0 && (
          <span
            className="show-bar-progress"
            style={{ width: `${playhead * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {!collapsed && (
        <div className="show-body">
          {props.recent.length > 0 && (
            <nav className="show-projects" aria-label="Recent show projects">
              <span>Quick open</span>
              {props.recent.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => props.onOpenRecent(entry.id)}
                  disabled={props.busy}
                  title={entry.path}
                >
                  {entry.name}
                </button>
              ))}
            </nav>
          )}
          {missing && (
            <p className="show-warning" role="alert">
              Some scene videos are missing. Load the scene and relink its media
              before playing.
            </p>
          )}
          {limitError && (
            <p className="show-warning" role="alert">
              A show can be up to 24 hours long. Shorten or remove a clip before
              adding more.
            </p>
          )}
          <div className="show-timeline">
            <div className="show-section-heading">
              <h3>
                Timeline{" "}
                <small>
                  {show.cues.length} clips · {showTime(duration)} total
                </small>
              </h3>
              <button
                onClick={props.onImportVideos}
                disabled={
                  props.busy ||
                  show.scenes.length >= 128 ||
                  show.cues.length >= 512
                }
              >
                <Film size={14} />
                {props.busy ? "Reading clips…" : "Add videos to timeline"}
              </button>
            </div>
            <div className="show-timeline-scroll">
              <div className="show-timeline-canvas">
                <div
                  className="show-time-ruler"
                  aria-label="Show time ruler"
                  style={{
                    backgroundSize: `${duration ? (tickStep / duration) * 100 : 100}% 100%`,
                  }}
                >
                  {ticks.map((tick) => (
                    <span
                      key={tick}
                      className={`show-time-tick${tick === 0 ? " first" : tick === duration ? " last" : ""}`}
                      style={{
                        left: `${duration ? (tick / duration) * 100 : 0}%`,
                      }}
                    >
                      {showTime(tick)}
                    </span>
                  ))}
                  <input
                    type="range"
                    aria-label="Show playhead"
                    aria-valuetext={`${showTime(props.position)} of ${showTime(duration)}`}
                    min={0}
                    max={duration || 1}
                    step={0.1}
                    value={Math.min(props.position, duration)}
                    disabled={!duration}
                    onChange={(event) =>
                      props.onSeek(Number(event.target.value))
                    }
                  />
                </div>
                <div
                  className="show-timeline-strip"
                  aria-label="Timeline overview"
                >
                  {timelineClips.map(({ cue, index, begins, scene }) => (
                    <button
                      key={cue.id}
                      style={{ width: `${(cue.duration / duration) * 100}%` }}
                      className={current?.index === index ? "current" : ""}
                      aria-current={
                        current?.index === index ? "step" : undefined
                      }
                      aria-label={`Seek to clip ${index + 1}: ${scene?.name ?? "Missing scene"} at ${showTime(begins)}`}
                      title={`${scene?.name ?? "Missing scene"}, ${showTime(begins)} to ${showTime(begins + cue.duration)}`}
                      onClick={() => props.onSeek(begins)}
                    >
                      {current?.index === index && (
                        <span
                          className="show-clip-progress"
                          style={{
                            width: `${Math.min(100, Math.max(0, ((props.position - begins) / cue.duration) * 100))}%`,
                          }}
                        />
                      )}
                      <span className="show-clip-number">{index + 1}</span>
                      <strong>{scene?.name ?? "Missing scene"}</strong>
                      <span className="show-clip-length">
                        {showTime(cue.duration)}
                      </span>
                    </button>
                  ))}
                  {!show.cues.length && (
                    <p className="show-empty">
                      Add your videos to build a timeline.
                    </p>
                  )}
                </div>
                {duration > 0 && (
                  <div
                    className="show-timeline-playhead"
                    style={{ left: `${playhead * 100}%` }}
                    aria-hidden="true"
                  >
                    <span />
                  </div>
                )}
              </div>
            </div>
            <div className="show-timeline-caption">
              <span>
                Click the ruler to seek. Clips play from left to right.
              </span>
              {current && (
                <strong>
                  {props.playing ? "Playing" : "Paused"}: {nowPlaying}
                </strong>
              )}
            </div>
          </div>
          <div className="show-columns">
            <div className="show-scenes">
              <div className="show-section-heading">
                <h3>
                  Scenes <small>{show.scenes.length}</small>
                </h3>
                <button
                  onClick={props.onCapture}
                  disabled={show.scenes.length >= 128}
                >
                  <Plus size={14} /> Capture look
                </button>
              </div>
              {!show.scenes.length && (
                <p className="show-empty">
                  Map your surfaces, then capture the look as a scene. Or add
                  your MP4s to make a scene for each video on the selected
                  surface.
                </p>
              )}
              {show.scenes.map((scene) => (
                <div className="show-scene" key={scene.id}>
                  <input
                    aria-label={`Scene name ${scene.name}`}
                    maxLength={200}
                    value={scene.name}
                    onChange={(event) =>
                      change({
                        ...show,
                        scenes: show.scenes.map((item) =>
                          item.id === scene.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <div className="show-scene-actions">
                    <button onClick={() => props.onLoadScene(scene)}>
                      Load look
                    </button>
                    <button
                      onClick={() => props.onUpdateScene(scene)}
                      title="Replace this scene with the current mapped look"
                    >
                      Update look
                    </button>
                    <button
                      disabled={show.cues.length >= 512}
                      onClick={() =>
                        change({
                          ...show,
                          cues: [
                            ...show.cues,
                            { id: newId(), sceneId: scene.id, duration: 120 },
                          ],
                        })
                      }
                    >
                      <Plus size={13} /> Add to timeline
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete scene ${scene.name} and its timeline clips`}
                      onClick={() =>
                        change({
                          ...show,
                          scenes: show.scenes.filter(
                            (item) => item.id !== scene.id,
                          ),
                          cues: show.cues.filter(
                            (item) => item.sceneId !== scene.id,
                          ),
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="show-playlist">
              <div className="show-section-heading">
                <h3>Clip order & lengths</h3>
              </div>
              {!show.cues.length && (
                <p className="show-empty">
                  Add videos above, or add a captured scene to the timeline.
                </p>
              )}
              <ol className="show-cues">
                {show.cues.map((cue, index) => {
                  const begins = start;
                  start += cue.duration;
                  const scene = show.scenes.find(
                    (item) => item.id === cue.sceneId,
                  );
                  return (
                    <li
                      key={cue.id}
                      className={current?.index === index ? "current" : ""}
                      draggable
                      onDragStart={() => setDragging(cue.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const from = show.cues.findIndex(
                          (item) => item.id === dragging,
                        );
                        if (from >= 0) move(from, index);
                        setDragging(null);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <button
                        className="show-cue-go"
                        onClick={() => props.onSeek(begins)}
                        aria-label={`Go to clip ${index + 1}: ${scene?.name}`}
                      >
                        <span>{index + 1}</span>
                        <strong>{scene?.name ?? "Missing scene"}</strong>
                        <small>{showTime(begins)}</small>
                      </button>
                      <DurationInput
                        value={cue.duration}
                        onChange={(duration) =>
                          change({
                            ...show,
                            cues: show.cues.map((item) =>
                              item.id === cue.id ? { ...item, duration } : item,
                            ),
                          })
                        }
                      />
                      <button
                        className="icon-button"
                        disabled={index === 0}
                        aria-label={`Move clip ${index + 1} earlier`}
                        onClick={() => move(index, index - 1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={index === show.cues.length - 1}
                        aria-label={`Move clip ${index + 1} later`}
                        onClick={() => move(index, index + 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Duplicate clip ${index + 1}`}
                        disabled={show.cues.length >= 512}
                        onClick={() => {
                          const cues = [...show.cues];
                          cues.splice(index + 1, 0, { ...cue, id: newId() });
                          change({ ...show, cues });
                        }}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remove clip ${index + 1}`}
                        onClick={() =>
                          change({
                            ...show,
                            cues: show.cues.filter(
                              (item) => item.id !== cue.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
          <p className="show-footnote">
            <Clock3 size={12} />
            <span>
              Build a show from your local videos. Each clip starts at the
              beginning, with clean cuts between scenes. Video audio is muted.
              Save separate projects for band intro, pre-show and each set.
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
