import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createProject, PATTERNS } from "../src/model.ts";
import { validateBrowserProject } from "../src/project-validation.ts";
import { createShapeSurface } from "../src/polygon.ts";
const { validateProject: validateNativeProject } = createRequire(
  import.meta.url,
)("../electron/project.cjs");
test("browser validation rejects incomplete surfaces and malformed drafts before render", () => {
  const p = createProject();
  assert.equal(validateBrowserProject(p).surfaces.length, 1);
  for (const invalid of [
    { ...p, media: undefined },
    { ...p, width: NaN },
    { ...p, name: {} },
    { ...p, surfaces: [{ corners: p.surfaces[0].corners, visible: true }] },
    { ...p, surfaces: [{ ...p.surfaces[0], corners: undefined }] },
  ])
    assert.throws(() => validateBrowserProject(invalid));
});
test("browser project validation removes executable media URLs and unknown properties", () => {
  const p = createProject();
  const media = {
    id: "image1",
    name: "photo",
    kind: "image",
    url: "https://example.com/not-loaded.png",
  };
  const result = validateBrowserProject({
    ...p,
    media: [media],
    extra: "ignored",
  });
  assert.equal(result.media[0].url, "");
  assert.equal("extra" in result, false);
});

test("animation settings round-trip and old projects remain compatible", () => {
  const old = createProject();
  old.version = 1;
  assert.equal(validateBrowserProject(old).version, 2);
  assert.equal(validateBrowserProject(old).surfaces[0].speed, undefined);
  const p = createProject();
  p.surfaces[0] = { ...p.surfaces[0], source: "galaxy", speed: 0.5, detail: 2 };
  const result = validateBrowserProject(p);
  assert.equal(result.surfaces[0].source, "galaxy");
  assert.equal(result.surfaces[0].speed, 0.5);
  assert.equal(result.surfaces[0].detail, 2);
  for (const patch of [
    { speed: -1 },
    { speed: 4 },
    { speed: NaN },
    { detail: 0 },
    { detail: 4 },
  ])
    assert.throws(() =>
      validateBrowserProject({
        ...p,
        surfaces: [{ ...p.surfaces[0], ...patch }],
      }),
    );
});

test("version 1 projects migrate to version 2 with every original animation and perspective mapping preserved", () => {
  for (const source of PATTERNS) {
    const old = createProject();
    old.version = 1;
    old.surfaces[0].source = source;
    old.surfaces[0].corners = [
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.2 },
      { x: 0.95, y: 0.9 },
      { x: 0.05, y: 0.8 },
    ];
    const clean = validateBrowserProject(old);
    assert.deepEqual(clean, { ...old, version: 2 });
    assert.deepEqual(validateNativeProject(old), clean);
  }
  for (const version of [0, 4, 999, "2", null, undefined]) {
    assert.throws(() =>
      validateBrowserProject({ ...createProject(), version }),
    );
    assert.throws(() => validateNativeProject({ ...createProject(), version }));
  }
});

test("advanced outlines, mask layers, blend modes and content transforms survive both validation boundaries", () => {
  const project = createProject();
  project.surfaces = [
    createShapeSurface("triangle", 0),
    createShapeSurface("circle", 1),
    createShapeSurface("polygon", 2),
  ];
  project.surfaces[0] = {
    ...project.surfaces[0],
    blendMode: "add",
    edgeWidth: 30,
    feather: 8,
    content: { rotation: 45, scale: 1.7, offsetX: -0.1, offsetY: 0.3 },
  };
  project.surfaces[1] = {
    ...project.surfaces[1],
    kind: "mask",
    blendMode: "normal",
    edgeWidth: 1,
    feather: 0,
  };
  project.surfaces[2] = {
    ...project.surfaces[2],
    kind: "surface",
    blendMode: "screen",
    edgeWidth: 80,
    feather: 80,
    content: { rotation: -180, scale: 0.1, offsetX: -1, offsetY: 1 },
  };
  assert.deepEqual(
    validateBrowserProject(JSON.parse(JSON.stringify(project))),
    project,
  );
  assert.deepEqual(
    validateNativeProject(JSON.parse(JSON.stringify(project))),
    project,
  );
  // Unknown keys are stripped even inside deeply nested geometry and transforms.
  const input = structuredClone(project) as any;
  input.surfaces[0].polygon[0].script = "ignored";
  input.surfaces[0].content.script = "ignored";
  input.surfaces[0].script = "ignored";
  assert.deepEqual(validateBrowserProject(input), project);
  assert.deepEqual(validateNativeProject(input), project);
});

test("browser and native validators reject malformed advanced attributes and mismatched content bounds", () => {
  const project = createProject();
  project.surfaces = [createShapeSurface("polygon", 0)];
  const patches = [
    { polygon: null },
    { polygon: "outline" },
    { polygon: [] },
    {
      polygon: [
        { x: 0.1, y: 0.1 },
        { x: 0.8, y: 0.8 },
        { x: 0.8, y: 0.1 },
        { x: 0.1, y: 0.8 },
      ],
    },
    { polygon: [{ x: NaN, y: 0.1 }, ...project.surfaces[0].polygon!.slice(1)] },
    { polygon: [{ x: 2, y: 0.1 }, ...project.surfaces[0].polygon!.slice(1)] },
    {
      polygon: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.5, y: 0.2 },
        { x: 0.2, y: 0.8 },
      ],
    },
    {
      polygon: [
        ...project.surfaces[0].polygon!,
        project.surfaces[0].polygon![0],
      ],
    },
    { corners: createProject().surfaces[0].corners },
    { kind: "group" },
    { kind: null },
    { blendMode: "multiply" },
    { blendMode: 0 },
    { edgeWidth: 0 },
    { edgeWidth: 81 },
    { edgeWidth: "2" },
    { feather: -1 },
    { feather: 81 },
    { feather: NaN },
    { content: null },
    { content: [] },
    { content: {} },
    ...[
      { rotation: -181 },
      { rotation: 181 },
      { rotation: NaN },
      { scale: 0 },
      { scale: 4.1 },
      { scale: Infinity },
      { offsetX: -1.1 },
      { offsetY: 1.1 },
      { offsetY: "0" },
    ].map((patch) => ({
      content: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0, ...patch },
    })),
  ];
  for (const patch of patches) {
    const input = {
      ...project,
      surfaces: [{ ...project.surfaces[0], ...patch }],
    };
    assert.throws(() => validateBrowserProject(input), JSON.stringify(patch));
    assert.throws(() => validateNativeProject(input), JSON.stringify(patch));
  }
});

test("audio responses survive browser/native validation without storing capture permissions or devices", () => {
  const project = createProject();
  for (const band of ["level", "bass", "mid", "treble", "beat"] as const) {
    for (const mode of ["brightness", "zoom", "both"] as const) {
      for (const amount of [0, 0.65, 1]) {
        project.surfaces[0].audio = { enabled: true, band, amount, mode };
        const input = structuredClone(project) as any;
        input.audioDeviceId = "private-device-id";
        input.surfaces[0].audio.source = "microphone";
        input.surfaces[0].audio.capture = true;
        assert.deepEqual(validateBrowserProject(input), project);
        assert.deepEqual(validateNativeProject(input), project);
      }
    }
  }
  const old = createProject();
  assert.equal(validateBrowserProject(old).surfaces[0].audio, undefined);
  assert.equal(validateNativeProject(old).surfaces[0].audio, undefined);
});

test("both project boundaries reject malformed audio response settings", () => {
  const project = createProject();
  const valid = { enabled: false, band: "bass", amount: 0.5, mode: "both" };
  const invalid = [
    null,
    [],
    "enabled",
    {},
    ...[
      { enabled: "true" },
      { enabled: 1 },
      { band: "subsonic" },
      { band: null },
      { amount: -0.1 },
      { amount: 1.1 },
      { amount: NaN },
      { amount: Infinity },
      { amount: "0.5" },
      { mode: "strobe" },
      { mode: 1 },
    ].map((patch) => ({ ...valid, ...patch })),
  ];
  for (const audio of invalid) {
    const input = { ...project, surfaces: [{ ...project.surfaces[0], audio }] };
    assert.throws(() => validateBrowserProject(input), JSON.stringify(audio));
    assert.throws(() => validateNativeProject(input), JSON.stringify(audio));
  }
});

test("a browser draft that still lists imported media keeps every entry and stays valid across reloads", () => {
  const project = createProject();
  const media = [
    { id: "image1", name: "wall.png", kind: "image" as const, url: "" },
    { id: "video2", name: "loop.mp4", kind: "video" as const, url: "" },
  ];
  project.media = media;
  project.surfaces[0] = { ...project.surfaces[0], source: "image1" };
  // What the autosave writes and the next launch reads: entries without live URLs.
  const reloaded = validateBrowserProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(reloaded.media, media);
  assert.equal(reloaded.surfaces[0].source, "image1");
  // A blob: URL from the previous page is meaningless after a reload and is never trusted.
  const stale = validateBrowserProject({
    ...project,
    media: [{ ...media[0], url: "blob:https://app.example/0a1b" }, media[1]],
  });
  assert.equal(stale.media[0].url, "");
  // A layer that points at media the draft no longer lists invalidates the whole draft.
  assert.throws(() =>
    validateBrowserProject({ ...project, media: [media[1]] }),
  );
  // Entry problems that would silently discard the draft are caught here, not on the next launch.
  // These layers use built-in animations, so only the bad entry itself can be the reason.
  const plain = createProject();
  assert.deepEqual(
    validateBrowserProject({ ...plain, media: [media[0], media[1]] }).media,
    media,
  );
  for (const bad of [
    { ...media[0], id: "" },
    { ...media[0], kind: "audio" },
    { ...media[0], id: PATTERNS[0] },
    { ...media[0], name: "x".repeat(201) },
    { ...media[0], name: "bell\u0007here" },
  ])
    assert.throws(
      () => validateBrowserProject({ ...plain, media: [bad, media[1]] }),
      JSON.stringify(bad),
    );
  assert.throws(() =>
    validateBrowserProject({ ...plain, media: [media[0], media[0]] }),
  );
});
