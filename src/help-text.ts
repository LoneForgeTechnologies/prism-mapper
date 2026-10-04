import type { HelpPlatform } from "./platform";

/**
 * The words of the first-run setup guide. They depend on the device: the steps
 * for a Mac, for Windows, for a phone or a tablet and for a browser are not the
 * same, and a guide that names the wrong menu is worse than none. No dashes
 * (em or en) in any of it; tests/help-text.test.ts checks.
 */
export interface HelpStep {
  title: string;
  text: string;
}
/** A piece of the tip under the steps: plain words, or a key to draw as a key. */
export type HelpTipPart = string | { key: string };
export interface HelpGuide {
  steps: HelpStep[];
  tip: HelpTipPart[];
}

const BEAM = "Place the projector so your object is fully inside its beam.";
const OWN_LAYER = "Each outline is its own layer.";
const MASK_AND_SAVE =
  "Add a Mask to cut light out around a window or doorway. Save your project to keep the layout.";
const makeItYours = (choose: string): HelpStep => ({
  title: "Make it yours.",
  text: `${OWN_LAYER} ${choose}; try Shape effects to light its edges. ${MASK_AND_SAVE}`,
});

function extend(platform: HelpPlatform): HelpStep {
  const title = "Extend your desktop.";
  switch (platform) {
    case "mac":
      return {
        title,
        text: `In macOS System Settings → Displays, set the projector to an extended display. ${BEAM}`,
      };
    case "windows":
      return {
        title,
        text: `Press Windows + P and choose Extend, so the projector is a second screen. ${BEAM}`,
      };
    case "touch":
      return {
        title: "Connect a screen.",
        text: `Plug your phone or tablet into the projector with a video cable, or mirror its screen to it. ${BEAM}`,
      };
    case "browser":
      return {
        title,
        text: `In your display settings (System Settings → Displays on a Mac, Windows + P and then Extend on Windows), set the projector to an extended display and drag this window onto it. ${BEAM}`,
      };
    default:
      return {
        title,
        text: `In your system's display settings, set the projector to an extended display. ${BEAM}`,
      };
  }
}

export function helpGuide(platform: HelpPlatform): HelpGuide {
  const edges = "Find the edges.";
  if (platform === "touch")
    return {
      steps: [
        extend(platform),
        {
          title: edges,
          text: "Tap Rectangle for a flat face, or Draw outline and tap each corner. Tap the first point again to close your outline. Then open Show, choose Present on this screen, turn on Align, and drag the corners onto your object.",
        },
        makeItYours("Select a layer, open Looks and choose an animation"),
      ],
      tip: [
        "Tap the screen while presenting to bring the controls back. Blackout turns the light off at once.",
      ],
    };
  if (platform === "browser")
    return {
      steps: [
        extend(platform),
        {
          title: edges,
          text: "Use a rectangle for a flat face, or the Line tool to trace each corner. Click the first point again to close your outline. Then choose Present on this screen, turn on Align, and drag the corners onto your object.",
        },
        makeItYours("Select a layer and choose an animation"),
      ],
      tip: [
        { key: "B" },
        " instantly blacks out the light. ",
        { key: "Esc" },
        " leaves Present.",
      ],
    };
  return {
    steps: [
      extend(platform),
      {
        title: edges,
        text: "Choose your projector under Target display and open output. Use a rectangle for a flat face, or the Line tool to trace each corner. Click the first point again to close your outline.",
      },
      makeItYours("Select a layer and choose an animation"),
    ],
    tip: [
      { key: "G" },
      " shows your outline on the projector. ",
      { key: "B" },
      " instantly blacks out the light.",
    ],
  };
}
