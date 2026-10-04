// End-to-end checks for the installable, offline-capable web app, in headless
// Chromium against the production build.
//
// The test serves dist/ itself from small static servers, so it needs no dev
// server: one at the domain root (port 4194, change it with PRISM_PWA_PORT) and
// others under /prism-mapper/ and /other/prism-mapper/. If dist/ is missing it
// runs `npm run build` first. Set PRISM_PWA_DIST to test another folder and
// PRISM_PWA_ONLY=<words> to run only the scenarios whose name contains them.
// PRISM_DEV_URL=<dev server> adds a check that `npm run dev` registers no worker.
//
// What this cannot prove: real iOS Safari or WebKit behavior, the Android Chrome
// install prompt (the event is simulated), real phones, or how much storage a
// real device grants. See the notes printed at the end.
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { launchBrowser } = require("./browser.cjs");

const root = path.resolve(__dirname, "..");
const DIST = path.resolve(
  process.env.PRISM_PWA_DIST || path.join(root, "dist"),
);
const PORT = Number(process.env.PRISM_PWA_PORT || 4194);
const ONLY = (process.env.PRISM_PWA_ONLY || "").toLowerCase();
const DEV_URL = process.env.PRISM_DEV_URL || "";

// ---------------------------------------------------------------- static host

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/**
 * A plain static file host for one dist folder, mounted at one or more path
 * prefixes. Like a typical host it redirects /folder to /folder/ and answers
 * unknown files with 404. It sends `no-store`, so the browser's HTTP cache can
 * never hide a missing offline file.
 */
class Hosting {
  constructor(dist, { mounts = ["/"], port = 0 } = {}) {
    this.dist = dist;
    this.mounts = mounts;
    this.port = port;
    this.log = [];
    /** While true every request fails like a lost connection. */
    this.down = false;
  }
  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, "127.0.0.1", resolve);
    });
    this.port = this.server.address().port;
    this.origin = `http://127.0.0.1:${this.port}`;
    return this;
  }
  async stop() {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }
  url(mount = this.mounts[0], rest = "") {
    return `${this.origin}${mount}${rest}`;
  }
  handle(req, res) {
    if (this.down) return req.socket.destroy();
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    const done = (status, headers = {}, body = "") => {
      this.log.push({ method: req.method, path: pathname, status });
      res.writeHead(status, { "cache-control": "no-store", ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    const bare = this.mounts.find(
      (mount) => mount !== "/" && pathname === mount.slice(0, -1),
    );
    if (bare) return done(301, { location: bare + url.search });
    const mount = [...this.mounts]
      .sort((a, b) => b.length - a.length)
      .find((candidate) => pathname.startsWith(candidate));
    if (!mount) return done(404, {}, "Not found");
    let relative = pathname.slice(mount.length);
    if (relative === "" || relative.endsWith("/")) relative += "index.html";
    const file = path.resolve(this.dist, relative);
    if (!file.startsWith(this.dist + path.sep)) return done(403, {}, "Denied");
    fs.readFile(file).then(
      (body) =>
        done(
          200,
          {
            "content-type":
              TYPES[path.extname(file)] || "application/octet-stream",
            "content-length": body.length,
          },
          body,
        ),
      () => done(404, {}, "Not found"),
    );
  }
}

// --------------------------------------------------------------------- images

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
/** A solid-colour RGB PNG made here, so the test needs no image files. */
function makePng(width, height, [r, g, b]) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * stride + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function pngSize(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}
/** Decode an 8-bit RGB or RGBA PNG (what a Chromium screenshot is) to read pixels. */
function decodePng(buffer) {
  let position = 8;
  let header;
  const data = [];
  while (position < buffer.length) {
    const length = buffer.readUInt32BE(position);
    const type = buffer.toString("ascii", position + 4, position + 8);
    const body = buffer.subarray(position + 8, position + 8 + length);
    if (type === "IHDR") header = body;
    if (type === "IDAT") data.push(body);
    position += 12 + length;
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  assert.equal(header[8], 8, "8-bit PNG expected");
  assert.ok(header[9] === 2 || header[9] === 6, "RGB or RGBA PNG expected");
  assert.equal(header[12], 0, "interlaced PNG not supported");
  const bpp = header[9] === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let value = raw[y * (stride + 1) + 1 + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = value & 255;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => [
      ...out.subarray(y * stride + x * bpp, y * stride + x * bpp + 3),
    ],
  };
}

// -------------------------------------------------------------------- helpers

const offenders = new Set();
const pageErrors = [];
const sameOrigin = (url) =>
  /^(?:https?:\/\/127\.0\.0\.1:\d+\/|blob:http:\/\/127\.0\.0\.1:\d+\/|data:|about:)/.test(
    url,
  );

async function openContext(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...options,
  });
  context.setDefaultTimeout(30000);
  context.on("request", (request) => {
    if (!sameOrigin(request.url())) offenders.add(request.url());
  });
  return context;
}
async function openPage(context, url, { ready = true } = {}) {
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    pageErrors.push(`${page.url()}: ${error.message}`),
  );
  await page.goto(url);
  if (ready) await page.getByRole("button", { name: "Save project" }).waitFor();
  return page;
}
const controlled = (page) =>
  page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
const cacheNames = (page) => page.evaluate(() => caches.keys());
/** Poll until `check` gives something truthy. (waitForFunction does not poll an async predicate.) */
async function eventually(check, what, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${what} (last: ${JSON.stringify(last)})`);
}
const cacheUrls = (page, name) =>
  page.evaluate(
    async (cacheName) =>
      (await (await caches.open(cacheName)).keys()).map((r) => r.url),
    name,
  );
const draft = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("prism-draft")));
const mediaInput = (page) =>
  page.locator('input[type="file"][accept*="image/png"]');
async function openHelp(page) {
  await page.getByRole("button", { name: "Open setup guide" }).click();
  const dialog = page.getByRole("dialog", { name: "Your first mapping" });
  await dialog.waitFor();
  return dialog;
}
const closeHelp = (page) =>
  page.getByRole("button", { name: "Close setup guide" }).click();
const toast = (page, text) =>
  page.getByRole("status").filter({ hasText: text });
const alertWith = (page, text) =>
  page.getByRole("alert").filter({ hasText: text });
/** Colour at the middle of the mapping canvas, where the default layer sits. */
async function centerPixel(page) {
  const png = decodePng(await page.locator(".stage canvas").screenshot());
  return png.pixel(Math.floor(png.width / 2), Math.floor(png.height / 2));
}
async function waitForPixel(page, test, label, timeout = 25000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await centerPixel(page);
    if (test(last)) return last;
    await page.waitForTimeout(400);
  }
  throw new Error(`${label}: the center pixel stayed ${JSON.stringify(last)}`);
}
// The test image is pure magenta; the default brightness dims it a little.
const isMagenta = ([r, g, b]) =>
  r > 110 && b > 110 && g < 70 && Math.abs(r - b) < 50;
/** What is stored in the browser's IndexedDB, without ever creating the database. */
const savedMedia = (page) =>
  page.evaluate(async () => {
    const found = await indexedDB.databases();
    if (!found.some((db) => db.name === "prism-mapper")) return null;
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("prism-mapper");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["media-blobs", "media-meta"], "readonly");
        const keys = tx.objectStore("media-blobs").getAllKeys();
        const blobs = tx.objectStore("media-blobs").getAll();
        const meta = tx.objectStore("media-meta").getAll();
        tx.oncomplete = () => {
          db.close();
          resolve({
            ids: keys.result,
            sizes: blobs.result.map((blob) => blob.size),
            meta: meta.result,
          });
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
async function waitForSaved(page, count) {
  await page.waitForFunction(
    async (expected) => {
      const found = await indexedDB.databases();
      if (!found.some((db) => db.name === "prism-mapper"))
        return expected === 0;
      return new Promise((resolve) => {
        const open = indexedDB.open("prism-mapper");
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("media-blobs")
            .objectStore("media-blobs")
            .count();
          request.onsuccess = () => {
            db.close();
            resolve(request.result === expected);
          };
          request.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        open.onerror = () => resolve(false);
      });
    },
    count,
    { polling: 300 },
  );
}

let builder;
async function buildScript() {
  builder ??= await import(
    pathToFileURL(path.join(root, "scripts", "build-pwa.mjs")).href
  );
  return builder;
}
const packageVersion = async () =>
  JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))
    .version;

const results = [];
async function scenario(name, run) {
  if (ONLY && !name.toLowerCase().includes(ONLY)) return;
  const started = Date.now();
  try {
    await run();
    results.push({ name, ok: true });
    console.log(
      `PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}`);
    console.error(error);
  }
}

// ------------------------------------------------------------------- the test

async function main() {
  const exists = (file) =>
    fs.access(file).then(
      () => true,
      () => false,
    );
  if (
    !(await exists(path.join(DIST, "index.html"))) ||
    !(await exists(path.join(DIST, "sw.js")))
  ) {
    console.log("dist/ is missing or incomplete, running npm run build ...");
    const build = spawnSync("npm", ["run", "build"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    assert.equal(build.status, 0, "npm run build failed");
  }
  const version = await packageVersion();
  const { buildServiceWorker, buildPwa } = await buildScript();
  const template = await fs.readFile(
    path.join(root, "scripts", "sw-template.js"),
    "utf8",
  );
  const expected = await buildServiceWorker({ dist: DIST, version, template });

  const host = await new Hosting(DIST, { port: PORT }).start();
  const browser = await launchBrowser();
  const tempFolders = [];
  const extraHosts = [];
  const track = async (instance) => {
    extraHosts.push(instance);
    return instance.start();
  };
  try {
    // ------------------------------------------------------------ build output
    await scenario(
      "dist holds the web-only files next to the app",
      async () => {
        const files = (await expected.files).filter(
          (f) => !f.startsWith("previews/"),
        );
        for (const required of [
          "index.html",
          "manifest.webmanifest",
          "favicon.svg",
          "favicon-32.png",
          "apple-touch-icon.png",
          "icons/icon-192.png",
          "icons/icon-512.png",
          "icons/icon-maskable-512.png",
        ])
          assert.ok(files.includes(required), `dist/${required} is missing`);
        assert.ok(
          await exists(path.join(DIST, "sw.js")),
          "dist/sw.js is missing",
        );
        assert.ok(
          files.some((f) => /^assets\/.*\.js$/.test(f)),
          "no JavaScript bundle",
        );
        for (const file of files)
          assert.doesNotMatch(
            file,
            /node_modules|\.map$|\.log$|\.test\.|^tests?\//,
            file,
          );
        const worker = await fs.readFile(path.join(DIST, "sw.js"), "utf8");
        assert.ok(
          worker.includes(JSON.stringify(expected.cacheName)) &&
            worker.includes(JSON.stringify(expected.lazyCacheName)),
          "dist/sw.js is out of date for the files in dist/. Run npm run build.",
        );
        const html = await fs.readFile(path.join(DIST, "index.html"), "utf8");
        assert.doesNotMatch(
          html,
          /rel="manifest"/,
          "the manifest link is added at run time",
        );
      },
    );

    // --------------------------------------------------------- manifest and icons
    await scenario(
      "manifest parses and every icon is served at its declared size",
      async () => {
        const get = async (rest) => {
          const response = await fetch(host.url("/", rest));
          return {
            status: response.status,
            body: Buffer.from(await response.arrayBuffer()),
          };
        };
        const manifestResponse = await get("manifest.webmanifest");
        assert.equal(manifestResponse.status, 200);
        const manifest = JSON.parse(manifestResponse.body.toString());
        assert.equal(manifest.name, "Prism Mapper");
        assert.equal(manifest.short_name, "Prism");
        assert.equal(manifest.display, "standalone");
        assert.deepEqual(manifest.display_override, [
          "standalone",
          "minimal-ui",
        ]);
        assert.equal(manifest.background_color, "#090d12");
        assert.equal(manifest.theme_color, "#090d12");
        const manifestUrl = host.url("/", "manifest.webmanifest");
        for (const key of ["start_url", "scope"])
          assert.equal(
            new URL(manifest[key], manifestUrl).href,
            host.url("/"),
            key,
          );
        const purposes = [];
        for (const icon of manifest.icons) {
          const response = await get(icon.src.replace(/^\.\//, ""));
          assert.equal(response.status, 200, icon.src);
          assert.equal(pngSize(response.body), icon.sizes, icon.src);
          purposes.push(`${icon.sizes}:${icon.purpose || "any"}`);
        }
        for (const wanted of ["192x192:any", "512x512:any", "512x512:maskable"])
          assert.ok(purposes.includes(wanted), `missing icon ${wanted}`);
        for (const [file, size] of [
          ["apple-touch-icon.png", "180x180"],
          ["favicon-32.png", "32x32"],
        ]) {
          const response = await get(file);
          assert.equal(response.status, 200, file);
          assert.equal(pngSize(response.body), size, file);
        }
        const svg = await get("favicon.svg");
        assert.equal(svg.status, 200);
        assert.match(svg.body.toString(), /<svg\b/);
      },
    );

    await scenario(
      "the page links its manifest, icons and colours; Chrome finds the app installable",
      async () => {
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        await page.waitForSelector('link[rel="manifest"]', {
          state: "attached",
        });
        const tags = await page.evaluate(() => ({
          manifest: [...document.querySelectorAll('link[rel="manifest"]')].map(
            (l) => l.href,
          ),
          viewport: document.querySelector('meta[name="viewport"]').content,
          theme: document.querySelector('meta[name="theme-color"]').content,
          appleCapable: document.querySelector(
            'meta[name="apple-mobile-web-app-capable"]',
          ).content,
          title: document.querySelector(
            'meta[name="apple-mobile-web-app-title"]',
          ).content,
          statusBar: document.querySelector(
            'meta[name="apple-mobile-web-app-status-bar-style"]',
          ).content,
          touchIcon: document.querySelector('link[rel="apple-touch-icon"]')
            .href,
        }));
        assert.deepEqual(tags.manifest, [
          host.url("/", "manifest.webmanifest"),
        ]);
        assert.equal(
          tags.viewport,
          "width=device-width, initial-scale=1.0, viewport-fit=cover",
        );
        assert.equal(tags.theme, "#090d12");
        assert.equal(tags.appleCapable, "yes");
        assert.equal(tags.title, "Prism Mapper");
        assert.equal(tags.statusBar, "black-translucent");
        assert.equal(tags.touchIcon, host.url("/", "apple-touch-icon.png"));
        await controlled(page);

        const cdp = await context.newCDPSession(page);
        const found = await cdp.send("Page.getAppManifest");
        assert.deepEqual(found.errors, [], "Chrome reported manifest problems");
        assert.equal(found.url, host.url("/", "manifest.webmanifest"));
        // Playwright's browser profile is incognito, which Chrome never lets install; every other criterion must hold.
        const { installabilityErrors } = await cdp.send(
          "Page.getInstallabilityErrors",
        );
        assert.deepEqual(
          installabilityErrors.filter((e) => e.errorId !== "in-incognito"),
          [],
          "Chrome lists installability problems",
        );
        await context.close();
      },
    );

    // ---------------------------------------------------------- worker and offline
    await scenario(
      "the service worker registers, takes control and caches the whole app",
      async () => {
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        await controlled(page);
        const worker = await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          return {
            scope: registration.scope,
            script: registration.active.scriptURL,
          };
        });
        assert.equal(worker.scope, host.url("/"));
        assert.equal(worker.script, host.url("/", "sw.js"));
        const names = await cacheNames(page);
        assert.deepEqual(names, [`${expected.cacheName}@/`]);
        const urls = (await cacheUrls(page, names[0])).sort();
        const wanted = [
          ...expected.precache.map((f) => host.url("/", f)),
          host.url("/"),
        ].sort();
        assert.deepEqual(urls, wanted);
        // A first visit is not an update.
        assert.equal(await toast(page, "Update ready").count(), 0);
        const dialog = await openHelp(page);
        await dialog.getByText("Ready to work without a connection").waitFor();
        assert.equal(
          await dialog.getByText("A new version is ready").count(),
          0,
        );
        await context.close();
      },
    );

    await scenario(
      "after one visit the app reopens with no connection",
      async () => {
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        await controlled(page);
        // Neutral requests that the worker answers and caches while online.
        await page.evaluate(
          async () => (await fetch("./previews/aurora.png")).ok,
        );
        await page.waitForFunction(async () =>
          Boolean(await caches.match("./previews/aurora.png")),
        );
        const origin = host.origin;
        await context.setOffline(true);
        await host.stop();
        try {
          const served = [];
          page.on("response", (r) =>
            served.push({ url: r.url(), sw: r.fromServiceWorker() }),
          );
          await page.reload();
          await page.getByRole("button", { name: "Save project" }).waitFor();
          assert.equal(await page.title(), "Prism Mapper");
          const html = served.find((r) => r.url === `${origin}/`);
          const bundle = served.find((r) =>
            /\/assets\/index-.*\.js$/.test(r.url),
          );
          assert.ok(html?.sw, "the page came from the service worker");
          assert.ok(bundle?.sw, "the script came from the service worker");
          // The app is usable: change a setting, open the Help window.
          await page
            .getByRole("combobox", { name: "Surface source", exact: true })
            .selectOption("checker");
          const dialog = await openHelp(page);
          await dialog
            .getByText("Ready to work without a connection")
            .waitFor();
          await closeHelp(page);
          // A launch URL with a query string, and index.html itself, open the app too.
          for (const rest of ["?source=pwa", "index.html"]) {
            await page.goto(host.url("/", rest));
            await page.getByRole("button", { name: "Save project" }).waitFor();
          }
          // A preview seen online is still there; one never seen is simply absent.
          assert.equal(
            await page.evaluate(
              async () => (await fetch("./previews/aurora.png")).ok,
            ),
            true,
          );
          assert.equal(
            await page.evaluate(() =>
              fetch("./previews/never-visited.png").then(
                () => "reply",
                () => "network error",
              ),
            ),
            "network error",
          );
        } finally {
          await context.setOffline(false);
          await host.start();
        }
        await context.close();
      },
    );

    await scenario(
      "previews are cached the first time they are shown",
      async () => {
        assert.ok(
          expected.lazy.length > 10,
          "dist/previews should not be empty",
        );
        assert.ok(
          expected.lazy.every((f) => f.startsWith("previews/")) &&
            !expected.precache.some((f) => f.startsWith("previews/")),
          "previews are not part of the install download",
        );
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        await controlled(page);
        const [name] = await cacheNames(page);
        const before = await cacheUrls(page, name);
        assert.ok(
          !before.some((u) => u.includes("/previews/")),
          "no previews at install",
        );
        await page.evaluate(() =>
          fetch("./previews/comet.png").then((r) => r.arrayBuffer()),
        );
        // They go into a cache of their own, named for the pictures.
        await page.waitForFunction(
          async (n) =>
            (await (await caches.open(n)).keys()).some((r) =>
              r.url.endsWith("/previews/comet.png"),
            ),
          `${expected.lazyCacheName}@/`,
        );
        assert.ok(
          !(await cacheUrls(page, name)).some((u) => u.includes("/previews/")),
          "and not into the release's cache",
        );
        await context.close();
      },
    );

    await scenario(
      "a new release replaces the old cache and tells the person to reload",
      async () => {
        const temp = await fs.mkdtemp(path.join(os.tmpdir(), "prism-pwa-e2e-"));
        tempFolders.push(temp);
        const dist = path.join(temp, "dist");
        await fs.cp(DIST, dist, { recursive: true });
        const packageFile = path.join(temp, "package.json");
        const templateFile = path.join(root, "scripts", "sw-template.js");
        await fs.writeFile(
          packageFile,
          JSON.stringify({ version: "0.4.1-e2e.1" }),
        );
        const first = await buildPwa({ dist, packageFile, templateFile });
        const releases = await track(new Hosting(dist));
        const context = await openContext(browser);
        const page = await openPage(context, releases.url());
        await controlled(page);
        assert.deepEqual(await cacheNames(page), [`${first.cacheName}@/`]);
        assert.equal(await toast(page, "Update ready").count(), 0);

        // Ship version two: a changed file and a new version number.
        const index = path.join(dist, "index.html");
        await fs.writeFile(
          index,
          (await fs.readFile(index, "utf8")).replace(
            "<title>Prism Mapper</title>",
            "<title>Prism Mapper (updated)</title>",
          ),
        );
        await fs.writeFile(
          packageFile,
          JSON.stringify({ version: "0.4.2-e2e.2" }),
        );
        const second = await buildPwa({ dist, packageFile, templateFile });
        assert.notEqual(second.cacheName, first.cacheName);
        await page.evaluate(async () =>
          (await navigator.serviceWorker.getRegistration()).update(),
        );

        await toast(
          page,
          "Update ready. Reload to use the newest version.",
        ).waitFor();
        // The page hears about the new worker as it starts activating; it then removes the old cache.
        await page.waitForFunction(
          async (wanted) =>
            JSON.stringify(await caches.keys()) === JSON.stringify([wanted]),
          `${second.cacheName}@/`,
        );
        assert.equal(
          await page.title(),
          "Prism Mapper",
          "the open page is not changed under the person",
        );
        const dialog = await openHelp(page);
        await dialog.getByText("A new version is ready").waitFor();
        await dialog.getByRole("button", { name: "Reload now" }).click();
        await page.waitForFunction(
          () => document.title === "Prism Mapper (updated)",
        );
        await page.getByRole("button", { name: "Save project" }).waitFor();
        const again = await openHelp(page);
        assert.equal(
          await again.getByText("A new version is ready").count(),
          0,
        );
        // The library asked for its pictures meanwhile, and they stay across the update.
        assert.deepEqual(
          (await cacheNames(page)).filter(
            (name) => name !== `${second.lazyCacheName}@/`,
          ),
          [`${second.cacheName}@/`],
        );
        await context.close();
      },
    );

    await scenario(
      "pictures seen before an update are still there offline after it, unless the update changes them",
      async () => {
        const temp = await fs.mkdtemp(path.join(os.tmpdir(), "prism-pwa-e2e-"));
        tempFolders.push(temp);
        const dist = path.join(temp, "dist");
        await fs.cp(DIST, dist, { recursive: true });
        const packageFile = path.join(temp, "package.json");
        const templateFile = path.join(root, "scripts", "sw-template.js");
        const release = async (version) => {
          await fs.writeFile(packageFile, JSON.stringify({ version }));
          return buildPwa({ dist, packageFile, templateFile });
        };
        const first = await release("0.4.1-e2e.3");
        const releases = await track(new Hosting(dist));
        const context = await openContext(browser);
        const page = await openPage(context, releases.url());
        await controlled(page);
        const cachesAre = (names) =>
          eventually(
            async () =>
              JSON.stringify((await cacheNames(page)).sort()) ===
              JSON.stringify([...names].sort()),
            `the caches should be ${names.join(" and ")}`,
          );
        const update = () =>
          page.evaluate(async () =>
            (await navigator.serviceWorker.getRegistration()).update(),
          );
        // The size of a picture, or what went wrong asking for it.
        const picture = (name) =>
          page.evaluate(
            (n) =>
              fetch(`./previews/${n}.png`).then(
                async (r) =>
                  r.ok ? (await r.arrayBuffer()).byteLength : r.status,
                () => "network error",
              ),
            name,
          );

        // Two pictures are seen online and kept in the pictures' cache.
        const lazy = `${first.lazyCacheName}@/`;
        const cometSize = await picture("comet");
        assert.ok(cometSize > 100, "the picture has content");
        await picture("aurora");
        await eventually(
          async () =>
            (await cacheUrls(page, lazy)).filter(
              (u) => u.endsWith("/comet.png") || u.endsWith("/aurora.png"),
            ).length === 2,
          "both pictures should be kept",
        );

        // Release two changes the page and the version, not the pictures.
        const index = path.join(dist, "index.html");
        await fs.writeFile(
          index,
          (await fs.readFile(index, "utf8")).replace(
            "<title>Prism Mapper</title>",
            "<title>Prism Mapper (two)</title>",
          ),
        );
        const second = await release("0.4.2-e2e.4");
        assert.notEqual(second.cacheName, first.cacheName);
        assert.equal(second.lazyCacheName, first.lazyCacheName);
        await update();
        await cachesAre([`${second.cacheName}@/`, lazy]);
        releases.down = true;
        try {
          assert.equal(await picture("comet"), cometSize);
          assert.ok(Number.isInteger(await picture("aurora")));
          assert.equal(
            await picture("never-visited"),
            "network error",
            "a picture never seen is simply absent",
          );
        } finally {
          releases.down = false;
        }

        // Release three redraws one picture, so the old pictures are dropped.
        await fs.appendFile(path.join(dist, "previews", "comet.png"), "\0");
        const third = await release("0.4.3-e2e.5");
        assert.notEqual(third.lazyCacheName, first.lazyCacheName);
        await update();
        await cachesAre([`${third.cacheName}@/`]);
        releases.down = true;
        try {
          assert.equal(
            await picture("comet"),
            "network error",
            "the old picture is not shown in place of the new one",
          );
        } finally {
          releases.down = false;
        }
        assert.equal(await picture("comet"), cometSize + 1);
        await context.close();
      },
    );

    await scenario(
      "works from a sub-path, offline, beside a second copy on the same origin",
      async () => {
        const mounts = ["/prism-mapper/", "/other/prism-mapper/"];
        const sub = await track(new Hosting(DIST, { mounts }));
        const bare = await fetch(`${sub.origin}/prism-mapper`, {
          redirect: "manual",
        });
        assert.equal(bare.status, 301);
        assert.equal(bare.headers.get("location"), "/prism-mapper/");
        sub.log.length = 0;

        const context = await openContext(browser);
        const first = await openPage(context, sub.url(mounts[0]));
        await controlled(first);
        const manifest = await (
          await context.newCDPSession(first)
        ).send("Page.getAppManifest");
        assert.deepEqual(manifest.errors, []);
        const parsed = JSON.parse(manifest.data);
        assert.equal(
          new URL(parsed.start_url, manifest.url).href,
          sub.url(mounts[0]),
        );
        assert.equal(
          new URL(parsed.scope, manifest.url).href,
          sub.url(mounts[0]),
        );
        const registration = await first.evaluate(async () => {
          const r = await navigator.serviceWorker.ready;
          return { scope: r.scope, script: r.active.scriptURL };
        });
        assert.deepEqual(registration, {
          scope: sub.url(mounts[0]),
          script: sub.url(mounts[0], "sw.js"),
        });

        // A second copy on the same origin, whose folder name ends like the first one's.
        const second = await openPage(context, sub.url(mounts[1]));
        await controlled(second);
        const expectedNames = [
          `${expected.cacheName}@${mounts[0]}`,
          `${expected.cacheName}@${mounts[1]}`,
        ].sort();
        await first.waitForFunction(
          async (wanted) =>
            JSON.stringify((await caches.keys()).sort()) ===
            JSON.stringify(wanted),
          expectedNames,
        );

        // Nothing was requested outside the two folders and nothing failed.
        const failed = sub.log.filter((e) => e.status >= 400);
        assert.deepEqual(failed, [], "requests that failed");
        for (const entry of sub.log)
          assert.ok(
            mounts.some((m) => entry.path.startsWith(m)),
            `${entry.path} is outside the app folders`,
          );

        // Offline, both copies reopen.
        await context.setOffline(true);
        await sub.stop();
        try {
          for (const page of [first, second]) {
            await page.reload();
            await page.getByRole("button", { name: "Save project" }).waitFor();
          }
        } finally {
          await context.setOffline(false);
        }
        await context.close();
      },
    );

    // -------------------------------------------------------------- persistence
    const card = makePng(32, 32, [255, 0, 255]);
    const importCard = async (page, name = "test-card.png") => {
      await mediaInput(page).setInputFiles({
        name,
        mimeType: "image/png",
        buffer: card,
      });
      await page.getByRole("button", { name, exact: true }).waitFor();
    };

    await scenario(
      "imported media survives a reload and can be assigned to a layer",
      async () => {
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        const source = page.getByRole("combobox", {
          name: "Surface source",
          exact: true,
        });
        await source.selectOption("checker");
        await waitForPixel(page, (p) => !isMagenta(p), "checker pattern");
        await importCard(page);
        await page
          .getByRole("button", { name: "test-card.png", exact: true })
          .click();
        await waitForPixel(page, isMagenta, "imported image on the layer");
        const saved = await draft(page);
        assert.equal(saved.media.length, 1);
        assert.deepEqual(
          {
            name: saved.media[0].name,
            kind: saved.media[0].kind,
            url: saved.media[0].url,
          },
          { name: "test-card.png", kind: "image", url: "" },
        );
        assert.equal(saved.surfaces[0].source, saved.media[0].id);
        await waitForSaved(page, 1);
        const stored = await savedMedia(page);
        assert.deepEqual(stored.ids, [saved.media[0].id]);
        assert.deepEqual(stored.sizes, [card.length]);

        await page.reload();
        await page.getByRole("button", { name: "Save project" }).waitFor();
        await page.getByRole("button", { name: /^My media/ }).click();
        await page
          .getByRole("button", { name: "test-card.png", exact: true })
          .waitFor();
        assert.equal(await alertWith(page, "no longer saved").count(), 0);
        const reloaded = await draft(page);
        assert.equal(reloaded.media[0].id, saved.media[0].id);
        await waitForPixel(
          page,
          isMagenta,
          "restored image on the layer after reload",
        );

        // The restored media can be picked again for the layer.
        await source.selectOption("checker");
        await waitForPixel(
          page,
          (p) => !isMagenta(p),
          "switched to a built-in animation",
        );
        await source.selectOption({ label: "test-card.png" });
        await waitForPixel(page, isMagenta, "restored image picked again");
        assert.equal((await draft(page)).surfaces[0].source, saved.media[0].id);
        assert.deepEqual(pageErrors, []);
        await context.close();
      },
    );

    await scenario(
      "media that the browser dropped stays listed, dark and clearly reported",
      async () => {
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        await importCard(page);
        await page
          .getByRole("button", { name: "test-card.png", exact: true })
          .click();
        await waitForPixel(page, isMagenta, "imported image");
        await waitForSaved(page, 1);
        // Simulate eviction under storage pressure.
        await page.evaluate(
          () =>
            new Promise((resolve, reject) => {
              const open = indexedDB.open("prism-mapper");
              open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction(
                  ["media-blobs", "media-meta"],
                  "readwrite",
                );
                tx.objectStore("media-blobs").clear();
                tx.objectStore("media-meta").clear();
                tx.oncomplete = () => {
                  db.close();
                  resolve();
                };
                tx.onerror = () => reject(tx.error);
              };
            }),
        );
        await page.reload();
        await page.getByRole("button", { name: "Save project" }).waitFor();
        const warning = alertWith(page, "test-card.png");
        await warning.waitFor();
        assert.match(
          await warning.innerText(),
          /no longer saved on this device/,
        );
        assert.equal(
          (await draft(page)).media.length,
          1,
          "the entry is kept so it can be replaced",
        );
        assert.equal(
          isMagenta(await centerPixel(page)),
          false,
          "a layer without its file stays dark",
        );
        // Importing the file again and picking it fixes the layer.
        await importCard(page, "test-card-again.png");
        await page
          .getByRole("button", { name: "test-card-again.png", exact: true })
          .click();
        await waitForPixel(page, isMagenta, "re-imported image");
        assert.deepEqual(pageErrors, []);
        await context.close();
      },
    );

    await scenario(
      "blobs that no project refers to are collected at launch",
      async () => {
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        await importCard(page);
        await waitForSaved(page, 1);
        await page.evaluate(
          () =>
            new Promise((resolve, reject) => {
              const open = indexedDB.open("prism-mapper");
              open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction(
                  ["media-blobs", "media-meta"],
                  "readwrite",
                );
                tx.objectStore("media-blobs").put(
                  new Blob(["orphan"]),
                  "orphan-1",
                );
                tx.objectStore("media-meta").put({
                  id: "orphan-1",
                  name: "orphan.png",
                  kind: "image",
                  size: 6,
                });
                tx.oncomplete = () => {
                  db.close();
                  resolve();
                };
                tx.onerror = () => reject(tx.error);
              };
            }),
        );
        assert.equal((await savedMedia(page)).ids.length, 2);
        await page.reload();
        await page.getByRole("button", { name: "Save project" }).waitFor();
        await waitForSaved(page, 1);
        const stored = await savedMedia(page);
        assert.equal(stored.ids.length, 1);
        assert.ok(!stored.ids.includes("orphan-1"));
        assert.equal(
          stored.ids[0],
          (await draft(page)).media[0].id,
          "the file in use is kept",
        );
        await context.close();
      },
    );

    await scenario(
      "clearing the saved draft and media removes both and leaves the open project alone",
      async () => {
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        let dialog = await openHelp(page);
        await dialog.getByText("No media saved here yet").waitFor();
        await closeHelp(page);
        await importCard(page);
        await page
          .getByRole("button", { name: "test-card.png", exact: true })
          .click();
        await waitForPixel(page, isMagenta, "imported image");
        await waitForSaved(page, 1);
        dialog = await openHelp(page);
        await dialog.getByText(/1 media file saved on this device/).waitFor();
        await dialog
          .getByRole("button", { name: "Clear saved draft and media" })
          .click();
        // A mistaken click can be backed out of.
        await dialog.getByRole("button", { name: "Keep it" }).click();
        assert.notEqual(
          await page.evaluate(() => localStorage.getItem("prism-draft")),
          null,
        );
        await dialog
          .getByRole("button", { name: "Clear saved draft and media" })
          .click();
        await dialog.getByRole("button", { name: "Yes, clear it" }).click();
        await toast(
          page,
          "Cleared the saved draft and media on this device",
        ).waitFor();
        assert.equal(
          await page.evaluate(() => localStorage.getItem("prism-draft")),
          null,
        );
        await waitForSaved(page, 0);
        await dialog.getByText("No media saved here yet").waitFor();
        await closeHelp(page);
        // The open project is unchanged: the layer still shows the image until the page is closed.
        await waitForPixel(page, isMagenta, "open project after clearing");
        await page.reload();
        await page.getByRole("button", { name: "Save project" }).waitFor();
        assert.equal(
          await page.evaluate(
            () => JSON.parse(localStorage.getItem("prism-draft")).media.length,
          ),
          0,
          "a fresh project starts after the reload",
        );
        assert.deepEqual(pageErrors, []);
        await context.close();
      },
    );

    await scenario(
      "storage that refuses to save is reported and never costs the open project",
      async () => {
        // 1. A browser that blocks IndexedDB (private modes, locked-down settings).
        let context = await openContext(browser);
        await context.addInitScript(() => {
          IDBFactory.prototype.open = function () {
            throw new DOMException(
              "The operation is insecure.",
              "SecurityError",
            );
          };
        });
        let page = await openPage(context, host.url());
        await importCard(page);
        const blocked = alertWith(page, "test-card.png");
        await blocked.waitFor();
        assert.match(
          await blocked.innerText(),
          /not saved for next time because this browser is not keeping files/,
        );
        assert.match(
          await blocked.innerText(),
          /still work until you close this page/,
        );
        await page
          .getByRole("button", { name: "test-card.png", exact: true })
          .click();
        await waitForPixel(
          page,
          isMagenta,
          "image still renders although it could not be saved",
        );
        assert.equal(
          (await draft(page)).media.length,
          1,
          "the draft still lists the media",
        );
        await page.reload();
        await page.getByRole("button", { name: "Save project" }).waitFor();
        await alertWith(page, "blocking site storage").waitFor();
        await context.close();

        // 2. A browser that is out of space for the file.
        context = await openContext(browser);
        await context.addInitScript(() => {
          IDBObjectStore.prototype.put = function () {
            throw new DOMException(
              "The quota has been exceeded.",
              "QuotaExceededError",
            );
          };
        });
        page = await openPage(context, host.url());
        await importCard(page);
        const full = alertWith(page, "out of storage space");
        await full.waitFor();
        assert.match(
          await full.innerText(),
          /“test-card\.png” was not saved for next time/,
        );
        await page
          .getByRole("button", { name: "test-card.png", exact: true })
          .click();
        await waitForPixel(
          page,
          isMagenta,
          "image still renders although the browser is full",
        );
        await context.close();

        // 3. A browser that refuses to store the small autosaved draft.
        context = await openContext(browser);
        await context.addInitScript(() => {
          Storage.prototype.setItem = function () {
            throw new DOMException(
              "The quota has been exceeded.",
              "QuotaExceededError",
            );
          };
        });
        page = await openPage(context, host.url());
        const noRoom = alertWith(page, "no room left to autosave");
        await noRoom.waitFor();
        await page.getByRole("button", { name: "Dismiss error" }).click();
        await page
          .getByRole("combobox", { name: "Surface source", exact: true })
          .selectOption("checker");
        await page.waitForTimeout(500);
        assert.equal(
          await alertWith(page, "autosave").count(),
          0,
          "said once, not on every change",
        );
        assert.equal(
          await page
            .getByRole("combobox", { name: "Surface source", exact: true })
            .inputValue(),
          "checker",
        );
        assert.deepEqual(pageErrors, []);
        await context.close();
      },
    );

    // -------------------------------------------------------------------- saving
    await scenario(
      "Save project downloads a .prism.json in a desktop browser",
      async () => {
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.getByRole("button", { name: "Save project" }).click(),
        ]);
        assert.equal(
          download.suggestedFilename(),
          "Untitled mapping.prism.json",
        );
        const project = JSON.parse(
          await fs.readFile(await download.path(), "utf8"),
        );
        assert.equal(project.name, "Untitled mapping");
        assert.equal(project.version, 2);
        await toast(page, "Project saved.").waitFor();
        await context.close();
      },
    );

    await scenario(
      "Save project opens the share sheet on a touch browser, and a cancelled share is not an error",
      async () => {
        const context = await openContext(browser, {
          hasTouch: true,
          isMobile: true,
        });
        await context.addInitScript(() => {
          window.__shares = [];
          window.__shareMode = "ok";
          navigator.canShare = (data) =>
            Boolean(data && data.files && data.files.length);
          navigator.share = async (data) => {
            window.__shares.push(
              data.files.map((f) => ({
                name: f.name,
                type: f.type,
                size: f.size,
              })),
            );
            if (window.__shareMode === "cancel")
              throw new DOMException("Share canceled", "AbortError");
            if (window.__shareMode === "broken")
              throw new DOMException("Not allowed", "NotAllowedError");
          };
        });
        const page = await openPage(context, host.url());
        assert.equal(
          await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
          true,
          "touch emulation is on",
        );
        const downloads = [];
        page.on("download", (d) => downloads.push(d.suggestedFilename()));
        await page.getByRole("button", { name: "Save project" }).click();
        await toast(page, "Project saved.").waitFor();
        const shares = await page.evaluate(() => window.__shares);
        assert.equal(shares.length, 1);
        assert.equal(shares[0][0].name, "Untitled mapping.prism.json");
        assert.equal(shares[0][0].type, "application/json");
        assert.deepEqual(downloads, [], "shared instead of downloaded");

        await page
          .getByRole("button", { name: "Dismiss notification" })
          .click();
        await page.evaluate(() => (window.__shareMode = "cancel"));
        await page.getByRole("button", { name: "Save project" }).click();
        await page.waitForFunction(() => window.__shares.length === 2);
        await page.waitForTimeout(600);
        assert.equal(
          await toast(page, "Project saved.").count(),
          0,
          "a cancelled share is not a save",
        );
        assert.equal(
          await page.getByRole("alert").count(),
          0,
          "and not an error either",
        );

        await page.evaluate(() => (window.__shareMode = "broken"));
        const [fallback] = await Promise.all([
          page.waitForEvent("download"),
          page.getByRole("button", { name: "Save project" }).click(),
        ]);
        assert.equal(
          fallback.suggestedFilename(),
          "Untitled mapping.prism.json",
          "falls back to a download",
        );
        await context.close();
      },
    );

    // --------------------------------------------------------------------- audio
    await scenario(
      "the audio panel explains that system output is desktop-only and survives missing microphone access",
      async () => {
        let context = await openContext(browser);
        let page = await openPage(context, host.url());
        await page
          .getByRole("button", { name: "Open audio react controls" })
          .click();
        const system = page
          .getByLabel("Audio source", { exact: true })
          .locator('option[value="system"]');
        // Playwright does not treat a disabled <option> as disabled, so read the property.
        assert.equal(await system.evaluate((option) => option.disabled), true);
        assert.match(await system.textContent(), /desktop app only/);
        await page.getByText("Browsers cannot capture system sound").waitFor();
        assert.equal(
          await page
            .getByRole("combobox", { name: "Audio source", exact: true })
            .inputValue(),
          "input",
        );
        await context.close();

        // No navigator.mediaDevices at all: a friendly message, no exception.
        context = await openContext(browser);
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "mediaDevices", {
            value: undefined,
            configurable: true,
          });
        });
        page = await openPage(context, host.url());
        await page
          .getByRole("button", { name: "Open audio react controls" })
          .click();
        await alertWith(page, "cannot reach audio inputs").waitFor();
        const capture = page.locator("button.audio-capture-button");
        assert.equal(await capture.isDisabled(), true);
        assert.deepEqual(pageErrors, []);
        await context.close();
      },
    );

    // ------------------------------------------------------------ install help
    const syntheticInstallPrompt = (page) =>
      page.evaluate(() => {
        window.__prompts = 0;
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = () => {
          window.__prompts++;
          return Promise.resolve();
        };
        event.userChoice = Promise.resolve({ outcome: "accepted" });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });

    await scenario(
      "Install app appears when the browser offers it and asks the browser to install",
      async () => {
        const context = await openContext(browser);
        const page = await openPage(context, host.url());
        await controlled(page);
        let dialog = await openHelp(page);
        assert.equal(
          await dialog.getByRole("button", { name: "Install app" }).count(),
          0,
        );
        assert.equal(
          await dialog.getByText("Add to Home Screen").count(),
          0,
          "no iPhone steps in Chrome",
        );
        assert.equal(
          await syntheticInstallPrompt(page),
          true,
          "the automatic prompt is deferred",
        );
        await dialog.getByRole("button", { name: "Install app" }).click();
        assert.equal(await page.evaluate(() => window.__prompts), 1);
        await dialog.getByText("Ready to work without a connection").waitFor();
        assert.equal(
          await dialog.getByRole("button", { name: "Install app" }).count(),
          0,
          "the offer is used up",
        );
        await context.close();
      },
    );

    await scenario(
      "iPhone and iPad get plain Share menu steps, hidden once installed",
      async () => {
        const iphone =
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
        let context = await openContext(browser, { userAgent: iphone });
        let page = await openPage(context, host.url());
        let dialog = await openHelp(page);
        await dialog.getByText("tap Share, then Add to Home Screen").waitFor();
        assert.match(
          await dialog
            .locator(".device-note", { hasText: "Install on iPhone or iPad" })
            .innerText(),
          /^Install on iPhone or iPad: tap Share, then Add to Home Screen\.$/,
        );
        await context.close();

        // Launched from the home screen icon. Both signals are simulated here:
        // iOS sets navigator.standalone, other browsers match display-mode: standalone.
        for (const [label, options, simulate] of [
          [
            "iOS home screen",
            { userAgent: iphone },
            () => {
              Object.defineProperty(navigator, "standalone", {
                value: true,
                configurable: true,
              });
            },
          ],
          [
            "display-mode standalone",
            {},
            () => {
              const original = window.matchMedia.bind(window);
              window.matchMedia = (query) =>
                /display-mode:\s*standalone/.test(query)
                  ? {
                      matches: true,
                      media: query,
                      onchange: null,
                      addEventListener() {},
                      removeEventListener() {},
                      addListener() {},
                      removeListener() {},
                    }
                  : original(query);
            },
          ],
        ]) {
          context = await openContext(browser, options);
          await context.addInitScript(simulate);
          page = await openPage(context, host.url());
          dialog = await openHelp(page);
          await dialog
            .getByRole("heading", { name: "On this device" })
            .waitFor();
          assert.equal(
            await dialog.getByText("Add to Home Screen").count(),
            0,
            label,
          );
          await syntheticInstallPrompt(page);
          assert.equal(
            await dialog.getByRole("button", { name: "Install app" }).count(),
            0,
            label,
          );
          await context.close();
        }
      },
    );

    await scenario(
      "a Capacitor shell gets no manifest, worker or install help but keeps its storage controls",
      async () => {
        const context = await openContext(browser);
        await context.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true };
        });
        const page = await openPage(context, host.url());
        await page.waitForTimeout(2500);
        assert.equal(await page.locator('link[rel="manifest"]').count(), 0);
        assert.deepEqual(
          await page.evaluate(
            async () =>
              (await navigator.serviceWorker.getRegistrations()).length,
          ),
          0,
        );
        assert.deepEqual(await cacheNames(page), []);
        const dialog = await openHelp(page);
        await syntheticInstallPrompt(page);
        assert.equal(
          await dialog.getByRole("button", { name: "Install app" }).count(),
          0,
        );
        assert.equal(
          await dialog.getByText("Ready to work without a connection").count(),
          0,
        );
        await dialog
          .getByRole("button", { name: "Clear saved draft and media" })
          .waitFor();
        await context.close();
      },
    );

    if (DEV_URL)
      await scenario(
        "the dev server registers no worker and caches nothing",
        async () => {
          const context = await openContext(browser);
          const page = await context.newPage();
          page.on("pageerror", (error) => pageErrors.push(error.message));
          await page.goto(DEV_URL);
          await page.getByRole("button", { name: "Save project" }).waitFor();
          await page.waitForTimeout(2500);
          assert.equal(
            await page.evaluate(
              async () =>
                (await navigator.serviceWorker.getRegistrations()).length,
            ),
            0,
          );
          assert.deepEqual(await cacheNames(page), []);
          await context.close();
        },
      );
    else console.log("SKIP dev-server check (set PRISM_DEV_URL to run it)");

    // ------------------------------------------------------------------- privacy
    await scenario(
      "nothing left this machine: every request stayed on the test servers",
      async () => {
        assert.deepEqual([...offenders], [], "requests to other origins");
        assert.deepEqual(pageErrors, [], "uncaught errors in the page");
        assert.deepEqual(
          host.log.filter((e) => e.status >= 400),
          [],
          "failed requests at the domain root",
        );
      },
    );
  } finally {
    await browser.close().catch(() => {});
    for (const instance of [host, ...extraHosts])
      await instance.stop().catch(() => {});
    for (const folder of tempFolders)
      await fs.rm(folder, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} PWA scenarios passed.` +
      "\nNot covered here: real iOS Safari and WebKit, the real Android Chrome install prompt (it is simulated), physical devices and real storage quotas.",
  );
  if (failed.length) {
    console.log(`Failed: ${failed.map((r) => r.name).join("; ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
