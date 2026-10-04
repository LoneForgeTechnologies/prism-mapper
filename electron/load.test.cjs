const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadProjectFile } = require("./load.cjs");
const { serializeProject } = require("./project.cjs");

function projectText(media) {
  return JSON.stringify({
    version: 2,
    name: "Loader test",
    width: 1920,
    height: 1080,
    surfaces: [
      {
        id: "s1",
        name: "Surface",
        corners: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
        source: "grid",
        visible: true,
        locked: false,
        opacity: 1,
        color: "#ffffff",
      },
    ],
    media: media.map((entry, index) => ({
      id: `m${index}`,
      name: entry.name ?? `clip${index}`,
      kind: entry.kind ?? "image",
      path: entry.path,
    })),
    brightness: 0.65,
    blackout: false,
    playing: true,
  });
}

// A file system that holds the given files (path -> text) and records every
// path that is looked at, so a test can prove which paths were never touched.
function fakeFs(files, pathApi) {
  const looked = [];
  const key = (name) => pathApi.normalize(name).toLowerCase();
  const table = new Map(Object.entries(files).map(([k, v]) => [key(k), v]));
  return {
    looked,
    stat: async (name) => {
      looked.push(name);
      if (!table.has(key(name)))
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      const text = table.get(key(name));
      return {
        isFile: () => text !== null,
        size: Buffer.byteLength(text ?? ""),
      };
    },
    readFile: async (name) => table.get(key(name)),
  };
}

function registry() {
  const registered = [];
  return {
    registered,
    registerMedia: (file) => {
      registered.push(file);
      return { url: `media://local/token-${registered.length}`, path: file };
    },
  };
}

const win = (files, entries, project = "D:\\Shows\\Night\\show.prism.json") => {
  const fs = fakeFs({ ...files, [project]: projectText(entries) }, path.win32);
  const media = registry();
  return {
    fs,
    media,
    load: () =>
      loadProjectFile(project, {
        fs,
        pathApi: path.win32,
        registerMedia: media.registerMedia,
      }),
  };
};

test("finds media beside a Windows project, whichever separator was written", async () => {
  const { load, media } = win(
    {
      "D:\\Shows\\Night\\media\\a.png": "png",
      "D:\\Shows\\Shared\\b.webm": "webm",
    },
    [{ path: "media/a.png" }, { path: "..\\Shared/b.webm", kind: "video" }],
  );
  const { project, missing } = await load();
  assert.deepEqual(missing, []);
  assert.deepEqual(media.registered, [
    "D:\\Shows\\Night\\media\\a.png",
    "D:\\Shows\\Shared\\b.webm",
  ]);
  assert.deepEqual(
    project.media.map((m) => [m.path, m.url]),
    [
      ["D:\\Shows\\Night\\media\\a.png", "media://local/token-1"],
      ["D:\\Shows\\Shared\\b.webm", "media://local/token-2"],
    ],
  );
});

test("finds media on another drive written as an absolute path", async () => {
  const { load, media } = win({ "C:\\Users\\Ada\\Pictures\\a.png": "png" }, [
    { path: "C:/Users/Ada/Pictures/a.png" },
  ]);
  const { missing } = await load();
  assert.deepEqual(missing, []);
  assert.deepEqual(media.registered, ["C:\\Users\\Ada\\Pictures\\a.png"]);
});

test("a server named by the project is not contacted", async () => {
  const { load, fs, media } = win({}, [
    { path: "\\\\evil.example.com\\share\\a.png" },
    { path: "//198.51.100.7/c$/b.png" },
    { path: "\\\\?\\UNC\\evil\\share\\c.png" },
    { path: "\\\\.\\pipe\\d.png" },
  ]);
  const { project, missing } = await load();
  assert.deepEqual(missing, ["clip0", "clip1", "clip2", "clip3"]);
  assert.deepEqual(media.registered, []);
  // Only the project file itself was looked at.
  assert.deepEqual(fs.looked, ["D:\\Shows\\Night\\show.prism.json"]);
  // The path is kept, so saving does not silently drop it.
  assert.equal(project.media[0].path, "\\\\evil.example.com\\share\\a.png");
  assert.equal(project.media[0].url, "");
});

test("media beside a project opened from a server is read from that server", async () => {
  const project = "\\\\Nas\\shows\\night\\show.prism.json";
  const { load, media } = win(
    {
      "\\\\nas\\shows\\media\\a.png": "png",
      "\\\\other\\shows\\b.png": "png",
    },
    [{ path: "../media/a.png" }, { path: "\\\\other\\shows\\b.png" }],
    project,
  );
  const { missing } = await load();
  assert.deepEqual(media.registered, ["\\\\Nas\\shows\\media\\a.png"]);
  assert.deepEqual(missing, ["clip1"]);
});

test("reports media that is not there and keeps its path", async () => {
  const { load } = win({}, [{ path: "media/gone.png" }]);
  const { project, missing } = await load();
  assert.deepEqual(missing, ["clip0"]);
  assert.equal(project.media[0].url, "");
  assert.equal(project.media[0].path, "D:\\Shows\\Night\\media\\gone.png");
});

test("a folder is not media", async () => {
  const { load } = win({ "D:\\Shows\\Night\\media\\a.png": null }, [
    { path: "media/a.png" },
  ]);
  assert.deepEqual((await load()).missing, ["clip0"]);
});

test("rejects what Open has always rejected", async () => {
  await assert.rejects(
    win({}, [{ path: "media/a.mp4", kind: "image" }]).load(),
    /Unsupported media type: clip0/,
  );
  await assert.rejects(
    win({}, [{ path: "media/a\0.png" }]).load(),
    /media path must be text/,
  );
  await assert.rejects(win({}, [{ path: "" }]).load(), /no valid local path/);
  const huge = "D:\\Shows\\big.prism.json";
  const fs = fakeFs({ [huge]: "x".repeat(5 * 1024 * 1024 + 1) }, path.win32);
  await assert.rejects(
    loadProjectFile(huge, {
      fs,
      pathApi: path.win32,
      registerMedia: registry().registerMedia,
    }),
    /smaller than 5 MB/,
  );
  const folder = "D:\\Shows\\folder.prism.json";
  await assert.rejects(
    loadProjectFile(folder, {
      fs: fakeFs({ [folder]: null }, path.win32),
      pathApi: path.win32,
      registerMedia: registry().registerMedia,
    }),
    /smaller than 5 MB/,
  );
});

test("opens a project saved with a byte order mark", async () => {
  const project = "D:\\Shows\\bom.prism.json";
  const fs = fakeFs({ [project]: `\uFEFF${projectText([])}` }, path.win32);
  const { project: loaded } = await loadProjectFile(project, {
    fs,
    pathApi: path.win32,
    registerMedia: registry().registerMedia,
  });
  assert.equal(loaded.name, "Loader test");
});

test("a Windows project opened on macOS finds media written with backslashes", async () => {
  const project = "/Users/ada/Shows/show.prism.json";
  const fs = fakeFs(
    {
      [project]: projectText([
        { path: "media\\a.png" },
        { path: "..\\Shared\\b.webm", kind: "video" },
        { path: "C:\\Users\\Ada\\c.png" },
      ]),
      "/Users/ada/Shows/media/a.png": "png",
      "/Users/ada/Shared/b.webm": "webm",
    },
    path.posix,
  );
  const media = registry();
  const { missing } = await loadProjectFile(project, {
    fs,
    pathApi: path.posix,
    registerMedia: media.registerMedia,
  });
  assert.deepEqual(media.registered, [
    "/Users/ada/Shows/media/a.png",
    "/Users/ada/Shared/b.webm",
  ]);
  assert.deepEqual(missing, ["clip2"]);
});

test("a file whose name really contains a backslash is still found first", async () => {
  const project = "/home/ada/show.prism.json";
  const fs = fakeFs(
    {
      [project]: projectText([{ path: "odd\\name.png" }]),
      "/home/ada/odd\\name.png": "png",
      "/home/ada/odd/name.png": "other",
    },
    path.posix,
  );
  const media = registry();
  await loadProjectFile(project, {
    fs,
    pathApi: path.posix,
    registerMedia: media.registerMedia,
  });
  assert.deepEqual(media.registered, ["/home/ada/odd\\name.png"]);
});

test("a project saved on Windows reads back the same media", () => {
  // The write side of the round trip: forward slashes, absolute across drives.
  const project = JSON.parse(
    projectText([
      { path: "D:\\Shows\\Night\\media\\a.png" },
      { path: "D:\\Shows\\Shared\\b.webm", kind: "video" },
      { path: "C:\\Users\\Ada\\c.png" },
      { path: "\\\\nas\\media\\d.png" },
    ]),
  );
  const written = JSON.parse(
    serializeProject(project, "D:\\Shows\\Night\\show.prism.json", path.win32),
  );
  assert.deepEqual(
    written.media.map((m) => m.path),
    [
      "media/a.png",
      "../Shared/b.webm",
      "C:/Users/Ada/c.png",
      "//nas/media/d.png",
    ],
  );
});
