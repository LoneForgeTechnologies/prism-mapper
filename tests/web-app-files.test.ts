import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (file: string) =>
  readFileSync(new URL(`../${file}`, import.meta.url));
const manifest = JSON.parse(read("public/manifest.webmanifest").toString());
const html = read("index.html").toString();

function pngSize(file: string) {
  const bytes = read(file);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", file);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

/** Attributes of every <tag ...> in the page, whatever the line breaks. */
function tags(name: "meta" | "link") {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "g"))].map(
    ([, body]) =>
      Object.fromEntries(
        [...body.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [
          key,
          value,
        ]),
      ) as Record<string, string>,
  );
}
const meta = (name: string) =>
  tags("meta").find((tag) => tag.name === name)?.content;

test("the manifest describes an installable, scope-relative app", () => {
  assert.equal(manifest.name, "Prism Mapper");
  assert.equal(manifest.short_name, "Prism");
  assert.ok(manifest.description.length > 20);
  // Relative URLs keep the app working from a domain root and from a sub-path.
  for (const key of ["id", "start_url", "scope"])
    assert.equal(manifest[key], "./", key);
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.display_override, ["standalone", "minimal-ui"]);
  assert.equal(manifest.orientation, "any");
  assert.equal(manifest.background_color, "#090d12");
  assert.equal(manifest.theme_color, "#090d12");
  assert.ok(Array.isArray(manifest.categories) && manifest.categories.length);
  assert.equal(manifest.file_handlers, undefined, "no file handlers for now");
});

test("every manifest icon exists at its declared size and the set covers install and maskable use", () => {
  const seen = new Set<string>();
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^icons\/[\w.-]+\.png$/, "relative path");
    assert.equal(icon.type, "image/png");
    assert.ok(existsSync(new URL(`../public/${icon.src}`, import.meta.url)));
    assert.equal(pngSize(`public/${icon.src}`), icon.sizes, icon.src);
    seen.add(`${icon.sizes} ${icon.purpose ?? "any"}`);
  }
  for (const needed of ["192x192 any", "512x512 any", "512x512 maskable"])
    assert.ok(seen.has(needed), `missing ${needed}`);
});

test("the page icons exist at the sizes the browser expects", () => {
  assert.equal(pngSize("public/favicon-32.png"), "32x32");
  assert.equal(pngSize("public/apple-touch-icon.png"), "180x180");
  assert.match(read("public/favicon.svg").toString(), /<svg\b/);
});

test("the page carries the viewport, colour and home-screen tags", () => {
  assert.equal(
    meta("viewport"),
    "width=device-width, initial-scale=1.0, viewport-fit=cover",
  );
  assert.equal(meta("theme-color"), manifest.theme_color);
  assert.equal(meta("apple-mobile-web-app-capable"), "yes");
  assert.equal(meta("mobile-web-app-capable"), "yes");
  assert.equal(meta("apple-mobile-web-app-title"), "Prism Mapper");
  assert.equal(
    meta("apple-mobile-web-app-status-bar-style"),
    "black-translucent",
  );
  const links = tags("link");
  const href = (rel: string, extra: Record<string, string> = {}) =>
    links.find(
      (tag) =>
        tag.rel === rel &&
        Object.entries(extra).every(([key, value]) => tag[key] === value),
    )?.href;
  assert.equal(href("icon", { type: "image/svg+xml" }), "./favicon.svg");
  assert.equal(href("icon", { sizes: "32x32" }), "./favicon-32.png");
  assert.equal(href("apple-touch-icon"), "./apple-touch-icon.png");
});

test("the manifest link is added at run time, never baked into the page that Electron and the mobile shells load", () => {
  assert.equal(
    tags("link").some((tag) => tag.rel === "manifest"),
    false,
  );
});

test("the content security policy still allows only the app's own files and blob media", () => {
  const policy = tags("meta").find(
    (tag) => tag["http-equiv"] === "Content-Security-Policy",
  )?.content;
  assert.ok(policy);
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /script-src 'self'(;|$)/);
  assert.match(policy, /connect-src 'self' media: ws:\/\/127\.0\.0\.1:\*/);
  // Nothing remote: the offline worker needs no extra permission.
  assert.doesNotMatch(policy, /https?:\/\/(?!127\.)/);
  assert.doesNotMatch(policy, /(?:^|\s)\*(?:\s|;|$)/, "no wildcard sources");
  assert.doesNotMatch(policy, /worker-src/);
});

test("user-facing text in the web app files has no em dashes and no en dashes outside number ranges", () => {
  // Em dashes are never used as a comma substitute here; an en dash is fine between digits (1-5).
  const dash = /—|(?<!\d)–|–(?!\d)/;
  for (const file of [
    "src/persistence.ts",
    "src/platform.ts",
    "src/pwa.ts",
    "src/usePersistence.ts",
    "src/DeviceSection.tsx",
    "src/pwa.css",
    "src/AudioPanel.tsx",
    "src/audio.ts",
    "scripts/sw-template.js",
    "scripts/build-pwa.mjs",
    "public/manifest.webmanifest",
    "index.html",
  ])
    assert.doesNotMatch(read(file).toString(), dash, file);
});
