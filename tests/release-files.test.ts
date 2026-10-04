import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMBINED,
  optionalFiles,
  parseChecksumFile,
  requiredFiles,
  verifyReleaseFiles,
  // @ts-expect-error The release scripts intentionally run as plain Node ESM.
} from "../scripts/verify-release-files.mjs";
import {
  releaseNotes,
  // @ts-expect-error The release scripts intentionally run as plain Node ESM.
} from "../scripts/release-notes.mjs";

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
    // The phone builds are optional.
    "Prism-Mapper-v0.4.1-Android.apk": "android",
    "Prism-Mapper-v0.4.1-iOS-unsigned.ipa": "ios",
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

test("the optional downloads are the Android APK and the unsigned iOS IPA", () => {
  assert.deepEqual(optionalFiles("0.4.1"), [
    "Prism-Mapper-v0.4.1-Android.apk",
    "Prism-Mapper-v0.4.1-iOS-unsigned.ipa",
  ]);
});

test("a file that no release carries is refused, even with a matching checksum", async () => {
  for (const name of [
    // Store bundles, simulator and debug builds must never reach the release.
    "Prism-Mapper-v0.4.1-Android.aab",
    "Prism-Mapper-v0.4.1-Android-release.apk",
    "Prism-Mapper-v0.4.1-iOS-appstore.ipa",
    "Prism-Mapper-v0.4.1-iOS-Simulator.zip",
    "app-debug.apk",
    // A leftover of another version.
    "Prism-Mapper-v0.4.0-Android.apk",
  ]) {
    const { folder } = downloads({ [name]: "something else" });
    try {
      await assert.rejects(
        verifyReleaseFiles({ folder, version }),
        new RegExp(
          `${name.replaceAll(".", "\\.")} is not a file that a 0\\.4\\.1 release carries`,
        ),
        name,
      );
      assert.ok(
        !fs.existsSync(path.join(folder, COMBINED)),
        "no combined file for a refused release",
      );
    } finally {
      done(folder);
    }
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
  // Files of another version are refused, they do not count.
  const { folder } = downloads();
  try {
    await assert.rejects(
      verifyReleaseFiles({ folder, version: "0.4.2" }),
      /Prism-Mapper-v0\.4\.1-.* is not a file that a 0\.4\.2 release carries/,
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

test("the release notes name every download and say what to expect from unsigned apps", () => {
  const notes: string = releaseNotes(version);
  for (const name of requiredFiles(version))
    assert.ok(notes.includes(`\`${name}\``), name);
  for (const phrase of [
    "SHA256SUMS.txt",
    "not code-signed",
    "Windows protected your PC",
    "More info",
    "Run anyway",
    "Unblock",
    "not notarized",
    "Open Anyway",
    "Get-FileHash",
    "shasum -a 256",
    "physical projector",
    // The project is honest about how it was made and tested.
    "half vibe-coded, half-tested",
    "AI coding assistants",
    "GitHub Issues",
    // The phone and tablet builds.
    "Prism-Mapper-v0.4.1-Android.apk",
    "Prism-Mapper-v0.4.1-iOS-unsigned.ipa",
    "Play Protect",
    "Sideloadly",
    // Updating over an installed copy is not promised.
    "uninstall Prism Mapper first",
    "save your projects as files",
    "GitHub release assets",
    "runs locally without an internet connection",
    "No internet connection is required after installation",
  ])
    assert.ok(notes.includes(phrase), phrase);
  assert.doesNotMatch(notes, /debug key/, "builds get a new key each time");
  assert.doesNotMatch(notes, /https?:\/\/|web app|Safari|Add to Home Screen/i);
  assert.doesNotMatch(notes, /[–—]/, "no dash punctuation");
  assert.doesNotMatch(notes, /\{\{|undefined|\$\{|false/);
  assert.ok(notes.endsWith("\n"));
  assert.throws(() => releaseNotes("../1.0.0"));
});

test("the release notes point only at phone builds that are in the release", () => {
  const desktop = requiredFiles(version);
  const bare: string = releaseNotes(version, desktop);
  assert.doesNotMatch(
    bare,
    /Android\.apk|iOS-unsigned|Sideloadly|Play Protect/,
  );
  assert.match(bare, /\| iPhone or iPad \| Build it with Xcode on a Mac \|/);
  assert.ok(bare.includes("docs/building-mobile.md"));

  const android: string = releaseNotes(version, [
    ...desktop,
    "Prism-Mapper-v0.4.1-Android.apk",
  ]);
  assert.match(
    android,
    /\| Android phone or tablet \| `Prism-Mapper-v0\.4\.1-Android\.apk` \|/,
  );
  assert.doesNotMatch(android, /iOS-unsigned/);
  assert.match(android, /\| iPhone or iPad \| Build it with Xcode on a Mac \|/);

  const ios: string = releaseNotes(version, [
    ...desktop,
    "Prism-Mapper-v0.4.1-iOS-unsigned.ipa",
  ]);
  assert.doesNotMatch(ios, /Android\.apk|Play Protect/);
  assert.match(
    ios,
    /\| iPhone or iPad \| `Prism-Mapper-v0\.4\.1-iOS-unsigned\.ipa` for sideloading \|/,
  );
  assert.ok(ios.includes("The `.ipa` file is unsigned."));
  assert.ok(ios.includes("Sideloadly"));

  const both: string = releaseNotes(version, [
    ...desktop,
    "Prism-Mapper-v0.4.1-Android.apk",
    "Prism-Mapper-v0.4.1-iOS-unsigned.ipa",
  ]);
  assert.match(
    both,
    /\| iPhone or iPad \| `Prism-Mapper-v0\.4\.1-iOS-unsigned\.ipa` for sideloading \|/,
  );
});

test("the notes script reads local downloads without fetching a hosted site", () => {
  const { folder } = downloads({
    "Prism-Mapper-v0.4.1-Android.apk": "android",
  });
  try {
    const script = path.join(
      import.meta.dirname,
      "..",
      "scripts",
      "release-notes.mjs",
    );
    // Fail the subprocess even if a future network check catches fetch errors.
    const noFetch =
      "data:text/javascript,globalThis.fetch=()=>{process.stderr.write('Unexpected network request');process.exit(99)}";
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["--import", noFetch, script, ...args], {
        encoding: "utf8",
      });
    const notes = run(version, folder);
    assert.equal(notes.status, 0, notes.stderr);
    assert.ok(notes.stdout.includes("Prism-Mapper-v0.4.1-Android.apk"));
    assert.ok(!notes.stdout.includes("iOS-unsigned"));
    assert.doesNotMatch(
      notes.stdout,
      /https?:\/\/|web app|Add to Home Screen/i,
    );
    assert.match(
      notes.stdout,
      /\| iPhone or iPad \| Build it with Xcode on a Mac \|/,
    );
    assert.equal(notes.stderr, "");
    const withoutFolder = run(version);
    assert.equal(withoutFolder.status, 0, withoutFolder.stderr);
    assert.ok(
      withoutFolder.stdout.includes("Prism-Mapper-v0.4.1-iOS-unsigned.ipa"),
    );
    assert.equal(withoutFolder.stderr, "");
    // Retired hosted-site switches are rejected instead of enabling a request.
    assert.notEqual(run(version, folder, "--no-web-app").status, 0);
    assert.notEqual(run(version, folder, "--check-web-app").status, 0);
    assert.notEqual(run().status, 0);
    assert.notEqual(run("not-a-version").status, 0);
  } finally {
    done(folder);
  }
});
