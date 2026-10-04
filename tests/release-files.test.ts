import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMBINED,
  parseChecksumFile,
  requiredFiles,
  verifyReleaseFiles,
  // @ts-expect-error The release scripts intentionally run as plain Node ESM.
} from "../scripts/verify-release-files.mjs";

const version = "0.4.1";
const sha = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

// A folder as the release job sees it after downloading the artifacts of the
// build jobs: every file beside the SHA-256 file its job made for it.
function downloads(extra: Record<string, string> = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "prism-release-"));
  const put = (name: string, contents: string) => {
    fs.writeFileSync(path.join(folder, name), contents);
    fs.writeFileSync(
      path.join(folder, `${name}.sha256`),
      `${sha(contents)}  ${name}\n`,
    );
  };
  for (const name of requiredFiles(version)) put(name, `contents of ${name}`);
  for (const [name, contents] of Object.entries(extra)) put(name, contents);
  return { folder, put };
}
const done = (folder: string) =>
  fs.rmSync(folder, { recursive: true, force: true });

test("a release needs the two Mac ZIPs, the Windows ZIP and the Windows installer", () => {
  assert.deepEqual(requiredFiles("0.4.1"), [
    "Prism-Mapper-v0.4.1-macOS-arm64.zip",
    "Prism-Mapper-v0.4.1-macOS-x64.zip",
    "Prism-Mapper-v0.4.1-Windows-x64.zip",
    "Prism-Mapper-v0.4.1-Windows-x64-Setup.exe",
  ]);
  assert.throws(() => requiredFiles("../0.4.1"));
});

test("matching files are accepted and listed in the combined checksum file", async () => {
  const { folder } = downloads({
    // Whatever else the build jobs produce is released too.
    "Prism-Mapper-v0.4.1-Android.apk": "android",
    "Prism-Mapper-v0.4.1-iPhone-Simulator.zip": "ios",
  });
  try {
    const { files, combined } = await verifyReleaseFiles({ folder, version });
    assert.equal(files.length, 6);
    assert.deepEqual(
      files.map((file: { name: string }) => file.name),
      [...files.map((file: { name: string }) => file.name)].sort(),
    );
    assert.equal(
      fs.readFileSync(path.join(folder, COMBINED), "utf8"),
      combined,
    );
    assert.ok(combined.endsWith("\n"));
    const lines = combined.trimEnd().split("\n");
    assert.equal(lines.length, 6);
    for (const line of lines) {
      const [, checksum, name] = /^([0-9a-f]{64}) {2}(.+)$/.exec(line) ?? [];
      assert.equal(
        checksum,
        sha(fs.readFileSync(path.join(folder, name))),
        name,
      );
    }
    // The combined file is what people verify their download with.
    const checker = spawnSync("sha256sum", ["--check", COMBINED], {
      cwd: folder,
      encoding: "utf8",
    });
    if (!checker.error) assert.equal(checker.status, 0, checker.stdout);
  } finally {
    done(folder);
  }
});

test("a file that changed after it was built is refused", async () => {
  const { folder } = downloads();
  try {
    const name = requiredFiles(version)[2];
    fs.appendFileSync(path.join(folder, name), "damaged in transfer");
    await assert.rejects(
      verifyReleaseFiles({ folder, version }),
      new RegExp(`${name} does not match its checksum`),
    );
    assert.ok(
      !fs.existsSync(path.join(folder, COMBINED)),
      "no combined file for a refused release",
    );
  } finally {
    done(folder);
  }
});

test("every file needs a checksum file and every checksum file a file", async () => {
  let site = downloads();
  try {
    fs.rmSync(path.join(site.folder, `${requiredFiles(version)[0]}.sha256`));
    await assert.rejects(
      verifyReleaseFiles({ folder: site.folder, version }),
      /No checksum file for Prism-Mapper-v0\.4\.1-macOS-arm64\.zip/,
    );
  } finally {
    done(site.folder);
  }
  site = downloads();
  try {
    fs.writeFileSync(
      path.join(site.folder, "Prism-Mapper-v0.4.1-gone.zip.sha256"),
      `${sha("x")}  Prism-Mapper-v0.4.1-gone.zip\n`,
    );
    await assert.rejects(
      verifyReleaseFiles({ folder: site.folder, version }),
      /Prism-Mapper-v0\.4\.1-gone\.zip\.sha256 has no matching file/,
    );
  } finally {
    done(site.folder);
  }
});

test("a checksum file must name its own file and use the sha256sum format", async () => {
  const name = requiredFiles(version)[1];
  let site = downloads();
  try {
    fs.writeFileSync(
      path.join(site.folder, `${name}.sha256`),
      `${sha(`contents of ${name}`)}  other.zip\n`,
    );
    await assert.rejects(
      verifyReleaseFiles({ folder: site.folder, version }),
      /names other\.zip, not Prism-Mapper-v0\.4\.1-macOS-x64\.zip/,
    );
  } finally {
    done(site.folder);
  }
  for (const text of [
    "",
    "abc  file.zip\n",
    `${sha("x")} file.zip\n`,
    `${sha("x")}  dir/file.zip\n`,
    `${sha("x")}  file.zip\n${sha("y")}  other.zip\n`,
  ])
    assert.throws(
      () => parseChecksumFile(text, "x.sha256"),
      /not a SHA-256/,
      text,
    );
  assert.deepEqual(
    parseChecksumFile(`${sha("x").toUpperCase()}  file.zip\r\n`, "x"),
    { checksum: sha("x"), name: "file.zip" },
  );
  site = downloads();
  try {
    fs.writeFileSync(path.join(site.folder, `${name}.sha256`), "garbage\n");
    await assert.rejects(
      verifyReleaseFiles({ folder: site.folder, version }),
      /is not a SHA-256 file/,
    );
  } finally {
    done(site.folder);
  }
});

test("a release without one of its desktop downloads is refused", async () => {
  for (const missing of requiredFiles(version)) {
    const { folder } = downloads();
    try {
      fs.rmSync(path.join(folder, missing));
      fs.rmSync(path.join(folder, `${missing}.sha256`));
      await assert.rejects(
        verifyReleaseFiles({ folder, version }),
        new RegExp(`Missing ${missing.replaceAll(".", "\\.")}`),
      );
    } finally {
      done(folder);
    }
  }
  // Files of another version do not count.
  const { folder } = downloads();
  try {
    await assert.rejects(
      verifyReleaseFiles({ folder, version: "0.4.2" }),
      /Missing Prism-Mapper-v0\.4\.2-/,
    );
  } finally {
    done(folder);
  }
});

test("downloads that are not flat are refused", async () => {
  const { folder } = downloads();
  try {
    fs.mkdirSync(path.join(folder, "desktop-win32-x64"));
    await assert.rejects(
      verifyReleaseFiles({ folder, version }),
      /desktop-win32-x64 in .* is not a file/,
    );
  } finally {
    done(folder);
  }
});

test("the script prints what it verified and fails with a non-zero exit code otherwise", () => {
  const { folder } = downloads();
  try {
    const script = path.join(
      import.meta.dirname,
      "..",
      "scripts",
      "verify-release-files.mjs",
    );
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    const good = run(folder, version);
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /4 files verified\./);
    assert.match(good.stdout, /SHA256SUMS\.txt:/);
    assert.notEqual(run().status, 0);
    assert.notEqual(run(folder, "9.9.9").status, 0);
  } finally {
    done(folder);
  }
});
