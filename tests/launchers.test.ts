import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");
const mac = read("Launch Prism Mapper.command");
const windows = read("Launch Prism Mapper.cmd");

test("the Windows launcher does what the macOS launcher does", () => {
  // Same steps in the same order: Node check, install when the lockfile
  // changed, build, start Electron from the project folder.
  const order = (text: string, steps: string[]) =>
    steps.map((step) => text.indexOf(step));
  const positions = order(windows, [
    "where node",
    "npm ci",
    "npm run build",
    "electron.cmd",
  ]);
  assert.ok(
    positions.every((position) => position > 0),
    String(positions),
  );
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
  );
  assert.deepEqual(
    order(mac, [
      "command -v node",
      "npm ci",
      "npm run build",
      "electron",
    ]).every((p) => p > 0),
    true,
  );
  // Both keep the hash of package-lock.json in the same file, so the packages
  // are installed again only when the lockfile (or Electron itself) changed.
  for (const text of [mac, windows]) {
    assert.match(
      text.replaceAll("\\", "/"),
      /node_modules\/\.prism-lock-sha256/,
    );
    assert.match(text, /sha256/);
    assert.match(text, /package-lock\.json/);
    assert.match(text.replaceAll("\\", "/"), /node_modules\/electron\/dist/);
  }
  assert.match(windows, /cd \/d "%~dp0"/, "runs from the project folder");
});

test("the Windows launcher asks for the Node.js version the project requires", () => {
  const engines: string = JSON.parse(read("package.json")).engines.node;
  const [, major, minor] = /^>=(\d+)\.(\d+)/.exec(engines) ?? [];
  assert.ok(major && minor, engines);
  assert.ok(windows.includes(`major === ${major} && minor >= ${minor}`));
  assert.ok(windows.includes(`Node.js ${major}.${minor} or newer`));
  assert.ok(mac.includes(`Node.js ${major}.${minor} or newer`));
});

test("the Node.js version check of the Windows launcher accepts 22.12 and newer only", () => {
  const check = /^node -e "(const \[major, minor\][^"]*)" >nul 2>nul\r$/m.exec(
    windows,
  )?.[1];
  assert.ok(check, "the version check is in the launcher");
  const exitCode = (version: string) =>
    spawnSync(
      process.execPath,
      [
        "-e",
        `Object.defineProperty(process, "versions", { value: { node: "${version}" } }); ${check}`,
      ],
      { encoding: "utf8" },
    ).status;
  for (const version of ["18.20.4", "20.19.0", "22.0.0", "22.11.9"])
    assert.equal(exitCode(version), 1, version);
  for (const version of ["22.12.0", "22.13.1", "23.0.0", "24.1.0", "26.0.0"])
    assert.equal(exitCode(version), 0, version);
});

test("a double-clicked launcher does not hang in CI and always says what went wrong", () => {
  // pause would wait for a key in a job that has none.
  assert.equal(windows.match(/^if not defined CI pause\r$/gm)?.length, 2);
  for (const failure of [":neednode", ":failed"])
    assert.ok(windows.includes(failure));
  assert.match(windows, /exit \/b 1/);
});

test("batch files are stored so that every checkout has Windows line endings", () => {
  assert.ok(windows.includes("\r\n"));
  assert.ok(!/(?<!\r)\n/.test(windows), "every line ends with CRLF");
  assert.match(read(".gitattributes"), /^\*\.cmd text eol=crlf$/m);
  assert.doesNotMatch(
    windows,
    /[–—]/,
    "no em or en dashes in what people read",
  );
  // A .command file must stay executable for Finder to open it (Windows file
  // systems have no such mode bit, so there is nothing to check there).
  if (process.platform !== "win32")
    assert.ok(
      fs.statSync(path.join(root, "Launch Prism Mapper.command")).mode & 0o111,
    );
});
