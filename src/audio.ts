import {
  AudioAnalysis,
  DEFAULT_AUDIO_OPTIONS,
  normalizeAudioOptions,
  SILENT_AUDIO,
  type AudioFrame,
  type AudioOptions,
} from "./audio-analysis";
import type { DesktopAPI } from "./model";
export { DEFAULT_AUDIO_OPTIONS, SILENT_AUDIO };
export type { AudioFrame, AudioOptions };

export type AudioSource =
  { kind: "input"; deviceId?: string } | { kind: "system" };
export interface AudioInput {
  deviceId: string;
  label: string;
}
export interface AudioSnapshot {
  status: "idle" | "starting" | "listening" | "error";
  frame: AudioFrame;
  sources: AudioInput[];
  source?: AudioSource;
  error?: string;
  options: AudioOptions;
}
declare module "./model" {
  interface DesktopAPI {
    prepareAudio(source: AudioSource): Promise<{ ok: boolean; error?: string }>;
    audioStarted(): void;
    stopAudio(): void;
    updateAudio(frame: AudioFrame): void;
    getAudio(): Promise<AudioFrame>;
    onAudio(callback: (frame: AudioFrame) => void): () => void;
  }
}

let liveFrame = SILENT_AUDIO;
let liveAt = 0;
export function publishAudioFrame(frame: AudioFrame) {
  liveFrame = frame;
  liveAt = performance.now();
}
export function readAudioFrame(): AudioFrame {
  return performance.now() - liveAt <= 500 ? liveFrame : SILENT_AUDIO;
}

function captureError(error: unknown, source: AudioSource): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return source.kind === "system"
      ? "System audio permission was denied. Allow Prism Mapper in macOS Privacy & Security → Screen & System Audio Recording, then try Start again. A virtual audio input also works."
      : "Microphone permission was denied. Allow Prism Mapper in your system microphone privacy settings, then try Start again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "That audio input is unavailable. Refresh inputs, choose a connected device, and try Start again.";
  if (name === "NotReadableError" || name === "AbortError")
    return "The audio source could not start. Check its system permissions and connection, or choose another input.";
  return error instanceof Error
    ? error.message
    : "Audio capture could not start. Choose another source and try again.";
}

/**
 * Why this page cannot listen to audio inputs, or undefined when it can.
 * Browsers hide the microphone API on insecure (plain http) pages, and some
 * older embedded web views do not have it at all.
 */
export function audioUnavailableReason(
  env: {
    navigator?: { mediaDevices?: { getUserMedia?: unknown } };
    isSecureContext?: boolean;
    AudioContext?: unknown;
  } = globalThis,
): string | undefined {
  if (!env.navigator?.mediaDevices?.getUserMedia)
    return env.isSecureContext === false
      ? "Audio inputs need a secure page. Open Prism Mapper over https or from localhost, or use the installed app."
      : "This browser or app view cannot reach audio inputs. Try a current Chrome, Edge or Safari, or the desktop app.";
  if (typeof env.AudioContext === "undefined")
    return "This browser does not support Web Audio, so Audio react is not available here.";
  return undefined;
}

/** Capture is opt-in, local, and analyser-only: no speaker connection, recording, or network traffic. */
export class AudioController {
  private snapshot: AudioSnapshot = {
    status: "idle",
    frame: SILENT_AUDIO,
    sources: [],
    options: { ...DEFAULT_AUDIO_OPTIONS },
  };
  private listeners = new Set<(snapshot: AudioSnapshot) => void>();
  private generation = 0;
  private stream?: MediaStream;
  private context?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private timer?: ReturnType<typeof setInterval>;
  private analysis = new AudioAnalysis();
  private watchingDevices = false;
  private knownInputs: AudioInput[] = [];
  private bridge(): DesktopAPI | undefined {
    return typeof window !== "undefined" ? window.prism : undefined;
  }
  private devices(): MediaDevices | undefined {
    return typeof navigator !== "undefined"
      ? navigator.mediaDevices
      : undefined;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: (snapshot: AudioSnapshot) => void) => {
    this.listeners.add(listener);
    listener(this.snapshot);
    if (!this.watchingDevices) {
      this.devices()?.addEventListener("devicechange", this.deviceChanged);
      this.watchingDevices = true;
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.devices()?.removeEventListener("devicechange", this.deviceChanged);
        this.watchingDevices = false;
      }
    };
  };
  private update(patch: Partial<AudioSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
  private publish(frame: AudioFrame) {
    publishAudioFrame(frame);
    this.bridge()?.updateAudio(frame);
    this.update({ frame });
  }
  setOptions(options: Partial<AudioOptions>) {
    this.update({
      options: normalizeAudioOptions({ ...this.snapshot.options, ...options }),
    });
  }
  async listInputs(): Promise<AudioInput[]> {
    const devices = this.devices();
    const unavailable = audioUnavailableReason();
    if (!devices || unavailable) {
      this.update({
        error:
          unavailable ??
          "Audio inputs are unavailable in this browser. Open the desktop app or localhost preview.",
      });
      return [];
    }
    try {
      const inputs = (await devices.enumerateDevices()).filter(
        (device) => device.kind === "audioinput",
      );
      let sources = inputs.map((device, index) => ({
        deviceId: device.deviceId,
        label:
          device.label ||
          `Microphone ${index + 1} (allow access to see its name)`,
      }));
      // Electron intentionally consumes its capture grant after Start. Chromium
      // then redacts enumeration, even with a live track. Retain the device names
      // obtained during that grant instead of replacing them with an empty ID.
      if (sources.some((source) => source.deviceId)) this.knownInputs = sources;
      else if (this.knownInputs.length) sources = this.knownInputs;
      this.update({ sources });
      return sources;
    } catch (error) {
      this.update({
        error: `Could not list audio inputs: ${error instanceof Error ? error.message : "device access unavailable"}`,
      });
      return [];
    }
  }
  private deviceChanged = () => {
    void this.listInputs();
  };
  private release() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = undefined;
    this.sourceNode?.disconnect();
    this.analyser?.disconnect();
    this.sourceNode = undefined;
    this.analyser = undefined;
    if (this.context) void this.context.close().catch(() => {});
    this.context = undefined;
    this.analysis.reset();
  }
  stop() {
    this.generation++;
    this.release();
    this.bridge()?.stopAudio();
    this.publish(SILENT_AUDIO);
    this.update({ status: "idle", error: undefined });
  }
  async start(source: AudioSource): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.update({
      status: "starting",
      source: { ...source },
      error: undefined,
    });
    let pending: MediaStream | undefined;
    try {
      const devices = this.devices();
      const unavailable = audioUnavailableReason();
      if (!devices?.getUserMedia || unavailable)
        throw new Error(
          unavailable ??
            "Audio capture is unavailable. Open the desktop app or localhost preview.",
        );
      const bridge = this.bridge();
      if (source.kind === "system" && !bridge)
        throw new Error(
          "System output capture is available in the desktop app. In this browser, select a microphone or virtual audio input.",
        );
      if (bridge) {
        const permission = await bridge.prepareAudio(source);
        if (generation !== this.generation) return;
        if (!permission.ok)
          throw new Error(
            permission.error || "Audio permission could not be prepared.",
          );
      }
      if (source.kind === "system") {
        // Chromium requires a video carrier. Electron restricts it to our own editor;
        // discard that track immediately and never inspect or record its frames.
        pending = await devices.getDisplayMedia({
          audio: true,
          video: { width: 1, height: 1, frameRate: 1 },
        });
        pending.getVideoTracks().forEach((track) => track.stop());
      } else {
        pending = await devices.getUserMedia({
          video: false,
          audio: {
            ...(source.deviceId
              ? { deviceId: { exact: source.deviceId } }
              : {}),
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
      if (generation !== this.generation) {
        pending.getTracks().forEach((track) => track.stop());
        return;
      }
      const audioTracks = pending
        .getAudioTracks()
        .filter((track) => track.readyState === "live");
      if (!audioTracks.length)
        throw new Error(
          "This source returned no audio. Choose an audio input or a virtual loopback device instead.",
        );
      this.stream = pending;
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.analyser.minDecibels = -100;
      this.analyser.maxDecibels = 0;
      this.sourceNode = this.context.createMediaStreamSource(
        new MediaStream(audioTracks),
      );
      this.sourceNode.connect(this.analyser);
      await this.context.resume();
      if (generation !== this.generation) return;
      await this.listInputs();
      if (generation !== this.generation) return;
      bridge?.audioStarted();
      for (const track of audioTracks)
        track.onended = () => {
          if (generation !== this.generation) return;
          this.stop();
          this.update({
            status: "error",
            error:
              "Audio capture ended or the device disconnected. Choose an input and press Start to reconnect.",
          });
          void this.listInputs();
        };
      const samples = new Float32Array(this.analyser.fftSize);
      const spectrum = new Float32Array(this.analyser.frequencyBinCount);
      let last = performance.now();
      this.update({ status: "listening" });
      const tick = () => {
        if (generation !== this.generation || !this.analyser || !this.context)
          return;
        this.analyser.getFloatTimeDomainData(samples);
        this.analyser.getFloatFrequencyData(spectrum);
        const now = performance.now();
        this.publish(
          this.analysis.process(
            samples,
            spectrum,
            this.context.sampleRate,
            this.analyser.fftSize,
            (now - last) / 1000,
            this.snapshot.options,
          ),
        );
        last = now;
      };
      tick();
      this.timer = setInterval(tick, 1000 / 30);
    } catch (error) {
      pending?.getTracks().forEach((track) => track.stop());
      if (generation !== this.generation) return;
      this.release();
      this.bridge()?.stopAudio();
      this.publish(SILENT_AUDIO);
      this.update({ status: "error", error: captureError(error, source) });
    }
  }
  dispose() {
    this.stop();
    this.listeners.clear();
    this.devices()?.removeEventListener("devicechange", this.deviceChanged);
    this.watchingDevices = false;
  }
}
