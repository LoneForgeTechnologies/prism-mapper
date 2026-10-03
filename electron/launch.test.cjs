const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { projectPathFromArgv, createProjectOpener } = require("./launch.cjs");

const win = { pathApi: path.win32, cwd: "C:\\Users\\Ada\\Desktop" };
const posix = { pathApi: path.posix, cwd: "/Users/ada" };

test("finds the project Windows passes for a double-click or Open with", () => {
  assert.equal(
    projectPathFromArgv(
      [
        "C:\\Users\\Ada\\AppData\\Local\\Programs\\Prism Mapper\\Prism Mapper.exe",
        "D:\\Shows\\Night Market.prism.json",
      ],
      win,
    ),
    "D:\\Shows\\Night Market.prism.json",
  );
  assert.equal(
    projectPathFromArgv(
      ["Prism Mapper.exe", "\\\\nas\\shows\\a.prism.json"],
      win,
    ),
    "\\\\nas\\shows\\a.prism.json",
  );
});

test("resolves a relative project against the directory of the launch", () => {
  assert.equal(
    projectPathFromArgv(["Prism Mapper.exe", "..\\Shows\\a.prism.json"], win),
    "C:\\Users\\Ada\\Shows\\a.prism.json",
  );
  assert.equal(
    projectPathFromArgv(["prism", "shows/a.prism.json"], posix),
    "/Users/ada/shows/a.prism.json",
  );
  assert.equal(
    projectPathFromArgv(["prism", "a.prism.json"], {
      ...posix,
      cwd: "/Volumes/Gig Drive",
    }),
    "/Volumes/Gig Drive/a.prism.json",
  );
});

test("ignores switches, the executable and the development app folder", () => {
  assert.equal(
    projectPathFromArgv(
      [
        "electron.exe",
        "--user-data-dir=C:\\Temp\\profile.json",
        "--remote-debugging-port=0",
        "C:\\Shows\\a.prism.json",
      ],
      win,
    ),
    "C:\\Shows\\a.prism.json",
  );
  // `electron .` leaves the app folder in argv[1]; it is never a project.
  assert.equal(
    projectPathFromArgv(
      ["electron", "C:\\repo\\app.json", "C:\\b.prism.json"],
      {
        ...win,
        defaultApp: true,
      },
    ),
    "C:\\b.prism.json",
  );
  assert.equal(projectPathFromArgv(["Prism Mapper.exe"], win), null);
  assert.equal(
    projectPathFromArgv(["Prism Mapper.exe", "--flag", "notes.txt"], win),
    null,
  );
  assert.equal(projectPathFromArgv([], win), null);
});

test("accepts file URLs and any letter case", () => {
  assert.equal(
    projectPathFromArgv(
      ["prism", "file:///Users/ada/My%20Show.prism.json"],
      posix,
    ),
    "/Users/ada/My Show.prism.json",
  );
  assert.equal(
    projectPathFromArgv(["prism", "file:///C:/Shows/a%20b.PRISM.JSON"], win),
    "C:\\Shows\\a b.PRISM.JSON",
  );
  assert.equal(
    projectPathFromArgv(["prism", "file://nas/shows/a.prism.json"], win),
    "\\\\nas\\shows\\a.prism.json",
  );
  assert.equal(
    projectPathFromArgv(["Prism Mapper.exe", "C:\\Shows\\A.PRISM.JSON"], win),
    "C:\\Shows\\A.PRISM.JSON",
  );
  assert.equal(
    projectPathFromArgv(["prism", "file://bad host/x.json"], posix),
    null,
  );
});

function harness(loader) {
  const delivered = [];
  const loaded = [];
  const opener = createProjectOpener({
    load: async (filename) => {
      loaded.push(filename);
      return loader(filename);
    },
    deliver: (payload) => delivered.push(payload),
  });
  return { opener, delivered, loaded };
}

test("holds a request until the editor page can show a project", async () => {
  const { opener, delivered, loaded } = harness(async () => ({
    project: { name: "A" },
    missing: [],
  }));
  await opener.request("/shows/a.prism.json");
  assert.deepEqual(loaded, []);
  assert.equal(opener.hasPending(), true);
  await opener.setReady(true);
  assert.deepEqual(loaded, ["/shows/a.prism.json"]);
  assert.deepEqual(delivered, [
    { project: { name: "A" }, missing: [], path: "/shows/a.prism.json" },
  ]);
  assert.equal(opener.hasPending(), false);
});

test("keeps only the newest request made before the page is ready", async () => {
  const { opener, loaded } = harness(async () => ({
    project: {},
    missing: [],
  }));
  await opener.request("one.prism.json");
  await opener.request("two.prism.json");
  await opener.setReady(true);
  assert.deepEqual(loaded, ["two.prism.json"]);
});

test("loads requests one at a time, in order, once ready", async () => {
  const order = [];
  let release;
  const first = new Promise((resolve) => (release = resolve));
  const { opener, delivered } = harness(async (filename) => {
    order.push(`start ${filename}`);
    if (filename === "one") await first;
    order.push(`end ${filename}`);
    return { project: { name: filename }, missing: [] };
  });
  await opener.setReady(true);
  const a = opener.request("one");
  const b = opener.request("two");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["start one"]);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["start one", "end one", "start two", "end two"]);
  assert.deepEqual(
    delivered.map((item) => item.path),
    ["one", "two"],
  );
});

test("reports a failed load instead of throwing", async () => {
  const { opener, delivered } = harness(async () => {
    throw new Error("Invalid project: file is not valid JSON");
  });
  await opener.setReady(true);
  await opener.request("bad.prism.json");
  assert.deepEqual(delivered, [
    {
      error: "Invalid project: file is not valid JSON",
      path: "bad.prism.json",
    },
  ]);
  const next = harness(async () => ({
    error: "Project files must be smaller than 5 MB",
  }));
  await next.opener.setReady(true);
  await next.opener.request("big.prism.json");
  assert.deepEqual(next.delivered, [
    {
      error: "Project files must be smaller than 5 MB",
      path: "big.prism.json",
    },
  ]);
});

test("a result that finishes while the page is away waits for its return", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { opener, delivered } = harness(async () => {
    await gate;
    return { project: { name: "A" }, missing: [] };
  });
  await opener.setReady(true);
  const pending = opener.request("a.prism.json");
  opener.setReady(false); // the editor page reloaded
  release();
  await pending;
  assert.deepEqual(delivered, []);
  assert.equal(opener.hasPending(), true);
  await opener.setReady(true);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].path, "a.prism.json");
});

test("survives a delivery that throws", async () => {
  const opener = createProjectOpener({
    load: async () => ({ project: {}, missing: [] }),
    deliver: () => {
      throw new Error("window destroyed");
    },
  });
  await opener.setReady(true);
  await opener.request("a.prism.json");
  await opener.request("b.prism.json");
  assert.equal(opener.hasPending(), false);
});
