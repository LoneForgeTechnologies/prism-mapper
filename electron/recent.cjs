const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { writeFileAtomic } = require("./files.cjs");

const MAX_RECENT_PROJECTS = 8;
const MAX_RECENT_BYTES = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

// Paths enter this list only after main successfully opens or saves a project.
// The renderer receives an opaque id; it cannot submit a path to reopen a file.
function createRecentProjects({
  filename,
  fs = fsp,
  pathApi = path,
  platform = process.platform,
  uuid = randomUUID,
  now = Date.now,
  write = (target, contents) => writeFileAtomic(target, contents, { fs }),
} = {}) {
  let entries = [];
  let initialized = false;
  let chain = Promise.resolve();
  const key = (value) => (platform === "win32" ? value.toLowerCase() : value);
  const validPath = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !CONTROL.test(value) &&
    pathApi.isAbsolute(value) &&
    pathApi.extname(value).toLowerCase() === ".json";

  async function initialize() {
    if (initialized) return;
    if (!filename) {
      initialized = true;
      return;
    }
    let text;
    try {
      text = await fs.readFile(filename, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      initialized = true;
      return;
    }
    initialized = true;
    if (Buffer.byteLength(text, "utf8") > MAX_RECENT_BYTES) return;
    let saved;
    try {
      saved = JSON.parse(text);
    } catch {
      return;
    }
    if (saved?.version !== 1 || !Array.isArray(saved.projects)) return;
    const ids = new Set();
    const paths = new Set();
    for (const entry of saved.projects.slice(0, 128)) {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        !UUID.test(entry.id) ||
        typeof entry.name !== "string" ||
        entry.name.length > 200 ||
        CONTROL.test(entry.name) ||
        !validPath(entry.path) ||
        typeof entry.updatedAt !== "number" ||
        !Number.isFinite(entry.updatedAt) ||
        entry.updatedAt < 0
      )
        continue;
      const absolute = pathApi.resolve(entry.path);
      if (ids.has(entry.id) || paths.has(key(absolute))) continue;
      ids.add(entry.id);
      paths.add(key(absolute));
      entries.push({
        id: entry.id,
        name: entry.name,
        path: absolute,
        updatedAt: entry.updatedAt,
      });
    }
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    entries = entries.slice(0, MAX_RECENT_PROJECTS);
  }

  // Reads and writes share one queue: simultaneous opens cannot overwrite one
  // another's history, and readers see each completed update in order.
  function run(operation) {
    const result = chain.then(async () => {
      await initialize();
      return operation();
    });
    chain = result.catch(() => {});
    return result;
  }

  return {
    list: () => run(() => entries.map((entry) => ({ ...entry }))),
    resolve: (id) =>
      run(() => {
        if (typeof id !== "string" || !UUID.test(id)) return null;
        const entry = entries.find((entry) => entry.id === id);
        return entry ? { ...entry } : null;
      }),
    remember: (projectPath, projectName) =>
      run(async () => {
        if (!validPath(projectPath))
          throw new Error("A recent project needs an absolute JSON file path");
        const absolute = pathApi.resolve(projectPath);
        const existing = entries.find(
          (entry) => key(entry.path) === key(absolute),
        );
        const name =
          typeof projectName === "string" && !CONTROL.test(projectName)
            ? projectName.slice(0, 200)
            : pathApi.basename(absolute);
        const entry = {
          id: existing?.id ?? uuid(),
          name: name || pathApi.basename(absolute),
          path: absolute,
          updatedAt: now(),
        };
        entries = [
          entry,
          ...entries.filter((item) => key(item.path) !== key(absolute)),
        ].slice(0, MAX_RECENT_PROJECTS);
        if (filename) {
          await fs.mkdir(pathApi.dirname(filename), { recursive: true });
          await write(
            filename,
            JSON.stringify({ version: 1, projects: entries }, null, 2) + "\n",
          );
        }
        return { ...entry };
      }),
  };
}

module.exports = { createRecentProjects, MAX_RECENT_PROJECTS };
