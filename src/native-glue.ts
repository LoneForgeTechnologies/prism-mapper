/**
 * Best-effort glue for the Capacitor shells. Everything here does nothing in a
 * plain browser, an installed web app or Electron. It has its own native check
 * so it does not depend on the platform helpers owned by other branches.
 */
type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNativeShell(): boolean {
  try {
    const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal })
      .Capacitor;
    return capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

const noop = () => {};

/** Hides the status bar while presenting. Resolves to a function that restores it. */
export async function hideStatusBar(): Promise<() => void> {
  if (!isNativeShell()) return noop;
  try {
    const { StatusBar } = await import("@capacitor/status-bar");
    await StatusBar.hide();
    return () => {
      try {
        void StatusBar.show().catch(noop);
      } catch {}
    };
  } catch {
    return noop;
  }
}

/**
 * Runs `handler` when the Android back button is pressed. Registering a
 * listener replaces the default back behaviour, so callers must remove it as
 * soon as they no longer need it. Resolves to the remover.
 */
export async function onBackButton(handler: () => void): Promise<() => void> {
  if (!isNativeShell()) return noop;
  try {
    const { App } = await import("@capacitor/app");
    const listener = await App.addListener("backButton", () => handler());
    return () => {
      try {
        void listener.remove().catch(noop);
      } catch {}
    };
  } catch {
    return noop;
  }
}
