import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  createProject,
  type Project,
  type ShowTransport,
} from "../src/model.ts";
import {
  portableProject,
  projectFromFile,
  validateBrowserProject,
} from "../src/project-validation.ts";
import { createShapeSurface } from "../src/polygon.ts";
import { readDraft, serializeDraft, writeDraft } from "../src/persistence.ts";

const { validateProject, parseProject, serializeProject } = createRequire(
  import.meta.url,
)("../electron/project.cjs");

function fixture(): Project {
  const project = createProject();
  project.version = 3;
  const surface = createShapeSurface("polygon", 0);
  surface.source = "clip-1";
  surface.audio = { enabled: true, band: "beat", amount: 0.4, mode: "both" };
  surface.content = { rotation: 35, scale: 1.2, offsetX: -0.3, offsetY: 0.2 };
  const mask = {
    ...structuredClone(surface),
    id: "mask-1",
    kind: "mask" as const,
  };
  project.media = [
    {
      id: "clip-1",
      name: "Intro.mp4",
      kind: "video",
      url: "",
      path: "Intro.mp4",
    },
  ];
  project.show = {
    scenes: [
      { id: "intro", name: "Band intro", surfaces: [surface, mask] },
      // The same mapping IDs can occur in different snapshots.
      { id: "set-1", name: "Set 1", surfaces: [structuredClone(surface)] },
    ],
    cues: [
      { id: "cue-1", sceneId: "intro", duration: 120 },
      { id: "cue-2", sceneId: "set-1", duration: 180 },
      { id: "cue-3", sceneId: "intro", duration: 120 },
    ],
    loop: true,
  };
  return project;
}

const session: ShowTransport = {
  active: true,
  position: 240.5,
  updatedAt: 1234567890,
  token: "playback-session",
  playing: true,
};

function rejectsBoth(input: unknown) {
  assert.throws(() => validateBrowserProject(input));
  assert.throws(() => validateProject(input));
}

test("version 3 snapshots, shared media, ordered cues and advanced mappings match both validators", () => {
  const project = fixture();
  assert.deepEqual(validateBrowserProject(project), project);
  assert.deepEqual(validateProject(project), project);
  const input = structuredClone(project) as any;
  input.show.script = "ignored";
  input.show.scenes[0].script = "ignored";
  input.show.scenes[0].surfaces[0].audio.deviceId = "private";
  input.show.scenes[0].surfaces[0].polygon[0].script = "ignored";
  input.show.cues[0].script = "ignored";
  assert.deepEqual(validateBrowserProject(input), project);
  assert.deepEqual(validateProject(input), project);

  const empty: Project = {
    ...createProject(),
    version: 3,
    show: { scenes: [], cues: [], loop: false },
  };
  assert.deepEqual(validateBrowserProject(empty), empty);
  assert.deepEqual(validateProject(empty), empty);
  const noShow = { ...createProject(), version: 3 };
  assert.deepEqual(validateBrowserProject(noShow), noShow);
  assert.deepEqual(validateProject(noShow), noShow);
  for (const version of [1, 2]) rejectsBoth({ ...project, version });
  assert.equal(createProject().version, 2);
});

test("both boundaries reject malformed scenes, cues and incomplete snapshots", () => {
  const changes: Array<(project: any) => void> = [
    (p) => {
      p.show = null;
    },
    (p) => {
      p.show.scenes = {};
    },
    (p) => {
      p.show.cues = null;
    },
    (p) => {
      p.show.loop = "true";
    },
    (p) => {
      p.show.scenes[0].id = "";
    },
    (p) => {
      p.show.scenes[0].id = "bad/id";
    },
    (p) => {
      p.show.scenes.push(p.show.scenes[0]);
    },
    (p) => {
      p.show.scenes[0].name = "x".repeat(201);
    },
    (p) => {
      p.show.scenes[0].name = "bad\u0007name";
    },
    (p) => {
      p.show.scenes[0].surfaces = null;
    },
    (p) => {
      p.show.scenes[0].surfaces[0].corners = [];
    },
    (p) => {
      p.show.scenes[0].surfaces[0].source = "missing-media";
    },
    (p) => {
      p.show.scenes[0].surfaces[0].visible = 1;
    },
    (p) => {
      p.show.scenes[0].surfaces[0].opacity = -0.1;
    },
    (p) => {
      p.show.scenes[0].surfaces[0].content.scale = NaN;
    },
    (p) => {
      p.show.scenes[0].surfaces.push(p.show.scenes[0].surfaces[0]);
    },
    (p) => {
      p.show.cues[0].id = "";
    },
    (p) => {
      p.show.cues.push(p.show.cues[0]);
    },
    (p) => {
      p.show.cues[0].sceneId = "unknown-scene";
    },
    (p) => {
      p.show.cues[0].duration = 0;
    },
    (p) => {
      p.show.cues[0].duration = 0.099;
    },
    (p) => {
      p.show.cues[0].duration = 7200.01;
    },
    (p) => {
      p.show.cues[0].duration = Infinity;
    },
    (p) => {
      p.show.cues[0].duration = "120";
    },
  ];
  for (const change of changes) {
    const input = structuredClone(fixture());
    change(input);
    rejectsBoth(input);
  }
});

test("scene, surface, cue and show duration limits accept their boundary and reject overflow", () => {
  const project = fixture();
  const scene = project.show!.scenes[0];
  scene.surfaces = Array.from({ length: 32 }, (_, index) => ({
    ...structuredClone(scene.surfaces[0]),
    id: `surface-${index}`,
  }));
  project.show!.scenes = Array.from({ length: 128 }, (_, index) => ({
    ...structuredClone(scene),
    id: `scene-${index}`,
  }));
  project.show!.cues = Array.from({ length: 512 }, (_, index) => ({
    id: `cue-${index}`,
    sceneId: "scene-0",
    duration: 0.1,
  }));
  assert.deepEqual(validateBrowserProject(project), project);
  assert.deepEqual(validateProject(project), project);

  const tooManyScenes = structuredClone(project);
  tooManyScenes.show!.scenes.push({ ...scene, id: "overflow" });
  rejectsBoth(tooManyScenes);
  const tooManySurfaces = structuredClone(project);
  tooManySurfaces.show!.scenes[0].surfaces.push({
    ...scene.surfaces[0],
    id: "overflow",
  });
  rejectsBoth(tooManySurfaces);
  const tooManyCues = structuredClone(project);
  tooManyCues.show!.cues.push({
    id: "overflow",
    sceneId: "scene-0",
    duration: 0.1,
  });
  rejectsBoth(tooManyCues);

  project.show!.cues = Array.from({ length: 12 }, (_, index) => ({
    id: `long-${index}`,
    sceneId: "scene-0",
    duration: 7200,
  }));
  assert.deepEqual(validateBrowserProject(project), project);
  assert.deepEqual(validateProject(project), project);
  project.show!.cues.push({
    id: "overflow",
    sceneId: "scene-0",
    duration: 0.1,
  });
  rejectsBoth(project);
});

test("show playback session is preserved only by explicit native runtime validation", () => {
  const project = fixture();
  const runtime = { ...project, transport: { ...session, script: "ignored" } };
  assert.deepEqual(validateProject(runtime, undefined, { runtime: true }), {
    ...project,
    transport: session,
  });
  assert.deepEqual(validateBrowserProject(runtime), project);
  assert.deepEqual(validateProject(runtime), project);
  assert.deepEqual(parseProject(JSON.stringify(runtime)), project);
  const portable = portableProject(runtime);
  assert.equal("transport" in portable, false);
  assert.deepEqual(portable, project);
  assert.deepEqual(projectFromFile(runtime), { ...project, blackout: true });
  const saved = serializeProject(
    {
      ...runtime,
      media: project.media.map((media) => ({
        ...media,
        path: `/shows/${media.path}`,
      })),
    },
    "/shows/show.prism.json",
  );
  assert.equal(JSON.parse(saved).transport, undefined);
  assert.deepEqual(parseProject(saved), project);
  assert.deepEqual(runtime.transport, { ...session, script: "ignored" });
});

test("autosaved show drafts retain scenes and cues without playback session state", () => {
  const project = fixture();
  const runtime = { ...project, transport: session };
  assert.deepEqual(JSON.parse(serializeDraft(runtime)), project);
  let stored = JSON.stringify(runtime);
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
    removeItem: () => {
      stored = "";
    },
  };
  assert.deepEqual(readDraft(storage), { kind: "ok", project });
  assert.deepEqual(writeDraft(runtime, { keepMedia: true }, storage), {
    ok: true,
  });
  assert.deepEqual(JSON.parse(stored), project);
  assert.deepEqual(runtime.transport, session);
});

test("runtime transport accepts safe boundaries and rejects malformed session state", () => {
  const project = fixture();
  for (const transport of [
    { ...session, position: 0, updatedAt: 0 },
    {
      ...session,
      position: 86400,
      updatedAt: Number.MAX_SAFE_INTEGER,
      active: false,
      playing: false,
    },
  ]) {
    assert.deepEqual(
      validateProject({ ...project, transport }, undefined, { runtime: true })
        .transport,
      transport,
    );
  }
  for (const transport of [
    null,
    [],
    {},
    ...[
      { active: 1 },
      { playing: "true" },
      { position: -0.01 },
      { position: 86400.01 },
      { position: NaN },
      { position: "120" },
      { updatedAt: -1 },
      { updatedAt: Number.MAX_SAFE_INTEGER + 1 },
      { updatedAt: Infinity },
      { token: "" },
      { token: "bad/token" },
    ].map((patch) => ({ ...session, ...patch })),
  ]) {
    assert.throws(() =>
      validateProject({ ...project, transport }, undefined, { runtime: true }),
    );
    // Session fields in project files are discarded, even if stale or malformed.
    assert.deepEqual(
      validateBrowserProject({ ...project, transport }),
      project,
    );
    assert.deepEqual(validateProject({ ...project, transport }), project);
  }
});
