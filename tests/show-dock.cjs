const { launchBrowser, baseUrl } = require("./browser.cjs");
const assert = require("node:assert/strict");

// Scenes and timeline is a dock under the preview, not an overlay. These checks
// keep it from covering the preview, the layers or the inspector again, and
// cover the three ways to size it: drag, keys and collapse.
const toggle = (page) =>
  page.getByRole("button", { name: "Scenes and timeline", exact: true });
const region = (page) =>
  page.getByRole("region", { name: "Scenes and timeline", exact: true });
const grip = (page) =>
  page.getByRole("separator", {
    name: "Resize scenes and timeline",
    exact: true,
  });
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

async function start(browser, viewport, options = {}) {
  const context = await browser.newContext({ viewport, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl());
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .waitFor();
  return { context, page, errors };
}

const layout = (page) =>
  page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const { left, top, right, bottom, width, height } =
        element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    // True when a click in the middle of the element would reach it.
    const reachable = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const { left, top, width, height } = element.getBoundingClientRect();
      const hit = document.elementFromPoint(left + width / 2, top + height / 2);
      return Boolean(hit && element.contains(hit));
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      dock: document.querySelector(".app-shell").dataset.dock || null,
      panel: box(".show-panel"),
      stage: box(".stage"),
      area: box(".canvas-area"),
      center: box(".center-panel"),
      left: box(".left-panel"),
      right: box(".right-panel"),
      transport: box(".transport"),
      nav: box(".bottom-nav"),
      reachable: {
        stage: reachable(".stage"),
        panel: reachable(".show-panel"),
        nav: reachable(".bottom-nav"),
      },
    };
  });

const limits = (page) =>
  grip(page).evaluate((element) => ({
    min: Number(element.getAttribute("aria-valuemin")),
    max: Number(element.getAttribute("aria-valuemax")),
    now: Number(element.getAttribute("aria-valuenow")),
  }));
const dockHeight = async (page) =>
  Math.round((await layout(page)).panel.height);
const sketch = (page) =>
  page.evaluate(() => ({
    overlay: document.querySelector(".mapping-overlay").innerHTML,
    layers: document.querySelectorAll(".surface-row").length,
  }));

async function dragGrip(page, dy) {
  const box = await grip(page).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

function near(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= 1.5,
    `${message}: got ${actual}, expected ${expected}`,
  );
}

async function desktop(browser) {
  const { context, page, errors } = await start(browser, {
    width: 1460,
    height: 900,
  });
  const closed = await layout(page);
  assert.equal(closed.dock, null);
  await toggle(page).click();
  await region(page).waitFor();
  await settle(page);
  const open = await layout(page);
  assert.equal(open.dock, "open");

  // The preview is above the dock, never under it.
  assert.ok(
    open.panel.top >= open.stage.bottom - 1,
    `dock starts at ${open.panel.top}, the preview ends at ${open.stage.bottom}`,
  );
  assert.ok(
    open.stage.width >= 320 && open.stage.height >= 180,
    "preview size",
  );
  near(open.stage.width / open.stage.height, 16 / 9, "preview shape");
  assert.ok(open.reachable.stage, "the preview receives the pointer");
  assert.ok(open.reachable.panel, "the dock receives the pointer");
  assert.ok(
    open.panel.left >= open.center.left - 1 &&
      open.panel.right <= open.center.right + 1,
    "the dock stays in the center column",
  );
  assert.ok(
    open.panel.left >= open.left.right - 1 &&
      open.panel.right <= open.right.left + 1,
    "the dock never reaches over Layers or the Inspector",
  );
  assert.ok(
    open.panel.height / open.viewport.height <= 0.4,
    "the dock opens at about a third of the window",
  );
  assert.ok(open.scrollWidth <= open.viewport.width, "no sideways scroll");
  assert.ok(open.scrollHeight <= open.viewport.height + 1, "no page scroll");

  // Layers, the toolbar and the Inspector keep working while it is open.
  await page.getByRole("button", { name: "Add surface", exact: true }).click();
  assert.equal((await sketch(page)).layers, 2);
  await page.getByRole("button", { name: "Add square", exact: true }).click();
  assert.equal((await sketch(page)).layers, 3);
  await page
    .getByRole("textbox", { name: "Surface name", exact: true })
    .fill("Dock check");
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".surface-row strong")).some(
      (name) => name.textContent === "Dock check",
    ),
  );
  assert.ok(await region(page).isVisible(), "the dock stays open");

  // Dragging the top edge.
  const range = await limits(page);
  assert.equal(range.min, 150);
  assert.ok(range.max >= range.min + 100, "the dock has room to grow");
  near(range.now, open.panel.height, "separator reports the real height");
  await dragGrip(page, -60);
  near(
    await dockHeight(page),
    Math.min(range.now + 60, range.max),
    "drag up grows the dock",
  );
  await dragGrip(page, -2000);
  const tall = await layout(page);
  near(tall.panel.height, range.max, "a long drag stops at the maximum");
  assert.ok(
    tall.stage.width >= 280 && tall.stage.height >= 160,
    `preview keeps ${tall.stage.width}x${tall.stage.height} when the dock is at its tallest`,
  );
  assert.ok(tall.area.height >= 219, "preview area keeps its minimum");
  assert.ok(tall.reachable.stage);
  assert.ok(tall.panel.height / tall.viewport.height <= 0.6);
  await dragGrip(page, 2000);
  near(
    await dockHeight(page),
    range.min,
    "a long drag down stops at the minimum",
  );
  assert.ok((await layout(page)).stage.height > tall.stage.height);

  // Keys on the separator, and the arrows stay out of the editor.
  const before = await sketch(page);
  await grip(page).focus();
  await page.keyboard.press("Home");
  await settle(page);
  near(await dockHeight(page), range.min, "Home");
  await page.keyboard.press("ArrowUp");
  await settle(page);
  near(await dockHeight(page), range.min + 24, "ArrowUp");
  await page.keyboard.press("Shift+ArrowUp");
  await settle(page);
  near(await dockHeight(page), range.min + 24 + 96, "Shift+ArrowUp");
  await page.keyboard.press("ArrowDown");
  await settle(page);
  near(await dockHeight(page), range.min + 96, "ArrowDown");
  await page.keyboard.press("End");
  await settle(page);
  const latest = await limits(page);
  near(await dockHeight(page), latest.max, "End");
  assert.equal(latest.now, await dockHeight(page), "aria-valuenow follows");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("p");
  await settle(page);
  assert.deepEqual(
    await sketch(page),
    before,
    "keys pressed in the dock never move or delete the selected layer",
  );
  assert.equal(
    await page.locator(".drawing-instructions").count(),
    0,
    "the P key does not start drawing from the dock",
  );

  // Folding it away leaves the transport and gives the preview the room.
  const chosen = await dockHeight(page);
  const unfolded = await layout(page);
  await page
    .getByRole("button", { name: "Collapse scenes and timeline", exact: true })
    .click();
  await settle(page);
  const folded = await layout(page);
  assert.equal(folded.dock, "collapsed");
  assert.equal(await region(page).getAttribute("data-collapsed"), "true");
  assert.ok(folded.panel.height <= 70, `folded bar is ${folded.panel.height}`);
  assert.ok(folded.stage.height > unfolded.stage.height);
  assert.equal(await grip(page).count(), 0, "nothing to resize while folded");
  assert.ok(
    await region(page)
      .getByRole("button", { name: "Play show", exact: true })
      .isVisible(),
    "the show transport stays on the folded bar",
  );
  await page
    .getByRole("button", { name: "Expand scenes and timeline", exact: true })
    .click();
  await settle(page);
  near(await dockHeight(page), chosen, "unfolding restores the chosen height");
  // Closing and reopening keeps the size and always reopens unfolded.
  await page
    .getByRole("button", { name: "Collapse scenes and timeline", exact: true })
    .click();
  await toggle(page).click();
  await region(page).waitFor({ state: "detached" });
  assert.equal((await layout(page)).dock, null);
  await toggle(page).click();
  await region(page).waitFor();
  await settle(page);
  assert.equal((await layout(page)).dock, "open");
  near(await dockHeight(page), chosen, "reopening keeps the chosen height");

  // Escape closes the dock from inside it and hands focus back to the toggle.
  assert.ok(
    await region(page).evaluate(
      (element) => element === document.activeElement,
    ),
    "opening moves focus into the dock",
  );
  await page.keyboard.press("Escape");
  await region(page).waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
    "Scenes and timeline",
  );
  // From the mapping tools it still cancels a drawing and leaves the dock be.
  await toggle(page).click();
  await region(page).waitFor();
  await page.getByRole("button", { name: "Line tool", exact: true }).click();
  await page.locator(".drawing-instructions").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".drawing-instructions").waitFor({ state: "detached" });
  assert.ok(
    await region(page).isVisible(),
    "the dock outlives Escape elsewhere",
  );
  await page.keyboard.press("Escape");
  assert.ok(await region(page).isVisible(), "Escape elsewhere never closes it");
  await page
    .getByRole("button", { name: "Close scenes and timeline", exact: true })
    .click();
  await region(page).waitFor({ state: "detached" });

  assert.deepEqual(errors, []);
  await context.close();
}

async function shortWindow(browser, height) {
  const { context, page, errors } = await start(browser, {
    width: 1280,
    height,
  });
  await toggle(page).click();
  await region(page).waitFor();
  await settle(page);
  const open = await layout(page);
  assert.ok(open.panel.height < 300, "a short window shrinks the dock");
  assert.ok(open.panel.height >= 150, "but not below its minimum");
  assert.ok(open.area.height >= 219, "the preview area keeps its minimum");
  assert.ok(open.stage.width >= 280, `preview ${open.stage.width}px wide`);
  // The editor is never shorter than 700 pixels; below that the page scrolls,
  // exactly as it does with the dock closed.
  const shell = Math.max(open.viewport.height, 700);
  assert.ok(open.panel.bottom <= shell + 1, "the dock stays inside the editor");
  assert.ok(open.transport.bottom <= open.panel.top + 1);
  assert.ok(open.reachable.stage && open.reachable.panel);
  assert.ok(open.scrollHeight <= shell + 1, "no extra page scroll");
  assert.ok(open.scrollWidth <= open.viewport.width, "no sideways scroll");
  assert.deepEqual(errors, []);
  await context.close();
}

async function phone(browser) {
  const { context, page, errors } = await start(
    browser,
    { width: 390, height: 844 },
    { hasTouch: true, isMobile: true },
  );
  await toggle(page).click();
  await region(page).waitFor();
  await settle(page);
  const open = await layout(page);
  assert.equal(open.dock, "open");
  assert.ok(
    open.stage.bottom <= open.panel.top + 1,
    `the preview ends at ${open.stage.bottom}, the sheet starts at ${open.panel.top}`,
  );
  assert.ok(
    open.stage.width >= 300 && open.stage.height >= 170,
    `preview ${open.stage.width}x${open.stage.height}`,
  );
  assert.ok(open.reachable.stage && open.reachable.panel);
  assert.ok(open.panel.bottom <= open.nav.top + 1, "above the bottom bar");
  assert.ok(open.reachable.nav, "the bottom bar stays reachable");
  assert.ok(open.panel.height <= open.viewport.height * 0.56);
  assert.ok(open.scrollWidth <= open.viewport.width, "no sideways scroll");
  assert.equal(await grip(page).count(), 0, "a sheet is not resized by hand");
  // Opening another panel puts the dock away.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await region(page).waitFor({ state: "detached" });
  assert.equal((await layout(page)).dock, null);
  // Folded, only the bar is left and the preview has everything else.
  await toggle(page).click();
  await region(page).waitFor();
  await page
    .getByRole("button", { name: "Collapse scenes and timeline", exact: true })
    .click();
  await settle(page);
  const folded = await layout(page);
  assert.ok(folded.panel.height < open.panel.height / 2);
  assert.ok(folded.stage.height >= open.stage.height);
  assert.ok(folded.panel.bottom <= folded.nav.top + 1);
  assert.deepEqual(errors, []);
  await context.close();
}

async function landscapePhone(browser) {
  const { context, page, errors } = await start(
    browser,
    { width: 844, height: 390 },
    { hasTouch: true, isMobile: true },
  );
  await toggle(page).click();
  await region(page).waitFor();
  await settle(page);
  const open = await layout(page);
  assert.ok(
    open.panel.left >= open.viewport.width * 0.5 - 24,
    `the dock is a side drawer, it starts at ${open.panel.left}`,
  );
  assert.ok(open.panel.right <= open.viewport.width + 1);
  assert.ok(open.panel.bottom <= open.viewport.height + 1);
  assert.ok(
    open.stage.right <= open.panel.left + 1,
    "the drawer does not cover the preview",
  );
  assert.ok(open.stage.width >= 300, `preview ${open.stage.width}px wide`);
  assert.ok(open.reachable.stage && open.reachable.panel);
  assert.ok(open.scrollWidth <= open.viewport.width, "no sideways scroll");
  assert.deepEqual(errors, []);
  await context.close();
}

(async () => {
  const browser = await launchBrowser();
  try {
    await desktop(browser);
    await shortWindow(browser, 720);
    await shortWindow(browser, 640);
    await phone(browser);
    await landscapePhone(browser);
    console.log(
      "PASS scenes and timeline dock: preview and side panels stay visible and usable, drag and key resizing within limits, fold and unfold, Escape scope, short windows, phone and landscape layouts",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
