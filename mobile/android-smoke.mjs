// Looks inside the running Android app and checks that it really started.
//
// A screenshot only shows pixels. This script connects to the app's WebView
// over the Chrome DevTools protocol (through "adb forward"), reloads the page
// so that every console message from startup is seen, and then asserts that
// the app shell and the WebGL preview exist, the preview is not blank and the
// page logged no errors. The result is written to <out>/webview-probe.json.
//
// Needs adb on the PATH and a debuggable build of the app that is already
// running. With --port it talks to any DevTools port instead (no adb), which
// is how the script is tried out against headless Chromium.
//
//   node mobile/android-smoke.mjs --out android-smoke
//   node mobile/android-smoke.mjs --port 9333 --url-prefix http://127.0.0.1:5193 --out /tmp/probe

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CdpSession, waitForPage } from "./cdp.mjs";
import {
  CANVAS_SELECTOR,
  SHELL_SELECTOR,
  probeInPage,
  problemsFrom,
} from "./webview-probe.mjs";

const { values } = parseArgs({
  options: {
    package: { type: "string", default: "org.prismmapper.mobile" },
    out: { type: "string", default: "android-smoke" },
    port: { type: "string" },
    "url-prefix": { type: "string", default: "https://localhost" },
    native: { type: "boolean", default: false },
    timeout: { type: "string", default: "60" },
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (text) => console.log(`[webview] ${text}`);
const timeoutMs = Number(values.timeout) * 1000;
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" }).trim();

// The WebView listens on an abstract socket named after the app's process id.
async function forwardDevTools(packageName) {
  const deadline = Date.now() + timeoutMs;
  let last = "the app is not running";
  while (Date.now() < deadline) {
    try {
      const pid = adb("shell", "pidof", "-s", packageName);
      if (pid) {
        const sockets =
          adb("shell", "cat", "/proc/net/unix").match(
            /webview_devtools_remote_\d+/g,
          ) ?? [];
        const own = sockets.find((name) => name.endsWith(`_${pid}`));
        if (own) {
          const port = adb("forward", "tcp:0", `localabstract:${own}`);
          log(`Forwarded ${own} to local port ${port}.`);
          return Number(port);
        }
        last = `process ${pid} has no DevTools socket (${sockets.length} sockets seen); is this a debuggable build?`;
      }
    } catch (error) {
      last = String(error?.message ?? error).split("\n")[0];
    }
    await sleep(1000);
  }
  throw new Error(`Could not reach the WebView DevTools: ${last}`);
}

// Console messages that say nothing about the app. Browsers ask for a
// favicon.ico by themselves and the app, correctly, ships none.
const ignorable = (text, url) =>
  /\/favicon\.ico\b/.test(`${text} ${url ?? ""}`);

function describeArgument(argument) {
  return String(argument.value ?? argument.description ?? argument.type);
}

async function main() {
  mkdirSync(values.out, { recursive: true });
  const port = values.port
    ? Number(values.port)
    : await forwardDevTools(values.package);

  const page = await waitForPage(port, values["url-prefix"], timeoutMs);
  log(`Inspecting ${page.url}`);
  const session = await CdpSession.open(page.webSocketDebuggerUrl);

  const consoleErrors = new Set();
  const pageErrors = new Set();
  session.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type !== "error" && type !== "assert") return;
    const text = args.map(describeArgument).join(" ");
    if (!ignorable(text)) consoleErrors.add(text);
  });
  session.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    pageErrors.add(
      exceptionDetails.exception?.description ?? exceptionDetails.text,
    );
  });
  session.on("Log.entryAdded", ({ entry }) => {
    if (entry.level !== "error" || ignorable(entry.text, entry.url)) return;
    consoleErrors.add(`${entry.text}${entry.url ? ` (${entry.url})` : ""}`);
  });

  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Log.enable");
  // Reloading makes sure that nothing logged during startup is missed.
  const loaded = session.once("Page.loadEventFired", timeoutMs);
  await session.send("Page.reload", { ignoreCache: true });
  await loaded;

  const options = {
    shell: SHELL_SELECTOR,
    canvas: CANVAS_SELECTOR,
    timeout: timeoutMs,
    settle: 3000,
  };
  const evaluated = await session.send(
    "Runtime.evaluate",
    {
      expression: `(${probeInPage.toString()})(${JSON.stringify(options)})`,
      awaitPromise: true,
      returnByValue: true,
    },
    timeoutMs + 30_000,
  );
  if (evaluated.exceptionDetails) {
    pageErrors.add(
      `The probe failed: ${evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text}`,
    );
  }
  // Give late asynchronous errors a moment to arrive before closing.
  await sleep(1500);
  session.close();

  const probe = evaluated.result?.value ?? null;
  const problems = problemsFrom(
    { probe, consoleErrors: [...consoleErrors], pageErrors: [...pageErrors] },
    { native: values.native },
  );
  const report = {
    url: page.url,
    probe,
    consoleErrors: [...consoleErrors],
    pageErrors: [...pageErrors],
    problems,
  };
  writeFileSync(
    join(values.out, "webview-probe.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const facts = probe?.facts;
  if (facts) {
    log(
      `${facts.title}: ${facts.origin}, secure context ${facts.isSecureContext}, Capacitor ${JSON.stringify(facts.capacitor)}`,
    );
    log(`WebView: ${facts.userAgent}`);
    log(`WebGL: ${facts.webgl?.renderer} (${facts.webgl?.version})`);
    log(
      `Canvas ${facts.pixels.width}x${facts.pixels.height}: ${(facts.pixels.litFraction * 100).toFixed(1)}% lit, ${facts.pixels.distinctColors} colours`,
    );
    log(
      `Safe area insets: ${JSON.stringify(facts.safeArea)}; page ${facts.scroll.width}x${facts.scroll.height} in a ${facts.inner.width}x${facts.inner.height} window`,
    );
  }
  if (problems.length) {
    for (const problem of problems)
      console.error(`[webview] PROBLEM: ${problem}`);
    process.exitCode = 1;
  } else {
    log("The app started, drew its preview and logged no errors.");
  }
}

main().catch((error) => {
  console.error(`[webview] PROBLEM: ${error?.message ?? error}`);
  process.exitCode = 1;
});
