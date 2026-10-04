import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { ProjectionRenderer } from "../src/renderer.ts";
import { createProject } from "../src/model.ts";

class VideoDouble {
  duration = 120;
  readyState = 2;
  videoWidth = 1920;
  videoHeight = 1080;
  paused = true;
  seeking = false;
  loop = true;
  muted = false;
  src = "";
  plays = 0;
  pauses = 0;
  loads = 0;
  seeks: number[] = [];
  onloadeddata: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private time = 0;
  get currentTime() {
    return this.time;
  }
  set currentTime(time: number) {
    this.time = time;
    this.seeking = true;
    this.seeks.push(time);
  }
  advanceTo(time: number) {
    this.time = time;
    this.seeking = false;
  }
  finishSeek() {
    this.seeking = false;
    this.onseeked?.();
  }
  play() {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.pauses++;
    this.paused = true;
  }
  load() {
    this.loads++;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

const oldGlobals = new Map<string, PropertyDescriptor | undefined>();
before(() => {
  for (const [name, value] of Object.entries({
    HTMLVideoElement: VideoDouble,
    HTMLMediaElement: { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 },
    document: { createElement: () => new VideoDouble() },
  })) {
    oldGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
});
after(() => {
  for (const [name, descriptor] of oldGlobals)
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as any)[name];
});

// Exercise the renderer's actual media lifecycle with deterministic decoder/GPU
// doubles. Real MP4 decoding and output-window synchronization are browser tests.
function rendererDouble() {
  let uploads = 0;
  let deletions = 0;
  const renderer: any = Object.create(ProjectionRenderer.prototype);
  Object.assign(renderer, {
    gl: {
      createTexture: () => ({}),
      bindTexture: () => {},
      texParameteri: () => {},
      pixelStorei: () => {},
      texImage2D: () => uploads++,
      getParameter: () => 8192,
      getError: () => 0,
      NO_ERROR: 0,
      deleteTexture: () => deletions++,
      viewport: () => {},
      clear: () => {},
    },
    assets: new Map(),
    geometries: new Map(),
    surfaceClocks: new Map(),
    canvas: { width: 0, height: 0 },
    animationTime: 0,
    previousTime: null,
    program: {},
    destroyed: false,
    contextLost: false,
    audioFrame: { active: false },
    report: (message: string) => {
      throw new Error(message);
    },
  });
  const asset = renderer.getAsset({
    id: "mp4",
    name: "Clip.mp4",
    kind: "video",
    url: "media://clip",
  });
  return {
    renderer,
    asset,
    video: asset.element as VideoDouble,
    uploads: () => uploads,
    deletions: () => deletions,
  };
}

test("timeline MP4s mute, disable looping, seek on cue entry, and only correct material clock drift", () => {
  const { renderer, asset, video } = rendererDouble();
  renderer.prepareAsset(asset, true, {
    key: "cue-1",
    position: 10,
    playing: true,
  });
  assert.equal(video.muted, true);
  assert.equal(video.loop, false);
  assert.deepEqual(video.seeks, [10]);
  assert.equal(video.plays, 1);
  video.finishSeek();
  video.advanceTo(10.1);
  renderer.prepareAsset(asset, true, {
    key: "cue-1",
    position: 10.2,
    playing: true,
  });
  assert.deepEqual(
    video.seeks,
    [10],
    "normal decoder timing is not reset each frame",
  );
  renderer.prepareAsset(asset, true, {
    key: "cue-1",
    position: 12,
    playing: true,
  });
  assert.deepEqual(
    video.seeks,
    [10, 12],
    "a delayed render catches up directly",
  );
  video.finishSeek();
  renderer.prepareAsset(asset, true, {
    key: "cue-2",
    position: 0,
    playing: true,
  });
  assert.deepEqual(
    video.seeks,
    [10, 12, 0],
    "the next cue restarts even when it uses the same MP4",
  );
});

test("pause and resume use the timeline position and paused seeks refresh the GPU frame", () => {
  const { renderer, asset, video, uploads } = rendererDouble();
  renderer.prepareAsset(asset, true, {
    key: "run",
    position: 0,
    playing: true,
  });
  video.finishSeek();
  video.advanceTo(4);
  renderer.prepareAsset(asset, false, {
    key: "paused",
    position: 9,
    playing: false,
  });
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 9);
  const beforeDecodedFrame = uploads();
  video.finishSeek();
  renderer.prepareAsset(asset, false, {
    key: "paused",
    position: 9,
    playing: false,
  });
  assert.equal(
    uploads(),
    beforeDecodedFrame + 1,
    "the frame arriving after a paused seek is uploaded",
  );
  renderer.prepareAsset(asset, true, {
    key: "paused",
    position: 9,
    playing: true,
  });
  assert.equal(video.paused, false);
  assert.equal(video.plays, 2);
  assert.deepEqual(video.seeks, [0, 9]);
});

test("a scene longer than its MP4 holds the video end frame without replaying it", () => {
  const { renderer, asset, video } = rendererDouble();
  video.duration = 2;
  renderer.prepareAsset(asset, true, {
    key: "long-cue",
    position: 0,
    playing: true,
  });
  video.finishSeek();
  renderer.prepareAsset(asset, true, {
    key: "long-cue",
    position: 10,
    playing: true,
  });
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 1.999);
  assert.equal(video.loop, false);
  video.finishSeek();
  renderer.prepareAsset(asset, true, {
    key: "long-cue",
    position: 119,
    playing: true,
  });
  assert.equal(video.plays, 1);
  assert.deepEqual(video.seeks, [0, 1.999]);
  renderer.prepareAsset(asset, true, {
    key: "next-cycle",
    position: 0,
    playing: true,
  });
  assert.equal(video.plays, 2);
  assert.equal(video.currentTime, 0);
});

test("an unloaded timeline video waits for metadata before playing or seeking", () => {
  const { renderer, asset, video } = rendererDouble();
  video.readyState = 0;
  video.duration = NaN;
  assert.equal(
    renderer.prepareAsset(asset, true, {
      key: "run",
      position: 15,
      playing: true,
    }),
    false,
  );
  assert.equal(video.plays, 0);
  assert.deepEqual(video.seeks, []);
  video.readyState = 2;
  video.duration = 120;
  renderer.prepareAsset(asset, true, {
    key: "run",
    position: 16,
    playing: true,
  });
  assert.equal(video.currentTime, 16);
  assert.equal(video.plays, 1);
});

test("ordinary media keeps independent looping and respects the project playback switch", () => {
  const { renderer, asset, video } = rendererDouble();
  renderer.prepareAsset(asset, false);
  assert.equal(video.plays, 0);
  renderer.prepareAsset(asset, true);
  assert.equal(video.loop, true);
  assert.equal(video.plays, 1);
  assert.deepEqual(video.seeks, []);
  renderer.prepareAsset(asset, false);
  assert.equal(video.paused, true);
});

test("leaving a video scene disposes its decoder and texture even if media remains in the project", () => {
  const { renderer, asset, video, deletions } = rendererDouble();
  renderer.prepareAsset(asset, true, {
    key: "run",
    position: 0,
    playing: true,
  });
  const project = createProject();
  project.media = [
    { id: "mp4", name: "Clip.mp4", kind: "video", url: "media://clip" },
  ];
  project.surfaces = [];
  renderer.render(project, 0, 0);
  assert.equal(asset.disposed, true);
  assert.equal(video.paused, true);
  assert.equal(video.src, "");
  assert.equal(video.onseeked, null);
  assert.equal(renderer.assets.size, 0);
  assert.equal(deletions(), 1);
});
