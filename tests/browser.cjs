// Shared browser launcher for the GPU and UI checks.
//
// Order of preference:
//   1. PRISM_BROWSER_PATH, an explicit Chrome/Chromium executable.
//   2. Installed Google Chrome (what the checks were written against).
//   3. Playwright's own Chromium, so a fresh checkout or a CI box still works.
// Machines without a GPU (CI, containers) get software WebGL when CI or
// PRISM_SOFTWARE_GL is set.
const { chromium } = require("playwright");

const SOFTWARE_GL = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

async function launchBrowser(options = {}) {
  const args = [...(options.args || [])];
  if (process.env.CI || process.env.PRISM_SOFTWARE_GL)
    args.push(...SOFTWARE_GL);
  const base = { headless: true, ...options, args };
  if (process.env.PRISM_BROWSER_PATH)
    return chromium.launch({
      ...base,
      executablePath: process.env.PRISM_BROWSER_PATH,
    });
  try {
    return await chromium.launch({ ...base, channel: "chrome" });
  } catch (chromeError) {
    try {
      return await chromium.launch(base);
    } catch {
      throw chromeError;
    }
  }
}

module.exports = { launchBrowser };
