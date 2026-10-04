// Exercises electron/main.cjs against a stand-in for the electron module, to
// check how the pieces are wired together: single instance, opening projects
// from the operating system, window options and the display wake lock. The real
// thing is covered by tests/packaged-desktop.cjs on each release build.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const MAIN = require.resolve("./main.cjs");

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.mainFrame = { name: "main" };
    this.destroyed = false;
  }
  setWindowOpenHandler() {}
  send(channel, value) {
    this.sent.push([channel, value]);
  }
  isDestroyed() {
    return this.destroyed;
  }
  getURL() {
    return "file:///app/dist/index.html";
  }
}

function createFakeElectron({ primary = true, workArea, displays } = {}) {
  const windows = [];
  const handlers = new Map();
  const listeners = new Map();
  const blockers = new Map();
  let nextBlocker = 1;
  let markReady;
  const ready = new Promise((resolve) => (markReady = resolve));
  const dialogs = { open: null, save: null };
  const behaviour = {
    failOutputLoad: false,
    // Windows 10 and 11 at 100%: title bar, menu bar and borders.
    frame: { width: 16, height: 65 },
  };

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeWebContents();
      this.calls = [];
      this.destroyed = false;
      this.minimized = false;
      windows.push(this);
    }
    record(name) {
      this.calls.push(name);
    }
    loadFile() {
      this.record("loadFile");
      if (this.options.frame === false && behaviour.failOutputLoad)
        return Promise.reject(new Error("load failed"));
      return Promise.resolve();
    }
    loadURL() {
      this.record("loadURL");
      return Promise.resolve();
    }
    show() {
      this.record("show");
    }
    focus() {
      this.record("focus");
    }
    maximize() {
      this.record("maximize");
    }
    // A window with a title bar and menu bar around its page, as on Windows.
    getBounds() {
      return { x: 0, y: 0, width: 1500, height: 1000 };
    }
    getContentBounds() {
      const frame = behaviour.frame;
      const bounds = this.getBounds();
      return {
        x: frame.width / 2,
        y: frame.height - frame.width / 2,
        width: bounds.width - frame.width,
        height: bounds.height - frame.height,
      };
    }
    setMinimumSize(width, height) {
      this.minimumSize = [width, height];
      this.record("setMinimumSize");
    }
    setSize(width, height) {
      this.size = [width, height];
      this.record("setSize");
    }
    restore() {
      this.minimized = false;
      this.record("restore");
    }
    isMinimized() {
      return this.minimized;
    }
    isDestroyed() {
      return this.destroyed;
    }
    setMenuBarVisibility() {}
    setBounds() {}
    setFullScreen() {}
    setSimpleFullScreen() {}
    // Electron reports "closed" a moment after close(); tests finish it by hand.
    close() {
      this.closing = true;
    }
    finishClosing() {
      this.destroyed = true;
      this.webContents.destroyed = true;
      this.emit("closed");
    }
  }

  const app = Object.assign(new EventEmitter(), {
    name: null,
    appId: null,
    quits: 0,
    isReadyNow: false,
    setName(name) {
      this.name = name;
    },
    setAppUserModelId(id) {
      this.appId = id;
    },
    setPath() {},
    commandLine: { getSwitchValue: () => "" },
    requestSingleInstanceLock: () => primary,
    quit() {
      this.quits++;
    },
    isReady() {
      return this.isReadyNow;
    },
    whenReady: () => ready,
  });

  const primaryDisplay = {
    id: 1,
    workArea: workArea ?? { x: 0, y: 0, width: 1920, height: 1040 },
  };
  const electron = {
    app,
    BrowserWindow: FakeBrowserWindow,
    screen: Object.assign(new EventEmitter(), {
      getPrimaryDisplay: () => primaryDisplay,
      getAllDisplays: () =>
        displays ?? [
          {
            id: 1,
            label: "Main",
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            size: { width: 1920, height: 1080 },
            scaleFactor: 1,
          },
        ],
    }),
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      on: (channel, fn) => listeners.set(channel, fn),
    },
    dialog: {
      showOpenDialog: async (...args) => dialogs.open(...args),
      showSaveDialog: async (...args) => dialogs.save(...args),
      showErrorBox() {},
    },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    net: { fetch: async () => new Response("") },
    powerSaveBlocker: {
      start: () => {
        const id = nextBlocker++;
        blockers.set(id, true);
        return id;
      },
      stop: (id) => blockers.delete(id),
      isStarted: (id) => blockers.has(id),
    },
    Menu: {
      setApplicationMenu() {},
      buildFromTemplate: (template) => template,
    },
    session: {
      defaultSession: {
        setPermissionCheckHandler() {},
        setPermissionRequestHandler() {},
        setDisplayMediaRequestHandler() {},
      },
    },
    shell: { openExternal: async () => {} },
  };

  return {
    electron,
    windows,
    blockers,
    dialogs,
    behaviour,
    editor: () => windows[0],
    async becomeReady() {
      app.isReadyNow = true;
      markReady();
      await ready;
      await new Promise((resolve) => setImmediate(resolve));
    },
    // What the page sends: ipcRenderer messages carry the sender's contents.
    from(window) {
      return {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
      };
    },
    invoke(channel, event, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler, `no handler for ${channel}`);
      return handler(event, ...args);
    },
    send(channel, event, ...args) {
      const listener = listeners.get(channel);
      assert.ok(listener, `no listener for ${channel}`);
      return listener(event, ...args);
    },
  };
}

// Load main.cjs as if Electron had started it, on the given platform.
function startMain({ platform = process.platform, argv, ...fakeOptions } = {}) {
  const fake = createFakeElectron(fakeOptions);
  const realLoad = Module._load;
  const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const realArgv = process.argv;
  Module._load = function (request, ...rest) {
    return request === "electron"
      ? fake.electron
      : realLoad.call(this, request, ...rest);
  };
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  if (argv) process.argv = argv;
  delete require.cache[MAIN];
  try {
    require(MAIN);
  } finally {
    Module._load = realLoad;
    process.argv = realArgv;
  }
  fake.restorePlatform = () =>
    Object.defineProperty(process, "platform", realPlatform);
  return fake;
}

async function withProject(name, run) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-main-test-"),
  );
  const file = path.join(directory, `${name}.prism.json`);
  await fs.writeFile(
    file,
    JSON.stringify({
      version: 2,
      name,
      width: 1920,
      height: 1080,
      surfaces: [
        {
          id: "s1",
          name: "Surface",
          corners: [
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.1 },
            { x: 0.9, y: 0.9 },
            { x: 0.1, y: 0.9 },
          ],
          source: "grid",
          visible: true,
          locked: false,
          opacity: 1,
          color: "#ffffff",
        },
      ],
      media: [],
      brightness: 0.5,
      blackout: false,
      playing: true,
    }),
  );
  try {
    return await run(file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const opened = (window) =>
  window.webContents.sent.filter(
    ([channel]) => channel === "prism:project-opened",
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test("the editor window has the app icon and room for the page", async () => {
  for (const [platform, icon] of [
    ["win32", "icon.ico"],
    ["linux", "icon.png"],
    ["darwin", undefined],
  ]) {
    const fake = startMain({ platform });
    try {
      await fake.becomeReady();
      const options = fake.editor().options;
      assert.equal(fake.windows.length, 1, platform);
      assert.equal(options.icon && path.basename(options.icon), icon, platform);
      // Plain window sizes, not content sizes: Electron leaves the menu bar out
      // of a content-size minimum on Windows.
      assert.equal(options.useContentSize, undefined, platform);
      // Until the real frame is measured, the page minimum plus an allowance.
      assert.ok(options.minWidth >= 1050 && options.minHeight >= 700, platform);
      assert.ok(options.width >= options.minWidth, platform);
      assert.ok(options.height >= options.minHeight, platform);
      assert.equal(options.webPreferences.sandbox, true);
      assert.equal(options.webPreferences.contextIsolation, true);
      // The Windows taskbar and shortcuts group by this id, and the installer uses it too.
      assert.equal(
        fake.electron.app.appId,
        platform === "win32" ? "org.prismmapper.desktop" : null,
      );
    } finally {
      fake.restorePlatform();
    }
  }
});

test("the minimum size is made exact from the frame the window really has", async () => {
  for (const frame of [
    { width: 16, height: 65 },
    { width: 10, height: 52 },
    { width: 0, height: 28 },
  ]) {
    const fake = startMain({
      workArea: { x: 0, y: 0, width: 2560, height: 1400 },
    });
    try {
      fake.behaviour.frame = frame;
      await fake.becomeReady();
      const window = fake.editor();
      window.emit("ready-to-show");
      // The page is never given less than 1080 x 700 (and 1460 x 912 to start with).
      assert.deepEqual(window.minimumSize, [
        1080 + frame.width,
        700 + frame.height,
      ]);
      assert.deepEqual(window.size, [1460 + frame.width, 912 + frame.height]);
      assert.deepEqual(
        window.calls.filter((call) => call !== "loadFile"),
        ["setMinimumSize", "setSize", "show"],
      );
    } finally {
      fake.restorePlatform();
    }
  }
});

test("a laptop screen starts maximised, a large screen does not", async () => {
  const small = startMain({
    workArea: { x: 0, y: 0, width: 1366, height: 728 },
  });
  await small.becomeReady();
  small.editor().emit("ready-to-show");
  assert.deepEqual(
    small.editor().calls.filter((call) => call !== "loadFile"),
    ["setMinimumSize", "maximize", "show"],
  );
  // The smallest window still fits the screen it was made for.
  assert.ok(small.editor().minimumSize[0] <= 1366);
  assert.ok(small.editor().minimumSize[1] <= 728);
  small.restorePlatform();

  const large = startMain({
    workArea: { x: 0, y: 0, width: 2560, height: 1400 },
  });
  await large.becomeReady();
  large.editor().emit("ready-to-show");
  assert.deepEqual(
    large.editor().calls.filter((call) => call !== "loadFile"),
    ["setMinimumSize", "setSize", "show"],
  );
  assert.equal(large.editor().options.width, 1460 + 24);
  large.restorePlatform();
});

test("a second copy gives up its place and opens no window", async () => {
  const fake = startMain({ primary: false });
  await fake.becomeReady();
  assert.equal(fake.electron.app.quits, 1);
  assert.equal(fake.windows.length, 0);
  fake.restorePlatform();
});

test("a project named on the command line opens once the page is ready", async () => {
  await withProject("Command line", async (file) => {
    const fake = startMain({ argv: ["Prism Mapper.exe", file] });
    try {
      await fake.becomeReady();
      const editor = fake.editor();
      await settle();
      assert.deepEqual(
        opened(editor),
        [],
        "nothing is sent before the page asks",
      );
      // Only the editor page can say it is ready.
      fake.send(
        "prism:project-listener",
        { sender: new FakeWebContents(), senderFrame: null },
        true,
      );
      await settle();
      assert.deepEqual(opened(editor), []);
      fake.send("prism:project-listener", fake.from(editor), true);
      await settle();
      const [[channel, payload]] = opened(editor);
      assert.equal(channel, "prism:project-opened");
      assert.equal(payload.path, file);
      assert.equal(payload.project.name, "Command line");
      assert.deepEqual(payload.missing, []);
      const current = await fake.invoke("prism:get-project", fake.from(editor));
      assert.equal(current.name, "Command line");
    } finally {
      fake.restorePlatform();
    }
  });
});

test("macOS open-file before the app is ready is kept and prevents the default", async () => {
  await withProject("Early open-file", async (file) => {
    const fake = startMain({ platform: "darwin" });
    try {
      let prevented = 0;
      fake.electron.app.emit(
        "open-file",
        { preventDefault: () => prevented++ },
        file,
      );
      assert.equal(prevented, 1);
      assert.equal(fake.windows.length, 0, "no window is made before ready");
      await fake.becomeReady();
      const editor = fake.editor();
      fake.send("prism:project-listener", fake.from(editor), true);
      await settle();
      assert.equal(opened(editor)[0][1].project.name, "Early open-file");
    } finally {
      fake.restorePlatform();
    }
  });
});

test("a second launch brings the editor forward and opens what it was given", async () => {
  await withProject("Second launch", async (file) => {
    const fake = startMain();
    try {
      await fake.becomeReady();
      const editor = fake.editor();
      fake.send("prism:project-listener", fake.from(editor), true);
      editor.minimized = true;
      fake.electron.app.emit(
        "second-instance",
        {},
        ["Prism Mapper.exe", "--flag", file],
        os.tmpdir(),
      );
      await settle();
      assert.deepEqual(
        editor.calls.filter((call) =>
          ["restore", "show", "focus"].includes(call),
        ),
        ["restore", "show", "focus"],
      );
      assert.equal(opened(editor)[0][1].path, file);
      // No project given: still comes forward, opens nothing new.
      fake.electron.app.emit(
        "second-instance",
        {},
        ["Prism Mapper.exe"],
        os.tmpdir(),
      );
      await settle();
      assert.equal(opened(editor).length, 1);
      assert.equal(fake.windows.length, 1);
    } finally {
      fake.restorePlatform();
    }
  });
});

test("a project file that cannot be opened is reported to the page", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-main-test-"),
  );
  const file = path.join(directory, "broken.prism.json");
  await fs.writeFile(file, "{ nope");
  const fake = startMain();
  try {
    await fake.becomeReady();
    const editor = fake.editor();
    fake.send("prism:project-listener", fake.from(editor), true);
    fake.electron.app.emit(
      "second-instance",
      {},
      ["Prism Mapper.exe", file],
      directory,
    );
    await settle();
    const [[, payload]] = opened(editor);
    assert.match(payload.error, /not valid JSON/);
    assert.equal(payload.path, file);
    assert.equal(
      await fake.invoke("prism:get-project", fake.from(editor)),
      null,
    );
  } finally {
    fake.restorePlatform();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("the Open button and the operating system share one loader", async () => {
  await withProject("Shared loader", async (file) => {
    const fake = startMain();
    try {
      await fake.becomeReady();
      const editor = fake.editor();
      fake.dialogs.open = async () => ({ canceled: false, filePaths: [file] });
      const viaButton = await fake.invoke(
        "prism:load-project",
        fake.from(editor),
      );
      fake.send("prism:project-listener", fake.from(editor), true);
      fake.electron.app.emit(
        "second-instance",
        {},
        ["Prism Mapper.exe", file],
        os.tmpdir(),
      );
      await settle();
      const [[, viaSystem]] = opened(editor);
      const { path: openedPath, ...rest } = viaSystem;
      assert.equal(openedPath, file);
      assert.deepEqual(rest, viaButton);
      fake.dialogs.open = async () => ({ canceled: true, filePaths: [] });
      assert.deepEqual(
        await fake.invoke("prism:load-project", fake.from(editor)),
        {},
      );
    } finally {
      fake.restorePlatform();
    }
  });
});

test("Save offers a name Windows accepts and writes the project", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prism-main-test-"),
  );
  const fake = startMain({ platform: "win32" });
  try {
    await fake.becomeReady();
    const editor = fake.editor();
    const target = path.join(directory, "CON_.prism.json");
    let offered;
    fake.dialogs.save = async (_window, options) => {
      offered = options.defaultPath;
      return { canceled: false, filePath: target };
    };
    const project = JSON.parse(
      await withProject("CON", (file) => fs.readFile(file, "utf8")),
    );
    const result = await fake.invoke(
      "prism:save-project",
      fake.from(editor),
      project,
    );
    assert.equal(offered, "CON_.prism.json");
    assert.deepEqual(result, { saved: true, path: target });
    assert.equal(JSON.parse(await fs.readFile(target, "utf8")).name, "CON");
    assert.deepEqual(await fs.readdir(directory), ["CON_.prism.json"]);
  } finally {
    fake.restorePlatform();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("moving the output to another display does not leave the screen locked awake", async () => {
  const displays = [1, 2, 3].map((id) => ({
    id,
    label: `Display ${id}`,
    bounds: { x: (id - 1) * 1920, y: 0, width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
  }));
  const fake = startMain({ displays });
  try {
    await fake.becomeReady();
    const editor = fake.editor();
    const event = fake.from(editor);
    await fake.invoke("prism:open-output", event, 2);
    assert.equal(fake.blockers.size, 1);
    const first = fake.windows[1];
    await fake.invoke("prism:open-output", event, 3);
    const second = fake.windows[2];
    assert.equal(fake.blockers.size, 1, "the first request was released");
    // The old window reports closed after the new one is already up.
    first.finishClosing();
    assert.equal(fake.blockers.size, 1);
    await fake.invoke("prism:close-output", event);
    second.finishClosing();
    assert.equal(
      fake.blockers.size,
      0,
      "closing the output releases the screen",
    );
  } finally {
    fake.restorePlatform();
  }
});

test("an output that fails to open on the new display leaves the screen free to sleep", async () => {
  const displays = [1, 2, 3].map((id) => ({
    id,
    label: `Display ${id}`,
    bounds: { x: (id - 1) * 1920, y: 0, width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
  }));
  const fake = startMain({ displays });
  try {
    await fake.becomeReady();
    const event = fake.from(fake.editor());
    await fake.invoke("prism:open-output", event, 2);
    assert.equal(fake.blockers.size, 1);
    fake.behaviour.failOutputLoad = true;
    const result = await fake.invoke("prism:open-output", event, 3);
    assert.match(result.error, /Could not open output/);
    fake.windows[1].finishClosing();
    assert.equal(fake.blockers.size, 0);
  } finally {
    fake.restorePlatform();
  }
});
