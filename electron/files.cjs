const fsp = require("node:fs/promises");
const { randomUUID } = require("node:crypto");

// On Windows a file that was just written is often held open for a moment by
// something else (antivirus, the search indexer, a cloud-sync client), and
// renaming a file that is open elsewhere fails with EPERM, EBUSY or EACCES even
// though trying again a moment later works. This is why programs that save
// files safely on Windows retry the rename briefly.
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
const RETRY_DELAYS_MS = [15, 40, 90, 200, 400, 800];
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function replaceFile(
  from,
  to,
  {
    fs = fsp,
    platform = process.platform,
    wait = sleep,
    delays = RETRY_DELAYS_MS,
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      if (
        platform !== "win32" ||
        !TRANSIENT.has(error?.code) ||
        attempt >= delays.length
      )
        throw error;
      await wait(delays[attempt]);
    }
  }
}

// A file system that cannot flush a file (some network and FUSE mounts) says
// so with one of these. Saving there still works, only without the guarantee.
const CANNOT_FLUSH = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);

// Write beside the target and move into place, so an interrupted save never
// leaves a half-written project where a good one used to be. The new file is
// flushed to the disk first: renaming alone can survive a crash or a power cut
// as an empty file under the project's name, with the old contents gone.
async function writeFileAtomic(filename, contents, options = {}) {
  const fs = options.fs ?? fsp;
  const temporary = `${filename}.${(options.uuid ?? randomUUID)()}.tmp`;
  try {
    const file = await fs.open(temporary, "wx");
    try {
      await file.writeFile(contents, "utf8");
      try {
        await file.sync();
      } catch (error) {
        if (!CANNOT_FLUSH.has(error?.code)) throw error;
      }
    } finally {
      await file.close();
    }
    await replaceFile(temporary, filename, options);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

module.exports = { replaceFile, writeFileAtomic, RETRY_DELAYS_MS };
