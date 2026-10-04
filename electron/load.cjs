const fsp = require("node:fs/promises");
const path = require("node:path");
const { parseProject, mediaKind, MAX_PROJECT_BYTES } = require("./project.cjs");
const { mediaPathCandidates, mayOpenMedia } = require("./paths.cjs");

// Read a project file and find its media. This is the one way a project is
// opened: the Open button, a double-clicked file, "Open with", a second launch
// and macOS open-file all come through here, so they share every check.
//
// registerMedia(file) hands out the media:// address of a file that exists; it
// is the only way a project's media can reach the page.
async function loadProjectFile(
  filename,
  { registerMedia, fs = fsp, pathApi = path },
) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > MAX_PROJECT_BYTES)
    throw new Error("Project files must be smaller than 5 MB");
  const parsed = parseProject(await fs.readFile(filename, "utf8"));
  const missing = [];
  // The web app saves media it imported without a path: the picture lived in
  // the browser, so there is no file to look for. That is not a reason to
  // refuse the whole project. The entry is dropped, its layers show the grid
  // until the file is imported again, and it is reported like a missing file.
  const dropped = new Set();
  for (const media of parsed.media) {
    if (!media.path) {
      dropped.add(media.id);
      missing.push(media.name);
      continue;
    }
    if (media.path.includes("\0"))
      throw new Error("A media entry has no valid local path");
    const candidates = mediaPathCandidates(filename, media.path, pathApi);
    if (mediaKind(candidates[0], pathApi) !== media.kind)
      throw new Error(`Unsupported media type: ${media.name}`);
    // A missing file keeps its resolved path, so saving the project again
    // does not lose where the media was meant to be.
    media.path = candidates[0];
    let found = null;
    for (const candidate of candidates) {
      if (!mayOpenMedia(candidate, filename, pathApi)) continue;
      try {
        if ((await fs.stat(candidate)).isFile()) {
          found = candidate;
          break;
        }
      } catch {
        /* Try the next spelling. */
      }
    }
    if (found) Object.assign(media, registerMedia(found));
    else {
      media.url = "";
      missing.push(media.name);
    }
  }
  if (dropped.size) {
    parsed.media = parsed.media.filter((media) => !dropped.has(media.id));
    const snapshots = [
      parsed.surfaces,
      ...(parsed.show?.scenes.map((scene) => scene.surfaces) || []),
    ];
    for (const surfaces of snapshots)
      for (const surface of surfaces)
        if (dropped.has(surface.source)) surface.source = "grid";
  }
  // A show is recalled ready for the operator to start it. Session transport
  // is never restored from disk, and its base scene must not resume video
  // while switching shows. The saved blackout setting remains the operator's.
  if (parsed.show) {
    parsed.playing = false;
  }
  return { project: parsed, missing };
}

module.exports = { loadProjectFile };
