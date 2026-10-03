import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { formatBytes, type SavedMediaUsage } from "./persistence";
import { getPwaState, installMode, promptInstall, subscribePwa } from "./pwa";
import type { DeviceStorage } from "./usePersistence";

function storageLine(usage: SavedMediaUsage | null): string {
  if (!usage) return "Checking what is saved on this device…";
  if (!usage.available)
    return "This browser is not keeping media between visits (private browsing or blocked site data). Use Save project to keep your layout.";
  if (!usage.count)
    return "No media saved here yet. Images and videos you import are kept on this device so they survive a reload.";
  return `${usage.count} media ${usage.count === 1 ? "file" : "files"} saved on this device (${formatBytes(usage.bytes)} of ${formatBytes(usage.limit)}).`;
}

/** Help window section: install the web app, see what is saved, and clear it. */
export function DeviceSection({ storage }: { storage: DeviceStorage }) {
  const pwa = useSyncExternalStore(subscribePwa, getPwaState);
  const [usage, setUsage] = useState<SavedMediaUsage | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    storage.readUsage().then(setUsage, () => {});
  }, [storage]);
  useEffect(() => {
    if (storage.enabled) refresh();
  }, [storage, refresh]);
  if (!storage.enabled) return null;
  const mode = installMode(pwa);
  const clear = async () => {
    setBusy(true);
    await storage.clearSaved();
    setBusy(false);
    setAsking(false);
    refresh();
  };
  return (
    <section className="device-section" aria-labelledby="device-heading">
      <h2 id="device-heading">On this device</h2>
      {mode === "prompt" && (
        <div className="device-block">
          <button onClick={() => void promptInstall()}>
            <Download size={14} />
            Install app
          </button>
          <p className="device-note">
            Add Prism Mapper to your home screen or desktop. It opens full
            screen and works without a connection.
          </p>
        </div>
      )}
      {mode === "ios" && (
        <p className="device-note">
          <strong>Install on iPhone or iPad:</strong> tap Share, then Add to
          Home Screen.
        </p>
      )}
      {pwa.offlineReady && (
        <p className="device-note">
          Ready to work without a connection. Nothing you make leaves this
          device.
        </p>
      )}
      {pwa.updateReady && (
        <div className="device-block">
          <p className="device-note">A new version is ready.</p>
          <button onClick={() => location.reload()}>
            <RefreshCw size={14} />
            Reload now
          </button>
        </div>
      )}
      <p className="device-note">{storageLine(usage)}</p>
      {asking ? (
        <div
          className="device-block"
          role="group"
          aria-label="Confirm clearing saved data"
        >
          <p className="device-note">
            Deletes the autosaved draft and imported media stored on this
            device. Your open project stays open and is autosaved again on your
            next change, but its media will need importing again after a reload.
          </p>
          <div className="device-actions">
            <button autoFocus onClick={() => setAsking(false)}>
              Keep it
            </button>
            <button
              className="device-danger"
              disabled={busy}
              onClick={() => void clear()}
            >
              Yes, clear it
            </button>
          </div>
        </div>
      ) : (
        <div className="device-actions">
          <button className="device-danger" onClick={() => setAsking(true)}>
            <Trash2 size={14} />
            Clear saved draft and media
          </button>
        </div>
      )}
    </section>
  );
}
