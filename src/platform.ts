/**
 * Runtime detection and native-aware file saving.
 *
 * Prism Mapper runs in four places: the Electron desktop shell, a Capacitor
 * mobile app, an installed web app (PWA) and a plain browser tab. Every helper
 * here reads its globals when it is called, never at import time, so the unit
 * tests can swap in a mocked window, navigator and document.
 */

interface CapacitorLike {
  isNativePlatform?: () => boolean;
}
interface WindowLike {
  Capacitor?: CapacitorLike;
  prism?: unknown;
  matchMedia?: (query: string) => { matches: boolean };
}
interface NavigatorLike {
  standalone?: boolean;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
}
interface DocumentLike {
  createElement(tag: "a"): {
    href: string;
    download: string;
    rel: string;
    click(): void;
  };
}
interface UrlLike {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}
const root = globalThis as unknown as {
  window?: WindowLike;
  navigator?: NavigatorLike;
  document?: DocumentLike;
  URL?: UrlLike;
};
const win = (): WindowLike => root.window ?? (root as unknown as WindowLike);
const nav = (): NavigatorLike | undefined => root.navigator;

/** The app is running inside the Capacitor Android or iOS shell. */
export function isNative(): boolean {
  try {
    return win().Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** The app is running inside the Electron desktop shell (its preload bridge exists). */
export function isElectron(): boolean {
  return Boolean(win().prism);
}

/** Macs, iPhones and iPads use the Command key (⌘) for shortcuts; everything else uses Ctrl. */
export function usesCommandKey(): boolean {
  const n = nav();
  return /Mac|iPhone|iPad|iPod/i.test(
    `${n?.platform ?? ""} ${n?.userAgent ?? ""}`,
  );
}

/**
 * Shortcut text for tooltips and hints: ⌘Z or ⇧⌘Z on Apple devices, Ctrl+Z or
 * Ctrl+Shift+Z elsewhere. The key handler accepts either key on every platform;
 * this only decides which one the screen names.
 */
export function shortcutLabel(
  key: string,
  options: { shift?: boolean } = {},
): string {
  const shift = options.shift === true;
  return usesCommandKey()
    ? `${shift ? "⇧" : ""}⌘${key}`
    : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}

/** The page was launched from an installed web app icon rather than a browser tab. */
export function isStandalonePwa(): boolean {
  const query = win().matchMedia;
  if (typeof query === "function") {
    for (const mode of [
      "standalone",
      "minimal-ui",
      "window-controls-overlay",
    ]) {
      try {
        if (query.call(win(), `(display-mode: ${mode})`).matches) return true;
      } catch {
        // An engine that rejects a display-mode value simply is not in that mode.
      }
    }
  }
  return nav()?.standalone === true;
}

/** The main pointer is a finger, as on phones and tablets. */
export function isTouchPrimary(): boolean {
  try {
    return win().matchMedia?.("(pointer: coarse)")?.matches === true;
  } catch {
    return false;
  }
}

/** iPhone, iPad and iPod, including iPadOS, which reports itself as a Mac. */
export function isIosDevice(): boolean {
  const n = nav();
  if (!n) return false;
  if (/iPad|iPhone|iPod/.test(n.userAgent ?? "")) return true;
  return n.platform === "MacIntel" && (n.maxTouchPoints ?? 0) > 1;
}

/** Project file name for browser and mobile saves: always ends in `.prism.json`. */
export function projectFileName(projectName: string): string {
  const base = projectName.replace(/[^a-z0-9 -]/gi, "").trim();
  return `${base || "Prism Mapper project"}.prism.json`;
}

export type SaveOutcome =
  "native-share" | "web-share" | "download" | "cancelled";

type FilesystemModule = typeof import("@capacitor/filesystem");
type ShareModule = typeof import("@capacitor/share");
/** Loaders for the Capacitor plugins. Replaced by the unit tests. */
export const nativePlugins = {
  filesystem: (): Promise<FilesystemModule> => import("@capacitor/filesystem"),
  share: (): Promise<ShareModule> => import("@capacitor/share"),
};

const isAbort = (error: unknown) =>
  (error as { name?: string } | null)?.name === "AbortError";
/** Capacitor rejects a dismissed share sheet with "Share canceled". */
const isCancel = (error: unknown) =>
  isAbort(error) || /cancel/i.test(describe(error));
const describe = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String((error as { message?: unknown } | null)?.message ?? error);

/** Base64 of a string (as UTF-8) or Blob, in chunks that never overflow the call stack. */
export async function toBase64(data: Blob | string): Promise<string> {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(await data.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

const safeNativeName = (name: string) =>
  name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "prism-mapper-file";

async function saveNative(
  name: string,
  data: Blob | string,
): Promise<SaveOutcome> {
  let filesystem: FilesystemModule, share: ShareModule;
  try {
    [filesystem, share] = await Promise.all([
      nativePlugins.filesystem(),
      nativePlugins.share(),
    ]);
  } catch (error) {
    throw new Error(
      `This app could not load its file tools (${describe(error)}). Update the app and try again.`,
    );
  }
  const fileName = safeNativeName(name);
  let uri: string;
  try {
    const written = await filesystem.Filesystem.writeFile({
      path: fileName,
      data: await toBase64(data),
      directory: filesystem.Directory.Cache,
    });
    uri = written.uri;
  } catch (error) {
    throw new Error(
      `Could not prepare ${fileName} for saving: ${describe(error)}`,
    );
  }
  try {
    await share.Share.share({
      title: fileName,
      files: [uri],
      dialogTitle: "Save Prism Mapper project",
    });
    return "native-share";
  } catch (error) {
    if (isCancel(error)) return "cancelled";
    throw new Error(`Could not open the share sheet: ${describe(error)}`);
  }
}

/**
 * Offer the file through the system share sheet when the browser can share
 * files. Returns undefined when sharing is not possible so the caller can fall
 * back to a download. Must run inside the user's click, before any await.
 */
async function shareFromBrowser(
  name: string,
  blob: Blob,
  mime: string,
): Promise<SaveOutcome | undefined> {
  const n = nav();
  if (!n || typeof n.canShare !== "function" || typeof n.share !== "function")
    return undefined;
  let file: File;
  try {
    file = new File([blob], name, { type: blob.type || mime });
    if (!n.canShare({ files: [file] })) return undefined;
  } catch {
    return undefined;
  }
  try {
    await n.share({ files: [file], title: name });
    return "web-share";
  } catch (error) {
    // AbortError means the person closed the share sheet on purpose.
    if (isAbort(error)) return "cancelled";
    return undefined;
  }
}

function downloadFromBrowser(name: string, blob: Blob) {
  const doc = root.document,
    urls = root.URL;
  if (!doc || !urls) throw new Error("This browser cannot save files.");
  const link = doc.createElement("a");
  const href = urls.createObjectURL(blob);
  link.href = href;
  link.download = name;
  link.rel = "noopener";
  link.click();
  // Some mobile browsers read the file after the click returns, so keep the URL alive for a while.
  setTimeout(() => urls.revokeObjectURL(href), 30_000);
}

/**
 * Save a file the way the current runtime expects.
 *  - Capacitor app: write to the cache folder, then open the system share sheet.
 *  - Touch browser that can share files: open the share sheet with a File.
 *  - Everything else: a normal download link.
 * Resolves to "cancelled" when the person dismisses the share sheet.
 */
export async function saveFile(
  name: string,
  data: Blob | string,
  mime: string,
): Promise<SaveOutcome> {
  if (isNative()) return saveNative(name, data);
  const blob =
    typeof data === "string" ? new Blob([data], { type: mime }) : data;
  if (isTouchPrimary()) {
    const shared = await shareFromBrowser(name, blob, mime);
    if (shared) return shared;
  }
  downloadFromBrowser(name, blob);
  return "download";
}
