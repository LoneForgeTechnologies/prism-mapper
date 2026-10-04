import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signMacApplication } from "./sign-mac.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin")
  throw new Error("This packaging command runs on macOS.");
const source = path.join(root, "node_modules/electron/dist/Electron.app");
await stat(source);
const target = path.join(
  root,
  "release",
  `Prism Mapper-darwin-${process.arch}`,
  "Prism Mapper.app",
);
await mkdir(path.dirname(target), { recursive: true });
execFileSync("/usr/bin/ditto", [source, target]);
const resources = path.join(target, "Contents", "Resources", "app");
await mkdir(resources, { recursive: true });
await cp(path.join(root, "dist"), path.join(resources, "dist"), {
  recursive: true,
});
await cp(path.join(root, "electron"), path.join(resources, "electron"), {
  recursive: true,
  filter: (p) => !p.endsWith(".test.cjs"),
});
await cp(path.join(root, "shared"), path.join(resources, "shared"), {
  recursive: true,
});
await cp(path.join(root, "LICENSE"), path.join(resources, "LICENSE"));
await cp(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  path.join(resources, "THIRD_PARTY_NOTICES.md"),
);
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
await writeFile(
  path.join(resources, "package.json"),
  JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    main: pkg.main,
  }),
);
// Brand icon in place of Electron's (Info.plist already names electron.icns).
await cp(
  path.join(root, "build", "icon.icns"),
  path.join(target, "Contents", "Resources", "electron.icns"),
);
const plist = path.join(target, "Contents", "Info.plist");
for (const [key, value] of Object.entries({
  CFBundleName: "Prism Mapper",
  CFBundleDisplayName: "Prism Mapper",
  CFBundleIdentifier: "org.prismmapper.desktop",
  CFBundleShortVersionString: pkg.version,
  CFBundleVersion: pkg.version,
  NSMicrophoneUsageDescription:
    "Prism Mapper uses your selected audio input to animate projection effects when you press Start listening. Audio is analyzed locally and is never recorded or uploaded.",
  NSAudioCaptureUsageDescription:
    "Prism Mapper uses system audio to animate projection effects when you choose System output and press Start listening. Audio is analyzed locally and is never recorded or uploaded.",
}))
  execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
await signMacApplication(target);
console.log(`\nBuilt local application:\n${target}`);
