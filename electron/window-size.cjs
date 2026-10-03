// Size of the editor window, in the page area (the window without its title bar,
// borders and menu bar) so that Windows, macOS and Linux give the page the same
// room. The page itself (.app-shell in src/style.css) wants at least 1050 x 700
// and scrolls when it has less.
const PAGE_MINIMUM = Object.freeze({ width: 1050, height: 700 });
const PREFERRED = Object.freeze({ width: 1460, height: 912 });
// A little wider than the page minimum, and narrow enough for a 1366 pixel
// laptop screen at 125% scaling (1093 logical pixels) to hold the whole window.
const MINIMUM = Object.freeze({ width: 1080, height: 700 });
// Windows 10 and 11 put 16 x 65 logical pixels of title bar, menu bar and
// borders around the page (measured on a release build at 100%, 125% and 150%
// scaling; less at higher scaling). This is a little more, and also covers
// macOS and Linux title bars.
const FRAME = Object.freeze({ width: 24, height: 72 });
const FLOOR = Object.freeze({ width: 600, height: 400 });

// workArea is the part of the display that windows may use, in logical pixels
// (Electron's display.workArea): the screen without the taskbar or dock.
//
// The minimum is what the page needs, but never more than the screen can hold:
// a 1366 x 768 laptop at 125% or 150% scaling has only 1093 x 574 or 911 x 472
// logical pixels to give. A window that cannot be made small enough to fit
// hides its bottom edge, so there the page scrolls instead.
function editorWindowGeometry(workArea, frame = FRAME) {
  const room = {
    width: workArea.width - frame.width,
    height: workArea.height - frame.height,
  };
  const minWidth = Math.max(Math.min(MINIMUM.width, room.width), FLOOR.width);
  const minHeight = Math.max(
    Math.min(MINIMUM.height, room.height),
    FLOOR.height,
  );
  return {
    useContentSize: true,
    width: Math.max(Math.min(PREFERRED.width, room.width), minWidth),
    height: Math.max(Math.min(PREFERRED.height, room.height), minHeight),
    minWidth,
    minHeight,
    // On a smaller screen than the preferred size, start maximised rather than
    // as a window that hangs off the edge.
    maximize: room.width < PREFERRED.width || room.height < PREFERRED.height,
  };
}

module.exports = {
  editorWindowGeometry,
  PAGE_MINIMUM,
  PREFERRED,
  MINIMUM,
  FRAME,
  FLOOR,
};
