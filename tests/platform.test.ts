import test from "node:test";
import assert from "node:assert/strict";
import {
  isElectron,
  isIosDevice,
  isNative,
  isStandalonePwa,
  isTouchPrimary,
  nativePlugins,
  projectFileName,
  saveFile,
  shortcutLabel,
  toBase64,
  usesCommandKey,
} from "../src/platform.ts";

type Globals = Record<string, unknown>;
/** Run `body` with some globals replaced, then put every one back exactly as it was. */
async function withGlobals<T>(
  replacements: Globals,
  body: () => Promise<T> | T,
) {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(replacements)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  try {
    return await body();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Globals)[key];
    }
  }
}
const media = (matches: Record<string, boolean>) => (query: string) => ({
  matches: matches[query] === true,
});

test("isNative follows the Capacitor bridge and never throws", async () => {
  assert.equal(isNative(), false);
  await withGlobals(
    { window: { Capacitor: { isNativePlatform: () => true } } },
    () => assert.equal(isNative(), true),
  );
  await withGlobals(
    { window: { Capacitor: { isNativePlatform: () => false } } },
    () => assert.equal(isNative(), false),
  );
  await withGlobals({ window: { Capacitor: {} } }, () =>
    assert.equal(isNative(), false),
  );
  await withGlobals(
    {
      window: {
        Capacitor: {
          isNativePlatform: () => {
            throw new Error("bridge not ready");
          },
        },
      },
    },
    () => assert.equal(isNative(), false),
  );
});

test("isElectron is true only when the desktop preload bridge exists", async () => {
  assert.equal(isElectron(), false);
  await withGlobals({ window: { prism: { saveProject() {} } } }, () =>
    assert.equal(isElectron(), true),
  );
  await withGlobals({ window: {} }, () => assert.equal(isElectron(), false));
});

test("isStandalonePwa reads display-mode and the iOS navigator flag", async () => {
  assert.equal(isStandalonePwa(), false);
  await withGlobals(
    { window: { matchMedia: media({ "(display-mode: standalone)": true }) } },
    () => assert.equal(isStandalonePwa(), true),
  );
  await withGlobals(
    { window: { matchMedia: media({ "(display-mode: minimal-ui)": true }) } },
    () => assert.equal(isStandalonePwa(), true),
  );
  await withGlobals({ window: { matchMedia: media({}) } }, () =>
    assert.equal(isStandalonePwa(), false),
  );
  await withGlobals(
    { window: { matchMedia: media({}) }, navigator: { standalone: true } },
    () => assert.equal(isStandalonePwa(), true),
  );
  // A browser tab that merely went fullscreen is not an installed app.
  await withGlobals(
    { window: { matchMedia: media({ "(display-mode: fullscreen)": true }) } },
    () => assert.equal(isStandalonePwa(), false),
  );
  await withGlobals(
    {
      window: {
        matchMedia() {
          throw new Error("unsupported");
        },
      },
      navigator: { standalone: true },
    },
    () => assert.equal(isStandalonePwa(), true),
  );
});

test("isTouchPrimary reads the coarse pointer query", async () => {
  assert.equal(isTouchPrimary(), false);
  await withGlobals(
    { window: { matchMedia: media({ "(pointer: coarse)": true }) } },
    () => assert.equal(isTouchPrimary(), true),
  );
  await withGlobals(
    { window: { matchMedia: media({ "(pointer: fine)": true }) } },
    () => assert.equal(isTouchPrimary(), false),
  );
});

test("isIosDevice recognises iPhone, iPad and iPadOS pretending to be a Mac", async () => {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
  const mac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15";
  await withGlobals({ navigator: { userAgent: iphone } }, () =>
    assert.equal(isIosDevice(), true),
  );
  await withGlobals(
    { navigator: { userAgent: mac, platform: "MacIntel", maxTouchPoints: 5 } },
    () => assert.equal(isIosDevice(), true),
  );
  await withGlobals(
    { navigator: { userAgent: mac, platform: "MacIntel", maxTouchPoints: 0 } },
    () => assert.equal(isIosDevice(), false),
  );
  await withGlobals(
    {
      navigator: {
        userAgent:
          "Mozilla/5.0 (Linux; Android 14) Chrome/124 Mobile Safari/537.36",
        platform: "Linux armv81",
        maxTouchPoints: 5,
      },
    },
    () => assert.equal(isIosDevice(), false),
  );
});

test("project files always end in .prism.json and never start empty", () => {
  assert.equal(projectFileName("Garage wall"), "Garage wall.prism.json");
  assert.equal(projectFileName("  Spaced out  "), "Spaced out.prism.json");
  assert.equal(projectFileName("../../etc/passwd"), "etcpasswd.prism.json");
  assert.equal(projectFileName("***"), "Prism Mapper project.prism.json");
  assert.equal(projectFileName(""), "Prism Mapper project.prism.json");
});

test("toBase64 encodes UTF-8 text and large Blobs without overflowing the stack", async () => {
  const text = "Projekt Übung 日本語";
  assert.equal(
    Buffer.from(await toBase64(text), "base64").toString("utf8"),
    text,
  );
  const bytes = Uint8Array.from({ length: 300_000 }, (_, i) => i % 251);
  const encoded = await toBase64(new Blob([bytes]));
  assert.deepEqual(new Uint8Array(Buffer.from(encoded, "base64")), bytes);
});

function fakeDocument() {
  const links: {
    href: string;
    download: string;
    rel: string;
    clicks: number;
  }[] = [];
  return {
    links,
    document: {
      createElement() {
        const link = {
          href: "",
          download: "",
          rel: "",
          clicks: 0,
          click() {
            this.clicks++;
          },
        };
        links.push(link);
        return link;
      },
    },
  };
}
function fakeUrl() {
  const created: Blob[] = [];
  const revoked: string[] = [];
  return {
    created,
    revoked,
    URL: {
      createObjectURL(blob: Blob) {
        created.push(blob);
        return `blob:test/${created.length}`;
      },
      revokeObjectURL(url: string) {
        revoked.push(url);
      },
    },
  };
}
function fakeTimers() {
  const timers: { run: () => void; ms: number }[] = [];
  return {
    timers,
    setTimeout: (run: () => void, ms: number) => {
      timers.push({ run, ms });
      return 0;
    },
  };
}

test("desktop browsers save with a download link and release the URL later", async () => {
  const { links, document } = fakeDocument();
  const urls = fakeUrl();
  const clock = fakeTimers();
  const outcome = await withGlobals(
    {
      window: { matchMedia: media({ "(pointer: fine)": true }) },
      navigator: {},
      document,
      URL: urls.URL,
      setTimeout: clock.setTimeout,
    },
    () => saveFile("Wall.prism.json", '{"a":1}', "application/json"),
  );
  assert.equal(outcome, "download");
  assert.equal(links.length, 1);
  assert.equal(links[0].download, "Wall.prism.json");
  assert.equal(links[0].href, "blob:test/1");
  assert.equal(links[0].clicks, 1);
  assert.equal(await urls.created[0].text(), '{"a":1}');
  assert.equal(urls.created[0].type, "application/json");
  assert.equal(urls.revoked.length, 0, "URL stays alive until the timer");
  assert.ok(clock.timers[0].ms >= 1000);
  clock.timers[0].run();
  assert.deepEqual(urls.revoked, ["blob:test/1"]);
});

test("touch browsers that can share files open the share sheet with a File", async () => {
  const { links, document } = fakeDocument();
  const shared: { files?: File[]; title?: string }[] = [];
  const outcome = await withGlobals(
    {
      window: { matchMedia: media({ "(pointer: coarse)": true }) },
      navigator: {
        canShare: (data: { files?: File[] }) => Boolean(data.files?.length),
        share: async (data: { files?: File[]; title?: string }) => {
          shared.push(data);
        },
      },
      document,
    },
    () => saveFile("Wall.prism.json", '{"a":1}', "application/json"),
  );
  assert.equal(outcome, "web-share");
  assert.equal(links.length, 0, "no download link when sharing worked");
  assert.equal(shared.length, 1);
  const [file] = shared[0].files!;
  assert.equal(file.name, "Wall.prism.json");
  assert.equal(file.type, "application/json");
  assert.equal(await file.text(), '{"a":1}');
});

test("closing the share sheet is a cancel, not an error and not a second save", async () => {
  const { links, document } = fakeDocument();
  const outcome = await withGlobals(
    {
      window: { matchMedia: media({ "(pointer: coarse)": true }) },
      navigator: {
        canShare: () => true,
        share: async () => {
          throw new DOMException("Share canceled", "AbortError");
        },
      },
      document,
    },
    () => saveFile("Wall.prism.json", "{}", "application/json"),
  );
  assert.equal(outcome, "cancelled");
  assert.equal(links.length, 0);
});

test("touch browsers fall back to a download when sharing files is unsupported or fails", async () => {
  for (const navigator of [
    {},
    { canShare: () => false, share: async () => {} },
    {
      canShare: () => true,
      share: async () => {
        throw new DOMException("No user gesture", "NotAllowedError");
      },
    },
  ]) {
    const { links, document } = fakeDocument();
    const urls = fakeUrl();
    const clock = fakeTimers();
    const outcome = await withGlobals(
      {
        window: { matchMedia: media({ "(pointer: coarse)": true }) },
        navigator,
        document,
        URL: urls.URL,
        setTimeout: clock.setTimeout,
      },
      () => saveFile("Wall.prism.json", "{}", "application/json"),
    );
    assert.equal(outcome, "download", JSON.stringify(Object.keys(navigator)));
    assert.equal(links.length, 1);
  }
});

function fakeCapacitor(
  overrides: {
    write?: (options: Record<string, unknown>) => Promise<{ uri: string }>;
    share?: (options: Record<string, unknown>) => Promise<unknown>;
    loadFilesystem?: () => Promise<never>;
  } = {},
) {
  const writes: Record<string, unknown>[] = [];
  const shares: Record<string, unknown>[] = [];
  const original = { ...nativePlugins };
  nativePlugins.filesystem = (overrides.loadFilesystem ??
    (async () => ({
      Directory: { Cache: "CACHE" },
      Filesystem: {
        async writeFile(options: Record<string, unknown>) {
          writes.push(options);
          return overrides.write
            ? overrides.write(options)
            : { uri: `file:///cache/${options.path}` };
        },
      },
    }))) as unknown as typeof nativePlugins.filesystem;
  nativePlugins.share = (async () => ({
    Share: {
      async share(options: Record<string, unknown>) {
        shares.push(options);
        return overrides.share ? overrides.share(options) : {};
      },
    },
  })) as unknown as typeof nativePlugins.share;
  return {
    writes,
    shares,
    restore() {
      Object.assign(nativePlugins, original);
    },
  };
}
const nativeWindow = { Capacitor: { isNativePlatform: () => true } };

test("the native app writes to the cache folder and opens the share sheet", async () => {
  const capacitor = fakeCapacitor();
  try {
    // No document or URL support at all: the native path must not touch them.
    const outcome = await withGlobals({ window: nativeWindow }, () =>
      saveFile("Wall.prism.json", '{"name":"Übung"}', "application/json"),
    );
    assert.equal(outcome, "native-share");
    assert.equal(capacitor.writes.length, 1);
    assert.equal(capacitor.writes[0].path, "Wall.prism.json");
    assert.equal(capacitor.writes[0].directory, "CACHE");
    assert.equal(
      Buffer.from(String(capacitor.writes[0].data), "base64").toString("utf8"),
      '{"name":"Übung"}',
    );
    assert.equal(capacitor.shares.length, 1);
    assert.deepEqual(capacitor.shares[0].files, [
      "file:///cache/Wall.prism.json",
    ]);
    assert.equal(capacitor.shares[0].title, "Wall.prism.json");
  } finally {
    capacitor.restore();
  }
});

test("native saves keep Blob bytes intact and keep file names inside the cache folder", async () => {
  const capacitor = fakeCapacitor();
  try {
    const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255]);
    await withGlobals({ window: nativeWindow }, () =>
      saveFile(
        "../up/and:away.bin",
        new Blob([bytes]),
        "application/octet-stream",
      ),
    );
    assert.equal(capacitor.writes[0].path, ".._up_and_away.bin");
    assert.deepEqual(
      new Uint8Array(Buffer.from(String(capacitor.writes[0].data), "base64")),
      bytes,
    );
  } finally {
    capacitor.restore();
  }
});

test("a dismissed native share sheet is a cancel", async () => {
  for (const message of ["Share canceled", "Share cancelled"]) {
    const capacitor = fakeCapacitor({
      share: async () => {
        throw new Error(message);
      },
    });
    try {
      const outcome = await withGlobals({ window: nativeWindow }, () =>
        saveFile("Wall.prism.json", "{}", "application/json"),
      );
      assert.equal(outcome, "cancelled");
    } finally {
      capacitor.restore();
    }
  }
});

test("native failures explain which step failed", async () => {
  let capacitor = fakeCapacitor({
    write: async () => {
      throw new Error("disk full");
    },
  });
  try {
    await assert.rejects(
      withGlobals({ window: nativeWindow }, () =>
        saveFile("Wall.prism.json", "{}", "application/json"),
      ),
      /Could not prepare Wall\.prism\.json for saving: disk full/,
    );
  } finally {
    capacitor.restore();
  }
  capacitor = fakeCapacitor({
    share: async () => {
      throw new Error("No activity found");
    },
  });
  try {
    await assert.rejects(
      withGlobals({ window: nativeWindow }, () =>
        saveFile("Wall.prism.json", "{}", "application/json"),
      ),
      /Could not open the share sheet: No activity found/,
    );
  } finally {
    capacitor.restore();
  }
  capacitor = fakeCapacitor({
    loadFilesystem: async () => {
      throw new Error("chunk failed to load");
    },
  });
  try {
    await assert.rejects(
      withGlobals({ window: nativeWindow }, () =>
        saveFile("Wall.prism.json", "{}", "application/json"),
      ),
      /could not load its file tools \(chunk failed to load\)/,
    );
  } finally {
    capacitor.restore();
  }
});

test("shortcut labels name Command on Apple devices and Ctrl everywhere else", async () => {
  const labelsFor = (platform: string, userAgent: string) =>
    withGlobals({ navigator: { platform, userAgent } }, () => [
      usesCommandKey(),
      shortcutLabel("Z"),
      shortcutLabel("Z", { shift: true }),
    ]);
  const apple = [true, "⌘Z", "⇧⌘Z"];
  const other = [false, "Ctrl+Z", "Ctrl+Shift+Z"];
  assert.deepEqual(
    await labelsFor(
      "MacIntel",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    ),
    apple,
  );
  assert.deepEqual(
    await labelsFor(
      "iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    ),
    apple,
  );
  assert.deepEqual(
    await labelsFor("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
    other,
  );
  assert.deepEqual(
    await labelsFor("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)"),
    other,
  );
  // Android reports Linux and has no Command key.
  assert.deepEqual(
    await labelsFor("Linux armv81", "Mozilla/5.0 (Linux; Android 14; Pixel 8)"),
    other,
  );
  // Without a navigator at all (tests, workers) the label falls back to Ctrl.
  await withGlobals({ navigator: undefined }, () => {
    assert.equal(usesCommandKey(), false);
    assert.equal(shortcutLabel("Z"), "Ctrl+Z");
  });
});
