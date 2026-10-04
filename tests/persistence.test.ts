import test from "node:test";
import assert from "node:assert/strict";
import { createProject, newSurface, type Media } from "../src/model.ts";
import { validateBrowserProject } from "../src/project-validation.ts";
import {
  DRAFT_KEY,
  MAX_MEDIA_FILES,
  MAX_SAVED_MEDIA_BYTES,
  SavedMedia,
  classifyStorageError,
  clearDraft,
  describeDraftProblem,
  describeMissing,
  describeRefusedFiles,
  describeSharedDraft,
  describeSkipped,
  formatBytes,
  isDraftChangedElsewhere,
  mediaFromFiles,
  mediaIdsToKeep,
  openIndexedDbBackend,
  pickedFileKind,
  readBootProject,
  readDraft,
  sanitizeMediaName,
  serializeDraft,
  sortPickedFiles,
  takeBootReferencedIds,
  writeDraft,
  type MediaBackend,
  type MediaRecord,
} from "../src/persistence.ts";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    peek: () => value,
    getItem: (key: string) => (key === DRAFT_KEY ? value : null),
    setItem(key: string, next: string) {
      if (key === DRAFT_KEY) value = next;
    },
    removeItem(key: string) {
      if (key === DRAFT_KEY) value = null;
    },
  };
}
const failingStorage = (error: Error) => ({
  getItem() {
    throw error;
  },
  setItem() {
    throw error;
  },
  removeItem() {
    throw error;
  },
});
const domError = (message: string, name: string) =>
  new DOMException(message, name);

function projectWithMedia(count = 2): {
  project: ReturnType<typeof createProject>;
  media: Media[];
} {
  const project = createProject();
  const media: Media[] = Array.from({ length: count }, (_, i) => ({
    id: `media-${i + 1}`,
    name: `clip ${i + 1}.mp4`,
    kind: i % 2 ? "image" : "video",
    url: `blob:http://localhost/live-${i + 1}`,
  }));
  project.media = media;
  project.surfaces[0].source = media[0].id;
  return { project, media };
}

// ---------------------------------------------------------------- draft

test("a draft keeps media entries but never the blob URLs of the page that wrote it", () => {
  const { project } = projectWithMedia();
  const text = serializeDraft(project);
  assert.ok(!text.includes("blob:"), "blob URLs are session specific");
  const storage = memoryStorage(text);
  const read = readDraft(storage);
  assert.equal(read.kind, "ok");
  if (read.kind !== "ok") return;
  assert.deepEqual(read.project.media, [
    { id: "media-1", name: "clip 1.mp4", kind: "video", url: "" },
    { id: "media-2", name: "clip 2.mp4", kind: "image", url: "" },
  ]);
  assert.equal(read.project.surfaces[0].source, "media-1");
  // The in-memory project is untouched by serialising it.
  assert.equal(project.media[0].url, "blob:http://localhost/live-1");
});

test("reading a draft tells apart none, valid, invalid and unreadable storage", () => {
  assert.deepEqual(readDraft(memoryStorage(null)), { kind: "none" });
  assert.equal(readDraft(memoryStorage("{not json")).kind, "invalid");
  assert.equal(readDraft(memoryStorage('{"version":2}')).kind, "invalid");
  const dangling = projectWithMedia(1).project;
  dangling.media = [];
  assert.equal(
    readDraft(memoryStorage(JSON.stringify(dangling))).kind,
    "invalid",
    "a layer pointing at missing media is not a usable draft",
  );
  assert.equal(readDraft(null).kind, "unavailable");
  assert.equal(
    readDraft(failingStorage(domError("blocked", "SecurityError"))).kind,
    "unavailable",
  );
});

test("browsers restart with their draft and its media entries, desktop still starts clean", () => {
  const { project } = projectWithMedia();
  project.blackout = true;
  const stored = serializeDraft(project);

  const browser = readBootProject({ keepMedia: true }, memoryStorage(stored));
  assert.equal(browser.media.length, 2);
  assert.equal(browser.blackout, false, "never restart in blackout");
  assert.equal(
    browser.media.every((m) => m.url === ""),
    true,
  );
  assert.deepEqual(takeBootReferencedIds(), ["media-1", "media-2"]);
  assert.equal(takeBootReferencedIds(), null, "the list is handed out once");

  const desktop = readBootProject({ keepMedia: false }, memoryStorage(stored));
  assert.deepEqual(desktop.media, []);
  assert.equal(desktop.name, createProject().name);
  assert.equal(takeBootReferencedIds(), null);

  const plain = createProject();
  plain.name = "No media here";
  const desktopPlain = readBootProject(
    { keepMedia: false },
    memoryStorage(serializeDraft(plain)),
  );
  assert.equal(desktopPlain.name, "No media here");
});

test("an unreadable or empty draft never authorises deleting saved media", () => {
  for (const storage of [
    memoryStorage(null),
    memoryStorage("garbage"),
    failingStorage(domError("denied", "SecurityError")),
    null,
  ]) {
    const project = readBootProject({ keepMedia: true }, storage);
    assert.equal(project.media.length, 0);
    assert.equal(takeBootReferencedIds(), null);
  }
});

test("writing the draft reports quota and blocked storage instead of throwing", () => {
  const { project } = projectWithMedia();
  const storage = memoryStorage();
  assert.deepEqual(writeDraft(project, { keepMedia: true }, storage), {
    ok: true,
  });
  assert.ok(storage.peek()?.includes("media-1"));

  const quota = writeDraft(
    project,
    { keepMedia: true },
    failingStorage(domError("full", "QuotaExceededError")),
  );
  assert.equal(quota.ok, false);
  assert.equal(!quota.ok && quota.kind, "quota");
  const blocked = writeDraft(
    project,
    { keepMedia: true },
    failingStorage(domError("denied", "SecurityError")),
  );
  assert.equal(!blocked.ok && blocked.kind, "blocked");
  const missing = writeDraft(project, { keepMedia: true }, null);
  assert.equal(!missing.ok && missing.kind, "blocked");
  for (const kind of ["quota", "blocked"] as const)
    assert.match(describeDraftProblem(kind), /Save project/);
});

test("the desktop app keeps removing drafts that use media, as before", () => {
  const { project } = projectWithMedia();
  const storage = memoryStorage("old draft");
  assert.deepEqual(writeDraft(project, { keepMedia: false }, storage), {
    ok: true,
  });
  assert.equal(storage.peek(), null);
  const plain = createProject();
  writeDraft(plain, { keepMedia: false }, storage);
  assert.ok(storage.peek()?.includes('"surfaces"'));
});

test("clearing the draft removes it and reports whether storage was reachable", () => {
  const storage = memoryStorage("something");
  assert.equal(clearDraft(storage), true);
  assert.equal(storage.peek(), null);
  assert.equal(clearDraft(null), false);
  assert.equal(
    clearDraft(failingStorage(domError("x", "SecurityError"))),
    false,
  );
});

test("the media limit matches what the project validator accepts", () => {
  const project = createProject();
  const make = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      name: `file ${i}`,
      kind: "image" as const,
      url: "",
    }));
  project.media = make(MAX_MEDIA_FILES);
  assert.equal(validateBrowserProject(project).media.length, MAX_MEDIA_FILES);
  project.media = make(MAX_MEDIA_FILES + 1);
  assert.throws(() => validateBrowserProject(project));
});

test("media names are made valid for the project format", () => {
  assert.equal(sanitizeMediaName("holiday.png"), "holiday.png");
  assert.equal(sanitizeMediaName("a\u0000b\tc\u007f.png"), "a_b_c_.png");
  assert.equal(sanitizeMediaName("   "), "Untitled media");
  const long = `${"x".repeat(300)}.jpeg`;
  const cut = sanitizeMediaName(long);
  assert.equal(cut.length, 200);
  assert.ok(cut.endsWith(".jpeg"));
  const project = createProject();
  project.media = [{ id: "m", name: cut, kind: "image", url: "" }];
  assert.doesNotThrow(() => validateBrowserProject(project));
});

test("picked files become media entries with live URLs and valid names", () => {
  const files = [
    new File(["png"], "photo.png", { type: "image/png" }),
    new File(["mp4"], "clip.mp4", { type: "video/mp4" }),
    new File(["x"], `${"n".repeat(250)}.webm`, { type: "video/webm" }),
  ];
  let counter = 0;
  const imported = mediaFromFiles(
    files,
    (blob) => `blob:test/${(blob as File).name.slice(0, 5)}`,
    () => `id-${++counter}`,
  );
  assert.deepEqual(
    imported.map((i) => [i.media.id, i.media.kind, i.media.url]),
    [
      ["id-1", "image", "blob:test/photo"],
      ["id-2", "video", "blob:test/clip."],
      ["id-3", "video", "blob:test/nnnnn"],
    ],
  );
  assert.equal(imported[2].media.name.length, 200);
  assert.equal(imported[0].blob, files[0]);
  const project = createProject();
  project.media = imported.map((i) => ({ ...i.media, url: "" }));
  assert.doesNotThrow(() => validateBrowserProject(project));
});

test("a picked file with no type is decided by its name: video, picture, project or neither", () => {
  const kind = (name: string, type = "") => pickedFileKind({ name, type });
  // The type wins when the browser gives one.
  assert.equal(kind("a.bin", "video/mp4"), "video");
  assert.equal(kind("a.bin", "image/heic"), "image");
  assert.equal(kind("Clip.MOV", "video/quicktime; codecs=avc1"), "video");
  // Phones and some systems leave it empty.
  for (const name of ["clip.mp4", "Clip.MOV", "take.webm", "iphone.m4v"])
    assert.equal(kind(name), "video", name);
  for (const name of ["a.png", "Photo.JPG", "photo.jpeg", "x.WebP", ".png"])
    assert.equal(kind(name), "image", name);
  // A project file is not media, with or without a type.
  for (const [name, type] of [
    ["Show.prism.json", ""],
    ["Show.prism.json", "application/json"],
    ["show.JSON", ""],
    ["no extension", "application/json"],
  ])
    assert.equal(kind(name, type), "project", `${name} ${type}`);
  // Anything else is neither.
  for (const name of [
    "notes.txt",
    "scan.pdf",
    "png",
    "movie",
    "archive.zip",
    "",
  ])
    assert.equal(kind(name), "other", name);
  assert.equal(kind("report.pdf", "application/pdf"), "other");
  assert.equal(kind("clip.mov", "application/octet-stream"), "video");
});

test("picked files are sorted into media, project files and others, in order", () => {
  const files = [
    new File(["1"], "clip.mov", { type: "" }),
    new File(["2"], "Show.prism.json", { type: "" }),
    new File(["3"], "still.png", { type: "image/png" }),
    new File(["4"], "notes.txt", { type: "text/plain" }),
    new File(["5"], "b.webm", { type: "" }),
  ];
  const sorted = sortPickedFiles(files);
  assert.deepEqual(
    sorted.media.map((f) => f.name),
    ["clip.mov", "still.png", "b.webm"],
  );
  assert.deepEqual(
    sorted.projects.map((f) => f.name),
    ["Show.prism.json"],
  );
  assert.deepEqual(
    sorted.other.map((f) => f.name),
    ["notes.txt"],
  );
});

test("media from files with an empty type gets its kind from the name, not 'image'", () => {
  const imported = mediaFromFiles(
    [
      new File(["m"], "Holiday.MOV", { type: "" }),
      new File(["w"], "loop.webm", { type: "" }),
      new File(["p"], "poster.PNG", { type: "" }),
    ],
    () => "blob:x",
    (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  );
  assert.deepEqual(
    imported.map((i) => [i.media.name, i.media.kind]),
    [
      ["Holiday.MOV", "video"],
      ["loop.webm", "video"],
      ["poster.PNG", "image"],
    ],
  );
});

test("the message about refused files names them and points a project file to Open", () => {
  assert.equal(describeRefusedFiles([], []), null);
  assert.equal(
    describeRefusedFiles([{ name: "Show.prism.json" }], []),
    "“Show.prism.json” is a project file, so it was not added as media. Use Open to load it.",
  );
  assert.equal(
    describeRefusedFiles([], [{ name: "notes.txt" }]),
    "“notes.txt” is not a picture or a video that Prism Mapper can show (PNG, JPEG, WebP, MP4, WebM or MOV), so it was not added.",
  );
  const both = describeRefusedFiles(
    [{ name: "a.prism.json" }, { name: "b.prism.json" }, { name: "c.json" }],
    [{ name: "x.txt" }, { name: "y.pdf" }],
  );
  assert.match(
    both ?? "",
    /^“a.prism.json”, “b.prism.json” and 1 more are project files, so they were not added as media. Use Open to load one\./,
  );
  assert.match(
    both ?? "",
    /“x.txt” and “y.pdf” are not pictures or videos that Prism Mapper can show/,
  );
  assert.doesNotMatch(both ?? "", /[\u2013\u2014]/);
});

// ---------------------------------------------------------------- errors

test("storage exceptions are sorted into quota, unavailable and other", () => {
  const cases: [unknown, string][] = [
    [domError("The quota has been exceeded", "QuotaExceededError"), "quota"],
    [{ name: "NS_ERROR_DOM_QUOTA_REACHED" }, "quota"],
    [{ code: 22 }, "quota"],
    [new Error("Quota exceeded for this origin"), "quota"],
    [domError("denied", "SecurityError"), "unavailable"],
    [
      domError(
        "A mutation operation was attempted on a database that did not allow mutations",
        "InvalidStateError",
      ),
      "unavailable",
    ],
    [new Error("IndexedDB is not available in this browser."), "unavailable"],
    [domError("odd", "UnknownError"), "failed"],
    [null, "failed"],
    ["text", "failed"],
  ];
  for (const [error, expected] of cases)
    assert.equal(classifyStorageError(error), expected, String(error));
});

// ---------------------------------------------------------------- saved media

class MemoryBackend implements MediaBackend {
  records = new Map<string, { record: MediaRecord; blob: Blob }>();
  puts = 0;
  failPut?: (record: MediaRecord) => Error | undefined;
  failGet?: (id: string) => Error | undefined;
  async list() {
    return [...this.records.values()].map((entry) => entry.record);
  }
  async get(id: string) {
    const error = this.failGet?.(id);
    if (error) throw error;
    return this.records.get(id)?.blob;
  }
  async put(record: MediaRecord, blob: Blob) {
    this.puts++;
    const error = this.failPut?.(record);
    if (error) throw error;
    this.records.set(record.id, { record, blob });
  }
  async remove(ids: string[]) {
    for (const id of ids) this.records.delete(id);
  }
  async clear() {
    this.records.clear();
  }
}
const blobOf = (size: number, type = "image/png") =>
  new Blob([new Uint8Array(size)], { type });
const request = (id: string, size: number, name = `${id}.png`) => ({
  id,
  name,
  kind: "image" as const,
  blob: blobOf(size),
});
const urlFor = (blob: Blob) => `blob:test/${blob.size}`;
function library(limit = 1000) {
  const backend = new MemoryBackend();
  const saved = new SavedMedia(async () => backend, {
    limit,
    createUrl: urlFor,
    now: () => 1700000000000,
  });
  return { backend, saved };
}

test("the default limit is 500 MB and is shown in friendly units", () => {
  assert.equal(MAX_SAVED_MEDIA_BYTES, 500 * 1024 * 1024);
  assert.equal(formatBytes(MAX_SAVED_MEDIA_BYTES), "500 MB");
  assert.equal(formatBytes(0), "0 KB");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(1.5 * 1024 * 1024), "1.5 MB");
  assert.equal(formatBytes(1536 * 1024 * 1024), "1.5 GB");
  assert.equal(
    new SavedMedia(async () => new MemoryBackend()).limit,
    MAX_SAVED_MEDIA_BYTES,
  );
});

test("saved media stores Blobs by id and reports usage", async () => {
  const { backend, saved } = library();
  const result = await saved.save([request("a", 300), request("b", 200)]);
  assert.deepEqual(result, { saved: ["a", "b"], skipped: [] });
  assert.equal(backend.records.get("a")?.record.size, 300);
  assert.equal(backend.records.get("a")?.record.type, "image/png");
  assert.equal(backend.records.get("a")?.record.savedAt, 1700000000000);
  assert.deepEqual(await saved.usage(), {
    available: true,
    count: 2,
    bytes: 500,
    limit: 1000,
  });
});

test("saving stops at the size limit and says which files were left out", async () => {
  const { backend, saved } = library(1000);
  let result = await saved.save([request("a", 600), request("b", 400)]);
  assert.deepEqual(result.saved, ["a", "b"], "exactly the limit still fits");
  result = await saved.save([request("c", 1)]);
  assert.deepEqual(result.saved, []);
  assert.deepEqual(result.skipped, [
    { id: "c", name: "c.png", reason: "limit" },
  ]);
  assert.equal(backend.records.has("c"), false);
  // One oversized file does not block the smaller ones after it.
  const fresh = library(1000);
  result = await fresh.saved.save([request("big", 5000), request("small", 10)]);
  assert.deepEqual(result.saved, ["small"]);
  assert.deepEqual(
    result.skipped.map((s) => [s.id, s.reason]),
    [["big", "limit"]],
  );
});

test("replacing a stored file does not count it twice", async () => {
  const { saved } = library(1000);
  await saved.save([request("a", 900)]);
  const result = await saved.save([request("a", 950)]);
  assert.deepEqual(result.saved, ["a"]);
  assert.equal((await saved.usage()).bytes, 950);
});

test("overlapping saves are counted one after another, never together", async () => {
  const { saved } = library(1000);
  const [first, second] = await Promise.all([
    saved.save([request("a", 600)]),
    saved.save([request("b", 600)]),
  ]);
  assert.deepEqual(first.saved, ["a"]);
  assert.deepEqual(second.saved, []);
  assert.equal(second.skipped[0].reason, "limit");
  assert.ok((await saved.usage()).bytes <= 1000);
});

test("a full browser store skips only the file that failed and names the reason", async () => {
  const { backend, saved } = library();
  backend.failPut = (record) =>
    record.id === "b" ? domError("no space", "QuotaExceededError") : undefined;
  const result = await saved.save([
    request("a", 10),
    request("b", 10),
    request("c", 10),
  ]);
  assert.deepEqual(result.saved, ["a", "c"]);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "quota");
  assert.match(describeSkipped(result.skipped)!, /out of storage space/);
});

test("storage that cannot open (private browsing) keeps the app working and says why", async () => {
  const saved = new SavedMedia(async () => {
    throw domError("blocked", "SecurityError");
  });
  const result = await saved.save([request("a", 10), request("b", 10)]);
  assert.deepEqual(result.saved, []);
  assert.deepEqual(
    result.skipped.map((s) => s.reason),
    ["unavailable", "unavailable"],
  );
  assert.equal((await saved.usage()).available, false);
  const restored = await saved.restore([
    { id: "a", name: "a.png", kind: "image", url: "" },
  ]);
  assert.equal(restored.unavailable, true);
  assert.equal(restored.missing.length, 1);
  assert.equal(await saved.collectGarbage([]), 0);
  assert.match(describeSkipped(result.skipped)!, /not keeping files/);
});

test("restoring rebuilds URLs only for Blobs that still exist", async () => {
  const { backend, saved } = library();
  await saved.save([request("a", 11), request("c", 33)]);
  const media: Media[] = [
    { id: "a", name: "a.png", kind: "image", url: "" },
    { id: "b", name: "b.png", kind: "image", url: "" },
    { id: "c", name: "c.png", kind: "image", url: "blob:already-live" },
    { id: "d", name: "d.mp4", kind: "video", url: "" },
  ];
  backend.failGet = (id) => (id === "d" ? new Error("unreadable") : undefined);
  const result = await saved.restore(media);
  assert.deepEqual([...result.urls], [["a", "blob:test/11"]]);
  assert.deepEqual(
    result.missing.map((m) => m.id),
    ["b", "d"],
    "media with no stored file stays in the list, dark, in project order",
  );
  assert.equal(result.unavailable, false);
  const nothing = await saved.restore([media[2]]);
  assert.equal(nothing.urls.size, 0);
  assert.equal(nothing.missing.length, 0);
});

test("a store that opens lazily but refuses every read is reported as blocked, not as lost files", async () => {
  const { backend, saved } = library();
  await saved.save([request("a", 11), request("b", 22)]);
  const media: Media[] = [
    { id: "a", name: "a.png", kind: "image", url: "" },
    { id: "b", name: "b.png", kind: "image", url: "" },
  ];
  backend.failGet = () =>
    domError("The operation is insecure.", "SecurityError");
  const blocked = await saved.restore(media);
  assert.equal(blocked.unavailable, true);
  assert.deepEqual(
    blocked.missing.map((m) => m.id),
    ["a", "b"],
  );
  assert.match(
    describeMissing(blocked.missing, blocked.unavailable),
    /blocking site storage/,
  );
  // A read that merely fails for another reason is still just a missing file.
  backend.failGet = () => new Error("corrupt record");
  const corrupt = await saved.restore(media);
  assert.equal(corrupt.unavailable, false);
  assert.equal(corrupt.missing.length, 2);
  // And one blocked read among good ones keeps the good ones.
  backend.failGet = (id) =>
    id === "b" ? domError("denied", "NotAllowedError") : undefined;
  const mixed = await saved.restore(media);
  assert.deepEqual([...mixed.urls], [["a", "blob:test/11"]]);
  assert.equal(mixed.unavailable, true);
});

test("cleanup removes only Blobs that no project refers to", async () => {
  const { backend, saved } = library();
  await saved.save([
    request("keep", 10),
    request("old1", 10),
    request("old2", 10),
  ]);
  assert.equal(await saved.collectGarbage(["keep", "never-stored"]), 2);
  assert.deepEqual([...backend.records.keys()], ["keep"]);
  assert.equal(await saved.collectGarbage(["keep"]), 0);
  assert.equal(await saved.collectGarbage([]), 1);
  assert.equal(backend.records.size, 0);
});

test("cleanup decides what to keep when it runs, after the saves queued before it", async () => {
  const { backend, saved } = library();
  await saved.save([request("early", 10)]);
  // The page is still starting: the cleanup is queued behind a save, and the
  // person imports one more file before either of them runs.
  const keep = new Set(["early"]);
  const saving = saved.save([request("late", 10)]);
  const cleaning = saved.collectGarbage(() => keep);
  keep.add("late");
  await saving;
  assert.equal(await cleaning, 0);
  assert.deepEqual([...backend.records.keys()].sort(), ["early", "late"]);
});

test("a cleanup that cannot say what to keep removes nothing", async () => {
  const { backend, saved } = library();
  await saved.save([request("a", 10), request("b", 10)]);
  assert.equal(await saved.collectGarbage(() => null), 0);
  assert.equal(backend.records.size, 2);
});

test("the start-up cleanup keeps what the draft names now, what is open and what this page saved", () => {
  const draftNaming = (...ids: string[]) => {
    const project = createProject();
    project.media = ids.map((id) => ({
      id,
      name: `${id}.png`,
      kind: "image" as const,
      url: "",
    }));
    project.surfaces[0].source = ids[0] ?? "aurora";
    return readDraft(memoryStorage(serializeDraft(project)));
  };
  const keep = (draft: ReturnType<typeof draftNaming>) =>
    mediaIdsToKeep(
      ["at-start"],
      [{ id: "open" }],
      new Set(["imported-here"]),
      draft,
    )?.sort();
  assert.deepEqual(keep(draftNaming("other-tab")), [
    "at-start",
    "imported-here",
    "open",
    "other-tab",
  ]);
  assert.deepEqual(keep({ kind: "none" }), [
    "at-start",
    "imported-here",
    "open",
  ]);
  // A draft that cannot be read says nothing about what is wanted.
  assert.equal(keep({ kind: "invalid" }), undefined);
  assert.equal(keep({ kind: "unavailable" }), undefined);
});

test("files imported while the page starts, and files another tab saved, survive the cleanup", async () => {
  const { backend, saved } = library();
  // Saved by earlier visits: one still in the draft, one nothing uses.
  await saved.save([request("in-draft", 10), request("orphan", 10)]);
  const atStart = ["in-draft"];
  const imported = ["imported-here"];
  const project = createProject();
  project.media = [{ id: "from-tab-b", name: "b.png", kind: "image", url: "" }];
  project.surfaces[0].source = "from-tab-b";
  const draft = readDraft(memoryStorage(serializeDraft(project)));
  await saved.save([request("imported-here", 10), request("from-tab-b", 10)]);
  const removed = await saved.collectGarbage(() =>
    mediaIdsToKeep(atStart, [], imported, draft),
  );
  assert.equal(removed, 1);
  assert.deepEqual([...backend.records.keys()].sort(), [
    "from-tab-b",
    "imported-here",
    "in-draft",
  ]);
});

test("a change to the draft made by another tab is recognised, nothing else is", () => {
  const storage = memoryStorage();
  assert.equal(
    isDraftChangedElsewhere({ key: DRAFT_KEY, storageArea: storage }, storage),
    true,
  );
  assert.equal(
    isDraftChangedElsewhere(
      { key: "other-key", storageArea: storage },
      storage,
    ),
    false,
  );
  assert.equal(
    isDraftChangedElsewhere({ key: null, storageArea: storage }, storage),
    false,
  );
  // sessionStorage and other areas are not the autosaved draft.
  assert.equal(
    isDraftChangedElsewhere(
      { key: DRAFT_KEY, storageArea: memoryStorage() },
      storage,
    ),
    false,
  );
  assert.equal(
    isDraftChangedElsewhere({ key: DRAFT_KEY, storageArea: null }, null),
    false,
  );
  const text = describeSharedDraft();
  assert.match(text, /another tab or window/);
  assert.match(text, /Save project/);
  assert.doesNotMatch(text, /[–—]/, "no em or en dashes in user text");
});

test("clearing removes every Blob and recovers from an earlier failed open", async () => {
  const backend = new MemoryBackend();
  let attempts = 0;
  const saved = new SavedMedia(async () => {
    if (++attempts === 1) throw domError("blocked", "SecurityError");
    return backend;
  });
  assert.equal((await saved.save([request("a", 10)])).saved.length, 0);
  await backend.put(
    { id: "x", name: "x", kind: "image", type: "", size: 1, savedAt: 0 },
    blobOf(1),
  );
  await saved.clear();
  assert.equal(backend.records.size, 0);
  assert.equal(attempts, 2);
  const failing = new SavedMedia(async () => {
    throw domError("blocked", "SecurityError");
  });
  await assert.rejects(failing.clear());
});

// ---------------------------------------------------------------- IndexedDB

test("without IndexedDB the real backend refuses to open and the app carries on", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    await assert.rejects(openIndexedDbBackend(), (error: Error) => {
      assert.equal(classifyStorageError(error), "unavailable");
      return true;
    });
    const saved = new SavedMedia(openIndexedDbBackend);
    const result = await saved.save([request("a", 10)]);
    assert.equal(result.skipped[0].reason, "unavailable");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else delete (globalThis as Record<string, unknown>).indexedDB;
  }
});

// ---------------------------------------------------------------- wording

test("messages name the files, give the limit and avoid dashes", () => {
  const skipped = [
    { id: "1", name: "big.mp4", reason: "limit" as const },
    { id: "2", name: "huge.mov", reason: "limit" as const },
    { id: "3", name: "third.mp4", reason: "limit" as const },
  ];
  const limitText = describeSkipped(skipped)!;
  assert.match(limitText, /“big\.mp4”, “huge\.mov” and 1 more were not saved/);
  assert.match(limitText, /500 MB/);
  assert.match(limitText, /Clear saved draft and media/);
  assert.equal(describeSkipped([]), null);
  const single = describeSkipped([
    { id: "1", name: "a.png", reason: "failed", detail: "weird" },
  ])!;
  assert.match(single, /“a\.png” could not be saved for next time \(weird\)/);
  const mixed = describeSkipped([
    skipped[0],
    { id: "4", name: "d.png", reason: "quota" },
  ])!;
  assert.match(mixed, /500 MB/);
  assert.match(mixed, /out of storage space/);
  const media: Media[] = [
    { id: "1", name: "one.png", kind: "image", url: "" },
    { id: "2", name: "two.png", kind: "image", url: "" },
  ];
  const missing = [
    describeMissing(media.slice(0, 1), false),
    describeMissing(media, false),
    describeMissing(media, true),
  ];
  assert.match(missing[0], /“one\.png” is no longer saved/);
  assert.match(missing[1], /“one\.png” and “two\.png” are no longer saved/);
  assert.match(missing[2], /blocking site storage/);
  for (const text of [limitText, single, mixed, ...missing])
    assert.doesNotMatch(text, /[–—]/, "no em or en dashes in user text");
});

test("surfaces in a restored draft keep pointing at their media", () => {
  const { project } = projectWithMedia(2);
  project.surfaces.push({ ...newSurface(1), source: "media-2" });
  const read = readDraft(memoryStorage(serializeDraft(project)));
  assert.equal(read.kind, "ok");
  if (read.kind === "ok")
    assert.deepEqual(
      read.project.surfaces.map((s) => s.source),
      ["media-1", "media-2"],
    );
});
