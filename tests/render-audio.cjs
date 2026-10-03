const { launchBrowser } = require("./browser.cjs");
const assert = require("node:assert/strict");
const zero = { active: true, level: 0, bass: 0, mid: 0, treble: 0, beat: 0 };
const loud = { active: true, level: 1, bass: 1, mid: 1, treble: 1, beat: 1 };
const off = { ...zero, active: false };
const audio = { enabled: true, band: "level", amount: 1, mode: "brightness" };
const rect = (l, t, r, b) => [
  { x: l, y: t },
  { x: r, y: t },
  { x: r, y: b },
  { x: l, y: b },
];
function pixel(f, x = 160, y = 90) {
  const i = ((f.height - 1 - y) * f.width + x) * 4;
  return f.pixels.slice(i, i + 3);
}
function near(actual, expected, label) {
  actual.forEach((v, i) =>
    assert.ok(
      Math.abs(v - expected[i]) <= 2,
      `${label}: ${actual}, expected ${expected}`,
    ),
  );
}
(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:5178/tests/advanced-harness.html");
    await page.waitForFunction(() => window.advancedHarness);
    const render = (surfaces, options = {}) =>
      page.evaluate(
        ([s, o]) => window.advancedHarness.render(s, o),
        [surfaces, options],
      );
    for (const fallback of [false, true]) {
      const red = { color: "#ff0000", audio };
      const opts = { fallback };
      let f = await render([red], { ...opts, audio: zero });
      near(pixel(f), [38, 0, 0], "silence smoothly dims responding layer");
      f = await render([red], { ...opts, audio: loud, brightness: 0.65 });
      near(
        pixel(f),
        [166, 0, 0],
        "loudness respects master brightness ceiling",
      );
      f = await render([red], { ...opts, audio: off });
      near(pixel(f), [255, 0, 0], "capture stopped restores original");
      f = await render([{ ...red, audio: { ...audio, enabled: false } }], {
        ...opts,
        audio: zero,
      });
      near(pixel(f), [255, 0, 0], "disabled layer unchanged");
      f = await render([{ ...red, audio: { ...audio, amount: 0 } }], {
        ...opts,
        audio: zero,
      });
      near(pixel(f), [255, 0, 0], "zero amount unchanged");
      f = await render([{ ...red, audio: { ...audio, mode: "zoom" } }], {
        ...opts,
        audio: zero,
      });
      near(pixel(f), [255, 0, 0], "zoom mode does not dim");
      for (const band of ["level", "bass", "mid", "treble", "beat"]) {
        const s = { ...red, audio: { ...audio, band } };
        f = await render([s], { ...opts, audio: { ...zero, [band]: 1 } });
        near(pixel(f), [255, 0, 0], `${band} selects requested band`);
        f = await render([s], { ...opts, audio: zero });
        near(pixel(f), [38, 0, 0], `${band} quiet response`);
      }
      const layers = [
        { ...red, corners: rect(0, 0, 0.5, 1) },
        { color: "#00ff00", corners: rect(0.5, 0, 1, 1) },
        {
          kind: "mask",
          audio,
          opacity: 0.5,
          corners: rect(0.65, 0.2, 0.85, 0.8),
        },
      ];
      f = await render(layers, { ...opts, audio: zero });
      near(pixel(f, 80), [38, 0, 0], "independent reactive section");
      near(pixel(f, 180), [0, 255, 0], "independent steady section");
      near(pixel(f, 240), [0, 127, 0], "masks unaffected by reaction");
      f = await render([red], { ...opts, audio: loud });
      f = await render([red], { ...opts, audio: zero, playing: false });
      near(pixel(f), [255, 0, 0], "pause holds response");
      f = await render([red], { ...opts, audio: zero, playing: true });
      near(pixel(f), [38, 0, 0], "resume restores live response");
      f = await render([red], { ...opts, audio: off, playing: false });
      near(pixel(f), [255, 0, 0], "stopping while paused restores original");
      f = await render([red], { ...opts, audio: loud, blackout: true });
      assert.ok(
        f.pixels.every((v, i) => i % 4 === 3 || v === 0),
        "blackout overrides audio",
      );
      const checker = {
        source: "checker",
        corners: rect(0.1, 0.1, 0.9, 0.9),
        audio: { ...audio, mode: "zoom" },
      };
      const quiet = await render([checker], { ...opts, audio: zero });
      const pulsed = await render([checker], { ...opts, audio: loud });
      assert.ok(
        pulsed.pixels.reduce((n, v, i) => n + (v !== quiet.pixels[i]), 0) >
          1000,
        "zoom visibly moves content",
      );
      near(
        pixel(pulsed, 5, 90),
        [0, 0, 0],
        "zoom keeps left clipping boundary",
      );
      near(
        pixel(pulsed, 315, 90),
        [0, 0, 0],
        "zoom keeps right clipping boundary",
      );
      f = await render([red], { ...opts, audio: zero });
      await page.waitForTimeout(600);
      f = await render([red], opts);
      near(pixel(f), [255, 0, 0], "stale input releases response");
      assert.equal(f.error, 0);
      console.log(
        `PASS ${fallback ? "fallback" : "standard"} GPU audio: all bands, independent layers, master ceiling, stop/stale recovery, pause, blackout, zoom clipping and masks.`,
      );
    }
    assert.deepEqual(
      await page.evaluate(() => window.advancedHarness.errors),
      [],
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
