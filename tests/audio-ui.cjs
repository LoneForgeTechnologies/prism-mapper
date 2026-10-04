const { launchBrowser, baseUrl } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

// Run the real analyser against a synthetic MediaStream. Never opens an actual mic or speaker.
(async () => {
  const browser = await launchBrowser({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({
    viewport: { width: 1460, height: 940 },
  });
  await context.addInitScript(() => {
    const state = (window.__audioTest = {
      calls: [],
      active: 0,
      stopped: 0,
      deny: false,
      gate: null,
      silence: false,
      empty: false,
      frequency: 120,
      tracks: [],
    });
    // hold() makes the next capture requests wait until release(). A fixed
    // delay is a race on a slow machine: the pending state can be over before
    // the test has had time to click Cancel.
    state.hold = () => {
      state.gate = new Promise((resolve) => {
        state.open = resolve;
      });
    };
    state.release = () => {
      state.open?.();
      state.gate = null;
    };
    const devices = navigator.mediaDevices;
    Object.defineProperty(devices, "enumerateDevices", {
      value: async () => [
        {
          kind: "audioinput",
          deviceId: "default",
          label: "Default microphone",
        },
        { kind: "audioinput", deviceId: "studio", label: "Studio input" },
        { kind: "audioinput", deviceId: "loopback", label: "Virtual loopback" },
        { kind: "audiooutput", deviceId: "speaker", label: "Speaker" },
      ],
    });
    Object.defineProperty(devices, "getUserMedia", {
      value: async (constraints) => {
        state.calls.push(constraints);
        if (state.deny)
          throw new DOMException(
            "Permission denied by test",
            "NotAllowedError",
          );
        if (state.gate) await state.gate;
        if (state.empty) return new MediaStream();
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        oscillator.frequency.value = state.frequency;
        const gain = audio.createGain();
        gain.gain.value = state.silence ? 0 : 0.38;
        const destination = audio.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        await audio.resume();
        state.active++;
        const track = destination.stream.getAudioTracks()[0];
        const stop = track.stop.bind(track);
        let stopped = false;
        track.stop = () => {
          stop();
          if (stopped) return;
          stopped = true;
          state.active--;
          state.stopped++;
          oscillator.stop();
          void audio.close();
        };
        state.tracks.push(track);
        return destination.stream;
      },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const draft = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("prism-draft")));
  const range = async (name, value) => {
    const input = page.getByRole("slider", { name, exact: true });
    await input.scrollIntoViewIfNeeded();
    await input.evaluate((element, next) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(element, String(next));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    assert.equal(await input.inputValue(), String(value));
  };
  const waitStopped = () =>
    page.waitForFunction(() => window.__audioTest.active === 0);
  const waitSignal = () =>
    page.waitForFunction(
      () =>
        Number(
          document
            .querySelector('[aria-label="Level audio level"]')
            .getAttribute("aria-valuenow"),
        ) > 20,
    );
  try {
    await page.goto(baseUrl());
    await page.waitForSelector("#audio-react-panel", { state: "attached" });
    await button("Open audio react controls").click();
    assert.equal(
      await page.evaluate(() => window.__audioTest.calls.length),
      0,
      "opening controls must not capture audio",
    );
    assert.equal(
      await page
        .getByLabel("Audio input device", { exact: true })
        .locator("option")
        .count(),
      3,
    );
    assert.equal(
      await page
        .getByLabel("React this layer to audio", { exact: true })
        .isChecked(),
      false,
    );
    assert.equal(
      await page
        .getByLabel("Audio response band", { exact: true })
        .isDisabled(),
      true,
    );
    const originalCorners = (await draft()).surfaces[0].corners;

    await page.getByLabel("React this layer to audio", { exact: true }).check();
    await page
      .getByLabel("Audio response band", { exact: true })
      .selectOption("beat");
    await page
      .getByLabel("Audio response mode", { exact: true })
      .selectOption("both");
    await range("Audio response strength", 0.82);
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("prism-draft")).surfaces[0].audio
          ?.amount === 0.82,
    );
    assert.deepEqual((await draft()).surfaces[0].audio, {
      enabled: true,
      band: "beat",
      amount: 0.82,
      mode: "both",
    });
    assert.deepEqual((await draft()).surfaces[0].corners, originalCorners);
    await page
      .getByLabel("Audio input device", { exact: true })
      .selectOption("studio");
    await button("Start listening").click();
    await button("Stop listening").waitFor();
    await waitSignal();
    assert.deepEqual(
      await page.evaluate(() => window.__audioTest.calls[0].audio.deviceId),
      { exact: "studio" },
    );
    assert.equal(
      await page.evaluate(() => window.__audioTest.calls[0].video),
      false,
    );
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector('[aria-label="Bass audio level"]')
            .getAttribute("aria-valuenow"),
        ) > 15,
    );

    await page.locator(".audio-tuning > summary").click();
    await range("Audio gain", 1.5);
    await range("Audio noise gate", 0.05);
    await range("Audio smoothing", 0.8);
    assert.equal(
      await page.evaluate(() => window.__audioTest.calls.length),
      1,
      "tuning must not restart capture",
    );
    await button("Refresh audio inputs").click();
    assert.equal(await page.evaluate(() => window.__audioTest.calls.length), 1);
    await button("Stop listening").click();
    await waitStopped();
    assert.equal(
      await page
        .getByRole("meter", { name: "Level audio level", exact: true })
        .getAttribute("aria-valuenow"),
      "0",
    );

    // A different selected input stops the old track and requires a deliberate restart.
    await button("Start listening").click();
    await button("Stop listening").waitFor();
    await page
      .getByLabel("Audio input device", { exact: true })
      .selectOption("loopback");
    await waitStopped();
    await button("Start listening").waitFor();
    assert.equal(await page.evaluate(() => window.__audioTest.calls.length), 2);
    await button("Start listening").click();
    await waitSignal();
    assert.deepEqual(
      await page.evaluate(() => window.__audioTest.calls.at(-1).audio.deviceId),
      { exact: "loopback" },
    );

    // OS output wording is honest and the browser exposes a useful desktop-only message.
    await page
      .getByLabel("Audio source", { exact: true })
      .selectOption("system");
    await waitStopped();
    assert.equal(
      await page.getByLabel("Audio input device", { exact: true }).count(),
      0,
    );
    await button("Start listening").click();
    await page.getByRole("alert").filter({ hasText: "desktop app" }).waitFor();
    assert.equal(await page.evaluate(() => window.__audioTest.calls.length), 3);

    // Permission failures are clear, and retrying can recover without reloading.
    await page
      .getByLabel("Audio source", { exact: true })
      .selectOption("input");
    await page.evaluate(() => {
      window.__audioTest.deny = true;
    });
    await button("Start listening").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Microphone permission was denied" })
      .waitFor();
    await page.evaluate(() => {
      window.__audioTest.deny = false;
    });
    await button("Start listening").click();
    await waitSignal();
    await page.evaluate(() =>
      window.__audioTest.tracks.at(-1).dispatchEvent(new Event("ended")),
    );
    await page.getByRole("alert").filter({ hasText: "disconnected" }).waitFor();
    await waitStopped();

    // Cancelling a pending permission/capture result also stops its eventual stream.
    await page.evaluate(() => window.__audioTest.hold());
    await button("Start listening").click();
    await button("Cancel listening").click();
    await page.evaluate(() => window.__audioTest.release());
    await page.waitForFunction(() => window.__audioTest.stopped >= 5);
    await waitStopped();
    await button("Start listening").waitFor();

    await page.evaluate(() => {
      window.__audioTest.empty = true;
    });
    await button("Start listening").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "returned no audio" })
      .waitFor();
    await waitStopped();
    await page.evaluate(() => {
      window.__audioTest.empty = false;
    });

    // Mask response cannot modulate cutout geometry or darkness.
    await page.getByRole("tab", { name: "Surface", exact: true }).click();
    await page.getByLabel("Layer type", { exact: true }).selectOption("mask");
    await page.getByRole("tab", { name: "Audio react", exact: true }).click();
    assert.equal(
      await page
        .getByLabel("React this layer to audio", { exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByLabel("React this layer to audio", { exact: true })
        .isChecked(),
      false,
    );
    await page.getByRole("tab", { name: "Surface", exact: true }).click();
    await page
      .getByLabel("Layer type", { exact: true })
      .selectOption("surface");
    await page.getByRole("tab", { name: "Audio react", exact: true }).click();
    assert.equal(
      await page
        .getByLabel("React this layer to audio", { exact: true })
        .isChecked(),
      true,
    );

    await page.reload();
    await page.waitForSelector("#audio-react-panel", { state: "attached" });
    assert.equal(
      await page.evaluate(() => window.__audioTest.calls.length),
      0,
      "restoring response settings must not restore capture",
    );
    assert.deepEqual((await draft()).surfaces[0].audio, {
      enabled: true,
      band: "beat",
      amount: 0.82,
      mode: "both",
    });
    assert.deepEqual((await draft()).surfaces[0].corners, originalCorners);
    assert.equal(
      await page.getByLabel("Audio input device", { exact: true }).inputValue(),
      "",
    );
    await button("Open audio react controls").click();
    await fs.mkdir(path.resolve(__dirname, "../artifacts"), {
      recursive: true,
    });
    await button("Start listening").click();
    await waitSignal();
    await page.screenshot({
      path: path.resolve(__dirname, "../artifacts/audio-react-panel-wide.png"),
    });
    await page.setViewportSize({ width: 1120, height: 740 });
    await button("Open audio react controls").click();
    await page.locator(".audio-panel-body").waitFor({ state: "visible" });
    const fit = await page.locator("#audio-react-panel").evaluate((panel) => ({
      panel: panel.getBoundingClientRect().width,
      body: panel.querySelector(".audio-panel-body").scrollWidth,
    }));
    assert.ok(
      fit.body <= fit.panel + 2,
      `audio panel overflows: ${JSON.stringify(fit)}`,
    );
    await fs.mkdir(path.resolve(__dirname, "../artifacts"), {
      recursive: true,
    });
    await page.locator(".audio-capture-button").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.resolve(__dirname, "../artifacts/audio-react-panel.png"),
    });
    // Switching inspector tabs never interrupts capture. Both tabs remain keyboard reachable.
    await page
      .getByLabel("React this layer to audio", { exact: true })
      .uncheck();
    await page.getByLabel("React this layer to audio", { exact: true }).check();
    await button("Toggle projector settings").click();
    assert.equal(
      await button("Toggle projector settings").getAttribute("aria-expanded"),
      "true",
    );
    await button("Toggle projector settings").click();
    assert.equal(
      await button("Toggle projector settings").getAttribute("aria-expanded"),
      "false",
    );
    // Global capture controls remain available even after the last surface is deleted.
    await page.getByRole("tab", { name: "Surface", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__audioTest.active), 1);
    await button("Delete surface").click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("prism-draft")).surfaces.length === 0,
    );
    await page.getByRole("tab", { name: "Audio react", exact: true }).click();
    await button("Stop listening").waitFor();
    assert.equal(
      await page
        .getByLabel("React this layer to audio", { exact: true })
        .isDisabled(),
      true,
    );
    await button("Stop listening").click();
    await waitStopped();
    assert.deepEqual(errors, []);
    console.log(
      "Audio UI passed: explicit capture, device selection, real analyser meters, tuning, per-layer persistence, clean stop/switch/cancel/disconnect, permissions, mask exclusion, browser output fallback, compact layout.",
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
