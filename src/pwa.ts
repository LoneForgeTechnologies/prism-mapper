/**
 * Installable offline web app: manifest link, service worker, install prompt
 * and update notice.
 *
 * Only the web build uses any of this. The Electron app and the Capacitor
 * shells already ship their files, so they never get a manifest or a worker.
 * The worker only ever fetches this app's own static files. Nothing here
 * contacts another server or reports anything.
 */
import { isElectron, isIosDevice, isNative, isStandalonePwa } from "./platform";

export interface PwaState {
  /** This runtime can use a manifest and service worker (http or https, not Electron or a mobile shell). */
  eligible: boolean;
  /** The browser handed us an install prompt we can show. */
  canInstall: boolean;
  /** Launched from an installed icon, or installed during this visit. */
  installed: boolean;
  /** iPhone or iPad: installing is a manual Share menu step. */
  iosInstructions: boolean;
  /** The service worker is active, so the app can open without a connection. */
  offlineReady: boolean;
  /** A newer version took over while this page was open. */
  updateReady: boolean;
}

const INITIAL: PwaState = {
  eligible: false,
  canInstall: false,
  installed: false,
  iosInstructions: false,
  offlineReady: false,
  updateReady: false,
};
let state: PwaState = INITIAL;
const listeners = new Set<() => void>();
function update(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export const getPwaState = (): PwaState => state;
export const subscribePwa = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Which install help to show: the real prompt, iOS steps, or nothing. */
export function installMode(s: PwaState): "prompt" | "ios" | "none" {
  if (!s.eligible || s.installed) return "none";
  if (s.canInstall) return "prompt";
  if (s.iosInstructions) return "ios";
  return "none";
}

/** True for a normal web page that may carry a manifest and a worker. */
export function webAppEligible(): boolean {
  const protocol = (globalThis as { location?: { protocol?: string } }).location
    ?.protocol;
  return (
    (protocol === "http:" || protocol === "https:") &&
    !isElectron() &&
    !isNative()
  );
}

const devBuild = () =>
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferredPrompt: InstallPromptEvent | null = null;

/** Show the browser's install dialog. The event can only be used once. */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const event = deferredPrompt;
  if (!event) return "unavailable";
  deferredPrompt = null;
  update({ canInstall: false });
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "dismissed";
  }
}

function addManifestLink() {
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "./manifest.webmanifest";
  document.head.append(link);
}

function listenForInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    update({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    update({ installed: true, canInstall: false });
  });
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;
function registerWorker() {
  if (devBuild() || !("serviceWorker" in navigator)) return;
  const container = navigator.serviceWorker;
  // The first install also changes the controller. Only a change after the page
  // already had one is an update.
  let controlled = Boolean(container.controller);
  container.addEventListener("controllerchange", () => {
    if (controlled) update({ updateReady: true });
    controlled = true;
  });
  container.ready.then(() => update({ offlineReady: true })).catch(() => {});
  const start = () => {
    container
      .register(new URL("sw.js", document.baseURI).href)
      .then((registration) => {
        let lastCheck = Date.now();
        // A phone app can stay open for days. Look for a new version when it comes back to the foreground.
        document.addEventListener("visibilitychange", () => {
          if (
            document.visibilityState === "visible" &&
            Date.now() - lastCheck > UPDATE_CHECK_MS
          ) {
            lastCheck = Date.now();
            registration.update().catch(() => {});
          }
        });
      })
      .catch(() => {
        // Offline support is optional. The app works without it.
      });
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

let started = false;
/** Set the web app up. Safe to call more than once; does nothing outside a plain web page. */
export function initPwa(): void {
  if (started) return;
  started = true;
  const eligible = webAppEligible();
  update({
    eligible,
    installed: isStandalonePwa(),
    iosInstructions: isIosDevice(),
  });
  if (!eligible) return;
  addManifestLink();
  listenForInstall();
  registerWorker();
}
