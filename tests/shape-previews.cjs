const { launchBrowser } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const point = (x, y) => ({ x, y });
const outlines = {
  concave: [
    point(0.1, 0.12),
    point(0.9, 0.12),
    point(0.9, 0.44),
    point(0.46, 0.44),
    point(0.46, 0.88),
    point(0.1, 0.88),
  ],
  rectangle: [
    point(0.1, 0.14),
    point(0.9, 0.14),
    point(0.9, 0.86),
    point(0.1, 0.86),
  ],
  circle: Array.from({ length: 32 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 32;
    return point(
      0.5 + Math.cos(angle) * 0.38 * (360 / 640),
      0.5 + Math.sin(angle) * 0.38,
    );
  }),
  triangle: [point(0.5, 0.08), point(0.76, 0.88), point(0.24, 0.88)],
};

const escapeHtml = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");

(async () => {
  const catalog = JSON.parse(
    await fs.readFile(path.join(root, "shared/patterns.json"), "utf8"),
  ).filter((pattern) => pattern.category === "Shape");
  assert.equal(catalog.length, 8, "Expected eight shape animations");
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1320, height: 680 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:5178/tests/advanced-harness.html");
    await page.waitForFunction(() => window.advancedHarness);
    const frames = [];
    await fs.mkdir(path.join(root, "public/previews"), { recursive: true });
    for (const pattern of catalog) {
      const shape =
        pattern.id === "sweep"
          ? "rectangle"
          : pattern.id === "radar"
            ? "circle"
            : pattern.id === "triangle-weave"
              ? "triangle"
              : "concave";
      const surface = {
        source: pattern.id,
        polygon: outlines[shape],
        edgeWidth: 10,
        color: "#a8f3cb",
        detail: 1,
        speed: 1,
      };
      let best;
      let previous;
      let largestDelta = 0;
      // Sample a short run so moving beams are visible in their static thumbnails.
      for (let sample = 0; sample < 8; sample++) {
        const frame = await page.evaluate(
          (surface) =>
            window.advancedHarness.render([surface], {
              advance: 8,
              outputWidth: 640,
              outputHeight: 360,
            }),
          surface,
        );
        assert.equal(frame.error, 0, `${pattern.id}: WebGL error`);
        assert.equal(frame.width, 320);
        assert.equal(frame.height, 180);
        let litChannels = 0;
        let brightness = 0;
        let delta = 0;
        for (let i = 0; i < frame.pixels.length; i++) {
          if (i % 4 === 3) continue;
          const value = frame.pixels[i];
          if (value > 10) litChannels++;
          brightness += value;
          if (previous) delta += Math.abs(value - previous[i]);
        }
        largestDelta = Math.max(largestDelta, delta / frame.pixels.length);
        if (!best || brightness > best.brightness)
          best = { ...frame, brightness, litChannels };
        previous = frame.pixels;
      }
      assert.ok(best.litChannels > 200, `${pattern.id}: blank thumbnail`);
      assert.ok(largestDelta > 0.01, `${pattern.id}: not visibly animated`);
      const image = best.image;
      await fs.writeFile(
        path.join(root, "public/previews", `${pattern.id}.png`),
        Buffer.from(image.split(",")[1], "base64"),
      );
      frames.push({ ...pattern, shape, image });
      console.log(
        `PASS ${pattern.label}: ${shape}, ${best.litChannels} lit channels, ${largestDelta.toFixed(2)} frame delta`,
      );
    }
    assert.deepEqual(
      await page.evaluate(() => window.advancedHarness.errors),
      [],
    );
    assert.deepEqual(errors, []);
    await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
    await page.setContent(`<!doctype html><html><head><style>
      * {box-sizing:border-box}
      body {margin:0;padding:28px;background:#101610;color:#e0eee3;font-family:system-ui,sans-serif}
      .eyebrow {font-size:12px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#9ed1ae}
      h1 {font-size:29px;font-weight:500;margin:7px 0}
      .intro {margin:0 0 24px;color:#aebeb1;font-size:14px}
      .grid {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px 16px}
      article {border:1px solid #2e3e30;border-radius:9px;overflow:hidden;background:#172019}
      img {display:block;width:100%;background:black}
      .copy {padding:12px 13px 15px}
      h2 {font-weight:550;font-size:16px;margin:0 0 6px}
      p {margin:0;font-size:12px;line-height:1.5;color:#aebeb1}
      footer {font-size:12px;color:#829487;margin-top:20px}
    </style></head><body>
      <div class="eyebrow">Prism Mapper</div>
      <h1>Light that follows your shapes</h1>
      <p class="intro">Eight original animations for traced outlines, panels, circles, and triangles.</p>
      <div class="grid">${frames
        .map(
          (frame) =>
            `<article><img alt="${escapeHtml(frame.label)}" src="${frame.image}"><div class="copy"><h2>${escapeHtml(frame.label)}</h2><p>${escapeHtml(frame.description)}</p></div></article>`,
        )
        .join("")}</div>
      <footer>Actual renderer captures · MIT-licensed procedural graphics · Width, speed, density, and accent color controls</footer>
    </body></html>`);
    await page.evaluate(() =>
      Promise.all(Array.from(document.images).map((image) => image.decode())),
    );
    await page.screenshot({
      path: path.join(root, "artifacts/shape-previews.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: eight nonblank animated shape previews; no renderer or page errors.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
