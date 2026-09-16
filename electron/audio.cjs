const os = require("node:os");

const SILENT_AUDIO = Object.freeze({
  active: false,
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  beat: 0,
});

function validateAudioFrame(value) {
  if (!value || typeof value !== "object" || typeof value.active !== "boolean")
    return null;
  const frame = { active: value.active };
  for (const key of ["level", "bass", "mid", "treble", "beat"]) {
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1)
      return null;
    frame[key] = value[key];
  }
  return frame.active ? frame : { ...SILENT_AUDIO };
}

function supportsSystemAudio(
  platform = process.platform,
  release = os.release(),
) {
  if (platform === "win32") return true;
  if (platform !== "darwin") return false;
  // Darwin 23.2 is macOS 14.2, the first CoreAudio Tap API release.
  const [major, minor] = release.split(".").map(Number);
  return major > 23 || (major === 23 && minor >= 2);
}

/** One short-lived, editor-only capture grant. All other session permissions stay denied. */
function createAudioBridge({
  ipcMain,
  session,
  getEditor,
  getOutput,
  trusted,
  send,
}) {
  let grant = null;
  let active = false;
  let current = SILENT_AUDIO;
  let lastFrameAt = 0;
  const isEditor = (contents) => {
    const editor = getEditor();
    return Boolean(
      editor && !editor.isDestroyed() && contents === editor.webContents,
    );
  };
  const isArmed = (kind) =>
    Boolean(grant && grant.kind === kind && grant.until > Date.now());
  const isEditorURL = (url) => {
    try {
      return (
        new URL(url).href === new URL(getEditor().webContents.getURL()).href
      );
    } catch {
      return false;
    }
  };
  const clear = () => {
    grant = null;
    active = false;
    current = SILENT_AUDIO;
    lastFrameAt = 0;
    send(getOutput(), "prism:audio", current);
  };

  session.setPermissionCheckHandler(
    (contents, permission, _origin, details) => {
      if (!isEditor(contents) || details?.isMainFrame !== true) return false;
      if (details.requestingUrl && !isEditorURL(details.requestingUrl))
        return false;
      return (
        permission === "media" &&
        details.mediaType === "audio" &&
        isArmed("input")
      );
    },
  );
  session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      const local =
        isEditor(contents) &&
        details?.isMainFrame === true &&
        isEditorURL(details.requestingUrl);
      const onlyAudio =
        Array.isArray(details?.mediaTypes) &&
        details.mediaTypes.length > 0 &&
        details.mediaTypes.every((type) => type === "audio");
      // Electron 41 represents getDisplayMedia as a media request with an
      // empty mediaTypes list; newer Electron uses display-capture. A camera
      // request contains "video" and is denied under both source modes.
      const legacyDisplay =
        permission === "media" &&
        Array.isArray(details?.mediaTypes) &&
        details.mediaTypes.length === 0;
      callback(
        Boolean(
          local &&
          ((permission === "media" && onlyAudio && isArmed("input")) ||
            ((permission === "display-capture" || legacyDisplay) &&
              isArmed("system"))),
        ),
      );
    },
  );
  session.setDisplayMediaRequestHandler(
    (request, callback) => {
      const editor = getEditor();
      if (
        !editor ||
        editor.isDestroyed() ||
        request.frame !== editor.webContents.mainFrame ||
        !request.audioRequested ||
        !isArmed("system") ||
        grant.used ||
        !supportsSystemAudio()
      ) {
        callback({});
        return;
      }
      // getDisplayMedia requires video, but system audio does not require reading the
      // user's screen. Supply our own editor as carrier; the renderer immediately
      // stops that video track. CoreAudio Tap captures the OS mix on macOS 14.2+.
      // Chromium can make its permission request after the source callback.
      // Consume the source selection once, retaining the short permission grant
      // until the renderer confirms startup or the 30-second deadline expires.
      grant.used = true;
      callback({ video: request.frame, audio: "loopback" });
    },
    { useSystemPicker: false },
  );

  ipcMain.handle("prism:prepare-audio", (event, source) => {
    trusted(event, true);
    if (
      !source ||
      !["input", "system"].includes(source.kind) ||
      (source.deviceId !== undefined &&
        (typeof source.deviceId !== "string" || source.deviceId.length > 512))
    )
      return { ok: false, error: "Choose a valid audio source." };
    clear();
    if (source.kind === "system" && !supportsSystemAudio())
      return {
        ok: false,
        error:
          "System output capture requires macOS 14.2 or newer, or Windows. Choose a virtual loopback device under Audio input on this system.",
      };
    grant = { kind: source.kind, until: Date.now() + 30000 };
    active = true;
    return { ok: true };
  });
  ipcMain.on("prism:audio-started", (event) => {
    try {
      trusted(event, true);
      grant = null;
    } catch {
      /* Output cannot arm or change capture. */
    }
  });
  ipcMain.on("prism:stop-audio", (event) => {
    try {
      trusted(event, true);
      clear();
    } catch {
      /* Ignore untrusted writes. */
    }
  });
  ipcMain.on("prism:update-audio", (event, value) => {
    try {
      trusted(event, true);
      const frame = validateAudioFrame(value);
      if (!frame || (frame.active && !active)) return;
      current = frame;
      lastFrameAt = Date.now();
      send(getOutput(), "prism:audio", current);
    } catch {
      /* Ignore untrusted or malformed ephemeral audio summaries. */
    }
  });
  ipcMain.handle("prism:get-audio", (event) => {
    trusted(event);
    return Date.now() - lastFrameAt <= 500 ? current : SILENT_AUDIO;
  });
  const staleTimer = setInterval(() => {
    if (current.active && Date.now() - lastFrameAt > 500) {
      current = SILENT_AUDIO;
      send(getOutput(), "prism:audio", current);
    }
  }, 250);
  staleTimer.unref();
  return {
    clear,
    dispose() {
      clearInterval(staleTimer);
      clear();
    },
  };
}

module.exports = {
  SILENT_AUDIO,
  validateAudioFrame,
  supportsSystemAudio,
  createAudioBridge,
};
