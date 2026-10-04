import { ProjectionRenderer } from "../src/renderer";
import { createProject, type Surface } from "../src/model";
import { resolveShowFrame } from "../src/timeline";

const epoch = 1_700_000_000_000;
const errors: string[] = [];
const project = createProject();
const quad: Surface["corners"] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
project.width = project.height = 64;
project.brightness = 1;
project.media = ["warm", "blue", "green"].map((name) => ({
  id: name,
  name: `timeline-${name}.mp4`,
  kind: "video" as const,
  url: new URL(`./fixtures/timeline-${name}.mp4`, location.href).href,
}));
project.show = {
  loop: false,
  scenes: project.media.map((media) => ({
    id: media.id,
    name: media.name,
    surfaces: [
      { ...project.surfaces[0], source: `media:${media.id}`, corners: quad },
    ],
  })),
  cues: [
    { id: "warm-first", sceneId: "warm", duration: 2 },
    { id: "blue", sceneId: "blue", duration: 2 },
    { id: "warm-repeat", sceneId: "warm", duration: 2 },
    { id: "green-hold", sceneId: "green", duration: 3 },
  ],
};

const entries = ["editor", "output"].map((id) => {
  const canvas = document.querySelector<HTMLCanvasElement>(`#${id}`)!;
  const renderer = new ProjectionRenderer(canvas, {
    onError: (error) => errors.push(`${id}: ${error}`),
  });
  return { canvas, renderer, gl: canvas.getContext("webgl")! };
});

function sample() {
  return entries.map(({ renderer, canvas, gl }) => {
    const pixel = new Uint8Array(4);
    gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const assets = Array.from((renderer as any).assets.values()) as {
      element: HTMLVideoElement;
      timelineKey: string;
    }[];
    return {
      pixel: Array.from(pixel),
      error: gl.getError(),
      renderError: canvas.dataset.renderError,
      videos: assets.map(({ element, timelineKey }) => ({
        time: element.currentTime,
        duration: element.duration,
        paused: element.paused,
        seeking: element.seeking,
        ready: element.readyState,
        muted: element.muted,
        loop: element.loop,
        key: timelineKey,
      })),
    };
  });
}

(window as any).showHarness = {
  errors,
  project,
  sample,
  async frame(
    position: number,
    options: {
      playing?: boolean;
      loop?: boolean;
      token?: string;
      now?: number;
      blackout?: boolean;
    } = {},
  ) {
    project.transport = {
      active: true,
      position,
      updatedAt: epoch,
      token: options.token ?? "run",
      playing: options.playing ?? false,
    };
    project.show!.loop = options.loop ?? false;
    project.blackout = options.blackout ?? false;
    const now = options.now ?? epoch;
    // Resolve each independent renderer using the same transmitted session clock.
    // Unequal procedural timestamps model an output created after the editor.
    for (let attempt = 0; attempt < 240; attempt++) {
      entries.forEach(({ renderer }, index) =>
        renderer.render(project, 1000 * index, now),
      );
      const samples = sample();
      if (
        samples.every(
          (entry) =>
            entry.videos.length === 1 &&
            entry.videos[0].ready >= 2 &&
            !entry.videos[0].seeking,
        )
      ) {
        // A final render uploads the decoded frame delivered by seeked.
        entries.forEach(({ renderer }, index) =>
          renderer.render(project, 1000 * index, now),
        );
        return {
          samples: sample(),
          resolved: resolveShowFrame(project, now).video,
        };
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    throw new Error(
      `Video frame did not become ready: ${JSON.stringify(sample())}; ${errors.join("; ")}`,
    );
  },
  async inactive() {
    delete project.transport;
    project.surfaces = [
      {
        ...project.surfaces[0],
        corners: quad,
        source: "solid",
        color: "#ffffff",
      },
    ];
    entries.forEach(({ renderer }) => renderer.render(project, 0, epoch));
    return sample();
  },
};
