// Native integration smoke. Builds must exist. Opens only the editor, never a projector.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const baseProject = {
  version: 1,
  name: "Media integration test",
  width: 1920,
  height: 1080,
  surfaces: [
    {
      id: "test-surface",
      name: "Test surface",
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
      source: "grid",
      visible: true,
      locked: false,
      opacity: 1,
      color: "#ffffff",
    },
  ],
  media: [],
  brightness: 0.65,
  blackout: false,
  playing: true,
};

async function setOpenDialog(app, paths) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, paths);
}

async function samplePixel(page, channel) {
  return page.evaluate(async (channel) => {
    const started = performance.now();
    let latest = [];
    while (performance.now() - started < 12000) {
      latest = await new Promise((resolve) =>
        requestAnimationFrame(() => {
          const canvas =
            document.querySelector(".stage canvas") ||
            document.querySelector("canvas");
          const gl = canvas.getContext("webgl");
          const pixel = new Uint8Array(4);
          gl.readPixels(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixel,
          );
          resolve([...pixel]);
        }),
      );
      if (
        latest[channel] > 100 &&
        latest[(channel + 1) % 3] < 45 &&
        latest[(channel + 2) % 3] < 45
      )
        return latest;
    }
    throw new Error(
      `Expected channel ${channel} from imported texture; got ${latest}. Renderer: ${document.querySelector("canvas").dataset.renderError || "no reported error"}`,
    );
  }, channel);
}

(async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-media-smoke-"),
  );
  let app;
  try {
    const blankPath = path.join(directory, "blank.prism.json");
    const imagePath = path.join(directory, "red-test.png");
    const videoPath = path.join(directory, "blue-test.webm");
    const savedPath = path.join(directory, "saved.prism.json");
    await fs.writeFile(blankPath, JSON.stringify(baseProject));
    app = await electron.launch({
      args: [".", `--user-data-dir=${path.join(directory, "profile")}`],
      cwd: root,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
      timeout: 30000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.getByRole("button", { name: "Open", exact: true }).waitFor();
    await setOpenDialog(app, [blankPath]);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.waitForFunction(
      async () =>
        (await window.prism.getProject())?.name === "Media integration test",
    );

    const imageBase64 = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgb(240,20,10)";
      ctx.fillRect(0, 0, 32, 32);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await fs.writeFile(imagePath, Buffer.from(imageBase64, "base64"));
    await setOpenDialog(app, [imagePath]);
    await page
      .getByRole("button", { name: "Import media", exact: true })
      .click();
    await page
      .getByRole("button", { name: "red-test.png", exact: true })
      .click();
    const imagePixel = await samplePixel(page, 0);
    const imageMedia = await page.evaluate(async () =>
      (await window.prism.getProject()).media.find(
        (media) => media.kind === "image",
      ),
    );
    assert.match(imageMedia.url, /^media:\/\/local\/[a-f0-9-]+$/);

    const range = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { Range: "bytes=2-5" } });
      return {
        status: response.status,
        range: response.headers.get("Content-Range"),
        bytes: [...new Uint8Array(await response.arrayBuffer())],
      };
    }, imageMedia.url);
    const imageBytes = await fs.readFile(imagePath);
    assert.equal(
      range.status,
      206,
      "Local media must support byte-range responses",
    );
    assert.equal(range.range, `bytes 2-5/${imageBytes.length}`);
    assert.deepEqual(range.bytes, [...imageBytes.subarray(2, 6)]);

    const videoBase64 = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      const stream = canvas.captureStream(15);
      const chunks = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp8",
      });
      const stopped = new Promise((resolve, reject) => {
        recorder.ondataavailable = (event) => chunks.push(event.data);
        recorder.onstop = resolve;
        recorder.onerror = reject;
      });
      recorder.start();
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = "rgb(10,20,240)";
        ctx.fillRect(0, 0, 64, 64);
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const bytes = new Uint8Array(
        await new Blob(chunks, { type: "video/webm" }).arrayBuffer(),
      );
      return btoa(String.fromCharCode(...bytes));
    });
    await fs.writeFile(videoPath, Buffer.from(videoBase64, "base64"));
    await setOpenDialog(app, [videoPath]);
    await page
      .getByRole("button", { name: "Import media", exact: true })
      .click();
    await page
      .getByRole("button", { name: "blue-test.webm", exact: true })
      .click();
    const videoPixel = await samplePixel(page, 2);
    const videoMedia = await page.evaluate(async () =>
      (await window.prism.getProject()).media.find(
        (media) => media.kind === "video",
      ),
    );
    const videoProbe = await page.evaluate(async (url) => {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () =>
          reject(new Error("Imported video did not decode"));
      });
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 250));
      video.pause();
      const result = {
        width: video.videoWidth,
        height: video.videoHeight,
        currentTime: video.currentTime,
        readyState: video.readyState,
      };
      video.removeAttribute("src");
      video.load();
      return result;
    }, videoMedia.url);
    assert.equal(videoProbe.width, 64);
    assert.equal(videoProbe.height, 64);
    assert.ok(
      videoProbe.currentTime > 0,
      "Imported video playback must advance",
    );

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, savedPath);
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Project saved" })
      .waitFor();
    const saved = JSON.parse(await fs.readFile(savedPath, "utf8"));
    assert.equal(saved.media.length, 2);
    assert.equal(saved.media[0].path, "red-test.png");
    assert.equal(saved.media[0].url, undefined);
    await page
      .getByRole("combobox", { name: "Surface source" })
      .selectOption("grid");
    await setOpenDialog(app, [savedPath]);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await samplePixel(page, 2);

    const rejectedURL = await page.evaluate(
      async () => (await fetch("media://local/not-authorized")).status,
    );
    assert.equal(rejectedURL, 404);
    assert.deepEqual(pageErrors, []);
    console.log(
      JSON.stringify(
        {
          passed: true,
          imagePixel,
          range,
          videoPixel,
          videoProbe,
          projectRoundTrip: true,
          unregisteredMedia: rejectedURL,
        },
        null,
        2,
      ),
    );
  } finally {
    if (app) await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
