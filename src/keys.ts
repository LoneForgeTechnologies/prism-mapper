/**
 * Space and Enter press the control that has the focus: a button, a link, a
 * summary, a checkbox, a tab. A shortcut that takes them for itself (Space to
 * play and pause, Enter to close an outline) makes Tab then Space do the wrong
 * thing and leaves keyboard users unable to press anything.
 */

/** What a key press is aimed at, as far as this check needs to know. */
export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
}

const TAGS = new Set(["BUTTON", "SUMMARY", "SELECT", "INPUT", "TEXTAREA"]);
const ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "option",
  "slider",
  "spinbutton",
  "combobox",
  "textbox",
  "searchbox",
  "listbox",
  "treeitem",
]);

/** The focused element handles Space and Enter itself, so a shortcut must leave them alone. */
export function ownsActivationKeys(target: KeyTarget | null): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (TAGS.has(tag)) return true;
  // A link without an address is plain text, not a control.
  if ((tag === "A" || tag === "AREA") && target.getAttribute?.("href") != null)
    return true;
  if (target.isContentEditable === true) return true;
  const role = target.getAttribute?.("role");
  // The attribute can list fallback roles, such as "button link".
  return (
    !!role &&
    role
      .toLowerCase()
      .split(/\s+/)
      .some((r) => ROLES.has(r))
  );
}
