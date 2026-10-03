// The Windows installer, exercised for real on a Windows machine: it installs
// silently, the installed program is tested by the other packaged tests, a
// project is opened through the registered Windows commands, a second Setup
// updates a copy that is running, and the uninstaller removes everything.
// Everything happens in one work folder; nothing needs a person or a projector.
//
//   node tests/packaged-installer.cjs install   <Setup.exe> <work folder>
//   node tests/packaged-installer.cjs integrate <work folder>
//   node tests/packaged-installer.cjs upgrade   <Setup.exe> <work folder>
//   node tests/packaged-installer.cjs uninstall <work folder>
//
// The installed program is <work folder>\Prism Mapper\Prism Mapper.exe.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const pkg = require("../package.json");
const { annotate } = require("./ci.cjs");

// These match scripts/windows-installer.iss (tests/windows-installer.test.ts
// checks that they do).
const APP_GUID = "{B6F0A8D2-3C41-4E7B-9A5D-1F2E6C8D4B73}";
const PROG_ID = "PrismMapper.Project";
const VERB = "PrismMapperOpen";
const UNINSTALL = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_GUID}_is1`;
const CLASSES = "Software\\Classes";
// Keys the installer may create on the way to its own; they must not be left
// behind if they did not exist before.
const PARENT_KEYS = [
  `${CLASSES}\\.json\\OpenWithProgids`,
  `${CLASSES}\\.json`,
  `${CLASSES}\\SystemFileAssociations\\.json\\shell`,
  `${CLASSES}\\SystemFileAssociations\\.json`,
  `${CLASSES}\\SystemFileAssociations`,
];
const gpu = process.env.CI
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : [];
const SETUP_MINUTES = 8;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, { timeout, label }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline)
      throw new Error(`${label} did not happen within ${timeout / 1000} s`);
    await sleep(500);
  }
}

function powershell(script, timeout = 90000) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", timeout, windowsHide: true },
  );
  if (result.status !== 0)
    throw new Error(
      `PowerShell exited with ${result.status}: ${result.stderr || result.stdout}`,
    );
  return result.stdout.trim();
}
const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;

// The values of a registry key, or null when the key does not exist.
function registry(root, key) {
  const result = spawnSync("reg.exe", ["query", `${root}\\${key}`], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (match) values[match[1]] = match[3] ?? "";
  }
  return values;
}
const defaultValue = (values) => {
  const value = values?.["(Default)"];
  return value === "(value not set)" ? undefined : value;
};

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `${path.basename(file)} did not finish within ${timeout / 1000} s`,
        ),
      );
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function paths(work) {
  const directory = path.join(work, "Prism Mapper");
  return {
    work,
    directory,
    executable: path.join(directory, "Prism Mapper.exe"),
    uninstaller: path.join(directory, "unins000.exe"),
    state: path.join(work, "state.json"),
    logs: path.join(work, "logs"),
    projects: path.join(work, "projects with spaces"),
  };
}

function project(name) {
  return {
    version: 2,
    name,
    width: 1920,
    height: 1080,
    surfaces: [
      {
        id: "only",
        name: "Only surface",
        corners: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
        source: "grid",
        visible: true,
        locked: false,
        opacity: 1,
        color: "#ffffff",
      },
    ],
    media: [],
    brightness: 0.5,
    blackout: false,
    playing: true,
  };
}

// Folders the shell uses, and the shortcut files Setup makes in them.
function shortcutFiles() {
  const [menu, desktop] = powershell(
    "[Environment]::GetFolderPath('Programs'); [Environment]::GetFolderPath('DesktopDirectory')",
  ).split(/\r?\n/);
  return {
    menu: path.join(menu.trim(), "Prism Mapper.lnk"),
    examples: path.join(menu.trim(), "Prism Mapper example projects.lnk"),
    desktop: path.join(desktop.trim(), "Prism Mapper.lnk"),
  };
}
function shortcutTarget(file) {
  return JSON.parse(
    powershell(
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(file)}); ConvertTo-Json -Compress @{ target = $s.TargetPath; icon = $s.IconLocation }`,
    ),
  );
}
function versionInfo(file) {
  return JSON.parse(
    powershell(
      `$v = (Get-Item -LiteralPath ${quote(file)}).VersionInfo; ConvertTo-Json -Compress @{ product = $v.ProductName; productVersion = $v.ProductVersion; fileVersion = $v.FileVersion; description = $v.FileDescription; company = $v.CompanyName; copyright = $v.LegalCopyright }`,
    ),
  );
}

async function tail(file, lines = 40) {
  try {
    return (await fs.readFile(file, "utf8"))
      .split(/\r?\n/)
      .slice(-lines)
      .join("\n");
  } catch {
    return "(no log)";
  }
}

function setupArguments(directory, log, extra = []) {
  return [
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/SP-",
    ...extra,
    `/LOG=${log}`,
    `/DIR=${directory}`,
  ];
}

async function launchInstalled(executable, profile, args = []) {
  const app = await electron.launch({
    executablePath: executable,
    args: [...(profile ? [`--user-data-dir=${profile}`] : []), ...gpu, ...args],
    timeout: 45000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page
    .getByRole("button", { name: "Save project", exact: true })
    .waitFor();
  return { app, page };
}

function killInstalledProgram() {
  spawnSync("taskkill.exe", ["/F", "/T", "/IM", "Prism Mapper.exe"], {
    windowsHide: true,
    stdio: "ignore",
  });
}

// ---------------------------------------------------------------------------

async function install([setup, work]) {
  const where = paths(path.resolve(work));
  const lines = [];
  await fs.rm(where.work, { recursive: true, force: true });
  await fs.mkdir(where.logs, { recursive: true });
  const before = {};
  for (const key of PARENT_KEYS) before[key] = registry("HKCU", key) !== null;
  await fs.writeFile(where.state, JSON.stringify({ before }));

  const log = path.join(where.logs, "install.log");
  const started = Date.now();
  const code = await run(
    path.resolve(setup),
    setupArguments(where.directory, log, ["/MERGETASKS=desktopicon"]),
    SETUP_MINUTES * 60000,
  );
  lines.push(
    `Setup exited with ${code} after ${Math.round((Date.now() - started) / 1000)} s`,
  );
  assert.equal(code, 0, `Setup exited with ${code}\n${await tail(log)}`);

  for (const relative of [
    "Prism Mapper.exe",
    "unins000.exe",
    "resources/app/package.json",
    "resources/app/electron/main.cjs",
    "resources/app/dist/index.html",
    "resources/app/build/icon.ico",
    "Licenses/Prism-Mapper-LICENSE.txt",
    "Licenses/THIRD_PARTY_NOTICES.md",
    "Licenses/ELECTRON-LICENSE.txt",
    "Example projects/indoor-cube.prism.json",
    "Example projects/architectural-study.prism.json",
    "Example projects/halloween-haunt.prism.json",
  ])
    assert.ok(
      existsSync(path.join(where.directory, ...relative.split("/"))),
      `${relative} was not installed`,
    );
  lines.push(
    "files: program, uninstaller, application, licenses, example projects",
  );

  // 0.4.1 (or 0.5.0-rc.1) is 0.4.1.0 (0.5.0.0) in the file properties.
  const numeric = `${/^\d+\.\d+\.\d+/.exec(pkg.version)[0]}.0`;
  const exe = versionInfo(where.executable);
  assert.equal(exe.product, "Prism Mapper");
  assert.equal(exe.fileVersion, numeric);
  assert.equal(exe.company, "Prism Mapper contributors");
  const installer = versionInfo(path.resolve(setup));
  assert.equal(installer.product, "Prism Mapper");
  assert.equal(installer.productVersion, numeric);
  assert.equal(installer.fileVersion, numeric);
  assert.equal(installer.description, "Prism Mapper Setup");
  assert.equal(installer.company, "Prism Mapper contributors");
  assert.match(installer.copyright, /^Copyright \(c\) \d{4} /);
  lines.push(
    `Setup.exe properties: ${installer.description}, ${installer.fileVersion}, ${installer.company}`,
  );

  const entry = registry("HKCU", UNINSTALL);
  assert.ok(entry, "the uninstall entry for this user is missing");
  assert.equal(entry.DisplayName, "Prism Mapper");
  assert.equal(entry.DisplayVersion, pkg.version);
  assert.equal(entry.Publisher, "Prism Mapper contributors");
  assert.equal(entry.InstallLocation, `${where.directory}\\`);
  assert.equal(entry.DisplayIcon, where.executable);
  assert.match(entry.UninstallString, /unins000\.exe"/);
  assert.equal(
    registry("HKLM", UNINSTALL),
    null,
    "a per-user install must not write machine-wide",
  );
  lines.push(
    "uninstall entry: this user only, name, version, publisher, location",
  );

  const command = `"${where.executable}" "%1"`;
  assert.equal(
    defaultValue(registry("HKCU", `${CLASSES}\\${PROG_ID}`)),
    "Prism Mapper project",
  );
  assert.equal(
    defaultValue(registry("HKCU", `${CLASSES}\\${PROG_ID}\\DefaultIcon`)),
    `${where.executable},0`,
  );
  assert.equal(
    defaultValue(
      registry("HKCU", `${CLASSES}\\${PROG_ID}\\shell\\open\\command`),
    ),
    command,
  );
  const withProgIds = registry("HKCU", `${CLASSES}\\.json\\OpenWithProgids`);
  assert.ok(
    withProgIds && PROG_ID in withProgIds,
    "not in the Open with list for .json",
  );
  const verbKey = `${CLASSES}\\SystemFileAssociations\\.json\\shell\\${VERB}`;
  const verb = registry("HKCU", verbKey);
  assert.equal(defaultValue(verb), "Open in Prism Mapper");
  assert.equal(verb.AppliesTo, 'System.FileName:"*.prism.json"');
  assert.equal(verb.Icon, `${where.executable},0`);
  assert.equal(defaultValue(registry("HKCU", `${verbKey}\\command`)), command);
  assert.equal(
    defaultValue(registry("HKCU", `${CLASSES}\\.json`)),
    undefined,
    "the default program for every JSON file must not be set",
  );
  lines.push(
    'file types: Open with list and the "Open in Prism Mapper" command, .json default untouched',
  );

  const links = shortcutFiles();
  for (const [name, file] of Object.entries(links)) {
    assert.ok(existsSync(file), `${name} shortcut is missing: ${file}`);
  }
  assert.equal(shortcutTarget(links.menu).target, where.executable);
  assert.equal(shortcutTarget(links.desktop).target, where.executable);
  assert.equal(
    shortcutTarget(links.examples).target,
    path.join(where.directory, "Example projects"),
  );
  lines.push("shortcuts: Start Menu, example projects, desktop (asked for)");

  const logText = await fs.readFile(log, "utf8");
  assert.match(logText, /Installation process succeeded\./);
  return lines;
}

async function integrate([work]) {
  const where = paths(path.resolve(work));
  const lines = [];
  await fs.mkdir(where.projects, { recursive: true });
  const first = path.join(where.projects, "Opened by verb.prism.json");
  const second = path.join(where.projects, "Opened by Open with.prism.json");
  const plain = path.join(where.projects, "plain.json");
  await fs.writeFile(first, JSON.stringify(project("Opened by the command")));
  await fs.writeFile(second, JSON.stringify(project("Opened by Open with")));
  await fs.writeFile(plain, "{}");

  // Which commands Explorer offers for each file.
  const verbs = JSON.parse(
    powershell(
      `$shell = New-Object -ComObject Shell.Application; $rows = foreach ($file in ${quote(first)}, ${quote(plain)}) { $item = $shell.Namespace((Split-Path $file)).ParseName((Split-Path $file -Leaf)); [pscustomobject]@{ file = (Split-Path $file -Leaf); verbs = @($item.Verbs() | ForEach-Object { $_.Name }) } }; ConvertTo-Json -Compress -InputObject @($rows)`,
    ),
  );
  const offered = (name) =>
    verbs
      .find((row) => row.file === name)
      .verbs.some((verb) => /Open in Prism Mapper/.test(verb));
  const summary = verbs
    .map((row) => `${row.file}: ${row.verbs.length} commands`)
    .join("; ");
  if (verbs.every((row) => row.verbs.length === 0)) {
    lines.push(`context menu commands could not be listed here (${summary})`);
  } else {
    assert.ok(
      offered("Opened by verb.prism.json"),
      `"Open in Prism Mapper" is not offered for a project file (${JSON.stringify(verbs)})`,
    );
    assert.ok(
      !offered("plain.json"),
      `"Open in Prism Mapper" is offered for every JSON file (${JSON.stringify(verbs)})`,
    );
    lines.push(
      `context menu: "Open in Prism Mapper" for *.prism.json only (${summary})`,
    );
  }

  // A copy of the program is running (the default profile, as for a person);
  // the Windows commands then start the program again, which hands the file over.
  const { app, page } = await launchInstalled(where.executable, null);
  try {
    await page.evaluate(() => {
      window.__opened = [];
      window.prism.onProjectOpened((result) => window.__opened.push(result));
    });
    const waitForCount = (count) =>
      page.waitForFunction((count) => window.__opened.length >= count, count, {
        timeout: 45000,
      });
    powershell(`Start-Process -FilePath ${quote(first)} -Verb ${VERB}`, 60000);
    await waitForCount(1);
    let opened = await page.evaluate(() => window.__opened);
    assert.equal(opened[0].error, undefined, opened[0].error);
    assert.equal(opened[0].project.name, "Opened by the command");
    assert.equal(opened[0].path, first);
    lines.push(
      '"Open in Prism Mapper" (Start-Process -Verb) opened the project in the running copy',
    );

    // What Explorer runs for "Open with > Prism Mapper": the registered command
    // with the file in place of %1.
    const template = defaultValue(
      registry("HKCU", `${CLASSES}\\${PROG_ID}\\shell\\open\\command`),
    );
    assert.equal(template, `"${where.executable}" "%1"`);
    const child = spawn(where.executable, [second], {
      windowsHide: true,
      stdio: "ignore",
    });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    await waitForCount(2);
    opened = await page.evaluate(() => window.__opened);
    assert.equal(opened[1].project.name, "Opened by Open with");
    assert.equal(opened[1].path, second);
    assert.equal(
      await Promise.race([exited, sleep(30000).then(() => "still running")]),
      0,
      "the second program must hand over and exit",
    );
    lines.push(
      "the Open with command also hands the project to the running copy",
    );
    assert.equal(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
      1,
    );
  } finally {
    await app.close().catch(() => {});
    killInstalledProgram();
  }
  return lines;
}

async function upgrade([setup, work]) {
  const where = paths(path.resolve(work));
  const lines = [];
  const stale = path.join(
    where.directory,
    "resources",
    "app",
    "left-by-old-version.txt",
  );
  const example = path.join(
    where.directory,
    "Example projects",
    "indoor-cube.prism.json",
  );
  const original = await fs.readFile(example);
  const { app } = await launchInstalled(
    where.executable,
    path.join(where.work, "profile-upgrade"),
  );
  const main = app.process();
  const exited = new Promise((resolve) => main.once("exit", resolve));
  try {
    await fs.writeFile(stale, "from an older version");
    await fs.writeFile(example, "damaged");
    const log = path.join(where.logs, "upgrade.log");
    const started = Date.now();
    const code = await run(
      path.resolve(setup),
      setupArguments(where.directory, log),
      SETUP_MINUTES * 60000,
    );
    lines.push(
      `Setup over a running copy exited with ${code} after ${Math.round((Date.now() - started) / 1000)} s`,
    );
    assert.equal(code, 0, `Setup exited with ${code}\n${await tail(log)}`);
    const result = await Promise.race([
      exited,
      sleep(15000).then(() => "still running"),
    ]);
    assert.notEqual(
      result,
      "still running",
      `the running copy was not closed\n${await tail(log)}`,
    );
    lines.push("the running copy was closed by Setup");
  } finally {
    await app.close().catch(() => {});
    killInstalledProgram();
  }
  assert.ok(
    !existsSync(stale),
    "a file of the old application was left behind",
  );
  assert.deepEqual(
    await fs.readFile(example),
    original,
    "the example project was not restored",
  );
  assert.equal(registry("HKCU", UNINSTALL).DisplayVersion, pkg.version);
  lines.push(
    "old application files removed, installed files restored, one uninstall entry",
  );

  // The updated copy starts.
  const again = await launchInstalled(
    where.executable,
    path.join(where.work, "profile-after-upgrade"),
  );
  await again.app.close();
  lines.push("the updated program starts");
  return lines;
}

async function uninstall([work]) {
  const where = paths(path.resolve(work));
  const lines = [];
  const { before } = JSON.parse(await fs.readFile(where.state, "utf8"));
  const links = shortcutFiles();
  killInstalledProgram();
  const log = path.join(where.logs, "uninstall.log");
  const code = await run(
    where.uninstaller,
    ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", `/LOG=${log}`],
    SETUP_MINUTES * 60000,
  );
  lines.push(`uninstaller exited with ${code}`);
  assert.equal(code, 0, `uninstaller exited with ${code}\n${await tail(log)}`);
  // The uninstaller hands over to a temporary copy of itself, so the removal
  // finishes shortly after the process the person started has gone.
  const started = Date.now();
  await waitFor(() => !existsSync(where.directory), {
    timeout: 90000,
    label: `removal of ${where.directory} (${existsSync(where.directory) ? "still there" : "gone"})`,
  }).catch(async (error) => {
    const left = existsSync(where.directory)
      ? (await fs.readdir(where.directory)).join(", ")
      : "";
    throw new Error(`${error.message}; left: ${left}\n${await tail(log)}`);
  });
  lines.push(
    `install folder gone after ${Math.round((Date.now() - started) / 1000)} s`,
  );

  assert.equal(
    registry("HKCU", UNINSTALL),
    null,
    "the uninstall entry is still there",
  );
  assert.equal(registry("HKCU", `${CLASSES}\\${PROG_ID}`), null);
  assert.equal(
    registry(
      "HKCU",
      `${CLASSES}\\SystemFileAssociations\\.json\\shell\\${VERB}`,
    ),
    null,
  );
  const withProgIds = registry("HKCU", `${CLASSES}\\.json\\OpenWithProgids`);
  assert.ok(
    !withProgIds || !(PROG_ID in withProgIds),
    "still in the Open with list",
  );
  for (const key of PARENT_KEYS)
    if (!before[key])
      assert.equal(
        registry("HKCU", key),
        null,
        `${key} was not there before and is now`,
      );
  lines.push(
    "registry: uninstall entry, file type entries and the keys made for them are gone",
  );
  for (const [name, file] of Object.entries(links))
    assert.ok(!existsSync(file), `${name} shortcut is still there`);
  lines.push("shortcuts gone");
  return lines;
}

const phases = { install, integrate, upgrade, uninstall };

(async () => {
  if (process.platform !== "win32") {
    console.log("Skipped: the installer is for Windows.");
    return;
  }
  const [phase, ...rest] = process.argv.slice(2);
  const needed = { install: 2, upgrade: 2, integrate: 1, uninstall: 1 }[phase];
  if (!needed || rest.length !== needed || rest.some((argument) => !argument))
    throw new Error(
      "Usage: node tests/packaged-installer.cjs install|upgrade <Setup.exe> <work folder>, or integrate|uninstall <work folder>",
    );
  const lines = await phases[phase](rest);
  console.log(`PASS installer ${phase}:\n  ${lines.join("\n  ")}`);
  annotate("notice", `Installer ${phase}`, lines.join("\n"));
})().catch((error) => {
  console.error(error);
  annotate("error", "Installer test failed", error.stack || String(error));
  process.exitCode = 1;
});
