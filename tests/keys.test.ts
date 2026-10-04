import test from "node:test";
import assert from "node:assert/strict";
import {
  ownsActivationKeys,
  releaseFocus,
  type FocusHolder,
  type KeyTarget,
} from "../src/keys.ts";

// A stand-in for the element a key press is aimed at.
const element = (
  tagName: string,
  attributes: Record<string, string> = {},
  extra: Partial<KeyTarget> = {},
): KeyTarget => ({
  tagName,
  getAttribute: (name) => attributes[name] ?? null,
  ...extra,
});

test("a focused button, link, summary or form control keeps Space and Enter", () => {
  const owners: Array<[string, KeyTarget]> = [
    ["button", element("BUTTON")],
    ["button in lower case, as XML documents spell it", element("button")],
    ["summary", element("SUMMARY")],
    ["link", element("A", { href: "https://example.com/" })],
    ["link to the top of the page", element("A", { href: "" })],
    ["image map area", element("AREA", { href: "#a" })],
    ["input", element("INPUT")],
    ["text area", element("TEXTAREA")],
    ["select", element("SELECT")],
    ["editable text", element("DIV", {}, { isContentEditable: true })],
  ];
  for (const [name, target] of owners)
    assert.equal(ownsActivationKeys(target), true, name);
});

test("elements that act like controls through their ARIA role do as well", () => {
  for (const role of [
    "button",
    "link",
    "tab",
    "switch",
    "checkbox",
    "radio",
    "menuitem",
    "option",
    "slider",
    "combobox",
    "BUTTON",
    "button link",
  ])
    assert.equal(
      ownsActivationKeys(element("DIV", { role })),
      true,
      `role ${role}`,
    );
});

test("the page, panels and plain elements do not, so the shortcuts still work there", () => {
  const plain: Array<[string, KeyTarget | null]> = [
    ["nothing", null],
    ["the body", element("BODY")],
    ["the stage", element("DIV", { class: "stage" })],
    ["a canvas", element("CANVAS")],
    ["a panel that was given the focus", element("ASIDE", { tabindex: "-1" })],
    ["a dialog", element("SECTION", { role: "dialog" })],
    ["a link with no address", element("A")],
    ["something that is not an element", {}],
    ["an unknown role", element("DIV", { role: "presentation" })],
    ["an empty role", element("DIV", { role: "" })],
    ["editable switched off", element("DIV", {}, { isContentEditable: false })],
  ];
  for (const [name, target] of plain)
    assert.equal(ownsActivationKeys(target), false, name);
});

// A stand-in for the element that has the focus. It records when it lets go.
const holder = (inside: string[] = []) => {
  const calls: string[] = [];
  const element: FocusHolder & { calls: string[] } = {
    calls,
    blur: () => void calls.push("blur"),
    contains: (other) => inside.includes(String(other)),
  };
  return element;
};

test("a press on the stage lets go of the button that was pressed last", () => {
  const lineTool = holder();
  assert.equal(releaseFocus(lineTool, "body", "stage"), true);
  assert.deepEqual(lineTool.calls, ["blur"]);
});

test("a press leaves alone a page that has no control in focus", () => {
  assert.equal(releaseFocus(null, "body", "stage"), false);
  const page = holder();
  assert.equal(releaseFocus(page, page, "stage"), false);
  assert.deepEqual(page.calls, []);
});

test("a press on the control itself, or inside it, keeps the focus there", () => {
  const dialog = holder(["close button", "dialog"]);
  assert.equal(releaseFocus(dialog, "body", "close button"), false);
  assert.equal(releaseFocus(dialog, "body", "dialog"), false);
  assert.deepEqual(dialog.calls, []);
  // The same dialog does let go for a press somewhere else.
  assert.equal(releaseFocus(dialog, "body", "stage"), true);
  assert.deepEqual(dialog.calls, ["blur"]);
});

test("something that cannot give up the focus is left alone", () => {
  assert.equal(releaseFocus({}, "body", "stage"), false);
  assert.equal(releaseFocus({ contains: () => false }, "body", "stage"), false);
});
