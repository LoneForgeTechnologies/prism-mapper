const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "prism-ui-"));
  const app = await _electron.launch({
    args: [path.resolve(__dirname, ".."), `--user-data-dir=${profile}`],
  });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector(".stage canvas");
    await page.waitForFunction(
      () => document.querySelector(".stage canvas").width > 100,
    );
    const displays = await page.evaluate(() => window.prism.getDisplays());
    console.log("Detected displays:", JSON.stringify(displays));
    const read = () => page.evaluate(() => window.prism.getProject());
    assert.equal((await read()).surfaces.length, 1);
    await page
      .getByRole("button", { name: "Calibration grid", exact: true })
      .click();
    await page.waitForFunction(
      async () =>
        (await window.prism.getProject()).surfaces[0].source === "grid",
    );
    const before = await read();
    const handle = page.getByRole("button", { name: "Corner 1: Top left" });
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 45, box.y + 35, { steps: 8 });
    await page.mouse.up();
    const changed = await read();
    assert.ok(
      changed.surfaces[0].corners[0].x > before.surfaces[0].corners[0].x,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForFunction(
      (x) =>
        window.prism.getProject().then((p) => p.surfaces[0].corners[0].x === x),
      before.surfaces[0].corners[0].x,
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page.waitForFunction(
      (x) =>
        window.prism.getProject().then((p) => p.surfaces[0].corners[0].x === x),
      changed.surfaces[0].corners[0].x,
    );
    await page
      .getByRole("button", { name: "Add surface", exact: true })
      .first()
      .click();
    await page.waitForFunction(
      async () => (await window.prism.getProject()).surfaces.length === 2,
    );
    await page
      .getByRole("button", { name: "Delete surface", exact: true })
      .click();
    await page.waitForFunction(
      async () => (await window.prism.getProject()).surfaces.length === 1,
    );
    await page.getByRole("button", { name: "Blackout", exact: true }).click();
    await page.waitForFunction(
      async () => (await window.prism.getProject()).blackout,
    );
    const pixel = await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => {
            const c = document.querySelector("canvas"),
              gl = c.getContext("webgl"),
              p = new Uint8Array(4);
            gl.readPixels(
              c.width / 2,
              c.height / 2,
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              p,
            );
            resolve([...p]);
          }),
        ),
    );
    assert.deepEqual(pixel.slice(0, 3), [0, 0, 0]);
    await page
      .getByRole("button", { name: "Restore light", exact: true })
      .click();
    await page.getByRole("button", { name: "Aurora", exact: true }).click();
    await fs.mkdir(path.resolve(__dirname, "../artifacts"), {
      recursive: true,
    });
    await page.locator(".right-panel").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: path.resolve(__dirname, "../artifacts/editor.png"),
    });
    for (const size of [
      [1120, 740],
      [1920, 740],
      [1460, 940],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, s) =>
          BrowserWindow.getAllWindows()[0].setSize(...s),
        size,
      );
      await page.waitForTimeout(100);
      const layout = await page.evaluate(() => {
        const stage = document.querySelector(".stage").getBoundingClientRect(),
          t = document.querySelector(".transport").getBoundingClientRect();
        return {
          stageBottom: stage.bottom,
          transportTop: t.top,
          transportBottom: t.bottom,
          h: innerHeight,
        };
      });
      assert.ok(
        layout.stageBottom < layout.transportTop,
        JSON.stringify(layout),
      );
      assert.ok(layout.transportBottom < layout.h, JSON.stringify(layout));
    }
    const external =
      displays.find((d) => !d.internal && !d.primary) ||
      displays.find((d) => !d.primary);
    if (external) {
      await page.selectOption("#display", String(external.id));
      const outputPromise = app.waitForEvent("window");
      await page
        .getByRole("button", { name: "Open projector output", exact: true })
        .click();
      const output = await outputPromise;
      await output.waitForSelector(".projector canvas");
      assert.equal(await output.locator("button").count(), 0);
      await page.getByRole("button", { name: "Blackout", exact: true }).click();
      await output.waitForTimeout(150);
      const outputPixel = await output.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => {
              const c = document.querySelector("canvas"),
                g = c.getContext("webgl"),
                p = new Uint8Array(4);
              g.readPixels(
                c.width / 2,
                c.height / 2,
                1,
                1,
                g.RGBA,
                g.UNSIGNED_BYTE,
                p,
              );
              resolve([...p]);
            }),
          ),
      );
      assert.deepEqual(outputPixel.slice(0, 3), [0, 0, 0]);
      await page
        .getByRole("button", { name: "Restore light", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Calibration grid", exact: true })
        .click();
      await output.waitForTimeout(150);
      await output.screenshot({
        path: path.resolve(__dirname, "../artifacts/projector-grid.png"),
      });
      await output.keyboard.press("Escape").catch((error) => {
        if (!output.isClosed()) throw error;
      });
      await page
        .getByRole("button", { name: "Open projector output", exact: true })
        .waitFor();
      console.log(
        `Projector output verified on ${external.label} (${external.size.width}x${external.size.height}).`,
      );
    } else
      console.log(
        "No extended display detected; physical output test skipped.",
      );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: desktop editor, corner drag, undo/redo, layers, blackout GPU pixels, viewport fit, clean projector output.",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
