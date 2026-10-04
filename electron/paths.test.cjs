const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  mediaPathCandidates,
  networkLocation,
  mayOpenMedia,
  defaultProjectFileName,
} = require("./paths.cjs");

const project = "D:\\Shows\\Night Market\\show.prism.json";

test("resolves media written with either separator on Windows", () => {
  const resolve = (media) => mediaPathCandidates(project, media, path.win32);
  assert.deepEqual(resolve("media/clip one.mp4"), [
    "D:\\Shows\\Night Market\\media\\clip one.mp4",
  ]);
  assert.deepEqual(resolve("media\\clip one.mp4"), [
    "D:\\Shows\\Night Market\\media\\clip one.mp4",
  ]);
  assert.deepEqual(resolve("../Shared/loop.webm"), [
    "D:\\Shows\\Shared\\loop.webm",
  ]);
  assert.deepEqual(resolve("..\\Shared/loop.webm"), [
    "D:\\Shows\\Shared\\loop.webm",
  ]);
});

test("resolves absolute media on another drive, share or namespace", () => {
  const resolve = (media) => mediaPathCandidates(project, media, path.win32)[0];
  // What serializeProject writes when the media is on a different drive.
  assert.equal(
    resolve("C:/Users/Ada/Videos/a.mp4"),
    "C:\\Users\\Ada\\Videos\\a.mp4",
  );
  assert.equal(resolve("c:\\Users\\Ada\\a.png"), "c:\\Users\\Ada\\a.png");
  assert.equal(resolve("//nas/media/a.png"), "\\\\nas\\media\\a.png");
  assert.equal(resolve("\\\\nas\\media\\a.png"), "\\\\nas\\media\\a.png");
  assert.equal(
    resolve("\\\\?\\C:\\very\\long\\a.png"),
    "\\\\?\\C:\\very\\long\\a.png",
  );
  assert.equal(
    resolve("\\\\?\\UNC\\nas\\media\\a.png"),
    "\\\\?\\UNC\\nas\\media\\a.png",
  );
  // A path with no drive stays on the project's drive.
  assert.equal(resolve("\\Media\\a.png"), "D:\\Media\\a.png");
});

test("reads a Windows-style relative path on macOS and Linux, literal spelling first", () => {
  const home = "/Users/ada/Shows/show.prism.json";
  assert.deepEqual(mediaPathCandidates(home, "media\\clip.mp4", path.posix), [
    "/Users/ada/Shows/media\\clip.mp4",
    "/Users/ada/Shows/media/clip.mp4",
  ]);
  assert.deepEqual(mediaPathCandidates(home, "..\\Shared\\a.png", path.posix), [
    "/Users/ada/Shows/..\\Shared\\a.png",
    "/Users/ada/Shared/a.png",
  ]);
  assert.deepEqual(mediaPathCandidates(home, "media/clip.mp4", path.posix), [
    "/Users/ada/Shows/media/clip.mp4",
  ]);
  assert.deepEqual(
    mediaPathCandidates(home, "/Volumes/Gig/a.mp4", path.posix),
    ["/Volumes/Gig/a.mp4"],
  );
});

test("recognises network and device paths on Windows", () => {
  assert.deepEqual(networkLocation("\\\\Nas\\media\\a.png"), {
    kind: "unc",
    host: "nas",
  });
  assert.deepEqual(networkLocation("//NAS/media/a.png"), {
    kind: "unc",
    host: "nas",
  });
  assert.deepEqual(networkLocation("\\\\192.168.1.20\\c$\\a.png"), {
    kind: "unc",
    host: "192.168.1.20",
  });
  assert.deepEqual(networkLocation("\\\\?\\UNC\\Nas\\media\\a.png"), {
    kind: "unc",
    host: "nas",
  });
  assert.deepEqual(networkLocation("\\\\.\\UNC\\nas\\media\\a.png"), {
    kind: "unc",
    host: "nas",
  });
  assert.deepEqual(networkLocation("\\\\.\\pipe\\anything.png"), {
    kind: "device",
  });
  assert.deepEqual(networkLocation("\\\\?\\Volume{1234}\\a.png"), {
    kind: "device",
  });
  for (const local of [
    "C:\\Users\\Ada\\a.png",
    "C:/Users/Ada/a.png",
    "\\\\?\\C:\\very\\long\\a.png",
    "\\Media\\a.png",
    "media\\a.png",
    "/Users/ada/a.png",
  ])
    assert.equal(networkLocation(local), null, local);
});

test("a project does not make Windows contact a server it did not come from", () => {
  const win = (media, from) => mayOpenMedia(media, from, path.win32);
  const local = "D:\\Shows\\show.prism.json";
  // Local and mapped-drive media is the user's own arrangement.
  assert.equal(win("D:\\Shows\\media\\a.png", local), true);
  assert.equal(win("Z:\\Media\\a.png", local), true);
  assert.equal(win("\\\\?\\D:\\Shows\\a.png", local), true);
  // A server named inside a project file is not contacted on open.
  assert.equal(win("\\\\evil.example.com\\share\\a.png", local), false);
  assert.equal(win("\\\\?\\UNC\\evil\\share\\a.png", local), false);
  assert.equal(win("\\\\.\\pipe\\a.png", local), false);
  // Media beside a project that was itself opened from that server is fine.
  const remote = "\\\\Nas\\shows\\show.prism.json";
  assert.equal(win("\\\\nas\\media\\a.png", remote), true);
  assert.equal(win("\\\\other\\media\\a.png", remote), false);
  assert.equal(win("D:\\a.png", remote), true);
  // The rule is about Windows; elsewhere a backslash is not a server.
  assert.equal(
    mayOpenMedia(
      "/Volumes/Nas/a.png",
      "/Users/ada/show.prism.json",
      path.posix,
    ),
    true,
  );
});

test("offers a Save name every file system accepts", () => {
  const name = (value, platform) => defaultProjectFileName(value, platform);
  assert.equal(name("Night Market", "win32"), "Night Market.prism.json");
  assert.equal(name("Night Market", "darwin"), "Night Market.prism.json");
  assert.equal(name("A/B: C?*", "linux"), "A-B- C--.prism.json");
  assert.equal(name("tab\there\nnew", "darwin"), "tab-here-new.prism.json");
  assert.equal(name("", "win32"), "Untitled mapping.prism.json");
  assert.equal(name("   ", "win32"), "Untitled mapping.prism.json");
  assert.equal(name("x".repeat(300), "win32"), `${"x".repeat(100)}.prism.json`);
  // Windows refuses trailing dots and spaces, and device names with any extension.
  assert.equal(name("Show. ", "win32"), "Show.prism.json");
  assert.equal(name("  Show", "win32"), "Show.prism.json");
  assert.equal(name("CON", "win32"), "CON_.prism.json");
  assert.equal(name("aux", "win32"), "aux_.prism.json");
  assert.equal(name("Com1", "win32"), "Com1_.prism.json");
  assert.equal(name("lpt9.v2", "win32"), "lpt9_.v2.prism.json");
  assert.equal(name("CON ", "win32"), "CON_.prism.json");
  assert.equal(name("Console", "win32"), "Console.prism.json");
  assert.equal(name("COM10", "win32"), "COM10.prism.json");
  // macOS and Linux keep the name as typed.
  assert.equal(name("CON", "darwin"), "CON.prism.json");
  assert.equal(name("Show.", "linux"), "Show..prism.json");
});
