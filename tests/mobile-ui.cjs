// Phone and tablet checks for the compact touch layout, touch editing and
// Present mode. Runs real Chromium with mobile emulation (isMobile, hasTouch,
// device scale factor) and real touch input through the DevTools protocol.
// It is emulation: no physical device and no WebKit engine are involved.
const { launchBrowser, baseUrl } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SHOTS = process.env.PRISM_MOBILE_SHOTS || "";

const PHONE = { name: "phone 390x844", width: 390, height: 844 };
const LANDSCAPE = { name: "landscape 844x390", width: 844, height: 390 };
const SMALL = { name: "small phone 360x640", width: 360, height: 640 };
const TABLET = { name: "tablet 820x1180", width: 820, height: 1180 };
const TINY = { name: "tiny phone 320x568", width: 320, height: 568 };
const SHEETS = ["Layers", "Looks", "Adjust", "Audio", "Show"];

// Counts WebGL draw calls per canvas, so a test can tell whether a renderer runs.
const DRAW_COUNTER = () => {
  const counts = new WeakMap();
  window.__draws = (canvas) => counts.get(canvas) || 0;
  for (const Context of [
    window.WebGLRenderingContext,
    window.WebGL2RenderingContext,
  ]) {
    if (!Context) continue;
    for (const name of ["drawArrays", "drawElements"]) {
      const original = Context.prototype[name];
      Context.prototype[name] = function (...args) {
        counts.set(this.canvas, (counts.get(this.canvas) || 0) + 1);
        return original.apply(this, args);
      };
    }
  }
};

async function openApp(browser, device, options = {}) {
  const touch = device.touch !== false;
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    // Layout does not depend on density, and a density of 1 renders three
    // times faster in software. Screenshots for review use 2.
    deviceScaleFactor: device.dpr ?? (SHOTS ? 2 : 1),
    isMobile: touch,
    hasTouch: touch,
    reducedMotion: options.reducedMotion ? "reduce" : "no-preference",
  });
  await context.addInitScript(DRAW_COUNTER);
  if (options.init) await context.addInitScript(options.init);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(30000);
  if (options.setup) await options.setup(page, context);
  await page.goto(new URL(options.route || "", baseUrl()).href);
  await page.waitForSelector(options.selector || ".stage canvas");
  await settle(page);
  const cdp = touch ? await context.newCDPSession(page) : null;
  return {
    browser,
    context,
    page,
    cdp,
    errors,
    device,
    touch: cdp && touchApi(cdp),
  };
}

// Two frames, then every finite CSS animation and transition has finished.
// Software WebGL on a busy machine can take half a second per frame, so the
// test waits for conditions and never for a fixed time.
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every((a) => a.effect?.getComputedTiming().endTime === Infinity),
    undefined,
    { timeout: 20000 },
  );
}

// Real touch events through the protocol: down, move, up, cancel, multi-touch.
// Each event carries its own timestamp from a virtual clock, so taps that must
// be 90 ms apart really are, however slow the machine running the test is.
function touchApi(cdp) {
  let clock = Date.now() / 1000;
  const toPoint = (p, i) => ({
    x: p.x,
    y: p.y,
    id: p.id ?? i,
    radiusX: 2,
    radiusY: 2,
    force: 0.5,
  });
  const send = (type, points) => {
    clock += 0.016;
    return cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(toPoint),
      timestamp: clock,
    });
  };
  const api = {
    down: (...points) => send("touchStart", points),
    move: (...points) => send("touchMove", points),
    up: () => send("touchEnd", []),
    cancel: () => send("touchCancel", []),
    /** Moves the virtual clock forward without waiting in real time. */
    wait: (ms) => {
      clock += ms / 1000;
    },
    async tap(point) {
      await api.down(point);
      api.wait(30);
      await api.up();
    },
    async doubleTap(point, gap = 90) {
      await api.tap(point);
      api.wait(gap);
      await api.tap(point);
    },
    async drag(from, to, steps = 12) {
      await api.down(from);
      for (let i = 1; i <= steps; i++)
        await api.move({
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        });
      await api.up();
    },
  };
  return api;
}

const project = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("prism-draft")));
const pointsOf = (surface) => surface.polygon || surface.corners;
const selectedSurface = async (page) => (await project(page)).surfaces.at(-1);
const nav = (page) => page.getByRole("navigation", { name: "Panels" });
const tab = (page, name) =>
  nav(page).getByRole("button", { name, exact: true });
const strip = (page) => page.locator(".mapping-tools");
const stripButton = (page, name) =>
  strip(page).getByRole("button", { name, exact: true });
const center = (box) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});
const toScreen = (box, p) => ({
  x: box.x + p.x * box.width,
  y: box.y + p.y * box.height,
});
const near = (actual, expected, tolerance, message) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} is not within ${tolerance} of ${expected}`,
  );

async function waitFor(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(40);
  }
  assert.fail(`${message} (last: ${JSON.stringify(last)})`);
}

async function shot(app, name) {
  if (!SHOTS) return;
  await fs.mkdir(SHOTS, { recursive: true });
  await app.page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

// Draws an outline with taps, then closes it by tapping the first point.
async function drawOutline(app, fractions) {
  const { page } = app;
  const before = (await project(page)).surfaces.length;
  await page.getByRole("button", { name: "Line tool", exact: true }).click();
  const box = await page.locator(".stage").boundingBox();
  for (const [fx, fy] of fractions) {
    const at = toScreen(box, { x: fx, y: fy });
    await page.touchscreen.tap(at.x, at.y);
    await sleep(60);
  }
  // Snapping may have nudged the first point, so tap where its handle really is.
  const first = center(
    await page.locator(".draft-handle.first-point").boundingBox(),
  );
  await page.touchscreen.tap(first.x, first.y);
  await waitFor(
    async () => (await project(page)).surfaces.length === before + 1,
    "outline was not closed by tapping the first point",
  );
  await settle(page);
}

async function openSheet(app, name) {
  const button = tab(app.page, name);
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  await waitFor(
    async () => (await button.getAttribute("aria-expanded")) === "true",
    `${name} sheet did not open`,
  );
  await settle(app.page);
}
async function closeSheet(app, name) {
  const button = tab(app.page, name);
  if ((await button.getAttribute("aria-expanded")) === "true")
    await button.click();
  await settle(app.page);
}

const report = [];
const pass = (text) => {
  report.push(text);
  console.log(`PASS ${text}`);
};

// ---------------------------------------------------------------------------

async function layoutChecks(browser, device) {
  // Reduced motion: the checks measure where things end up, not the slide-in.
  const app = await openApp(browser, device, { reducedMotion: true });
  const { page } = app;
  const landscape = device.width > device.height;
  const label = device.name;

  assert.equal(
    await page.locator(".app-shell").getAttribute("data-layout"),
    "compact",
  );
  for (const selector of [
    "footer",
    ".alpha",
    ".getting-started",
    ".stage-caption",
    ".canvas-toolbar",
    ".transport",
    ".mapping-tool-options",
  ])
    assert.equal(
      await page.locator(selector).first().isVisible(),
      false,
      `${label}: ${selector} should be hidden`,
    );
  assert.deepEqual(
    await nav(page).getByRole("button").allInnerTexts(),
    SHEETS,
    `${label}: bottom navigation`,
  );
  const meta = await page.evaluate(
    () => document.querySelector('meta[name="viewport"]').content,
  );
  assert.match(meta, /viewport-fit=cover/);

  // Header: icon buttons keep their names, the project name stays editable.
  for (const name of ["Open", "Save project", "Quick start and shortcuts"]) {
    const box = await page
      .getByRole("button", { name, exact: true })
      .boundingBox();
    assert.ok(
      box && box.width >= 43.5 && box.height >= 43.5,
      `${label}: ${name} target`,
    );
  }
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("Stairwell test");
  assert.equal((await project(page)).name, "Stairwell test");

  // The stage keeps the project's aspect ratio and fits its area.
  const fit = async (minHeight, minWidth, ratio = 1920 / 1080) => {
    const g = await page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return {
        stage: rect(".stage"),
        area: rect(".canvas-area"),
        w: innerWidth,
        h: innerHeight,
      };
    });
    near(g.stage.w / g.stage.h, ratio, 0.03, `${label}: stage aspect`);
    assert.ok(
      g.stage.x >= g.area.x - 0.5 &&
        g.stage.x + g.stage.w <= g.area.x + g.area.w + 0.5,
      `${label}: stage inside area horizontally ${JSON.stringify(g)}`,
    );
    assert.ok(
      g.stage.y >= g.area.y - 0.5 &&
        g.stage.y + g.stage.h <= g.area.y + g.area.h + 0.5,
      `${label}: stage inside area vertically ${JSON.stringify(g)}`,
    );
    assert.ok(
      g.stage.x >= 0 && g.stage.x + g.stage.w <= g.w,
      `${label}: stage inside viewport`,
    );
    assert.ok(
      g.stage.h >= minHeight,
      `${label}: stage height ${g.stage.h} < ${minHeight}`,
    );
    assert.ok(
      g.stage.w >= minWidth,
      `${label}: stage width ${g.stage.w} < ${minWidth}`,
    );
    return g;
  };
  const noScroll = async (state) => {
    const o = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      shell: document.querySelector(".app-shell").scrollWidth,
      inner: innerWidth,
    }));
    assert.ok(
      o.doc <= o.inner && o.body <= o.inner && o.shell <= o.inner,
      `${label} ${state}: horizontal scroll ${JSON.stringify(o)}`,
    );
  };
  await fit(landscape ? 200 : 140, 250);
  await noScroll("closed");

  // Tool strip: the essentials are visible and big enough without a keyboard.
  for (const button of [
    "Select tool",
    "Line tool",
    "Undo",
    "Redo",
    "Blackout",
  ]) {
    const box = await stripButton(page, button).boundingBox();
    assert.ok(
      box && box.width >= 43.5 && box.height >= 43.5,
      `${label}: strip ${button} target ${JSON.stringify(box)}`,
    );
    assert.ok(
      box.x >= -0.5 && box.x + box.width <= device.width + 0.5,
      `${label}: strip ${button} on screen ${JSON.stringify(box)}`,
    );
  }
  assert.ok(
    (await stripButton(page, "Pause playback").count()) === 1,
    `${label}: play and pause reachable`,
  );

  // Sheets: one at a time, aria-expanded and controls, size limits, toggling.
  const navBox = await nav(page).boundingBox();
  for (const sheet of SHEETS) {
    await openSheet(app, sheet);
    const states = await page.evaluate(() =>
      [...document.querySelectorAll(".bottom-nav button")].map((b) => [
        b.textContent.trim(),
        b.getAttribute("aria-expanded"),
      ]),
    );
    assert.deepEqual(
      states,
      SHEETS.map((s) => [s, String(s === sheet)]),
      `${label}: only ${sheet} is expanded`,
    );
    const controls = await tab(page, sheet).getAttribute("aria-controls");
    const panel = page.locator(`#${controls}`);
    assert.equal(
      await panel.isVisible(),
      true,
      `${label}: ${sheet} panel visible`,
    );
    assert.equal(
      await page.getByRole("region", { name: sheet, exact: true }).count(),
      1,
      `${label}: ${sheet} region name`,
    );
    const other = controls === "sheet-left" ? "#sheet-right" : "#sheet-left";
    assert.equal(
      await page.locator(other).isVisible(),
      false,
      `${label}: the other panel is hidden`,
    );
    const box = await panel.boundingBox();
    if (landscape) {
      const workspace = await page.locator(".workspace").boundingBox();
      near(
        box.width / workspace.width,
        0.45,
        0.02,
        `${label}: drawer is 45% wide`,
      );
      near(
        box.x + box.width,
        workspace.x + workspace.width,
        1.5,
        `${label}: drawer on the right`,
      );
      assert.ok(
        box.y + box.height >= device.height - 1.5,
        `${label}: drawer reaches the bottom`,
      );
      assert.ok(
        navBox.x >= box.x + box.width - 1.5,
        `${label}: nav rail beside the drawer`,
      );
    } else {
      assert.ok(
        box.height <= device.height * 0.55 + 1,
        `${label}: ${sheet} sheet ${box.height} is over 55%`,
      );
      assert.ok(
        box.width >= device.width - 1,
        `${label}: ${sheet} sheet spans the width`,
      );
      near(
        box.y + box.height,
        navBox.y,
        1.5,
        `${label}: ${sheet} sits on the nav`,
      );
      await fit(130, 230);
    }
    await noScroll(sheet);
    // Every control the sheet exposes can be hit with a finger.
    const small = await page.evaluate((selector) => {
      const bad = [];
      for (const el of document.querySelectorAll(
        `${selector} button, ${selector} select, ${selector} input:not([type=hidden])`,
      )) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden") continue;
        if (el.type === "checkbox" || el.type === "radio") continue;
        if (r.height < 43.5)
          bad.push(
            `${el.getAttribute("aria-label") || el.textContent.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
      }
      return bad;
    }, `#${controls}`);
    assert.deepEqual(
      small,
      [],
      `${label}: ${sheet} has controls under 44px tall`,
    );
    await shot(app, `${device.width}x${device.height}-${sheet.toLowerCase()}`);
  }

  // The stage follows the project's own aspect ratio, whatever the canvas is.
  await openSheet(app, "Show");
  const resolution = page.getByRole("combobox", { name: "Canvas resolution" });
  await resolution.selectOption("1024x768");
  await settle(page);
  await fit(landscape ? 100 : 90, 150, 1024 / 768);
  await closeSheet(app, "Show");
  await fit(landscape ? 100 : 90, 150, 1024 / 768);
  await openSheet(app, "Show");
  await resolution.selectOption("1920x1200");
  await closeSheet(app, "Show");
  await fit(landscape ? 100 : 90, 150, 1920 / 1200);
  await openSheet(app, "Show");
  await resolution.selectOption("1920x1080");
  await closeSheet(app, "Show");
  await fit(landscape ? 100 : 90, 150);

  // Close paths: active tab, close button, backdrop, Escape. Focus returns to the tab.
  await openSheet(app, "Layers");
  await tab(page, "Layers").click();
  await waitFor(
    async () =>
      (await tab(page, "Layers").getAttribute("aria-expanded")) === "false",
    "active tab did not close the sheet",
  );
  await openSheet(app, "Layers");
  await page.getByRole("button", { name: "Close Layers panel" }).click();
  await waitFor(
    async () =>
      (await tab(page, "Layers").getAttribute("aria-expanded")) === "false",
    "close button did not close the sheet",
  );
  await openSheet(app, "Adjust");
  const area = await page.locator(".canvas-area").boundingBox();
  await page.mouse.click(area.x + 2, area.y + 2);
  await waitFor(
    async () =>
      (await tab(page, "Adjust").getAttribute("aria-expanded")) === "false",
    "backdrop did not close the sheet",
  );
  await openSheet(app, "Looks");
  await page.keyboard.press("Escape");
  await waitFor(
    async () =>
      (await tab(page, "Looks").getAttribute("aria-expanded")) === "false",
    "Escape did not close the sheet",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "nav-looks",
    `${label}: focus returns to the tab`,
  );
  // Switching is direct: Layers then Show leaves only Show open, and focus moved in.
  await openSheet(app, "Layers");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "sheet-left",
    `${label}: focus moves into the sheet`,
  );
  await openSheet(app, "Show");
  assert.equal(
    await tab(page, "Layers").getAttribute("aria-expanded"),
    "false",
  );
  await closeSheet(app, "Show");

  assert.deepEqual(app.errors, [], `${label}: page errors`);
  await app.context.close();
  pass(
    `${label}: compact layout, ${SHEETS.length} sheets, close paths, target sizes, no horizontal scroll`,
  );
}

async function safeAreaChecks(browser) {
  const app = await openApp(browser, { ...PHONE, dpr: 1 });
  const { page } = app;
  const topBefore = (await page.locator(".topbar").boundingBox()).height;
  const navBefore = (await nav(page).boundingBox()).height;
  const stageBefore = await page.locator(".stage").boundingBox();
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty("--safe-area-inset-top", "24px");
    style.setProperty("--safe-area-inset-bottom", "18px");
  });
  await settle(page);
  const top = await page.locator(".topbar").boundingBox();
  near(top.height - topBefore, 24, 0.5, "header grows by the top inset");
  const button = await page
    .getByRole("button", { name: "Open", exact: true })
    .boundingBox();
  assert.ok(button.y >= 24, "header buttons sit below the notch");
  const navBox = await nav(page).boundingBox();
  near(
    navBox.y + navBox.height,
    PHONE.height,
    1,
    "nav reaches the bottom edge",
  );
  near(navBox.height - navBefore, 18, 0.5, "nav grows by the bottom inset");
  const first = await tab(page, "Layers").boundingBox();
  assert.ok(
    first.y + first.height <= PHONE.height - 18 + 0.5,
    "nav buttons clear the home indicator",
  );
  const stage = await page.locator(".stage").boundingBox();
  assert.ok(
    stage.y + stage.height <= navBox.y,
    "the stage never sits under the nav",
  );
  assert.ok(
    stage.height <= stageBefore.height + 0.5,
    "the insets take room from the stage, not the other way",
  );
  await app.context.close();

  const side = await openApp(browser, LANDSCAPE);
  await side.page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty("--safe-area-inset-left", "44px");
    style.setProperty("--safe-area-inset-right", "44px");
  });
  await settle(side.page);
  const rail = await tab(side.page, "Layers").boundingBox();
  assert.ok(
    rail.x + rail.width <= LANDSCAPE.width - 44 + 0.5,
    `nav rail clears the notch: ${JSON.stringify(rail)}`,
  );
  const select = await stripButton(side.page, "Select tool").boundingBox();
  assert.ok(select.x >= 44, `strip clears the left notch: ${select.x}`);
  const help = await side.page
    .getByRole("button", { name: "Quick start and shortcuts", exact: true })
    .boundingBox();
  assert.ok(
    help.x + help.width <= LANDSCAPE.width - 44 + 0.5,
    "header clears the right notch",
  );
  await side.context.close();
  pass("safe areas: --safe-area-inset-* moves the header, nav rail and strip");
}

// A tablet in landscape is wide enough for the desktop layout. That layout has
// to keep clear of the same insets, and must not move at all without them.
async function wideSafeAreaChecks(browser) {
  const wide = { name: "tablet 1180x820", width: 1180, height: 820, dpr: 1 };
  const app = await openApp(browser, wide);
  const { page } = app;
  const shell = page.locator(".app-shell");
  assert.equal(await shell.getAttribute("data-layout"), "desktop");
  const rect = (selector) =>
    page.evaluate((selector) => {
      const { x, y, width, height } = document
        .querySelector(selector)
        .getBoundingClientRect();
      return { x, y, width, height };
    }, selector);
  const bare = { shell: await rect(".app-shell"), top: await rect(".topbar") };
  assert.deepEqual(bare.shell, { x: 0, y: 0, width: 1180, height: 820 });
  assert.deepEqual(
    { x: bare.top.x, y: bare.top.y, width: bare.top.width },
    { x: 0, y: 0, width: 1180 },
  );
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty("--safe-area-inset-top", "24px");
    style.setProperty("--safe-area-inset-bottom", "20px");
    style.setProperty("--safe-area-inset-left", "10px");
    style.setProperty("--safe-area-inset-right", "12px");
  });
  await settle(page);
  const top = await rect(".topbar");
  near(top.y, 24, 0.5, "the header starts below the status bar");
  near(top.height, bare.top.height, 0.5, "the header is not made taller");
  near(top.x, 10, 0.5, "the header clears the left edge");
  near(top.x + top.width, 1180 - 12, 0.5, "the header clears the right edge");
  const footer = await rect("footer");
  near(
    footer.y + footer.height,
    820 - 20,
    0.5,
    "the footer sits above the home indicator",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
    true,
    "the page does not scroll",
  );
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.querySelector(".app-shell")).height,
    ),
    "820px",
    "the layout is exactly as tall as the visible page",
  );
  // A notice rises with the footer instead of sitting on the home indicator.
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.locator(".toast").waitFor();
  const toast = await rect(".toast");
  assert.ok(
    toast.y + toast.height <= 820 - 20 - 47 + 0.5,
    `the notice clears the home indicator: ${JSON.stringify(toast)}`,
  );
  assert.deepEqual(app.errors, []);
  await app.context.close();
  pass(
    "safe areas, wide tablet: the desktop layout takes the insets and 100dvh, and is unchanged without them",
  );
}

async function cssChecks(browser) {
  const app = await openApp(browser, PHONE);
  const { page } = app;
  const style = await page.evaluate(() => {
    const read = (selector, property) =>
      getComputedStyle(document.querySelector(selector))[property];
    return {
      stageTouch: read(".stage", "touchAction"),
      stageSelect: read(".stage", "userSelect"),
      handleTouch: read(".corner-handle", "touchAction"),
      shellTouch: read(".app-shell", "touchAction"),
      buttonTouch: read(".bottom-nav button", "touchAction"),
      stripButtonTouch: read(".mapping-tools > button", "touchAction"),
      overscroll: getComputedStyle(document.documentElement)
        .overscrollBehaviorY,
      bodyOverscroll: getComputedStyle(document.body).overscrollBehaviorY,
      highlight: read(".app-shell", "webkitTapHighlightColor"),
      handleHit: getComputedStyle(
        document.querySelector(".corner-handle"),
        "::before",
      ).width,
      height: read(".app-shell", "height"),
    };
  });
  assert.equal(style.stageTouch, "none");
  assert.equal(style.stageSelect, "none");
  assert.equal(style.handleTouch, "none");
  assert.equal(style.shellTouch, "manipulation");
  assert.equal(style.buttonTouch, "manipulation");
  assert.equal(style.overscroll, "none");
  assert.equal(style.bodyOverscroll, "none");
  assert.equal(style.highlight, "rgba(0, 0, 0, 0)");
  assert.ok(
    parseFloat(style.handleHit) >= 44,
    `corner handle hit area ${style.handleHit}`,
  );
  assert.equal(
    parseFloat(style.height),
    PHONE.height,
    "the shell fills the dynamic viewport",
  );

  // A long press or right click on the stage must not open a callout menu.
  const prevented = await page.evaluate(() => {
    const stage = document.querySelector(".stage");
    const touch = new PointerEvent("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
      pointerId: 91,
    });
    stage.dispatchEvent(touch);
    const menu = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    stage.dispatchEvent(menu);
    return menu.defaultPrevented;
  });
  assert.equal(
    prevented,
    true,
    "touch context menu is suppressed on the stage",
  );
  assert.deepEqual(app.errors, []);
  await app.context.close();
  pass(
    "css: touch-action, overscroll, selection, tap highlight, 44px handle hit areas, dvh shell, no touch callout",
  );
}

// ---------------------------------------------------------------------------

async function touchEditing(browser) {
  const app = await openApp(browser, { ...PHONE, dpr: 1 });
  const { page, touch } = app;
  const handle = (i) => page.locator(".stage .corner-handle").nth(i);
  const handleCenter = async (i) => center(await handle(i).boundingBox());
  const undoDisabled = () => stripButton(page, "Undo").isDisabled();

  // A tap with a little wobble never moves a point or adds history.
  const before = await project(page);
  const h2 = await handleCenter(1);
  await touch.down(h2);
  for (const [dx, dy] of [
    [2, 1],
    [-1, 2],
    [3, -2],
    [-2, -1],
    [1, 3],
  ])
    await touch.move({ x: h2.x + dx, y: h2.y + dy });
  await touch.up();
  await settle(page);
  assert.deepEqual(
    (await project(page)).surfaces,
    before.surfaces,
    "tap must not move the point",
  );
  assert.equal(await undoDisabled(), true, "a tap leaves no undo step");

  // A drag moves the point with the finger, ending one undo step.
  const box = await page.locator(".stage").boundingBox();
  const start = pointsOf((await project(page)).surfaces[0])[2];
  const h3 = await handleCenter(2);
  await touch.drag(h3, { x: h3.x - 40, y: h3.y - 24 }, 20);
  await settle(page);
  const moved = pointsOf((await project(page)).surfaces[0])[2];
  const dx = (moved.x - start.x) * box.width,
    dy = (moved.y - start.y) * box.height;
  assert.ok(dx < -26 && dx > -41, `drag followed the finger on x: ${dx}`);
  assert.ok(dy < -14 && dy > -25, `drag followed the finger on y: ${dy}`);
  assert.equal(await undoDisabled(), false, "the drag is undoable");
  await stripButton(page, "Undo").click();
  await settle(page);
  assert.deepEqual(
    pointsOf((await project(page)).surfaces[0])[2],
    start,
    "one undo restores the point",
  );

  // Grabbing a handle off centre keeps the offset instead of snapping to the finger.
  const offset = { x: h3.x + 14, y: h3.y + 10 };
  await touch.drag(offset, { x: offset.x - 40, y: offset.y }, 20);
  await settle(page);
  const shifted = pointsOf((await project(page)).surfaces[0])[2];
  assert.ok(
    Math.abs((shifted.y - start.y) * box.height) < 2.5,
    `an off-centre grab keeps the vertical offset: ${(shifted.y - start.y) * box.height}`,
  );
  await stripButton(page, "Undo").click();

  // A second finger cannot start a second drag.
  const ref = pointsOf((await project(page)).surfaces[0]);
  const a = await handleCenter(0),
    b = await handleCenter(2);
  await touch.down({ ...a, id: 0 }, { ...b, id: 1 });
  for (let i = 1; i <= 10; i++)
    await touch.move(
      { x: a.x + i * 3, y: a.y + i * 2, id: 0 },
      { x: b.x - i * 3, y: b.y - i * 2, id: 1 },
    );
  await touch.up();
  await settle(page);
  const two = pointsOf((await project(page)).surfaces[0]);
  assert.notDeepEqual(two[0], ref[0], "the first finger moved its point");
  assert.deepEqual(
    two[2],
    ref[2],
    "the second finger did not move a second point",
  );
  await stripButton(page, "Undo").click();
  await settle(page);

  // pointercancel and lostpointercapture end a drag for good.
  const base = pointsOf((await project(page)).surfaces[0]);
  const c = await handleCenter(0);
  await page.evaluate(() => {
    window.__ids = [];
    document.addEventListener(
      "pointerdown",
      (e) => window.__ids.push(e.pointerId),
      true,
    );
  });
  await touch.down(c);
  for (let i = 1; i <= 8; i++) await touch.move({ x: c.x + i * 3, y: c.y });
  await touch.cancel();
  await settle(page);
  const afterCancel = pointsOf((await project(page)).surfaces[0]);
  // A late move for the cancelled finger, a little way along: if the drag were
  // still alive the point would follow it.
  const stray = await page.evaluate(() => {
    const id = window.__ids.at(-1);
    const stage = document.querySelector(".stage");
    const h = document
      .querySelector(".stage .corner-handle")
      .getBoundingClientRect();
    stage.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: id,
        pointerType: "touch",
        isPrimary: true,
        bubbles: true,
        clientX: h.x + h.width / 2 + 30,
        clientY: h.y + h.height / 2 + 6,
      }),
    );
    return id;
  });
  assert.ok(stray !== undefined);
  await settle(page);
  assert.deepEqual(
    pointsOf((await project(page)).surfaces[0]),
    afterCancel,
    "no movement after pointercancel",
  );
  assert.notDeepEqual(
    afterCancel[0],
    base[0],
    "the part of the drag before the cancel stays",
  );
  await stripButton(page, "Undo").click();

  // Playback and blackout are reachable from the strip.
  await stripButton(page, "Pause playback").click();
  await waitFor(
    async () => (await project(page)).playing === false,
    "pause did not apply",
  );
  await stripButton(page, "Resume playback").click();
  await waitFor(
    async () => (await project(page)).playing === true,
    "resume did not apply",
  );
  await stripButton(page, "Blackout").click();
  await waitFor(
    async () => (await project(page)).blackout === true,
    "blackout did not apply",
  );
  assert.equal(
    await stripButton(page, "Restore light").getAttribute("aria-pressed"),
    "true",
  );
  await stripButton(page, "Restore light").click();
  await waitFor(
    async () => (await project(page)).blackout === false,
    "restore did not apply",
  );

  // Drawing with taps: close with the first point, or the button, or cancel.
  await drawOutline(app, [
    [0.22, 0.25],
    [0.72, 0.2],
    [0.78, 0.72],
    [0.3, 0.78],
  ]);
  let surfaces = (await project(page)).surfaces;
  assert.equal(surfaces.length, 2);
  assert.equal(pointsOf(surfaces[1]).length, 4);
  assert.ok(surfaces[1].polygon, "the new layer is an outline");
  await page.getByRole("button", { name: "Line tool", exact: true }).click();
  const hit = await page.evaluate(() => {
    const r = document.querySelector(".stage").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  for (const [fx, fy] of [
    [0.1, 0.1],
    [0.4, 0.1],
    [0.4, 0.4],
  ])
    await page.touchscreen.tap(hit.x + hit.w * fx, hit.y + hit.h * fy);
  const firstHit = await page.evaluate(() => {
    const el = document.querySelector(".draft-handle.first-point");
    return parseFloat(getComputedStyle(el, "::before").width);
  });
  assert.ok(firstHit >= 44, `first point hit area ${firstHit}`);
  // 20px from the first point's centre is still inside the 44px target.
  await page.touchscreen.tap(
    hit.x + hit.w * 0.1 + 15,
    hit.y + hit.h * 0.1 + 10,
  );
  await waitFor(
    async () => (await project(page)).surfaces.length === 3,
    "tapping near the first point should close it",
  );
  await page.getByRole("button", { name: "Line tool", exact: true }).click();
  await page.touchscreen.tap(hit.x + hit.w * 0.5, hit.y + hit.h * 0.5);
  await page.touchscreen.tap(hit.x + hit.w * 0.6, hit.y + hit.h * 0.5);
  assert.equal(
    await page
      .getByRole("button", { name: "Close outline", exact: true })
      .isDisabled(),
    true,
    "two points cannot close",
  );
  // Undo takes back the last point while drawing, like the keyboard.
  await stripButton(page, "Undo").click();
  assert.equal(await page.locator(".draft-handle").count(), 1);
  await page.getByRole("button", { name: "Cancel drawing" }).click();
  assert.equal(await page.locator(".draft-handle").count(), 0);
  assert.equal((await project(page)).surfaces.length, 3);
  // With three points the Close outline button finishes the shape.
  await page.getByRole("button", { name: "Line tool", exact: true }).click();
  for (const [fx, fy] of [
    [0.5, 0.55],
    [0.7, 0.55],
    [0.6, 0.85],
  ])
    await page.touchscreen.tap(hit.x + hit.w * fx, hit.y + hit.h * fy);
  await page
    .getByRole("button", { name: "Close outline", exact: true })
    .click();
  await waitFor(
    async () => (await project(page)).surfaces.length === 4,
    "the Close outline button should finish the outline",
  );
  assert.equal(await page.locator(".draft-handle").count(), 0);
  assert.deepEqual(app.errors, []);
  await app.context.close();
  pass(
    "touch: tap slop, drag, grab offset, second finger ignored, pointercancel, strip controls, tap drawing and close",
  );
}

async function pointEditing(browser) {
  const app = await openApp(browser, { ...PHONE, dpr: 1 });
  const { page, touch } = app;
  await drawOutline(app, [
    [0.2, 0.25],
    [0.75, 0.2],
    [0.8, 0.75],
    [0.3, 0.8],
  ]);
  const box = await page.locator(".stage").boundingBox();
  const count = async () => pointsOf(await selectedSurface(page)).length;
  assert.equal(await count(), 4);

  // Add point splits the edge after the selected point at its midpoint.
  const outline = pointsOf(await selectedSurface(page));
  await stripButton(page, "Add point").click();
  await settle(page);
  const added = pointsOf(await selectedSurface(page));
  assert.equal(added.length, 5);
  near(added[1].x, (outline[0].x + outline[1].x) / 2, 1e-9, "added point x");
  near(added[1].y, (outline[0].y + outline[1].y) / 2, 1e-9, "added point y");
  assert.equal(
    await page
      .locator(".stage .corner-handle")
      .nth(1)
      .getAttribute("class")
      .then((c) => c.includes("active")),
    true,
    "the new point is selected",
  );
  await stripButton(page, "Undo").click();
  await settle(page);
  assert.equal(await count(), 4);

  // A touch double-tap on an edge inserts exactly one point, even when the
  // browser also sends a dblclick right after it (some do, some do not).
  const edgeAt = (a, b) =>
    toScreen(box, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const spot = edgeAt(outline[1], outline[2]);
  await page.evaluate(({ x, y }) => {
    let ups = 0;
    const onUp = () => {
      if (++ups < 2) return;
      document.removeEventListener("pointerup", onUp);
      setTimeout(() => {
        document.querySelector(".stage").dispatchEvent(
          new MouseEvent("dblclick", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
      }, 0);
    };
    document.addEventListener("pointerup", onUp);
  }, spot);
  await touch.doubleTap(spot);
  await waitFor(
    async () => (await count()) === 5,
    "double-tap did not insert a point",
  );
  await settle(page);
  await sleep(300);
  assert.equal(
    await count(),
    5,
    "a dblclick after the double-tap adds nothing",
  );
  // One tap alone adds nothing, and neither do two taps that are far apart.
  const lone = edgeAt(outline[2], outline[3]);
  await touch.tap(lone);
  touch.wait(900);
  await touch.tap(lone);
  await settle(page);
  await sleep(300);
  assert.equal(await count(), 5, "slow taps never add a point");
  await stripButton(page, "Undo").click();
  await settle(page);
  assert.equal(await count(), 4);

  // Nudge pad: exactly 1 px or 10 px of output, the same as the keyboard.
  await openSheet(app, "Adjust");
  const label = page.locator(".nudge-point span");
  const selectedIndex = async () =>
    Number((await label.innerText()).match(/Point (\d+) of/)[1]) - 1;
  const target = async () =>
    pointsOf(await selectedSurface(page))[await selectedIndex()];
  const p0 = await target();
  await page.getByRole("button", { name: "Nudge right", exact: true }).click();
  await settle(page);
  const p1 = await target();
  near((p1.x - p0.x) * 1920, 1, 1e-6, "nudge right moves 1 output px");
  near(p1.y, p0.y, 1e-12, "nudge right keeps y");
  await page
    .getByRole("button", { name: "Nudge 10 pixels", exact: true })
    .click();
  await page.getByRole("button", { name: "Nudge down", exact: true }).click();
  await settle(page);
  const p2 = await target();
  near((p2.y - p1.y) * 1080, 10, 1e-6, "nudge down moves 10 output px");
  await page.getByRole("button", { name: "Nudge up", exact: true }).click();
  await page.getByRole("button", { name: "Nudge left", exact: true }).click();
  await settle(page);
  const p3 = await target();
  near((p3.y - p2.y) * 1080, -10, 1e-6, "nudge up moves 10 output px");
  near((p3.x - p2.x) * 1920, -10, 1e-6, "nudge left moves 10 output px");
  // The keyboard moves the same distance.
  await page
    .getByRole("button", { name: "Nudge 1 pixel", exact: true })
    .click();
  const k0 = await target();
  await page.getByRole("button", { name: "Nudge right", exact: true }).click();
  await settle(page);
  const k1 = await target();
  await page.locator("body").evaluate((el) => el.focus && el.focus());
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("ArrowRight");
  await settle(page);
  const k2 = await target();
  near(
    k2.x - k1.x,
    k1.x - k0.x,
    1e-12,
    "keyboard and pad move the same distance",
  );

  // Point stepper and readout.
  const here = await selectedIndex();
  assert.match(await label.innerText(), new RegExp(`Point ${here + 1} of 4`));
  await page.getByRole("button", { name: "Next point", exact: true }).click();
  assert.match(
    await label.innerText(),
    new RegExp(`Point ${((here + 1) % 4) + 1} of 4`),
  );
  await page
    .getByRole("button", { name: "Previous point", exact: true })
    .click();
  assert.match(await label.innerText(), new RegExp(`Point ${here + 1} of 4`));
  const readout = await page.locator(".nudge-readout").innerText();
  const now = await target();
  assert.match(
    readout.replace(/\s+/g, " "),
    new RegExp(`X ${Math.round(now.x * 1920)} Y ${Math.round(now.y * 1080)}`),
  );

  // Holding an arrow repeats, and a hold is a single undo step.
  const index = await selectedIndex();
  const pointNow = async () => pointsOf(await selectedSurface(page))[index];
  const startX = (await pointNow()).x;
  const right = await page
    .getByRole("button", { name: "Nudge right", exact: true })
    .boundingBox();
  await touch.down(center(right));
  await waitFor(
    async () => Math.round(((await pointNow()).x - startX) * 1920) >= 6,
    "holding the arrow should keep nudging",
    20000,
  );
  await touch.up();
  await settle(page);
  const steps = Math.round(((await pointNow()).x - startX) * 1920);
  assert.ok(steps >= 6, `holding repeats: ${steps} steps`);
  await tab(page, "Adjust").click();
  await stripButton(page, "Undo").click();
  await settle(page);
  near((await pointNow()).x, startX, 1e-12, "one undo reverts the whole hold");

  assert.deepEqual(app.errors, []);
  await app.context.close();
  pass(
    "points: Add point, double-tap once, nudge 1/10 px equals keyboard, stepper, hold repeat is one undo",
  );
}

// ---------------------------------------------------------------------------

async function presentChecks(browser, device) {
  const app = await openApp(browser, device);
  const { page, touch } = app;
  const label = `present ${device.name}`;
  const canvases = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("canvas")].map((c) => window.__draws(c)),
    );
  const centerPixel = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => {
            const c = document.querySelector(".present-root canvas");
            const gl = c.getContext("webgl") || c.getContext("webgl2");
            const out = new Uint8Array(4 * 16 * 16);
            gl.readPixels(
              (c.width / 2) | 0,
              (c.height / 2) | 0,
              16,
              16,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              out,
            );
            let max = 0;
            for (let i = 0; i < out.length; i++)
              if (i % 4 !== 3) max = Math.max(max, out[i]);
            resolve(max);
          }),
        ),
    );
  // The default Aurora quad covers the middle of the output, so light shows there.
  await openSheet(app, "Show");
  assert.equal(
    await page.getByRole("button", { name: "Open projector output" }).count(),
    0,
    "no disabled projector button without the desktop app",
  );
  await page
    .getByRole("button", { name: "Present on this screen", exact: true })
    .click();
  await page.locator(".present-root").waitFor();
  const controls = page.locator(".present-controls");
  const shown = async () =>
    (await controls.evaluate((el) => getComputedStyle(el).visibility)) ===
    "visible";
  assert.equal(await shown(), true, `${label}: controls start visible`);
  await shot(app, `present-${device.width}x${device.height}-controls`);
  const geo = await page.evaluate(() => {
    const r = document
      .querySelector(".present-root canvas")
      .getBoundingClientRect();
    const root = document
      .querySelector(".present-root")
      .getBoundingClientRect();
    const canvas = document.querySelector(".present-root canvas");
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      rootW: root.width,
      rootH: root.height,
      bufferW: canvas.width,
      bufferH: canvas.height,
      editorVisible: getComputedStyle(document.querySelector(".topbar"))
        .visibility,
      background: getComputedStyle(document.querySelector(".present-root"))
        .backgroundColor,
      dialog: document.querySelector(".present-root").getAttribute("role"),
    };
  });
  near(geo.w / geo.h, 1920 / 1080, 0.02, `${label}: output aspect`);
  assert.ok(
    geo.x >= -0.5 &&
      geo.y >= -0.5 &&
      geo.x + geo.w <= geo.rootW + 0.5 &&
      geo.y + geo.h <= geo.rootH + 0.5,
    `${label}: output fits the screen ${JSON.stringify(geo)}`,
  );
  assert.ok(
    Math.abs(geo.w - geo.rootW) < 1.5 || Math.abs(geo.h - geo.rootH) < 1.5,
    `${label}: output is as large as the screen allows`,
  );
  assert.equal(geo.editorVisible, "hidden", `${label}: the editor is hidden`);
  assert.equal(geo.background, "rgb(0, 0, 0)");
  assert.equal(geo.dialog, "dialog");
  assert.ok(
    Math.max(geo.bufferW, geo.bufferH) <= 1280,
    `${label}: drawing buffer is capped (${geo.bufferW}x${geo.bufferH})`,
  );
  assert.ok((await centerPixel()) > 6, `${label}: the output shows light`);

  // The editor renderer is paused while presenting, the present renderer runs.
  const t0 = await canvases();
  await waitFor(
    async () => (await canvases())[1] >= t0[1] + 3,
    `${label}: the present canvas keeps drawing`,
    30000,
  );
  const t1 = await canvases();
  assert.equal(
    t1[0],
    t0[0],
    `${label}: the editor canvas stopped drawing while ${t1[1] - t0[1]} present frames were drawn`,
  );

  // Controls hide by themselves, a tap brings them back, a second tap hides them.
  await waitFor(
    async () => !(await shown()),
    `${label}: controls should auto-hide`,
    15000,
  );
  await shot(app, `present-${device.width}x${device.height}-hidden`);
  await touch.down({ x: device.width / 2, y: device.height / 3 });
  await touch.up();
  await waitFor(shown, `${label}: a tap shows the controls`);
  await touch.down({ x: device.width / 2, y: device.height / 3 });
  await touch.up();
  await waitFor(
    async () => !(await shown()),
    `${label}: a second tap hides the controls`,
  );

  // Keys: B blackout, Space play/pause.
  await page.keyboard.press("b");
  await waitFor(
    async () => (await project(page)).blackout === true,
    `${label}: B blacks out`,
  );
  await sleep(200);
  assert.equal(await centerPixel(), 0, `${label}: blackout renders black`);
  await page.keyboard.press("b");
  await waitFor(
    async () => (await project(page)).blackout === false,
    `${label}: B restores`,
  );
  await page.keyboard.press("Space");
  await waitFor(
    async () => (await project(page)).playing === false,
    `${label}: Space pauses`,
  );
  await page.keyboard.press("Space");
  await waitFor(
    async () => (await project(page)).playing === true,
    `${label}: Space resumes`,
  );

  // Buttons are 44px or more; Blackout and Brightness work with a finger.
  await page.keyboard.press("ArrowDown");
  await waitFor(shown, `${label}: any key shows the controls`);
  for (const name of ["Blackout", "Align", "Brightness", "Exit"]) {
    const box = await controls
      .getByRole("button", { name, exact: true })
      .boundingBox();
    assert.ok(
      box.width >= 44 && box.height >= 44,
      `${label}: ${name} ${JSON.stringify(box)}`,
    );
  }
  await controls.getByRole("button", { name: "Blackout", exact: true }).click();
  await waitFor(
    async () => (await project(page)).blackout === true,
    `${label}: Blackout button`,
  );
  await sleep(150);
  assert.equal(
    await centerPixel(),
    0,
    `${label}: blackout renders black (button)`,
  );
  await controls
    .getByRole("button", { name: "Restore light", exact: true })
    .click();
  await controls
    .getByRole("button", { name: "Brightness", exact: true })
    .click();
  const slider = page.getByRole("slider", {
    name: "Output brightness",
    exact: true,
  });
  await slider.fill("0.3");
  await waitFor(
    async () => Math.abs((await project(page)).brightness - 0.3) < 0.011,
    `${label}: brightness slider`,
  );
  await controls
    .getByRole("button", { name: "Brightness", exact: true })
    .click();

  // Align draws guides and handles on the output and reuses the stage drag logic.
  await controls.getByRole("button", { name: "Align", exact: true }).click();
  await page.locator(".present-guides").waitFor();
  const handles = page.locator(".present-stage .corner-handle");
  assert.equal(await handles.count(), 4);
  const h = center(await handles.nth(2).boundingBox());
  const stage = await page.locator(".present-stage").boundingBox();
  const before = pointsOf((await project(page)).surfaces[0])[2];
  await touch.drag(h, { x: h.x - 30, y: h.y - 18 }, 18);
  await settle(page);
  const after = pointsOf((await project(page)).surfaces[0])[2];
  const dx = (after.x - before.x) * stage.width;
  assert.ok(
    dx < -14 && dx > -31,
    `${label}: aligning drags a point on the output (${dx})`,
  );
  await shot(app, `present-${device.width}x${device.height}-align`);
  // Controls stay while aligning, even after the auto-hide time.
  await sleep(4000);
  assert.equal(await shown(), true, `${label}: controls stay while aligning`);
  await controls.getByRole("button", { name: "Align", exact: true }).click();
  assert.equal(await page.locator(".present-guides").count(), 0);

  // Exit with the button; the editor and its renderer return.
  await controls.getByRole("button", { name: "Exit", exact: true }).click();
  await page.locator(".present-root").waitFor({ state: "detached" });
  await waitFor(
    async () => (await canvases())[0] > t1[0],
    `${label}: editor renderer resumes`,
    30000,
  );
  const c0 = (await canvases())[0];
  await waitFor(
    async () => (await canvases())[0] >= c0 + 2,
    `${label}: editor keeps drawing after Exit`,
    30000,
  );
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.querySelector(".topbar")).visibility,
    ),
    "visible",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "Present on this screen",
    `${label}: focus returns to the button`,
  );

  // Escape exits too, and does not also close the sheet before Present closes.
  await page
    .getByRole("button", { name: "Present on this screen", exact: true })
    .click();
  await page.locator(".present-root").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".present-root").waitFor({ state: "detached" });
  assert.equal(
    await tab(page, "Show").getAttribute("aria-expanded"),
    "true",
    `${label}: Escape left Present only`,
  );
  assert.deepEqual(app.errors, [], `${label}: page errors`);
  await app.context.close();
  pass(
    `${label}: aspect-fit output, paused editor renderer, auto-hide, tap toggle, B/Space/Esc, Blackout, Brightness, Align drag, Exit`,
  );
}

// A stand-in for the Capacitor App plugin that behaves like the real one: every
// listener is called when Back is pressed, and exitApp is counted.
const FAKE_APP_PLUGIN = `
  window.__backListeners = [];
  window.__pressBack = () => {
    for (const callback of [...window.__backListeners])
      callback({ canGoBack: false });
  };
  export const App = {
    addListener: async (name, callback) => {
      window.__backName = name;
      window.__backListeners.push(callback);
      return {
        remove: async () => {
          window.__backListeners = window.__backListeners.filter(
            (listener) => listener !== callback,
          );
        },
      };
    },
    exitApp: async () => {
      window.__exited = (window.__exited || 0) + 1;
    },
  };`;

async function presentPlatform(browser) {
  const urls = [];
  const app = await openApp(browser, PHONE, {
    init: () => {
      window.__wake = { requests: 0, releases: 0 };
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          request: async () => {
            window.__wake.requests++;
            return {
              release: async () => {
                window.__wake.releases++;
              },
            };
          },
        },
      });
      window.__fs = { enters: 0, exits: 0, element: null };
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        get: () => window.__fs.element,
      });
      Element.prototype.requestFullscreen = function () {
        window.__fs.enters++;
        window.__fs.element = this;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      };
      document.exitFullscreen = () => {
        window.__fs.exits++;
        window.__fs.element = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      };
      window.Capacitor = { isNativePlatform: () => true };
    },
    setup: async (page) => {
      page.on("request", (request) => urls.push(request.url()));
      const fake = (body) => (route) =>
        route.fulfill({ contentType: "text/javascript", body });
      await page.route(
        /@capacitor_status-bar\.js/,
        fake(`export const StatusBar = {
          hide: async () => { window.__status = (window.__status || 0) + 1; },
          show: async () => { window.__status = (window.__status || 0) - 1; },
        };`),
      );
      await page.route(/@capacitor_app\.js/, fake(FAKE_APP_PLUGIN));
    },
  });
  const { page } = app;
  // The editor listens for Back from the start; Present adds its own listener.
  await waitFor(
    () => page.evaluate(() => window.__backListeners.length === 1),
    "the editor listens for the Back button",
  );
  await openSheet(app, "Show");
  await page
    .getByRole("button", { name: "Present on this screen", exact: true })
    .click();
  await page.locator(".present-root").waitFor();
  await waitFor(
    () =>
      page.evaluate(
        () =>
          window.__wake.requests >= 1 &&
          window.__fs.enters === 1 &&
          window.__status === 1 &&
          window.__backListeners.length === 2,
      ),
    "platform hooks ran",
  );
  assert.equal(await page.evaluate(() => window.__backName), "backButton");
  // The tab comes back to the foreground: the wake lock is taken again.
  const requests = await page.evaluate(() => window.__wake.requests);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await waitFor(
    () => page.evaluate((n) => window.__wake.requests > n, requests),
    "wake lock is re-acquired",
  );
  // The Android back button leaves Present, and only Present: the editor
  // underneath neither closes its sheet nor leaves the app.
  await page.evaluate(() => window.__pressBack());
  await page.locator(".present-root").waitFor({ state: "detached" });
  await waitFor(
    () =>
      page.evaluate(
        () =>
          window.__wake.releases >= 1 &&
          window.__status === 0 &&
          window.__backListeners.length === 1 &&
          window.__fs.exits === 1,
      ),
    "everything is released on exit",
  );
  assert.equal(await page.evaluate(() => window.__exited), undefined);
  assert.equal(
    await tab(page, "Show").getAttribute("aria-expanded"),
    "true",
    "Back from Present leaves the sheet that was open",
  );

  // Leaving fullscreen with the system gesture leaves Present as well.
  await page
    .getByRole("button", { name: "Present on this screen", exact: true })
    .click();
  await page.locator(".present-root").waitFor();
  await page.evaluate(() => {
    window.__fs.element = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  await page.locator(".present-root").waitFor({ state: "detached" });
  assert.deepEqual(app.errors, []);
  await app.context.close();

  // Without a native shell nothing from Capacitor is even loaded.
  const plain = [];
  const web = await openApp(browser, PHONE, {
    setup: async (page2) => page2.on("request", (r) => plain.push(r.url())),
  });
  await openSheet(web, "Show");
  await web.page
    .getByRole("button", { name: "Present on this screen", exact: true })
    .click();
  await web.page.locator(".present-root").waitFor();
  await sleep(400);
  await web.page.keyboard.press("Escape");
  assert.equal(
    plain.filter((u) => /capacitor/i.test(u)).length,
    0,
    "no Capacitor code is loaded on the web",
  );
  assert.deepEqual(web.errors, []);
  await web.context.close();
  pass(
    "present platform: fullscreen, wake lock + re-acquire, status bar, back button, fullscreen exit, nothing loaded on the web",
  );
}

// The Android back button, in the native shell: close what was opened last,
// and leave the app only from the plain editor.
async function androidBackChecks(browser) {
  const app = await openApp(browser, PHONE, {
    init: () => {
      window.Capacitor = { isNativePlatform: () => true };
    },
    setup: async (page) => {
      await page.route(/@capacitor_app\.js/, (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: FAKE_APP_PLUGIN,
        }),
      );
    },
  });
  const { page } = app;
  await waitFor(
    () => page.evaluate(() => window.__backListeners?.length === 1),
    "the editor listens for the Back button",
  );
  assert.equal(await page.evaluate(() => window.__backName), "backButton");
  const back = () => page.evaluate(() => window.__pressBack());
  const exits = () => page.evaluate(() => window.__exited || 0);
  const helpOpen = () => page.locator(".help-modal").count();
  const expanded = (name) => tab(page, name).getAttribute("aria-expanded");

  // Help sits on top of everything and closes first, with a sheet open under it.
  await openSheet(app, "Layers");
  await page
    .getByRole("button", { name: "Quick start and shortcuts", exact: true })
    .click();
  await page.locator(".help-modal").waitFor();
  await back();
  await waitFor(async () => (await helpOpen()) === 0, "Back closes Help");
  assert.equal(await expanded("Layers"), "true", "the sheet is still open");
  assert.equal(await exits(), 0);

  // Then the sheet.
  await back();
  await waitFor(
    async () => (await expanded("Layers")) === "false",
    "Back closes the sheet",
  );
  assert.equal(await exits(), 0);

  // Then an outline that is half drawn.
  await page.getByRole("button", { name: "Line tool", exact: true }).click();
  const box = await page.locator(".stage").boundingBox();
  const at = toScreen(box, { x: 0.3, y: 0.3 });
  await page.touchscreen.tap(at.x, at.y);
  await page.locator(".drawing-instructions").waitFor();
  await back();
  await page.locator(".drawing-instructions").waitFor({ state: "detached" });
  assert.equal(await exits(), 0, "cancelling a drawing does not leave the app");
  assert.equal((await project(page)).surfaces.length, 1);

  // Only from the plain editor does Back leave the app.
  await back();
  await waitFor(async () => (await exits()) === 1, "Back leaves the app");
  assert.deepEqual(app.errors, []);
  await app.context.close();
  pass(
    "android back: Help, then the open sheet, then a half-drawn outline, then the app; Present keeps its own",
  );
}

async function hiddenPage(browser) {
  const app = await openApp(browser, { ...PHONE, dpr: 1 });
  const { page } = app;
  const draws = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("canvas")].map((c) => window.__draws(c)),
    );
  const setHidden = (hidden) =>
    page.evaluate((value) => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => value,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  // Several frames run while the page claims to be hidden, and none may draw.
  const quiet = async (message) => {
    await settle(page);
    await settle(page);
    const before = await draws();
    await settle(page);
    await sleep(1500);
    await settle(page);
    assert.deepEqual(await draws(), before, message);
  };
  await setHidden(true);
  await quiet("nothing renders while the page is hidden");
  const a = await draws();
  await setHidden(false);
  await waitFor(
    async () => (await draws())[0] >= a[0] + 2,
    "rendering resumes when visible",
    30000,
  );

  await openSheet(app, "Show");
  await page
    .getByRole("button", { name: "Present on this screen", exact: true })
    .click();
  await page.locator(".present-root").waitFor();
  await waitFor(
    async () => (await draws())[1] >= 2,
    "present draws before it is hidden",
    30000,
  );
  await setHidden(true);
  await quiet("present stops rendering while hidden");
  const b = await draws();
  await setHidden(false);
  await waitFor(
    async () => (await draws())[1] >= b[1] + 2,
    "present resumes when visible",
    30000,
  );
  assert.deepEqual(app.errors, []);
  await app.context.close();
  pass("hidden page: editor and present renderers stop and resume");
}

async function performanceCaps(browser) {
  const tablet = await openApp(browser, TABLET);
  const buffer = () =>
    tablet.page.evaluate(() => {
      const c = document.querySelector(".stage canvas");
      const r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, cssW: r.width, cssH: r.height };
    });
  let b = await buffer();
  assert.ok(
    Math.max(b.w, b.h) <= 1280,
    `tablet editor buffer ${b.w}x${b.h} is capped at 1280`,
  );
  assert.ok(
    b.w >= b.cssW - 1,
    "the capped buffer is still at least one pixel per CSS pixel here or the cap",
  );
  await tablet.context.close();

  const dense = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await dense.newPage();
  await page.goto(baseUrl());
  await page.waitForSelector(".stage canvas");
  await settle(page);
  b = await page.evaluate(() => {
    const c = document.querySelector(".stage canvas");
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, cssW: r.width };
  });
  assert.ok(
    b.w <= Math.round(b.cssW * 2) + 1,
    `DPR is capped at 2: ${b.w} for ${b.cssW}`,
  );
  assert.ok(b.w > b.cssW * 1.5, "the buffer is sharper than CSS pixels");
  await dense.close();

  const desktop = await openApp(browser, {
    name: "desktop",
    width: 1280,
    height: 800,
    touch: false,
    dpr: 2,
  });
  b = await desktop.page.evaluate(() => {
    const c = document.querySelector(".stage canvas");
    const r = c.getBoundingClientRect();
    return { w: c.width, cssW: r.width };
  });
  assert.ok(
    Math.abs(b.w - b.cssW) <= 1,
    `desktop keeps one buffer pixel per CSS pixel: ${b.w} vs ${b.cssW}`,
  );
  await desktop.context.close();
  pass(
    "performance: compact buffers capped at 1280 and DPR 2, desktop buffer unchanged",
  );
}

// ---------------------------------------------------------------------------

async function desktopChecks(browser) {
  const app = await openApp(browser, {
    name: "desktop 1280x800",
    width: 1280,
    height: 800,
    touch: false,
    dpr: 1,
  });
  const { page } = app;
  assert.equal(
    await page.locator(".app-shell").getAttribute("data-layout"),
    "desktop",
  );
  assert.equal(
    await page.locator(".bottom-nav").count(),
    0,
    "no bottom nav on desktop",
  );
  assert.equal(
    await page.locator(".sheet-bar").count(),
    0,
    "no sheet bars on desktop",
  );
  assert.equal(
    await page.locator(".compact-extra").count(),
    0,
    "no compact tool buttons on desktop",
  );
  for (const selector of [
    "footer",
    ".getting-started",
    ".stage-caption",
    ".transport",
    ".left-panel",
    ".right-panel",
    ".canvas-toolbar",
  ])
    assert.equal(
      await page.locator(selector).first().isVisible(),
      true,
      `${selector} is visible on desktop`,
    );
  assert.equal(
    await page.locator("#sheet-left").count(),
    0,
    "panels keep their plain semantics on desktop",
  );

  // Present replaces the disabled projector button when there is no desktop app.
  assert.equal(
    await page.getByRole("button", { name: "Open projector output" }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Present on this screen", exact: true })
    .click();
  await page.locator(".present-root").waitFor();
  await page.keyboard.press("b");
  await waitFor(
    async () => (await project(page)).blackout === true,
    "B works in Present on desktop",
  );
  await page.keyboard.press("b");
  await page.keyboard.press("Escape");
  await page.locator(".present-root").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.querySelector("footer")).visibility,
    ),
    "visible",
  );

  // Keyboard nudging and mouse double-click still behave as before.
  const box = await page.locator(".stage canvas").boundingBox();
  await page.getByRole("button", { name: "Line tool", exact: true }).click();
  for (const [x, y] of [
    [0.2, 0.25],
    [0.75, 0.2],
    [0.8, 0.75],
    [0.3, 0.8],
  ])
    await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
  await page.locator(".draft-handle.first-point").click();
  await waitFor(
    async () => (await project(page)).surfaces.length === 2,
    "mouse drawing closes the outline",
  );
  const p0 = pointsOf(await selectedSurface(page))[0];
  await page.keyboard.press("ArrowRight");
  await settle(page);
  const p1 = pointsOf(await selectedSurface(page))[0];
  near((p1.x - p0.x) * 1920, 1, 1e-6, "ArrowRight moves 1 px");
  await page.keyboard.press("Shift+ArrowDown");
  await settle(page);
  const p2 = pointsOf(await selectedSurface(page))[0];
  near((p2.y - p1.y) * 1080, 10, 1e-6, "Shift+ArrowDown moves 10 px");
  const outline = pointsOf(await selectedSurface(page));
  const edgeMid = (a, b) =>
    toScreen(box, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const first = edgeMid(outline[1], outline[2]);
  const second = edgeMid(outline[3], outline[0]);
  await page.mouse.dblclick(first.x, first.y);
  await waitFor(
    async () => pointsOf(await selectedSurface(page)).length === 5,
    "double-click inserts a point",
  );
  // A quick second double-click elsewhere is never held back: only touch is guarded.
  await page.mouse.dblclick(second.x, second.y);
  await waitFor(
    async () => pointsOf(await selectedSurface(page)).length === 6,
    "a quick second mouse double-click inserts too",
  );
  assert.deepEqual(app.errors, []);
  await app.context.close();
  pass(
    "desktop 1280x800: layout untouched, Present replaces the disabled projector button, keyboard and mouse editing as before",
  );
}

// A project file from the desktop app has media with a path. Opening it in the
// web app keeps those entries and the layers that use them (dark until the files
// are imported again), so saving it again and returning it to the desktop loses
// nothing. tests/project-roundtrip.test.ts covers the file contents.
async function projectFileChecks(browser) {
  const app = await openApp(browser, {
    name: "project file",
    width: 1280,
    height: 800,
    touch: false,
    dpr: 1,
  });
  const { page } = app;
  const desktopFile = {
    version: 2,
    name: "Made on the desktop",
    width: 1920,
    height: 1080,
    surfaces: [
      {
        id: "window",
        name: "Window",
        corners: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
        source: "poster",
        visible: true,
        locked: false,
        opacity: 1,
        color: "#ffffff",
      },
    ],
    media: [
      { id: "poster", name: "poster.png", kind: "image", path: "media/a.png" },
    ],
    brightness: 0.65,
    blackout: false,
    playing: true,
  };
  await page
    .locator('input[type="file"][accept=".json,.prism.json"]')
    .setInputFiles({
      name: "made on the desktop.prism.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(desktopFile)),
    });
  await waitFor(
    async () => (await project(page)).name === "Made on the desktop",
    "the project file was not opened",
  );
  const opened = await project(page);
  assert.deepEqual(
    opened.media.map((m) => [m.id, m.name, m.kind, m.path, m.url]),
    [["poster", "poster.png", "image", "media/a.png", ""]],
    "the media entry and its path are kept",
  );
  assert.equal(
    opened.surfaces[0].source,
    "poster",
    "the layer keeps its media",
  );
  assert.equal(opened.blackout, true, "a project from a file starts dark");
  await page
    .getByRole("status")
    .filter({ hasText: /stay dark until you import the files again/ })
    .waitFor();
  assert.match(
    await page.locator(".surface-select small").first().innerText(),
    /poster\.png/,
    "the layer names its media",
  );
  assert.deepEqual(app.errors, []);
  await app.context.close();
  pass(
    "project file: opening a desktop project in the web app keeps its media entries, paths and layers",
  );
}

// Every tab and window of the site autosaves to one draft. The tab that did not
// make a change hears about it from the browser and says so, once.
async function secondTabChecks(browser) {
  const first = await openApp(browser, {
    name: "first tab",
    width: 1280,
    height: 800,
    touch: false,
    dpr: 1,
  });
  const second = await first.context.newPage();
  const secondErrors = [];
  second.on("pageerror", (error) => secondErrors.push(error.message));
  await second.goto(new URL("", baseUrl()).href);
  await second.waitForSelector(".stage canvas");
  const warning = first.page.locator(".error-toast");
  await sleep(300);
  assert.equal(
    await warning.count(),
    0,
    "opening a second tab is not a reason to warn",
  );
  await second.getByLabel("Project name").fill("Edited in the second tab");
  await warning.waitFor();
  assert.match(
    await warning.innerText(),
    /also open in another tab or window.*Save project/s,
  );
  assert.equal(
    await second.locator(".error-toast").count(),
    0,
    "the tab that made the change has nothing to be told",
  );
  // Said once: after it is dismissed another change does not bring it back.
  await first.page.getByRole("button", { name: "Dismiss error" }).click();
  await second.getByLabel("Project name").fill("Edited again");
  await waitFor(
    async () => (await project(first.page)).name === "Edited again",
    "the second tab's change reached the shared draft",
  );
  await sleep(300);
  assert.equal(await warning.count(), 0, "the warning is not repeated");
  assert.deepEqual([...first.errors, ...secondErrors], []);
  await first.context.close();
  pass(
    "second tab: a change made in another tab of the site is reported once, opening one is not",
  );
}

async function resizeChecks(browser) {
  const app = await openApp(browser, {
    name: "resize",
    width: 1280,
    height: 800,
    touch: false,
    dpr: 1,
  });
  const { page } = app;
  await page.setViewportSize({ width: 820, height: 1100 });
  await waitFor(
    async () =>
      (await page.locator(".app-shell").getAttribute("data-layout")) ===
      "compact",
    "narrow window becomes compact",
  );
  assert.equal(await page.locator(".bottom-nav").isVisible(), true);
  await openSheet(app, "Looks");
  await page.setViewportSize({ width: 1100, height: 800 });
  await waitFor(
    async () =>
      (await page.locator(".app-shell").getAttribute("data-layout")) ===
      "desktop",
    "wide window is desktop again",
  );
  assert.equal(
    await page.locator(".app-shell").getAttribute("data-sheet"),
    null,
    "sheet state resets",
  );
  assert.equal(await page.locator(".left-panel").isVisible(), true);
  await page.setViewportSize({ width: 1049, height: 800 });
  await waitFor(
    async () =>
      (await page.locator(".app-shell").getAttribute("data-layout")) ===
      "compact",
    "1049px is compact",
  );
  await page.setViewportSize({ width: 1050, height: 800 });
  await waitFor(
    async () =>
      (await page.locator(".app-shell").getAttribute("data-layout")) ===
      "desktop",
    "1050px is desktop",
  );
  assert.deepEqual(app.errors, []);
  await app.context.close();

  // Turning a phone sideways keeps the open sheet and swaps it for the drawer.
  const phone = await openApp(browser, { ...PHONE, dpr: 1 });
  await openSheet(phone, "Layers");
  const panel = phone.page.locator("#sheet-left");
  assert.ok((await panel.boundingBox()).height <= PHONE.height * 0.55 + 1);
  await phone.page.setViewportSize({ width: 844, height: 390 });
  await settle(phone.page);
  assert.equal(
    await tab(phone.page, "Layers").getAttribute("aria-expanded"),
    "true",
    "the sheet stays open when the phone turns",
  );
  await waitFor(async () => {
    const workspace = await phone.page.locator(".workspace").boundingBox();
    return (
      Math.abs((await panel.boundingBox()).width / workspace.width - 0.45) <
      0.02
    );
  }, "the sheet becomes a side drawer in landscape");
  await phone.page.setViewportSize({ width: 390, height: 844 });
  await settle(phone.page);
  await waitFor(
    async () => (await panel.boundingBox()).width >= 389,
    "and a bottom sheet again in portrait",
  );
  assert.ok((await panel.boundingBox()).height <= PHONE.height * 0.55 + 1);
  assert.deepEqual(phone.errors, []);
  await phone.context.close();

  // The projector window route gets no editor chrome and stays sharp.
  const out = await openApp(
    browser,
    { name: "output", width: 960, height: 540, touch: false, dpr: 2 },
    { route: "#output", selector: "canvas" },
  );
  assert.equal(
    await out.page.locator(".app-shell").count(),
    0,
    "the output route has no editor",
  );
  const sharp = await out.page.evaluate(() => {
    const c = document.querySelector("canvas");
    const r = c.getBoundingClientRect();
    return { w: c.width, cssW: r.width };
  });
  assert.ok(
    Math.abs(sharp.w - Math.round(sharp.cssW * 2)) <= 1,
    `the output canvas is not capped: ${sharp.w} for ${sharp.cssW} css px`,
  );
  assert.deepEqual(out.errors, []);
  await out.context.close();
  pass(
    "resize: 1049px is compact, 1050px is desktop, turning a phone keeps the sheet, output route untouched",
  );
}

const GROUPS = {
  layout: async (browser) => {
    for (const device of [PHONE, LANDSCAPE, SMALL, TABLET, TINY])
      await layoutChecks(browser, device);
  },
  safeArea: async (browser) => {
    await safeAreaChecks(browser);
    await wideSafeAreaChecks(browser);
  },
  css: cssChecks,
  touch: touchEditing,
  points: pointEditing,
  present: async (browser) => {
    await presentChecks(browser, { ...PHONE, dpr: 1 });
    await presentChecks(browser, { ...LANDSCAPE, dpr: 1 });
  },
  platform: presentPlatform,
  back: androidBackChecks,
  hidden: hiddenPage,
  performance: performanceCaps,
  desktop: desktopChecks,
  files: projectFileChecks,
  tabs: secondTabChecks,
  resize: resizeChecks,
};

(async () => {
  // PRISM_MOBILE_ONLY=touch,points runs just those groups while debugging.
  const only = (process.env.PRISM_MOBILE_ONLY || "").split(",").filter(Boolean);
  for (const name of only)
    assert.ok(
      GROUPS[name],
      `unknown group ${name}, use ${Object.keys(GROUPS)}`,
    );
  const browser = await launchBrowser();
  try {
    for (const [name, run] of Object.entries(GROUPS))
      if (!only.length || only.includes(name)) await run(browser);
    console.log(
      `PASS: mobile UI (${report.length} groups): compact layout, sheets, safe areas, touch editing, nudge, Present mode, performance caps, desktop untouched. Emulated Chromium only.`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
