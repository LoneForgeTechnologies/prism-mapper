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

// Write beside the target and move into place, so an interrupted save never
// leaves a half-written project where a good one used to be.
async function writeFileAtomic(filename, contents, options = {}) {
  const fs = options.fs ?? fsp;
  const temporary = `${filename}.${(options.uuid ?? randomUUID)()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await replaceFile(temporary, filename, options);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

module.exports = { replaceFile, writeFileAtomic, RETRY_DELAYS_MS };
