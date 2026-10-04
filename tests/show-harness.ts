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
  return entries.map(sampleEntry);
}

function sampleEntry({ renderer, canvas, gl }: (typeof entries)[number]) {
  const pixel = new Uint8Array(4);
  gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  const assets = Array.from((renderer as any).assets.values()) as {
    element: HTMLVideoElement;
    timelineKey: string;
    uploaded: boolean;
    lastTime: number;
    ready: boolean;
  }[];
  return {
    pixel: Array.from(pixel),
    error: gl.getError(),
    renderError: canvas.dataset.renderError,
    videos: assets.map(
      ({ element, timelineKey, uploaded, lastTime, ready }) => ({
        time: element.currentTime,
        duration: element.duration,
        paused: element.paused,
        seeking: element.seeking,
        ready: element.readyState,
        muted: element.muted,
        loop: element.loop,
        key: timelineKey,
        uploaded,
        lastTime,
        assetReady: ready,
      }),
    ),
  };
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
    expected: [number, number, number],
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
    const deadline = performance.now() + 12000;
    let attempts = 0;
    let firstReadySamples: ReturnType<typeof sample> | undefined;
    let latest: ReturnType<typeof sample> | undefined;
    while (performance.now() < deadline) {
      attempts++;
      // Read each buffer directly after its own draw; production canvases do
      // not preserve their drawing buffers after the browser presents them.
      const samples = entries.map((entry, index) => {
        entry.renderer.render(project, 1000 * index, now);
        return sampleEntry(entry);
      });
      latest = samples;
      if (errors.length || samples.some((entry) => entry.error !== 0))
        throw new Error(
          `Renderer failed: ${JSON.stringify(samples)}; ${errors.join("; ")}`,
        );
      if (
        samples.every(
          (entry) =>
            entry.videos.length === 1 &&
            entry.videos[0].ready >= 2 &&
            !entry.videos[0].seeking,
        )
      ) {
        // Media properties can settle before seeked invalidates the texture or
        // its decoded image reaches WebGL. Keep the production render loop and
        // fixed session clock running until both actual pixels reach the cue.
        if (!firstReadySamples) firstReadySamples = samples;
        if (
          samples.every((entry) =>
            expected.every(
              (channel, index) => Math.abs(channel - entry.pixel[index]) < 12,
            ),
          )
        )
          return {
            samples,
            resolved: resolveShowFrame(project, now).video,
            readiness: { attempts, firstReadySamples },
          };
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    throw new Error(
      `Expected decoded frame ${expected} at fixed show position ${position} did not arrive: ${JSON.stringify({ firstReadySamples, latest, attempts })}; ${errors.join("; ")}`,
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
