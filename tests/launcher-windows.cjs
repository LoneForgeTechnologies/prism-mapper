// "Launch Prism Mapper.cmd" run for real on Windows, with stand-ins for npm and
// for Electron so that it takes seconds and needs no network: a copy of the
// launcher sits in a folder (with a space in its name) beside a package-lock.json,
// and a fake npm records what it was asked to do.
//
//   node tests/launcher-windows.cjs
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { annotate } = require("./ci.cjs");

const repository = path.resolve(__dirname, "..");
const LAUNCHER = "Launch Prism Mapper.cmd";

// What npm does for the launcher: ci makes the packages (here, an electron.exe
// and the electron.cmd that records its start), run build does nothing. Setting
// FAKE_FAIL to ci or build makes that step fail.
const FAKE_NPM = `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.LAUNCH_LOG, "npm " + args.join(" ") + "\\n");
if (args[0] === "ci") {
  if (process.env.FAKE_FAIL === "ci") process.exit(1);
  fs.mkdirSync("node_modules/electron/dist", { recursive: true });
  fs.writeFileSync("node_modules/electron/dist/electron.exe", "");
  fs.mkdirSync("node_modules/.bin", { recursive: true });
  fs.writeFileSync(
    "node_modules/.bin/electron.cmd",
    '@echo off\\r\\necho electron %* >> "%LAUNCH_LOG%"\\r\\nexit /b 0\\r\\n',
  );
}
if (args[0] === "run" && args[1] === "build" && process.env.FAKE_FAIL === "build")
  process.exit(1);
`;

const sha256 = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function prepare() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prism launcher test "),
  );
  fs.copyFileSync(
    path.join(repository, LAUNCHER),
    path.join(directory, LAUNCHER),
  );
  fs.writeFileSync(
    path.join(directory, "package-lock.json"),
    JSON.stringify({ name: "stand-in", lockfileVersion: 3 }),
  );
  const tools = path.join(directory, "tools");
  fs.mkdirSync(tools);
  fs.writeFileSync(
    path.join(tools, "npm.cmd"),
    `@"${process.execPath}" "%~dp0fake-npm.cjs" %*\r\n`,
  );
  fs.writeFileSync(path.join(tools, "fake-npm.cjs"), FAKE_NPM);
  return { directory, tools, log: path.join(directory, "launch.log") };
}

// Runs the launcher the way a double-click does (from another working folder),
// and returns its exit code, its output and the commands the fake npm and the
// fake Electron recorded.
function launch(site, { fail, withNode = true } = {}) {
  fs.rmSync(site.log, { force: true });
  const system = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
  // Environment variable names are not case sensitive on Windows, and the one
  // that is already there (usually "Path") would win over a second spelling.
  const pathKey =
    Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ||
    "PATH";
  const result = spawnSync(`"${path.join(site.directory, LAUNCHER)}"`, [], {
    cwd: os.tmpdir(),
    shell: true,
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true,
    env: {
      ...process.env,
      // CI makes the launcher skip its "press a key" pause.
      CI: "1",
      LAUNCH_LOG: site.log,
      FAKE_FAIL: fail || "",
      [pathKey]: withNode
        ? `${site.tools};${process.env[pathKey]}`
        : `${site.tools};${system}`,
    },
  });
  const recorded = fs.existsSync(site.log)
    ? fs
        .readFileSync(site.log, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return {
    status: result.status,
    output: `${result.stdout || ""}${result.stderr || ""}`,
    recorded,
    problem: result.error,
  };
}

const stamp = (site) =>
  path.join(site.directory, "node_modules", ".prism-lock-sha256");
const savedHash = (site) =>
  fs.existsSync(stamp(site))
    ? fs.readFileSync(stamp(site), "utf8").trim()
    : null;
const lock = (site) => path.join(site.directory, "package-lock.json");

function expect(run, status, recorded, label) {
  assert.ifError(run.problem);
  assert.equal(run.status, status, `${label}: exit code\n${run.output}`);
  assert.deepEqual(run.recorded, recorded, `${label}: ${run.output}`);
}

(async () => {
  if (process.platform !== "win32") {
    console.log("Skipped: the launcher is for Windows.");
    return;
  }
  const site = prepare();
  const lines = [];
  try {
    const start = ["npm ci", "npm run build", "electron ."];
    const first = launch(site);
    expect(first, 0, start, "first run");
    assert.match(first.output, /Installing packages/);
    assert.match(first.output, /Starting Prism Mapper/);
    assert.equal(savedHash(site), sha256(lock(site)));
    lines.push(
      "first run: installs, builds, starts Electron and remembers the lockfile hash",
    );

    expect(launch(site), 0, ["npm run build", "electron ."], "second run");
    lines.push("second run: lockfile unchanged, so no install");

    fs.writeFileSync(
      lock(site),
      JSON.stringify({ name: "stand-in", lockfileVersion: 3, changed: true }),
    );
    expect(launch(site), 0, start, "after the lockfile changed");
    assert.equal(savedHash(site), sha256(lock(site)));
    lines.push("lockfile changed: installs again and stores the new hash");

    fs.rmSync(path.join(site.directory, "node_modules", "electron"), {
      recursive: true,
    });
    expect(launch(site), 0, start, "Electron missing");
    lines.push("Electron folder missing: installs again");

    const building = launch(site, { fail: "build" });
    expect(building, 1, ["npm run build"], "build failure");
    assert.match(building.output, /could not be started/);
    lines.push("build fails: says so, exits 1 and does not start Electron");

    fs.writeFileSync(
      lock(site),
      JSON.stringify({ name: "stand-in", lockfileVersion: 3, changed: 2 }),
    );
    const before = savedHash(site);
    const installing = launch(site, { fail: "ci" });
    expect(installing, 1, ["npm ci"], "install failure");
    assert.match(installing.output, /could not be started/);
    assert.equal(
      savedHash(site),
      before,
      "a failed install must not mark the packages as installed",
    );
    lines.push(
      "install fails: exits 1, no build, the lockfile hash is not stored",
    );

    const without = launch(site, { withNode: false });
    expect(without, 1, [], "no Node.js");
    assert.match(without.output, /Node\.js 22\.12 or newer is required/);
    lines.push("no Node.js on the path: says which version is needed, exits 1");

    console.log(`PASS Windows launcher:\n  ${lines.join("\n  ")}`);
    annotate("notice", "Launch Prism Mapper.cmd", lines.join("\n"));
  } finally {
    fs.rmSync(site.directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  annotate(
    "error",
    "Launch Prism Mapper.cmd failed",
    error.stack || String(error),
  );
  process.exitCode = 1;
});
