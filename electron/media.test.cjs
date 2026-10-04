const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { parseByteRange, serveMediaFile } = require("./media.cjs");

test("parses finite, open-ended, suffix and clamped byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=2-", 10), { start: 2, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=0-20", 10), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-20", 10), { start: 0, end: 9 });
  for (const range of [
    "bytes=10-",
    "bytes=5-2",
    "bytes=-",
    "bytes=-0",
    "bytes=0-1,3-4",
    "bytes=99999999999999999999-",
    "bogus",
  ])
    assert.equal(parseByteRange(range, 10), null);
  assert.equal(parseByteRange("bytes=0-", 0), null);
});

test("streams exact byte ranges and returns 416 for unsatisfiable requests", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-range-test-"),
  );
  const filename = path.join(directory, "sample.mp4");
  await fs.writeFile(filename, "0123456789");
  try {
    const response = await serveMediaFile(
      filename,
      new Request("media://local/token", { headers: { Range: "bytes=2-5" } }),
      () => {
        throw new Error("Range request must not fetch the whole movie");
      },
    );
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(await response.text(), "2345");
    const invalid = await serveMediaFile(
      filename,
      new Request("media://local/token", { headers: { Range: "bytes=10-" } }),
    );
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */10");
    const head = await serveMediaFile(
      filename,
      new Request("media://local/token", {
        method: "HEAD",
        headers: { Range: "bytes=-3" },
      }),
    );
    assert.equal(head.status, 206);
    assert.equal(head.headers.get("content-length"), "3");
    assert.equal(await head.text(), "");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("uses Chromium's file loader for a whole file when it works", async () => {
  const request = new Request("media://local/token");
  const loaded = new Response("from the loader", { status: 200 });
  const response = await serveMediaFile(
    path.join(os.tmpdir(), "prism-no-such-file.png"),
    request,
    async (url, options) => {
      assert.match(url, /^file:/);
      assert.equal(options.method, "GET");
      return loaded;
    },
  );
  assert.equal(response, loaded);
});

test("reads a whole file itself when Chromium's file loader cannot", async () => {
  // Windows: a path longer than 259 characters and \\localhost\share are
  // files Node reads but Chromium's loader reports as missing.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prism-whole-"));
  const filename = path.join(directory, "sample.png");
  await fs.writeFile(filename, "0123456789");
  try {
    for (const loader of [
      async () => {
        throw new Error("net::ERR_FILE_NOT_FOUND");
      },
      async () => new Response("Not found", { status: 404 }),
    ]) {
      const response = await serveMediaFile(
        filename,
        new Request("media://local/token"),
        loader,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(response.headers.get("content-length"), "10");
      assert.equal(response.headers.get("accept-ranges"), "bytes");
      assert.equal(await response.text(), "0123456789");
    }
    const head = await serveMediaFile(
      filename,
      new Request("media://local/token", { method: "HEAD" }),
      async () => {
        throw new Error("net::ERR_FILE_NOT_FOUND");
      },
    );
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(await head.text(), "");

    await fs.writeFile(path.join(directory, "empty.png"), "");
    const empty = await serveMediaFile(
      path.join(directory, "empty.png"),
      new Request("media://local/token"),
      async () => {
        throw new Error("net::ERR_FILE_NOT_FOUND");
      },
    );
    assert.equal(empty.status, 200);
    assert.equal(await empty.text(), "");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("reports a file that neither Chromium nor Node can read", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prism-whole-"));
  try {
    const fails = async () => {
      throw new Error("net::ERR_FILE_NOT_FOUND");
    };
    // Missing: the loader's own failure is what the caller sees.
    await assert.rejects(
      serveMediaFile(
        path.join(directory, "missing.png"),
        new Request("media://local/token"),
        fails,
      ),
      /ERR_FILE_NOT_FOUND/,
    );
    // A folder is not media.
    const folder = await serveMediaFile(
      directory,
      new Request("media://local/token"),
      fails,
    );
    assert.equal(folder.status, 404);
    await assert.rejects(
      serveMediaFile(
        path.join(directory, "missing.png"),
        new Request("media://local/token"),
        async () => new Response("Not found", { status: 404 }),
      ),
      /could not be loaded \(404\)/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
