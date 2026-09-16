const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const p = await browser.newPage();
    await p.clock.install();
    await p.goto("http://127.0.0.1:5178");
    const source = p.getByRole("combobox", {
      name: "Surface source",
      exact: true,
    });
    await source.selectOption("checker");
    await p.getByRole("button", { name: "Start animation mix" }).click();
    await p.clock.fastForward(20001);
    await p.waitForFunction(
      () =>
        document.querySelector('select[aria-label="Surface source"]').value ===
        "aurora",
    );
    await p.getByRole("button", { name: "Pause playback" }).click();
    await p.clock.fastForward(45000);
    assert.equal(await source.inputValue(), "aurora");
    await p.getByRole("button", { name: "Resume playback" }).click();
    await p.clock.fastForward(20001);
    await p.waitForFunction(
      () =>
        document.querySelector('select[aria-label="Surface source"]').value ===
        "ocean",
    );
    await p.getByRole("button", { name: "Open setup guide" }).click();
    await p
      .getByRole("button", { name: "Start with the calibration grid" })
      .click();
    assert.equal(await source.inputValue(), "grid");
    await p.getByRole("button", { name: "Start animation mix" }).waitFor();
    await p.clock.fastForward(45000);
    assert.equal(await source.inputValue(), "grid");
    console.log(
      "PASS:20s mix cycling;pause suspends cycle;resume cycles;calibration stops mix.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
