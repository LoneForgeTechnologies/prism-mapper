import { PATTERNS, type Project, type Surface, type Media } from "./model";
import { isValidQuad } from "./geometry";
import { boundsQuad, validatePolygon } from "./polygon";
/** Fully validate browser imports and persisted drafts before allowing them into React state. */
export function validateBrowserProject(input: unknown): Project {
  const fail = () => {
    throw new Error("Invalid Prism Mapper project file.");
  };
  const obj = (x: unknown): Record<string, any> =>
    x && typeof x === "object" && !Array.isArray(x)
      ? (x as Record<string, any>)
      : fail();
  const text = (x: unknown, max = 200): string =>
    typeof x === "string" &&
    x.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)
      ? x
      : fail();
  const identity = (x: unknown): string => {
    const value = text(x, 128);
    return /^[a-zA-Z0-9_-]+$/.test(value) ? value : fail();
  };
  const choice = <T extends string>(x: unknown, values: readonly T[]): T =>
    typeof x === "string" && values.includes(x as T) ? (x as T) : fail();
  const num = (x: unknown, min: number, max: number): number =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max
      ? x
      : fail();
  const bool = (x: unknown): boolean => (typeof x === "boolean" ? x : fail());
  const p = obj(input);
  if (p.version !== 1 && p.version !== 2) fail();
  const width = num(p.width, 64, 16384),
    height = num(p.height, 64, 16384);
  if (!Number.isInteger(width) || !Number.isInteger(height)) fail();
  if (
    !Array.isArray(p.surfaces) ||
    p.surfaces.length > 32 ||
    !Array.isArray(p.media) ||
    p.media.length > 256
  )
    fail();
  const ids = new Set<string>();
  const surfaces: Surface[] = p.surfaces.map((raw: unknown) => {
    const s = obj(raw);
    const id = identity(s.id);
    if (!id || ids.has(id)) fail();
    ids.add(id);
    if (!Array.isArray(s.corners) || !isValidQuad(s.corners)) fail();
    let corners = s.corners.map((point: unknown) => {
      const v = obj(point);
      return { x: num(v.x, 0, 1), y: num(v.y, 0, 1) };
    }) as Surface["corners"];
    let polygon: Surface["polygon"];
    if (s.polygon !== undefined) {
      if (!Array.isArray(s.polygon) || !validatePolygon(s.polygon).valid)
        fail();
      polygon = s.polygon.map((point: unknown) => {
        const v = obj(point);
        return { x: num(v.x, 0, 1), y: num(v.y, 0, 1) };
      });
      const bounds = boundsQuad(polygon!);
      if (
        corners.some(
          (point, i) =>
            Math.abs(point.x - bounds[i].x) > 1e-9 ||
            Math.abs(point.y - bounds[i].y) > 1e-9,
        )
      )
        fail();
      corners = bounds;
    }
    let content: Surface["content"];
    if (s.content !== undefined) {
      const c = obj(s.content);
      content = {
        rotation: num(c.rotation, -180, 180),
        scale: num(c.scale, 0.1, 4),
        offsetX: num(c.offsetX, -1, 1),
        offsetY: num(c.offsetY, -1, 1),
      };
    }
    let audio: Surface["audio"];
    if (s.audio !== undefined) {
      const a = obj(s.audio);
      audio = {
        enabled: bool(a.enabled),
        band: choice(a.band, [
          "level",
          "bass",
          "mid",
          "treble",
          "beat",
        ] as const),
        amount: num(a.amount, 0, 1),
        mode: choice(a.mode, ["brightness", "zoom", "both"] as const),
      };
    }
    const source = text(s.source, 128);
    const color = text(s.color, 7);
    if (!/^#[a-f0-9]{6}$/i.test(color)) fail();
    return {
      id,
      name: text(s.name),
      corners,
      source,
      visible: bool(s.visible),
      locked: bool(s.locked),
      opacity: num(s.opacity, 0, 1),
      color,
      ...(s.speed === undefined ? {} : { speed: num(s.speed, 0, 3) }),
      ...(s.detail === undefined ? {} : { detail: num(s.detail, 0.5, 3) }),
      ...(polygon === undefined ? {} : { polygon }),
      ...(s.kind === undefined
        ? {}
        : { kind: choice(s.kind, ["surface", "mask"] as const) }),
      ...(s.blendMode === undefined
        ? {}
        : {
            blendMode: choice(s.blendMode, [
              "normal",
              "add",
              "screen",
            ] as const),
          }),
      ...(s.edgeWidth === undefined
        ? {}
        : { edgeWidth: num(s.edgeWidth, 1, 80) }),
      ...(s.feather === undefined ? {} : { feather: num(s.feather, 0, 80) }),
      ...(content === undefined ? {} : { content }),
      ...(audio === undefined ? {} : { audio }),
    };
  });
  const mediaIds = new Set<string>();
  const media: Media[] = p.media.map((raw: unknown) => {
    const m = obj(raw);
    const id = identity(m.id);
    if (!id || mediaIds.has(id) || PATTERNS.includes(id as any)) fail();
    mediaIds.add(id);
    if (m.kind !== "image" && m.kind !== "video") fail();
    return {
      id,
      name: text(m.name),
      kind: m.kind,
      url: "",
      ...(m.path === undefined ? {} : { path: text(m.path, 4096) }),
    };
  });
  if (
    surfaces.some(
      (s) => !PATTERNS.includes(s.source as any) && !mediaIds.has(s.source),
    )
  )
    fail();
  return {
    version: 2,
    name: text(p.name),
    width,
    height,
    surfaces,
    media,
    brightness: num(p.brightness, 0, 1),
    blackout: bool(p.blackout),
    playing: bool(p.playing),
  };
}

/**
 * The project the web app starts from when a person picks a project file. The
 * media entries and the layers that use them stay as the file has them, so a
 * project made on the desktop (its media have a path) goes back to the desktop
 * whole after it was edited on a phone. The pictures themselves are not in the
 * file: it starts in blackout, and those layers stay dark until the files are
 * imported again.
 */
export function projectFromFile(input: unknown): Project {
  return { ...validateBrowserProject(input), blackout: true };
}

/**
 * The project as the web app writes it. A blob: address belongs to one page
 * load and is not saved. The path of media that came from a desktop project is
 * kept, so the desktop can find the file again.
 */
export function portableProject(project: Project): Project {
  return {
    ...project,
    media: project.media.map((media) => ({ ...media, url: "" })),
  };
}
