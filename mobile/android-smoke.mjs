// Looks inside the running Android app and checks that it really started.
//
// A screenshot only shows pixels. This script connects to the app's WebView
// over the Chrome DevTools protocol (through "adb forward"), reloads the page
// so that every console message from startup is seen, and then asserts that
// the app shell and the WebGL preview exist, the preview is not blank and the
// page logged no errors. The result is written to <out>/webview-probe.json.
//
// With --crash it does something else: it kills the web view's process through
// the same connection and checks that the app survives, which is what a phone
// that runs out of memory does to it. The app must stay in the same process and
// bring its screen back (MainActivity restarts the screen when the web view's
// process is gone).
//
// Needs adb on the PATH and a debuggable build of the app that is already
// running. With --port it talks to any DevTools port instead (no adb), which
// is how the script is tried out against headless Chromium.
//
//   node mobile/android-smoke.mjs --out android-smoke
//   node mobile/android-smoke.mjs --crash --out android-smoke
//   node mobile/android-smoke.mjs --port 9333 --url-prefix http://127.0.0.1:5193 --out /tmp/probe

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CdpSession, listTargets, waitForPage } from "./cdp.mjs";
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
    crash: { type: "boolean", default: false },
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
// favicon.ico by themselves and the app, correctly, ships none. Capacitor's
// SystemBars plugin writes the safe area insets into the page and logs "Error
// injecting safe area CSS" when the first insets arrive before the page has a
// document; it writes them again as soon as the page is visible.
const ignorable = (text, url) =>
  /\/favicon\.ico\b|Error injecting safe area CSS/.test(`${text} ${url ?? ""}`);

function describeArgument(argument) {
  return String(argument.value ?? argument.description ?? argument.type);
}

// The id of the app's process, or "" when it is not running.
function appPid(packageName) {
  try {
    return adb("shell", "pidof", "-s", packageName);
  } catch {
    return "";
  }
}

// Stops the web view's process the way a phone that runs out of memory does,
// then waits for the app to start its screen again. Without the restart in
// MainActivity, Android closes the whole app, so the app has to stay in the
// same process and a new page with the app shell has to appear.
async function crashAndRecover() {
  if (values.port) throw new Error("--crash needs an emulator or a phone.");
  mkdirSync(values.out, { recursive: true });
  const pidBefore = appPid(values.package);
  if (!pidBefore) throw new Error("The app is not running.");
  const port = await forwardDevTools(values.package);
  const first = await waitForPage(port, values["url-prefix"], timeoutMs);
  log(
    `Stopping the web view process of ${values.package} (app process ${pidBefore}).`,
  );
  const session = await CdpSession.open(first.webSocketDebuggerUrl);
  // The page cannot answer, its process is gone as soon as the command runs.
  await session.send("Page.crash", {}, 5000).catch(() => {});
  session.close();
  const stoppedAt = Date.now();

  // The restarted screen is a new page with a new id.
  const deadline = stoppedAt + timeoutMs;
  let page = null;
  let last = "no answer from DevTools yet";
  while (!page && Date.now() < deadline) {
    await sleep(1000);
    if (!appPid(values.package)) {
      throw new Error(
        "The app closed when its web view process was stopped, so nothing restarted the screen.",
      );
    }
    try {
      const targets = await listTargets(port);
      page =
        targets.find(
          (target) =>
            target.type === "page" &&
            target.id !== first.id &&
            target.url.startsWith(values["url-prefix"]) &&
            target.webSocketDebuggerUrl,
        ) ?? null;
      if (!page)
        last = `pages seen: ${targets.map((target) => `${target.type} ${target.id === first.id ? "(the old page) " : ""}${target.url}`).join(", ") || "none"}`;
    } catch (error) {
      last = String(error?.message ?? error).split("\n")[0];
    }
  }
  if (!page) {
    throw new Error(
      `No new page appeared within ${values.timeout} seconds of stopping the web view process (${last}).`,
    );
  }
  log(`A new page appeared after ${Date.now() - stoppedAt} ms.`);

  // The page may still be loading, so a failed read is tried again.
  const options = {
    shell: SHELL_SELECTOR,
    canvas: CANVAS_SELECTOR,
    timeout: timeoutMs,
    settle: 3000,
  };
  let probe = null;
  let readError = "";
  for (let attempt = 1; attempt <= 3 && !probe?.facts; attempt += 1) {
    try {
      const recovered = await CdpSession.open(page.webSocketDebuggerUrl);
      const evaluated = await recovered.send(
        "Runtime.evaluate",
        {
          expression: `(${probeInPage.toString()})(${JSON.stringify(options)})`,
          awaitPromise: true,
          returnByValue: true,
        },
        timeoutMs + 30_000,
      );
      recovered.close();
      probe = evaluated.result?.value ?? null;
      if (evaluated.exceptionDetails)
        readError = String(
          evaluated.exceptionDetails.exception?.description ??
            evaluated.exceptionDetails.text,
        );
    } catch (error) {
      readError = String(error?.message ?? error);
    }
    if (!probe?.facts) await sleep(2000);
  }

  const pidAfter = appPid(values.package);
  const problems = probe
    ? problemsFrom({ probe }, { native: true })
    : [`The restarted page could not be read: ${readError}`];
  if (pidAfter !== pidBefore) {
    problems.push(
      `The app process changed from ${pidBefore} to ${pidAfter || "none"}.`,
    );
  }
  const report = {
    pidBefore,
    pidAfter,
    oldPage: first.id,
    newPage: page.id,
    millisecondsToNewPage: Date.now() - stoppedAt,
    probe,
    problems,
  };
  writeFileSync(
    join(values.out, "webview-crash.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (problems.length) {
    for (const problem of problems) {
      console.error(`[webview] PROBLEM: ${problem}`);
      console.log(
        `::error title=WebView crash recovery::${problem.replace(/\s+/g, " ").slice(0, 500)}`,
      );
    }
    process.exitCode = 1;
  } else {
    const message = `The web view process was stopped; the app stayed in process ${pidAfter}, started a new page and drew its preview again.`;
    log(message);
    console.log(`::notice title=WebView crash recovery::${message}`);
  }
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
    const lines = [
      `${facts.title}: ${facts.origin}, secure context ${facts.isSecureContext}, Capacitor ${JSON.stringify(facts.capacitor)}`,
      `WebView: ${facts.userAgent}`,
      `WebGL: ${facts.webgl?.renderer} (${facts.webgl?.version})`,
      `Canvas ${facts.pixels.width}x${facts.pixels.height}: ${(facts.pixels.litFraction * 100).toFixed(1)}% lit, ${facts.pixels.distinctColors} colours`,
      `Safe area insets: ${JSON.stringify(facts.safeArea)}; page ${facts.scroll.width}x${facts.scroll.height} in a ${facts.inner.width}x${facts.inner.height} window at ${facts.devicePixelRatio}x; getUserMedia is ${facts.getUserMedia}`,
    ];
    for (const line of lines) log(line);
    // The same facts as one annotation, readable from the run page.
    console.log(`::notice title=WebView probe::${lines.join(" | ")}`);
  }
  if (problems.length) {
    for (const problem of problems) {
      console.error(`[webview] PROBLEM: ${problem}`);
      console.log(
        `::error title=WebView probe::${problem.replace(/\s+/g, " ").slice(0, 500)}`,
      );
    }
    process.exitCode = 1;
  } else {
    log("The app started, drew its preview and logged no errors.");
  }
}

(values.crash ? crashAndRecover : main)().catch((error) => {
  const text = String(error?.message ?? error)
    .replace(/\s+/g, " ")
    .slice(0, 500);
  console.error(`[webview] PROBLEM: ${text}`);
  console.log(
    `::error title=${values.crash ? "WebView crash recovery" : "WebView probe"}::${text}`,
  );
  process.exitCode = 1;
});
