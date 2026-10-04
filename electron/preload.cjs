const { contextBridge, ipcRenderer } = require("electron");

function listen(channel, callback) {
  if (typeof callback !== "function")
    throw new TypeError("Expected an event callback");
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// The main process holds a project that the operating system asked to open
// (a double-clicked file, a second launch, macOS open-file) until the page can
// show it. Having a listener is that signal: the first one tells the main
// process the page is ready, and removing the last one tells it the page is not.
let projectListeners = 0;
function onProjectOpened(callback) {
  const stop = listen("prism:project-opened", callback);
  projectListeners++;
  if (projectListeners === 1) ipcRenderer.send("prism:project-listener", true);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    stop();
    projectListeners--;
    if (projectListeners === 0)
      ipcRenderer.send("prism:project-listener", false);
  };
}

contextBridge.exposeInMainWorld(
  "prism",
  Object.freeze({
    prepareAudio: (source) => ipcRenderer.invoke("prism:prepare-audio", source),
    audioStarted: () => ipcRenderer.send("prism:audio-started"),
    stopAudio: () => ipcRenderer.send("prism:stop-audio"),
    updateAudio: (frame) => ipcRenderer.send("prism:update-audio", frame),
    getAudio: () => ipcRenderer.invoke("prism:get-audio"),
    onAudio: (callback) => listen("prism:audio", callback),
    updateOverlay: (overlay) =>
      ipcRenderer.send("prism:update-overlay", overlay),
    getOverlay: () => ipcRenderer.invoke("prism:get-overlay"),
    onOverlay: (callback) => listen("prism:overlay", callback),
    getDisplays: () => ipcRenderer.invoke("prism:get-displays"),
    onDisplays: (callback) => listen("prism:displays", callback),
    openOutput: (displayId) =>
      ipcRenderer.invoke("prism:open-output", displayId),
    closeOutput: () => ipcRenderer.invoke("prism:close-output"),
    onOutputStatus: (callback) => listen("prism:output-status", callback),
    updateProject: (project) =>
      ipcRenderer.send("prism:update-project", project),
    getProject: () => ipcRenderer.invoke("prism:get-project"),
    onProject: (callback) => listen("prism:project", callback),
    importMedia: () => ipcRenderer.invoke("prism:import-media"),
    saveProject: (project) => ipcRenderer.invoke("prism:save-project", project),
    loadProject: () => ipcRenderer.invoke("prism:load-project"),
    getRecentProjects: () => ipcRenderer.invoke("prism:get-recent-projects"),
    openRecentProject: (id) =>
      ipcRenderer.invoke("prism:open-recent-project", id),
    onProjectOpened,
    setBlackout: (value) => ipcRenderer.send("prism:set-blackout", value),
  }),
);
