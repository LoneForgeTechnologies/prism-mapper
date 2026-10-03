const { launchBrowser } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const escapeHtml = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const delta = (a, b) =>
  a.reduce(
    (sum, value, i) => sum + (i % 4 === 3 ? 0 : Math.abs(value - b[i])),
    0,
  ) / a.length;

(async () => {
  const catalog = JSON.parse(
    await fs.readFile(path.join(root, "shared/patterns.json"), "utf8"),
  ).filter((pattern) => pattern.category === "Halloween");
  assert.equal(catalog.length, 12, "Expected twelve Halloween animations");
  assert.deepEqual(
    catalog.map((p) => p.shader),
    Array.from({ length: 12 }, (_, i) => 37 + i),
  );
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1040 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:5178/tests/advanced-harness.html");
    await page.waitForFunction(() => window.advancedHarness);
    const frames = [],
      hashes = new Set();
    await fs.mkdir(path.join(root, "public/previews"), { recursive: true });
    for (const pattern of catalog) {
      const surface = {
        source: pattern.id,
        color: "#a8f3cb",
        detail: 1,
        speed: 1,
      };
      let best,
        previous,
        largestDelta = 0;
      // Brightest of eight moments is a useful still for blinking/drifting scenes.
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
        let litChannels = 0,
          brightness = 0;
        for (let i = 0; i < frame.pixels.length; i++) {
          if (i % 4 === 3) continue;
          const value = frame.pixels[i];
          if (value > 10) litChannels++;
          brightness += value;
        }
        if (previous)
          largestDelta = Math.max(largestDelta, delta(frame.pixels, previous));
        if (!best || brightness > best.brightness)
          best = { ...frame, brightness, litChannels };
        previous = frame.pixels;
      }
      assert.ok(best.litChannels > 400, `${pattern.id}: blank thumbnail`);
      assert.ok(largestDelta > 0.01, `${pattern.id}: not visibly animated`);
      const hash = createHash("sha256")
        .update(Buffer.from(best.pixels))
        .digest("hex");
      assert.ok(
        !hashes.has(hash),
        `${pattern.id}: duplicates another material`,
      );
      hashes.add(hash);
      const frozen = await page.evaluate(async (surface) => {
        const before = await window.advancedHarness.render(
          [{ ...surface, speed: 0 }],
          { advance: 1, outputWidth: 640, outputHeight: 360 },
        );
        const after = await window.advancedHarness.render(
          [{ ...surface, speed: 0 }],
          { advance: 8, outputWidth: 640, outputHeight: 360 },
        );
        return { before: before.pixels, after: after.pixels };
      }, surface);
      assert.equal(
        delta(frozen.before, frozen.after),
        0,
        `${pattern.id}: does not freeze at speed zero`,
      );
      const fallback = await page.evaluate(
        (surface) =>
          window.advancedHarness.render([surface], {
            fallback: true,
            advance: 2,
            outputWidth: 640,
            outputHeight: 360,
          }),
        surface,
      );
      assert.equal(
        fallback.error,
        0,
        `${pattern.id}: compact-uniform WebGL error`,
      );
      assert.ok(
        fallback.pixels.some((v, i) => i % 4 !== 3 && v > 10),
        `${pattern.id}: blank on compact-uniform renderer`,
      );
      await fs.writeFile(
        path.join(root, "public/previews", `${pattern.id}.png`),
        Buffer.from(best.image.split(",")[1], "base64"),
      );
      frames.push({ ...pattern, image: best.image });
      console.log(
        `PASS ${pattern.label}: ${best.litChannels} lit channels, ${largestDelta.toFixed(2)} motion delta; frozen and fallback verified`,
      );
    }
    assert.deepEqual(
      await page.evaluate(() => window.advancedHarness.errors),
      [],
    );
    assert.deepEqual(errors, []);
    await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}body{margin:0;padding:30px;background:#120d12;color:#f2e1d3;font-family:system-ui,sans-serif}
      .eyebrow{font-size:12px;font-weight:600;letter-spacing:.17em;text-transform:uppercase;color:#e18752}h1{font-size:32px;font-weight:500;margin:7px 0}.intro{margin:0 0 25px;color:#b69f9c;font-size:14px}
      .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px 17px}article{border:1px solid #463031;border-radius:9px;overflow:hidden;background:#211519}img{display:block;width:100%;background:black}.copy{padding:12px 13px 15px}h2{font-weight:550;font-size:16px;margin:0 0 6px}p{margin:0;font-size:12px;line-height:1.5;color:#bca9a3}footer{font-size:12px;color:#9b827d;margin-top:22px}
      </style></head><body><div class="eyebrow">Prism Mapper · Halloween collection</div><h1>Make the walls come alive.</h1><p class="intro">Twelve original animated haunt materials. Procedural artwork captured from the actual projection renderer.</p><div class="grid">${frames.map((frame) => `<article><img alt="${escapeHtml(frame.label)}" src="${frame.image}"><div class="copy"><h2>${escapeHtml(frame.label)}</h2><p>${escapeHtml(frame.description)}</p></div></article>`).join("")}</div><footer>MIT-licensed source · Speed and detail controls · Works on traced shapes and projector surfaces</footer></body></html>`);
    await page.evaluate(() =>
      Promise.all(Array.from(document.images).map((image) => image.decode())),
    );
    await page.screenshot({
      path: path.join(root, "artifacts/halloween-previews.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 12 unique nonblank animated Halloween materials; frozen playback, compact uniforms, and no renderer or page errors.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
