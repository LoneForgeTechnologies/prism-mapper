const path = require("node:path");

// A project names its media by path. The file may have been written on another
// computer or another operating system, so the spelling is not trusted.

// Where a project's media path can point once it is resolved against the
// folder of the project file. Windows accepts either separator, so a path
// written with forward slashes (what this app writes) and one with backslashes
// (a hand-edited file) both work there. Elsewhere a backslash is an ordinary
// file name character, so the literal spelling is tried first and the
// Windows-style reading of it second.
function mediaPathCandidates(projectFile, mediaPath, pathApi = path) {
  const folder = pathApi.dirname(projectFile);
  const candidates = [pathApi.resolve(folder, mediaPath)];
  if (pathApi !== path.win32 && mediaPath.includes("\\")) {
    const windowsStyle = pathApi.resolve(
      folder,
      mediaPath.replaceAll("\\", "/"),
    );
    if (!candidates.includes(windowsStyle)) candidates.push(windowsStyle);
  }
  return candidates;
}

// Windows paths that leave the computer or name a device instead of a file:
// \\server\share\x (UNC), \\?\UNC\server\share\x and the \\.\ device
// namespace. A plain drive path, with or without the \\?\ long-path prefix, is
// local and returns null.
function networkLocation(filename) {
  const prefixed = /^[\\/]{2}([?.])[\\/]+(.*)$/s.exec(filename);
  if (prefixed) {
    const unc = /^UNC[\\/]+([^\\/]+)/i.exec(prefixed[2]);
    if (unc) return { kind: "unc", host: unc[1].toLowerCase() };
    if (prefixed[1] === "?" && /^[A-Za-z]:(?:[\\/]|$)/.test(prefixed[2]))
      return null;
    return { kind: "device" };
  }
  const unc = /^[\\/]{2}([^\\/]+)/.exec(filename);
  return unc ? { kind: "unc", host: unc[1].toLowerCase() } : null;
}

// Opening a project must not make Windows contact a server the user never
// chose: touching \\host\share sends the user's network credentials to that
// host, and a project file from the internet can name any host. Media on the
// same server as the project file itself is fine, and so is anything on a
// drive letter (a mapped network drive was the user's own choice). Anything
// else is treated as missing, and the user can import it again on purpose.
function mayOpenMedia(mediaPath, projectFile, pathApi = path) {
  if (pathApi !== path.win32) return true;
  const target = networkLocation(mediaPath);
  if (!target) return true;
  const own = networkLocation(projectFile);
  return (
    target.kind === "unc" && own?.kind === "unc" && own.host === target.host
  );
}

const DEVICE_NAMES =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/i;

// The file name offered in the Save dialog for a project name. Characters no
// file system accepts become hyphens. Windows also rejects a trailing dot or
// space and the names of old devices (CON, NUL, COM1...), with any extension.
function defaultProjectFileName(
  name,
  platform = process.platform,
  extension = ".prism.json",
) {
  let base = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "-")
    .slice(0, 100);
  if (platform === "win32") {
    base = base.replace(/^[\s.]+|[\s.]+$/g, "");
    const dot = base.indexOf(".");
    const head = dot < 0 ? base : base.slice(0, dot);
    if (DEVICE_NAMES.test(head.trimEnd()))
      base = `${head}_${base.slice(head.length)}`;
  }
  return `${base || "Untitled mapping"}${extension}`;
}

module.exports = {
  mediaPathCandidates,
  networkLocation,
  mayOpenMedia,
  defaultProjectFileName,
};
