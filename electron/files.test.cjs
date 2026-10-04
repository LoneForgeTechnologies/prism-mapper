const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  replaceFile,
  writeFileAtomic,
  RETRY_DELAYS_MS,
} = require("./files.cjs");

function failure(code) {
  return Object.assign(new Error(`${code}: operation failed`), { code });
}

function flaky(code, failures) {
  const calls = [];
  return {
    calls,
    rename: async (from, to) => {
      calls.push([from, to]);
      if (calls.length <= failures) throw failure(code);
    },
  };
}

test("retries a rename that Windows refuses while another program holds the file", async () => {
  for (const code of ["EPERM", "EBUSY", "EACCES"]) {
    const waits = [];
    const fake = flaky(code, 3);
    await replaceFile("a.tmp", "a.json", {
      fs: fake,
      platform: "win32",
      wait: async (ms) => waits.push(ms),
    });
    assert.equal(fake.calls.length, 4, code);
    assert.deepEqual(waits, RETRY_DELAYS_MS.slice(0, 3));
  }
});

test("gives up after the last delay and reports the original error", async () => {
  const fake = flaky("EBUSY", 100);
  await assert.rejects(
    replaceFile("a.tmp", "a.json", {
      fs: fake,
      platform: "win32",
      wait: async () => {},
    }),
    { code: "EBUSY" },
  );
  assert.equal(fake.calls.length, RETRY_DELAYS_MS.length + 1);
});

test("does not retry other errors, or any error on other systems", async () => {
  const missing = flaky("ENOENT", 100);
  await assert.rejects(
    replaceFile("a.tmp", "a.json", {
      fs: missing,
      platform: "win32",
      wait: async () => {},
    }),
    { code: "ENOENT" },
  );
  assert.equal(missing.calls.length, 1);
  for (const platform of ["darwin", "linux"]) {
    const fake = flaky("EPERM", 100);
    await assert.rejects(
      replaceFile("a.tmp", "a.json", {
        fs: fake,
        platform,
        wait: async () => {},
      }),
      { code: "EPERM" },
    );
    assert.equal(fake.calls.length, 1, platform);
  }
});

test("saves a project beside its final name and leaves no temporary file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prism-files-"));
  try {
    const target = path.join(directory, "show.prism.json");
    await fs.writeFile(target, "old");
    await writeFileAtomic(target, "new contents\n");
    assert.equal(await fs.readFile(target, "utf8"), "new contents\n");
    assert.deepEqual(await fs.readdir(directory), ["show.prism.json"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("keeps the old project and cleans up when the move never succeeds", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prism-files-"));
  try {
    const target = path.join(directory, "show.prism.json");
    await fs.writeFile(target, "old");
    const fake = {
      open: fs.open,
      rm: fs.rm,
      rename: async () => {
        throw failure("EPERM");
      },
    };
    await assert.rejects(
      writeFileAtomic(target, "new", {
        fs: fake,
        platform: "win32",
        wait: async () => {},
      }),
      { code: "EPERM" },
    );
    assert.equal(await fs.readFile(target, "utf8"), "old");
    assert.deepEqual(await fs.readdir(directory), ["show.prism.json"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

// A file system that records what is done to it, in order.
function recording({ sync } = {}) {
  const steps = [];
  return {
    steps,
    open: async (name, flags) => {
      steps.push(`open ${flags}`);
      return {
        writeFile: async (contents, encoding) =>
          steps.push(`write ${contents} ${encoding}`),
        sync: async () => {
          steps.push("sync");
          if (sync) throw sync;
        },
        close: async () => steps.push("close"),
      };
    },
    rename: async () => steps.push("rename"),
    rm: async () => steps.push("rm"),
  };
}

test("flushes the new file to the disk before it takes the project's name", async () => {
  const fake = recording();
  await writeFileAtomic("show.prism.json", "new", { fs: fake });
  assert.deepEqual(fake.steps, [
    "open wx",
    "write new utf8",
    "sync",
    "close",
    "rename",
    "rm",
  ]);
});

test("a file system that cannot flush still saves, any other flush failure does not", async () => {
  for (const code of ["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]) {
    const fake = recording({ sync: failure(code) });
    await writeFileAtomic("show.prism.json", "new", { fs: fake });
    assert.ok(fake.steps.includes("rename"), code);
  }
  const failing = recording({ sync: failure("EIO") });
  await assert.rejects(
    writeFileAtomic("show.prism.json", "new", { fs: failing }),
    { code: "EIO" },
  );
  // The old project was never replaced, the file was closed and cleaned up.
  assert.deepEqual(failing.steps, [
    "open wx",
    "write new utf8",
    "sync",
    "close",
    "rm",
  ]);
});
