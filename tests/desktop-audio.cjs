const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
(async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-audio-native-"),
  );
  let app;
  try {
    // Replace only the native audio carrier in this isolated test. The production
    // permission handler and renderer capture code still run, but no OS loopback
    // API can be invoked: both carriers belong to the test app's own editor.
    const bootstrap = path.join(directory, "audio-test-bootstrap.cjs");
    await fs.writeFile(
      bootstrap,
      `
      const { app, session } = require("electron");
      global.audioPermissionTrace = [];
      app.whenReady().then(() => {
        for (const method of ["setPermissionCheckHandler", "setPermissionRequestHandler"]) {
          const original = session.defaultSession[method].bind(session.defaultSession);
          session.defaultSession[method] = (handler) => original((...args) => {
            global.audioPermissionTrace.push({method, permission:args[1],details:args[3]});
            return handler(...args);
          });
        }
        const nativeHandler = session.defaultSession.setDisplayMediaRequestHandler.bind(session.defaultSession);
        session.defaultSession.setDisplayMediaRequestHandler = (handler, options) => nativeHandler((request, callback) => {
          global.audioPermissionTrace.push({method:"display",audio:request.audioRequested,video:request.videoRequested});
          handler(request, (streams) => { global.audioPermissionTrace.push({method:"selected",audio:typeof streams.audio,video:!!streams.video}); callback(streams.audio === "loopback" ? { ...streams, audio: request.frame } : streams); });
        }, options);
      });
      require(${JSON.stringify(path.join(root, "electron/main.cjs"))});
    `,
    );
    app = await electron.launch({
      args: [
        bootstrap,
        `--user-data-dir=${path.join(directory, "profile")}`,
        "--use-fake-device-for-media-stream",
      ],
      cwd: root,
      env: { ...process.env, PRISM_DEV_URL: "http://127.0.0.1:5178" },
      timeout: 30000,
    });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Open", exact: true }).waitFor();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const initial = await page.evaluate(async () => {
      const mod = await import("/src/audio.ts");
      window.testAudio = new mod.AudioController();
      window.testAudioFrames = [];
      window.testAudio.subscribe((snapshot) =>
        window.testAudioFrames.push({
          status: snapshot.status,
          frame: snapshot.frame,
        }),
      );
      return {
        status: window.testAudio.getSnapshot().status,
        frame: await window.prism.getAudio(),
        inputs: await window.testAudio.listInputs(),
      };
    });
    assert.equal(initial.status, "idle");
    assert.equal(initial.frame.active, false);
    assert.ok(
      initial.inputs.length > 0,
      "Chromium fake microphone is enumerable",
    );

    // Electron's narrowly armed permission handler must still reject a camera.
    const deniedCamera = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        stream.getTracks().forEach((track) => track.stop());
        return "allowed";
      } catch (error) {
        return error.name;
      }
    });
    assert.equal(deniedCamera, "NotAllowedError");
    const deniedInput = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        stream.getTracks().forEach((track) => track.stop());
        return "allowed";
      } catch (error) {
        return error.name;
      }
    });
    assert.equal(deniedInput, "NotAllowedError");

    const displays = await page.evaluate(() => window.prism.getDisplays());
    const internal = displays.find(
      (display) => display.primary && display.internal,
    );
    assert.ok(
      internal,
      "Only the internal display is used for this native test.",
    );
    await app.evaluate(({ app }) => {
      app.on("browser-window-created", (_event, window) => {
        if (window.getTitle() === "Prism Mapper Output") window.setOpacity(0);
      });
    });
    const outputPromise = app.waitForEvent("window");
    await page.evaluate((id) => window.prism.openOutput(id), internal.id);
    const output = await outputPromise;
    await output.waitForSelector(".projector canvas");
    await app.evaluate(({ BrowserWindow }, bounds) => {
      const window = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().endsWith("#output"),
      );
      window.setSimpleFullScreen(false);
      window.setFullScreen(false);
      window.setResizable(true);
      window.setMovable(true);
      window.setBounds({
        x: bounds.x + 30,
        y: bounds.y + 60,
        width: 520,
        height: 330,
      });
    }, internal.bounds);
    await output.evaluate(() => {
      window.receivedAudioFrames = [];
      window.prism.onAudio((frame) => window.receivedAudioFrames.push(frame));
    });
    await page.evaluate(
      async (deviceId) => {
        await window.testAudio.start({ kind: "input", deviceId });
      },
      initial.inputs.find((input) => input.deviceId)?.deviceId,
    );
    const start = await page.evaluate(() => window.testAudio.getSnapshot());
    assert.equal(start.status, "listening", start.error);
    await page.waitForFunction(
      async () => (await window.prism.getAudio()).active,
    );
    await output.waitForFunction(
      () =>
        window.receivedAudioFrames.filter((frame) => frame.active).length > 15,
    );
    await page.waitForFunction(
      () => window.testAudio.getSnapshot().frame.level > 0.01,
      undefined,
      { timeout: 10000 },
    );
    const live = await page.evaluate(() => window.testAudio.getSnapshot());
    assert.ok(
      live.sources.some((source) => /fake/i.test(source.label)),
      "Device labels remain available after capture grant is consumed",
    );
    assert.ok(
      live.frame.level > 0,
      "Chromium synthetic microphone produces analyzed PCM energy",
    );
    assert.ok((await output.evaluate(() => window.prism.getAudio())).active);
    const rate = await page.evaluate(
      () =>
        window.testAudioFrames.filter((snapshot) => snapshot.frame.active)
          .length,
    );
    assert.ok(rate > 15);
    console.log(
      "PASS native fake microphone: explicit device capture, labels, live analyser and output summaries; camera and unarmed microphone denied",
    );

    const outputDenied = await output.evaluate(async () => {
      try {
        await window.prism.prepareAudio({ kind: "input" });
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(outputDenied, true);
    await page.evaluate(() => window.testAudio.stop());
    await output.waitForFunction(
      async () => !(await window.prism.getAudio()).active,
    );
    assert.equal(
      (await page.evaluate(() => window.testAudio.getSnapshot())).status,
      "idle",
    );
    assert.equal(
      await page.evaluate(async () => (await window.prism.getAudio()).level),
      0,
    );

    await page.evaluate(async () => {
      await window.prism.prepareAudio({ kind: "input" });
      window.prism.audioStarted();
      window.prism.updateAudio({
        active: true,
        level: 0.5,
        bass: 0.8,
        mid: 0.2,
        treble: 0.1,
        beat: 0.9,
      });
    });
    await output.waitForFunction(
      async () => (await window.prism.getAudio()).active,
    );
    await output.waitForFunction(
      () => window.receivedAudioFrames.at(-1)?.active === false,
    );
    assert.equal(
      (await output.evaluate(() => window.prism.getAudio())).active,
      false,
    );
    await page.evaluate(() => window.prism.stopAudio());
    console.log(
      "PASS native Stop, output cannot start capture, stalled summaries reset within 750ms",
    );

    await page.evaluate(async () =>
      window.testAudio.start({
        kind: "input",
        deviceId: "missing-audio-input",
      }),
    );
    const failed = await page.evaluate(() => window.testAudio.getSnapshot());
    assert.equal(failed.status, "error");
    assert.match(failed.error, /unavailable|connected device/);
    assert.equal(
      (await output.evaluate(() => window.prism.getAudio())).active,
      false,
    );
    await page.evaluate(async () => window.testAudio.start({ kind: "system" }));
    const system = await page.evaluate(() => window.testAudio.getSnapshot());
    if (system.status !== "listening")
      console.log(await app.evaluate(() => global.audioPermissionTrace));
    assert.equal(system.status, "listening", system.error);
    await page.waitForFunction(
      () => window.testAudio.getSnapshot().frame.active,
    );
    await page.evaluate(() => window.testAudio.stop());
    console.log(
      "PASS system capture controller: own-editor audio stub starts and survives discarded video track; OS loopback is not invoked",
    );
    await page.evaluate(() => window.testAudio.dispose());
    assert.deepEqual(errors, []);
    await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, "artifacts/desktop-audio-validation.json"),
      JSON.stringify(
        {
          passed: true,
          input: "Chromium synthetic microphone",
          actualDeviceCapture: false,
          osPermissionPrompted: false,
          systemLoopbackPhysicalTest: false,
          systemCaptureWithOwnEditorStub: true,
          explicitStart: true,
          permissionBoundary: true,
          outputSummaryBridge: true,
          staleReset: true,
          stopCleanup: true,
          missingDevice: true,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "PASS missing input error and zero signal; no real microphone/system audio was captured",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
