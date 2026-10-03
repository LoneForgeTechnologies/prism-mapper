import { useEffect, useState, useSyncExternalStore } from "react";
import { AudioLines, Mic, RefreshCw, Square } from "lucide-react";
import type { Surface } from "./model";
import { AudioController, audioUnavailableReason } from "./audio";
import "./audio-panel.css";

interface AudioPanelProps {
  surface?: Surface;
  onChange: (patch: Partial<Surface>) => void;
}
const DEFAULT_RESPONSE: NonNullable<Surface["audio"]> = {
  enabled: false,
  band: "bass",
  amount: 0.65,
  mode: "brightness",
};
const BANDS = [
  ["level", "Level"],
  ["bass", "Bass"],
  ["mid", "Mids"],
  ["treble", "Treble"],
  ["beat", "Pulse"],
] as const;

/** Capture belongs to this editor session; saved projects only describe layer responses. */
export function AudioPanel({ surface, onChange }: AudioPanelProps) {
  const [controller] = useState(() => new AudioController());
  const [subscribe] = useState(() => controller.subscribe.bind(controller));
  const [getSnapshot] = useState(() => controller.getSnapshot.bind(controller));
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const [source, setSource] = useState<"input" | "system">("input");
  const [deviceId, setDeviceId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  // Browsers cannot capture what the computer is playing. Only the desktop app can.
  const canCaptureSystem = typeof window !== "undefined" && !!window.prism;
  const [unsupported] = useState(() => audioUnavailableReason());
  const response = surface?.audio || DEFAULT_RESPONSE;
  const canReact = !!surface && surface.kind !== "mask";
  const busy = snapshot.status === "starting";
  const listening = snapshot.status === "listening";
  const capturing = busy || listening;
  const error = unsupported || deviceError || snapshot.error;

  const refresh = async () => {
    setRefreshing(true);
    setDeviceError("");
    try {
      await controller.listInputs();
    } catch (error) {
      setDeviceError(
        error instanceof Error ? error.message : "Could not list audio inputs.",
      );
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    void refresh();
    return () => controller.dispose();
  }, [controller]);

  const updateResponse = (patch: Partial<NonNullable<Surface["audio"]>>) => {
    if (canReact) onChange({ audio: { ...response, ...patch } });
  };
  const changeSource = (value: "input" | "system") => {
    controller.stop();
    setDeviceError("");
    setSource(value);
  };
  const options = snapshot.options;
  const stateLabel = busy
    ? "STARTING"
    : listening
      ? "LIVE"
      : error
        ? "CHECK SOURCE"
        : "OFF";

  return (
    <details id="audio-react-panel" className="audio-panel" open>
      <summary>
        <span>
          <AudioLines size={15} /> Audio react
        </span>
        <span className={`audio-state ${listening ? "active" : ""}`}>
          {stateLabel}
        </span>
      </summary>
      <div className="audio-panel-body">
        <label className="audio-field">
          Listen to
          <select
            aria-label="Audio source"
            value={source}
            onChange={(event) =>
              changeSource(event.target.value as "input" | "system")
            }
          >
            <option value="input">Microphone / audio input</option>
            <option value="system" disabled={!canCaptureSystem}>
              {canCaptureSystem
                ? "System output · current mix"
                : "System output · desktop app only"}
            </option>
          </select>
        </label>
        {!canCaptureSystem && (
          <p className="audio-help">
            Browsers cannot capture system sound, so choose a microphone or a
            virtual audio input. System output works in the desktop app.
          </p>
        )}
        {source === "input" && (
          <div className="audio-device-row">
            <label className="audio-field">
              Input device
              <select
                aria-label="Audio input device"
                value={deviceId}
                onChange={(event) => {
                  controller.stop();
                  setDeviceError("");
                  setDeviceId(event.target.value);
                }}
              >
                <option value="">System default input</option>
                {snapshot.sources
                  .filter((device) => device.deviceId !== "default")
                  .map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                {deviceId &&
                  !snapshot.sources.some(
                    (device) => device.deviceId === deviceId,
                  ) && (
                    <option value={deviceId}>Selected input unavailable</option>
                  )}
              </select>
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh audio inputs"
              title="Refresh audio inputs"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        )}
        <button
          className={`audio-capture-button ${capturing ? "listening" : ""}`}
          type="button"
          disabled={!!unsupported && !capturing}
          onClick={() => {
            setDeviceError("");
            if (capturing) controller.stop();
            else
              void controller.start(
                source === "system"
                  ? { kind: "system" }
                  : { kind: "input", ...(deviceId ? { deviceId } : {}) },
              );
          }}
        >
          {capturing ? <Square size={13} /> : <Mic size={14} />}
          {busy
            ? "Cancel listening"
            : listening
              ? "Stop listening"
              : "Start listening"}
        </button>
        <p className="audio-help">
          {source === "system"
            ? "Responds to sound playing through your current system output."
            : "Choose an input, then start listening. Audio is never recorded."}
        </p>
        {error && (
          <p className="audio-error" role="alert">
            {error}
          </p>
        )}
        <div className="audio-meter-group" aria-label="Live audio levels">
          {BANDS.map(([band, label]) => {
            const value = Math.max(0, Math.min(1, snapshot.frame[band] || 0));
            return (
              <div className="audio-meter-column" key={band}>
                <div
                  className={`audio-meter-track ${band === "beat" ? "pulse" : ""}`}
                  role="meter"
                  aria-label={`${label} audio level`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(value * 100)}
                >
                  <i style={{ height: `${value * 100}%` }} />
                </div>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
        <details className="audio-tuning">
          <summary>Input sensitivity</summary>
          <label className="audio-slider">
            <span>
              Gain <output>{options.gain.toFixed(2)}×</output>
            </span>
            <input
              type="range"
              aria-label="Audio gain"
              min="0.25"
              max="4"
              step="0.05"
              value={options.gain}
              onChange={(event) =>
                controller.setOptions({ gain: Number(event.target.value) })
              }
            />
          </label>
          <label className="audio-slider">
            <span>
              Noise gate{" "}
              <output>{Math.round(options.noiseFloor * 100)}%</output>
            </span>
            <input
              type="range"
              aria-label="Audio noise gate"
              min="0"
              max="0.2"
              step="0.005"
              value={options.noiseFloor}
              onChange={(event) =>
                controller.setOptions({
                  noiseFloor: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="audio-slider">
            <span>
              Smoothing <output>{Math.round(options.smoothing * 100)}%</output>
            </span>
            <input
              type="range"
              aria-label="Audio smoothing"
              min="0"
              max="0.95"
              step="0.05"
              value={options.smoothing}
              onChange={(event) =>
                controller.setOptions({ smoothing: Number(event.target.value) })
              }
            />
          </label>
        </details>
        <div className="audio-layer-response">
          <label className="audio-react-toggle">
            <input
              type="checkbox"
              aria-label="React this layer to audio"
              checked={canReact && response.enabled}
              disabled={!canReact}
              onChange={(event) =>
                updateResponse({ enabled: event.target.checked })
              }
            />
            React this layer to audio
          </label>
          {!canReact ? (
            <p className="audio-help">
              {surface
                ? "Cutout masks stay steady."
                : "Select an animation layer to set its response."}
            </p>
          ) : (
            <fieldset disabled={!response.enabled}>
              <div className="audio-response-fields">
                <label className="audio-field">
                  Follow
                  <select
                    aria-label="Audio response band"
                    value={response.band}
                    onChange={(event) =>
                      updateResponse({
                        band: event.target.value as NonNullable<
                          Surface["audio"]
                        >["band"],
                      })
                    }
                  >
                    <option value="level">Full volume</option>
                    <option value="bass">Bass</option>
                    <option value="mid">Mids / voices</option>
                    <option value="treble">Treble</option>
                    <option value="beat">Pulse / onsets</option>
                  </select>
                </label>
                <label className="audio-field">
                  Animate
                  <select
                    aria-label="Audio response mode"
                    value={response.mode}
                    onChange={(event) =>
                      updateResponse({
                        mode: event.target.value as NonNullable<
                          Surface["audio"]
                        >["mode"],
                      })
                    }
                  >
                    <option value="brightness">Brightness</option>
                    <option value="zoom">Zoom</option>
                    <option value="both">Both</option>
                  </select>
                </label>
              </div>
              <label className="audio-slider">
                <span>
                  Response strength{" "}
                  <output>{Math.round(response.amount * 100)}%</output>
                </span>
                <input
                  type="range"
                  aria-label="Audio response strength"
                  min="0"
                  max="1"
                  step="0.01"
                  value={response.amount}
                  onChange={(event) =>
                    updateResponse({ amount: Number(event.target.value) })
                  }
                />
              </label>
            </fieldset>
          )}
          {canReact && response.enabled && !listening && (
            <p className="audio-help">
              Response saved. Start listening to make it move with sound.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
