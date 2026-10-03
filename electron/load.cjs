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
  for (const media of parsed.media) {
    if (!media.path || media.path.includes("\0"))
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
  return { project: parsed, missing };
}

module.exports = { loadProjectFile };
