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
// Distance in pixels from a point to the closest edge of a polygon.
function outlineDistance(points, x, y) {
  let nearest = Infinity;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  });
  return nearest;
}
function insideOutline(points, x, y) {
  let inside = false;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    if (
      a.y > y !== b.y > y &&
      x < a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)
    )
      inside = !inside;
  });
  return inside;
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
      // Alignment outline: a white line on the edge, a black line just inside
      // it and a dim fill, measured in output pixels from the real outline.
      const align = (extra = {}, view = {}) =>
        render(
          [
            {
              corners: rect(20 / 320, 20 / 180, 300 / 320, 160 / 180),
              source: "alignment",
              edgeWidth: 12,
              ...extra,
            },
          ],
          { ...opts, ...view },
        );
      const WHITE = [255, 255, 255],
        BLACK = [0, 0, 0],
        FILL = [107, 107, 107];
      f = await align();
      near(pixel(f, 18, 90), BLACK, "alignment: nothing outside the outline");
      for (const x of [20, 22, 25])
        near(pixel(f, x, 90), WHITE, `alignment: white line, left, x=${x}`);
      for (const x of [27, 29, 31])
        near(pixel(f, x, 90), BLACK, `alignment: black line, left, x=${x}`);
      for (const x of [33, 60, 160])
        near(pixel(f, x, 90), FILL, `alignment: fill, x=${x}`);
      near(pixel(f, 20, 20), WHITE, "alignment: the white corner is exact");
      near(pixel(f, 21, 21), WHITE, "alignment: corner is white");
      near(pixel(f, 28, 28), BLACK, "alignment: black corner inside it");
      near(pixel(f, 160, 21), WHITE, "alignment: white line, top");
      near(pixel(f, 160, 28), BLACK, "alignment: black line, top");
      near(pixel(f, 160, 40), FILL, "alignment: fill, top");
      near(pixel(f, 297, 90), WHITE, "alignment: white line, right");
      near(pixel(f, 291, 90), BLACK, "alignment: black line, right");
      near(pixel(f, 160, 158), WHITE, "alignment: white line, bottom");
      near(pixel(f, 160, 151), BLACK, "alignment: black line, bottom");
      const still = await align({}, { advance: 9 });
      assert.deepEqual(still.pixels, f.pixels, "alignment: nothing moves");
      f = await align({ color: "#ff0000" });
      near(pixel(f, 22, 90), WHITE, "alignment: the line ignores color");
      near(pixel(f, 60, 90), FILL, "alignment: the fill ignores color");
      f = await align({}, { outputWidth: 640, outputHeight: 360 });
      near(pixel(f, 21, 90), WHITE, "alignment: width is in output pixels");
      near(pixel(f, 24, 90), BLACK, "alignment: black in output pixels");
      near(pixel(f, 30, 90), FILL, "alignment: fill in output pixels");
      f = await align({ edgeWidth: 30 });
      near(pixel(f, 30, 90), WHITE, "alignment: wide white line");
      near(pixel(f, 42, 90), BLACK, "alignment: wide black line");
      near(pixel(f, 60, 90), FILL, "alignment: fill after a wide outline");
      f = await align({ edgeWidth: undefined });
      near(pixel(f, 28, 90), WHITE, "alignment: default 20 px, white");
      near(pixel(f, 34, 90), BLACK, "alignment: default 20 px, black");
      near(pixel(f, 50, 90), FILL, "alignment: default 20 px, fill");
      f = await align({ edgeWidth: 1 });
      near(pixel(f, 20, 90), WHITE, "alignment: thinnest white line");
      near(pixel(f, 21, 90), BLACK, "alignment: thinnest black line");
      near(pixel(f, 24, 90), FILL, "alignment: thinnest outline leaves fill");
      // Slanted, curved and concave edges follow the same rule everywhere.
      const shapes = {
        concave: outline,
        triangle: [
          { x: 0.5, y: 0.08 },
          { x: 0.76, y: 0.88 },
          { x: 0.24, y: 0.88 },
        ],
        circle: Array.from({ length: 32 }, (_, i) => ({
          x: 0.5 + Math.cos((i * Math.PI * 2) / 32) * 0.38 * (180 / 320),
          y: 0.5 + Math.sin((i * Math.PI * 2) / 32) * 0.38,
        })),
      };
      for (const [name, polygon] of Object.entries(shapes)) {
        f = await align({ corners: undefined, polygon });
        const points = polygon.map((p) => ({ x: p.x * 320, y: p.y * 180 }));
        const tally = { white: 0, black: 0, fill: 0 };
        let wrong = null;
        for (let y = 0; y < 180; y++)
          for (let x = 0; x < 320; x++) {
            const distance = outlineDistance(points, x + 0.5, y + 0.5);
            const inside = insideOutline(points, x + 0.5, y + 0.5);
            let expected;
            if (!inside) expected = distance > 1.5 ? BLACK : null;
            else if (distance < 1) expected = null;
            else if (distance < 5) ((expected = WHITE), tally.white++);
            else if (distance > 7 && distance < 11)
              ((expected = BLACK), tally.black++);
            else if (distance > 13) ((expected = FILL), tally.fill++);
            else expected = null;
            if (!expected) continue;
            const got = pixel(f, x, y);
            if (got.some((v, i) => Math.abs(v - expected[i]) > 6) && !wrong)
              wrong = `(${x}, ${y}) distance ${distance.toFixed(2)}: got ${got}, expected ${expected}`;
          }
        assert.equal(wrong, null, `alignment on ${name}: ${wrong}`);
        assert.ok(
          tally.white > 100 && tally.black > 100 && tally.fill > 500,
          `alignment on ${name}: ${JSON.stringify(tally)}`,
        );
      }
      console.log(
        `PASS ${fallback ? "fallback" : "native"}: alignment outline is white on the edge, black just inside, a dim fill, in output pixels, on straight, slanted, curved and concave edges`,
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
