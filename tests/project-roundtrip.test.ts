import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProject, type Project } from "../src/model.ts";
import { portableProject, projectFromFile } from "../src/project-validation.ts";
const require = createRequire(import.meta.url);
const { loadProjectFile } = require("../electron/load.cjs");
const { serializeProject } = require("../electron/project.cjs");

// A project file is shared between the desktop app and the web app (a phone or
// a browser). Neither may lose what the other one wrote.

const registerMedia = (file: string) => ({
  url: `media://local/${path.basename(file)}`,
  path: file,
});

async function folder(t: { after(callback: () => Promise<void>): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "prism-roundtrip-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "media"));
  await writeFile(path.join(directory, "media", "a.png"), "not really a png");
  return directory;
}

function projectUsing(mediaId: string): Project {
  const project = createProject();
  project.name = "Round trip";
  project.surfaces[0].source = mediaId;
  return project;
}

test("the web app keeps a desktop project's media and the layers that use them", () => {
  const project = projectUsing("m1");
  project.media = [
    { id: "m1", name: "a.png", kind: "image", url: "media://local/token" },
  ];
  const text = serializeProject(
    {
      ...project,
      media: [{ ...project.media[0], path: "/shows/media/a.png" }],
    },
    "/shows/night/show.prism.json",
    path.posix,
  );
  const opened = projectFromFile(JSON.parse(text));
  assert.deepEqual(opened.media, [
    {
      id: "m1",
      name: "a.png",
      kind: "image",
      url: "",
      path: "../media/a.png",
    },
  ]);
  assert.equal(opened.surfaces[0].source, "m1");
  // The pictures are not in the file, so nothing is projected until they are back.
  assert.equal(opened.blackout, true);
});

test("a desktop project survives a round trip through the web app", async (t) => {
  const directory = await folder(t);
  const original = path.join(directory, "show.prism.json");
  await writeFile(
    original,
    serializeProject(
      {
        ...projectUsing("m1"),
        media: [
          {
            id: "m1",
            name: "a.png",
            kind: "image",
            url: "",
            path: path.join(directory, "media", "a.png"),
          },
        ],
      },
      original,
    ),
  );
  const first = await loadProjectFile(original, { registerMedia });
  assert.deepEqual(first.missing, []);

  // Opened and saved again by the web app, then back to the desktop.
  const viaWeb = portableProject(
    projectFromFile(JSON.parse(await readFile(original, "utf8"))),
  );
  const returned = path.join(directory, "returned.prism.json");
  await writeFile(returned, JSON.stringify(viaWeb, null, 2));
  const second = await loadProjectFile(returned, { registerMedia });
  assert.deepEqual(second.missing, []);
  assert.deepEqual(second.project.media, first.project.media);
  assert.equal(second.project.surfaces[0].source, "m1");
});

test("media the web app imported becomes missing on the desktop and the project still opens", async (t) => {
  const directory = await folder(t);
  const web = projectUsing("from-the-phone");
  web.media = [
    {
      id: "from-the-phone",
      name: "photo.png",
      kind: "image",
      url: "blob:https://prism.example/1234",
    },
  ];
  const file = path.join(directory, "phone.prism.json");
  await writeFile(file, JSON.stringify(portableProject(web), null, 2));
  const { project, missing } = await loadProjectFile(file, { registerMedia });
  assert.deepEqual(missing, ["photo.png"]);
  assert.deepEqual(project.media, []);
  assert.equal(project.surfaces[0].source, "grid");
  assert.equal(project.name, "Round trip");
});

test("saving from the web app never writes a blob address and keeps a desktop path", () => {
  const project = projectUsing("m1");
  project.media = [
    {
      id: "m1",
      name: "a.png",
      kind: "image",
      url: "blob:https://prism.example/1",
      path: "media/a.png",
    },
    {
      id: "m2",
      name: "b.mp4",
      kind: "video",
      url: "blob:https://prism.example/2",
    },
  ];
  const portable = portableProject(project);
  assert.deepEqual(
    portable.media.map((media) => [media.url, media.path]),
    [
      ["", "media/a.png"],
      ["", undefined],
    ],
  );
  // The project in the editor keeps working addresses.
  assert.equal(project.media[0].url, "blob:https://prism.example/1");
});

test("a local show retains scenes and ordered cues through native and portable Save/Open", async (t) => {
  const directory = await folder(t);
  const original = path.join(directory, "show.prism.json");
  const project = projectUsing("m1");
  project.version = 3;
  project.media = [
    {
      id: "m1",
      name: "a.png",
      kind: "image",
      url: "",
      path: path.join(directory, "media", "a.png"),
    },
  ];
  project.show = {
    scenes: [
      {
        id: "intro",
        name: "Band intro",
        surfaces: structuredClone(project.surfaces),
      },
      {
        id: "pre-show",
        name: "Pre-show",
        surfaces: [{ ...project.surfaces[0], opacity: 0.5 }],
      },
    ],
    cues: [
      { id: "first", sceneId: "intro", duration: 120 },
      { id: "second", sceneId: "pre-show", duration: 120 },
      { id: "repeat", sceneId: "intro", duration: 120 },
    ],
    loop: true,
  };
  project.transport = {
    active: true,
    position: 125,
    updatedAt: 1000,
    token: "session",
    playing: true,
  };
  await writeFile(original, serializeProject(project, original));
  const first = await loadProjectFile(original, { registerMedia });
  assert.deepEqual(first.missing, []);
  assert.equal(first.project.version, 3);
  assert.deepEqual(first.project.show, project.show);
  assert.equal(first.project.transport, undefined);

  const portable = portableProject(
    projectFromFile(JSON.parse(await readFile(original, "utf8"))),
  );
  const returned = path.join(directory, "returned.prism.json");
  await writeFile(returned, JSON.stringify(portable));
  const second = await loadProjectFile(returned, { registerMedia });
  assert.deepEqual(second.missing, []);
  assert.deepEqual(second.project.show, project.show);
  assert.deepEqual(second.project.media, first.project.media);
  assert.equal(second.project.transport, undefined);
});

test("dropping media without local paths resets sources in every saved scene and base mapping", async (t) => {
  const directory = await folder(t);
  const project = projectUsing("missing-clip");
  project.version = 3;
  project.media = [
    {
      id: "missing-clip",
      name: "Intro.mp4",
      kind: "video",
      url: "blob:previous-session",
    },
    {
      id: "local-image",
      name: "a.png",
      kind: "image",
      url: "",
      path: "media/a.png",
    },
  ];
  project.show = {
    scenes: [
      {
        id: "intro",
        name: "Intro",
        surfaces: structuredClone(project.surfaces),
      },
      {
        id: "set",
        name: "Set",
        surfaces: [
          {
            ...structuredClone(project.surfaces[0]),
            id: "video",
            source: "missing-clip",
          },
          {
            ...structuredClone(project.surfaces[0]),
            id: "image",
            source: "local-image",
          },
        ],
      },
    ],
    cues: [{ id: "cue", sceneId: "set", duration: 120 }],
    loop: false,
  };
  const file = path.join(directory, "missing.prism.json");
  await writeFile(file, JSON.stringify(portableProject(project)));
  const { project: loaded, missing } = await loadProjectFile(file, {
    registerMedia,
  });
  assert.deepEqual(missing, ["Intro.mp4"]);
  assert.equal(loaded.surfaces[0].source, "grid");
  assert.equal(loaded.show.scenes[0].surfaces[0].source, "grid");
  assert.deepEqual(
    loaded.show.scenes[1].surfaces.map(
      (surface: { source: string }) => surface.source,
    ),
    ["grid", "local-image"],
  );
  assert.deepEqual(loaded.show.cues, project.show.cues);
  assert.equal(loaded.media.length, 1);
  // The recovered project remains valid for another save.
  assert.doesNotThrow(() => serializeProject(loaded, file));
});
