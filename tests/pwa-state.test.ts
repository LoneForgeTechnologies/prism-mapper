import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";

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

/** The module keeps one-time state, so every scenario loads its own copy. */
let copies = 0;
const loadPwa = () => import(`../src/pwa.ts?scenario=${++copies}`);

class FakeTarget {
  private listeners = new Map<
    string,
    { listener: (event: unknown) => void; once: boolean }[]
  >();
  addEventListener = (
    type: string,
    listener: (event: unknown) => void,
    options?: { once?: boolean },
  ) => {
    const list = this.listeners.get(type) ?? [];
    list.push({ listener, once: options?.once === true });
    this.listeners.set(type, list);
  };
  count(type: string) {
    return this.listeners.get(type)?.length ?? 0;
  }
  emit(type: string, event: unknown = {}) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((entry) => !entry.once),
    );
    for (const { listener } of list) listener(event);
  }
}

interface Options {
  protocol?: string;
  electron?: boolean;
  native?: boolean;
  worker?: boolean;
  controlled?: boolean;
  loaded?: boolean;
  registerFails?: boolean;
  standalone?: boolean;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

/** A small stand-in for a browser tab: window, document, navigator and a service worker container. */
function browser(options: Options = {}) {
  const window = Object.assign(new FakeTarget(), {
    prism: options.electron ? {} : undefined,
    Capacitor: options.native ? { isNativePlatform: () => true } : undefined,
    matchMedia: (query: string) => ({
      matches: Boolean(
        options.standalone && query === "(display-mode: standalone)",
      ),
    }),
  });
  const head = {
    children: [] as { rel?: string; href?: string }[],
    append(element: { rel?: string; href?: string }) {
      this.children.push(element);
    },
  };
  const document = Object.assign(new FakeTarget(), {
    readyState: options.loaded === false ? "loading" : "complete",
    baseURI: "https://app.example/prism-mapper/",
    visibilityState: "visible",
    head,
    createElement: (tag: string) => ({ tag }),
    querySelector: (selector: string) =>
      selector === 'link[rel="manifest"]'
        ? head.children.find((child) => child.rel === "manifest")
        : null,
  });
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  const registration = {
    updates: 0,
    update() {
      this.updates++;
      return Promise.resolve();
    },
  };
  const registered: string[] = [];
  const container = Object.assign(new FakeTarget(), {
    controller: options.controlled ? {} : null,
    ready,
    register(url: string) {
      registered.push(url);
      return options.registerFails
        ? Promise.reject(new Error("blocked"))
        : Promise.resolve(registration);
    },
  });
  const navigator = {
    serviceWorker: options.worker === false ? undefined : container,
    standalone: options.standalone ? true : undefined,
    userAgent:
      options.userAgent ?? "Mozilla/5.0 (X11; Linux x86_64) Chrome/130",
    platform: options.platform ?? "Linux x86_64",
    maxTouchPoints: options.maxTouchPoints ?? 0,
  };
  const globals: Globals = {
    window,
    document,
    navigator,
    location: { protocol: options.protocol ?? "https:" },
  };
  if (options.worker === false) delete (navigator as Globals).serviceWorker;
  return {
    globals,
    window,
    document,
    container,
    registration,
    registered,
    head,
    becomeReady: readyResolve,
  };
}

function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = {
    prevented: 0,
    prompted: 0,
    preventDefault() {
      this.prevented++;
    },
    prompt() {
      this.prompted++;
      return Promise.resolve();
    },
    userChoice: Promise.resolve({ outcome }),
  };
  return event;
}

const state = (patch: object = {}) => ({
  eligible: true,
  canInstall: false,
  installed: false,
  iosInstructions: false,
  offlineReady: false,
  updateReady: false,
  ...patch,
});

test("install help is the real prompt, then iOS steps, then nothing", async () => {
  const { installMode } = await loadPwa();
  assert.equal(installMode(state({ canInstall: true })), "prompt");
  assert.equal(installMode(state({ iosInstructions: true })), "ios");
  assert.equal(
    installMode(state({ canInstall: true, iosInstructions: true })),
    "prompt",
  );
  assert.equal(installMode(state()), "none");
  // Already installed, or not a web page: nothing to offer.
  for (const hidden of [
    { installed: true, canInstall: true },
    { installed: true, iosInstructions: true },
    { eligible: false, canInstall: true },
    { eligible: false, iosInstructions: true },
  ])
    assert.equal(installMode(state(hidden)), "none", JSON.stringify(hidden));
});

test("only a normal http or https page counts as a web app", async () => {
  const { webAppEligible } = await loadPwa();
  const check = (options: Options) =>
    withGlobals(browser(options).globals, () => webAppEligible());
  assert.equal(await check({ protocol: "https:" }), true);
  assert.equal(await check({ protocol: "http:" }), true);
  for (const protocol of ["file:", "capacitor:", "app:", "media:", "blob:"])
    assert.equal(await check({ protocol }), false, protocol);
  assert.equal(await check({ electron: true }), false);
  assert.equal(await check({ native: true }), false);
  assert.equal(webAppEligible(), false, "no browser at all");
});

test("a plain web page gets the manifest link, the worker and the install listeners, once", async () => {
  const env = browser();
  await withGlobals(env.globals, async () => {
    const pwa = await loadPwa();
    assert.equal(
      pwa.getPwaState().eligible,
      false,
      "nothing happens at import",
    );
    pwa.initPwa();
    pwa.initPwa();
    const linked = env.head.children.filter(
      (child) => child.rel === "manifest",
    );
    assert.equal(linked.length, 1);
    assert.equal(linked[0].href, "./manifest.webmanifest");
    assert.deepEqual(env.registered, [
      "https://app.example/prism-mapper/sw.js",
    ]);
    assert.equal(env.window.count("beforeinstallprompt"), 1);
    assert.equal(env.window.count("appinstalled"), 1);
    assert.equal(pwa.getPwaState().eligible, true);
    assert.equal(pwa.getPwaState().installed, false);
    assert.equal(pwa.getPwaState().offlineReady, false);
  });
});

test("a page that already has a manifest link does not get a second one", async () => {
  const env = browser();
  env.head.children.push({ rel: "manifest", href: "./other.webmanifest" });
  await withGlobals(env.globals, async () => {
    (await loadPwa()).initPwa();
    assert.equal(
      env.head.children.filter((child) => child.rel === "manifest").length,
      1,
    );
  });
});

test("the worker is registered after the page has loaded", async () => {
  const env = browser({ loaded: false });
  await withGlobals(env.globals, async () => {
    (await loadPwa()).initPwa();
    assert.deepEqual(env.registered, [], "waits for load");
    env.window.emit("load");
    assert.deepEqual(env.registered, [
      "https://app.example/prism-mapper/sw.js",
    ]);
    env.window.emit("load");
    assert.equal(env.registered.length, 1, "load is handled once");
  });
});

for (const [name, options] of [
  ["the desktop app", { electron: true }],
  ["the Capacitor shell", { native: true }],
  ["a file page", { protocol: "file:" }],
  ["a packaged app page", { protocol: "app:" }],
] as const) {
  test(`${name} never gets a manifest, a worker or install help`, async () => {
    const env = browser(options);
    await withGlobals(env.globals, async () => {
      const pwa = await loadPwa();
      pwa.initPwa();
      assert.equal(pwa.getPwaState().eligible, false);
      assert.equal(pwa.installMode(pwa.getPwaState()), "none");
      assert.equal(env.head.children.length, 0);
      assert.deepEqual(env.registered, []);
      assert.equal(env.window.count("beforeinstallprompt"), 0);
      assert.equal(env.container.count("controllerchange"), 0);
      env.window.emit("beforeinstallprompt", installEvent());
      assert.equal(pwa.getPwaState().canInstall, false);
    });
  });
}

test("a browser without service workers still starts and offers install help", async () => {
  const env = browser({ worker: false });
  await withGlobals(env.globals, async () => {
    const pwa = await loadPwa();
    assert.doesNotThrow(() => pwa.initPwa());
    assert.equal(pwa.getPwaState().eligible, true);
    assert.equal(pwa.getPwaState().offlineReady, false);
    assert.deepEqual(env.registered, []);
  });
});

test("a failed registration is swallowed because offline support is optional", async () => {
  const env = browser({ registerFails: true });
  await withGlobals(env.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    await nextTurn();
    assert.equal(env.registered.length, 1);
    assert.equal(pwa.getPwaState().offlineReady, false);
  });
});

test("the app is offline-ready once a worker is active", async () => {
  const env = browser();
  await withGlobals(env.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    assert.equal(pwa.getPwaState().offlineReady, false);
    env.becomeReady();
    await nextTurn();
    assert.equal(pwa.getPwaState().offlineReady, true);
  });
});

test("the first install is not an update; a later takeover is", async () => {
  const first = browser({ controlled: false });
  await withGlobals(first.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    first.container.emit("controllerchange");
    assert.equal(pwa.getPwaState().updateReady, false, "first install");
    first.container.emit("controllerchange");
    assert.equal(pwa.getPwaState().updateReady, true, "next takeover");
  });
  const returning = browser({ controlled: true });
  await withGlobals(returning.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    returning.container.emit("controllerchange");
    assert.equal(pwa.getPwaState().updateReady, true);
  });
});

test("the browser's install prompt is held until the person asks for it", async () => {
  const env = browser();
  await withGlobals(env.globals, async () => {
    const pwa = await loadPwa();
    assert.equal(await pwa.promptInstall(), "unavailable");
    pwa.initPwa();
    const event = installEvent("accepted");
    env.window.emit("beforeinstallprompt", event);
    assert.equal(event.prevented, 1, "no automatic mini-infobar");
    assert.equal(event.prompted, 0, "not shown yet");
    assert.equal(pwa.getPwaState().canInstall, true);
    assert.equal(pwa.installMode(pwa.getPwaState()), "prompt");
    assert.equal(await pwa.promptInstall(), "accepted");
    assert.equal(event.prompted, 1);
    assert.equal(pwa.getPwaState().canInstall, false, "an event is single use");
    assert.equal(await pwa.promptInstall(), "unavailable");
    assert.equal(event.prompted, 1);
  });
});

test("declining the prompt, or a prompt that throws, ends quietly", async () => {
  const env = browser();
  await withGlobals(env.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    env.window.emit("beforeinstallprompt", installEvent("dismissed"));
    assert.equal(await pwa.promptInstall(), "dismissed");
    const broken = installEvent();
    broken.prompt = () => Promise.reject(new Error("already used"));
    env.window.emit("beforeinstallprompt", broken);
    assert.equal(await pwa.promptInstall(), "dismissed");
    assert.equal(pwa.getPwaState().canInstall, false);
  });
});

test("installing from the browser menu hides the install help", async () => {
  const env = browser();
  await withGlobals(env.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    env.window.emit("beforeinstallprompt", installEvent());
    env.window.emit("appinstalled");
    assert.equal(pwa.getPwaState().installed, true);
    assert.equal(pwa.getPwaState().canInstall, false);
    assert.equal(await pwa.promptInstall(), "unavailable");
    assert.equal(pwa.installMode(pwa.getPwaState()), "none");
  });
});

test("an installed launch (standalone window) shows no install help", async () => {
  const env = browser({ standalone: true });
  await withGlobals(env.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    assert.equal(pwa.getPwaState().installed, true);
    env.window.emit("beforeinstallprompt", installEvent());
    assert.equal(pwa.installMode(pwa.getPwaState()), "none");
  });
});

test("iPhone and iPad Safari get the Share menu steps unless already installed", async () => {
  const phone = browser({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604",
  });
  await withGlobals(phone.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    assert.equal(pwa.getPwaState().iosInstructions, true);
    assert.equal(pwa.installMode(pwa.getPwaState()), "ios");
  });
  const tablet = browser({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605",
    platform: "MacIntel",
    maxTouchPoints: 5,
  });
  await withGlobals(tablet.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    assert.equal(
      pwa.installMode(pwa.getPwaState()),
      "ios",
      "iPadOS reports a Mac",
    );
  });
  const installed = browser({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604",
    standalone: true,
  });
  await withGlobals(installed.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    assert.equal(pwa.installMode(pwa.getPwaState()), "none");
  });
  const mac = browser({ platform: "MacIntel", maxTouchPoints: 0 });
  await withGlobals(mac.globals, async () => {
    const pwa = await loadPwa();
    pwa.initPwa();
    assert.equal(
      pwa.installMode(pwa.getPwaState()),
      "none",
      "a real Mac has no touch",
    );
  });
});

test("a long-lived page looks for a new version when it comes back to the front", async () => {
  const env = browser();
  let clock = 1_000_000;
  const now = mock.method(Date, "now", () => clock);
  try {
    await withGlobals(env.globals, async () => {
      (await loadPwa()).initPwa();
      await nextTurn();
      assert.equal(env.document.count("visibilitychange"), 1);
      env.document.emit("visibilitychange");
      assert.equal(env.registration.updates, 0, "just checked at registration");
      clock += 30 * 60 * 1000;
      env.document.emit("visibilitychange");
      assert.equal(env.registration.updates, 0, "less than an hour");
      clock += 31 * 60 * 1000;
      env.document.visibilityState = "hidden";
      env.document.emit("visibilitychange");
      assert.equal(env.registration.updates, 0, "only when visible");
      env.document.visibilityState = "visible";
      env.document.emit("visibilitychange");
      assert.equal(env.registration.updates, 1);
      env.document.emit("visibilitychange");
      assert.equal(env.registration.updates, 1, "and not again straight away");
    });
  } finally {
    now.mock.restore();
  }
});

test("listeners hear every state change and can stop listening", async () => {
  const env = browser();
  await withGlobals(env.globals, async () => {
    const pwa = await loadPwa();
    let heard = 0;
    const stop = pwa.subscribePwa(() => heard++);
    pwa.initPwa();
    const afterInit = heard;
    assert.ok(afterInit >= 1);
    env.window.emit("beforeinstallprompt", installEvent());
    assert.equal(heard, afterInit + 1);
    stop();
    env.window.emit("appinstalled");
    assert.equal(heard, afterInit + 1);
  });
});
