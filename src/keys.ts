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

/** What holds the focus, as far as letting go of it needs to know. */
export interface FocusHolder {
  blur?(): void;
  contains?(other: unknown): boolean;
}

/**
 * The drawing stage cancels pointerdown so the browser does not start a drag or
 * a text selection, and a canceled pointerdown also keeps the focus on the
 * control pressed last. Pressing the stage after the Line tool button would
 * then leave Enter to that button instead of closing the outline. A press on
 * the stage lets the old control go, as a click on any plain area does.
 * Returns true when it did.
 */
export function releaseFocus(
  active: FocusHolder | null,
  page: unknown,
  pressed: unknown,
): boolean {
  if (!active || active === page || typeof active.blur !== "function")
    return false;
  // The press landed on the control itself or inside it.
  if (active.contains?.(pressed)) return false;
  active.blur();
  return true;
}

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
