/** Ephemeral, normalized audio features. Raw microphone/system samples never leave this process. */
export interface AudioFrame {
  active: boolean;
  level: number;
  bass: number;
  mid: number;
  treble: number;
  beat: number;
}

export interface AudioOptions {
  gain: number;
  noiseFloor: number;
  smoothing: number;
}

export const SILENT_AUDIO: AudioFrame = Object.freeze({
  active: false,
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  beat: 0,
});
export const DEFAULT_AUDIO_OPTIONS: AudioOptions = Object.freeze({
  gain: 1,
  noiseFloor: 0.025,
  smoothing: 0.65,
});
const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function normalizeAudioOptions(
  options: Partial<AudioOptions>,
): AudioOptions {
  return {
    gain: clamp(options.gain ?? DEFAULT_AUDIO_OPTIONS.gain, 0.25, 4),
    noiseFloor: clamp(
      options.noiseFloor ?? DEFAULT_AUDIO_OPTIONS.noiseFloor,
      0,
      0.2,
    ),
    smoothing: clamp(
      options.smoothing ?? DEFAULT_AUDIO_OPTIONS.smoothing,
      0,
      0.95,
    ),
  };
}

/** RMS after removing DC offset; a constant microphone bias must not pulse the projector. */
export function audioRms(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++)
    sum += Number.isFinite(samples[i]) ? samples[i] : 0;
  const mean = sum / samples.length;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = (Number.isFinite(samples[i]) ? samples[i] : 0) - mean;
    energy += value * value;
  }
  return Math.sqrt(energy / samples.length);
}

/** Integrate FFT power, rather than averaging bins (which unfairly dilutes wider bands). */
export function audioBands(
  frequencyDb: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
) {
  const energy = { bass: 0, mid: 0, treble: 0 };
  if (!(sampleRate > 0 && fftSize > 0)) return energy;
  for (let i = 1; i < frequencyDb.length; i++) {
    const frequency = (i * sampleRate) / fftSize;
    if (frequency < 35 || frequency > 12000 || !Number.isFinite(frequencyDb[i]))
      continue;
    const band = frequency < 250 ? "bass" : frequency < 2000 ? "mid" : "treble";
    energy[band] += Math.pow(10, Math.min(0, frequencyDb[i]) / 10);
  }
  return {
    bass: Math.sqrt(energy.bass),
    mid: Math.sqrt(energy.mid),
    treble: Math.sqrt(energy.treble),
  };
}

/** Independent fast attack / adjustable release envelopes and a restrained onset detector. */
export class AudioAnalysis {
  private frame: AudioFrame = { ...SILENT_AUDIO };
  private baseline = 0;
  private sinceBeat = 1;

  reset() {
    this.frame = { ...SILENT_AUDIO };
    this.baseline = 0;
    this.sinceBeat = 1;
  }

  process(
    samples: ArrayLike<number>,
    frequencyDb: ArrayLike<number>,
    sampleRate: number,
    fftSize: number,
    deltaSeconds: number,
    input: Partial<AudioOptions> = {},
  ): AudioFrame {
    const options = normalizeAudioOptions(input);
    const dt = clamp(deltaSeconds, 0.001, 0.25);
    const rms = audioRms(samples);
    const bands = audioBands(frequencyDb, sampleRate, fftSize);
    const gate = rms > options.noiseFloor;
    const target = (value: number) =>
      gate ? clamp((value - options.noiseFloor) * options.gain * 3) : 0;
    const raw = {
      level: target(rms),
      bass: target(bands.bass),
      mid: target(bands.mid),
      treble: target(bands.treble),
    };
    const next: AudioFrame = { ...this.frame, active: true };
    for (const band of ["level", "bass", "mid", "treble"] as const) {
      const time =
        raw[band] > this.frame[band]
          ? 0.015 + options.smoothing * 0.025
          : 0.055 + options.smoothing * 0.5;
      const value =
        this.frame[band] +
        (raw[band] - this.frame[band]) * (1 - Math.exp(-dt / time));
      next[band] = value < 0.0001 ? 0 : clamp(value);
    }
    const energy = raw.bass * 0.65 + raw.level * 0.35;
    this.sinceBeat += dt;
    const onset =
      gate &&
      energy > 0.07 &&
      energy > this.baseline * 1.5 + 0.025 &&
      this.sinceBeat >= 0.22;
    next.beat = onset
      ? clamp(0.5 + energy)
      : this.frame.beat * Math.exp(-dt / 0.16);
    if (next.beat < 0.0001) next.beat = 0;
    if (onset) this.sinceBeat = 0;
    this.baseline += (energy - this.baseline) * (1 - Math.exp(-dt / 0.32));
    this.frame = next;
    return next;
  }
}
