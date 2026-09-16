const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:5178/tests/animation-harness.html");
    await page.waitForFunction(() => window.animationHarness);
    const catalog = await page.evaluate(() => window.animationHarness.catalog);
    const expectedCatalog = require("../shared/patterns.json");
    assert.equal(catalog.length, expectedCatalog.length);
    const animatedCount = catalog.filter((p) => p.animated).length;
    assert.equal(
      animatedCount,
      expectedCatalog.filter((p) => p.animated).length,
    );
    const render = (id, n = 0, settings = {}) =>
      page.evaluate(
        ([id, n, settings]) => window.animationHarness.render(id, n, settings),
        [id, n, settings],
      );
    const hashes = new Set();
    const summary = [];
    const frames = [];
    await fs.mkdir(path.resolve(__dirname, "../public/previews"), {
      recursive: true,
    });
    for (const p of catalog) {
      const a = await render(p.id, 8);
      const b = await render(p.id, 8);
      assert.equal(a.error, 0, `${p.id}: GPU error`);
      assert.equal(b.error, 0, `${p.id}: GPU error`);
      const nonblack = b.pixels.filter((v, i) => i % 4 !== 3 && v > 10).length;
      assert.ok(nonblack > 200, `${p.id}: blank image`);
      const delta =
        b.pixels.reduce(
          (total, value, i) => total + Math.abs(value - a.pixels[i]),
          0,
        ) / b.pixels.length;
      if (p.animated)
        assert.ok(delta > 0.01, `${p.id} isn't visibly animated: ${delta}`);
      const hash = createHash("sha256")
        .update(Buffer.from(b.pixels))
        .digest("hex");
      assert.ok(!hashes.has(hash), `${p.id}: duplicate image`);
      hashes.add(hash);
      const paused = await render(p.id, 4, { playing: false });
      const paused2 = await render(p.id, 4, { playing: false });
      assert.deepEqual(paused.pixels, paused2.pixels, `${p.id}: pause drift`);
      if (p.animated) {
        const frozen = await render(p.id, 4, { speed: 0 });
        const frozen2 = await render(p.id, 4, { speed: 0 });
        assert.deepEqual(
          frozen.pixels,
          frozen2.pixels,
          `${p.id}: speed0 drift`,
        );
        const dense = await render(p.id, 0, { detail: 2 });
        assert.notDeepEqual(
          frozen.pixels,
          dense.pixels,
          `${p.id}: detail has no effect`,
        );
      }
      frames.push({ id: p.id, label: p.label, image: b.image });
      summary.push({
        id: p.id,
        animated: p.animated,
        meanFrameDelta: Number(delta.toFixed(3)),
      });
      console.log(`PASS ${p.label}: ${delta.toFixed(2)} frame delta`);
    }
    const black = await render("galaxy", 1, { blackout: true });
    assert.ok(black.pixels.every((v, i) => i % 4 === 3 || v === 0));
    assert.deepEqual(
      await page.evaluate(() => window.animationHarness.errors),
      [],
    );
    assert.deepEqual(errors, []);
    await Promise.all(
      frames
        .filter(
          (f) =>
            !["Shape", "Halloween"].includes(
              catalog.find((p) => p.id === f.id).category,
            ),
        )
        .map((f) =>
          fs.writeFile(
            path.resolve(__dirname, `../public/previews/${f.id}.png`),
            Buffer.from(f.image.split(",")[1], "base64"),
          ),
        ),
    );
    await fs.mkdir(path.resolve(__dirname, "../artifacts"), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, "../artifacts/animation-validation.json"),
      JSON.stringify(summary, null, 2),
    );
    await page.setViewportSize({ width: 1200, height: 2550 });
    await page.setContent(
      `<html><body style="margin:0;padding:20px;background:#111c15;color:#c7e8d1;font:15px system-ui"><h1 style="font-weight:500">Prism Mapper · ${animatedCount} animations</h1><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">${frames
        .filter((f) => !["grid", "checker", "solid"].includes(f.id))
        .map(
          (f) =>
            `<div><img src="${f.image}" style="width:100%;display:block;border-radius:6px"><p style="margin:7px 0">${f.label}</p></div>`,
        )
        .join("")}</div></body></html>`,
    );
    await page.screenshot({
      path: path.resolve(__dirname, "../artifacts/animation-contact-sheet.png"),
    });
    await page.setViewportSize({ width: 1460, height: 940 });
    await page.goto("http://127.0.0.1:5178");
    await page.getByRole("button", { name: "Ocean", exact: true }).waitFor();
    assert.equal(await page.locator(".pattern-card").count(), catalog.length);
    await page.getByRole("button", { name: "Playful", exact: true }).click();
    assert.equal(await page.locator(".pattern-card").count(), 8);
    await page
      .getByRole("textbox", { name: "Search animations" })
      .fill("petal");
    assert.equal(await page.locator(".pattern-card").count(), 1);
    await page
      .getByRole("button", { name: "Cherry petals", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Animation speed 0.5x", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("slider", { name: "Animation speed", exact: true })
        .inputValue(),
      "0.5",
    );
    await page.getByRole("textbox", { name: "Search animations" }).fill("");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByRole("button", { name: "Start animation mix" }).click();
    await page.getByRole("button", { name: "Stop animation mix" }).waitFor();
    await page.getByRole("button", { name: "Stop animation mix" }).click();
    await page.getByRole("button", { name: "Ocean", exact: true }).click();
    await page.screenshot({
      path: path.resolve(__dirname, "../artifacts/animation-library.png"),
    });
    console.log(
      `PASS: ${catalog.length} distinct GPU materials; ${animatedCount} animated; all pause/speed0/detail/blackout checks; search/filter/selection/speed/mix controls.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
