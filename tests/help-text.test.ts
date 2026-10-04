import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { helpGuide, type HelpGuide } from "../src/help-text.ts";
import type { HelpPlatform } from "../src/platform.ts";

const PLATFORMS: HelpPlatform[] = [
  "mac",
  "windows",
  "desktop",
  "touch",
  "browser",
];
const words = (guide: HelpGuide) =>
  [
    ...guide.steps.flatMap((step) => [step.title, step.text]),
    ...guide.tip.map((part) => (typeof part === "string" ? part : part.key)),
  ].join(" ");
const keys = (guide: HelpGuide) =>
  guide.tip.flatMap((part) => (typeof part === "string" ? [] : [part.key]));
const step = (platform: HelpPlatform, index: number) =>
  helpGuide(platform).steps[index];

test("every device gets three steps and a tip", () => {
  for (const platform of PLATFORMS) {
    const guide = helpGuide(platform);
    assert.equal(guide.steps.length, 3, platform);
    for (const { title, text } of guide.steps) {
      assert.ok(title.endsWith("."), `${platform}: ${title}`);
      assert.ok(text.length > 40, `${platform}: ${title}`);
    }
    assert.ok(guide.tip.length > 0, platform);
  }
});

test("a Mac is told about System Settings and Windows about Windows + P", () => {
  assert.match(step("mac", 0).text, /macOS System Settings → Displays/);
  assert.doesNotMatch(step("mac", 0).text, /Windows/);
  assert.match(step("windows", 0).text, /Press Windows \+ P and choose Extend/);
  assert.doesNotMatch(step("windows", 0).text, /macOS|System Settings/);
  // Another system gets neither menu.
  assert.doesNotMatch(step("desktop", 0).text, /macOS|System Settings|Windows/);
  assert.match(step("desktop", 0).text, /extended display/);
});

test("the desktop app steps use its projector window and its keys", () => {
  for (const platform of ["mac", "windows", "desktop"] as const) {
    const guide = helpGuide(platform);
    assert.match(guide.steps[1].text, /Target display and open output/);
    assert.deepEqual(keys(guide), ["G", "B"], platform);
  }
});

test("a phone or a tablet is told to connect a screen and to tap, with no keyboard", () => {
  const guide = helpGuide("touch");
  assert.equal(guide.steps[0].title, "Connect a screen.");
  assert.match(guide.steps[0].text, /video cable, or mirror/);
  assert.match(guide.steps[1].text, /Tap Rectangle .* Draw outline/);
  assert.match(guide.steps[1].text, /open Show, choose Present on this screen/);
  assert.match(guide.steps[2].text, /open Looks/);
  assert.deepEqual(keys(guide), []);
  assert.match(words(guide), /Tap the screen while presenting/);
  assert.doesNotMatch(
    words(guide),
    /\bclick|Target display|System Settings|macOS|Windows|desktop|Line tool|\bEsc\b/i,
  );
});

test("a browser has one window: present on this screen, no projector window", () => {
  const guide = helpGuide("browser");
  assert.match(guide.steps[0].text, /drag this window onto it/);
  assert.match(guide.steps[0].text, /Mac/);
  assert.match(guide.steps[0].text, /Windows \+ P/);
  assert.match(guide.steps[1].text, /Present on this screen/);
  assert.doesNotMatch(words(guide), /Target display|open output/);
  assert.deepEqual(keys(guide), ["B", "Esc"]);
});

test("no em or en dashes in the guide or anywhere else people read", () => {
  const DASH = /[–—]/;
  for (const platform of PLATFORMS)
    assert.doesNotMatch(words(helpGuide(platform)), DASH, platform);

  // Every string, template and piece of JSX text in src, and every style sheet.
  const directory = new URL("../src/", import.meta.url);
  const found: string[] = [];
  for (const name of readdirSync(directory, { recursive: true }).map(String)) {
    const text = (() => {
      try {
        return readFileSync(new URL(name, directory), "utf8");
      } catch {
        return ""; // a folder
      }
    })();
    if (name.endsWith(".css")) {
      if (DASH.test(text.replace(/\/\*[\s\S]*?\*\//g, "")))
        found.push(`src/${name}`);
    } else if (/\.(ts|tsx)$/.test(name)) {
      const file = ts.createSourceFile(
        name,
        text,
        ts.ScriptTarget.Latest,
        true,
        name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        if (
          (ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node) ||
            ts.isJsxText(node)) &&
          DASH.test(node.text)
        ) {
          const { line } = file.getLineAndCharacterOfPosition(
            node.getStart(file),
          );
          found.push(`src/${name}:${line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  assert.deepEqual(found, []);
});
