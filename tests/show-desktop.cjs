// Native show integration uses a disposable profile and never opens projector output.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const executablePath = process.argv[2] && path.resolve(process.argv[2]);
const ownedApps = new WeakSet();
let phase = "starting native show test";
function progress(next) {
  phase = next;
  console.error(`[native-show ${new Date().toISOString()}] ${phase}`);
}
async function bounded(promise, operation, timeout = 15000) {
  const current = phase;
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${current}: ${operation} timed out after ${timeout}ms`,
              ),
            ),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const evaluatePage = (page, predicate, argument, timeout) =>
  bounded(page.evaluate(predicate, argument), "renderer evaluation", timeout);
const evaluateApp = (app, predicate, argument, timeout) =>
  bounded(app.evaluate(predicate, argument), "native evaluation", timeout);
const button = (page, name) => page.getByRole("button", { name, exact: true });
const panel = (page) =>
  page.getByRole("region", { name: "Scenes and timeline", exact: true });
const read = (page) => evaluatePage(page, () => window.prism.getProject());
const recent = (page) =>
  page.getByRole("navigation", { name: "Recent show projects", exact: true });

// Await native IPC probes explicitly before asserting that state has settled.
async function wait(page, predicate, argument) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (
      await evaluatePage(
        page,
        predicate,
        argument,
        Math.max(1, deadline - Date.now()),
      )
    )
      return;
    await page.waitForTimeout(40);
  }
  throw new Error(
    `Native state did not settle: ${JSON.stringify(await read(page))}`,
  );
}

async function openDialog(app, files) {
  await evaluateApp(
    app,
    ({ dialog }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    },
    files,
  );
}
async function saveDialog(app, filePath) {
  await evaluateApp(
    app,
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    },
    filePath,
  );
}
async function range(page, value) {
  await bounded(
    page
      .getByRole("slider", { name: "Show playhead", exact: true })
      .evaluate((element, value) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }, value),
    "playhead input evaluation",
  );
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
  await evaluatePage(page, () => document.activeElement?.blur());
  await page.keyboard.press("b");
  await wait(page, async () => !(await window.prism.getProject()).blackout);
}
async function pixel(page, expected) {
  return bounded(
    page.evaluate(async (expected) => {
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
    }, expected),
    `GPU MP4 color check ${expected.join(",")}`,
    15000,
  );
}
async function closeOwnedApp(app) {
  if (!ownedApps.has(app)) return;
  try {
    await bounded(app.close(), "closing disposable Electron app", 15000);
  } catch (error) {
    // This ChildProcess belongs to electron.launch above. Never discover or
    // terminate processes by application name, user profile or executable path.
    const child = app.process();
    if (child && child.exitCode === null && child.signalCode === null) {
      console.error(
        `[native-show] ${error.message}; terminating test child PID ${child.pid}`,
      );
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await bounded(exited, "waiting for test child exit", 5000);
    }
    throw error;
  } finally {
    ownedApps.delete(app);
  }
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
  ownedApps.add(app);
  try {
    progress("checking isolated native profile");
    assert.equal(
      await evaluateApp(app, ({ app }) => app.getPath("userData")),
      path.join(directory, "profile"),
    );
    progress("waiting for editor window and controls");
    const page = await bounded(
      app.firstWindow({ timeout: 15000 }),
      "first native editor window",
    );
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await button(page, "Scenes and timeline").waitFor();
    // CI screens can put the native editor below the desktop breakpoint. Exercise
    // the compact header deliberately instead of depending on the host display.
    progress(
      "waiting for production editor visibility and resizing compact header",
    );
    const fitted = await evaluateApp(app, async ({ BrowserWindow, screen }) => {
      const editor = BrowserWindow.getAllWindows()[0];
      if (!editor.isVisible())
        await new Promise((resolve) => editor.once("show", resolve));
      if (editor.isMaximized()) editor.unmaximize();
      const bounds = editor.getBounds();
      const content = editor.getContentBounds();
      const work = screen.getDisplayMatching(bounds).workArea;
      const frame = {
        width: Math.max(0, bounds.width - content.width),
        height: Math.max(0, bounds.height - content.height),
      };
      const target = {
        width: Math.min(1024, work.width - frame.width - 24),
        height: Math.min(700, work.height - frame.height - 24),
      };
      editor.setMinimumSize(320, 400);
      editor.setContentSize(target.width, target.height);
      return { target, work, frame };
    });
    assert.ok(fitted.target.width >= 320 && fitted.target.height >= 400);
    console.error(
      `[native-show] fitted compact viewport: ${JSON.stringify(fitted)}`,
    );
    await wait(
      page,
      ({ width, height }) =>
        innerWidth === width &&
        innerHeight === height &&
        document.querySelector(".app-shell")?.dataset.layout === "compact",
      fitted.target,
    );
    const viewport = await evaluatePage(page, () => ({
      width: innerWidth,
      height: innerHeight,
    }));
    assert.deepEqual(viewport, fitted.target);
    const header = await evaluatePage(page, () => {
      const name = document
        .querySelector('[aria-label="Project name"]')
        .getBoundingClientRect();
      return Array.from(
        document.querySelectorAll(".header-actions button"),
      ).map((button) => {
        const bounds = button.getBoundingClientRect();
        return {
          name: button.getAttribute("aria-label") || button.textContent.trim(),
          overlapsName:
            Math.min(name.right, bounds.right) >
              Math.max(name.left, bounds.left) &&
            Math.min(name.bottom, bounds.bottom) >
              Math.max(name.top, bounds.top),
          receivesPointer:
            document
              .elementFromPoint(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2,
              )
              ?.closest("button") === button,
        };
      });
    });
    for (const action of header) {
      assert.equal(
        action.overlapsName,
        false,
        `${action.name} does not overlap the project name`,
      );
      assert.equal(
        action.receivesPointer,
        true,
        `${action.name} receives pointer clicks`,
      );
    }
    await button(page, "Scenes and timeline").click();
    return { app, page, viewport };
  } catch (error) {
    await closeOwnedApp(app).catch((cleanupError) =>
      console.error(
        `[native-show] launch cleanup failed: ${cleanupError.message}`,
      ),
    );
    throw error;
  }
}

(async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-native-show-"),
  );
  const showsDirectory = path.join(directory, "shows");
  const mediaDirectory = path.join(showsDirectory, "media");
  const errors = [];
  let app;
  let page;
  let failure;
  try {
    progress("preparing original local MP4 fixtures");
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
    progress("launching clean disposable editor");
    let session = await launch(directory, errors);
    app = session.app;
    page = session.page;
    progress("importing local MP4 sequence and checking metadata");
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
    progress("seeking warm MP4 and checking yellow GPU pixel");
    await range(page, 1.4);
    const warmPixel = await pixel(page, [255, 255, 0]);
    progress("seeking blue MP4 and checking blue GPU pixel");
    await range(page, 2.4);
    const bluePixel = await pixel(page, [0, 0, 255]);
    const liveTransport = (await read(page)).transport;
    assert.equal(liveTransport.active, true);
    assert.equal(liveTransport.playing, false);
    progress("checking native MP4 protocol range response");
    const protocolProbe = await evaluatePage(
      page,
      async (url) => {
        const response = await fetch(url, { headers: { Range: "bytes=0-15" } });
        return {
          status: response.status,
          range: response.headers.get("Content-Range"),
          bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        };
      },
      imported.media[0].url,
    );
    assert.equal(protocolProbe.status, 206);
    assert.match(protocolProbe.range, /^bytes 0-15\/\d+$/);
    assert.equal(
      Buffer.from(protocolProbe.bytes).subarray(4, 8).toString(),
      "ftyp",
      "native media protocol serves a real local MP4",
    );

    // Keep real short-MP4 metadata and seek checks above. Longer show cues let
    // Save/Recent UI checks run under software graphics without racing a 5s end.
    progress("editing show cue durations for save and recent workflow");
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
      progress(`saving show ${names[index]}`);
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
      (await evaluatePage(page, () => window.prism.getRecentProjects())).length,
      4,
    );
    for (let index = 0; index < names.length; index++) {
      progress(`reopening show ${names[index]} through native Open`);
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
    progress("switching recent shows during active playback");
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
    progress("closing disposable app before restart");
    await closeOwnedApp(app);
    app = null;

    progress("restarting disposable app and checking persistent recent shows");
    session = await launch(directory, errors);
    app = session.app;
    page = session.page;
    progress("reading persistent recent shows after restart");
    const persistedRecent = await evaluatePage(page, () =>
      window.prism.getRecentProjects(),
    );
    assert.deepEqual(
      new Set(persistedRecent.map((entry) => entry.name)),
      new Set(names),
    );
    assert.ok(persistedRecent.every((entry) => projects.includes(entry.path)));
    progress("opening saved Band intro through recent projects");
    await recent(page)
      .getByRole("button", { name: "Band intro", exact: true })
      .click();
    await opened(page, "Band intro");
    assert.equal((await read(page)).playing, false);
    await unblackout(page);
    progress("seeking reopened MP4 and checking blue GPU pixel");
    await range(page, 120.4);
    await pixel(page, [0, 0, 255]);
    await panel(page)
      .getByRole("button", { name: "Stop show", exact: true })
      .click();
    const good = await read(page);
    progress("checking missing recent project preserves current show");
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
    progress("closing final disposable app");
    await closeOwnedApp(app);
    app = null;
    progress("native show assertions passed");
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
          compactHeaderViewport: session.viewport,
          projectorWindowsOpened: 0,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    failure = error;
    console.error(
      `[native-show] failure during ${phase}: ${error.stack || error}`,
    );
    if (app) {
      const diagnostics = await Promise.allSettled([
        evaluateApp(
          app,
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((window) => ({
              visible: window.isVisible(),
              minimized: window.isMinimized(),
              focused: window.isFocused(),
              contentBounds: window.getContentBounds(),
            })),
          undefined,
          3000,
        ),
        evaluatePage(
          page,
          () => ({
            visibility: document.visibilityState,
            hidden: document.hidden,
            viewport: { width: innerWidth, height: innerHeight },
            activeElement: document.activeElement?.getAttribute("aria-label"),
            rendererError:
              document.querySelector(".stage canvas")?.dataset.renderError,
          }),
          undefined,
          3000,
        ),
      ]);
      console.error(
        `[native-show] failure diagnostics: ${JSON.stringify(diagnostics)}`,
      );
    }
    throw error;
  } finally {
    try {
      if (app) await closeOwnedApp(app);
    } catch (cleanupError) {
      if (!failure) throw cleanupError;
      console.error(`[native-show] cleanup failed: ${cleanupError.message}`);
    } finally {
      await bounded(
        fs.rm(directory, { recursive: true, force: true }),
        "removing disposable test profile",
        10000,
      );
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
