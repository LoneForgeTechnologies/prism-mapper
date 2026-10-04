import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ResEdit from "resedit";
// Packaging utilities use only Node built-ins and can be validated on every OS.
// @ts-expect-error The release script intentionally runs as plain Node ESM.
import {
  applicationFiles,
  copyBuild,
  macDocumentTypes,
  packageRelease,
  stageRelease,
  finalizeRelease,
  releaseName,
  startHereText,
  verifyArchiveEntries,
  webOnlyBuildPaths,
} from "../scripts/package-release.mjs";
// @ts-expect-error Plain Node ESM helper.
import { createZip, readZipEntries, verifyZip } from "../scripts/zip.mjs";
import {
  assertStamped,
  copyrightLine,
  executableMetadata,
  iconSizes,
  inspectExecutable,
  numericVersion,
  stampExecutable,
  stampExecutableFile,
  // @ts-expect-error Plain Node ESM helper.
} from "../scripts/windows-exe.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "prism-packaging-test-"));
const write = (file: string, contents: string | Buffer = "x") => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};

test("release names accept only supported native targets and safe versions", () => {
  assert.equal(
    releaseName("0.4.1", "darwin", "arm64"),
    "Prism-Mapper-v0.4.1-macOS-arm64",
  );
  assert.equal(
    releaseName("0.4.1", "darwin", "x64"),
    "Prism-Mapper-v0.4.1-macOS-x64",
  );
  assert.equal(
    releaseName("0.4.1", "win32", "x64"),
    "Prism-Mapper-v0.4.1-Windows-x64",
  );
  assert.throws(() => releaseName("../0.4.1", "darwin", "arm64"));
  assert.throws(() => releaseName("0.4.1", "linux", "x64"));
  assert.throws(() => releaseName("0.4.1", "win32", "arm64"));
});

test("archives contain required application files and cannot include private development material", () => {
  const folder = "Prism-Mapper-v0.4.1-macOS-arm64";
  verifyArchiveEntries([`${folder}/`, `${folder}/LICENSE`], folder, [
    "LICENSE",
  ]);
  verifyArchiveEntries([`${folder}\\LICENSE`], folder, ["LICENSE"]);
  for (const entry of [
    "../LICENSE",
    "other/LICENSE",
    `${folder}/../LICENSE`,
    `${folder}/.env`,
    `${folder}/session-backups/private.prism.json`,
    `${folder}/node_modules/pkg/index.js`,
    `${folder}/.git/config`,
    `${folder}/electron/audio.test.cjs`,
  ])
    assert.throws(() => verifyArchiveEntries([entry], folder, []), entry);
  assert.throws(() =>
    verifyArchiveEntries([`${folder}/LICENSE`], folder, ["main.cjs"]),
  );
});

test("the desktop build skips exactly the web-only outputs and still rejects surprises", async () => {
  assert.deepEqual(
    [...webOnlyBuildPaths].sort(),
    [
      "apple-touch-icon.png",
      "favicon-32.png",
      "favicon.svg",
      "icons",
      "manifest.webmanifest",
      "sw.js",
    ].sort(),
  );
  const directory = temporary();
  try {
    const dist = path.join(directory, "dist");
    for (const name of [
      "index.html",
      "assets/index-abc.js",
      "assets/index-abc.css",
      "previews/aurora.webp",
      // Web-only files, including ones the generic rules would otherwise copy.
      "manifest.webmanifest",
      "sw.js",
      "apple-touch-icon.png",
      "favicon.svg",
      "favicon-32.png",
      "icons/icon-192.png",
      "icons/icon-512.png",
    ])
      write(path.join(dist, name));
    const target = path.join(directory, "app", "dist");
    fs.mkdirSync(target, { recursive: true });
    const skipped = await copyBuild(dist, target);
    assert.deepEqual(skipped.sort(), [...webOnlyBuildPaths].sort());
    const copied = fs
      .readdirSync(target, { recursive: true })
      .map(String)
      .map((name) => name.split(path.sep).join("/"))
      .filter((name) => fs.statSync(path.join(target, name)).isFile())
      .sort();
    assert.deepEqual(copied, [
      "assets/index-abc.css",
      "assets/index-abc.js",
      "index.html",
      "previews/aurora.webp",
    ]);

    // Anything else is still an error, including a web-only name that is not
    // at the top of dist/, files with unknown extensions, and unknown folders.
    for (const unexpected of [
      "workbox-1a2b3c.js.map",
      "robots.txt",
      "extra/index.js",
      ".DS_Store",
      "assets/sw.js.map",
      "assets/nested/manifest.webmanifest",
    ]) {
      const broken = path.join(directory, `broken-${unexpected.length}`);
      write(path.join(broken, "index.html"));
      write(path.join(broken, unexpected));
      await assert.rejects(
        copyBuild(broken, path.join(directory, "out")),
        /Unexpected file in production build/,
        unexpected,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("everything the shipped electron code requires is packaged", () => {
  const shipped = new Set<string>(applicationFiles);
  const queue = ["electron/main.cjs", "electron/preload.cjs"];
  const seen = new Set<string>();
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(shipped.has(file), `${file} must be listed in applicationFiles`);
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(
      /require\(\s*["'](\.[^"']+)["']\s*\)/g,
    )) {
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), match[1]),
      );
      if (/\.(?:cjs|json)$/.test(resolved)) queue.push(resolved);
    }
  }
  // The window icon and the brand files the Windows shell uses ship too.
  for (const icon of ["build/icon.ico", "build/icon.png"])
    assert.ok(shipped.has(icon), icon);
  for (const file of applicationFiles)
    assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
});

test("ZIP archives use forward slashes, keep empty folders and fail verification when damaged", async () => {
  const directory = temporary();
  try {
    const folder = path.join(directory, "Prism-Mapper-v1.0.0-Windows-x64");
    write(path.join(folder, "START HERE.txt"), "hello");
    write(
      path.join(folder, "Prism Mapper", "resources", "app", "a b.js"),
      "a".repeat(5000),
    );
    write(path.join(folder, "Prism Mapper", "empty.bin"), "");
    write(
      path.join(folder, "Prism Mapper", "random.bin"),
      Buffer.from(
        Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 251),
      ),
    );
    write(path.join(folder, "Example projects", "Zażółć.prism.json"), "{}");
    fs.mkdirSync(path.join(folder, "Prism Mapper", "locales"));
    const archive = path.join(directory, "release.zip");
    await createZip(folder, archive);
    const names: string[] = await verifyZip(archive);
    assert.ok(names.every((name) => !name.includes("\\")));
    assert.ok(
      names.every((name) =>
        name.startsWith("Prism-Mapper-v1.0.0-Windows-x64/"),
      ),
    );
    for (const expected of [
      "Prism-Mapper-v1.0.0-Windows-x64/",
      "Prism-Mapper-v1.0.0-Windows-x64/START HERE.txt",
      "Prism-Mapper-v1.0.0-Windows-x64/Prism Mapper/resources/app/a b.js",
      "Prism-Mapper-v1.0.0-Windows-x64/Prism Mapper/empty.bin",
      "Prism-Mapper-v1.0.0-Windows-x64/Prism Mapper/locales/",
      "Prism-Mapper-v1.0.0-Windows-x64/Example projects/Zażółć.prism.json",
    ])
      assert.ok(names.includes(expected), expected);
    verifyArchiveEntries(names, "Prism-Mapper-v1.0.0-Windows-x64", [
      "START HERE.txt",
    ]);
    // Real unzip tools agree when one is installed (it is not on Windows).
    const unzip = spawnSync("unzip", ["-tqq", archive], { encoding: "utf8" });
    if (!unzip.error)
      assert.equal(unzip.status, 0, unzip.stdout + unzip.stderr);

    const original = fs.readFileSync(archive);
    const flipped = Buffer.from(original);
    const entry = readZipEntries(original).find((candidate: { name: string }) =>
      candidate.name.endsWith("START HERE.txt"),
    );
    flipped[entry.offset + 30 + Buffer.byteLength(entry.name)] ^= 0xff;
    const damaged = path.join(directory, "damaged.zip");
    fs.writeFileSync(damaged, flipped);
    await assert.rejects(verifyZip(damaged), /checksum|invalid|Corrupt/i);
    fs.writeFileSync(damaged, original.subarray(0, original.length - 40));
    await assert.rejects(verifyZip(damaged));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows file versions are four numeric fields and the copyright comes from LICENSE", () => {
  assert.equal(numericVersion("0.4.1"), "0.4.1.0");
  assert.equal(numericVersion("12.0.300-beta.2"), "12.0.300.0");
  assert.throws(() => numericVersion("1.2"));
  assert.throws(() => numericVersion("1.2.99999"));
  const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
  assert.match(copyrightLine(license), /^Copyright \(c\) \d{4} .+/);
  assert.throws(() => copyrightLine("MIT License"));
});

function fixtureExecutable() {
  // A valid, empty 64-bit PE image: enough to exercise the resource editor.
  return Buffer.from(ResEdit.NtExecutable.createEmpty(false, false).generate());
}

test("stamping gives the executable the Prism Mapper icon and version strings", async () => {
  const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
  const icon = fs.readFileSync(path.join(root, "build", "icon.ico"));
  const metadata = executableMetadata({
    version: "0.4.1",
    license,
    fileName: "Prism Mapper.exe",
  });
  assert.equal(metadata.strings.OriginalFilename, "Prism Mapper.exe");
  assert.equal(metadata.strings.ProductVersion, "0.4.1");
  assert.equal(metadata.strings.FileVersion, "0.4.1.0");
  assert.ok(
    Object.values(metadata.strings).every(
      (value) => typeof value === "string" && !/[–—]/.test(value),
    ),
  );
  const stamped = stampExecutable(fixtureExecutable(), { icon, metadata });
  const info = inspectExecutable(stamped);
  assert.deepEqual(info.strings.ProductName, "Prism Mapper");
  assert.equal(info.fileVersion, "0.4.1.0");
  assert.equal(info.productVersion, "0.4.1.0");
  assert.deepEqual(iconSizes(icon), [16, 24, 32, 48, 64, 128, 256]);
  assertStamped(info, metadata, iconSizes(icon));
  assert.throws(
    () => assertStamped(info, { ...metadata, fileVersion: "9.9.9.0" }),
    /versions are/,
  );
  assert.throws(
    () =>
      assertStamped(info, {
        ...metadata,
        strings: { ...metadata.strings, ProductName: "Electron" },
      }),
    /ProductName/,
  );
  assert.throws(() =>
    assertStamped(inspectExecutable(fixtureExecutable()), metadata),
  );

  // Stamping an already stamped file replaces rather than duplicates.
  const again = inspectExecutable(
    stampExecutable(stamped, {
      icon,
      metadata: executableMetadata({
        version: "0.5.0-rc.1",
        license,
        fileName: "Prism Mapper.exe",
      }),
    }),
  );
  assert.equal(again.strings.ProductVersion, "0.5.0-rc.1");
  assert.equal(again.iconGroups.length, 1);
  assert.deepEqual(again.iconGroups[0].sizes, [16, 24, 32, 48, 64, 128, 256]);

  // The on-disk variant replaces the file atomically and reports what it wrote.
  const directory = temporary();
  try {
    const file = path.join(directory, "Prism Mapper.exe");
    fs.writeFileSync(file, fixtureExecutable());
    const reported = await stampExecutableFile(file, {
      iconFile: path.join(root, "build", "icon.ico"),
      metadata,
    });
    assert.deepEqual(reported, inspectExecutable(fs.readFileSync(file)));
    assert.deepEqual(fs.readdirSync(directory), ["Prism Mapper.exe"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the macOS bundle offers Prism Mapper for JSON files without taking them over", () => {
  assert.equal(macDocumentTypes.length, 1);
  const [type] = macDocumentTypes;
  assert.equal(type.CFBundleTypeRole, "Editor");
  // Alternate: listed under "Open With", never the default program for JSON.
  assert.equal(type.LSHandlerRank, "Alternate");
  assert.deepEqual(type.CFBundleTypeExtensions, ["json"]);
  assert.deepEqual(type.LSItemContentTypes, ["public.json"]);
  assert.ok(Object.isFrozen(macDocumentTypes));
  // plutil takes it as JSON, so it has to survive a round trip unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(macDocumentTypes)), [type]);
  assert.doesNotMatch(JSON.stringify(macDocumentTypes), /[\u2013\u2014]/);
});

test("the portable README for each platform is honest and free of dash punctuation", () => {
  const windows = startHereText("0.4.1", "win32");
  const mac = startHereText("0.4.1", "darwin");
  for (const text of [windows, mac])
    assert.doesNotMatch(text, /[–—]/, "no em or en dashes");
  assert.match(windows, /not code-signed/);
  assert.match(windows, /Windows protected your PC/);
  assert.match(windows, /More info/);
  assert.match(windows, /Run anyway/);
  assert.match(windows, /Prism-Mapper-v0\.4\.1-Windows-x64-Setup\.exe/);
  assert.match(windows, /not yet been tested with a physical projector/);
  assert.match(windows, /Windows key \+ P/);
  assert.match(mac, /ad-hoc signed, not notarized/);
  assert.doesNotMatch(mac, /Windows/);
  const signedWindows = startHereText("0.6.0", "win32", { signed: true });
  const signedMac = startHereText("0.6.0", "darwin", {
    signed: true,
    notarized: true,
  });
  assert.match(signedWindows, /verified, timestamped publisher signature/);
  assert.match(signedWindows, /does not guarantee an immediate warning-free/);
  assert.doesNotMatch(signedWindows, /not code-signed/);
  assert.match(signedMac, /signed with an Apple Developer ID and notarized/);
  assert.doesNotMatch(signedMac, /ad-hoc|Open Anyway/);
});

test("a Windows release can be packaged end to end from a stand-in Electron runtime", async () => {
  const directory = temporary();
  try {
    // A runtime shaped like node_modules/electron/dist, with Electron's own
    // icon and version text so the stamping has something to replace.
    const runtime = path.join(directory, "runtime");
    const icon = fs.readFileSync(path.join(root, "build", "icon.ico"));
    write(
      path.join(runtime, "electron.exe"),
      stampExecutable(fixtureExecutable(), {
        icon,
        metadata: {
          fileVersion: "41.0.0.0",
          productVersion: "41.0.0.0",
          strings: {
            ProductName: "Electron",
            FileDescription: "Electron",
            CompanyName: "GitHub, Inc.",
            ProductVersion: "41.0.0",
          },
        },
      }),
    );
    write(path.join(runtime, "electron_wer.dll"), "wer");
    write(path.join(runtime, "resources", "default_app.asar"), "asar");
    write(path.join(runtime, "locales", "en-US.pak"), "pak");
    write(path.join(runtime, "LICENSE"), "Electron license");
    write(path.join(runtime, "LICENSES.chromium.html"), "<html></html>");
    const build = path.join(directory, "dist");
    for (const name of [
      "index.html",
      "assets/index-1.js",
      "sw.js",
      "manifest.webmanifest",
      "icons/icon-192.png",
    ])
      write(path.join(build, name));
    const result = await packageRelease({
      platform: "win32",
      arch: "x64",
      runtime,
      build,
      output: path.join(directory, "out"),
    });
    const version = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ).version;
    assert.equal(
      path.basename(result.archive),
      `Prism-Mapper-v${version}-Windows-x64.zip`,
    );
    const names: string[] = await verifyZip(result.archive);
    const prefix = `Prism-Mapper-v${version}-Windows-x64/Prism Mapper`;
    for (const expected of [
      `${prefix}/Prism Mapper.exe`,
      `${prefix}/Prism Mapper_wer.dll`,
      `${prefix}/locales/en-US.pak`,
      `${prefix}/resources/app/package.json`,
      `${prefix}/resources/app/dist/index.html`,
      `${prefix}/resources/app/dist/assets/index-1.js`,
      `${prefix}/resources/app/build/icon.ico`,
      `${prefix}/resources/app/build/icon.png`,
      `${prefix}/resources/app/electron/main.cjs`,
      `${prefix}/resources/app/electron/recent.cjs`,
      `Prism-Mapper-v${version}-Windows-x64/START HERE.txt`,
      `Prism-Mapper-v${version}-Windows-x64/Example projects/indoor-cube.prism.json`,
      `Prism-Mapper-v${version}-Windows-x64/LICENSE`,
    ])
      assert.ok(names.includes(expected), expected);
    for (const unwanted of [
      "default_app.asar",
      "electron.exe",
      "sw.js",
      "manifest.webmanifest",
      "icons/",
      ".test.cjs",
    ])
      assert.ok(
        !names.some((name) => name.includes(unwanted)),
        `${unwanted} must not be packaged`,
      );
    assert.equal(
      fs.readFileSync(`${result.archive}.sha256`, "utf8"),
      `${result.checksum}  ${path.basename(result.archive)}\n`,
    );
    assert.equal(
      fs.readFileSync(path.join(result.contents, "START HERE.txt"), "utf8"),
      startHereText(version, "win32"),
    );
    const info = inspectExecutable(
      fs.readFileSync(path.join(result.application, "Prism Mapper.exe")),
    );
    assert.equal(info.strings.ProductName, "Prism Mapper");
    assert.equal(info.strings.OriginalFilename, "Prism Mapper.exe");
    assert.equal(info.strings.CompanyName, "Prism Mapper contributors");
    assert.equal(info.iconGroups.length, 1);
    assert.deepEqual(info.iconGroups[0].sizes, [16, 24, 32, 48, 64, 128, 256]);
    // The packaged application starts from main.cjs and nothing else is needed.
    const app = JSON.parse(
      fs.readFileSync(
        path.join(result.application, "resources", "app", "package.json"),
        "utf8",
      ),
    );
    assert.equal(app.main, "electron/main.cjs");
    assert.equal(app.version, version);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("staging does not distribute a ZIP; failed signature checks cannot emit a signed release", async () => {
  const directory = temporary();
  try {
    const runtime = path.join(directory, "runtime");
    write(path.join(runtime, "electron.exe"), fixtureExecutable());
    write(path.join(runtime, "LICENSE"), "Electron license");
    write(path.join(runtime, "LICENSES.chromium.html"), "<html></html>");
    const build = path.join(directory, "dist");
    write(path.join(build, "index.html"), "<html></html>");
    const options = {
      platform: "win32",
      arch: "x64",
      runtime,
      build,
      output: path.join(directory, "out"),
    };
    const staged = await stageRelease(options);
    assert.equal(fs.existsSync(staged.archive), false);
    assert.equal(fs.existsSync(`${staged.archive}.sha256`), false);
    await assert.rejects(
      finalizeRelease({
        ...options,
        requireSigned: true,
        windowsSigned: false,
      }),
      /requires Artifact Signing/,
    );
    await assert.rejects(
      finalizeRelease({
        ...options,
        requireSigned: true,
        windowsSigned: true,
        verifyWindows: async () => {
          throw new Error("untrusted certificate");
        },
      }),
      /untrusted certificate/,
    );
    assert.equal(fs.existsSync(staged.archive), false);
    assert.equal(fs.existsSync(`${staged.archive}.sha256`), false);

    // A stand-in signer adds a marker only after staging. Finalization must
    // archive those final bytes rather than rebuilding an unsigned runtime.
    const signedFile = path.join(staged.application, "Prism Mapper.exe");
    fs.appendFileSync(signedFile, "SIGNED-AFTER-STAGING");
    let checked = false;
    const finalized = await finalizeRelease({
      ...options,
      requireSigned: true,
      windowsSigned: true,
      verifyWindows: async (application: string) => {
        assert.equal(application, staged.application);
        assert.ok(
          fs
            .readFileSync(signedFile)
            .includes(Buffer.from("SIGNED-AFTER-STAGING")),
        );
        checked = true;
        return { signed: true, notarized: false };
      },
    });
    assert.equal(checked, true);
    assert.equal(finalized.signing.signed, true);
    const packaged = readZipEntries(fs.readFileSync(finalized.archive));
    const appEntry = packaged.find((entry: { name: string }) =>
      entry.name.endsWith("/Prism Mapper.exe"),
    );
    assert.equal(appEntry.size, fs.statSync(signedFile).size);
    assert.match(
      fs.readFileSync(path.join(finalized.contents, "START HERE.txt"), "utf8"),
      /verified, timestamped/,
    );
    assert.equal(
      fs.readFileSync(`${finalized.archive}.sha256`, "utf8"),
      `${finalized.checksum}  ${path.basename(finalized.archive)}\n`,
    );
    assert.ok(
      !(await verifyZip(finalized.archive)).some((name: string) =>
        name.includes("release-stage.json"),
      ),
    );

    const manifest = path.join(staged.staging, "release-stage.json");
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        version: "9.9.9",
        platform: "win32",
        arch: "x64",
        signing: { signed: true, notarized: false },
      }),
    );
    await assert.rejects(
      finalizeRelease(options),
      /does not match this version/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
