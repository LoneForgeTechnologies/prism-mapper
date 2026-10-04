/**
 * Device-safe persistence for the browser, installed web app and mobile shells.
 *
 * Phones close pages in the background without warning. To survive that, the
 * project draft stays in localStorage (small, synchronous, written on every
 * change) and imported media Blobs live in IndexedDB, keyed by media id. When
 * the app starts again the blob: URLs are rebuilt from the stored Blobs.
 *
 * Nothing here ever throws into the editor. A storage failure becomes a
 * friendly message and the in-memory project keeps working.
 */
import { newId } from "./compat";
import { createProject, type Media, type Project } from "./model";
import { portableProject, validateBrowserProject } from "./project-validation";

/** localStorage key of the autosaved draft. Existing drafts keep loading. */
export const DRAFT_KEY = "prism-draft";
/** Most imported media kept on the device. Larger imports still work for the session. */
export const MAX_SAVED_MEDIA_BYTES = 500 * 1024 * 1024;
/** Most media entries a project may hold. validateBrowserProject enforces the same number. */
export const MAX_MEDIA_FILES = 256;
const DB_NAME = "prism-mapper";
const DB_VERSION = 1;
const BLOBS = "media-blobs";
const META = "media-meta";

// Failures ------------------------------------------------------------------

export type StorageFailure = "quota" | "unavailable" | "failed";

/** Sort a storage exception into something a person can act on. */
export function classifyStorageError(error: unknown): StorageFailure {
  const e = error as { name?: string; code?: number; message?: string } | null;
  const name = e?.name ?? "";
  const message = typeof e?.message === "string" ? e.message : "";
  if (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e?.code === 22 ||
    e?.code === 1014 ||
    /quota/i.test(message)
  )
    return "quota";
  if (
    name === "SecurityError" ||
    name === "InvalidStateError" ||
    name === "NotSupportedError" ||
    name === "NotAllowedError" ||
    /unavailable|not available|private|blocked|denied|disabled/i.test(message)
  )
    return "unavailable";
  return "failed";
}

const errorText = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : String((error as { message?: unknown } | null)?.message ?? error);

// Draft (localStorage) ------------------------------------------------------

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function localStore(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The draft as stored text. Blob URLs belong to one page load, so they are never saved. */
export function serializeDraft(project: Project): string {
  return JSON.stringify(portableProject(project));
}

export type DraftRead =
  | { kind: "none" }
  | { kind: "ok"; project: Project }
  | { kind: "invalid" }
  | { kind: "unavailable" };

/** Read and fully validate the autosaved draft. */
export function readDraft(
  storage: StorageLike | null = localStore(),
): DraftRead {
  let text: string | null;
  try {
    if (!storage) return { kind: "unavailable" };
    text = storage.getItem(DRAFT_KEY);
  } catch {
    return { kind: "unavailable" };
  }
  if (text === null) return { kind: "none" };
  try {
    return { kind: "ok", project: validateBrowserProject(JSON.parse(text)) };
  } catch {
    return { kind: "invalid" };
  }
}

let bootReferenced: string[] | null = null;
/**
 * The project to start with. `keepMedia` is true wherever media can be rebuilt
 * from IndexedDB. The desktop app cannot (its media links are per session), so
 * it still discards drafts that use media, exactly as before.
 */
export function readBootProject(
  options: { keepMedia: boolean },
  storage: StorageLike | null = localStore(),
): Project {
  const read = readDraft(storage);
  // Only a draft we could read in full tells us which stored media is still wanted.
  bootReferenced =
    options.keepMedia && read.kind === "ok"
      ? read.project.media.map((m) => m.id)
      : null;
  if (read.kind === "ok" && (options.keepMedia || !read.project.media.length))
    return { ...read.project, blackout: false };
  return createProject();
}
/** Media ids the starting draft refers to, or null when stored media must not be cleaned up. Read once. */
export function takeBootReferencedIds(): string[] | null {
  const ids = bootReferenced;
  bootReferenced = null;
  return ids;
}

/**
 * Media ids the start-up cleanup must keep. The page may have imported files,
 * and another tab may have changed the draft, since this page started, so the
 * answer is made when the cleanup runs: what the draft named at the start, what
 * it names now, what the open project uses and what this page has saved. Null
 * means skip the cleanup, because a draft that cannot be read says nothing
 * about which files are still wanted.
 */
export function mediaIdsToKeep(
  atStart: readonly string[],
  inUse: readonly { id: string }[],
  savedHere: Iterable<string>,
  draft: DraftRead = readDraft(),
): string[] | null {
  if (draft.kind === "invalid" || draft.kind === "unavailable") return null;
  return [
    ...atStart,
    ...inUse.map((media) => media.id),
    ...savedHere,
    ...(draft.kind === "ok" ? draft.project.media.map((m) => m.id) : []),
  ];
}

/**
 * A storage event is only ever sent to the other tabs and windows of the site.
 * This one says that one of them saved the draft this page also autosaves.
 */
export function isDraftChangedElsewhere(
  event: { key: string | null; storageArea: unknown },
  storage: unknown = localStore(),
): boolean {
  return (
    event.key === DRAFT_KEY && storage !== null && event.storageArea === storage
  );
}

export type DraftWrite =
  { ok: true } | { ok: false; kind: "quota" | "blocked"; error: unknown };

/** Save the draft. Never throws; a failure is returned so the app can say so once. */
export function writeDraft(
  project: Project,
  options: { keepMedia: boolean },
  storage: StorageLike | null = localStore(),
): DraftWrite {
  try {
    if (!storage)
      throw Object.assign(new Error("Storage unavailable"), {
        name: "SecurityError",
      });
    if (!options.keepMedia && project.media.length)
      storage.removeItem(DRAFT_KEY);
    else storage.setItem(DRAFT_KEY, serializeDraft(project));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      kind: classifyStorageError(error) === "quota" ? "quota" : "blocked",
      error,
    };
  }
}

export function clearDraft(
  storage: StorageLike | null = localStore(),
): boolean {
  try {
    storage?.removeItem(DRAFT_KEY);
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function describeDraftProblem(kind: "quota" | "blocked"): string {
  return kind === "quota"
    ? "This browser has no room left to autosave your work. Keep this page open and use Save project to keep a copy."
    : "This browser is blocking autosave (private browsing or blocked site data). Your work stays on screen, so use Save project before you close the page.";
}

/** Said once when another tab or window saves the draft: they share one, and the last change wins. */
export function describeSharedDraft(): string {
  return "Prism Mapper is also open in another tab or window. Both autosave to the same draft, so after a reload you get whichever one you changed last. Work in one at a time, and use Save project to keep a copy.";
}

// Importing files -----------------------------------------------------------

/** A media name the project format accepts: no control characters, at most 200 characters. */
export function sanitizeMediaName(name: string): string {
  const clean =
    name.replace(/[\u0000-\u001f\u007f]/g, "_").trim() || "Untitled media";
  if (clean.length <= 200) return clean;
  const dot = clean.lastIndexOf(".");
  const extension = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : "";
  return clean.slice(0, 200 - extension.length) + extension;
}

export type PickedKind = "image" | "video" | "project" | "other";
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
/**
 * What a picked file is: a picture or a video by its type, or by the end of its
 * name when the browser left the type empty (phones and some systems do for
 * .mov and .webm). A project file (.prism.json) and anything else is not media.
 */
export function pickedFileKind(file: {
  name: string;
  type: string;
}): PickedKind {
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  const name = file.name.toLowerCase();
  if (
    type === "application/json" ||
    type === "text/json" ||
    name.endsWith(".json")
  )
    return "project";
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot + 1) : "";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  return "other";
}

/** Picked files, split into those that can be media and those that cannot. */
export function sortPickedFiles(files: readonly File[]) {
  const sorted = {
    media: [] as File[],
    projects: [] as File[],
    other: [] as File[],
  };
  for (const file of files) {
    const kind = pickedFileKind(file);
    if (kind === "project") sorted.projects.push(file);
    else if (kind === "other") sorted.other.push(file);
    else sorted.media.push(file);
  }
  return sorted;
}

export interface ImportedFile {
  media: Media;
  blob: Blob;
}
/** Turn picked files into media entries with a live blob: URL for this page load. */
export function mediaFromFiles(
  files: readonly File[],
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
  createId: () => string = () => newId(),
): ImportedFile[] {
  return files.map((file) => ({
    blob: file,
    media: {
      id: createId(),
      name: sanitizeMediaName(file.name),
      kind: pickedFileKind(file) === "video" ? "video" : "image",
      url: createUrl(file),
    },
  }));
}

// Saved media ---------------------------------------------------------------

export interface MediaRecord {
  id: string;
  name: string;
  kind: "image" | "video";
  type: string;
  size: number;
  savedAt: number;
}
/** Where saved media physically lives. IndexedDB in the app, a Map in the tests. */
export interface MediaBackend {
  list(): Promise<MediaRecord[]>;
  get(id: string): Promise<Blob | undefined>;
  put(record: MediaRecord, blob: Blob): Promise<void>;
  remove(ids: string[]): Promise<void>;
  clear(): Promise<void>;
}
export interface SaveRequest {
  id: string;
  name: string;
  kind: "image" | "video";
  blob: Blob;
}
export type SkipReason = "limit" | StorageFailure;
export interface SkippedMedia {
  id: string;
  name: string;
  reason: SkipReason;
  detail?: string;
}
export interface SaveResult {
  saved: string[];
  skipped: SkippedMedia[];
}
export interface RestoreResult {
  /** blob: URL for every media id whose Blob was found. */
  urls: Map<string, string>;
  /** Entries whose Blob is gone. They stay in the project, dark, until the file is imported again. */
  missing: Media[];
  /** True when storage could not be opened at all. */
  unavailable: boolean;
}
export interface SavedMediaUsage {
  available: boolean;
  count: number;
  bytes: number;
  limit: number;
}

export class SavedMedia {
  readonly limit: number;
  private backendPromise?: Promise<MediaBackend>;
  private backendFailed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private persistenceAsked = false;
  constructor(
    private open: () => Promise<MediaBackend>,
    private options: {
      limit?: number;
      createUrl?: (blob: Blob) => string;
      now?: () => number;
    } = {},
  ) {
    this.limit = options.limit ?? MAX_SAVED_MEDIA_BYTES;
  }

  private backend(): Promise<MediaBackend> {
    if (!this.backendPromise) {
      this.backendPromise = this.open().catch((error) => {
        this.backendFailed = true;
        throw error;
      });
    }
    return this.backendPromise;
  }
  /** One storage job at a time, so size accounting and cleanup never interleave. */
  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  usage(): Promise<SavedMediaUsage> {
    return this.exclusive(async () => {
      try {
        const records = await (await this.backend()).list();
        return {
          available: true,
          count: records.length,
          bytes: records.reduce((sum, r) => sum + r.size, 0),
          limit: this.limit,
        };
      } catch {
        return { available: false, count: 0, bytes: 0, limit: this.limit };
      }
    });
  }

  /** Store Blobs, stopping short of the size limit. Never throws; skipped files say why. */
  save(requests: readonly SaveRequest[]): Promise<SaveResult> {
    return this.exclusive(async () => {
      const result: SaveResult = { saved: [], skipped: [] };
      if (!requests.length) return result;
      let backend: MediaBackend;
      let sizes: Map<string, number>;
      try {
        backend = await this.backend();
        sizes = new Map((await backend.list()).map((r) => [r.id, r.size]));
      } catch (error) {
        const reason = classifyStorageError(error);
        for (const r of requests)
          result.skipped.push({
            id: r.id,
            name: r.name,
            reason,
            detail: errorText(error),
          });
        return result;
      }
      let used = [...sizes.values()].reduce((a, b) => a + b, 0);
      for (const request of requests) {
        const size = request.blob.size;
        const replaced = sizes.get(request.id) ?? 0;
        if (used - replaced + size > this.limit) {
          result.skipped.push({
            id: request.id,
            name: request.name,
            reason: "limit",
          });
          continue;
        }
        try {
          await backend.put(
            {
              id: request.id,
              name: request.name,
              kind: request.kind,
              type: request.blob.type,
              size,
              savedAt: (this.options.now ?? Date.now)(),
            },
            request.blob,
          );
          used += size - replaced;
          sizes.set(request.id, size);
          result.saved.push(request.id);
        } catch (error) {
          result.skipped.push({
            id: request.id,
            name: request.name,
            reason: classifyStorageError(error),
            detail: errorText(error),
          });
        }
      }
      if (result.saved.length) void this.requestPersistence();
      return result;
    });
  }

  /** Rebuild blob: URLs for media entries that have none yet. */
  restore(media: readonly Media[]): Promise<RestoreResult> {
    return this.exclusive(async () => {
      const urls = new Map<string, string>();
      const wanted = media.filter((m) => !m.url);
      if (!wanted.length) return { urls, missing: [], unavailable: false };
      let backend: MediaBackend;
      try {
        backend = await this.backend();
      } catch {
        return { urls, missing: [...wanted], unavailable: true };
      }
      const createUrl =
        this.options.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
      const found = new Set<string>();
      let unavailable = false;
      await Promise.all(
        wanted.map(async (m) => {
          try {
            const blob = await backend.get(m.id);
            if (blob) {
              urls.set(m.id, createUrl(blob));
              found.add(m.id);
            }
          } catch (error) {
            // An unreadable Blob is handled like a missing one. The database
            // connects on first use, so a browser that blocks storage shows up
            // here and is reported as blocked rather than as lost files.
            if (classifyStorageError(error) === "unavailable")
              unavailable = true;
          }
        }),
      );
      return {
        urls,
        missing: wanted.filter((m) => !found.has(m.id)),
        unavailable,
      };
    });
  }

  /**
   * Delete stored Blobs that no project refers to. Returns how many were removed.
   *
   * `referenced` may be a function. It is then called when the job runs, after
   * the Blobs have been listed and after every save queued before this job, so
   * files imported while the page was still starting up are not mistaken for
   * leftovers. A function that returns null cancels the cleanup.
   */
  collectGarbage(
    referenced: Iterable<string> | (() => Iterable<string> | null),
  ): Promise<number> {
    return this.exclusive(async () => {
      try {
        const backend = await this.backend();
        const records = await backend.list();
        const wanted =
          typeof referenced === "function" ? referenced() : referenced;
        if (!wanted) return 0;
        const keep = new Set(wanted);
        const stale = records.filter((r) => !keep.has(r.id)).map((r) => r.id);
        if (stale.length) await backend.remove(stale);
        return stale.length;
      } catch {
        return 0;
      }
    });
  }

  /** Remove every stored Blob. Rejects when storage cannot be cleared. */
  clear(): Promise<void> {
    return this.exclusive(async () => {
      if (this.backendFailed) {
        this.backendPromise = undefined;
        this.backendFailed = false;
      }
      await (await this.backend()).clear();
    });
  }

  /** Ask the browser not to evict our data under storage pressure. Best effort, asked once. */
  private async requestPersistence() {
    if (this.persistenceAsked) return;
    this.persistenceAsked = true;
    try {
      const storage = globalThis.navigator?.storage;
      if (storage?.persist && !(await storage.persisted?.()))
        await storage.persist();
    } catch {
      // Persistence is a bonus, never a requirement.
    }
  }
}

// IndexedDB backend ---------------------------------------------------------

class IndexedDbBackend implements MediaBackend {
  private db?: Promise<IDBDatabase>;
  constructor(private factory: IDBFactory) {}

  private connect(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        let request: IDBOpenDBRequest;
        try {
          request = this.factory.open(DB_NAME, DB_VERSION);
        } catch (error) {
          reject(error);
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
          if (!db.objectStoreNames.contains(META))
            db.createObjectStore(META, { keyPath: "id" });
        };
        request.onsuccess = () => {
          const db = request.result;
          // Let another tab upgrade the database, and reconnect on the next use.
          db.onversionchange = () => {
            db.close();
            this.db = undefined;
          };
          db.onclose = () => {
            this.db = undefined;
          };
          resolve(db);
        };
        request.onerror = () =>
          reject(
            request.error ?? new Error("Saved media storage is unavailable."),
          );
        request.onblocked = () =>
          reject(
            new Error(
              "Saved media storage is blocked by another Prism Mapper tab.",
            ),
          );
      }).catch((error) => {
        this.db = undefined;
        throw error;
      });
    }
    return this.db;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    work: (stores: {
      blobs: IDBObjectStore;
      meta: IDBObjectStore;
    }) => IDBRequest<T> | void,
    durability?: IDBTransactionDurability,
  ): Promise<T | undefined> {
    const db = await this.connect();
    return new Promise<T | undefined>((resolve, reject) => {
      let tx: IDBTransaction;
      let request: IDBRequest<T> | void;
      try {
        tx = db.transaction(
          [BLOBS, META],
          mode,
          durability ? { durability } : undefined,
        );
        request = work({
          blobs: tx.objectStore(BLOBS),
          meta: tx.objectStore(META),
        });
      } catch (error) {
        this.db = undefined;
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onabort = () =>
        reject(
          tx.error ??
            (request ? request.error : null) ??
            new DOMException(
              "The saved media storage was interrupted.",
              "AbortError",
            ),
        );
    });
  }

  async list() {
    return (
      (await this.run<MediaRecord[]>("readonly", ({ meta }) =>
        meta.getAll(),
      )) ?? []
    );
  }
  get(id: string) {
    return this.run<Blob | undefined>("readonly", ({ blobs }) =>
      blobs.get(id),
    ) as Promise<Blob | undefined>;
  }
  async put(record: MediaRecord, blob: Blob) {
    await this.run(
      "readwrite",
      ({ blobs, meta }) => {
        blobs.put(blob, record.id);
        meta.put(record);
      },
      "strict",
    );
  }
  async remove(ids: string[]) {
    await this.run("readwrite", ({ blobs, meta }) => {
      for (const id of ids) {
        blobs.delete(id);
        meta.delete(id);
      }
    });
  }
  async clear() {
    await this.run("readwrite", ({ blobs, meta }) => {
      blobs.clear();
      meta.clear();
    });
  }
}

/** The real saved-media store for this browser. Rejects where IndexedDB does not exist. */
export function openIndexedDbBackend(): Promise<MediaBackend> {
  let factory: IDBFactory | undefined;
  try {
    factory = globalThis.indexedDB;
  } catch {
    factory = undefined;
  }
  if (!factory)
    return Promise.reject(
      Object.assign(new Error("IndexedDB is not available in this browser."), {
        name: "NotSupportedError",
      }),
    );
  return Promise.resolve(new IndexedDbBackend(factory));
}

// Messages ------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (mb < 1024)
    return `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function nameList(names: string[]): string {
  const quoted = names.slice(0, 2).map((n) => `“${n}”`);
  const extra = names.length - quoted.length;
  return extra > 0
    ? `${quoted.join(", ")} and ${extra} more`
    : quoted.join(" and ");
}

/** What to tell the person about picked files that are not pictures or videos, or null when all were. */
export function describeRefusedFiles(
  projects: readonly { name: string }[],
  other: readonly { name: string }[],
): string | null {
  const sentences: string[] = [];
  if (projects.length) {
    const many = projects.length > 1;
    sentences.push(
      `${nameList(projects.map((f) => f.name))} ${many ? "are project files" : "is a project file"}, so ${many ? "they were" : "it was"} not added as media. Use Open to load ${many ? "one" : "it"}.`,
    );
  }
  if (other.length) {
    const many = other.length > 1;
    sentences.push(
      `${nameList(other.map((f) => f.name))} ${many ? "are not pictures or videos" : "is not a picture or a video"} that Prism Mapper can show (PNG, JPEG, WebP, MP4, WebM or MOV), so ${many ? "they were" : "it was"} not added.`,
    );
  }
  return sentences.length ? sentences.join(" ") : null;
}

/** One friendly message for files that could not be stored, or null when all were. */
export function describeSkipped(
  skipped: readonly SkippedMedia[],
  limit: number = MAX_SAVED_MEDIA_BYTES,
): string | null {
  if (!skipped.length) return null;
  const reasonOf = (reason: SkipReason) =>
    skipped.filter((s) => s.reason === reason);
  const sentences: string[] = [];
  for (const reason of ["limit", "quota", "unavailable", "failed"] as const) {
    const group = reasonOf(reason);
    if (!group.length) continue;
    const many = group.length > 1;
    const names = nameList(group.map((s) => s.name));
    const stays = `${many ? "They" : "It"} will still work until you close this page.`;
    if (reason === "limit")
      sentences.push(
        `${names} ${many ? "were" : "was"} not saved for next time because Prism Mapper keeps at most ${formatBytes(limit)} of media on this device. ${stays} To make room, use Clear saved draft and media in the Help window.`,
      );
    else if (reason === "quota")
      sentences.push(
        `${names} ${many ? "were" : "was"} not saved for next time because this browser is out of storage space. ${stays} Free up space on your device and import ${many ? "them" : "it"} again.`,
      );
    else if (reason === "unavailable")
      sentences.push(
        `${names} ${many ? "were" : "was"} not saved for next time because this browser is not keeping files (private browsing or blocked site data). ${stays}`,
      );
    else
      sentences.push(
        `${names} could not be saved for next time (${group[0].detail || "unknown storage error"}). ${stays}`,
      );
  }
  return sentences.join(" ");
}

/** What to tell the person when media from the last visit could not be found. */
export function describeMissing(
  missing: readonly Media[],
  unavailable: boolean,
): string {
  if (unavailable)
    return "Saved media could not be read because this browser is blocking site storage. Layers that use media stay dark until you import the files again.";
  const many = missing.length > 1;
  return `${nameList(missing.map((m) => m.name))} ${many ? "are" : "is"} no longer saved on this device, so layers using ${many ? "them" : "it"} stay dark. Import ${many ? "the files" : "the file"} again and pick ${many ? "them" : "it"} as the layer source.`;
}
