const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { validateProject } = require("../electron/project.cjs");

const root = path.resolve(__dirname, "..");
const examplePath = path.join(root, "examples/architectural-study.prism.json");
async function chooseOpen(app, filename) {
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filename],
    });
  }, filename);
}
async function chooseSave(app, filename) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filename);
}

(async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-advanced-native-"),
  );
  const profile = path.join(directory, "profile");
  const savedPath = path.join(directory, "advanced.prism.json");
  const legacyPath = path.join(directory, "legacy.prism.json");
  let app;
  try {
    const example = validateProject(
      JSON.parse(await fs.readFile(examplePath, "utf8")),
    );
    const legacy = {
      version: 1,
      name: "Legacy perspective room",
      width: 1920,
      height: 1080,
      surfaces: [
        {
          id: "legacy-wall",
          name: "Perspective wall",
          corners: [
            { x: 0.2, y: 0.1 },
            { x: 0.8, y: 0.2 },
            { x: 0.95, y: 0.9 },
            { x: 0.05, y: 0.8 },
          ],
          source: "ocean",
          visible: true,
          locked: false,
          opacity: 0.8,
          color: "#a8f3cb",
          speed: 0.5,
          detail: 1.5,
        },
      ],
      media: [],
      brightness: 0.65,
      blackout: false,
      playing: true,
    };
    await fs.writeFile(legacyPath, JSON.stringify(legacy));
    app = await electron.launch({
      args: [".", `--user-data-dir=${profile}`],
      cwd: root,
      timeout: 30000,
    });
    const page = await app.firstWindow();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.getByRole("button", { name: "Open", exact: true }).waitFor();
    assert.equal(
      await app.evaluate(({ app }) => app.getPath("userData")),
      profile,
    );
    const read = () => page.evaluate(() => window.prism.getProject());
    const readDraft = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("prism-draft")));
    const readOverlay = () => page.evaluate(() => window.prism.getOverlay());
    const settle = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    const open = async (filename, name) => {
      await chooseOpen(app, filename);
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await page.waitForFunction(
        async (name) => (await window.prism.getProject())?.name === name,
        name,
      );
      await page.waitForFunction(
        (name) =>
          document.querySelector('input[aria-label="Project name"]').value ===
          name,
        name,
      );
      await settle();
    };
    await open(examplePath, example.name);
    assert.deepEqual(await read(), example);
    assert.deepEqual(await readDraft(), example);
    console.log(
      "PASS native Open: architectural example preserves concave/circular outlines, masks and content fields",
    );

    // Make advanced settings non-default, then prove the native file path keeps them exactly.
    const advanced = structuredClone(example);
    advanced.name = "Native advanced round trip";
    Object.assign(advanced.surfaces[0], {
      blendMode: "screen",
      feather: 9,
      opacity: 0.72,
      content: { rotation: 38, scale: 1.6, offsetX: -0.17, offsetY: 0.2 },
    });
    Object.assign(advanced.surfaces[1], {
      blendMode: "add",
      locked: true,
      edgeWidth: 21,
    });
    Object.assign(advanced.surfaces[4], {
      kind: "mask",
      feather: 5,
      opacity: 0.85,
    });
    const advancedInputPath = path.join(directory, "advanced-input.prism.json");
    await fs.writeFile(advancedInputPath, JSON.stringify(advanced));
    await open(advancedInputPath, advanced.name);
    await page
      .getByRole("button", { name: "Show projector guides", exact: true })
      .click();
    await page.waitForFunction(
      async () => (await window.prism.getOverlay())?.closed === true,
    );
    await page
      .getByRole("button", { name: "Solo L-shaped wall", exact: true })
      .click();
    await page.waitForFunction(
      async () =>
        (await window.prism.getProject()).surfaces.find((s) => s.id === "panel")
          .visible === false,
    );
    assert.equal(
      (await readDraft()).surfaces.find((s) => s.id === "panel").visible,
      true,
    );
    await chooseSave(app, savedPath);
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Project saved" })
      .waitFor();
    const saved = JSON.parse(await fs.readFile(savedPath, "utf8"));
    assert.deepEqual(saved, advanced);
    for (const key of ["overlay", "guides", "solo", "draft", "selected"])
      assert.equal(Object.hasOwn(saved, key), false);
    await page
      .getByRole("button", { name: "Show all layers", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Show projector guides", exact: true })
      .click();
    await open(legacyPath, legacy.name);
    assert.deepEqual(await read(), { ...legacy, version: 2 });
    assert.equal((await read()).surfaces[0].polygon, undefined);
    await open(savedPath, advanced.name);
    assert.deepEqual(await read(), advanced);
    console.log(
      "PASS native Save/Open: all advanced fields round-trip; solo and guides are transient; version 1 preserves its perspective geometry while upgrading to version 2",
    );

    const draftGuide = {
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.6, y: 0.2 },
      ],
      closed: false,
      cursor: { x: 0.65, y: 0.6 },
    };
    await page.evaluate(
      (overlay) => window.prism.updateOverlay(overlay),
      draftGuide,
    );
    assert.deepEqual(await readOverlay(), draftGuide);
    const invalidGuides = [
      {},
      [],
      "invalid",
      { points: null, closed: false },
      { points: draftGuide.points, closed: "false" },
      {
        points: Array.from({ length: 65 }, () => ({ x: 0.2, y: 0.2 })),
        closed: false,
      },
      { points: [{ x: NaN, y: 0.2 }], closed: false },
      { points: [{ x: Infinity, y: 0.2 }], closed: false },
      { points: [{ x: -0.1, y: 0.2 }], closed: false },
      { points: [{ x: 0.1, y: 1.2 }], closed: false },
      { points: draftGuide.points, closed: false, cursor: { x: 2, y: 0.4 } },
    ];
    for (const invalid of invalidGuides) {
      await page.evaluate(
        (overlay) => window.prism.updateOverlay(overlay),
        invalid,
      );
      assert.deepEqual(await readOverlay(), draftGuide);
    }
    await page.evaluate(
      (overlay) =>
        window.prism.updateOverlay({
          ...overlay,
          arbitrary: "discarded",
          points: overlay.points.map((p) => ({ ...p, arbitrary: "discarded" })),
        }),
      draftGuide,
    );
    assert.deepEqual(await readOverlay(), draftGuide);
    await page.evaluate(() => window.prism.updateOverlay(null));
    assert.equal(await readOverlay(), null);
    console.log(
      "PASS overlay IPC: open drafts, cursor, null clearing and strict point bounds; malformed updates retain the previous valid guide",
    );

    const displays = await page.evaluate(() => window.prism.getDisplays());
    const internal = displays.find((d) => d.primary && d.internal);
    assert.ok(
      internal,
      "This test requires a primary internal display and will never substitute the external projector.",
    );
    // Hide the new output until it has been moved out of fullscreen into a small internal-display test window.
    await app.evaluate(({ app }) => {
      app.on("browser-window-created", (_event, window) => {
        if (window.getTitle() === "Prism Mapper — Output") window.setOpacity(0);
      });
    });
    const outputPromise = app.waitForEvent("window");
    const outputStatus = await page.evaluate(
      (displayId) => window.prism.openOutput(displayId),
      internal.id,
    );
    assert.equal(outputStatus.open, true);
    assert.equal(outputStatus.displayId, internal.id);
    const output = await outputPromise;
    output.setDefaultTimeout(15000);
    output.on("pageerror", (error) => pageErrors.push(error.message));
    await output.waitForSelector(".projector canvas");
    await app.evaluate(({ BrowserWindow }, bounds) => {
      const window = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("#output"),
      );
      window.setSimpleFullScreen(false);
      window.setFullScreen(false);
      window.setResizable(true);
      window.setMovable(true);
      window.setBounds({
        x: bounds.x + 40,
        y: bounds.y + 80,
        width: 640,
        height: 430,
      });
      window.setOpacity(1);
    }, internal.bounds);
    assert.equal(await output.locator("button").count(), 0);
    assert.deepEqual(
      await output.evaluate(() => window.prism.getProject()),
      advanced,
    );
    assert.equal(await output.evaluate(() => window.prism.getOverlay()), null);

    await page
      .getByRole("button", { name: "Show projector guides", exact: true })
      .click();
    await output.waitForSelector(".projector-guides polygon");
    const closedGuide = await readOverlay();
    assert.equal(closedGuide.closed, true);
    assert.deepEqual(closedGuide.points, advanced.surfaces[0].polygon);
    assert.equal(await output.locator(".projector-guides circle").count(), 6);
    const guidePoints = advanced.surfaces[0].polygon
      .map((p) => `${p.x * advanced.width},${p.y * advanced.height}`)
      .join(" ");
    assert.equal(
      await output.locator(".projector-guides polygon").getAttribute("points"),
      guidePoints,
    );
    const aligned = await output.evaluate(() => {
      const a = document.querySelector("canvas").getBoundingClientRect(),
        b = document.querySelector(".projector-guides").getBoundingClientRect();
      return {
        canvas: { x: a.x, y: a.y, width: a.width, height: a.height },
        guides: { x: b.x, y: b.y, width: b.width, height: b.height },
        viewBox: document
          .querySelector(".projector-guides")
          .getAttribute("viewBox"),
      };
    });
    assert.deepEqual(aligned.canvas, aligned.guides);
    assert.equal(aligned.viewBox, "0 0 1920 1080");

    await page.evaluate(
      (overlay) => window.prism.updateOverlay(overlay),
      draftGuide,
    );
    await output.waitForSelector(".projector-guides polyline");
    assert.equal(await output.locator(".projector-guides circle").count(), 2);
    assert.equal(
      await output.locator(".projector-guides polyline").getAttribute("points"),
      [...draftGuide.points, draftGuide.cursor]
        .map((p) => `${p.x * advanced.width},${p.y * advanced.height}`)
        .join(" "),
    );
    await page.getByRole("button", { name: "Blackout", exact: true }).click();
    await output.waitForFunction(
      () => !document.querySelector(".projector-guides"),
    );
    assert.equal((await read()).blackout, true);
    await page
      .getByRole("button", { name: "Restore light", exact: true })
      .click();
    await output.waitForSelector(".projector-guides polyline");
    console.log(
      "PASS internal-display output: closed and draft SVG guides align with the letterboxed canvas, include point labels, and disappear during blackout",
    );

    const beforeUntrustedWrite = await read();
    await output.evaluate(() =>
      window.prism.updateOverlay({
        points: [{ x: 0.9, y: 0.9 }],
        closed: false,
      }),
    );
    assert.deepEqual(
      await output.evaluate(() => window.prism.getOverlay()),
      draftGuide,
    );
    await output.evaluate(
      (project) =>
        window.prism.updateProject({
          ...project,
          name: "Output must not write project",
          surfaces: [],
        }),
      beforeUntrustedWrite,
    );
    assert.deepEqual(
      await output.evaluate(() => window.prism.getProject()),
      beforeUntrustedWrite,
    );
    for (const method of ["saveProject", "loadProject", "importMedia"]) {
      const rejection = await output.evaluate(
        async ({ method, project }) => {
          try {
            await window.prism[method](project);
            return null;
          } catch (error) {
            return String(error);
          }
        },
        { method, project: beforeUntrustedWrite },
      );
      assert.match(rejection, /not available from this window/);
    }
    await page.evaluate(() => window.prism.updateOverlay(null));
    await output.waitForFunction(
      () => !document.querySelector(".projector-guides"),
    );
    assert.equal(await output.evaluate(() => window.prism.getOverlay()), null);
    assert.deepEqual(pageErrors, []);
    await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, "artifacts/desktop-advanced-validation.json"),
      JSON.stringify(
        {
          passed: true,
          projectRoundTrip: true,
          legacyMigration: true,
          transientEditingState: true,
          overlayValidation: true,
          outputWriteBoundary: true,
          internalDisplay: {
            label: internal.label,
            internal: internal.internal,
            primary: internal.primary,
          },
          externalProjectorUsed: false,
        },
        null,
        2,
      ) + "\n",
    );
    await page.evaluate(() => window.prism.closeOutput());
    console.log(
      "PASS output trust boundary: reads allowed, project/overlay writes and file dialogs rejected; guides clear cleanly",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
