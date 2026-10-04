import type { Project, Show, ShowCue, ShowTransport } from "./model";

export interface CueFrame {
  cue: ShowCue;
  index: number;
  /** Start of this cue within one rotation, in seconds. */
  start: number;
  /** Elapsed seconds within the cue, including its held end frame. */
  offset: number;
  cycle: number;
  ended: boolean;
}

export interface TimelineVideoFrame {
  /** A new cue, rotation, or explicit jump restarts the video. */
  key: string;
  position: number;
  playing: boolean;
}

export interface ShowFrame {
  project: Project;
  video?: TimelineVideoFrame;
}

const durationOf = (cue: ShowCue): number =>
  Number.isFinite(cue.duration) && cue.duration > 0 ? cue.duration : 0;

/** The saved timeline length, independent of transport and media loading. */
export function showDuration(show?: Show): number {
  return show?.cues.reduce((total, cue) => total + durationOf(cue), 0) ?? 0;
}

/** Resolve an unwrapped show position; an exact boundary belongs to the next cue. */
export function cueAt(show: Show, position: number): CueFrame | null {
  const total = showDuration(show);
  if (total <= 0 || !Number.isFinite(total)) return null;
  const elapsed = Number.isFinite(position) ? Math.max(0, position) : 0;
  const cycle = show.loop ? Math.floor(elapsed / total) : 0;
  const ended = !show.loop && elapsed >= total;
  const within = show.loop ? elapsed % total : Math.min(elapsed, total);
  let start = 0;
  let last: CueFrame | null = null;
  for (let index = 0; index < show.cues.length; index++) {
    const cue = show.cues[index];
    const duration = durationOf(cue);
    if (duration <= 0) continue;
    const frame = {
      cue,
      index,
      start,
      offset: Math.max(0, Math.min(duration, within - start)),
      cycle,
      ended,
    };
    if (within < start + duration) return frame;
    last = frame;
    start += duration;
  }
  return last;
}

/** Both preview and output derive playback from this shared epoch clock. */
export function positionAt(transport: ShowTransport, now: number): number {
  const position = Number.isFinite(transport.position)
    ? Math.max(0, transport.position)
    : 0;
  if (
    !transport.active ||
    !transport.playing ||
    !Number.isFinite(now) ||
    !Number.isFinite(transport.updatedAt)
  )
    return position;
  return position + Math.max(0, now - transport.updatedAt) / 1000;
}

/** Resolve scenes on every render, even when the editor's controls are throttled. */
export function resolveShowFrame(project: Project, now: number): ShowFrame {
  const transport = project.transport;
  if (!transport?.active) return { project };
  const show = project.show;
  const frame = show ? cueAt(show, positionAt(transport, now)) : null;
  const scene =
    frame && show?.scenes.find((scene) => scene.id === frame.cue.sceneId);
  if (!frame || !scene) return { project: { ...project, playing: false } };
  const playing = transport.playing && !frame.ended;
  return {
    project: { ...project, surfaces: scene.surfaces, playing },
    video: {
      key: `${transport.token}:${frame.cue.id}:${frame.cycle}`,
      position: frame.offset,
      playing,
    },
  };
}
