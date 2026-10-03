const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  editorWindowGeometry,
  PAGE_MINIMUM,
  MINIMUM,
  FRAME,
} = require("./window-size.cjs");

// Work areas in logical pixels: the screen minus the Windows taskbar, which is
// 40 logical pixels at every scale (48 on a 1024 x 768 virtual machine).
const screens = {
  "1366x768 at 100%": { width: 1366, height: 728 },
  "1366x768 at 125%": { width: 1093, height: 574 },
  "1366x768 at 150%": { width: 911, height: 472 },
  "1920x1080 at 100%": { width: 1920, height: 1040 },
  "1920x1080 at 125%": { width: 1536, height: 824 },
  "1920x1080 at 150%": { width: 1280, height: 680 },
  "2560x1440 at 100%": { width: 2560, height: 1400 },
  "1024x768 virtual machine": { width: 1024, height: 720 },
};

test("a screen that can hold the page gets a window that keeps it whole", () => {
  for (const [name, workArea] of Object.entries(screens)) {
    const geometry = editorWindowGeometry(workArea);
    assert.equal(geometry.useContentSize, true, name);
    assert.ok(geometry.width >= geometry.minWidth, name);
    assert.ok(geometry.height >= geometry.minHeight, name);
    if (workArea.width - FRAME.width >= PAGE_MINIMUM.width)
      assert.ok(geometry.minWidth >= PAGE_MINIMUM.width, name);
    if (workArea.height - FRAME.height >= PAGE_MINIMUM.height)
      assert.ok(geometry.minHeight >= PAGE_MINIMUM.height, name);
  }
});

test("the window never has to be larger than the screen", () => {
  for (const [name, workArea] of Object.entries(screens)) {
    const geometry = editorWindowGeometry(workArea);
    assert.ok(geometry.minWidth + FRAME.width <= workArea.width, name);
    assert.ok(geometry.minHeight + FRAME.height <= workArea.height, name);
    assert.ok(geometry.width + FRAME.width <= workArea.width, name);
    assert.ok(geometry.height + FRAME.height <= workArea.height, name);
  }
});

test("a 1366 pixel laptop at 125% scaling holds the window and the page's full width", () => {
  const workArea = screens["1366x768 at 125%"];
  const geometry = editorWindowGeometry(workArea);
  assert.ok(geometry.minWidth >= PAGE_MINIMUM.width);
  assert.ok(geometry.minWidth + FRAME.width <= workArea.width);
  // The previous fixed minimum of 1120 did not fit in 1093 logical pixels.
  assert.ok(1120 > workArea.width);
  assert.ok(MINIMUM.width < 1120);
});

test("a large screen gets the preferred size, a laptop starts maximised", () => {
  assert.deepEqual(editorWindowGeometry(screens["1920x1080 at 100%"]), {
    useContentSize: true,
    width: 1460,
    height: 912,
    minWidth: 1080,
    minHeight: 700,
    maximize: false,
  });
  assert.equal(
    editorWindowGeometry(screens["2560x1440 at 100%"]).maximize,
    false,
  );
  for (const name of [
    "1366x768 at 100%",
    "1366x768 at 125%",
    "1366x768 at 150%",
    "1920x1080 at 125%",
    "1920x1080 at 150%",
    "1024x768 virtual machine",
  ])
    assert.equal(editorWindowGeometry(screens[name]).maximize, true, name);
});

test("small screens shrink the minimum to what they can hold", () => {
  assert.deepEqual(editorWindowGeometry(screens["1366x768 at 150%"]), {
    useContentSize: true,
    width: 887,
    height: 400,
    minWidth: 887,
    minHeight: 400,
    maximize: true,
  });
  // Never absurdly small, whatever the display reports.
  const tiny = editorWindowGeometry({ width: 300, height: 200 });
  assert.equal(tiny.minWidth, 600);
  assert.equal(tiny.minHeight, 400);
});

test("the window minimum is never below what the stylesheet requires", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "src", "style.css"),
    "utf8",
  );
  const shell = /\.app-shell\s*\{[^}]*\}/.exec(css)[0];
  const width = Number(/min-width:\s*(\d+)px/.exec(shell)[1]);
  const height = Number(/min-height:\s*(\d+)px/.exec(shell)[1]);
  // If the page ever asks for more room, the window minimum must grow with it.
  assert.ok(
    MINIMUM.width >= width,
    `window minimum width ${MINIMUM.width} < page ${width}`,
  );
  assert.ok(
    MINIMUM.height >= height,
    `window minimum height ${MINIMUM.height} < page ${height}`,
  );
});
