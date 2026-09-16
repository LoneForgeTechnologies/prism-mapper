import { ProjectionRenderer } from "../src/renderer";
import { createProject, newSurface, type Surface } from "../src/model";
import { homographyFromQuad, transformPoint } from "../src/geometry";
import { CATALOG } from "../src/patterns";
import { publishAudioFrame, type AudioFrame } from "../src/audio";
const errors: string[] = [];
const quad: Surface["corners"] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const media = document.createElement("canvas");
media.width = media.height = 100;
const ctx = media.getContext("2d")!;
[
  ["#ff0000", 0, 0],
  ["#00ff00", 50, 0],
  ["#0000ff", 0, 50],
  ["#ffff00", 50, 50],
].forEach(([color, x, y]) => {
  ctx.fillStyle = String(color);
  ctx.fillRect(Number(x), Number(y), 50, 50);
});
const renderers = ["normal", "fallback"].map((name) => {
  const canvas = document.querySelector<HTMLCanvasElement>(`#${name}`)!;
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: true,
    premultipliedAlpha: false,
  })!;
  const getParameter = gl.getParameter.bind(gl);
  if (name === "fallback")
    gl.getParameter = (p: number) =>
      p === gl.MAX_FRAGMENT_UNIFORM_VECTORS ? 16 : getParameter(p);
  let uploads = 0;
  const bufferData = gl.bufferData.bind(gl);
  gl.bufferData = ((...args: Parameters<typeof gl.bufferData>) => {
    uploads++;
    return bufferData(...args);
  }) as typeof gl.bufferData;
  const renderer = new ProjectionRenderer(canvas, {
    onError: (error) => errors.push(`${name}: ${error}`),
  });
  const project = createProject();
  project.width = 320;
  project.height = 180;
  project.brightness = 1;
  project.playing = true;
  project.media = [
    {
      id: "quadrants",
      name: "Test quadrants",
      url: media.toDataURL(),
      kind: "image",
    },
  ];
  let time = 0;
  return { canvas, gl, renderer, project, time, uploads: () => uploads };
});
(window as any).advancedHarness = {
  errors,
  catalog: CATALOG,
  transform(corners: Surface["corners"], point: { x: number; y: number }) {
    return transformPoint(homographyFromQuad(corners), point);
  },
  async render(
    surfaces: Partial<Surface>[],
    options: {
      fallback?: boolean;
      advance?: number;
      outputWidth?: number;
      outputHeight?: number;
      waitMedia?: boolean;
      audio?: AudioFrame;
      playing?: boolean;
      blackout?: boolean;
      brightness?: number;
    } = {},
  ) {
    const entry = renderers[options.fallback ? 1 : 0];
    if (options.audio) publishAudioFrame(options.audio);
    entry.project.playing = options.playing ?? true;
    entry.project.blackout = options.blackout ?? false;
    entry.project.brightness = options.brightness ?? 1;
    entry.project.width = options.outputWidth ?? 320;
    entry.project.height = options.outputHeight ?? 180;
    entry.project.surfaces = surfaces.map((surface, i) => ({
      ...newSurface(i),
      id: String(i),
      source: "solid",
      color: "#ffffff",
      corners: quad,
      ...surface,
    }));
    const uploadsBefore = entry.uploads();
    for (let i = 0; i < (options.advance ?? 1); i++) {
      entry.time += 0.125;
      entry.renderer.render(entry.project, entry.time);
    }
    if (options.waitMedia) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      entry.renderer.render(entry.project, entry.time);
    }
    const { gl, canvas } = entry;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    return {
      pixels: Array.from(pixels),
      width: canvas.width,
      height: canvas.height,
      error: gl.getError(),
      image: canvas.toDataURL(),
      uploads: entry.uploads() - uploadsBefore,
    };
  },
};
