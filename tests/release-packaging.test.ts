import test from "node:test";
import assert from "node:assert/strict";
// Packaging utilities use only Node built-ins and can be validated on every OS.
// @ts-expect-error The release script intentionally runs as plain Node ESM.
import {
  releaseName,
  verifyArchiveEntries,
} from "../scripts/package-release.mjs";

test("release names accept only supported native targets and safe versions", () => {
  assert.equal(
    releaseName("0.4.1", "darwin", "arm64"),
    "Prism-Mapper-v0.4.1-macOS-arm64",
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
