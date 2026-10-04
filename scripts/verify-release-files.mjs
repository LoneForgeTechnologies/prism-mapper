// Checks the files that the build jobs of the release workflow produced, and
// writes the combined SHA256SUMS.txt that goes with them.
//
//   node scripts/verify-release-files.mjs <folder> <version>
//
// <folder> holds every release file with a SHA-256 file made by the job that
// built it (for Prism-Mapper-v0.4.1-Windows-x64.zip that is
// Prism-Mapper-v0.4.1-Windows-x64.zip.sha256, in the format of sha256sum:
// 64 hex digits, two spaces, the file name). Nothing is published unless every
// file still matches its checksum after the transfer between jobs, no file is
// without a checksum or the other way round, and the four desktop downloads that
// every release carries are present. Mobile builds are not named here: whatever
// else is in the folder is released as it is, after the same checks.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseName } from "./release-name.mjs";

export const COMBINED = "SHA256SUMS.txt";

// The desktop downloads that every release carries.
export function requiredFiles(version) {
  return [
    `${releaseName(version, "darwin", "arm64")}.zip`,
    `${releaseName(version, "darwin", "x64")}.zip`,
    `${releaseName(version, "win32", "x64")}.zip`,
    `${releaseName(version, "win32", "x64")}-Setup.exe`,
  ];
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// "<64 hex digits>  <name>" and nothing else.
export function parseChecksumFile(text, file) {
  const match = /^([0-9a-fA-F]{64}) {2}([^\r\n/\\]+)\r?\n?$/.exec(text);
  if (!match)
    throw new Error(
      `${file} is not a SHA-256 file (expected 64 hex digits, two spaces and a file name)`,
    );
  return { checksum: match[1].toLowerCase(), name: match[2] };
}

// Byte order of the names, the same as sort in the C locale.
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export async function verifyReleaseFiles({ folder, version, write = true }) {
  const entries = await readdir(folder, { withFileTypes: true });
  const folders = entries.filter((entry) => !entry.isFile());
  if (folders.length)
    throw new Error(
      `${folders.map((entry) => entry.name).join(", ")} in ${folder} is not a file. The downloads should be flat.`,
    );
  const names = new Set(entries.map((entry) => entry.name));
  const files = [];

  for (const name of [...names].sort()) {
    if (name === COMBINED) continue;
    if (name.endsWith(".sha256")) {
      if (!names.has(name.slice(0, -".sha256".length)))
        throw new Error(`${name} has no matching file`);
      continue;
    }
    if (!names.has(`${name}.sha256`))
      throw new Error(`No checksum file for ${name}`);
    const recorded = parseChecksumFile(
      await readFile(path.join(folder, `${name}.sha256`), "utf8"),
      `${name}.sha256`,
    );
    if (recorded.name !== name)
      throw new Error(`${name}.sha256 names ${recorded.name}, not ${name}`);
    const actual = await sha256(path.join(folder, name));
    if (actual !== recorded.checksum)
      throw new Error(
        `${name} does not match its checksum (recorded ${recorded.checksum}, found ${actual})`,
      );
    files.push({
      name,
      checksum: actual,
      size: (await stat(path.join(folder, name))).size,
    });
  }

  const present = new Set(files.map((file) => file.name));
  for (const required of requiredFiles(version))
    if (!present.has(required)) throw new Error(`Missing ${required}`);

  files.sort(byName);
  const combined = files
    .map((file) => `${file.checksum}  ${file.name}\n`)
    .join("");
  if (write) await writeFile(path.join(folder, COMBINED), combined);
  return { files, combined };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [folder, version] = process.argv.slice(2);
  if (!folder || !version)
    throw new Error(
      "Usage: node scripts/verify-release-files.mjs <folder> <version>",
    );
  const { files, combined } = await verifyReleaseFiles({ folder, version });
  for (const file of files)
    console.log(
      `${String(file.size).padStart(12)}  ${file.checksum}  ${file.name}`,
    );
  console.log(`\n${COMBINED}:\n${combined}`);
  console.log(`${files.length} files verified.`);
}
