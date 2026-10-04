// Run against the actual distributed app with an isolated profile; never opens a projector.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const pkg = require("../package.json");
const catalog = require("../shared/patterns.json");
(async () => {
  const executablePath = process.argv[2];
  if (!executablePath)
    throw new Error(
      "Pass the packaged executable path: npm run test:packaged -- <executable>",
    );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prism-packaged-"));
  let app;
  try {
    app = await electron.launch({
      executablePath: path.resolve(executablePath),
      args: [
        `--user-data-dir=${path.join(directory, "profile")}`,
        ...(process.env.CI
          ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
          : []),
      ],
      timeout: 45000,
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .waitFor();
    // The virtual screens of the CI computers are as small as 1024 x 768, and a
    // page under 1050 pixels wide switches to the compact layout (which has its
    // own tests). This test walks through the desktop layout, so give the page
    // the width it needs whatever the screen is.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.app-shell[data-layout="desktop"]').waitFor();
    assert.match(
      await page.locator(".alpha").innerText(),
      new RegExp(pkg.version.replaceAll(".", "\\.")),
    );
    assert.equal(
      await app.evaluate(({ app }) => app.getVersion()),
      pkg.version,
    );
    assert.equal(
      await app.evaluate(({ app }) => app.getPath("userData")),
      path.join(directory, "profile"),
    );
    assert.equal(await page.locator(".pattern-card").count(), catalog.length);
    const read = () => page.evaluate(() => window.prism.getProject());
    assert.equal((await read()).surfaces.length, 1);
    assert.equal(
      (await page.evaluate(() => window.prism.getAudio())).active,
      false,
    );
    await page.getByRole("button", { name: "Halloween", exact: true }).click();
    assert.equal(await page.locator(".pattern-card").count(), 12);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".pattern-card img")].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    await page
      .getByRole("button", { name: "Watching eyes", exact: true })
      .click();
    await page.waitForFunction(
      async () =>
        (await window.prism.getProject()).surfaces[0].source ===
        "watching-eyes",
    );
    await page
      .getByRole("button", { name: "Add triangle", exact: true })
      .click();
    await page.waitForFunction(
      async () => (await window.prism.getProject()).surfaces.length === 2,
    );
    const project = await read();
    assert.equal(project.surfaces[1].polygon.length, 3);
    assert.ok(
      !(await page.locator(".stage canvas").getAttribute("data-render-error")),
    );
    const savedPath = path.join(directory, "packaged.prism.json");
    await app.evaluate(({ dialog }, savedPath) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: savedPath,
      });
    }, savedPath);
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Project saved" })
      .waitFor();
    assert.deepEqual(JSON.parse(await fs.readFile(savedPath, "utf8")), project);
    await page
      .getByRole("button", { name: "Add rectangle", exact: true })
      .click();
    await app.evaluate(({ dialog }, savedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [savedPath],
      });
    }, savedPath);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.waitForFunction(
      async () => (await window.prism.getProject()).surfaces.length === 2,
    );
    assert.deepEqual(await read(), project);
    await page
      .getByRole("button", { name: "Open audio react controls", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start listening", exact: true })
      .waitFor();
    assert.equal(
      (await page.evaluate(() => window.prism.getAudio())).active,
      false,
    );
    const helpLinks = await app.evaluate(async ({ Menu, shell }) => {
      const links = [];
      const original = shell.openExternal;
      shell.openExternal = async (url) => {
        links.push(url);
      };
      try {
        for (const item of Menu.getApplicationMenu().items.find(
          (item) => item.label === "Help",
        ).submenu.items)
          if (item.type !== "separator") await item.click();
      } finally {
        shell.openExternal = original;
      }
      return links;
    });
    assert.ok(
      helpLinks.includes(
        "https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest",
      ),
    );
    assert.equal(helpLinks.length, 4);
    assert.deepEqual(errors, []);
    console.log(
      `PASS packaged ${pkg.version}: ${catalog.length} materials, Halloween assets, GPU initialization, triangle mapping, native Save/Open, capture OFF, Help/update links; isolated profile, no projector.`,
    );
  } finally {
    if (app) await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
