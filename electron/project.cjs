const path = require("node:path");

const PATTERNS = new Set(require("../shared/patterns.json").map((p) => p.id));
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".ogv"]);
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

function mediaKind(filename, pathApi = path) {
  const extension = pathApi.extname(filename).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

function fail(message) {
  throw new Error(`Invalid project: ${message}`);
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  return value;
}
function string(value, label, maximum = 200) {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail(`${label} must be text up to ${maximum} characters`);
  return value;
}
function id(value, label) {
  const result = string(value, label, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(result))
    fail(`${label} has unsupported characters`);
  return result;
}
function number(value, label, minimum, maximum) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    fail(`${label} must be between ${minimum} and ${maximum}`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be true or false`);
  return value;
}
function choice(value, label, options) {
  if (!options.includes(value)) fail(`unsupported ${label}`);
  return value;
}

// Keep the native boundary equivalent to src/polygon.ts; parity is tested in both runtimes.
function polygonBounds(points) {
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y));
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}
function validatePolygon(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64)
    fail("an outline needs between 3 and 64 points");
  const points = value.map((point) => {
    record(point, "outline point");
    return {
      x: number(point.x, "outline x", 0, 1),
      y: number(point.y, "outline y", 0, 1),
    };
  });
  const epsilon = 1e-9;
  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (p, a, b) =>
    Math.abs(cross(a, b, p)) <= epsilon &&
    p.x >= Math.min(a.x, b.x) - epsilon &&
    p.x <= Math.max(a.x, b.x) + epsilon &&
    p.y >= Math.min(a.y, b.y) - epsilon &&
    p.y <= Math.max(a.y, b.y) + epsilon;
  function intersects(a, b, c, d) {
    const abC = cross(a, b, c),
      abD = cross(a, b, d),
      cdA = cross(c, d, a),
      cdB = cross(c, d, b);
    if (
      ((abC > epsilon && abD < -epsilon) ||
        (abC < -epsilon && abD > epsilon)) &&
      ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
    )
      return true;
    return (
      onSegment(c, a, b) ||
      onSegment(d, a, b) ||
      onSegment(a, c, d) ||
      onSegment(b, c, d)
    );
  }
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      c = points[(i + 2) % points.length];
    twiceArea += a.x * b.y - b.x * a.y;
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(a.x - points[j].x, a.y - points[j].y) < 1e-5)
        fail("outline points must be separated");
    }
    if (
      Math.abs(cross(a, b, c)) <= epsilon &&
      (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0
    )
      fail("outline edges cannot fold back");
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length]))
        fail("outline edges cannot cross or touch");
    }
  }
  if (Math.abs(twiceArea) < 2e-5) fail("outline is too small to project");
  return points;
}

// Reconstruct every object from known fields. Never spread untrusted project data.
// Runtime media URLs are supplied by the main process, never by a project file.
function validateProject(
  input,
  resolveMedia = (media) => ({ url: "", path: media.path }),
) {
  const project = record(input, "project");
  if (project.version !== 1 && project.version !== 2)
    fail("unsupported file version (expected 1 or 2)");
  const width = number(project.width, "width", 64, 16384);
  const height = number(project.height, "height", 64, 16384);
  if (!Number.isInteger(width) || !Number.isInteger(height))
    fail("output dimensions must be whole pixels");
  if (!Array.isArray(project.surfaces) || project.surfaces.length > 32)
    fail("surfaces must be an array with at most 32 entries");
  if (!Array.isArray(project.media) || project.media.length > 256)
    fail("media must be an array with at most 256 entries");

  const mediaIds = new Set();
  const media = project.media.map((entry) => {
    record(entry, "media");
    const mediaId = id(entry.id, "media id");
    if (mediaIds.has(mediaId) || PATTERNS.has(mediaId))
      fail("duplicate or reserved media id");
    mediaIds.add(mediaId);
    if (entry.kind !== "image" && entry.kind !== "video")
      fail("unsupported media kind");
    const filename =
      entry.path === undefined
        ? undefined
        : string(entry.path, "media path", 4096);
    const resolved = resolveMedia({
      id: mediaId,
      name: string(entry.name, "media name"),
      kind: entry.kind,
      path: filename,
      url: typeof entry.url === "string" ? entry.url : "",
    });
    return {
      id: mediaId,
      name: entry.name,
      kind: entry.kind,
      url: resolved.url || "",
      ...(resolved.path ? { path: resolved.path } : {}),
    };
  });

  const surfaceIds = new Set();
  const surfaces = project.surfaces.map((entry) => {
    record(entry, "surface");
    const surfaceId = id(entry.id, "surface id");
    if (surfaceIds.has(surfaceId)) fail("duplicate surface id");
    surfaceIds.add(surfaceId);
    if (!Array.isArray(entry.corners) || entry.corners.length !== 4)
      fail("each surface requires four corners");
    let corners = entry.corners.map((point) => {
      record(point, "corner");
      return {
        x: number(point.x, "corner x", 0, 1),
        y: number(point.y, "corner y", 0, 1),
      };
    });
    let twiceArea = 0;
    for (let i = 0; i < 4; i++) {
      const a = corners[i],
        b = corners[(i + 1) % 4],
        c = corners[(i + 2) % 4];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-5)
        fail("surface corners must be separated");
      if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1e-9)
        fail("surface corners must form a convex clockwise quadrilateral");
      twiceArea += a.x * b.y - b.x * a.y;
    }
    if (twiceArea < 2e-5) fail("surface is too small to project");
    let polygon;
    if (entry.polygon !== undefined) {
      polygon = validatePolygon(entry.polygon);
      const bounds = polygonBounds(polygon);
      if (
        corners.some(
          (p, i) =>
            Math.abs(p.x - bounds[i].x) > 1e-9 ||
            Math.abs(p.y - bounds[i].y) > 1e-9,
        )
      )
        fail("polygon corners must match its rectangular bounds");
      corners = bounds;
    }
    let content;
    if (entry.content !== undefined) {
      const c = record(entry.content, "content transform");
      content = {
        rotation: number(c.rotation, "content rotation", -180, 180),
        scale: number(c.scale, "content scale", 0.1, 4),
        offsetX: number(c.offsetX, "content horizontal offset", -1, 1),
        offsetY: number(c.offsetY, "content vertical offset", -1, 1),
      };
    }
    let audio;
    if (entry.audio !== undefined) {
      const a = record(entry.audio, "audio response");
      audio = {
        enabled: boolean(a.enabled, "audio response enabled"),
        band: choice(a.band, "audio response band", [
          "level",
          "bass",
          "mid",
          "treble",
          "beat",
        ]),
        amount: number(a.amount, "audio response strength", 0, 1),
        mode: choice(a.mode, "audio response mode", [
          "brightness",
          "zoom",
          "both",
        ]),
      };
    }
    const source = string(entry.source, "source", 128);
    if (!PATTERNS.has(source) && !mediaIds.has(source))
      fail("surface references unknown media");
    if (
      typeof entry.color !== "string" ||
      !/^#[0-9a-fA-F]{6}$/.test(entry.color)
    )
      fail("surface color must be a six-digit hex color");
    return {
      id: surfaceId,
      name: string(entry.name, "surface name"),
      corners,
      source,
      visible: boolean(entry.visible, "visible"),
      locked: boolean(entry.locked, "locked"),
      opacity: number(entry.opacity, "opacity", 0, 1),
      color: entry.color,
      ...(entry.speed === undefined
        ? {}
        : { speed: number(entry.speed, "animation speed", 0, 3) }),
      ...(entry.detail === undefined
        ? {}
        : { detail: number(entry.detail, "animation detail", 0.5, 3) }),
      ...(polygon === undefined ? {} : { polygon }),
      ...(entry.kind === undefined
        ? {}
        : { kind: choice(entry.kind, "layer kind", ["surface", "mask"]) }),
      ...(entry.blendMode === undefined
        ? {}
        : {
            blendMode: choice(entry.blendMode, "blend mode", [
              "normal",
              "add",
              "screen",
            ]),
          }),
      ...(entry.edgeWidth === undefined
        ? {}
        : { edgeWidth: number(entry.edgeWidth, "edge width", 1, 80) }),
      ...(entry.feather === undefined
        ? {}
        : { feather: number(entry.feather, "edge feather", 0, 80) }),
      ...(content === undefined ? {} : { content }),
      ...(audio === undefined ? {} : { audio }),
    };
  });
  return {
    version: 2,
    name: string(project.name, "name"),
    width,
    height,
    surfaces,
    media,
    brightness: number(project.brightness, "brightness", 0, 1),
    blackout: boolean(project.blackout, "blackout"),
    playing: boolean(project.playing, "playing"),
  };
}

function parseProject(text, resolveMedia) {
  if (Buffer.byteLength(text, "utf8") > MAX_PROJECT_BYTES)
    fail("file is larger than 5 MB");
  // Notepad and Windows PowerShell save UTF-8 text with a byte order mark,
  // which is not part of the JSON.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    fail("file is not valid JSON");
  }
  return validateProject(input, resolveMedia);
}

// Media paths are written relative to the project file, always with forward
// slashes so the file means the same on every operating system. Windows reads
// them natively; media on another drive or share is written as an absolute path
// (C:/Videos/a.mp4, //nas/share/a.mp4). pathApi is only replaced by tests that
// simulate another operating system.
function serializeProject(project, destination, pathApi = path) {
  const clean = validateProject(project, (media) => {
    if (
      !media.path ||
      !pathApi.isAbsolute(media.path) ||
      !mediaKind(media.path, pathApi)
    )
      fail("media has no valid local path");
    return {
      url: "",
      path: pathApi
        .relative(pathApi.dirname(destination), media.path)
        .split(pathApi.sep)
        .join("/"),
    };
  });
  // Session tokens never belong in a portable project file.
  clean.media = clean.media.map(({ url, ...media }) => media);
  return JSON.stringify(clean, null, 2) + "\n";
}

module.exports = {
  validateProject,
  parseProject,
  serializeProject,
  mediaKind,
  MAX_PROJECT_BYTES,
};
