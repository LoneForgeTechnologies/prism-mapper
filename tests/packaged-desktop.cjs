// Desktop behaviour of the actual distributed app (or an installed copy of it):
// opening a project from the operating system, one instance at a time, and the
// size of the editor window. Uses isolated profiles and never opens a projector.
//
//   node tests/packaged-desktop.cjs <executable>
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { annotate } = require("./ci.cjs");

const executable = process.argv[2] && path.resolve(process.argv[2]);
const gpu = process.env.CI
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : [];

function project(name) {
  return {
    version: 2,
    name,
    width: 1920,
    height: 1080,
    surfaces: [
      {
        id: "only",
        name: "Only surface",
        corners: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
        source: "grid",
        visible: true,
        locked: false,
        opacity: 1,
        color: "#ffffff",
      },
    ],
    media: [],
    brightness: 0.5,
    blackout: false,
    playing: true,
  };
}

async function launch(profile, args = [], extra = []) {
  const app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${profile}`, ...gpu, ...extra, ...args],
    timeout: 45000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page
    .getByRole("button", { name: "Save project", exact: true })
    .waitFor();
  return { app, page };
}

// Subscribing is what tells the app the page can show an opened project.
async function listen(page) {
  await page.evaluate(() => {
    window.__opened = [];
    window.__stop = window.prism.onProjectOpened((result) =>
      window.__opened.push(result),
    );
  });
}
const opened = (page) => page.evaluate(() => window.__opened);
const waitForOpened = (page, count) =>
  page.waitForFunction((count) => window.__opened.length >= count, count);

// A second launch of the program, as Explorer starts it for a double-clicked
// file. It must hand over to the running copy and exit by itself.
function secondLaunch(profile, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [`--user-data-dir=${profile}`, ...gpu, ...args],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The second launch did not exit by itself"));
    }, 45000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function openedProjects(directory) {
  const profile = path.join(directory, "profile-instances");
  const fileA = path.join(directory, "from second launch.prism.json");
  const fileB = path.join(directory, "from open-file.prism.json");
  const fileC = path.join(directory, "while away.prism.json");
  const broken = path.join(directory, "broken.prism.json");
  await fs.writeFile(fileA, JSON.stringify(project("Second launch")));
  await fs.writeFile(fileB, JSON.stringify(project("macOS open-file")));
  await fs.writeFile(fileC, JSON.stringify(project("Opened while away")));
  await fs.writeFile(broken, "{ not json");
  const { app, page } = await launch(profile);
  try {
    await listen(page);
    assert.equal(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
      1,
    );

    // A second launch with a project hands it to this copy and exits.
    assert.equal(await secondLaunch(profile, [fileA]), 0);
    await waitForOpened(page, 1);
    let events = await opened(page);
    assert.equal(events[0].path, fileA);
    assert.equal(events[0].error, undefined);
    assert.equal(events[0].project.name, "Second launch");
    assert.deepEqual(events[0].missing, []);
    assert.equal(
      (await page.evaluate(() => window.prism.getProject())).name,
      "Second launch",
    );

    // A second launch with nothing to open only brings this copy forward.
    assert.equal(await secondLaunch(profile, []), 0);
    assert.equal(
      await secondLaunch(profile, ["--some-switch", "notes.txt"]),
      0,
    );

    // The same checks as Open: a broken file is reported, not opened.
    assert.equal(await secondLaunch(profile, [broken]), 0);
    await waitForOpened(page, 2);
    events = await opened(page);
    assert.equal(events.length, 2);
    assert.match(events[1].error, /not valid JSON/);
    assert.equal(events[1].path, broken);
    assert.equal(
      (await page.evaluate(() => window.prism.getProject())).name,
      "Second launch",
    );

    // macOS delivers a double-clicked file as open-file, possibly very early.
    await app.evaluate(({ app }, file) => {
      app.emit("open-file", { preventDefault() {} }, file);
    }, fileB);
    await waitForOpened(page, 3);
    events = await opened(page);
    assert.equal(events[2].project.name, "macOS open-file");
    assert.equal(events[2].path, fileB);

    // While the page is not listening the project waits, then arrives.
    await page.evaluate(() => window.__stop());
    assert.equal(await secondLaunch(profile, [fileC]), 0);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal((await opened(page)).length, 3);
    await page.evaluate(() => {
      window.__stop = window.prism.onProjectOpened((result) =>
        window.__opened.push(result),
      );
    });
    await waitForOpened(page, 4);
    events = await opened(page);
    assert.equal(events[3].project.name, "Opened while away");

    // Still exactly one editor window after all of that.
    assert.equal(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
      1,
    );
    return "second launch, open-file, errors and a page that was away";
  } finally {
    await app.close();
  }
}

async function startedWithProject(directory) {
  const profile = path.join(directory, "profile-cold");
  const file = path.join(directory, "cold start.prism.json");
  await fs.writeFile(file, JSON.stringify(project("Cold start")));
  const { app, page } = await launch(profile, [file]);
  try {
    // Nothing is shown before the page asks; the project is waiting.
    await listen(page);
    await waitForOpened(page, 1);
    const [event] = await opened(page);
    assert.equal(event.path, file);
    assert.equal(event.project.name, "Cold start");
    assert.equal(
      (await page.evaluate(() => window.prism.getProject())).name,
      "Cold start",
    );
    return "project named on the command line";
  } finally {
    await app.close();
  }
}

// The editor can be made as small as its minimum. There the page has the room
// it needs (src/style.css .app-shell: 1050 x 700) when the screen can hold that,
// and otherwise the window still fits the screen. Checked at the scaling
// Windows laptops use. FRAME is the allowance electron/window-size.cjs makes for
// the title bar and borders.
async function windowFits(directory, scale) {
  const { app, page } = await launch(
    path.join(directory, `profile-size-${scale}`),
    [],
    scale === 1 ? [] : [`--force-device-scale-factor=${scale}`],
  );
  try {
    const native = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const work = screen.getPrimaryDisplay().workArea;
      const start = {
        bounds: win.getBounds(),
        maximized: win.isMaximized(),
      };
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(200, 200);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        work,
        start,
        smallest: win.getBounds(),
        content: win.getContentSize(),
      };
    });
    const view = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const { work, start, smallest } = native;
    const room = { width: work.width - 24, height: work.height - 72 };
    assert.ok(
      view.width >= Math.min(1050, room.width),
      `page is ${view.width} wide at its smallest on ${work.width}x${work.height}`,
    );
    assert.ok(
      view.height >= Math.min(700, room.height),
      `page is ${view.height} tall at its smallest on ${work.width}x${work.height}`,
    );
    // Neither the starting window nor the smallest one hangs off the screen
    // (a Windows frame has invisible borders of up to 8 pixels).
    for (const [name, bounds] of [
      ["starting", start.bounds],
      ["smallest", smallest],
    ])
      assert.ok(
        bounds.width <= work.width + 16 && bounds.height <= work.height + 16,
        `${name} window ${bounds.width}x${bounds.height} on a ${work.width}x${work.height} work area`,
      );
    return `scale ${scale}: ${work.width}x${work.height} available, started ${start.bounds.width}x${start.bounds.height}${start.maximized ? " maximised" : ""}, smallest ${smallest.width}x${smallest.height} with a ${view.width}x${view.height} page`;
  } finally {
    await app.close();
  }
}

// The macOS bundle lists Prism Mapper under Finder's "Open With" for JSON files
// (a project is a JSON file). The declaration is read back from the packaged
// Info.plist, which also proves the signed bundle's property list is valid.
async function macBundle() {
  const { macDocumentTypes } = await import("../scripts/package-release.mjs");
  const plist = path.resolve(path.dirname(executable), "..", "Info.plist");
  const info = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], {
      encoding: "utf8",
    }),
  );
  assert.deepEqual(info.CFBundleDocumentTypes, macDocumentTypes);
  assert.equal(info.CFBundleIdentifier, "org.prismmapper.desktop");
  return `Info.plist declares ${macDocumentTypes[0].CFBundleTypeName} (${macDocumentTypes[0].LSHandlerRank}) for .json`;
}

(async () => {
  if (!executable)
    throw new Error(
      "Pass the packaged executable path: node tests/packaged-desktop.cjs <executable>",
    );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prism-desktop-"));
  const lines = [];
  try {
    if (process.platform === "darwin") lines.push(await macBundle());
    lines.push(await openedProjects(directory));
    lines.push(await startedWithProject(directory));
    for (const scale of [1, 1.25, 1.5])
      lines.push(await windowFits(directory, scale));
    console.log(
      `PASS packaged desktop behaviour on ${process.platform}:\n  ${lines.join("\n  ")}`,
    );
    annotate(
      "notice",
      `Desktop behaviour on ${process.platform}`,
      lines.join("\n"),
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  annotate(
    "error",
    `Desktop behaviour on ${process.platform} failed`,
    error.stack || String(error),
  );
  process.exitCode = 1;
});
