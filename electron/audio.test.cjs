const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAudioFrame,
  supportsSystemAudio,
  SILENT_AUDIO,
  createAudioBridge,
} = require("./audio.cjs");

function harness() {
  const handlers = new Map();
  const frame = {};
  const editor = {
    isDestroyed: () => false,
    webContents: {
      mainFrame: frame,
      getURL: () => "file:///prism/dist/index.html",
    },
  };
  const output = { isDestroyed: () => false, webContents: { mainFrame: {} } };
  const session = {
    setPermissionCheckHandler(fn) {
      this.check = fn;
    },
    setPermissionRequestHandler(fn) {
      this.request = fn;
    },
    setDisplayMediaRequestHandler(fn) {
      this.display = fn;
    },
  };
  const events = [];
  const bridge = createAudioBridge({
    ipcMain: {
      handle: (name, handler) => handlers.set(name, handler),
      on: (name, handler) => handlers.set(name, handler),
    },
    session,
    getEditor: () => editor,
    getOutput: () => output,
    trusted(event, editorOnly) {
      if (
        event.sender !== editor.webContents &&
        (editorOnly || event.sender !== output.webContents)
      )
        throw new Error("Untrusted");
    },
    send: (window, channel, payload) =>
      events.push({ window, channel, payload }),
  });
  return {
    bridge,
    editor,
    output,
    handlers,
    session,
    events,
    call(name, value, window = editor) {
      return handlers.get(`prism:${name}`)(
        { sender: window.webContents },
        value,
      );
    },
  };
}

test("audio summary validation rejects malformed/oversized values and strips arbitrary fields", () => {
  const valid = {
    active: true,
    level: 0.8,
    bass: 1,
    mid: 0.2,
    treble: 0,
    beat: 0.5,
  };
  assert.deepEqual(validateAudioFrame({ ...valid, samples: [1, 2] }), valid);
  for (const value of [
    null,
    [],
    {},
    { ...valid, active: 1 },
    { ...valid, bass: NaN },
    { ...valid, level: Infinity },
    { ...valid, mid: -0.1 },
    { ...valid, treble: 1.1 },
  ])
    assert.equal(validateAudioFrame(value), null);
  assert.deepEqual(
    validateAudioFrame({ ...valid, active: false }),
    SILENT_AUDIO,
  );
});

test("system audio support follows CoreAudio Tap macOS 14.2 minimum and Windows loopback", () => {
  assert.equal(supportsSystemAudio("darwin", "23.1.0"), false);
  assert.equal(supportsSystemAudio("darwin", "23.2.0"), true);
  assert.equal(supportsSystemAudio("darwin", "25.0.0"), true);
  assert.equal(supportsSystemAudio("win32", "10.0.0"), true);
  assert.equal(supportsSystemAudio("linux", "6.0.0"), false);
});

test("permissions are editor-only, audio-only, main-frame-only and require a fresh Start grant", () => {
  const h = harness();
  try {
    const details = {
      isMainFrame: true,
      requestingUrl: h.editor.webContents.getURL(),
      mediaType: "audio",
      mediaTypes: ["audio"],
    };
    const check = (permission, d = details, contents = h.editor.webContents) =>
      h.session.check(contents, permission, "file://", d);
    const request = (
      permission,
      d = details,
      contents = h.editor.webContents,
    ) => {
      let allowed;
      h.session.request(
        contents,
        permission,
        (answer) => (allowed = answer),
        d,
      );
      return allowed;
    };
    assert.equal(check("media"), false);
    assert.equal(request("media"), false);
    assert.throws(
      () => h.call("prepare-audio", { kind: "input" }, h.output),
      /Untrusted/,
    );
    assert.equal(h.call("prepare-audio", { kind: "input" }).ok, true);
    assert.equal(check("media"), true);
    assert.equal(request("media"), true);
    assert.equal(check("media", { ...details, mediaType: "video" }), false);
    assert.equal(
      request("media", { ...details, mediaTypes: ["audio", "video"] }),
      false,
    );
    assert.equal(check("media", { ...details, isMainFrame: false }), false);
    assert.equal(
      request("media", { ...details, requestingUrl: "https://example.com" }),
      false,
    );
    assert.equal(check("media", details, h.output.webContents), false);
    for (const permission of [
      "geolocation",
      "camera",
      "notifications",
      "display-capture",
      "speaker-selection",
    ])
      assert.equal(request(permission), false);
    h.call("audio-started");
    assert.equal(check("media"), false);
    assert.equal(request("media"), false);
    h.call("prepare-audio", { kind: "input" });
    const now = Date.now;
    try {
      Date.now = () => now() + 31000;
      assert.equal(check("media"), false);
      assert.equal(request("media"), false);
    } finally {
      Date.now = now;
    }
    h.call("stop-audio");
    assert.equal(check("media"), false);
  } finally {
    h.bridge.dispose();
  }
});

test("system capture only grants the editor carrier plus loopback and consumes its grant", () => {
  const h = harness();
  try {
    const request = {
      frame: h.editor.webContents.mainFrame,
      audioRequested: true,
      videoRequested: true,
    };
    const capture = (value = request) => {
      let stream;
      h.session.display(value, (result) => (stream = result));
      return stream;
    };
    assert.deepEqual(capture(), {});
    const prepared = h.call("prepare-audio", { kind: "system" });
    if (!prepared.ok) return;
    const legacyPermission = (mediaTypes) => {
      let permitted;
      h.session.request(
        h.editor.webContents,
        "media",
        (allowed) => {
          permitted = allowed;
        },
        {
          isMainFrame: true,
          requestingUrl: h.editor.webContents.getURL(),
          mediaTypes,
        },
      );
      return permitted;
    };
    assert.equal(
      legacyPermission([]),
      true,
      "Electron 41 uses empty mediaTypes for display capture",
    );
    assert.equal(
      legacyPermission(["video"]),
      false,
      "The display grant must never authorize a camera",
    );
    assert.equal(
      legacyPermission(["audio"]),
      false,
      "The display grant must never authorize a microphone",
    );
    assert.deepEqual(
      capture({ ...request, frame: h.output.webContents.mainFrame }),
      {},
    );
    assert.deepEqual(capture({ ...request, audioRequested: false }), {});
    assert.deepEqual(capture(), {
      video: h.editor.webContents.mainFrame,
      audio: "loopback",
    });
    let permission;
    h.session.request(
      h.editor.webContents,
      "display-capture",
      (allowed) => {
        permission = allowed;
      },
      {
        isMainFrame: true,
        requestingUrl: h.editor.webContents.getURL(),
        mediaTypes: ["audio", "video"],
      },
    );
    assert.equal(
      permission,
      true,
      "The post-selection Chromium permission check retains the same Start grant",
    );
    assert.deepEqual(capture(), {});
    h.call("audio-started");
    assert.equal(legacyPermission([]), false);
    h.session.request(
      h.editor.webContents,
      "display-capture",
      (allowed) => {
        permission = allowed;
      },
      {
        isMainFrame: true,
        requestingUrl: h.editor.webContents.getURL(),
        mediaTypes: ["audio", "video"],
      },
    );
    assert.equal(permission, false);
  } finally {
    h.bridge.dispose();
  }
});

test("only a started editor can publish live audio, Stop clears output, malformed/output writes do not mutate state", () => {
  const h = harness();
  try {
    const live = { ...SILENT_AUDIO, active: true, bass: 0.8, level: 0.6 };
    h.call("update-audio", live);
    assert.deepEqual(h.call("get-audio"), SILENT_AUDIO);
    h.call("prepare-audio", { kind: "input" });
    h.call("audio-started");
    h.call("update-audio", live);
    assert.deepEqual(h.call("get-audio", undefined, h.output), live);
    h.call("update-audio", { ...live, level: 0.1 }, h.output);
    h.call("update-audio", { ...live, bass: Infinity });
    assert.deepEqual(h.call("get-audio"), live);
    h.call("stop-audio", undefined, h.output);
    assert.deepEqual(h.call("get-audio"), live);
    h.call("stop-audio");
    assert.deepEqual(h.call("get-audio"), SILENT_AUDIO);
    assert.deepEqual(h.events.at(-1).payload, SILENT_AUDIO);
  } finally {
    h.bridge.dispose();
  }
});
