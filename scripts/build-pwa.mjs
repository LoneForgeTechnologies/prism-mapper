// Generates dist/sw.js, the offline cache worker, after `vite build`.
//
// The cache name is the app version plus a fingerprint of every file in dist/,
// so any change to any file produces a new cache and the browser installs the
// new worker. The output is deterministic: no timestamps.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

export const WORKER_FILE = "sw.js";
export const MANIFEST_FILE = "manifest.webmanifest";
/** Cached the first time they are shown instead of at install. */
export const LAZY_PREFIXES = ["previews/"];
const SKIPPED_FOLDERS = new Set([
  "node_modules",
  "tests",
  "test",
  "__tests__",
  "artifacts",
  "release",
  "session-backups",
]);

/** Whether a path inside dist/ belongs in the offline cache. */
export function isShippable(relative) {
  const parts = relative.split("/");
  const name = parts.at(-1);
  return !(
    relative === WORKER_FILE ||
    parts.some((part) => part.startsWith(".") || SKIPPED_FOLDERS.has(part)) ||
    /\.(map|log)$/.test(name) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)
  );
}

/** Every shippable file in dist/ as a sorted, forward-slash path relative to it. */
export async function listDistFiles(dist) {
  const found = [];
  const walk = async (directory, prefix) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory())
        await walk(path.join(directory, entry.name), `${relative}/`);
      else if (entry.isFile() && isShippable(relative)) found.push(relative);
    }
  };
  await walk(dist, "");
  return found.sort();
}

export async function fingerprint(dist, files) {
  return Promise.all(
    files.map(async (file) => ({
      path: file,
      hash: createHash("sha256")
        .update(await readFile(path.join(dist, file)))
        .digest("hex"),
    })),
  );
}

/** Twelve hex digits that change when any of these files' paths or contents change. */
function digestOf(entries) {
  const digest = createHash("sha256");
  for (const { path: file, hash } of [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  ))
    digest.update(`${file}\0${hash}\n`);
  return digest.digest("hex").slice(0, 12);
}

/** `prism-mapper-v<version>-<12 hex>`: changes when the version or any file's path or content changes. */
export function cacheNameFor(version, entries) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw new Error(`Invalid app version: ${version}`);
  return `prism-mapper-v${version}-${digestOf(entries)}`;
}

/**
 * `prism-mapper-lazy-<12 hex>`: the cache for the files that are kept the first
 * time they are shown. It is named for those files alone, so a release that does
 * not touch them keeps what was downloaded (offline, a preview that was seen
 * before an update would otherwise be blank until seen online again) and one
 * that changes a picture starts the cache over rather than show the old picture.
 */
export function lazyCacheNameFor(entries) {
  return `prism-mapper-lazy-${digestOf(entries)}`;
}

/** Fill the four placeholders of sw-template.js. */
export function renderServiceWorker(
  template,
  { cacheName, precache, lazyCacheName, lazyPrefixes },
) {
  const values = {
    '"__PRISM_CACHE_NAME__"': JSON.stringify(cacheName),
    '"__PRISM_PRECACHE__"': JSON.stringify(precache, null, 2),
    '"__PRISM_LAZY_CACHE_NAME__"': JSON.stringify(lazyCacheName),
    '"__PRISM_LAZY_PREFIXES__"': JSON.stringify(lazyPrefixes),
  };
  let output = template;
  for (const [token, value] of Object.entries(values)) {
    if (value === undefined)
      throw new Error(`The service worker needs a value for ${token}`);
    if (output.split(token).length !== 2)
      throw new Error(
        `The service worker template needs ${token} exactly once`,
      );
    output = output.replace(token, () => value);
  }
  return output;
}

export async function buildServiceWorker({ dist, version, template }) {
  const files = await listDistFiles(dist);
  if (!files.includes("index.html"))
    throw new Error(`${dist} has no index.html. Run vite build first.`);
  const entries = await fingerprint(dist, files);
  const cacheName = cacheNameFor(version, entries);
  const lazy = files.filter((file) =>
    LAZY_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
  const lazyCacheName = lazyCacheNameFor(
    entries.filter((entry) => lazy.includes(entry.path)),
  );
  const precache = files.filter((file) => !lazy.includes(file));
  return {
    cacheName,
    lazyCacheName,
    files,
    precache,
    lazy,
    source: renderServiceWorker(template, {
      cacheName,
      precache,
      lazyCacheName,
      lazyPrefixes: LAZY_PREFIXES,
    }),
  };
}

/** The manifest must parse and every icon it names must exist in dist/. */
export async function checkManifest(dist, files) {
  if (!files.includes(MANIFEST_FILE))
    throw new Error(`dist/${MANIFEST_FILE} is missing. It lives in public/.`);
  const manifest = JSON.parse(
    await readFile(path.join(dist, MANIFEST_FILE), "utf8"),
  );
  if (!Array.isArray(manifest.icons) || !manifest.icons.length)
    throw new Error("The web manifest lists no icons.");
  for (const icon of manifest.icons) {
    const target = path
      .normalize(String(icon.src).replace(/^\.\//, ""))
      .split(path.sep)
      .join("/");
    if (!files.includes(target))
      throw new Error(
        `The web manifest names ${icon.src}, which is not in dist/.`,
      );
  }
}

export async function buildPwa({
  dist = path.join(root, "dist"),
  packageFile = path.join(root, "package.json"),
  templateFile = path.join(here, "sw-template.js"),
} = {}) {
  const { version } = JSON.parse(await readFile(packageFile, "utf8"));
  const template = await readFile(templateFile, "utf8");
  const result = await buildServiceWorker({ dist, version, template });
  await checkManifest(dist, result.files);
  await writeFile(path.join(dist, WORKER_FILE), result.source);
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await buildPwa();
  console.log(
    `PWA: wrote dist/${WORKER_FILE} (${result.cacheName}), ${result.precache.length} files precached, ${result.lazy.length} cached on first use (${result.lazyCacheName}).`,
  );
}
