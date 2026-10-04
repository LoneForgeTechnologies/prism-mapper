const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRecentProjects, MAX_RECENT_PROJECTS } = require("./recent.cjs");

async function withHistory(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prism-recent-"));
  const filename = path.join(directory, "profile", "recent-projects.json");
  try {
    await run({ directory, filename });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("recent shows persist with stable opaque ids and project titles", async () => {
  await withHistory(async ({ directory, filename }) => {
    let timestamp = 100;
    const history = createRecentProjects({ filename, now: () => timestamp++ });
    assert.deepEqual(await history.list(), []);
    const intro = await history.remember(
      path.join(directory, "intro.prism.json"),
      "Band intro",
    );
    assert.match(intro.id, /^[0-9a-f-]{36}$/);
    assert.notEqual(intro.id, intro.path);
    const set = await history.remember(
      path.join(directory, "set.prism.json"),
      "Set 1",
    );
    const updated = await history.remember(intro.path, "Band intro revised");
    assert.equal(
      updated.id,
      intro.id,
      "saving the same show keeps its shortcut id",
    );
    assert.deepEqual(await history.list(), [updated, set]);
    const restored = createRecentProjects({ filename });
    assert.deepEqual(await restored.list(), [updated, set]);
    assert.deepEqual(await restored.resolve(intro.id), updated);
    assert.deepEqual(await fs.readdir(path.dirname(filename)), [
      "recent-projects.json",
    ]);
    const snapshot = await restored.list();
    snapshot[0].path = "/tampered.json";
    assert.equal((await restored.resolve(intro.id)).path, intro.path);
  });
});

test("recent ids authorize only remembered projects, never renderer paths or objects", async () => {
  const history = createRecentProjects();
  const remembered = await history.remember("/shows/set1.prism.json", "Set 1");
  for (const id of [
    remembered.path,
    { id: remembered.id },
    null,
    "",
    "00000000-0000-0000-0000-000000000000",
  ])
    assert.equal(await history.resolve(id), null);
  assert.equal((await history.resolve(remembered.id)).path, remembered.path);
  for (const filename of [
    "relative.prism.json",
    "/shows/secret.txt",
    "/shows/null\0.prism.json",
  ])
    await assert.rejects(
      history.remember(filename, "Invalid"),
      /absolute JSON file path/,
    );
  assert.equal((await history.list()).length, 1);
});

test("the MRU list is bounded and serializes concurrent atomic writes", async () => {
  await withHistory(async ({ directory, filename }) => {
    let timestamp = 1;
    const history = createRecentProjects({ filename, now: () => timestamp++ });
    const recorded = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        history.remember(
          path.join(directory, `show${index}.prism.json`),
          `Show ${index}`,
        ),
      ),
    );
    const expected = recorded.slice(-MAX_RECENT_PROJECTS).reverse();
    assert.deepEqual(await history.list(), expected);
    assert.equal(
      await history.resolve(recorded[0].id),
      null,
      "evicted ids stop authorizing opens",
    );
    assert.deepEqual(await createRecentProjects({ filename }).list(), expected);
  });
});

test("invalid persisted metadata cannot authorize file paths", async () => {
  await withHistory(async ({ directory, filename }) => {
    await fs.mkdir(path.dirname(filename));
    const good = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Pre-show",
      path: path.join(directory, "preshow.prism.json"),
      updatedAt: 1,
    };
    const metadata = {
      version: 1,
      projects: [
        { ...good, id: "renderer-selected-path", path: "/secret.json" },
        { ...good, path: "relative.json" },
        { ...good, path: "/secret.txt" },
        { ...good, updatedAt: -1 },
        { ...good, name: "a\0b" },
        good,
        { ...good, path: "/other.json" },
        { ...good, id: "00000000-0000-4000-8000-000000000002" },
      ],
    };
    await fs.writeFile(filename, JSON.stringify(metadata));
    const history = createRecentProjects({ filename });
    assert.deepEqual(await history.list(), [good]);
    assert.equal(await history.resolve("renderer-selected-path"), null);
    for (const contents of [
      "{broken",
      JSON.stringify({ version: 2, projects: [good] }),
      " ".repeat(129 * 1024),
    ]) {
      await fs.writeFile(filename, contents);
      assert.deepEqual(await createRecentProjects({ filename }).list(), []);
    }
  });
});

test("Windows paths ignore casing when keeping an existing shortcut", async () => {
  const history = createRecentProjects({
    pathApi: path.win32,
    platform: "win32",
  });
  const initial = await history.remember("C:\\Shows\\Set1.prism.json", "Set 1");
  const next = await history.remember(
    "c:\\shows\\SET1.prism.json",
    "Set 1 edited",
  );
  assert.equal(next.id, initial.id);
  assert.deepEqual(await history.list(), [next]);
});

test("a failed metadata save leaves the in-memory list usable and later writes recover", async () => {
  await withHistory(async ({ directory, filename }) => {
    let fail = true;
    const history = createRecentProjects({
      filename,
      write: async (target, contents) => {
        if (fail) throw new Error("read-only profile");
        await fs.writeFile(target, contents);
      },
    });
    await assert.rejects(
      history.remember(path.join(directory, "intro.prism.json"), "Intro"),
      /read-only profile/,
    );
    const [intro] = await history.list();
    assert.equal((await history.resolve(intro.id)).name, "Intro");
    fail = false;
    await history.remember(path.join(directory, "set1.prism.json"), "Set 1");
    assert.equal((await createRecentProjects({ filename }).list()).length, 2);
  });
});
