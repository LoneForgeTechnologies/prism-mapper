// Checks that only mean something on Windows, against the packaged app (or an
// installed copy of it): where a project's media may live, how those paths are
// written back, and a project file that Notepad has saved. It uses isolated
// profiles, never opens a projector, and (as an administrator, which the GitHub
// runners are) briefly shares one folder to test network paths.
//
//   node tests/packaged-windows.cjs <executable>
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { annotate } = require("./ci.cjs");

const executable = process.argv[2] && path.resolve(process.argv[2]);
const gpu = process.env.CI
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : [];
// A 1 x 1 pixel image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const SHARE = "PrismMapperTest";

function powershell(command) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function projectJson(mediaPath, name = "Windows paths") {
  return {
    version: 2,
    name,
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

async function place(file, contents = PNG) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  return file;
}

async function launch(directory) {
  const app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${path.join(directory, "profile")}`, ...gpu],
    timeout: 45000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(45000);
  // A first start of a fresh app on a busy computer can take much longer than
  // the steps that follow, so the first wait is generous.
  await page
    .getByRole("button", { name: "Save project", exact: true })
    .waitFor({ timeout: 90000 });
  return { app, page };
}

(async () => {
  if (process.platform !== "win32") {
    console.log("Skipped: these checks are for Windows.");
    return;
  }
  if (!executable)
    throw new Error(
      "Pass the packaged executable path: node tests/packaged-windows.cjs <executable>",
    );
  const results = [];
  const check = async (label, run) => {
    try {
      results.push({ label, ok: true, detail: (await run()) || "" });
    } catch (error) {
      results.push({ label, ok: false, detail: error.message });
    }
  };

  // The project folder and the media on another drive: the GitHub runners keep
  // their workspace on D: and the user's temporary folder on C:.
  const workspace = process.env.RUNNER_TEMP || os.tmpdir();
  const scratch = await fs.mkdtemp(path.join(workspace, "prism-windows-"));
  const elsewhere = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-elsewhere-"),
  );
  const projects = path.join(scratch, "projects");
  const shared = path.join(elsewhere, "shared");
  let shareCreated = false;
  let app;
  try {
    const mediaHere = await place(path.join(projects, "media", "probe.png"));
    await place(path.join(scratch, "sibling", "probe.png"));
    const mediaElsewhere = await place(path.join(elsewhere, "probe.png"));
    let deep = path.join(elsewhere, "deep");
    while (deep.length < 320) deep = path.join(deep, "n".repeat(40));
    const mediaDeep = await place(path.join(deep, "probe.png"));
    await place(path.join(shared, "probe.png"));
    const host = os.hostname();
    try {
      powershell(
        `New-SmbShare -Name ${SHARE} -Path '${shared}' -FullAccess Everyone | Out-Null`,
      );
      shareCreated = true;
    } catch (error) {
      // Creating a share needs administrator rights; the runners have them.
      if (process.env.CI) throw error;
    }

    const session = await launch(scratch);
    app = session.app;
    const { page } = session;
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const chooseOpen = (file) =>
      app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, file);
    const chooseSave = (file) =>
      app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
      }, file);
    const open = async (file) => {
      await chooseOpen(file);
      return page.evaluate(() => window.prism.loadProject());
    };
    const write = async (file, mediaPath) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(projectJson(mediaPath)));
      return file;
    };

    // A save dialog that records the file name it was offered.
    const offered = async (name) => {
      await app.evaluate(({ dialog }) => {
        globalThis.offeredName = null;
        dialog.showSaveDialog = async (_window, options) => {
          globalThis.offeredName = options.defaultPath;
          return { canceled: true };
        };
      });
      const project = await page.evaluate(() => window.prism.getProject());
      const result = await page.evaluate(
        (project) => window.prism.saveProject(project),
        { ...project, name },
      );
      assert.equal(result.error, undefined, result.error);
      return app.evaluate(() => globalThis.offeredName);
    };
    await check("save dialog offers a file name Windows accepts", async () => {
      assert.equal(await offered("Show: Act 1?"), "Show- Act 1-.prism.json");
      assert.equal(await offered("CON"), "CON_.prism.json");
      assert.equal(
        await offered("Closing night. "),
        "Closing night.prism.json",
      );
      assert.equal(await offered(""), "Untitled mapping.prism.json");
      return "reserved names, colons, question marks and trailing dots";
    });

    const expectServed = async (label, projectFile, mediaPath, resolved) => {
      await check(label, async () => {
        await write(projectFile, mediaPath);
        const result = await open(projectFile);
        assert.equal(result.error, undefined, result.error);
        assert.deepEqual(result.missing, [], "media reported missing");
        const [entry] = result.project.media;
        assert.match(entry.url, /^media:\/\/local\/[0-9a-f-]+$/);
        if (resolved) assert.equal(entry.path, resolved);
        const got = await page.evaluate(async (url) => {
          try {
            const whole = await fetch(url);
            const bytes = (await whole.arrayBuffer()).byteLength;
            const part = await fetch(url, { headers: { Range: "bytes=0-3" } });
            return {
              status: whole.status,
              type: whole.headers.get("content-type"),
              bytes,
              rangeStatus: part.status,
              rangeBytes: (await part.arrayBuffer()).byteLength,
              rangeOf: part.headers.get("content-range"),
            };
          } catch (error) {
            return { error: String(error) };
          }
        }, entry.url);
        assert.deepEqual(got, {
          status: 200,
          type: "image/png",
          bytes: PNG.length,
          rangeStatus: 206,
          rangeBytes: 4,
          rangeOf: `bytes 0-3/${PNG.length}`,
        });
        return "served whole and by range";
      });
    };
    const expectBlocked = async (label, projectFile, mediaPath) => {
      await check(label, async () => {
        await write(projectFile, mediaPath);
        const result = await open(projectFile);
        assert.equal(result.error, undefined, result.error);
        assert.deepEqual(result.missing, ["probe.png"]);
        const [entry] = result.project.media;
        assert.equal(entry.url, "");
        assert.ok(entry.path, "the path stays, so saving does not lose it");
        return "treated as missing without being touched";
      });
    };

    const file = (name) => path.join(projects, `${name}.prism.json`);
    await expectServed(
      "relative path",
      file("relative"),
      "media/probe.png",
      mediaHere,
    );
    await expectServed(
      "relative path with backslashes",
      file("backslashes"),
      "media\\probe.png",
      mediaHere,
    );
    await expectServed(
      "relative path starting with ./",
      file("dot"),
      "./media/probe.png",
      mediaHere,
    );
    await expectServed(
      "relative path into a sibling folder",
      file("parent"),
      "../sibling/probe.png",
    );
    await expectServed(
      "absolute path on another drive, forward slashes",
      file("other-forward"),
      mediaElsewhere.replaceAll("\\", "/"),
      mediaElsewhere,
    );
    await expectServed(
      "absolute path on another drive, backslashes",
      file("other-back"),
      mediaElsewhere,
      mediaElsewhere,
    );
    await expectServed(
      "extended-length prefix \\\\?\\C:\\",
      file("extended"),
      `\\\\?\\${mediaElsewhere}`,
    );
    await expectServed(
      "path of more than 300 characters",
      file("deep"),
      mediaDeep,
      mediaDeep,
    );
    await expectServed(
      "long path with the \\\\?\\ prefix",
      file("deep-extended"),
      `\\\\?\\${mediaDeep}`,
    );
    await expectServed(
      "project and media in a folder of more than 300 characters",
      path.join(deep, "project.prism.json"),
      "probe.png",
      mediaDeep,
    );

    if (shareCreated) {
      // A project from the internet can name any server, and touching a network
      // path sends the user's credentials there. Only the server the project
      // file itself is on is trusted.
      for (const [label, name] of [
        ["by IP address", "127.0.0.1"],
        ["with forward slashes", "127.0.0.1"],
        ["extended-length UNC", "127.0.0.1"],
        ["by computer name", host],
      ]) {
        const media =
          label === "with forward slashes"
            ? `//${name}/${SHARE}/probe.png`
            : label === "extended-length UNC"
              ? `\\\\?\\UNC\\${name}\\${SHARE}\\probe.png`
              : `\\\\${name}\\${SHARE}\\probe.png`;
        await expectBlocked(
          `network path ${label} from a project on this computer`,
          file(`blocked-${label.replaceAll(" ", "-")}`),
          media,
        );
      }
      for (const [label, name] of [
        ["IP address", "127.0.0.1"],
        ["computer name", host],
        ["localhost", "localhost"],
      ]) {
        const onShare = path.join(
          shared,
          `from-${label.replace(" ", "-")}.prism.json`,
        );
        await fs.writeFile(onShare, JSON.stringify(projectJson("probe.png")));
        const unc = `\\\\${name}\\${SHARE}\\from-${label.replace(" ", "-")}.prism.json`;
        await expectServed(
          `relative media for a project on \\\\${name}\\ (${label})`,
          unc,
          "probe.png",
          `\\\\${name}\\${SHARE}\\probe.png`,
        );
        const own = path.join(
          shared,
          `own-${label.replace(" ", "-")}.prism.json`,
        );
        await fs.writeFile(
          own,
          JSON.stringify(projectJson(`\\\\${name}\\${SHARE}\\probe.png`)),
        );
        await expectServed(
          `absolute media on the same server as the project (${label})`,
          `\\\\${name}\\${SHARE}\\own-${label.replace(" ", "-")}.prism.json`,
          `\\\\${name}\\${SHARE}\\probe.png`,
          `\\\\${name}\\${SHARE}\\probe.png`,
        );
      }
    } else {
      results.push({
        label: "network paths",
        ok: true,
        detail: "skipped (this account cannot create a share)",
      });
    }

    await check("paths are written with forward slashes", async () => {
      const read = async (name) =>
        JSON.parse(await fs.readFile(path.join(projects, name), "utf8"))
          .media[0].path;
      const resave = async (source, target) => {
        const opened = await open(path.join(projects, source));
        assert.equal(opened.error, undefined, opened.error);
        await chooseSave(path.join(projects, target));
        const saved = await page.evaluate(
          (project) => window.prism.saveProject(project),
          opened.project,
        );
        assert.equal(saved.saved, true, saved.error);
        const bytes = await fs.readFile(path.join(projects, target));
        assert.notDeepEqual(
          [...bytes.subarray(0, 3)],
          [0xef, 0xbb, 0xbf],
          "no byte order mark",
        );
        return read(target);
      };
      assert.equal(
        await resave("backslashes.prism.json", "saved-1.prism.json"),
        "media/probe.png",
      );
      assert.equal(
        await resave("parent.prism.json", "saved-2.prism.json"),
        "../sibling/probe.png",
      );
      const sameDrive =
        path.parse(projects).root.toLowerCase() ===
        path.parse(mediaElsewhere).root.toLowerCase();
      assert.equal(
        await resave("other-back.prism.json", "saved-3.prism.json"),
        sameDrive
          ? path.relative(projects, mediaElsewhere).replaceAll("\\", "/")
          : mediaElsewhere.replaceAll("\\", "/"),
      );
      if (shareCreated) {
        assert.equal(
          await resave(
            "blocked-by-IP-address.prism.json",
            "saved-4.prism.json",
          ),
          `//127.0.0.1/${SHARE}/probe.png`,
          "media that was not opened keeps its place in the saved project",
        );
      }
      return "relative, parent, other drive and unopened network media";
    });

    await check("a project saved with a byte order mark opens", async () => {
      // Notepad ("UTF-8 with BOM") and PowerShell 5.1 write one.
      const bom = path.join(projects, "bom.prism.json");
      await fs.writeFile(
        bom,
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(
            JSON.stringify(projectJson("media/probe.png", "From Notepad")),
          ),
        ]),
      );
      const result = await open(bom);
      assert.equal(result.error, undefined, result.error);
      assert.equal(result.project.name, "From Notepad");
      assert.deepEqual(result.missing, []);
      return "opened";
    });

    await check("the page reported no errors", async () => {
      assert.deepEqual(pageErrors, []);
    });
  } finally {
    if (app) await app.close().catch(() => {});
    if (shareCreated) {
      try {
        powershell(`Remove-SmbShare -Name ${SHARE} -Force`);
      } catch (error) {
        console.warn(`Could not remove the test share: ${error.message}`);
      }
    }
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    await fs.rm(elsewhere, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((result) => !result.ok);
  const lines = results.map(
    (result) =>
      `${result.ok ? "PASS" : "FAIL"} ${result.label}${result.detail ? `: ${result.detail}` : ""}`,
  );
  console.log(lines.join("\n"));
  if (failed.length) {
    annotate(
      "error",
      `Windows paths: ${failed.length} of ${results.length} checks failed`,
      lines.filter((line) => line.startsWith("FAIL")).join("\n"),
    );
    process.exitCode = 1;
  } else {
    annotate(
      "notice",
      `Windows paths: ${results.length} checks passed`,
      lines.join("\n"),
    );
  }
})().catch((error) => {
  console.error(error);
  annotate(
    "error",
    "Windows paths: the test could not run",
    error.stack || String(error),
  );
  process.exitCode = 1;
});
