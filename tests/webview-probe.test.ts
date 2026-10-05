import assert from "node:assert/strict";
import test from "node:test";
import { problemsFrom } from "../mobile/webview-probe.mjs";

// What the Android emulator test sees when it reads the preview canvas inside
// the WebView (mobile/android-smoke.mjs).
function probeWith(pixels: { litFraction: number; distinctColors: number }) {
  return {
    waited: { shell: true, canvas: true, canvasSized: true },
    facts: {
      webgl: { contextLost: false },
      renderError: "",
      pixels: { read: true, ...pixels },
      capacitor: { native: true },
      isSecureContext: true,
    },
  };
}

test("the page probe accepts the alignment outline, which draws only a few colours", () => {
  // Measured: 6 distinct colours, more than half the canvas lit, on the phone
  // sized page in headless Chromium and on the Android emulators.
  const probe = probeWith({ litFraction: 0.56, distinctColors: 6 });
  assert.deepEqual(problemsFrom({ probe }, { native: true }), []);
});

test("the page probe still rejects a blank or flat preview canvas", () => {
  for (const pixels of [
    { litFraction: 0, distinctColors: 1 },
    { litFraction: 0.9, distinctColors: 1 },
    { litFraction: 0.5, distinctColors: 3 },
  ]) {
    const problems = problemsFrom(
      { probe: probeWith(pixels) },
      { native: true },
    );
    assert.ok(problems.length > 0, JSON.stringify(pixels));
  }
});
