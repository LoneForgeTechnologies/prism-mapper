import { ProjectionRenderer } from "../src/renderer";
import { createProject } from "../src/model";
import { CATALOG } from "../src/patterns";
const canvas = document.querySelector("canvas")!;
const errors: string[] = [];
const renderer = new ProjectionRenderer(canvas, {
  onError: (error) => errors.push(error),
});
let time = 0;
const project = createProject();
project.brightness = 1;
project.surfaces[0].corners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
(window as any).animationHarness = {
  catalog: CATALOG,
  errors,
  render(
    id: string,
    advance = 0,
    settings: {
      speed?: number;
      detail?: number;
      playing?: boolean;
      blackout?: boolean;
    } = {},
  ) {
    project.surfaces[0].source = id;
    project.surfaces[0].speed = settings.speed ?? 1;
    project.surfaces[0].detail = settings.detail ?? 1;
    project.playing = settings.playing ?? true;
    project.blackout = settings.blackout ?? false;
    for (let i = 0; i < advance; i++) {
      time += 0.125;
      renderer.render(project, time);
    }
    renderer.render(project, time);
    const gl = canvas.getContext("webgl")!;
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
      image: canvas.toDataURL(),
      pixels: Array.from(pixels),
      error: gl.getError(),
      width: canvas.width,
      height: canvas.height,
    };
  },
};
