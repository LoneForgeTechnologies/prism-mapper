import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Copy,
  Film,
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

export function ShowPanel(props: Props) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
    return () =>
      document.querySelector<HTMLButtonElement>(".show-toggle")?.focus();
  }, []);
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
  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="show-panel"
      aria-label="Scenes and timeline"
    >
      <div className="show-heading">
        <div>
          <h2>
            <Film size={18} /> Scenes & timeline
          </h2>
          <p>
            Build a show from your local videos. Each clip starts at the
            beginning.
          </p>
        </div>
        <div className="show-heading-actions">
          <button onClick={props.onNew}>New show</button>
          <button onClick={props.onSave} disabled={props.busy}>
            <Save size={15} /> Save project
          </button>
          <button
            className="icon-button"
            onClick={props.onClose}
            aria-label="Close scenes and timeline"
          >
            <X size={19} />
          </button>
        </div>
      </div>
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
      <div className="show-transport">
        <button
          className="show-play"
          onClick={props.playing ? props.onPause : props.onPlay}
          disabled={!show.cues.length || missing || props.busy}
        >
          {props.playing ? <Pause size={17} /> : <Play size={17} />}
          {props.playing ? "Pause show" : "Play show"}
        </button>
        <button onClick={props.onStop} disabled={!props.active}>
          <Square size={14} /> Stop show
        </button>
        <output aria-label="Show position">
          {showTime(props.position)} / {showTime(duration)}
        </output>
        <input
          type="range"
          aria-label="Show playhead"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(props.position, duration)}
          disabled={!duration}
          onChange={(event) => props.onSeek(Number(event.target.value))}
        />
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
      </div>
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
              Map your surfaces, then capture the look as a scene. Or add your
              MP4s to make a scene for each video on the selected surface.
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
        <div className="show-timeline">
          <div className="show-section-heading">
            <h3>
              Timeline{" "}
              <small>
                {show.cues.length} clips · {showTime(duration)}
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
              <Film size={14} />{" "}
              {props.busy ? "Reading clips…" : "Add videos to timeline"}
            </button>
          </div>
          {!show.cues.length && (
            <p className="show-empty">
              Add clips in show order. Set each length to 2:00 for two-minute
              videos, then loop the sequence for pre-show or a set.
            </p>
          )}
          <div className="show-timeline-strip" aria-label="Timeline overview">
            {show.cues.map((cue, index) => (
              <button
                key={cue.id}
                style={{ flexGrow: cue.duration }}
                className={current?.index === index ? "current" : ""}
                title={`${show.scenes.find((scene) => scene.id === cue.sceneId)?.name}, ${showTime(cue.duration)}`}
                onClick={() =>
                  props.onSeek(
                    show.cues
                      .slice(0, index)
                      .reduce((sum, item) => sum + item.duration, 0),
                  )
                }
              >
                {index + 1}
              </button>
            ))}
          </div>
          <ol className="show-cues">
            {show.cues.map((cue, index) => {
              const begins = start;
              start += cue.duration;
              const scene = show.scenes.find((item) => item.id === cue.sceneId);
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
                        cues: show.cues.filter((item) => item.id !== cue.id),
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
        <Clock3 size={12} /> Clean cuts between scenes. Video audio is muted.
        Save separate projects for band intro, pre-show and each set.
      </p>
    </section>
  );
}
