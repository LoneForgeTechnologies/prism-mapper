const { launchBrowser, baseUrl } = require("./browser.cjs");
const assert = require("node:assert/strict");

function color(samples, expected, label) {
  assert.equal(samples.length, 2);
  for (const [index, sample] of samples.entries()) {
    assert.equal(sample.error, 0, `${label}: GPU error`);
    expected.forEach((channel, channelIndex) => {
      assert.ok(
        Math.abs(channel - sample.pixel[channelIndex]) < 12,
        `${label} ${index ? "output" : "editor"}: ${sample.pixel}, expected ${expected}`,
      );
    });
    assert.equal(
      sample.videos.length,
      1,
      `${label}: previous-scene decoder was disposed`,
    );
    assert.equal(sample.videos[0].muted, true);
    assert.equal(sample.videos[0].loop, false);
  }
}

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseUrl()}/tests/show-harness.html`);
    await page.waitForFunction(() => window.showHarness);
    const frame = (position, options) =>
      page.evaluate(
        ([position, options]) => window.showHarness.frame(position, options),
        [position, options || {}],
      );

    let result = await frame(0.2);
    color(result.samples, [255, 0, 0], "first local H.264 MP4");
    assert.ok(result.samples.every((sample) => sample.videos[0].paused));
    result = await frame(1.4, { token: "paused-seek" });
    color(
      result.samples,
      [255, 255, 0],
      "paused seek refreshes the decoded texture",
    );
    assert.ok(
      result.samples.every(
        (sample) => Math.abs(sample.videos[0].time - 1.4) < 0.1,
      ),
    );
    await page.evaluate(() => {
      window.showHarness.project.show.cues[1].sceneId = "warm";
    });
    result = await frame(2.1);
    color(
      result.samples,
      [255, 0, 0],
      "adjacent cues restart the same retained MP4",
    );
    await page.evaluate(() => {
      window.showHarness.project.show.cues[1].sceneId = "blue";
    });
    result = await frame(2.4);
    color(result.samples, [0, 0, 255], "ordered second scene");
    assert.equal(result.resolved.key, "run:blue:0");
    result = await frame(4.2);
    color(result.samples, [255, 0, 0], "same MP4 repeats from its start");
    assert.equal(result.resolved.key, "run:warm-repeat:0");
    result = await frame(5.4);
    color(result.samples, [255, 255, 0], "repeated MP4 can seek independently");

    result = await frame(7.8, { playing: true });
    color(
      result.samples,
      [0, 255, 0],
      "short MP4 holds through a longer scene",
    );
    assert.ok(result.samples.every((sample) => sample.videos[0].paused));
    assert.ok(
      result.samples.every(
        (sample) =>
          Math.abs(
            sample.videos[0].time - (sample.videos[0].duration - 0.001),
          ) < 0.01,
      ),
    );
    result = await frame(9, { playing: true });
    color(result.samples, [0, 255, 0], "non-loop show holds its final scene");
    assert.equal(result.resolved.playing, false);
    result = await frame(9, { playing: true, loop: true });
    color(result.samples, [255, 0, 0], "loop boundary restarts first MP4");
    assert.equal(result.resolved.key, "run:warm-first:1");

    result = await frame(0, { playing: true, now: 1_700_000_005_400 });
    color(
      result.samples,
      [255, 255, 0],
      "independent renderers share the transmitted epoch clock",
    );
    assert.ok(Math.abs(result.resolved.position - 1.4) < 0.001);
    assert.ok(result.samples.every((sample) => !sample.videos[0].paused));
    result = await frame(5.4, { token: "pause", playing: false });
    const held = result.samples.map((sample) => sample.videos[0].time);
    await page.waitForTimeout(250);
    const paused = await page.evaluate(() => window.showHarness.sample());
    paused.forEach((sample, index) =>
      assert.equal(sample.videos[0].time, held[index]),
    );
    result = await frame(5.4, { token: "pause", playing: true });
    assert.ok(result.samples.every((sample) => !sample.videos[0].paused));
    await page.waitForTimeout(120);
    const resumed = await page.evaluate(() => window.showHarness.sample());
    resumed.forEach((sample, index) =>
      assert.ok(sample.videos[0].time > held[index]),
    );

    result = await frame(9 * 1000 + 2.4, { loop: true });
    color(
      result.samples,
      [0, 0, 255],
      "long clock jump selects the correct rotation",
    );
    assert.equal(result.resolved.key, "run:blue:1000");
    await page.evaluate(() => {
      window.showHarness.project.show.cues = [
        { id: "solo", sceneId: "warm", duration: 2 },
      ];
    });
    result = await frame(1.4, { loop: true });
    color(
      result.samples,
      [255, 255, 0],
      "single-scene rotation before its boundary",
    );
    result = await frame(2, { loop: true });
    color(
      result.samples,
      [255, 0, 0],
      "single-scene rotation restarts its retained decoder",
    );
    assert.equal(result.resolved.key, "run:solo:1");
    const inactive = await page.evaluate(() => window.showHarness.inactive());
    assert.ok(
      inactive.every((sample) => sample.videos.length === 0),
      "saved scenes do not autoplay without session transport",
    );
    assert.deepEqual(await page.evaluate(() => window.showHarness.errors), []);
    assert.deepEqual(errors, []);
    console.log(
      "PASS local MP4 show playback: ordered scenes, paused seeks, repeated media, end holds, loop boundaries, pause/resume, shared epoch clock, long jumps, and decoder disposal",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
