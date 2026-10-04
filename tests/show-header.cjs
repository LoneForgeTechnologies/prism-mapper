const { launchBrowser, baseUrl } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const browser = await launchBrowser();
  const evidenceOnly = process.env.PRISM_HEADER_EVIDENCE_ONLY === "1";
  const evidence = [];
  const errors = [];
  const directory = path.join(__dirname, "../artifacts");
  await fs.mkdir(directory, { recursive: true });
  try {
    for (const width of [320, 390, 640, 1024, 1050]) {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(baseUrl());
      await page
        .getByRole("textbox", { name: "Project name", exact: true })
        .waitFor();
      const geometry = await page.evaluate(() => {
        const rectangle = (element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        };
        const name = document.querySelector('[aria-label="Project name"]');
        return {
          viewport: { width: innerWidth, height: innerHeight },
          layout: document.querySelector(".app-shell").dataset.layout,
          header: rectangle(document.querySelector(".topbar")),
          name: rectangle(name),
          scrollWidth: document.documentElement.scrollWidth,
          actions: Array.from(
            document.querySelectorAll(".header-actions button"),
          ).map((button) => {
            const bounds = rectangle(button);
            return {
              name:
                button.getAttribute("aria-label") || button.textContent.trim(),
              ...bounds,
              receivesPointer:
                document
                  .elementFromPoint(
                    bounds.x + bounds.width / 2,
                    bounds.y + bounds.height / 2,
                  )
                  ?.closest("button") === button,
            };
          }),
        };
      });
      evidence.push(geometry);
      await page.screenshot({
        path: path.join(
          directory,
          `show-header-${evidenceOnly ? "before" : "after"}-${width}.png`,
        ),
      });
      if (!evidenceOnly) {
        assert.equal(geometry.layout, width < 1050 ? "compact" : "desktop");
        assert.ok(
          geometry.scrollWidth <= width,
          `${width}: no horizontal overflow`,
        );
        for (const action of geometry.actions) {
          assert.equal(
            action.receivesPointer,
            true,
            `${width}: ${action.name} receives its intended pointer click`,
          );
          const overlapWidth =
            Math.min(
              geometry.name.x + geometry.name.width,
              action.x + action.width,
            ) - Math.max(geometry.name.x, action.x);
          const overlapHeight =
            Math.min(
              geometry.name.y + geometry.name.height,
              action.y + action.height,
            ) - Math.max(geometry.name.y, action.y);
          assert.ok(
            overlapWidth <= 0 || overlapHeight <= 0,
            `${width}: Project name never overlaps ${action.name}`,
          );
        }
        await page
          .getByRole("textbox", { name: "Project name", exact: true })
          .fill("Band intro");
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Open", exact: true }).click();
        await (await chooser).setFiles([]);
        assert.equal(
          await page
            .getByRole("textbox", { name: "Project name", exact: true })
            .inputValue(),
          "Band intro",
        );
        await page
          .getByRole("button", { name: "Scenes and timeline", exact: true })
          .click();
        await page
          .getByRole("region", { name: "Scenes and timeline", exact: true })
          .waitFor();
        await page
          .getByRole("button", {
            name: "Close scenes and timeline",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: "Quick start and shortcuts",
            exact: true,
          })
          .click();
        await page
          .getByRole("dialog", { name: "Your first mapping", exact: true })
          .waitFor();
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(
        directory,
        `show-header-${evidenceOnly ? "before" : "after"}.json`,
      ),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    console.log(
      `PASS ${evidenceOnly ? "captured original" : "responsive"} show header at 320/390/640/1024/1050 pixels`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
