// TEMPORARY probe, removed before the branch is finished. Prints what the
// packaged app does on this OS so decisions rest on measurements.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const executable = path.resolve(process.argv[2]);
const only = process.argv[3] || "all";
const ci = process.env.CI
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : [];
const report = {};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function powershell(command) {
  try {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    return `FAILED: ${String(error.stderr || error.message).trim()}`;
  }
}

async function launch(extra = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prism-probe-"));
  const app = await electron.launch({
    executablePath: executable,
    args: [
      `--user-data-dir=${path.join(directory, "profile")}`,
      ...ci,
      ...extra,
    ],
    timeout: 45000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page
    .getByRole("button", { name: "Save project", exact: true })
    .waitFor();
  return { app, page, directory };
}

async function section(name, run) {
  if (only !== "all" && only !== name) return;
  const started = Date.now();
  console.error(`[probe] ${name} starting`);
  try {
    report[name] = await run();
  } catch (error) {
    report[name] = {
      failed: String(error && error.stack ? error.stack : error),
    };
  }
  report[`${name}Seconds`] = Math.round((Date.now() - started) / 1000);
  console.error(`[probe] ${name} finished in ${report[`${name}Seconds`]} s`);
}

async function geometry(scale) {
  const { app, page, directory } = await launch(
    scale ? [`--force-device-scale-factor=${scale}`] : [],
  );
  try {
    const native = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const display = screen.getPrimaryDisplay();
      const read = () => ({
        bounds: win.getBounds(),
        contentBounds: win.getContentBounds(),
        minimum: win.getMinimumSize(),
        maximized: win.isMaximized(),
      });
      const initial = read();
      win.setContentSize(200, 200);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        display: {
          bounds: display.bounds,
          workArea: display.workArea,
          scaleFactor: display.scaleFactor,
        },
        menuBar: win.isMenuBarVisible(),
        initial,
        atMinimum: read(),
      };
    });
    const view = await page.evaluate(() => {
      const root = document.documentElement;
      const shell = document
        .querySelector(".app-shell")
        .getBoundingClientRect();
      return {
        innerWidth,
        innerHeight,
        devicePixelRatio,
        scrollWidth: root.scrollWidth,
        scrollHeight: root.scrollHeight,
        shell: [Math.round(shell.width), Math.round(shell.height)],
      };
    });
    return { scale: scale || "default", native, view };
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function projectJson(mediaPath) {
  return {
    version: 2,
    name: "Probe",
    width: 1920,
    height: 1080,
    surfaces: [
      {
        id: "s1",
        name: "Surface",
        corners: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
        source: "m1",
        visible: true,
        locked: false,
        opacity: 1,
        color: "#ffffff",
      },
    ],
    media: [{ id: "m1", name: "probe.png", kind: "image", path: mediaPath }],
    brightness: 0.65,
    blackout: false,
    playing: true,
  };
}

async function media() {
  const { app, page, directory } = await launch();
  const results = [];
  const workspace = process.env.RUNNER_TEMP || os.tmpdir();
  const projectDirectory = await fs.mkdtemp(
    path.join(workspace, "probe-project-"),
  );
  const shareName = "PrismProbe";
  const shareDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "probe-share-"),
  );
  try {
    const place = async (...parts) => {
      const file = path.join(...parts);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, PNG);
      return file;
    };
    await place(projectDirectory, "media", "probe.png");
    await place(projectDirectory, "..", "probe-sibling", "probe.png");
    const otherDrive = await place(
      os.tmpdir(),
      "probe-other-drive",
      "probe.png",
    );
    let long = path.join(os.tmpdir(), "probe-long");
    while (long.length < 320) long = path.join(long, "n".repeat(40));
    const longFile = await place(long, "probe.png");
    await place(shareDirectory, "probe.png");
    const share =
      process.platform === "win32"
        ? powershell(
            `New-SmbShare -Name ${shareName} -Path '${shareDirectory}' -FullAccess Everyone | Out-String`,
          )
        : "n/a";
    const host = os.hostname();
    const cases = [
      ["relative", "media/probe.png"],
      ["relative-backslash", "media\\probe.png"],
      ["relative-dot", "./media/probe.png"],
      ["relative-parent", `../probe-sibling/probe.png`],
      ["other-drive-forward", otherDrive.replaceAll("\\", "/")],
      ["other-drive-backslash", otherDrive],
      ["extended-prefix", `\\\\?\\${otherDrive}`],
      ["long-path", longFile],
      ["long-path-extended", `\\\\?\\${longFile}`],
      ["unc-hostname", `\\\\${host}\\${shareName}\\probe.png`],
      ["unc-127", `\\\\127.0.0.1\\${shareName}\\probe.png`],
      ["unc-localhost", `\\\\localhost\\${shareName}\\probe.png`],
      ["unc-forward-slashes", `//127.0.0.1/${shareName}/probe.png`],
      ["unc-extended", `\\\\?\\UNC\\${host}\\${shareName}\\probe.png`],
      ["unc-relative-from-share", "probe.png", "share"],
    ];
    for (const [label, mediaPath, where] of cases) {
      const projectFile =
        where === "share"
          ? `\\\\127.0.0.1\\${shareName}\\${label}.prism.json`
          : path.join(projectDirectory, `${label}.prism.json`);
      if (where === "share")
        await fs.writeFile(
          path.join(shareDirectory, `${label}.prism.json`),
          JSON.stringify(projectJson(mediaPath)),
        );
      else
        await fs.writeFile(projectFile, JSON.stringify(projectJson(mediaPath)));
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, projectFile);
      const started = Date.now();
      const result = await page.evaluate(() => window.prism.loadProject());
      const loadMs = Date.now() - started;
      const entry = result.project && result.project.media[0];
      let fetched = null;
      if (entry && entry.url) {
        fetched = await page.evaluate(async (url) => {
          const out = {};
          try {
            const response = await fetch(url);
            out.status = response.status;
            out.type = response.headers.get("content-type");
            out.bytes = (await response.arrayBuffer()).byteLength;
          } catch (error) {
            out.error = String(error);
          }
          try {
            const response = await fetch(url, {
              headers: { Range: "bytes=0-3" },
            });
            out.rangeStatus = response.status;
            out.rangeBytes = (await response.arrayBuffer()).byteLength;
          } catch (error) {
            out.rangeError = String(error);
          }
          return out;
        }, entry.url);
      }
      results.push({
        label,
        mediaPath,
        loadMs,
        error: result.error,
        missing: result.missing,
        resolved: entry && entry.path,
        registered: Boolean(entry && entry.url),
        fetched,
      });
    }
    // A project saved with media on another drive, and one with media beside it.
    const saves = [];
    for (const label of ["relative", "other-drive-forward", "unc-127"]) {
      const projectFile = path.join(projectDirectory, `${label}.prism.json`);
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, projectFile);
      const loaded = await page.evaluate(() => window.prism.loadProject());
      const target = path.join(projectDirectory, `saved-${label}.prism.json`);
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async (_window, options) => {
          globalThis.probeDefaultPath = options && options.defaultPath;
          return { canceled: false, filePath: file };
        };
      }, target);
      const saved = await page.evaluate(
        (project) => window.prism.saveProject(project),
        loaded.project,
      );
      let text = "";
      try {
        text = JSON.parse(await fs.readFile(target, "utf8")).media[0].path;
      } catch (error) {
        text = `unreadable: ${error.message}`;
      }
      saves.push({ label, saved, writtenPath: text });
    }
    // A UTF-8 byte order mark, as Notepad and PowerShell 5.1 write one.
    const bomFile = path.join(projectDirectory, "bom.prism.json");
    await fs.writeFile(
      bomFile,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(JSON.stringify(projectJson("media/probe.png"))),
      ]),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, bomFile);
    const bom = await page.evaluate(() => window.prism.loadProject());
    return {
      share,
      host,
      results,
      saves,
      bom: { error: bom.error, loaded: Boolean(bom.project) },
    };
  } finally {
    if (process.platform === "win32")
      powershell(`Remove-SmbShare -Name ${shareName} -Force`);
    await app.close();
  }
}

async function systemAudio() {
  const { app, page, directory } = await launch();
  try {
    const session = await page.context().newCDPSession(page);
    const prepared = await page.evaluate(() =>
      window.prism.prepareAudio({ kind: "system" }),
    );
    const expression = `(async () => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
        const tracks = stream.getAudioTracks().map((t) => t.label + ":" + t.readyState);
        stream.getTracks().forEach((t) => t.stop());
        return { ok: true, tracks };
      } catch (error) {
        return { ok: false, name: error.name, message: error.message };
      }
    })()`;
    const result = await session.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    return { prepared, result: result.result.value || result.exceptionDetails };
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function lines() {
  const out = [report.platform];
  const geometry = Array.isArray(report.geometry) ? report.geometry : [];
  for (const g of geometry) {
    const n = g.native;
    const c = n.initial.contentBounds;
    const m = n.atMinimum.contentBounds;
    out.push(
      `geometry scale=${g.scale} screen=${n.display.bounds.width}x${n.display.bounds.height} work=${n.display.workArea.width}x${n.display.workArea.height} menuBar=${n.menuBar} initial=${n.initial.bounds.width}x${n.initial.bounds.height} content=${c.width}x${c.height}@${c.x},${c.y} maximized=${n.initial.maximized} min=${n.initial.minimum} atMinimumContent=${m.width}x${m.height} page=${g.view.innerWidth}x${g.view.innerHeight} pageScroll=${g.view.scrollWidth}x${g.view.scrollHeight}`,
    );
  }
  if (report.geometry && report.geometry.failed)
    out.push(`geometry FAILED ${report.geometry.failed}`);
  const m = report.media;
  if (m && m.failed) out.push(`media FAILED ${m.failed}`);
  if (m && m.results) {
    out.push(`share: ${String(m.share).replace(/\s+/g, " ")} host=${m.host}`);
    for (const r of m.results) {
      const f = r.fetched;
      out.push(
        `media ${r.label} load=${r.loadMs}ms error=${r.error || "-"} missing=${(r.missing || []).length} registered=${r.registered} fetch=${f ? `${f.status ?? f.error} ${f.bytes ?? ""} type=${f.type} range=${f.rangeStatus ?? f.rangeError}` : "-"} resolved=${r.resolved}`,
      );
    }
    for (const r of m.saves)
      out.push(
        `save ${r.label}: ${JSON.stringify(r.saved)} wrote=${r.writtenPath}`,
      );
    out.push(`bom: ${JSON.stringify(m.bom)}`);
  }
  if (report.systemAudio)
    out.push(`systemAudio ${JSON.stringify(report.systemAudio)}`);
  for (const key of Object.keys(report))
    if (key.endsWith("Seconds")) out.push(`${key}=${report[key]}`);
  return out;
}

(async () => {
  report.platform = `${process.platform} ${os.release()} node ${process.version}`;
  await section("geometry", async () => {
    const all = [];
    for (const scale of [undefined, 1.25, 1.5]) all.push(await geometry(scale));
    return all;
  });
  await section("media", media);
  await section("systemAudio", systemAudio);
  console.log(lines().join("\n"));
})().catch((error) => {
  console.error(error);
  console.log(lines().join("\n"));
  process.exitCode = 1;
});
