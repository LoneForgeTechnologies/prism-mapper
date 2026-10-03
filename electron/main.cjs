const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  dialog,
  protocol,
  net,
  powerSaveBlocker,
  Menu,
  session,
  shell,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  validateProject,
  serializeProject,
  mediaKind,
} = require("./project.cjs");
const { serveMediaFile } = require("./media.cjs");
const { createAudioBridge } = require("./audio.cjs");
const { loadProjectFile } = require("./load.cjs");
const { defaultProjectFileName } = require("./paths.cjs");
const { writeFileAtomic } = require("./files.cjs");
const { projectPathFromArgv, createProjectOpener } = require("./launch.cjs");
const { createWakeLock } = require("./wakelock.cjs");
const {
  editorWindowGeometry,
  windowSizes,
  measureFrame,
} = require("./window-size.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let editor = null;
let output = null;
let outputDisplayId = null;
let currentProject = null;
let currentOverlay = null;
let currentProjectPath = null;
const displayLock = createWakeLock(powerSaveBlocker);
let audioBridge = null;
const mediaPaths = new Map();
const mediaTokens = new Map();
const appHtml = path.join(__dirname, "..", "dist", "index.html");
const devURL = process.env.PRISM_DEV_URL;
app.setName("Prism Mapper");
// Windows groups taskbar buttons, pinned shortcuts and notifications by this
// id. The installer gives its shortcuts the same one.
const APP_ID = "org.prismmapper.desktop";
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory) app.setPath("userData", path.resolve(profileDirectory));

if (devURL) {
  const parsed = new URL(devURL);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  ) {
    throw new Error("PRISM_DEV_URL must point to a local development server");
  }
}

// One editor at a time. A second launch, such as a double-clicked project,
// hands its request to the running copy and exits. The lock belongs to the
// user data folder, so runs with their own --user-data-dir are independent.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

function send(window, channel, value) {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
    window.webContents.send(channel, value);
}
function broadcast(channel, value) {
  send(editor, channel, value);
  send(output, channel, value);
}
function status(error) {
  return {
    open: Boolean(output && !output.isDestroyed()),
    ...(outputDisplayId !== null ? { displayId: outputDisplayId } : {}),
    ...(error ? { error } : {}),
  };
}
function displayList() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: display.label || `Display ${index + 1}`,
    bounds: { ...display.bounds },
    size: { ...display.size },
    scaleFactor: display.scaleFactor,
    primary: display.id === primaryId,
    internal: Boolean(display.internal),
  }));
}
function trusted(event, editorOnly = false) {
  const validWindow =
    (editor && event.sender === editor.webContents) ||
    (!editorOnly && output && event.sender === output.webContents);
  if (!validWindow || event.senderFrame !== event.sender.mainFrame)
    throw new Error("This action is not available from this window");
}
function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
}
// The window icon on Windows and Linux. A packaged Windows build also carries
// the icon inside its executable; this is what a window shows when the program
// was started from source, and on Linux. macOS takes its icon from the bundle.
function windowIcon() {
  if (process.platform === "darwin") return undefined;
  return path.join(
    __dirname,
    "..",
    "build",
    process.platform === "win32" ? "icon.ico" : "icon.png",
  );
}
function options(extra = {}) {
  const icon = windowIcon();
  return {
    backgroundColor: "#090d12",
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
    ...extra,
  };
}
function loadWindow(window, hash = "") {
  return devURL
    ? window.loadURL(`${devURL.replace(/#.*$/, "")}${hash ? `#${hash}` : ""}`)
    : window.loadFile(appHtml, { hash });
}
function registerMedia(filename) {
  const absolutePath = path.resolve(filename);
  let token = mediaTokens.get(absolutePath);
  if (!token) {
    token = randomUUID();
    mediaTokens.set(absolutePath, token);
    mediaPaths.set(token, absolutePath);
  }
  return { url: `media://local/${token}`, path: absolutePath };
}
// Open a project file and make it the current project. The Open button, a
// double-clicked file, "Open with", a second launch and macOS open-file all use
// this, so they share one set of checks and one way to hand out media.
async function openProjectFile(filename) {
  const result = await loadProjectFile(filename, { registerMedia });
  currentProject = result.project;
  currentProjectPath = filename;
  send(output, "prism:project", currentProject);
  return result;
}
// Requests from the operating system wait until the editor page has said it can
// show a project (window.prism.onProjectOpened), then arrive one at a time.
const projectOpener = createProjectOpener({
  load: openProjectFile,
  deliver: (payload) => send(editor, "prism:project-opened", payload),
});
function showEditor() {
  if (!app.isReady()) return;
  if (!editor || editor.isDestroyed()) {
    createEditor();
    return;
  }
  if (editor.isMinimized()) editor.restore();
  editor.show();
  editor.focus();
}
function runtimeProject(input) {
  return validateProject(input, (media) => {
    if (!media.url && media.path) return { url: "", path: media.path }; // Known missing media remains relinkable in a saved project.
    let url;
    try {
      url = new URL(media.url);
    } catch {
      throw new Error("Media must be imported through the media picker");
    }
    const filename = mediaPaths.get(url.pathname.slice(1));
    if (
      url.protocol !== "media:" ||
      url.hostname !== "local" ||
      !filename ||
      url.search ||
      url.hash ||
      mediaKind(filename) !== media.kind
    ) {
      throw new Error("Media must be imported through the media picker");
    }
    return { url: media.url, path: filename };
  });
}

function closeOutput() {
  // The display may sleep again as soon as the output starts closing, not when
  // the window finally reports closed: by then a new output on another display
  // may already be open.
  displayLock.stop();
  if (output && !output.isDestroyed()) output.close();
  else {
    output = null;
    outputDisplayId = null;
  }
}

async function openOutput(displayId) {
  if (!Number.isInteger(displayId)) return status("Choose a connected display");
  const target = screen
    .getAllDisplays()
    .find((display) => display.id === displayId);
  if (!target) return status("That display is no longer connected");
  if (output && !output.isDestroyed()) {
    if (outputDisplayId === displayId) {
      output.focus();
      return status();
    }
    closeOutput();
  }
  const projection = new BrowserWindow(
    options({
      title: "Prism Mapper — Output",
      ...target.bounds,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      hasShadow: false,
      fullscreenable: true,
      enableLargerThanScreen: true,
    }),
  );
  output = projection;
  outputDisplayId = displayId;
  secureWindow(projection);
  projection.setMenuBarVisibility(false);
  // On macOS, native fullscreen creates a Space and can blank the operator screen.
  // Simple fullscreen uses the exact selected display bounds without moving Spaces.
  projection.setBounds(target.bounds);
  projection.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      projection.close();
    }
  });
  projection.on("closed", () => {
    if (output === projection) {
      output = null;
      outputDisplayId = null;
      displayLock.stop();
      broadcast("prism:output-status", status());
      if (editor && !editor.isDestroyed()) editor.focus();
    }
  });
  projection.webContents.on("render-process-gone", () => {
    closeOutput();
    broadcast(
      "prism:output-status",
      status("The output renderer stopped. Reopen the projector output."),
    );
  });
  try {
    await loadWindow(projection, "output");
    if (projection.isDestroyed() || output !== projection) return status();
    if (process.platform === "darwin") projection.setSimpleFullScreen(true);
    else projection.setFullScreen(true);
    projection.show();
    displayLock.start();
    if (currentProject) send(projection, "prism:project", currentProject);
    send(projection, "prism:overlay", currentOverlay);
    broadcast("prism:output-status", status());
    return status();
  } catch (error) {
    if (!projection.isDestroyed()) projection.close();
    const result = status(`Could not open output: ${error.message}`);
    broadcast("prism:output-status", result);
    return result;
  }
}

function installIPC() {
  ipcMain.handle("prism:get-overlay", (event) => {
    trusted(event);
    return currentOverlay;
  });
  ipcMain.on("prism:update-overlay", (event, input) => {
    try {
      trusted(event, true);
      if (input === null) currentOverlay = null;
      else {
        if (
          !input ||
          !Array.isArray(input.points) ||
          input.points.length > 64 ||
          typeof input.closed !== "boolean"
        )
          throw new Error("Invalid editing guide");
        const point = (p) => {
          if (
            !p ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            p.x < 0 ||
            p.x > 1 ||
            p.y < 0 ||
            p.y > 1
          )
            throw new Error("Invalid editing guide point");
          return { x: p.x, y: p.y };
        };
        currentOverlay = {
          points: input.points.map(point),
          closed: input.closed,
          ...(input.cursor ? { cursor: point(input.cursor) } : {}),
        };
      }
      send(output, "prism:overlay", currentOverlay);
    } catch (error) {
      console.warn("Editing guide rejected:", error.message);
    }
  });
  ipcMain.handle("prism:get-displays", (event) => {
    trusted(event);
    return displayList();
  });
  ipcMain.handle("prism:get-project", (event) => {
    trusted(event);
    return currentProject;
  });
  ipcMain.handle("prism:open-output", (event, displayId) => {
    trusted(event, true);
    return openOutput(displayId);
  });
  ipcMain.handle("prism:close-output", (event) => {
    trusted(event);
    closeOutput();
  });
  ipcMain.on("prism:update-project", (event, project) => {
    try {
      trusted(event, true);
      currentProject = runtimeProject(project);
      send(output, "prism:project", currentProject);
    } catch (error) {
      console.warn("Project update rejected:", error.message);
    }
  });
  ipcMain.on("prism:set-blackout", (event, value) => {
    try {
      trusted(event);
      if (typeof value !== "boolean" || !currentProject) return;
      currentProject = { ...currentProject, blackout: value };
      broadcast("prism:project", currentProject);
    } catch (error) {
      console.warn("Blackout update rejected:", error.message);
    }
  });
  ipcMain.handle("prism:import-media", async (event) => {
    trusted(event, true);
    const selection = await dialog.showOpenDialog(editor, {
      title: "Import image or video",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images and videos",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
            "avif",
            "bmp",
            "mp4",
            "m4v",
            "mov",
            "webm",
            "ogv",
          ],
        },
      ],
    });
    if (selection.canceled) return [];
    const imported = [];
    for (const filename of selection.filePaths.slice(0, 256)) {
      const kind = mediaKind(filename);
      if (!kind || !(await fs.stat(filename)).isFile()) continue;
      imported.push({
        id: randomUUID(),
        name: path.basename(filename).slice(0, 200),
        kind,
        ...registerMedia(filename),
      });
    }
    return imported;
  });
  ipcMain.handle("prism:save-project", async (event, input) => {
    trusted(event, true);
    try {
      const project = runtimeProject(input);
      const selection = await dialog.showSaveDialog(editor, {
        title: "Save mapping project",
        defaultPath: currentProjectPath || defaultProjectFileName(project.name),
        filters: [{ name: "Prism Mapper project", extensions: ["prism.json"] }],
      });
      if (selection.canceled || !selection.filePath) return { saved: false };
      const filename = selection.filePath.toLowerCase().endsWith(".prism.json")
        ? selection.filePath
        : `${selection.filePath}.prism.json`;
      await writeFileAtomic(filename, serializeProject(project, filename));
      currentProjectPath = filename;
      return { saved: true, path: filename };
    } catch (error) {
      return { saved: false, error: error.message };
    }
  });
  ipcMain.handle("prism:load-project", async (event) => {
    trusted(event, true);
    try {
      const selection = await dialog.showOpenDialog(editor, {
        title: "Open mapping project",
        properties: ["openFile"],
        filters: [{ name: "Prism Mapper project", extensions: ["json"] }],
      });
      if (selection.canceled || !selection.filePaths[0]) return {};
      return await openProjectFile(selection.filePaths[0]);
    } catch (error) {
      return { error: error.message };
    }
  });
  // The page tells the main process when it can show a project that the
  // operating system asked to open, and when it can no longer do so.
  ipcMain.on("prism:project-listener", (event, active) => {
    try {
      trusted(event, true);
      projectOpener.setReady(active === true);
    } catch (error) {
      console.warn("Project listener rejected:", error.message);
    }
  });
}

function createEditor() {
  // A page that has just been created has not subscribed to opened projects.
  projectOpener.setReady(false);
  const geometry = editorWindowGeometry(screen.getPrimaryDisplay().workArea);
  editor = new BrowserWindow(
    options({ title: "Prism Mapper", ...windowSizes(geometry) }),
  );
  const window = editor;
  secureWindow(window);
  window.once("ready-to-show", () => {
    // The title bar, menu bar and borders exist now, so the minimum can be
    // exact: the page never gets less room than geometry says.
    const frame = measureFrame(window.getBounds(), window.getContentBounds());
    window.setMinimumSize(
      geometry.minWidth + frame.width,
      geometry.minHeight + frame.height,
    );
    if (geometry.maximize) window.maximize();
    else
      window.setSize(
        geometry.width + frame.width,
        geometry.height + frame.height,
      );
    window.show();
  });
  window.webContents.on("render-process-gone", () => {
    projectOpener.setReady(false);
    audioBridge?.clear();
    closeOutput();
  });
  window.webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        projectOpener.setReady(false);
        audioBridge?.clear();
      }
    },
  );
  window.on("closed", () => {
    currentOverlay = null;
    audioBridge?.clear();
    closeOutput();
    if (editor === window) editor = null;
  });
  loadWindow(window).catch((error) =>
    dialog.showErrorBox(
      "Prism Mapper could not start",
      `Build the application with npm run build first.\n\n${error.message}`,
    ),
  );
}

// A project can be named on the command line (Windows and Linux start the
// program with its path), arrive from a second launch, or come from macOS
// open-file, which can fire before the app is ready.
if (primaryInstance) {
  const launched = projectPathFromArgv(process.argv, {
    cwd: process.cwd(),
    defaultApp: process.defaultApp,
  });
  if (launched) projectOpener.request(launched);
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const requested = projectPathFromArgv(argv, {
      cwd: workingDirectory,
      defaultApp: process.defaultApp,
    });
    if (requested) projectOpener.request(requested);
    showEditor();
  });
  app.on("open-file", (event, filename) => {
    event.preventDefault();
    projectOpener.request(path.resolve(filename));
    showEditor();
  });
}

app
  .whenReady()
  .then(() => {
    if (!primaryInstance) return;
    audioBridge = createAudioBridge({
      ipcMain,
      session: session.defaultSession,
      getEditor: () => editor,
      getOutput: () => output,
      trusted,
      send,
    });
    protocol.handle("media", async (request) => {
      const url = new URL(request.url);
      const filename = mediaPaths.get(url.pathname.slice(1));
      if (
        url.hostname !== "local" ||
        url.search ||
        url.hash ||
        !filename ||
        !["GET", "HEAD"].includes(request.method)
      )
        return new Response("Not found", { status: 404 });
      try {
        const response = await serveMediaFile(
          filename,
          request,
          (url, options) => net.fetch(url, options),
        );
        const headers = new Headers(response.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set(
          "Access-Control-Expose-Headers",
          "Content-Range, Accept-Ranges, Content-Length",
        );
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch {
        return new Response("Media file unavailable", { status: 404 });
      }
    });
    installIPC();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [
              {
                label: "Prism Mapper",
                submenu: [
                  { role: "about" },
                  { type: "separator" },
                  { role: "hide" },
                  { role: "hideOthers" },
                  { role: "unhide" },
                  { type: "separator" },
                  { role: "quit" },
                ],
              },
            ]
          : []),
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
        {
          label: "Help",
          submenu: [
            {
              label: "Getting started",
              click: () =>
                shell.openExternal(
                  "https://github.com/LoneForgeTechnologies/prism-mapper/blob/main/docs/getting-started.md",
                ),
            },
            {
              label: "Download updates",
              click: () =>
                shell.openExternal(
                  "https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest",
                ),
            },
            {
              label: "Report an issue",
              click: () =>
                shell.openExternal(
                  "https://github.com/LoneForgeTechnologies/prism-mapper/issues/new/choose",
                ),
            },
            { type: "separator" },
            {
              label: "View source on GitHub",
              click: () =>
                shell.openExternal(
                  "https://github.com/LoneForgeTechnologies/prism-mapper",
                ),
            },
          ],
        },
      ]),
    );
    const updateDisplays = () => {
      const displays = displayList();
      if (
        output &&
        !displays.some((display) => display.id === outputDisplayId)
      ) {
        closeOutput();
        broadcast(
          "prism:output-status",
          status("Projector disconnected. Connect it and reopen output."),
        );
      }
      broadcast("prism:displays", displays);
    };
    screen.on("display-added", updateDisplays);
    screen.on("display-removed", updateDisplays);
    screen.on("display-metrics-changed", (_event, display) => {
      if (output && !output.isDestroyed() && display.id === outputDisplayId)
        output.setBounds(display.bounds);
      updateDisplays();
    });
    createEditor();
    app.on("activate", () => {
      if (!editor) createEditor();
    });
  })
  .catch((error) => {
    console.error(error);
    app.quit();
  });
app.on("window-all-closed", () => {
  displayLock.stop();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  audioBridge?.dispose();
  displayLock.stop();
});
