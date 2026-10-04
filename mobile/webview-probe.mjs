// Checks that the Prism Mapper web app really started inside a page.
//
// The Android emulator smoke test (mobile/android-smoke.mjs) connects to the
// app's debuggable WebView over the Chrome DevTools protocol and runs
// probeInPage() inside the page. The same function runs unchanged in any
// Chromium page, which is how it is tried out on a development machine
// without an emulator.
//
// probeInPage() never throws for a failing app. It returns what it saw, and
// problemsFrom() turns that plus the collected console output into a list of
// human readable problems. An empty list means the app started, drew
// something and logged no errors.

export const SHELL_SELECTOR = ".app-shell";
export const CANVAS_SELECTOR = ".stage canvas";

// Runs inside the page, so it must not use anything from this module. The
// caller serialises it with probeInPage.toString(). The result must be JSON.
export function probeInPage({
  shell,
  canvas: canvasSelector,
  timeout,
  settle,
}) {
  const started = Date.now();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waited = { shell: false, canvas: false, canvasSized: false };

  const look = () => {
    const canvas = document.querySelector(canvasSelector);
    waited.shell = Boolean(document.querySelector(shell));
    waited.canvas = Boolean(canvas);
    waited.canvasSized = Boolean(
      canvas && canvas.width > 100 && canvas.height > 50,
    );
  };

  const collect = (frameSeen) => {
    const root = getComputedStyle(document.documentElement);
    const shellBox = document.querySelector(shell)?.getBoundingClientRect();
    const canvas = document.querySelector(canvasSelector);
    const gl = canvas ? canvas.getContext("webgl") : null;
    const debug = gl && gl.getExtension("WEBGL_debug_renderer_info");
    let pixels = { read: false };
    if (canvas && gl) {
      // The renderer does not preserve its drawing buffer, so the pixels are
      // read inside the animation frame that follows its own draw call.
      const width = canvas.width;
      const height = canvas.height;
      const buffer = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
      const colors = new Set();
      let lit = 0;
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 4) {
        const r = buffer[i];
        const g = buffer[i + 1];
        const b = buffer[i + 2];
        if (Math.max(r, g, b) > 24) lit++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
        sum += r + g + b;
      }
      const count = width * height;
      pixels = {
        read: true,
        width,
        height,
        litFraction: lit / count,
        distinctColors: colors.size,
        meanChannel: sum / (count * 3),
      };
    }
    const capacitor = window.Capacitor;
    return {
      href: location.href,
      origin: location.origin,
      title: document.title,
      visibility: document.visibilityState,
      frameSeen,
      isSecureContext: window.isSecureContext,
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      inner: { width: window.innerWidth, height: window.innerHeight },
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      shell: shellBox
        ? {
            width: Math.round(shellBox.width),
            height: Math.round(shellBox.height),
          }
        : null,
      capacitor: capacitor
        ? {
            native: Boolean(capacitor.isNativePlatform?.()),
            platform: capacitor.getPlatform?.() ?? null,
          }
        : null,
      safeArea: ["top", "right", "bottom", "left"].reduce((all, side) => {
        all[side] = root.getPropertyValue(`--safe-area-inset-${side}`).trim();
        return all;
      }, {}),
      getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
      webgl: gl
        ? {
            renderer: debug
              ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER),
            version: gl.getParameter(gl.VERSION),
            contextLost: gl.isContextLost(),
          }
        : null,
      renderError: canvas?.dataset.renderError ?? "",
      pixels,
    };
  };

  return (async () => {
    look();
    while (!waited.canvasSized && Date.now() - started < timeout) {
      await sleep(250);
      look();
    }
    if (!waited.canvasSized) return { waited, facts: null };
    // Let the render loop run for a moment before sampling pixels.
    await sleep(settle);
    // A hidden page gets no animation frames, so do not wait for one forever.
    const frame = await Promise.race([
      new Promise((resolve) => requestAnimationFrame(() => resolve(true))),
      sleep(5000).then(() => false),
    ]);
    try {
      return { waited, facts: collect(frame) };
    } catch (error) {
      return {
        waited,
        facts: null,
        error: String(error && error.message ? error.message : error),
      };
    }
  })();
}

// Turns a probe result into a list of problems.
//   probe      what probeInPage() returned
//   consoleErrors, pageErrors   messages collected outside the page
//   native     true when the page must be running inside a Capacitor shell
export function problemsFrom(
  { probe, consoleErrors = [], pageErrors = [] },
  { native = false } = {},
) {
  const problems = [];
  if (!probe) return ["The page could not be inspected at all."];
  const { waited, facts } = probe;
  if (!waited.shell)
    problems.push(`The ${SHELL_SELECTOR} element never appeared.`);
  else if (!waited.canvas)
    problems.push(`The ${CANVAS_SELECTOR} element never appeared.`);
  else if (!waited.canvasSized)
    problems.push("The preview canvas never got a size.");
  if (!facts) {
    if (probe.error) problems.push(`Reading the page failed: ${probe.error}`);
    return withMessages(problems, consoleErrors, pageErrors);
  }
  if (!facts.webgl) problems.push("The preview canvas has no WebGL context.");
  else if (facts.webgl.contextLost)
    problems.push("The WebGL context was lost.");
  if (facts.renderError)
    problems.push(`The renderer reported: ${facts.renderError}`);
  if (!facts.pixels.read) problems.push("The canvas pixels could not be read.");
  else {
    if (facts.pixels.litFraction < 0.02) {
      problems.push(
        `The preview canvas looks blank: ${(facts.pixels.litFraction * 100).toFixed(2)}% of pixels are lit.`,
      );
    }
    if (facts.pixels.distinctColors < 8) {
      problems.push(
        `The preview canvas has only ${facts.pixels.distinctColors} distinct colours.`,
      );
    }
  }
  if (native) {
    if (!facts.capacitor?.native) {
      problems.push(
        "window.Capacitor is missing or not native, so the native bridge did not start.",
      );
    }
    if (!facts.isSecureContext) {
      problems.push(
        "The page is not a secure context, so the microphone would be blocked.",
      );
    }
  }
  return withMessages(problems, consoleErrors, pageErrors);
}

function withMessages(problems, consoleErrors, pageErrors) {
  for (const text of consoleErrors) problems.push(`Console error: ${text}`);
  for (const text of pageErrors) problems.push(`Uncaught page error: ${text}`);
  return problems;
}
