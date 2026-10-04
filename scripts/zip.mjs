// A small, dependency-free ZIP writer and verifier for the Windows release.
//
// Windows PowerShell 5.1's Compress-Archive writes backslash path separators,
// which are not valid in a ZIP archive, so the archive is written here instead.
// Entries use forward slashes and UTF-8 names. Files are deflated, or stored
// when deflate would not make them smaller. ZIP64 is not needed (and refused)
// because a release stays far below 4 GiB.
import { lstat, open, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_NAMES = 0x0800;
const MAX_CLASSIC = 0xffffffff;

function dosDateTime(date) {
  // DOS timestamps start in 1980 and have two-second resolution. UTC keeps
  // archives identical no matter where they are built.
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (date.getUTCSeconds() >> 1),
    date:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  };
}

// Every entry below `directory`, in a stable order, named relative to its
// parent so the folder itself is the first path segment of each name.
export async function listEntries(directory) {
  const parent = path.dirname(directory);
  const entries = [];
  async function walk(current) {
    const stats = await lstat(current);
    const name = path.relative(parent, current).split(path.sep).join("/");
    if (stats.isDirectory()) {
      entries.push({ name: `${name}/`, directory: true, mtime: stats.mtime });
      const children = await readdir(current);
      for (const child of children.sort())
        await walk(path.join(current, child));
    } else if (stats.isFile()) {
      entries.push({
        name,
        directory: false,
        file: current,
        mtime: stats.mtime,
      });
    } else {
      throw new Error(`Refusing to archive a non-regular file: ${current}`);
    }
  }
  await walk(directory);
  return entries;
}

export async function createZip(directory, destination) {
  const entries = await listEntries(path.resolve(directory));
  if (entries.length > 0xfffe) throw new Error("Too many files for a ZIP");
  const output = await open(destination, "w");
  const central = [];
  let offset = 0;
  const write = async (buffer) => {
    await output.write(buffer, 0, buffer.length);
    offset += buffer.length;
  };
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.name, "utf8");
      if (name.length > 0xffff) throw new Error(`Path too long: ${entry.name}`);
      const content = entry.directory
        ? Buffer.alloc(0)
        : await readFile(entry.file);
      let data = content;
      let method = 0;
      if (content.length > 0) {
        const deflated = zlib.deflateRawSync(content, { level: 9 });
        if (deflated.length < content.length) {
          data = deflated;
          method = 8;
        }
      }
      if (content.length >= MAX_CLASSIC || offset >= MAX_CLASSIC)
        throw new Error("ZIP64 is not supported");
      const crc = entry.directory ? 0 : zlib.crc32(content);
      const stamp = dosDateTime(entry.mtime);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(LOCAL_HEADER, 0);
      local.writeUInt16LE(20, 4); // version needed: deflate
      local.writeUInt16LE(UTF8_NAMES, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(stamp.time, 10);
      local.writeUInt16LE(stamp.date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(content.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      central.push({
        name,
        method,
        stamp,
        crc,
        compressed: data.length,
        size: content.length,
        offset,
        directory: entry.directory,
      });
      await write(local);
      await write(name);
      await write(data);
    }
    const centralOffset = offset;
    for (const entry of central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL_HEADER, 0);
      header.writeUInt16LE(20, 4); // version made by: MS-DOS, spec 2.0
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(UTF8_NAMES, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.stamp.time, 12);
      header.writeUInt16LE(entry.stamp.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressed, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt32LE(entry.directory ? 0x10 : 0x20, 38); // DOS attributes
      header.writeUInt32LE(entry.offset, 42);
      await write(header);
      await write(entry.name);
    }
    const centralSize = offset - centralOffset;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    await write(end);
  } finally {
    await output.close();
  }
  return entries.length;
}

// Parse the central directory of an archive held in memory.
export function readZipEntries(archive) {
  const buffer = Buffer.isBuffer(archive) ? archive : Buffer.from(archive);
  let end = -1;
  for (
    let position = buffer.length - 22;
    position >= Math.max(0, buffer.length - 22 - 0xffff);
    position--
  ) {
    if (buffer.readUInt32LE(position) === END_OF_CENTRAL_DIRECTORY) {
      end = position;
      break;
    }
  }
  if (end < 0) throw new Error("Not a ZIP archive: no end record");
  const count = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (
    count === 0xffff ||
    centralSize === MAX_CLASSIC ||
    centralOffset === MAX_CLASSIC
  )
    throw new Error("ZIP64 archives are not supported");
  const entries = [];
  let position = centralOffset;
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(position) !== CENTRAL_HEADER)
      throw new Error("Corrupt ZIP central directory");
    const flags = buffer.readUInt16LE(position + 8);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    entries.push({
      name: buffer
        .subarray(position + 46, position + 46 + nameLength)
        .toString(flags & UTF8_NAMES ? "utf8" : "latin1"),
      method: buffer.readUInt16LE(position + 10),
      crc: buffer.readUInt32LE(position + 16),
      compressed: buffer.readUInt32LE(position + 20),
      size: buffer.readUInt32LE(position + 24),
      offset: buffer.readUInt32LE(position + 42),
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// Read every entry, check its size and CRC-32, and return the entry names.
// This is what Windows Explorer or unzip would otherwise discover on a user's PC.
export async function verifyZip(archivePath) {
  const buffer = await readFile(archivePath);
  const entries = readZipEntries(buffer);
  for (const entry of entries) {
    if (buffer.readUInt32LE(entry.offset) !== LOCAL_HEADER)
      throw new Error(`Corrupt ZIP local header for ${entry.name}`);
    const start =
      entry.offset +
      30 +
      buffer.readUInt16LE(entry.offset + 26) +
      buffer.readUInt16LE(entry.offset + 28);
    const stored = buffer.subarray(start, start + entry.compressed);
    if (stored.length !== entry.compressed)
      throw new Error(`Truncated ZIP entry: ${entry.name}`);
    const content =
      entry.method === 0
        ? stored
        : entry.method === 8
          ? zlib.inflateRawSync(stored)
          : null;
    if (!content) throw new Error(`Unsupported compression for ${entry.name}`);
    if (content.length !== entry.size || zlib.crc32(content) !== entry.crc)
      throw new Error(`ZIP entry failed its checksum: ${entry.name}`);
  }
  return entries.map((entry) => entry.name);
}
