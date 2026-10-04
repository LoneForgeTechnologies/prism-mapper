const path = require("node:path");
const { fileURLToPath } = require("node:url");

// The project a launch asks for: the first plain argument that names a .json
// file. Switches, the executable and (in development) Electron's own app path
// are skipped. This is what Windows passes for a double-clicked file, for
// "Open with", and to an already running copy as second-instance arguments.
function projectPathFromArgv(
  argv,
  { cwd = process.cwd(), defaultApp = false, pathApi = path } = {},
) {
  // argv[0] is the executable; with `electron .` argv[1] is the app folder.
  for (const argument of argv.slice(defaultApp ? 2 : 1)) {
    if (typeof argument !== "string" || !argument || argument.startsWith("-"))
      continue;
    let candidate = argument;
    if (/^file:/i.test(candidate)) {
      try {
        candidate = fileURLToPath(candidate, {
          windows: pathApi === path.win32,
        });
      } catch {
        continue;
      }
    }
    if (pathApi.extname(candidate).toLowerCase() !== ".json") continue;
    return pathApi.resolve(cwd, candidate);
  }
  return null;
}

// Requests to open a project arrive from the OS at any time, including before
// the editor page exists. This keeps the newest request until the page says it
// can show a project, then loads one at a time, in order. Loading is the same
// function as the Open button uses, so there is one validation path. A result
// that finishes while the page is away (it was reloaded) waits for the next
// time the page is ready rather than being lost.
function createProjectOpener({ load, deliver }) {
  let pending = null;
  let waiting = null;
  let ready = false;
  let chain = Promise.resolve();
  const give = (payload) => {
    try {
      deliver(payload);
    } catch {
      /* The page went away; there is nobody to tell. */
    }
  };
  function drain() {
    if (!ready) return chain;
    if (waiting !== null) {
      const payload = waiting;
      waiting = null;
      give(payload);
    }
    if (pending === null) return chain;
    const filename = pending;
    pending = null;
    chain = chain
      .then(async () => {
        let result;
        try {
          result = await load(filename);
        } catch (error) {
          result = {
            error: error?.message || "The project could not be opened",
          };
        }
        const payload = { ...result, path: filename };
        if (ready) give(payload);
        else waiting = payload;
      })
      .catch(() => {});
    return chain;
  }
  return {
    request(filename) {
      pending = filename;
      return drain();
    },
    setReady(value) {
      ready = value === true;
      return drain();
    },
    hasPending: () => pending !== null || waiting !== null,
  };
}

module.exports = { projectPathFromArgv, createProjectOpener };
