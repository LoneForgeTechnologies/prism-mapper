const { launchBrowser, baseUrl } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const fixtures = ["warm", "blue", "green"].map((name) =>
  path.join(__dirname, "fixtures", `timeline-${name}.mp4`),
);
const draft = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("prism-draft")));
const button = (page, name) => page.getByRole("button", { name, exact: true });
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const panel = (page) =>
  page.getByRole("region", { name: "Scenes and timeline", exact: true });
async function count(page, scenes, cues) {
  await page.waitForFunction(
    ([scenes, cues]) => {
      const saved = JSON.parse(localStorage.getItem("prism-draft"));
      return (
        saved?.show?.scenes.length === scenes && saved.show.cues.length === cues
      );
    },
    [scenes, cues],
  );
}
async function range(page, name, value) {
  await page
    .getByRole("slider", { name, exact: true })
    .evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(element, String(value));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  await settle(page);
}
async function importClips(page, paths = fixtures) {
  const chooser = page.waitForEvent("filechooser");
  await panel(page)
    .getByRole("button", { name: "Add videos to timeline", exact: true })
    .click();
  await (await chooser).setFiles(paths);
}
async function duration(page, index, value) {
  const input = panel(page)
    .getByRole("textbox", {
      name: "Clip length, minutes and seconds",
      exact: true,
    })
    .nth(index);
  await input.fill(value);
  await input.press("Enter");
  await settle(page);
}
function cueNames(project) {
  return project.show.cues.map(
    (cue) => project.show.scenes.find((scene) => scene.id === cue.sceneId).name,
  );
}

async function desktopBridge(context) {
  await context.addInitScript(() => {
    const copy = (value) => JSON.parse(JSON.stringify(value));
    const surface = {
      id: "mapped",
      name: "Band screen",
      source: "solid",
      visible: true,
      locked: false,
      opacity: 1,
      color: "#ffffff",
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    };
    const projects = ["Band intro", "Pre-show", "Set 1", "Set 2"].map(
      (name, index) => ({
        version: 3,
        name,
        width: 1920,
        height: 1080,
        brightness: 0.65,
        blackout: false,
        playing: false,
        surfaces: [surface],
        media: [],
        show: {
          loop: true,
          scenes: [{ id: `look-${index}`, name, surfaces: [surface] }],
          cues: [
            { id: `clip-${index}`, sceneId: `look-${index}`, duration: 120 },
          ],
        },
      }),
    );
    const recent = projects.map((project, index) => ({
      id: `recent-${index}`,
      name: project.name,
      path: `/local-band/${project.name}.prism.json`,
      updatedAt: Date.now() - index,
    }));
    const state = (window.showBridge = {
      live: null,
      saved: null,
      opened: [],
      overlay: null,
    });
    const off = () => () => {};
    window.prism = {
      getDisplays: async () => [],
      onDisplays: off,
      onOutputStatus: off,
      onProject: off,
      onProjectOpened: off,
      updateOverlay: (overlay) => {
        state.overlay = copy(overlay);
      },
      getOverlay: async () => state.overlay,
      onOverlay: off,
      updateProject: (project) => {
        state.live = copy(project);
      },
      getProject: async () => state.live,
      getRecentProjects: async () => copy(recent),
      openRecentProject: async (id) => {
        state.opened.push(id);
        return { project: copy(projects[Number(id.split("-")[1])]) };
      },
      loadProject: async () => ({ project: copy(projects[0]) }),
      saveProject: async (project) => {
        state.saved = copy(project);
        return { saved: true, path: `/local-band/${project.name}.prism.json` };
      },
      importMedia: async () => [],
      closeOutput: async () => {},
      openOutput: async () => ({ open: false }),
      setBlackout: () => {},
      getAudio: async () => ({
        active: false,
        level: 0,
        bass: 0,
        mid: 0,
        treble: 0,
        beat: 0,
      }),
      onAudio: off,
    };
  });
}

(async () => {
  const browser = await launchBrowser();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "prism-show-ui-"));
  const errors = [];
  const watch = (page) => {
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
  };
  try {
    const context = await browser.newContext({
      viewport: { width: 1460, height: 940 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    watch(page);
    await page.goto(baseUrl());
    await page.waitForFunction(() => localStorage.getItem("prism-draft"));
    await button(page, "Scenes and timeline").click();
    await panel(page).waitFor();
    assert.equal(
      await panel(page)
        .getByRole("button", { name: "Play show", exact: true })
        .isDisabled(),
      true,
    );
    await panel(page)
      .getByRole("button", { name: "Capture look", exact: true })
      .click();
    await count(page, 1, 0);
    const original = (await draft(page)).surfaces;
    assert.deepEqual((await draft(page)).show.scenes[0].surfaces, original);
    await panel(page)
      .getByRole("textbox", { name: "Scene name Scene 1", exact: true })
      .fill("Band intro look");
    await panel(page)
      .getByRole("button", { name: "Add to timeline", exact: true })
      .click();
    await count(page, 1, 1);
    assert.equal((await draft(page)).show.cues[0].duration, 120);
    await duration(page, 0, "0:02");
    assert.equal((await draft(page)).show.cues[0].duration, 2);
    await importClips(page);
    await count(page, 4, 4);
    let saved = await draft(page);
    assert.deepEqual(cueNames(saved), [
      "Band intro look",
      "timeline-warm",
      "timeline-blue",
      "timeline-green",
    ]);
    assert.deepEqual(
      saved.show.cues.slice(1).map((cue) => cue.duration),
      [2, 2, 1],
    );
    assert.equal(saved.version, 3);
    assert.notEqual(saved.surfaces[0].source, original[0].source);
    assert.deepEqual(
      saved.show.scenes[0].surfaces,
      original,
      "captured looks remain independent of imported clips",
    );
    await panel(page)
      .getByRole("button", { name: "Load look", exact: true })
      .first()
      .click();
    await settle(page);
    assert.equal((await draft(page)).surfaces[0].source, original[0].source);
    await page
      .getByRole("combobox", { name: "Surface source", exact: true })
      .selectOption("solid");
    await panel(page)
      .getByRole("button", { name: "Update look", exact: true })
      .first()
      .click();
    await settle(page);
    saved = await draft(page);
    assert.equal(saved.show.scenes[0].surfaces[0].source, "solid");
    assert.equal(
      saved.show.scenes[1].surfaces[0].source,
      saved.media[0].id,
      "updating one look does not overwrite other scenes",
    );

    await button(page, "Remove clip 1").click();
    await count(page, 4, 3);
    await button(page, "Move clip 3 earlier").click();
    await settle(page);
    assert.deepEqual(cueNames(await draft(page)), [
      "timeline-warm",
      "timeline-green",
      "timeline-blue",
    ]);
    await button(page, "Duplicate clip 1").click();
    await count(page, 4, 4);
    assert.notEqual(
      (await draft(page)).show.cues[0].id,
      (await draft(page)).show.cues[1].id,
    );
    await button(page, "Remove clip 2").click();
    await count(page, 4, 3);
    await duration(page, 0, "invalid");
    assert.equal(
      await panel(page)
        .getByRole("textbox", {
          name: "Clip length, minutes and seconds",
          exact: true,
        })
        .first()
        .getAttribute("aria-invalid"),
      "true",
    );
    assert.equal(
      (await draft(page)).show.cues[0].duration,
      2,
      "an invalid duration does not corrupt the project",
    );
    await duration(page, 0, "0:02");
    await panel(page)
      .getByRole("checkbox", { name: "Loop show", exact: true })
      .check();
    assert.equal((await draft(page)).show.loop, true);
    await panel(page)
      .getByRole("checkbox", { name: "Loop show", exact: true })
      .uncheck();

    await panel(page)
      .getByRole("button", { name: "Play show", exact: true })
      .click();
    await panel(page)
      .getByRole("button", { name: "Pause show", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".corner-handle:visible").count(),
      0,
      "mapping handles disappear during show playback",
    );
    assert.equal(
      await page.locator(".mapping-overlay").isVisible(),
      false,
      "the saved mapping overlay cannot contradict a playing scene",
    );
    const corners = (await draft(page)).surfaces[0].corners;
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("ArrowRight");
    await settle(page);
    assert.deepEqual(
      (await draft(page)).surfaces[0].corners,
      corners,
      "arrow keys cannot edit hidden mapping handles",
    );
    await panel(page)
      .getByRole("button", { name: "Pause show", exact: true })
      .click();
    await range(page, "Show playhead", 3.4);
    assert.equal(
      await panel(page)
        .locator(".show-cues li.current .show-cue-go strong")
        .textContent(),
      "timeline-blue",
    );
    const displayedBlue = (await draft(page)).show.scenes.find(
      (scene) => scene.name === "timeline-blue",
    ).surfaces;
    await panel(page)
      .getByRole("button", { name: "Capture look", exact: true })
      .click();
    await count(page, 5, 3);
    assert.deepEqual(
      (await draft(page)).show.scenes[4].surfaces,
      displayedBlue,
      "capture uses the displayed paused scene rather than the saved base mapping",
    );
    await range(page, "Show playhead", 3.4);
    await panel(page)
      .getByRole("button", { name: "Update look", exact: true })
      .first()
      .click();
    await settle(page);
    assert.deepEqual(
      (await draft(page)).show.scenes[0].surfaces,
      displayedBlue,
      "update also snapshots the displayed paused scene",
    );
    await range(page, "Show playhead", 3.4);
    const held = await panel(page)
      .getByLabel("Show position", { exact: true })
      .textContent();
    await page.waitForTimeout(250);
    assert.equal(
      await panel(page)
        .getByLabel("Show position", { exact: true })
        .textContent(),
      held,
    );
    assert.equal(
      (await draft(page)).transport,
      undefined,
      "session transport never enters the autosaved project",
    );
    await panel(page)
      .getByRole("button", { name: "Play show", exact: true })
      .click();
    await range(page, "Show playhead", 5);
    await panel(page)
      .getByRole("button", { name: "Play show", exact: true })
      .waitFor();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Space");
    await panel(page)
      .getByRole("button", { name: "Pause show", exact: true })
      .waitFor();
    assert.ok(
      Number(
        await panel(page)
          .getByRole("slider", { name: "Show playhead", exact: true })
          .inputValue(),
      ) < 1,
      "Space restarts an ended show instead of staying at its final frame",
    );
    await panel(page)
      .getByRole("button", { name: "Pause show", exact: true })
      .click();

    const downloadEvent = page.waitForEvent("download");
    await panel(page)
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const download = await downloadEvent;
    const exported = path.join(temporary, "show.prism.json");
    await download.saveAs(exported);
    const projectFile = JSON.parse(await fs.readFile(exported, "utf8"));
    assert.deepEqual(projectFile.show, (await draft(page)).show);
    assert.equal(projectFile.transport, undefined);
    assert.ok(
      projectFile.media.every((media) => !media.url),
      "exported projects do not save temporary media URLs",
    );
    await fs.mkdir(path.join(__dirname, "../artifacts"), { recursive: true });
    await page.screenshot({
      path: path.join(__dirname, "../artifacts/show-ui-desktop.png"),
    });
    await panel(page)
      .getByRole("button", { name: "Stop show", exact: true })
      .click();
    assert.ok((await page.locator(".corner-handle:visible").count()) > 0);
    await page.reload();
    await button(page, "Scenes and timeline").click();
    assert.equal(
      await panel(page)
        .getByRole("button", { name: "Play show", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await panel(page)
        .getByRole("button", { name: "Stop show", exact: true })
        .isDisabled(),
      true,
    );
    assert.deepEqual((await draft(page)).show, projectFile.show);
    await context.close();

    const missingContext = await browser.newContext({
      viewport: { width: 1460, height: 940 },
    });
    const missingProject = JSON.parse(JSON.stringify(projectFile));
    await missingContext.addInitScript((project) => {
      localStorage.setItem("prism-draft", JSON.stringify(project));
    }, missingProject);
    const missingPage = await missingContext.newPage();
    watch(missingPage);
    await missingPage.goto(baseUrl());
    await button(missingPage, "Scenes and timeline").click();
    await panel(missingPage)
      .getByRole("alert")
      .filter({ hasText: "Some scene videos are missing" })
      .waitFor();
    assert.equal(
      await panel(missingPage)
        .getByRole("button", { name: "Play show", exact: true })
        .isDisabled(),
      true,
      "missing local media disables scene playback",
    );
    await missingContext.close();

    const native = await browser.newContext({
      viewport: { width: 1460, height: 940 },
    });
    await desktopBridge(native);
    const nativePage = await native.newPage();
    watch(nativePage);
    await nativePage.goto(baseUrl());
    await button(nativePage, "Scenes and timeline").click();
    const recent = nativePage.getByRole("navigation", {
      name: "Recent show projects",
      exact: true,
    });
    for (const name of ["Band intro", "Pre-show", "Set 1", "Set 2"])
      assert.equal(
        await recent.getByRole("button", { name, exact: true }).count(),
        1,
      );
    await recent
      .getByRole("button", { name: "Band intro", exact: true })
      .click();
    await nativePage.waitForFunction(
      () => window.showBridge.live?.name === "Band intro",
    );
    await panel(nativePage)
      .getByRole("button", { name: "Play show", exact: true })
      .click();
    await nativePage.waitForFunction(
      () =>
        window.showBridge.live?.transport?.active &&
        window.showBridge.live.transport.playing,
    );
    await recent.getByRole("button", { name: "Set 1", exact: true }).click();
    await nativePage.waitForFunction(
      () =>
        window.showBridge.live?.name === "Set 1" &&
        !window.showBridge.live.transport,
    );
    assert.equal(
      await panel(nativePage)
        .getByRole("button", { name: "Stop show", exact: true })
        .isDisabled(),
      true,
      "quick project switches stop the previous show",
    );
    await panel(nativePage)
      .getByRole("button", { name: "Play show", exact: true })
      .click();
    await panel(nativePage)
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await nativePage.waitForFunction(
      () => window.showBridge.saved?.name === "Set 1",
    );
    const bridgeSaved = await nativePage.evaluate(
      () => window.showBridge.saved,
    );
    assert.ok(bridgeSaved.show.cues.length > 0);
    assert.equal(
      bridgeSaved.transport,
      undefined,
      "desktop saves receive the persistent model, without session transport",
    );
    assert.deepEqual(
      await nativePage.evaluate(() => window.showBridge.opened),
      ["recent-0", "recent-2"],
    );
    await native.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobile.newPage();
    watch(mobilePage);
    await mobilePage.goto(baseUrl());
    await button(mobilePage, "Scenes and timeline").tap();
    await panel(mobilePage).waitFor();
    await panel(mobilePage)
      .getByRole("button", { name: "Capture look", exact: true })
      .tap();
    await panel(mobilePage)
      .getByRole("button", { name: "Add to timeline", exact: true })
      .tap();
    await count(mobilePage, 1, 1);
    await importClips(mobilePage, fixtures.slice(0, 1));
    await count(mobilePage, 2, 2);
    assert.ok(
      await mobilePage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "phone layout has no horizontal overflow",
    );
    await panel(mobilePage)
      .getByRole("button", { name: "Move clip 2 earlier", exact: true })
      .scrollIntoViewIfNeeded();
    await panel(mobilePage)
      .getByRole("button", { name: "Move clip 2 earlier", exact: true })
      .tap();
    assert.equal(cueNames(await draft(mobilePage))[0], "timeline-warm");
    await panel(mobilePage)
      .getByRole("button", { name: "Play show", exact: true })
      .scrollIntoViewIfNeeded();
    await panel(mobilePage)
      .getByRole("button", { name: "Play show", exact: true })
      .tap();
    await panel(mobilePage)
      .getByRole("button", { name: "Pause show", exact: true })
      .waitFor();
    await panel(mobilePage)
      .getByRole("button", { name: "Pause show", exact: true })
      .tap();
    await mobilePage.screenshot({
      path: path.join(__dirname, "../artifacts/show-ui-mobile.png"),
    });
    await panel(mobilePage)
      .getByRole("button", { name: "Close scenes and timeline", exact: true })
      .tap();
    assert.equal(await panel(mobilePage).count(), 0);
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log(
      "PASS show UI: scene capture/load/update, local MP4 sequence durations, clip order/duplicate/duration validation, transport/end keyboard restart, mapping consistency, save/reload without transport, recent project switching, and phone controls",
    );
  } finally {
    await browser.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
