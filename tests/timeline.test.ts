import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  type Project,
  type Show,
  type ShowTransport,
} from "../src/model.ts";
import {
  cueAt,
  positionAt,
  resolveShowFrame,
  showDuration,
} from "../src/timeline.ts";

function rotation(loop = true): Project {
  const project = createProject();
  const surface = project.surfaces[0];
  project.show = {
    loop,
    scenes: Array.from({ length: 20 }, (_, index) => ({
      id: `scene-${index}`,
      name: `Video ${index + 1}`,
      surfaces: [{ ...surface, source: `media:video-${index}` }],
    })),
    cues: Array.from({ length: 20 }, (_, index) => ({
      id: `cue-${index}`,
      sceneId: `scene-${index}`,
      duration: 120,
    })),
  };
  project.transport = {
    active: true,
    playing: true,
    position: 0,
    updatedAt: 1_700_000_000_000,
    token: "run-1",
  };
  return project;
}

test("a 40-minute rotation selects every two-minute scene from the shared clock", () => {
  const project = rotation();
  const saved = project.surfaces[0].source;
  assert.equal(showDuration(project.show!), 2400);
  for (let index = 0; index < 20; index++) {
    for (const offset of [0, 0.125, 119.99]) {
      const frame = resolveShowFrame(
        project,
        project.transport!.updatedAt + (index * 120 + offset) * 1000,
      );
      assert.equal(frame.project.surfaces[0].source, `media:video-${index}`);
      assert.ok(Math.abs(frame.video!.position - offset) < 0.001);
      assert.equal(frame.video!.key, `run-1:cue-${index}:0`);
      assert.equal(frame.video!.playing, true);
    }
  }
  assert.equal(
    project.surfaces[0].source,
    saved,
    "rendering never changes the saved mapping",
  );
});

test("pause, resume, and seek keep a stable position instead of accumulating render deltas", () => {
  const transport: ShowTransport = {
    active: true,
    position: 33.5,
    updatedAt: 1000,
    token: "run",
    playing: true,
  };
  assert.equal(positionAt(transport, 6000), 38.5);
  const paused = {
    ...transport,
    position: 38.5,
    updatedAt: 6000,
    playing: false,
  };
  assert.equal(positionAt(paused, 1_000_000), 38.5);
  const resumed = { ...paused, updatedAt: 1_000_000, playing: true };
  assert.equal(positionAt(resumed, 1_002_500), 41);
  const sought = {
    ...resumed,
    position: 360,
    updatedAt: 1_002_500,
    token: "seek",
  };
  assert.equal(positionAt(sought, 1_003_000), 360.5);
  assert.equal(
    positionAt(sought, 1_000_000),
    360,
    "a backward wall-clock step cannot reverse playback",
  );
});

test("exact loop and cue boundaries select the next scene and restart repeated media", () => {
  const project = rotation();
  const show = project.show!;
  assert.equal(cueAt(show, 120)!.index, 1);
  assert.equal(cueAt(show, 2400)!.index, 0);
  assert.equal(cueAt(show, 2400)!.cycle, 1);
  assert.equal(cueAt(show, 2400)!.offset, 0);
  const firstKey = resolveShowFrame(project, project.transport!.updatedAt)
    .video!.key;
  const secondKey = resolveShowFrame(
    project,
    project.transport!.updatedAt + 2400_000,
  ).video!.key;
  assert.notEqual(firstKey, secondKey);
  show.cues[1].sceneId = show.cues[0].sceneId;
  const repeated = resolveShowFrame(
    project,
    project.transport!.updatedAt + 120_000,
  );
  assert.equal(repeated.project.surfaces[0].source, "media:video-0");
  assert.equal(repeated.video!.position, 0);
  assert.notEqual(
    repeated.video!.key,
    firstKey,
    "adjacent uses of the same MP4 still restart",
  );
  project.transport!.token = "jump";
  assert.notEqual(
    resolveShowFrame(project, project.transport!.updatedAt).video!.key,
    firstKey,
  );
});

test("a non-looping show holds the last scene and pauses on its final frame", () => {
  const project = rotation(false);
  const final = resolveShowFrame(
    project,
    project.transport!.updatedAt + 2400_000,
  );
  assert.equal(final.project.surfaces[0].source, "media:video-19");
  assert.equal(final.project.playing, false);
  assert.deepEqual(final.video, {
    key: "run-1:cue-19:0",
    position: 120,
    playing: false,
  });
  assert.deepEqual(
    resolveShowFrame(project, project.transport!.updatedAt + 86_400_000),
    final,
  );
});

test("long clock jumps resolve directly to the correct rotation without rendering intervening cues", () => {
  const project = rotation();
  const elapsed = 2400 * 5000 + 120 * 7 + 23.25;
  const frame = resolveShowFrame(
    project,
    project.transport!.updatedAt + elapsed * 1000,
  );
  assert.equal(frame.project.surfaces[0].source, "media:video-7");
  assert.equal(frame.video!.key, "run-1:cue-7:5000");
  assert.equal(frame.video!.position, 23.25);
});

test("saved scenes do not activate playback without an active session transport", () => {
  const project = rotation();
  delete project.transport;
  assert.equal(resolveShowFrame(project, 1_700_001_000_000).project, project);
  assert.equal(resolveShowFrame(project, 1_700_001_000_000).video, undefined);
  project.transport = {
    active: false,
    position: 200,
    updatedAt: 0,
    token: "stopped",
    playing: true,
  };
  assert.equal(positionAt(project.transport, 999_000), 200);
  assert.equal(resolveShowFrame(project, 999_000).project, project);
});

test("show rendering preserves project-wide output settings and freezes a paused scene", () => {
  const project = rotation();
  project.width = 3840;
  project.height = 2160;
  project.brightness = 0.35;
  project.blackout = true;
  project.media = [
    { id: "video-1", name: "Intro.mp4", kind: "video", url: "media://intro" },
  ];
  project.transport = { ...project.transport!, position: 130, playing: false };
  const frame = resolveShowFrame(
    project,
    project.transport.updatedAt + 3_600_000,
  );
  assert.equal(frame.video!.position, 10);
  assert.equal(frame.video!.playing, false);
  assert.equal(frame.project.width, 3840);
  assert.equal(frame.project.height, 2160);
  assert.equal(frame.project.brightness, 0.35);
  assert.equal(frame.project.blackout, true);
  assert.equal(frame.project.media, project.media);
});

test("empty and damaged timeline entries fail safely without an advancing output", () => {
  const show: Show = { scenes: [], cues: [], loop: true };
  assert.equal(showDuration(show), 0);
  assert.equal(cueAt(show, 100), null);
  show.cues = [
    { id: "bad", sceneId: "missing", duration: NaN },
    { id: "zero", sceneId: "missing", duration: 0 },
    { id: "good", sceneId: "missing", duration: 60 },
  ];
  assert.equal(showDuration(show), 60);
  assert.equal(cueAt(show, -3)!.offset, 0);
  assert.equal(cueAt(show, NaN)!.index, 2);
  const project = rotation();
  project.show = show;
  assert.equal(
    resolveShowFrame(project, project.transport!.updatedAt).project.playing,
    false,
  );
});
