// Native show integration uses a disposable profile and never opens projector output.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const executablePath = process.argv[2] && path.resolve(process.argv[2]);
const button = (page, name) => page.getByRole("button", { name, exact: true });
const panel = (page) =>
  page.getByRole("region", { name: "Scenes and timeline", exact: true });
const read = (page) => page.evaluate(() => window.prism.getProject());
const recent = (page) =>
  page.getByRole("navigation", { name: "Recent show projects", exact: true });

// Await native IPC probes explicitly before asserting that state has settled.
async function wait(page, predicate, argument) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
    await page.waitForTimeout(40);
  }
  throw new Error(
    `Native state did not settle: ${JSON.stringify(await read(page))}`,
  );
}

async function openDialog(app, files) {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, files);
}
async function saveDialog(app, filePath) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filePath);
}
async function range(page, value) {
  await page
    .getByRole("slider", { name: "Show playhead", exact: true })
    .evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(element, String(value));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
}
async function duration(page, index, seconds) {
  const input = panel(page)
    .getByRole("textbox", {
      name: "Clip length, minutes and seconds",
      exact: true,
    })
    .nth(index);
  await input.fill(String(seconds));
  await input.press("Enter");
}
async function opened(page, name) {
  await wait(
    page,
    async (name) => {
      const project = await window.prism.getProject();
      const nameInput = document.querySelector('[aria-label="Project name"]');
      const playhead = document.querySelector('[aria-label="Show playhead"]');
      return (
        project?.name === name &&
        !project.transport &&
        !project.playing &&
        nameInput?.value === name &&
        playhead?.max === "360"
      );
    },
    name,
  );
}
async function unblackout(page) {
  if (!(await read(page)).blackout) return;
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("b");
  await wait(page, async () => !(await window.prism.getProject()).blackout);
}
async function pixel(page, expected) {
  return page.evaluate(async (expected) => {
    const deadline = performance.now() + 12000;
    let latest;
    while (performance.now() < deadline) {
      latest = await new Promise((resolve) =>
        requestAnimationFrame(() => {
          const canvas = document.querySelector(".stage canvas");
          const gl = canvas.getContext("webgl");
          const rgba = new Uint8Array(4);
          gl.readPixels(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            rgba,
          );
          resolve(Array.from(rgba));
        }),
      );
      // Default master brightness is .65; distinguish decoded swatches from black.
      if (
        expected.every(
          (channel, index) => Math.abs(latest[index] - channel * 0.65) < 16,
        )
      )
        return latest;
    }
    throw new Error(
      `Expected MP4 color ${expected}; got ${latest}. Renderer: ${document.querySelector(".stage canvas").dataset.renderError || "no reported error"}`,
    );
  }, expected);
}
async function launch(directory, errors) {
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ["."]),
      `--user-data-dir=${path.join(directory, "profile")}`,
      ...(process.env.CI
        ? [
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ]
        : []),
    ],
    cwd: root,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
    timeout: 30000,
  });

  assert.equal(
    await app.evaluate(({ app }) => app.getPath("userData")),
    path.join(directory, "profile"),
  );
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await button(page, "Scenes and timeline").waitFor();
  await button(page, "Scenes and timeline").click();
  return { app, page };
}

(async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-native-show-"),
  );
  const showsDirectory = path.join(directory, "shows");
  const mediaDirectory = path.join(showsDirectory, "media");
  const errors = [];
  let app;
  try {
    await fs.mkdir(mediaDirectory, { recursive: true });
    const mediaPaths = [];
    for (const name of ["warm", "blue", "green"]) {
      const target = path.join(mediaDirectory, `timeline-${name}.mp4`);
      await fs.copyFile(
        path.join(__dirname, "fixtures", `timeline-${name}.mp4`),
        target,
      );
      mediaPaths.push(target);
    }
    let session = await launch(directory, errors);
    app = session.app;
    let page = session.page;
    await openDialog(app, mediaPaths);
    await panel(page)
      .getByRole("button", { name: "Add videos to timeline", exact: true })
      .click();
    await wait(
      page,
      async () => (await window.prism.getProject())?.show?.cues.length === 3,
    );
    const imported = await read(page);
    assert.equal(imported.version, 3, JSON.stringify(imported));
    assert.deepEqual(
      imported.show.scenes.map((scene) => scene.name),
      ["timeline-warm", "timeline-blue", "timeline-green"],
    );
    assert.deepEqual(
      imported.show.cues.map((cue) => cue.duration),
      [2, 2, 1],
    );
    assert.ok(
      imported.media.every((media) =>
        /^media:\/\/local\/[a-f0-9-]+$/.test(media.url),
      ),
    );
    assert.deepEqual(
      imported.media.map((media) => media.path),
      mediaPaths,
    );
    await range(page, 1.4);
    const warmPixel = await pixel(page, [255, 255, 0]);
    await range(page, 2.4);
    const bluePixel = await pixel(page, [0, 0, 255]);
    const liveTransport = (await read(page)).transport;
    assert.equal(liveTransport.active, true);
    assert.equal(liveTransport.playing, false);
    const protocolProbe = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { Range: "bytes=0-15" } });
      return {
        status: response.status,
        range: response.headers.get("Content-Range"),
        bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
      };
    }, imported.media[0].url);
    assert.equal(protocolProbe.status, 206);
    assert.match(protocolProbe.range, /^bytes 0-15\/\d+$/);
    assert.equal(
      Buffer.from(protocolProbe.bytes).subarray(4, 8).toString(),
      "ftyp",
      "native media protocol serves a real local MP4",
    );

    // Keep real short-MP4 metadata and seek checks above. Longer show cues let
    // Save/Recent UI checks run under software graphics without racing a 5s end.
    for (let index = 0; index < imported.show.cues.length; index++)
      await duration(page, index, 120);
    await wait(page, async () =>
      (await window.prism.getProject()).show.cues.every(
        (cue) => cue.duration === 120,
      ),
    );
    const expectedShow = (await read(page)).show;
    assert.deepEqual(
      expectedShow.cues.map((cue) => cue.duration),
      [120, 120, 120],
    );

    const names = ["Band intro", "Pre-show", "Set 1", "Set 2"];
    const projects = names.map((name) =>
      path.join(showsDirectory, `${name}.prism.json`),
    );
    for (let index = 0; index < names.length; index++) {
      // Notifications can overlap the toolbar on narrower CI desktops.
      await page.locator(".toast").waitFor({ state: "hidden" });
      await page
        .getByRole("textbox", { name: "Project name", exact: true })
        .fill(names[index]);
      await panel(page)
        .getByRole("button", { name: "Play show", exact: true })
        .click();
      await saveDialog(app, projects[index]);
      await panel(page)
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      await wait(
        page,
        async ([name, destination]) =>
          (await window.prism.getRecentProjects()).some(
            (entry) => entry.name === name && entry.path === destination,
          ),
        [names[index], projects[index]],
      );
      await wait(page, () => {
        const save = Array.from(
          document.querySelectorAll(".show-heading-actions button"),
        ).find((button) => button.textContent.trim() === "Save project");
        return save && !save.disabled;
      });
      const saved = JSON.parse(await fs.readFile(projects[index], "utf8"));
      assert.equal(saved.version, 3);
      assert.equal(saved.name, names[index]);
      assert.equal(saved.transport, undefined);
      assert.deepEqual(saved.show, expectedShow);
      assert.deepEqual(
        saved.media.map((media) => media.path),
        [
          "media/timeline-warm.mp4",
          "media/timeline-blue.mp4",
          "media/timeline-green.mp4",
        ],
      );
      assert.ok(saved.media.every((media) => media.url === undefined));
      await panel(page)
        .getByRole("button", { name: "Pause show", exact: true })
        .click();
    }
    assert.equal(
      (await page.evaluate(() => window.prism.getRecentProjects())).length,
      4,
    );
    for (let index = 0; index < names.length; index++) {
      await page.locator(".toast").waitFor({ state: "hidden" });
      await openDialog(app, [projects[index]]);
      await button(page, "Open").click();
      await opened(page, names[index]);
      const reopened = await read(page);
      assert.equal(
        reopened.playing,
        false,
        "opening a saved show never autoplays it",
      );
      assert.equal(
        reopened.blackout,
        imported.blackout,
        "native show loading preserves the saved blackout setting",
      );
      assert.deepEqual(reopened.show, expectedShow);
      assert.ok(
        reopened.media.every(
          (media) => media.url && path.isAbsolute(media.path),
        ),
      );
    }

    // Quick-switch during playback and leave the prior session clock behind.
    await recent(page)
      .getByRole("button", { name: "Set 1", exact: true })
      .click();
    await opened(page, "Set 1");
    await unblackout(page);
    await panel(page)
      .getByRole("button", { name: "Play show", exact: true })
      .click();
    await wait(
      page,
      async () => (await window.prism.getProject())?.transport?.playing,
    );
    await recent(page)
      .getByRole("button", { name: "Pre-show", exact: true })
      .click();
    await opened(page, "Pre-show");
    assert.equal(
      await panel(page)
        .getByRole("button", { name: "Stop show", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      (await app.windows()).length,
      1,
      "native checks never open a projector window",
    );
    await app.close();
    app = null;

    session = await launch(directory, errors);
    app = session.app;
    page = session.page;
    const persistedRecent = await page.evaluate(() =>
      window.prism.getRecentProjects(),
    );
    assert.deepEqual(
      new Set(persistedRecent.map((entry) => entry.name)),
      new Set(names),
    );
    assert.ok(persistedRecent.every((entry) => projects.includes(entry.path)));
    await recent(page)
      .getByRole("button", { name: "Band intro", exact: true })
      .click();
    await opened(page, "Band intro");
    assert.equal((await read(page)).playing, false);
    await unblackout(page);
    await range(page, 120.4);
    await pixel(page, [0, 0, 255]);
    await panel(page)
      .getByRole("button", { name: "Stop show", exact: true })
      .click();
    const good = await read(page);
    await fs.unlink(projects[3]);
    await recent(page)
      .getByRole("button", { name: "Set 2", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "This recent project is unavailable" })
      .waitFor();
    const afterMissing = await read(page);
    assert.equal(afterMissing.name, good.name);
    assert.deepEqual(
      afterMissing.show,
      good.show,
      "a missing recent project does not discard the good open show",
    );
    assert.equal((await app.windows()).length, 1);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          passed: true,
          nativeMp4Protocol: protocolProbe,
          warmPixel,
          bluePixel,
          savedShows: names,
          recentProjectsSurviveRestart: true,
          missingProjectPreservesCurrent: true,
          projectorWindowsOpened: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    if (app) await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
