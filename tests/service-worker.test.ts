import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
// The build script intentionally runs as plain Node ESM.
// @ts-expect-error No type declarations for a .mjs script.
import {
  buildPwa,
  buildServiceWorker,
  cacheNameFor,
  checkManifest,
  fingerprint,
  isShippable,
  listDistFiles,
  renderServiceWorker,
} from "../scripts/build-pwa.mjs";

const template = readFileSync(
  new URL("../scripts/sw-template.js", import.meta.url),
  "utf8",
);

// ---------------------------------------------------------------------------
// Temporary dist folders
// ---------------------------------------------------------------------------

const created: string[] = [];
after(async () => {
  for (const folder of created)
    await rm(folder, { recursive: true, force: true });
});

async function makeDist(files: Record<string, string>) {
  const dist = await mkdtemp(path.join(os.tmpdir(), "prism-pwa-test-"));
  created.push(dist);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dist, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return dist;
}

const MANIFEST = JSON.stringify({
  icons: [
    { src: "icons/icon-192.png" },
    { src: "./icons/icon-512.png" },
    { src: "icons/icon-maskable-512.png" },
  ],
});
/** What a real build puts in dist/ and the worker must cache. */
const SHIPPED: Record<string, string> = {
  "index.html": "<!doctype html><title>Prism Mapper</title>",
  "assets/index-aaa.js": "console.log('app')",
  "assets/index-aaa.css": "body{margin:0}",
  "assets/web-bbb.js": "export {}",
  "icons/icon-192.png": "png192",
  "icons/icon-512.png": "png512",
  "icons/icon-maskable-512.png": "pngmask",
  "manifest.webmanifest": MANIFEST,
  "favicon.svg": "<svg/>",
  "favicon-32.png": "png32",
  "apple-touch-icon.png": "png180",
  "previews/shape-circle.png": "preview",
  "previews/halloween/bat.png": "preview",
};
/** Files that may sit in dist/ and must never reach the offline cache. */
const NEVER_SHIPPED: Record<string, string> = {
  "node_modules/left-pad/index.js": "x",
  "tests/pwa.cjs": "x",
  "test/a.js": "x",
  "__tests__/b.js": "x",
  "assets/index-aaa.js.map": "{}",
  ".DS_Store": "x",
  ".git/config": "x",
  ".env": "SECRET=1",
  "debug.log": "x",
  "sw.js": "an older worker",
  "session-backups/a.prism.json": "{}",
  "artifacts/out.png": "x",
  "release/Prism.zip": "x",
  "assets/app.test.js": "x",
  "assets/app.spec.mjs": "x",
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

test("only app files are shippable: no dotfiles, maps, logs, tests, packages or old workers", () => {
  for (const file of Object.keys(SHIPPED))
    assert.equal(isShippable(file), true, file);
  for (const file of Object.keys(NEVER_SHIPPED))
    assert.equal(isShippable(file), false, file);
  // Names that merely resemble excluded ones are ordinary files.
  for (const file of [
    "assets/testing-guide.js",
    "assets/attest.js",
    "assets/contest.css",
  ])
    assert.equal(isShippable(file), true, file);
});

test("the file list is complete, sorted, forward-slashed and free of private folders", async () => {
  const dist = await makeDist({ ...SHIPPED, ...NEVER_SHIPPED });
  const files: string[] = await listDistFiles(dist);
  assert.deepEqual(files, Object.keys(SHIPPED).sort());
  for (const file of files) {
    assert.doesNotMatch(file, /\\/);
    assert.doesNotMatch(file, /node_modules|tests?\/|__tests__/);
  }
});

test("the cache name tracks the version and every file's path and content", async () => {
  const dist = await makeDist(SHIPPED);
  const entries = await fingerprint(dist, await listDistFiles(dist));
  const name = cacheNameFor("0.4.1", entries);
  assert.match(name, /^prism-mapper-v0\.4\.1-[0-9a-f]{12}$/);
  // Stable: same inputs, any order.
  assert.equal(cacheNameFor("0.4.1", entries), name);
  assert.equal(cacheNameFor("0.4.1", [...entries].reverse()), name);
  // Version bump.
  assert.notEqual(cacheNameFor("0.4.2", entries), name);
  assert.match(cacheNameFor("0.4.2", entries), /^prism-mapper-v0\.4\.2-/);
  assert.match(
    cacheNameFor("1.0.0-beta.1", entries),
    /^prism-mapper-v1\.0\.0-beta\.1-/,
  );
  // One byte of one file.
  const changed = entries.map((e: { path: string; hash: string }) =>
    e.path === "assets/index-aaa.js" ? { ...e, hash: "0".repeat(64) } : e,
  );
  assert.notEqual(cacheNameFor("0.4.1", changed), name);
  // A file added, removed or renamed.
  assert.notEqual(cacheNameFor("0.4.1", entries.slice(1)), name);
  assert.notEqual(
    cacheNameFor("0.4.1", [
      ...entries,
      { path: "extra.js", hash: "1".repeat(64) },
    ]),
    name,
  );
  const renamed = entries.map((e: { path: string; hash: string }) =>
    e.path === "favicon.svg" ? { ...e, path: "logo.svg" } : e,
  );
  assert.notEqual(cacheNameFor("0.4.1", renamed), name);
  // Content moving between two files is not the same as staying put.
  const [a, b, ...rest] = entries;
  assert.notEqual(
    cacheNameFor("0.4.1", [
      { path: a.path, hash: b.hash },
      { path: b.path, hash: a.hash },
      ...rest,
    ]),
    name,
  );
  for (const bad of ["", "1.0", "v1.0.0", "../1.0.0", "1.0.0 ", "1.0.0/x"])
    assert.throws(() => cacheNameFor(bad, entries), /Invalid app version/, bad);
});

test("generated worker lists every shipped file once and nothing else", async () => {
  const dist = await makeDist({ ...SHIPPED, ...NEVER_SHIPPED });
  const built = await buildServiceWorker({ dist, version: "0.4.1", template });
  assert.deepEqual(built.files, Object.keys(SHIPPED).sort());
  // Previews are cached when they are first shown, not at install.
  assert.deepEqual(built.lazy, [
    "previews/halloween/bat.png",
    "previews/shape-circle.png",
  ]);
  assert.deepEqual(
    [...built.precache, ...built.lazy].sort(),
    Object.keys(SHIPPED).sort(),
  );
  for (const file of [
    "index.html",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "assets/index-aaa.js",
    "assets/index-aaa.css",
    "favicon.svg",
    "apple-touch-icon.png",
  ])
    assert.ok(built.precache.includes(file), file);
  // The text of the worker names the same files and carries no private path.
  assert.match(
    built.source,
    new RegExp(
      JSON.stringify(built.cacheName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
  for (const file of built.precache)
    assert.ok(built.source.includes(JSON.stringify(file)), file);
  for (const file of built.lazy) assert.ok(!built.source.includes(file), file);
  for (const secret of [
    "node_modules",
    "tests/",
    "pwa.cjs",
    ".env",
    ".git",
    ".map",
    "session-backups",
    "sw.js",
  ])
    assert.ok(
      !built.source
        .replace(/Prism Mapper service worker[\s\S]*?\*\//, "")
        .includes(`"${secret}`),
      secret,
    );
  assert.doesNotThrow(
    () => new vm.Script(built.source),
    "worker must be valid JavaScript",
  );
});

test("the generated worker changes when any file or the version changes, and only then", async () => {
  const dist = await makeDist(SHIPPED);
  const first = await buildServiceWorker({ dist, version: "0.4.1", template });
  const again = await buildServiceWorker({ dist, version: "0.4.1", template });
  assert.equal(
    again.source,
    first.source,
    "same input gives a byte-identical worker",
  );

  // Things that never ship do not disturb the cache name.
  await mkdir(path.join(dist, "node_modules/x"), { recursive: true });
  await writeFile(path.join(dist, "node_modules/x/index.js"), "x");
  await writeFile(path.join(dist, "assets/index-aaa.js.map"), "{}");
  await writeFile(path.join(dist, "sw.js"), "stale worker");
  const ignored = await buildServiceWorker({
    dist,
    version: "0.4.1",
    template,
  });
  assert.equal(ignored.cacheName, first.cacheName);

  // A changed asset does.
  await writeFile(path.join(dist, "assets/index-aaa.js"), "console.log('new')");
  const edited = await buildServiceWorker({ dist, version: "0.4.1", template });
  assert.notEqual(edited.cacheName, first.cacheName);
  // So does a new version.
  const bumped = await buildServiceWorker({ dist, version: "0.5.0", template });
  assert.notEqual(bumped.cacheName, edited.cacheName);
  // And a missing preview image, even though previews are cached lazily.
  await rm(path.join(dist, "previews/shape-circle.png"));
  const trimmed = await buildServiceWorker({
    dist,
    version: "0.5.0",
    template,
  });
  assert.notEqual(trimmed.cacheName, bumped.cacheName);
});

test("rendering needs both placeholders exactly once and inserts text literally", () => {
  const out = renderServiceWorker(template, {
    cacheName: "prism-mapper-v1.0.0-abcdefabcdef",
    precache: ["index.html", "weird$&name.js", "a$`b.js"],
  });
  assert.ok(out.includes('"prism-mapper-v1.0.0-abcdefabcdef"'));
  assert.ok(out.includes('"weird$&name.js"'));
  assert.ok(out.includes('"a$`b.js"'));
  assert.ok(!out.includes("__PRISM_"));
  for (const broken of [
    "const A = 1;",
    'const CACHE_NAME = "__PRISM_CACHE_NAME__";',
    '"__PRISM_CACHE_NAME__" "__PRISM_CACHE_NAME__" "__PRISM_PRECACHE__"',
    '"__PRISM_CACHE_NAME__" "__PRISM_PRECACHE__" "__PRISM_PRECACHE__"',
  ])
    assert.throws(
      () => renderServiceWorker(broken, { cacheName: "x", precache: [] }),
      /exactly once/,
      broken,
    );
});

test("the shipped template has both placeholders once and never names another server", () => {
  assert.equal(template.split('"__PRISM_CACHE_NAME__"').length, 2);
  assert.equal(template.split('"__PRISM_PRECACHE__"').length, 2);
  // Privacy: the worker only handles this app's own folder.
  assert.doesNotMatch(template, /https?:\/\//);
  assert.doesNotMatch(
    template,
    /XMLHttpRequest|sendBeacon|WebSocket|importScripts|postMessage/,
  );
  assert.doesNotMatch(template, /–|—/);
});

test("the build refuses an incomplete dist and a manifest that names missing icons", async () => {
  const empty = await makeDist({ "assets/a.js": "x" });
  await assert.rejects(
    buildServiceWorker({ dist: empty, version: "1.0.0", template }),
    /no index\.html/,
  );
  const files: string[] = Object.keys(SHIPPED);
  await checkManifest(await makeDist(SHIPPED), files);
  await assert.rejects(
    checkManifest(empty, ["index.html"]),
    /manifest\.webmanifest.*missing/,
  );
  await assert.rejects(
    checkManifest(
      await makeDist({ ...SHIPPED, "manifest.webmanifest": "{ not json" }),
      files,
    ),
    SyntaxError,
  );
  await assert.rejects(
    checkManifest(
      await makeDist({
        ...SHIPPED,
        "manifest.webmanifest": JSON.stringify({ icons: [] }),
      }),
      files,
    ),
    /no icons/,
  );
  await assert.rejects(
    checkManifest(
      await makeDist({
        ...SHIPPED,
        "manifest.webmanifest": JSON.stringify({
          icons: [{ src: "icons/gone.png" }],
        }),
      }),
      files,
    ),
    /icons\/gone\.png/,
  );
});

test("buildPwa writes dist/sw.js and running it again gives the same worker", async () => {
  const dist = await makeDist(SHIPPED);
  const packageFile = path.join(
    dist,
    "..",
    `package-${path.basename(dist)}.json`,
  );
  created.push(packageFile);
  await writeFile(packageFile, JSON.stringify({ version: "2.3.4" }));
  const templateFile = new URL("../scripts/sw-template.js", import.meta.url)
    .pathname;
  const first = await buildPwa({ dist, packageFile, templateFile });
  const written = await readFile(path.join(dist, "sw.js"), "utf8");
  assert.equal(written, first.source);
  assert.match(first.cacheName, /^prism-mapper-v2\.3\.4-[0-9a-f]{12}$/);
  assert.ok(!first.files.includes("sw.js"), "the worker never caches itself");
  // The previous sw.js is on disk now; it must not change the result.
  const second = await buildPwa({ dist, packageFile, templateFile });
  assert.equal(second.cacheName, first.cacheName);
  assert.equal(await readFile(path.join(dist, "sw.js"), "utf8"), written);
  await writeFile(packageFile, JSON.stringify({ version: "2.3.5" }));
  const bumped = await buildPwa({ dist, packageFile, templateFile });
  assert.notEqual(bumped.cacheName, first.cacheName);
});

// ---------------------------------------------------------------------------
// The generated worker, run in a sandbox with a fake Cache Storage and network
// ---------------------------------------------------------------------------

interface Served {
  body?: string;
  status?: number;
  redirected?: boolean;
  type?: string;
}
interface Stored {
  body: ArrayBuffer;
  status: number;
  statusText: string;
  headers: [string, string][];
  redirected: boolean;
}
type Input = string | { url: string; cache?: string };
const urlOf = (input: Input) => (typeof input === "string" ? input : input.url);
const strip = (url: string, ignoreSearch?: boolean) =>
  ignoreSearch ? url.split("?")[0] : url;

class FakeCache {
  records = new Map<string, Stored>();
  async put(input: Input, response: Response) {
    this.records.set(urlOf(input), {
      body: await response.arrayBuffer(),
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
      redirected: response.redirected,
    });
  }
  async match(input: Input, options: { ignoreSearch?: boolean } = {}) {
    const wanted = strip(urlOf(input), options.ignoreSearch);
    for (const [url, stored] of this.records)
      if (strip(url, options.ignoreSearch) === wanted)
        return new Response(stored.body, {
          status: stored.status,
          statusText: stored.statusText,
          headers: stored.headers,
        });
    return undefined;
  }
  text(url: string) {
    const stored = this.records.get(url);
    return stored && Buffer.from(stored.body).toString("utf8");
  }
}
class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    let cache = this.stores.get(name);
    if (!cache) this.stores.set(name, (cache = new FakeCache()));
    return cache;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}
class FakeNetwork {
  offline = false;
  served = new Map<string, Served>();
  log: { url: string; cache?: string }[] = [];
  serve(url: string, body: string, extra: Served = {}) {
    this.served.set(url, { body, ...extra });
  }
  async fetch(input: Input) {
    const url = urlOf(input);
    this.log.push({
      url,
      cache: typeof input === "string" ? undefined : input.cache,
    });
    if (this.offline) throw new TypeError("Failed to fetch");
    const served = this.served.get(url);
    const response = new Response(served ? (served.body ?? "") : "not found", {
      status: served ? (served.status ?? 200) : 404,
    });
    Object.defineProperty(response, "type", { value: served?.type ?? "basic" });
    if (served?.redirected)
      Object.defineProperty(response, "redirected", { value: true });
    return response;
  }
}

interface Worker {
  scope: string;
  cache: string;
  skipped: number;
  claimed: number;
  dispatch(
    type: string,
    event?: Record<string, unknown>,
  ): {
    handled: boolean;
    response: Promise<Response>;
    settled(): Promise<unknown>;
  };
  get(
    url: string,
    init?: Record<string, unknown>,
  ): ReturnType<Worker["dispatch"]>;
}

function startWorker(options: {
  source: string;
  cacheName: string;
  scope: string;
  storage: FakeCacheStorage;
  network: FakeNetwork;
}): Worker {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const worker = {
    scope: options.scope,
    cache: `${options.cacheName}@${new URL(options.scope).pathname}`,
    skipped: 0,
    claimed: 0,
  } as Worker;
  const sandbox: Record<string, unknown> = {
    URL,
    Request,
    Response,
    caches: options.storage,
    fetch: (input: Input) => options.network.fetch(input),
    registration: { scope: options.scope },
    skipWaiting: () => {
      worker.skipped++;
      return Promise.resolve();
    },
    clients: {
      claim: () => {
        worker.claimed++;
        return Promise.resolve();
      },
    },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  sandbox.self = sandbox;
  vm.runInNewContext(options.source, sandbox, { filename: "sw.js" });
  worker.dispatch = (type, extra = {}) => {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const event = {
      ...extra,
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      respondWith: (value: Response | Promise<Response>) => {
        response = Promise.resolve(value);
      },
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return {
      handled: response !== undefined,
      response: response as Promise<Response>,
      settled: () => Promise.all(waits),
    };
  };
  worker.get = (url, init = {}) =>
    worker.dispatch("fetch", {
      request: {
        url,
        method: "GET",
        mode: "cors",
        headers: new Headers(),
        ...init,
      },
    });
  return worker;
}

const SCOPES = ["https://app.example/prism-mapper/", "https://app.example/"];
const PRECACHE = ["index.html", "assets/app.js", "manifest.webmanifest"];

function world(
  scope: string,
  cacheName = "prism-mapper-v1.0.0-aaaaaaaaaaaa",
  precache = PRECACHE,
) {
  const storage = new FakeCacheStorage();
  const network = new FakeNetwork();
  network.serve(`${scope}index.html`, "<html>shell v1</html>");
  network.serve(`${scope}assets/app.js`, "app v1");
  network.serve(`${scope}manifest.webmanifest`, "{}");
  network.serve(`${scope}previews/shape.png`, "preview bytes");
  const source = renderServiceWorker(template, { cacheName, precache });
  const worker = startWorker({ source, cacheName, scope, storage, network });
  return { storage, network, worker, source };
}
async function install(worker: Worker) {
  await worker.dispatch("install").settled();
  await worker.dispatch("activate").settled();
}

for (const scope of SCOPES) {
  const label = new URL(scope).pathname;

  test(`install at ${label} downloads each file fresh, caches the folder URL and takes over`, async () => {
    const { storage, network, worker } = world(scope);
    await worker.dispatch("install").settled();
    assert.deepEqual(
      network.log.map((entry) => entry.url).sort(),
      PRECACHE.map((file) => `${scope}${file}`).sort(),
    );
    assert.ok(
      network.log.every((entry) => entry.cache === "reload"),
      "bypasses the HTTP cache",
    );
    const cache = storage.stores.get(worker.cache)!;
    assert.deepEqual(
      [...cache.records.keys()].sort(),
      [...PRECACHE.map((file) => `${scope}${file}`), scope].sort(),
    );
    assert.equal(cache.text(scope), "<html>shell v1</html>");
    assert.equal(worker.skipped, 1);
    assert.equal(worker.claimed, 0, "claiming waits for activation");
    await worker.dispatch("activate").settled();
    assert.equal(worker.claimed, 1);
  });

  test(`everything at ${label} opens offline once installed`, async () => {
    const { network, worker } = world(scope);
    await install(worker);
    network.offline = true;
    const before = network.log.length;
    for (const [file, body] of [
      ["index.html", "<html>shell v1</html>"],
      ["assets/app.js", "app v1"],
      ["manifest.webmanifest", "{}"],
    ]) {
      const result = worker.get(`${scope}${file}`);
      assert.equal(result.handled, true, file);
      assert.equal(await (await result.response).text(), body, file);
    }
    assert.equal(network.log.length, before, "no network request was needed");
  });

  test(`page navigations at ${label} fall back to the cached app when offline`, async () => {
    const { network, worker } = world(scope);
    await install(worker);
    network.offline = true;
    for (const url of [
      scope,
      `${scope}?source=pwa`,
      `${scope}index.html`,
      `${scope}some/deep/link`,
    ]) {
      const result = worker.get(url, { mode: "navigate" });
      assert.equal(result.handled, true, url);
      assert.equal(
        await (await result.response).text(),
        "<html>shell v1</html>",
        url,
      );
    }
  });
}

test("a failed download fails the install, so the old version stays in charge", async () => {
  const { network, worker } = world(SCOPES[0]);
  network.served.delete(`${SCOPES[0]}assets/app.js`);
  await assert.rejects(
    worker.dispatch("install").settled(),
    /Could not cache assets\/app\.js \(404\)/,
  );
  assert.equal(worker.skipped, 0);
  // A network that is down is a failed install too, never a half-installed app.
  const second = world(SCOPES[0]);
  second.network.offline = true;
  await assert.rejects(second.worker.dispatch("install").settled(), TypeError);
  assert.equal(second.worker.skipped, 0);
});

test("a response that followed a redirect is cached as a plain response", async () => {
  const { network, storage, worker } = world(SCOPES[0]);
  network.serve(`${SCOPES[0]}index.html`, "<html>redirected shell</html>", {
    redirected: true,
  });
  await worker.dispatch("install").settled();
  const stored = storage.stores
    .get(worker.cache)!
    .records.get(`${SCOPES[0]}index.html`)!;
  assert.equal(stored.redirected, false);
  assert.equal(
    Buffer.from(stored.body).toString(),
    "<html>redirected shell</html>",
  );
  assert.equal(
    storage.stores.get(worker.cache)!.text(SCOPES[0]),
    "<html>redirected shell</html>",
  );
});

test("activation removes earlier versions of this app folder and nothing else", async () => {
  const { storage, worker } = world(
    SCOPES[0],
    "prism-mapper-v1.1.0-bbbbbbbbbbbb",
  );
  const keep = [
    "prism-mapper-v1.0.0-aaaaaaaaaaaa@/other-copy/", // another folder on the same origin
    "somebody-elses-cache@/prism-mapper/", // not ours
    "workbox-precache-v2@/prism-mapper/",
  ];
  const remove = [
    "prism-mapper-v1.0.0-aaaaaaaaaaaa@/prism-mapper/",
    "prism-mapper-v0.9.9-cccccccccccc@/prism-mapper/",
  ];
  for (const name of [...keep, ...remove]) await storage.open(name);
  await worker.dispatch("install").settled();
  await worker.dispatch("activate").settled();
  assert.deepEqual(
    [...storage.stores.keys()].sort(),
    [...keep, worker.cache].sort(),
  );
  assert.equal(worker.claimed, 1);
});

for (const [first, second] of [
  ["https://app.example/a/", "https://app.example/b/"],
  // One folder name ends exactly like the other: neither may mistake the other's cache for its own.
  [
    "https://app.example/prism-mapper/",
    "https://app.example/other/prism-mapper/",
  ],
  ["https://app.example/", "https://app.example/prism-mapper/"],
]) {
  test(`two copies on one origin (${new URL(first).pathname} and ${new URL(second).pathname}) never clear each other's cache`, async () => {
    const storage = new FakeCacheStorage();
    const network = new FakeNetwork();
    const workers: Worker[] = [];
    for (const scope of [first, second]) {
      network.serve(`${scope}index.html`, `shell ${scope}`);
      network.serve(`${scope}assets/app.js`, "app");
      network.serve(`${scope}manifest.webmanifest`, "{}");
      const name = "prism-mapper-v1.0.0-aaaaaaaaaaaa";
      const source = renderServiceWorker(template, {
        cacheName: name,
        precache: PRECACHE,
      });
      workers.push(
        startWorker({ source, cacheName: name, scope, storage, network }),
      );
    }
    for (const worker of workers) await install(worker);
    assert.deepEqual(
      [...storage.stores.keys()].sort(),
      workers.map((w) => w.cache).sort(),
    );
    // A new version of either copy replaces only that copy's cache.
    for (const [index, scope] of [first, second].entries()) {
      const name = `prism-mapper-v1.${index + 1}.0-bbbbbbbbbbbb`;
      const next = startWorker({
        source: renderServiceWorker(template, {
          cacheName: name,
          precache: PRECACHE,
        }),
        cacheName: name,
        scope,
        storage,
        network,
      });
      await install(next);
      workers[index] = next;
      assert.deepEqual(
        [...storage.stores.keys()].sort(),
        workers.map((w) => w.cache).sort(),
        `after updating ${scope}`,
      );
    }
  });
}

test("a version bump builds a new cache, switches to it and deletes the old one", async () => {
  const scope = SCOPES[0];
  const dist = await makeDist(SHIPPED);
  const storage = new FakeCacheStorage();
  const network = new FakeNetwork();
  const serveDist = async () => {
    network.served.clear();
    for (const file of await listDistFiles(dist))
      network.serve(
        `${scope}${file}`,
        await readFile(path.join(dist, file), "utf8"),
      );
  };
  const launch = async (version: string) => {
    const built = await buildServiceWorker({ dist, version, template });
    await serveDist();
    const worker = startWorker({
      source: built.source,
      cacheName: built.cacheName,
      scope,
      storage,
      network,
    });
    await install(worker);
    return { built, worker };
  };

  const one = await launch("0.4.1");
  assert.deepEqual([...storage.stores.keys()], [one.worker.cache]);
  assert.equal(
    storage.stores.get(one.worker.cache)!.text(`${scope}assets/index-aaa.js`),
    "console.log('app')",
  );

  // A new release changes a file and the version.
  await writeFile(
    path.join(dist, "assets/index-aaa.js"),
    "console.log('app 2')",
  );
  const two = await launch("0.4.2");
  assert.notEqual(two.worker.cache, one.worker.cache);
  assert.deepEqual(
    [...storage.stores.keys()],
    [two.worker.cache],
    "old cache deleted",
  );
  assert.equal(
    storage.stores.get(two.worker.cache)!.text(`${scope}assets/index-aaa.js`),
    "console.log('app 2')",
  );
  network.offline = true;
  const served = two.worker.get(`${scope}assets/index-aaa.js`);
  assert.equal(await (await served.response).text(), "console.log('app 2')");
  assert.equal(two.worker.skipped, 1);
  assert.equal(two.worker.claimed, 1);

  // Same version, one changed file: still a new cache (a rebuild is a new release).
  network.offline = false;
  await writeFile(path.join(dist, "assets/index-aaa.css"), "body{margin:1px}");
  const three = await launch("0.4.2");
  assert.notEqual(three.worker.cache, two.worker.cache);
  assert.deepEqual([...storage.stores.keys()], [three.worker.cache]);
});

test("files that were not cached at install are kept the first time they load", async () => {
  const { network, storage, worker } = world(SCOPES[0]);
  await install(worker);
  const url = `${SCOPES[0]}previews/shape.png`;
  const first = worker.get(url);
  assert.equal(await (await first.response).text(), "preview bytes");
  await first.settled();
  assert.equal(storage.stores.get(worker.cache)!.text(url), "preview bytes");
  network.offline = true;
  const again = worker.get(url);
  assert.equal(await (await again.response).text(), "preview bytes");
});

test("errors and opaque answers are passed on but never kept", async () => {
  const { network, storage, worker } = world(SCOPES[0]);
  await install(worker);
  network.serve(`${SCOPES[0]}previews/broken.png`, "oops", { status: 500 });
  network.serve(`${SCOPES[0]}previews/opaque.png`, "x", { type: "opaque" });
  const missing = worker.get(`${SCOPES[0]}previews/missing.png`);
  assert.equal((await missing.response).status, 404);
  const broken = worker.get(`${SCOPES[0]}previews/broken.png`);
  assert.equal((await broken.response).status, 500);
  const opaque = worker.get(`${SCOPES[0]}previews/opaque.png`);
  await opaque.response;
  await Promise.all([missing.settled(), broken.settled(), opaque.settled()]);
  const kept = [...storage.stores.get(worker.cache)!.records.keys()];
  assert.ok(!kept.some((url) => url.includes("previews/")), kept.join(", "));
});

test("an uncached file offline fails the way the network would; a page still opens", async () => {
  const { network, worker } = world(SCOPES[0]);
  await install(worker);
  network.offline = true;
  await assert.rejects(
    worker.get(`${SCOPES[0]}previews/never-seen.png`).response,
    TypeError,
  );
  const page = worker.get(`${SCOPES[0]}never-seen`, { mode: "navigate" });
  assert.equal(await (await page.response).text(), "<html>shell v1</html>");
});

test("a navigation that is online and uncached is passed to the network and not stored", async () => {
  const { network, storage, worker } = world(SCOPES[0]);
  await install(worker);
  const url = `${SCOPES[0]}docs/page.html`;
  network.serve(url, "<html>docs</html>");
  const result = worker.get(url, { mode: "navigate" });
  assert.equal(await (await result.response).text(), "<html>docs</html>");
  await result.settled();
  assert.equal(storage.stores.get(worker.cache)!.text(url), undefined);
});

test("requests the worker must not touch are left to the browser", async () => {
  const { worker } = world(SCOPES[0]);
  await install(worker);
  const decline = (url: string, init: Record<string, unknown> = {}) =>
    assert.equal(
      worker.get(url, init).handled,
      false,
      `${init.method ?? "GET"} ${url}`,
    );
  decline(`${SCOPES[0]}assets/app.js`, { method: "POST" });
  decline(`${SCOPES[0]}assets/app.js`, { method: "PUT" });
  decline(`${SCOPES[0]}previews/shape.png`, {
    headers: new Headers({ Range: "bytes=0-99" }),
  });
  decline("https://cdn.example/lib.js");
  decline("https://app.example/other/app.js");
  decline("https://app.example/prism-mapper-evil/app.js");
  decline("https://app.example/prism-mapper");
  decline("http://app.example/prism-mapper/assets/app.js");
  decline("blob:https://app.example/0a1b2c");
  decline("data:text/plain,hello");
  // And an ordinary in-scope GET is handled.
  assert.equal(worker.get(`${SCOPES[0]}assets/app.js`).handled, true);
});

test("the worker only ever asks its own origin for files", async () => {
  const { network, worker } = world(SCOPES[0]);
  await install(worker);
  const url = `${SCOPES[0]}previews/shape.png`;
  await worker.get(url).response;
  for (const entry of network.log)
    assert.ok(entry.url.startsWith(SCOPES[0]), entry.url);
});
