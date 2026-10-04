import { useEffect, useState } from "react";
import type { Project, ShowTransport } from "./model";
import { newId } from "./compat";
import { positionAt, showDuration } from "./timeline";

/** One timestamped show clock shared by every renderer, not a timer per clip. */
export function useShowTransport(project: Project) {
  const [transport, setTransport] = useState<ShowTransport | null>(null);
  const [now, setNow] = useState(Date.now());
  const duration = showDuration(project.show);
  const anchor = (previous: ShowTransport, time: number) => {
    const value = positionAt(previous, time);
    return duration && project.show?.loop
      ? value % duration
      : Math.min(duration, value);
  };
  useEffect(() => {
    if (!transport?.active) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [transport?.active]);
  useEffect(() => {
    setTransport((previous) => {
      if (!previous?.active || previous.playing === project.playing)
        return previous;
      const time = Date.now();
      if (!project.show?.loop && positionAt(previous, time) >= duration)
        return previous;
      return {
        ...previous,
        position: anchor(previous, time),
        updatedAt: time,
        playing: project.playing,
        token: newId(),
      };
    });
  }, [project.playing]);
  const rawPosition = transport ? positionAt(transport, now) : 0;
  const position = duration
    ? project.show?.loop
      ? rawPosition % duration
      : Math.min(duration, rawPosition)
    : 0;
  const ended = Boolean(
    transport?.active && !project.show?.loop && rawPosition >= duration,
  );
  useEffect(() => {
    if (!ended) return;
    setTransport((previous) =>
      previous?.playing
        ? {
            ...previous,
            position: duration,
            updatedAt: Date.now(),
            playing: false,
          }
        : previous,
    );
  }, [ended, duration]);
  return {
    transport,
    position,
    ended,
    playing: Boolean(transport?.active && transport.playing && !ended),
    play() {
      const time = Date.now();
      setNow(time);
      setTransport((previous) => ({
        active: true,
        position:
          previous &&
          !(
            duration &&
            !project.show?.loop &&
            positionAt(previous, time) >= duration
          )
            ? anchor(previous, time)
            : 0,
        updatedAt: time,
        token: newId(),
        playing: true,
      }));
    },
    pause() {
      const time = Date.now();
      setNow(time);
      setTransport(
        (previous) =>
          previous && {
            ...previous,
            position: anchor(previous, time),
            updatedAt: time,
            playing: false,
            token: newId(),
          },
      );
    },
    seek(value: number) {
      const time = Date.now();
      setNow(time);
      setTransport((previous) => ({
        active: true,
        position: Math.max(0, Math.min(duration, value)),
        updatedAt: time,
        token: newId(),
        playing: previous?.playing ?? false,
      }));
    },
    stop() {
      setTransport(null);
      setNow(Date.now());
    },
  };
}
