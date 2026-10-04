import test from "node:test";
import assert from "node:assert/strict";
import {
  AudioAnalysis,
  audioRms,
  audioBands,
  normalizeAudioOptions,
} from "../src/audio-analysis";
import {
  AudioController,
  publishAudioFrame,
  readAudioFrame,
  SILENT_AUDIO,
} from "../src/audio";

const sampleRate = 48000;
const fftSize = 2048;
function tone(frequency: number, amplitude = 0.2) {
  return Float32Array.from(
    { length: fftSize },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate),
  );
}
function spectrum(frequency: number, amplitude = 0.2) {
  const bins = new Float32Array(fftSize / 2).fill(-Infinity);
  bins[Math.round((frequency * fftSize) / sampleRate)] =
    20 * Math.log10(amplitude);
  return bins;
}
const silence = new Float32Array(fftSize);
const silentSpectrum = new Float32Array(fftSize / 2).fill(-Infinity);

test("PCM RMS follows sine amplitude, removes DC bias, and remains finite for invalid samples", () => {
  assert.ok(Math.abs(audioRms(tone(750, 0.4)) - 0.4 / Math.sqrt(2)) < 0.00001);
  assert.equal(audioRms(new Float32Array(fftSize).fill(0.2)), 0);
  assert.equal(audioRms([]), 0);
  assert.ok(Number.isFinite(audioRms([NaN, Infinity, -Infinity, 0.2])));
});

test("frequency bands distinguish bass, mid and treble with sample-rate aware bin boundaries", () => {
  for (const [frequency, name] of [
    [93.75, "bass"],
    [750, "mid"],
    [6000, "treble"],
  ] as const) {
    const bands = audioBands(spectrum(frequency), sampleRate, fftSize);
    assert.ok(Math.abs(bands[name] - 0.2) < 0.00001);
    for (const key of ["bass", "mid", "treble"] as const)
      if (key !== name) assert.equal(bands[key], 0);
  }
  assert.deepEqual(audioBands(spectrum(23.4375), sampleRate, fftSize), {
    bass: 0,
    mid: 0,
    treble: 0,
  });
  assert.deepEqual(audioBands(spectrum(15000), sampleRate, fftSize), {
    bass: 0,
    mid: 0,
    treble: 0,
  });
  assert.deepEqual(audioBands(spectrum(93.75), 0, fftSize), {
    bass: 0,
    mid: 0,
    treble: 0,
  });
});

test("envelopes attack promptly, decay smoothly and the gate suppresses background noise", () => {
  const analysis = new AudioAnalysis();
  const noisy = analysis.process(
    tone(93.75, 0.01),
    spectrum(93.75, 0.01),
    sampleRate,
    fftSize,
    1 / 30,
  );
  assert.equal(noisy.level, 0);
  assert.equal(noisy.bass, 0);
  assert.equal(noisy.beat, 0);
  const attack = analysis.process(
    tone(93.75, 0.5),
    spectrum(93.75, 0.5),
    sampleRate,
    fftSize,
    1 / 30,
  );
  assert.ok(attack.level > 0.5);
  assert.ok(attack.bass > attack.mid);
  const release = analysis.process(
    silence,
    silentSpectrum,
    sampleRate,
    fftSize,
    1 / 30,
  );
  assert.ok(release.level > 0 && release.level < attack.level);
  assert.ok(attack.level - release.level < attack.level / 2);
  let tail = release;
  for (let i = 0; i < 180; i++)
    tail = analysis.process(
      silence,
      silentSpectrum,
      sampleRate,
      fftSize,
      1 / 30,
    );
  assert.equal(tail.level, 0);
  assert.equal(tail.beat, 0);
});

test("beat responds to an onset and settles on sustained sound instead of free-running", () => {
  const analysis = new AudioAnalysis();
  let frame = analysis.process(
    tone(93.75, 0.4),
    spectrum(93.75, 0.4),
    sampleRate,
    fftSize,
    1 / 30,
  );
  assert.ok(frame.beat > 0.7);
  for (let i = 0; i < 90; i++)
    frame = analysis.process(
      tone(93.75, 0.4),
      spectrum(93.75, 0.4),
      sampleRate,
      fftSize,
      1 / 30,
    );
  assert.ok(frame.beat < 0.001);
  analysis.reset();
  frame = analysis.process(
    silence,
    silentSpectrum,
    sampleRate,
    fftSize,
    1 / 30,
  );
  assert.equal(frame.beat, 0);
});

test("gain, smoothing, numeric clamping and reset keep normalized summaries bounded", () => {
  const low = new AudioAnalysis().process(
    tone(750, 0.1),
    spectrum(750, 0.1),
    sampleRate,
    fftSize,
    1 / 30,
    { gain: 0.5 },
  );
  const high = new AudioAnalysis().process(
    tone(750, 0.1),
    spectrum(750, 0.1),
    sampleRate,
    fftSize,
    1 / 30,
    { gain: 3 },
  );
  assert.ok(high.level > low.level * 4);
  assert.deepEqual(
    normalizeAudioOptions({ gain: Infinity, noiseFloor: -1, smoothing: 2 }),
    { gain: 0.25, noiseFloor: 0, smoothing: 0.95 },
  );
  const clipped = new AudioAnalysis().process(
    tone(750, 1e20),
    new Float32Array(1024).fill(100),
    sampleRate,
    fftSize,
    NaN,
    { gain: 99 },
  );
  for (const value of Object.values(clipped))
    if (typeof value === "number")
      assert.ok(value >= 0 && value <= 1 && Number.isFinite(value));
});

test("controller never starts on construction or subscription and Stop immediately clears the shared signal", () => {
  const controller = new AudioController();
  assert.equal(controller.getSnapshot().status, "idle");
  const snapshots: string[] = [];
  const unsubscribe = controller.subscribe((snapshot) =>
    snapshots.push(snapshot.status),
  );
  assert.deepEqual(snapshots, ["idle"]);
  const snapshot = controller.getSnapshot();
  assert.equal(controller.getSnapshot(), snapshot);
  publishAudioFrame({
    active: true,
    level: 1,
    bass: 0.9,
    mid: 0.5,
    treble: 0.1,
    beat: 1,
  });
  assert.equal(readAudioFrame().active, true);
  controller.stop();
  assert.deepEqual(readAudioFrame(), SILENT_AUDIO);
  unsubscribe();
  controller.dispose();
});

// A call, Siri or a locked screen stops the audio engine of a phone. The
// controller must say so, keep the lights from freezing on the last sound, and
// start again at the next tap. These fakes stand in for the browser.
test("an interrupted audio engine pauses listening, silences the lights and the next tap resumes it", async () => {
  class FakeContext {
    state = "suspended";
    sampleRate = sampleRate;
    onstatechange: (() => void) | null = null;
    closed = false;
    analyser = {
      fftSize,
      frequencyBinCount: fftSize / 2,
      smoothingTimeConstant: 0,
      minDecibels: -100,
      maxDecibels: 0,
      getFloatTimeDomainData: (target: Float32Array) =>
        target.set(tone(120, 0.38)),
      getFloatFrequencyData: (target: Float32Array) =>
        target.set(spectrum(120, 0.38)),
      connect() {},
      disconnect() {},
    };
    createAnalyser() {
      return this.analyser;
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    async resume() {
      this.change("running");
    }
    async close() {
      this.closed = true;
    }
    /** What the device does to the engine. */
    change(state: string) {
      this.state = state;
      this.onstatechange?.();
    }
  }
  const contexts: FakeContext[] = [];
  const track = { readyState: "live", onended: null, stop() {} };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  };
  const listeners = new Map<string, Set<() => void>>();
  const fakes: Record<string, unknown> = {
    navigator: {
      mediaDevices: {
        getUserMedia: async () => stream,
        enumerateDevices: async () => [],
        addEventListener() {},
        removeEventListener() {},
      },
    },
    AudioContext: class extends FakeContext {
      constructor() {
        super();
        contexts.push(this);
      }
    },
    MediaStream: class {},
    document: {
      addEventListener: (type: string, listener: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener: (type: string, listener: () => void) =>
        listeners.get(type)?.delete(listener),
    },
  };
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(fakes)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  const waiting = () =>
    ["click", "touchend", "keydown"].reduce(
      (sum, type) => sum + (listeners.get(type)?.size ?? 0),
      0,
    );
  const tap = () => {
    for (const listener of [...(listeners.get("click") ?? [])]) listener();
  };
  const later = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

  const controller = new AudioController();
  try {
    await controller.start({ kind: "input" });
    const context = contexts[0];
    assert.equal(controller.getSnapshot().status, "listening");
    assert.equal(controller.getSnapshot().paused, false);
    assert.equal(readAudioFrame().active, true, "the tone is heard");
    assert.equal(waiting(), 0, "nothing waits for a tap while listening");

    // The device takes the engine away.
    context.change("interrupted");
    assert.equal(controller.getSnapshot().paused, true);
    assert.equal(controller.getSnapshot().status, "listening");
    assert.deepEqual(readAudioFrame(), SILENT_AUDIO, "the lights go quiet");
    assert.equal(waiting(), 3, "a tap, a touch or a key will resume it");
    await later();
    assert.deepEqual(readAudioFrame(), SILENT_AUDIO, "and stay quiet");

    // The next tap starts it again, and nothing waits any more.
    tap();
    await later();
    assert.equal(context.state, "running");
    assert.equal(controller.getSnapshot().paused, false);
    assert.equal(readAudioFrame().active, true, "the tone is heard again");
    assert.equal(waiting(), 0);

    // "suspended" is the same thing on other browsers, and can repeat.
    context.change("suspended");
    assert.equal(controller.getSnapshot().paused, true);
    context.change("suspended");
    assert.equal(waiting(), 3, "a repeated state adds no second listener");
    context.change("running");
    assert.equal(controller.getSnapshot().paused, false);
    assert.equal(waiting(), 0);

    // Stopping while paused leaves nothing behind.
    context.change("interrupted");
    assert.equal(controller.getSnapshot().paused, true);
    controller.stop();
    assert.equal(controller.getSnapshot().paused, false);
    assert.equal(controller.getSnapshot().status, "idle");
    assert.equal(waiting(), 0);
    assert.equal(context.closed, true);
    assert.equal(context.onstatechange, null);
    context.change("running"); // a late event from the closed engine
    assert.equal(controller.getSnapshot().paused, false);
  } finally {
    controller.dispose();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
