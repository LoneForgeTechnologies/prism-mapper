// TEMPORARY: prints what is inside the Windows ZIP so it can be reviewed
// without downloading it. Removed before the branch is finished.
import { readFile } from "node:fs/promises";
import zlib from "node:zlib";
import { readZipEntries } from "../scripts/zip.mjs";
import { inspectExecutable } from "../scripts/windows-exe.mjs";

const archive = await readFile(process.argv[2]);
const entries = readZipEntries(archive);
console.log(
  `${process.argv[2]}: ${entries.length} entries, ${archive.length} bytes`,
);
for (const entry of entries)
  console.log(`${String(entry.size).padStart(10)} ${entry.name}`);
const exe = entries.find((entry) => entry.name.endsWith("Prism Mapper.exe"));
if (exe) {
  const start =
    exe.offset +
    30 +
    archive.readUInt16LE(exe.offset + 26) +
    archive.readUInt16LE(exe.offset + 28);
  const stored = archive.subarray(start, start + exe.compressed);
  const image = exe.method === 8 ? zlib.inflateRawSync(stored) : stored;
  console.log(JSON.stringify(inspectExecutable(image), null, 2));
}
