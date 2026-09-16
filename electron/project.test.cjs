const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateProject,
  parseProject,
  serializeProject,
  mediaKind,
} = require("./project.cjs");

function fixture() {
  return {
    version: 1,
    name: "Test mapping",
    width: 1920,
    height: 1080,
    surfaces: [
      {
        id: "surface-1",
        name: "Wall",
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        source: "grid",
        visible: true,
        locked: false,
        opacity: 1,
        color: "#ffffff",
      },
    ],
    media: [],
    brightness: 0.65,
    blackout: false,
    playing: true,
  };
}

test("round trips the versioned schema and strips unknown fields", () => {
  const project = fixture();
  project.script = "<script>alert(1)</script>";
  const validated = validateProject(project);
  assert.equal(validated.script, undefined);
  assert.deepEqual(
    parseProject(serializeProject(validated, "/Users/artist/show.prism.json")),
    { ...fixture(), version: 2 },
  );
});

test("project files cannot supply executable or remote media URLs", () => {
  const project = fixture();
  project.media = [
    {
      id: "media-1",
      name: "Clip",
      kind: "video",
      url: "javascript:alert(1)",
      path: "clip.mp4",
    },
  ];
  project.surfaces[0].source = "media-1";
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.media[0].url, "");
  assert.equal(parsed.media[0].path, "clip.mp4");
  project.media[0].url = "https://attacker.invalid/collect";
  assert.equal(parseProject(JSON.stringify(project)).media[0].url, "");
});

test("rejects malformed dimensions, corners, sources, colors, and booleans", () => {
  const changes = [
    (p) => {
      p.width = Infinity;
    },
    (p) => {
      p.height = 0;
    },
    (p) => {
      p.width = 10.5;
    },
    (p) => {
      p.surfaces[0].corners.pop();
    },
    (p) => {
      p.surfaces[0].corners[0].x = NaN;
    },
    (p) => {
      p.surfaces[0].source = "not-imported";
    },
    (p) => {
      p.surfaces[0].color = "url(evil)";
    },
    (p) => {
      p.blackout = "false";
    },
    (p) => {
      p.version = 3;
    },
  ];
  for (const change of changes) {
    const project = fixture();
    change(project);
    assert.throws(() => validateProject(project), /Invalid project/);
  }
});

test("rejects duplicated identities and oversized input", () => {
  const project = fixture();
  project.surfaces.push({ ...project.surfaces[0] });
  assert.throws(() => validateProject(project), /duplicate surface/);
  assert.throws(
    () => parseProject(" ".repeat(5 * 1024 * 1024 + 1)),
    /larger than 5 MB/,
  );
  assert.throws(() => parseProject("{"), /valid JSON/);
});

test("rejects crossed, concave, degenerate, tiny, or out-of-frame quads and more than 32 surfaces", () => {
  const invalidQuads = [
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.1, y: 0.1 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 0.001, y: 0 },
      { x: 0.001, y: 0.001 },
      { x: 0, y: 0.001 },
    ],
    [
      { x: -0.1, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  ];
  for (const corners of invalidQuads) {
    const project = fixture();
    project.surfaces[0].corners = corners;
    assert.throws(() => validateProject(project), /Invalid project/);
  }
  const project = fixture();
  project.surfaces = Array.from({ length: 33 }, (_, index) => ({
    ...project.surfaces[0],
    id: `surface-${index}`,
  }));
  assert.throws(() => validateProject(project), /at most 32/);
});

test("stores media relative to the project and omits session URL tokens", () => {
  const project = fixture();
  project.media = [
    {
      id: "media-1",
      name: "Clip",
      kind: "video",
      url: "media://local/token",
      path: "/Users/artist/assets/clip.mp4",
    },
  ];
  project.surfaces[0].source = "media-1";
  const serialized = JSON.parse(
    serializeProject(project, "/Users/artist/shows/show.prism.json"),
  );
  assert.equal(serialized.media[0].path, "../assets/clip.mp4");
  assert.equal(serialized.media[0].url, undefined);
});

test("refuses active formats and accepts supported image/video extensions", () => {
  assert.equal(mediaKind("/tmp/scene.SVG"), null);
  assert.equal(mediaKind("/tmp/scene.html"), null);
  assert.equal(mediaKind("/tmp/scene.PNG"), "image");
  assert.equal(mediaKind("/tmp/movie.MP4"), "video");
});

test("all animation IDs and motion settings survive native Save/Open schema", () => {
  const catalog = require("../shared/patterns.json");
  for (const pattern of catalog) {
    const p = fixture();
    p.surfaces[0] = {
      ...p.surfaces[0],
      source: pattern.id,
      speed: 0.5,
      detail: 1.75,
    };
    const saved = parseProject(
      serializeProject(p, "/tmp/animation.prism.json"),
    );
    assert.equal(saved.surfaces[0].source, pattern.id);
    assert.equal(saved.surfaces[0].speed, 0.5);
    assert.equal(saved.surfaces[0].detail, 1.75);
  }
  for (const patch of [
    { speed: -0.5 },
    { speed: 4 },
    { speed: NaN },
    { detail: 0 },
    { detail: 3.5 },
  ]) {
    const p = fixture();
    Object.assign(p.surfaces[0], patch);
    assert.throws(() => validateProject(p));
  }
});

test("native saves upgrade legacy projects and retain ordered advanced surface and mask layers", () => {
  const p = fixture();
  const polygon = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 0.4 },
    { x: 0.4, y: 0.4 },
    { x: 0.4, y: 1 },
    { x: 0, y: 1 },
  ];
  p.surfaces[0] = {
    ...p.surfaces[0],
    polygon,
    kind: "surface",
    blendMode: "screen",
    edgeWidth: 20,
    feather: 12,
    content: { rotation: 90, scale: 2, offsetX: -0.5, offsetY: 0.5 },
  };
  p.surfaces.push({
    ...p.surfaces[0],
    id: "mask-1",
    name: "Window mask",
    kind: "mask",
    blendMode: "normal",
    opacity: 0.9,
  });
  const serialized = JSON.parse(
    serializeProject(p, "/tmp/advanced.prism.json"),
  );
  assert.equal(serialized.version, 2);
  assert.deepEqual(parseProject(JSON.stringify(serialized)), {
    ...p,
    version: 2,
  });
  const reversed = {
    ...p,
    surfaces: [{ ...p.surfaces[0], polygon: [...polygon].reverse() }],
  };
  assert.deepEqual(
    validateProject(reversed).surfaces[0].polygon,
    [...polygon].reverse(),
  );
});

test("native validation refuses malformed outline and advanced settings before saving", () => {
  const patches = [
    { polygon: [] },
    { polygon: null },
    {
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
    },
    {
      polygon: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.5, y: 0.9 },
      ],
    },
    { kind: "unknown" },
    { blendMode: "unknown" },
    { edgeWidth: 0 },
    { edgeWidth: 81 },
    { feather: -1 },
    { feather: 81 },
    { content: null },
    { content: {} },
    { content: { rotation: 360, scale: 1, offsetX: 0, offsetY: 0 } },
  ];
  for (const patch of patches) {
    const p = fixture();
    Object.assign(p.surfaces[0], patch);
    assert.throws(
      () => serializeProject(p, "/tmp/advanced.prism.json"),
      /Invalid project/,
    );
  }
});

test("portable project audio responses round-trip while capture state stays out of the file", () => {
  const project = fixture();
  project.surfaces[0].audio = {
    enabled: true,
    band: "beat",
    amount: 1,
    mode: "both",
    deviceId: "never-save",
  };
  project.audioCapture = { active: true, deviceId: "never-save" };
  const parsed = parseProject(
    serializeProject(project, "/Users/artist/show.prism.json"),
  );
  assert.deepEqual(parsed.surfaces[0].audio, {
    enabled: true,
    band: "beat",
    amount: 1,
    mode: "both",
  });
  assert.equal(parsed.audioCapture, undefined);
  assert.equal(parsed.version, 2);
});
