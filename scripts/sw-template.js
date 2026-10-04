/*
 * Prism Mapper service worker.
 *
 * Generated into dist/sw.js by scripts/build-pwa.mjs, which fills in the two
 * quoted placeholders below. The worker is an offline cache for this app's own
 * static files. It never contacts another origin and sends nothing anywhere.
 *
 *  - install:  precache the app shell (HTML, scripts, styles, icons, manifest).
 *  - fetch:    cache-first for same-origin GET requests inside the app folder.
 *              Preview images are not precached; they are cached the first
 *              time they are shown, in a cache of their own that a new release
 *              keeps as long as the pictures themselves did not change. A page
 *              navigation falls back to the cached index.html when the network
 *              is unavailable.
 *  - activate: delete caches left by earlier versions of this app folder.
 *
 * Every URL is resolved against the worker's own scope, so the app works from
 * the domain root and from a sub-path such as /prism-mapper/.
 */
const CACHE_NAME = "__PRISM_CACHE_NAME__";
const PRECACHE = "__PRISM_PRECACHE__";
// Named for the preview pictures, not for the release (see scripts/build-pwa.mjs).
const LAZY_CACHE_NAME = "__PRISM_LAZY_CACHE_NAME__";
const LAZY_PREFIXES = "__PRISM_LAZY_PREFIXES__";
const CACHE_PREFIX = "prism-mapper-";

const scope = new URL(self.registration.scope);
// One cache per app folder, so two copies on one origin never clear each other.
const CACHE_SUFFIX = "@" + scope.pathname;
const CACHE = CACHE_NAME + CACHE_SUFFIX;
// Pictures seen online stay available offline after an update that leaves them alone.
const LAZY_CACHE = LAZY_CACHE_NAME + CACHE_SUFFIX;
const toUrl = (path) => new URL(path, scope).href;
const INDEX_URL = toUrl("index.html");

// Files cached when first shown. The URL is inside the app folder already.
function isLazy(url) {
  const path = url.slice(scope.href.length);
  return LAZY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// A response that followed a redirect cannot answer a page navigation.
async function plain(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(
    PRECACHE.map(async (path) => {
      // Skip the browser's HTTP cache so a new version never mixes with old files.
      const response = await fetch(
        new Request(toUrl(path), { cache: "reload" }),
      );
      if (!response.ok)
        throw new Error(
          "Could not cache " + path + " (" + response.status + ")",
        );
      await cache.put(toUrl(path), await plain(response));
    }),
  );
  // The folder URL itself opens the app.
  const shell = await cache.match(INDEX_URL);
  if (shell) await cache.put(scope.href, shell.clone());
}

self.addEventListener("install", (event) => {
  // If any file fails to download the install fails and the previous version stays in charge.
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(CACHE_PREFIX) &&
              name.endsWith(CACHE_SUFFIX) &&
              name !== CACHE &&
              name !== LAZY_CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function respond(event) {
  const request = event.request;
  const navigating = request.mode === "navigate";
  const cache = await caches.open(
    !navigating && isLazy(request.url) ? LAZY_CACHE : CACHE,
  );
  const cached = await cache.match(request, {
    ignoreSearch: navigating,
    ignoreVary: true,
  });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Remember anything else the app asks for, such as preview images.
    if (response.ok && response.type === "basic" && !navigating)
      event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    if (navigating) {
      const shell = await cache.match(INDEX_URL, { ignoreVary: true });
      if (shell) return shell;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Let the browser handle uploads, media seeking and anything outside the app folder.
  if (request.method !== "GET" || request.headers.has("range")) return;
  if (!request.url.startsWith(scope.href)) return;
  event.respondWith(respond(event));
});
