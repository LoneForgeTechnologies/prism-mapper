const { launchBrowser, baseUrl } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

// Isolated browser storage and no desktop bridge: this never changes a live projector session.
(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1460, height: 940 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(12000);
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("prism-draft")));
  const latest = async () => (await read()).surfaces.at(-1);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const waitCount = (count) =>
    page.waitForFunction(
      (n) =>
        JSON.parse(localStorage.getItem("prism-draft")).surfaces.length === n,
      count,
    );
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const clickPoint = async (x, y, options) => {
    const box = await page.locator(".stage").boundingBox();
    await page.mouse.click(
      box.x + x * box.width,
      box.y + y * box.height,
      options,
    );
  };
  const draw = async (points, tool = "Line tool") => {
    await button(tool).click();
    await settle();
    for (const [x, y] of points) await clickPoint(x, y);
    assert.equal(await page.locator(".draft-handle").count(), points.length);
  };
  const dragHandle = async (name, dx, dy) => {
    await settle();
    const box = await button(name).boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up();
    await settle();
  };
  const selectLayer = async (name) => {
    await page.locator(".surface-select").filter({ hasText: name }).click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Surface name", exact: true })
        .inputValue(),
      name,
    );
  };
  const range = async (label, value) => {
    const input = page.getByRole("slider", { name: label, exact: true });
    await input.scrollIntoViewIfNeeded();
    await input.evaluate((element, next) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(element, String(next));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    assert.equal(await input.inputValue(), String(value));
    await settle();
  };
  const close = (a, b, tolerance = 0.006) =>
    assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
  try {
    await page.goto(baseUrl());
    await page.waitForSelector(".stage canvas");
    await page.waitForFunction(() => localStorage.getItem("prism-draft"));
    assert.equal(await page.evaluate(() => typeof window.prism), "undefined");
    assert.equal((await read()).surfaces.length, 1);
    assert.equal((await read()).version, 2);
    await button("Pause playback").click();
    // Disable snapping so assertions describe the entered geometry exactly.
    if (
      (await button("Toggle snapping").getAttribute("aria-pressed")) === "true"
    )
      await button("Toggle snapping").click();

    const concave = [
      [0.16, 0.16],
      [0.83, 0.16],
      [0.83, 0.42],
      [0.43, 0.42],
      [0.43, 0.82],
      [0.16, 0.82],
    ];
    await draw(concave);
    await button("Close outline at first point").click();
    await waitCount(2);
    const outline = await latest();
    assert.equal(outline.kind, "surface");
    assert.equal(outline.source, "edge-chase");
    assert.equal(outline.polygon.length, 6);
    outline.polygon.forEach((p, i) => {
      close(p.x, concave[i][0]);
      close(p.y, concave[i][1]);
    });
    assert.equal(await page.locator(".drawing-instructions").count(), 0);
    console.log(
      "PASS line tool: six-point concave outline closes by clicking its first point",
    );

    const originalPolygon = outline.polygon;
    await dragHandle("Point 1", -15, -10);
    const moved = await latest();
    assert.ok(
      moved.polygon[0].x < originalPolygon[0].x,
      JSON.stringify({
        before: originalPolygon[0],
        after: moved.polygon[0],
        selected: await page
          .getByRole("textbox", { name: "Surface name", exact: true })
          .inputValue(),
      }),
    );
    assert.ok(moved.polygon[0].y < originalPolygon[0].y);
    assert.equal(moved.corners[0].x, moved.polygon[0].x);
    await button("Undo").click();
    await settle();
    assert.deepEqual((await latest()).polygon, originalPolygon);
    await button("Redo").click();
    await settle();
    assert.deepEqual((await latest()).polygon, moved.polygon);

    const [a, b] = moved.polygon;
    await clickPoint((a.x + b.x) / 2, (a.y + b.y) / 2, {
      clickCount: 2,
      delay: 60,
    });
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("prism-draft")).surfaces.at(-1).polygon
          .length === 7,
    );
    await button("Remove selected point").click();
    await settle();
    assert.deepEqual((await latest()).polygon, moved.polygon);
    console.log(
      "PASS outline editing: vertex drag, undo/redo, double-click edge insertion and selected-point removal",
    );

    await draw([
      [0.2, 0.2],
      [0.76, 0.2],
      [0.5, 0.73],
      [0.28, 0.64],
    ]);
    await page.keyboard.press("Backspace");
    assert.equal(await page.locator(".draft-handle").count(), 3);
    await page.keyboard.press("Enter");
    await waitCount(3);
    assert.equal((await latest()).polygon.length, 3);
    assert.equal(await button("Remove selected point").isDisabled(), true);
    await draw([
      [0.22, 0.23],
      [0.75, 0.23],
    ]);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".draft-handle").count(), 0);
    assert.equal((await read()).surfaces.length, 3);
    await draw([
      [0.2, 0.2],
      [0.8, 0.8],
      [0.8, 0.2],
      [0.2, 0.8],
    ]);
    await page.keyboard.press("Enter");
    await page
      .getByText("Outline edges cannot cross or touch each other.", {
        exact: true,
      })
      .waitFor();
    assert.equal((await read()).surfaces.length, 3);
    assert.equal(await page.locator(".draft-handle").count(), 4);
    await page.keyboard.press("Escape");
    console.log(
      "PASS drawing recovery: Backspace removes a draft point, Enter closes, Escape cancels, crossing outlines are rejected",
    );

    await button("Add triangle").click();
    await waitCount(4);
    const triangle = await latest();
    assert.equal(triangle.polygon.length, 3);
    assert.equal(triangle.source, "triangle-weave");
    await button("Add circle").click();
    await waitCount(5);
    const circle = await latest();
    assert.equal(circle.polygon.length, 32);
    assert.equal(circle.source, "radar");
    await button("Add square").click();
    await waitCount(6);
    const square = await latest();
    assert.equal(square.polygon, undefined);
    close(
      (square.corners[1].x - square.corners[0].x) * 1920,
      (square.corners[2].y - square.corners[0].y) * 1080,
      0.001,
    );
    await button("Add rectangle").click();
    await waitCount(7);
    const rectangle = await latest();
    assert.equal(rectangle.polygon, undefined);
    console.log(
      "PASS presets: triangle and circle outlines plus perspective rectangle and physically square canvas proportions",
    );

    await selectLayer(outline.name);
    const otherLayersBefore = (await read()).surfaces.filter(
      (s) => s.id !== outline.id,
    );
    await page
      .getByRole("combobox", { name: "Surface source", exact: true })
      .selectOption("contour");
    await page
      .getByRole("combobox", { name: "Layer blend mode", exact: true })
      .selectOption("screen");
    await range("Surface opacity", 0.47);
    await range("Edge feather", 13);
    await range("Outline width", 23);
    await page.locator(".content-transform summary").click();
    await range("Content rotation", 35);
    await range("Content zoom", 1.75);
    await range("Content horizontal", -0.15);
    await range("Content vertical", 0.2);
    const configured = (await read()).surfaces.find((s) => s.id === outline.id);
    assert.equal(configured.source, "contour");
    assert.equal(configured.blendMode, "screen");
    assert.equal(configured.opacity, 0.47);
    assert.equal(configured.feather, 13);
    assert.equal(configured.edgeWidth, 23);
    assert.deepEqual(configured.content, {
      rotation: 35,
      scale: 1.75,
      offsetX: -0.15,
      offsetY: 0.2,
    });
    assert.deepEqual(
      (await read()).surfaces.filter((s) => s.id !== outline.id),
      otherLayersBefore,
    );
    console.log(
      "PASS independent layer controls: animation, blending, opacity, edge feather, width and content transforms persist without changing other layers",
    );

    await button("Lock surface").click();
    const lockedBefore = (await read()).surfaces.find(
      (s) => s.id === outline.id,
    );
    await dragHandle("Point 1", 25, 20);
    await page.keyboard.press("ArrowRight");
    assert.deepEqual(
      (await read()).surfaces.find((s) => s.id === outline.id),
      lockedBefore,
    );
    assert.equal(await button("Remove selected point").isDisabled(), true);
    assert.equal(await button("Delete surface").isDisabled(), true);
    await button("Unlock surface").click();

    const beforeSolo = await read();
    await button(`Solo ${outline.name}`).click();
    await page
      .getByText("Solo preview · only this layer and cutouts are shown", {
        exact: false,
      })
      .waitFor();
    assert.deepEqual(await read(), beforeSolo);
    await button("Show all layers").click();
    assert.equal(await page.locator(".solo-notice").count(), 0);
    const oldIndex = (await read()).surfaces.findIndex(
      (s) => s.id === outline.id,
    );
    await button("Bring surface forward").click();
    assert.equal(
      (await read()).surfaces.findIndex((s) => s.id === outline.id),
      oldIndex + 1,
    );
    await button("Send surface backward").click();
    assert.equal(
      (await read()).surfaces.findIndex((s) => s.id === outline.id),
      oldIndex,
    );
    await page.locator(".surface-list").evaluate((el) => (el.scrollTop = 0));
    await page
      .locator(".surface-row")
      .filter({ hasText: circle.name })
      .dragTo(
        page.locator(".surface-row").filter({ hasText: rectangle.name }),
        { sourcePosition: { x: 4, y: 4 }, targetPosition: { x: 4, y: 4 } },
      );
    await settle();
    assert.equal((await latest()).id, circle.id);
    assert.equal(
      await page
        .locator(".surface-row")
        .first()
        .locator("strong")
        .textContent(),
      circle.name,
    );
    console.log(
      "PASS layer management: locked geometry ignores drags and arrows, solo leaves saved visibility intact, ordering buttons and drag-and-drop reorder layers",
    );

    await draw(
      [
        [0.55, 0.56],
        [0.76, 0.56],
        [0.76, 0.77],
        [0.55, 0.77],
      ],
      "Draw cutout mask",
    );
    await button("Close outline at first point").click();
    await waitCount(8);
    const cutout = await latest();
    assert.equal(cutout.kind, "mask");
    assert.equal(cutout.source, "solid");
    assert.equal(cutout.polygon.length, 4);
    assert.equal(cutout.color, "#000000");
    assert.equal(
      await page
        .getByRole("combobox", { name: "Surface source", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("combobox", { name: "Layer blend mode", exact: true })
        .isDisabled(),
      true,
    );
    console.log(
      "PASS cutout masks: drawn path becomes a black mask above animation layers with appropriate controls",
    );

    const saved = await read();
    await page.reload();
    await page.waitForSelector(".stage canvas");
    await waitCount(8);
    assert.deepEqual(await read(), saved);
    assert.equal(await page.locator(".surface-row").count(), 8);
    await selectLayer(outline.name);
    assert.equal(
      await page
        .getByRole("combobox", { name: "Surface source", exact: true })
        .inputValue(),
      "contour",
    );
    console.log(
      "PASS persistence: reload restores advanced outlines, layer ordering, masks and per-layer controls",
    );

    for (const viewport of [
      { width: 1120, height: 740 },
      { width: 1460, height: 940 },
    ]) {
      await page.setViewportSize(viewport);
      await settle();
      const layout = await page.evaluate(() => {
        const bounds = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        return {
          stage: bounds(".stage"),
          transport: bounds(".transport"),
          toolbar: bounds(".mapping-tools"),
          center: bounds(".center-panel"),
          scrollWidth: document.documentElement.scrollWidth,
          width: innerWidth,
          height: innerHeight,
        };
      });
      assert.ok(
        layout.stage.width > 240 && layout.stage.height > 135,
        JSON.stringify(layout),
      );
      assert.ok(
        layout.stage.bottom < layout.transport.top,
        JSON.stringify(layout),
      );
      assert.ok(
        layout.transport.bottom <= layout.height,
        JSON.stringify(layout),
      );
      assert.ok(
        layout.toolbar.left >= 0 && layout.toolbar.right <= layout.width,
        JSON.stringify(layout),
      );
      assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
    }
    await fs.mkdir(path.resolve(__dirname, "../artifacts"), {
      recursive: true,
    });
    await page.locator(".right-panel").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: path.resolve(__dirname, "../artifacts/advanced-editor-ui.png"),
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS compact 1120×740 and desktop layout; no uncaught browser errors",
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
