const { launchBrowser, baseUrl } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const rect = (left, top, right, bottom) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
];
const outline = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.45 },
  { x: 0.45, y: 0.45 },
  { x: 0.45, y: 0.9 },
  { x: 0.1, y: 0.9 },
];
function pixel(frame, x, y) {
  const i =
    ((frame.height - 1 - Math.floor(y)) * frame.width + Math.floor(x)) * 4;
  return frame.pixels.slice(i, i + 3);
}
function near(actual, expected, message, tolerance = 3) {
  actual.forEach((v, i) =>
    assert.ok(
      Math.abs(v - expected[i]) <= tolerance,
      `${message}: got ${actual}, expected ${expected}`,
    ),
  );
}
(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`${baseUrl()}/tests/advanced-harness.html`);
    await page.waitForFunction(() => window.advancedHarness);
    assert.deepEqual(
      await page.evaluate(() => window.advancedHarness.errors),
      [],
      "shader initialization",
    );
    const render = (surfaces, options = {}) =>
      page.evaluate(
        ([surfaces, options]) =>
          window.advancedHarness.render(surfaces, options),
        [surfaces, options],
      );
    const frames = [];
    for (const fallback of [false, true]) {
      const opts = { fallback };
      for (const polygon of [outline, [...outline].reverse()]) {
        const f = await render([{ polygon }], opts);
        near(pixel(f, 64, 130), [255, 255, 255], "concave arm");
        near(pixel(f, 256, 130), [0, 0, 0], "concave notch");
        near(pixel(f, 4, 4), [0, 0, 0], "outside shape");
        assert.equal(f.error, 0);
      }
      console.log(
        `PASS ${fallback ? "packed texture" : "uniform"} outline: concave clipping, both winding directions`,
      );
      const base = { color: "#808080" },
        front = { color: "#ff0000", opacity: 0.5 };
      for (const [blendMode, expected] of [
        ["normal", [192, 64, 64]],
        ["screen", [192, 128, 128]],
        ["add", [255, 128, 128]],
      ]) {
        const f = await render([base, { ...front, blendMode }], opts);
        near(pixel(f, 160, 90), expected, `${blendMode} opacity`);
      }
      const mask = {
        kind: "mask",
        source: "missing-media",
        corners: rect(0.2, 0.2, 0.8, 0.8),
        opacity: 0.5,
        blendMode: "add",
      };
      let f = await render([{ color: "#ffffff" }, mask], opts);
      near(pixel(f, 160, 90), [127, 127, 127], "mask opacity");
      near(pixel(f, 10, 10), [255, 255, 255], "mask bounds");
      f = await render(
        [
          { color: "#ffffff" },
          mask,
          { color: "#0000ff", corners: rect(0.4, 0.4, 0.6, 0.6) },
        ],
        opts,
      );
      near(pixel(f, 160, 90), [0, 0, 255], "layer above mask");
      f = await render(
        [
          { ...base, blendMode: "screen" },
          { color: "#ff0000", opacity: 0.5, blendMode: "normal" },
        ],
        opts,
      );
      near(pixel(f, 160, 90), [192, 64, 64], "blend state resets");
      console.log(
        `PASS ${fallback ? "fallback" : "native"}: mask opacity/order and normal/add/screen opacity`,
      );
      const feathered = {
        corners: rect(20 / 320, 20 / 180, 300 / 320, 160 / 180),
        feather: 16,
      };
      f = await render([feathered], opts);
      near(pixel(f, 18, 90), [0, 0, 0], "feather stays inside");
      assert.ok(pixel(f, 21, 90)[0] < 12);
      assert.ok(pixel(f, 28, 90)[0] > 120 && pixel(f, 28, 90)[0] < 155);
      near(pixel(f, 40, 90), [255, 255, 255], "feather interior");
      f = await render([feathered], {
        ...opts,
        outputWidth: 640,
        outputHeight: 360,
      });
      near(pixel(f, 28, 90), [255, 255, 255], "feather uses output pixels");
      f = await render([{ polygon: outline, feather: 12 }], opts);
      near(pixel(f, 256, 130), [0, 0, 0], "concave feather notch");
      assert.ok(pixel(f, 146, 78)[0] < 60, "feather follows inside notch edge");
      console.log(
        `PASS ${fallback ? "fallback" : "native"}: output-pixel feather including concave notch`,
      );
      const warped = [
        { x: 0.12, y: 0.15 },
        { x: 0.86, y: 0.04 },
        { x: 0.96, y: 0.9 },
        { x: 0.24, y: 0.75 },
      ];
      f = await render([{ source: "checker", corners: warped }], opts);
      for (const uv of [
        { x: 0.21, y: 0.26 },
        { x: 0.67, y: 0.72 },
        { x: 0.45, y: 0.45 },
      ]) {
        const p = await page.evaluate(
          ([corners, point]) =>
            window.advancedHarness.transform(corners, point),
          [warped, uv],
        );
        const white = (Math.floor(uv.x * 16) + Math.floor(uv.y * 9)) % 2;
        near(
          pixel(f, p.x * 320, p.y * 180),
          white ? [232, 242, 237] : [6, 9, 11],
          "perspective-correct quad",
          5,
        );
      }
      f = await render([{ source: "media:quadrants" }], {
        ...opts,
        waitMedia: true,
      });
      near(pixel(f, 80, 45), [255, 0, 0], "media original");
      f = await render(
        [
          {
            source: "media:quadrants",
            content: { rotation: 90, scale: 1, offsetX: 0, offsetY: 0 },
          },
        ],
        opts,
      );
      near(pixel(f, 80, 45), [0, 0, 255], "clockwise media rotation");
      f = await render(
        [
          { color: "#808080" },
          {
            source: "media:quadrants",
            content: { rotation: 0, scale: 1, offsetX: 0.25, offsetY: 0 },
          },
        ],
        opts,
      );
      near(
        pixel(f, 32, 45),
        [128, 128, 128],
        "outside transformed media transparent",
      );
      near(pixel(f, 120, 45), [255, 0, 0], "media translation");
      f = await render(
        [
          {
            polygon: outline,
            source: "checker",
            content: { rotation: 45, scale: 0.5, offsetX: 0, offsetY: 0 },
          },
        ],
        opts,
      );
      near(pixel(f, 256, 130), [0, 0, 0], "transforms preserve outline");
      console.log(
        `PASS ${fallback ? "fallback" : "native"}: perspective, media rotation/translation/transparency and shape clipping`,
      );
      const catalog = await page.evaluate(() =>
        window.advancedHarness.catalog.filter((p) => p.category === "Shape"),
      );
      assert.equal(catalog.length, 8);
      for (const pattern of catalog) {
        const a = await render(
          [{ polygon: outline, source: pattern.id, edgeWidth: 9 }],
          { ...opts, advance: 4 },
        );
        const b = await render(
          [{ polygon: outline, source: pattern.id, edgeWidth: 9 }],
          { ...opts, advance: 8 },
        );
        near(pixel(b, 256, 130), [0, 0, 0], `${pattern.id}: notch clipping`);
        const bright = b.pixels.filter((v, i) => i % 4 !== 3 && v > 10).length;
        assert.ok(bright > 100, `${pattern.id}: blank frame`);
        assert.notDeepEqual(a.pixels, b.pixels, `${pattern.id}: no motion`);
        assert.equal(b.error, 0);
        if (!fallback) frames.push({ label: pattern.label, image: b.image });
      }
      const edgeId = catalog.find((p) => p.shader === 30).id;
      f = await render(
        [{ polygon: outline, source: edgeId, edgeWidth: 3 }],
        opts,
      );
      const boundary = pixel(f, 150, 78).reduce((a, b) => a + b),
        interior = pixel(f, 150, 40).reduce((a, b) => a + b);
      assert.ok(
        boundary > interior * 2,
        "edge pattern follows concave inner edge",
      );
      const warm = await render([{ polygon: outline }], opts);
      const cached = await render([{ polygon: outline }], opts);
      assert.equal(cached.uploads, 0, "unchanged geometry reuploaded");
      console.log(
        `PASS ${fallback ? "fallback" : "native"}: eight shape animations animate/clip; edge follows outline; geometry is cached`,
      );
    }
    assert.deepEqual(
      await page.evaluate(() => window.advancedHarness.errors),
      [],
    );
    assert.deepEqual(pageErrors, []);
    await fs.mkdir(path.resolve(__dirname, "../artifacts"), {
      recursive: true,
    });
    await page.setViewportSize({ width: 1100, height: 610 });
    await page.setContent(
      `<html><body style="margin:0;padding:20px;background:#101b16;color:#cee9db;font:16px system-ui"><h1 style="font-weight:500">Prism Mapper · shape animations</h1><p>All eight materials follow and clip to the same concave traced outline.</p><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">${frames.map((f) => `<div><img src="${f.image}" style="display:block;width:100%;border-radius:8px"><p>${f.label}</p></div>`).join("")}</div></body></html>`,
    );
    await page.screenshot({
      path: path.resolve(
        __dirname,
        "../artifacts/shape-animation-contact-sheet.png",
      ),
    });
    console.log(
      "PASS: advanced GPU checks including the WebGL1 low-uniform fallback",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
