import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseName } from "./release-name.mjs";
import { createZip, verifyZip } from "./zip.mjs";
import {
  requireSignedRelease,
  verifyWindowsApplication,
  windowsSigningEnabled,
} from "./sign-windows.mjs";
import {
  assertStamped,
  executableMetadata,
  iconSizes,
  stampExecutableFile,
} from "./windows-exe.mjs";

export { releaseName };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const applicationFiles = [
  "electron/main.cjs",
  "electron/preload.cjs",
  "electron/project.cjs",
  "electron/media.cjs",
  "electron/audio.cjs",
  "electron/launch.cjs",
  "electron/load.cjs",
  "electron/paths.cjs",
  "electron/files.cjs",
  "electron/recent.cjs",
  "electron/wakelock.cjs",
  "electron/window-size.cjs",
  "shared/patterns.json",
  "build/icon.ico",
  "build/icon.png",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];
export const examples = [
  "indoor-cube.prism.json",
  "architectural-study.prism.json",
  "halloween-haunt.prism.json",
];

// Finder lists Prism Mapper in "Open With" for JSON files, which is what a
// project is, and then hands the file to the app (open-file). Rank "Alternate"
// means it never becomes the default program for JSON files.
export const macDocumentTypes = Object.freeze([
  {
    CFBundleTypeName: "Prism Mapper project",
    CFBundleTypeRole: "Editor",
    LSHandlerRank: "Alternate",
    CFBundleTypeExtensions: ["json"],
    LSItemContentTypes: ["public.json"],
  },
]);

// Reject sensitive development folders and any archive path that could escape
// the containing folder. These checks also run against the finished ZIP.
export function verifyArchiveEntries(entries, folder, requiredEntries) {
  const files = new Set();
  for (const original of entries) {
    const entry = original.replaceAll("\\", "/").replace(/\/$/, "");
    const parts = entry.split("/");
    if (
      parts[0] !== folder ||
      parts.some(
        (part) =>
          [
            "",
            ".",
            "..",
            ".git",
            "node_modules",
            "session-backups",
            "artifacts",
          ].includes(part) ||
          part.startsWith(".env") ||
          part.endsWith(".test.cjs") ||
          part.endsWith(".log"),
      )
    )
      throw new Error(`Unexpected release archive entry: ${original}`);
    files.add(entry);
  }
  for (const required of requiredEntries) {
    if (!files.has(`${folder}/${required}`))
      throw new Error(`Release archive is missing ${required}`);
  }
}

async function copyPublicFile(relative, destination) {
  const source = path.join(root, relative);
  if (!(await lstat(source)).isFile())
    throw new Error(`Expected a regular public file: ${relative}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

// The web build (the installable web app) adds these next to index.html. The
// desktop shell loads its page from disk and never uses them, so they are left
// out of the packaged app. The list is exact and only applies at the top of
// dist/: any other file the build produces must be reviewed, not copied.
export const webOnlyBuildPaths = Object.freeze([
  "manifest.webmanifest",
  "sw.js",
  "icons",
  "apple-touch-icon.png",
  "favicon.svg",
  "favicon-32.png",
]);

// Copies the production build into the application and returns the web-only
// entries it left out. Anything it does not recognise stops packaging.
export async function copyBuild(source, destination, relative = "") {
  const skipped = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (webOnlyBuildPaths.includes(name)) {
      skipped.push(name);
    } else if (
      entry.isDirectory() &&
      ["assets", "previews"].includes(entry.name)
    ) {
      await mkdir(to, { recursive: true });
      skipped.push(...(await copyBuild(from, to, name)));
    } else if (
      entry.isFile() &&
      !entry.name.startsWith(".") &&
      /\.(?:html|js|css|png|svg|webp|ico|woff2?)$/.test(entry.name)
    ) {
      await cp(from, to);
    } else {
      throw new Error(`Unexpected file in production build: ${from}`);
    }
  }
  return skipped;
}

const guide = (extend) =>
  `Use an extended desktop for your projector${extend}, then select its display in Prism Mapper. Line tool lets you trace corners; click the first point to close the outline. Each layer can play its own animation. Press B for blackout. Example projects are included in the Example projects folder; open them with the app's Open button.\n\nAudio react starts only when you press Start listening and approve the requested access. Audio is analyzed locally.\n\nUpdates: download the newer ZIP from this project's GitHub Releases page, quit Prism Mapper, and replace the application. Save your project before updating. There is no automatic updater.\n`;

export function startHereText(
  version,
  platform,
  { signed = false, notarized = false } = {},
) {
  if (platform === "darwin")
    return `Prism Mapper ${version}\n\nMove Prism Mapper.app to Applications, then open it. ${signed && notarized ? "This app is signed with an Apple Developer ID and notarized by Apple. macOS may still ask you to confirm the first launch of a downloaded app." : "This development build is ad-hoc signed, not notarized by Apple. If macOS blocks it, review System Settings > Privacy & Security after the first launch attempt and use Open Anyway only if you trust this download."}\n\n${guide("")}`;
  const signing = signed
    ? "The app carries a verified, timestamped publisher signature. Windows SmartScreen may still warn that a new download is unrecognized until publisher reputation builds. A valid signature does not guarantee an immediate warning-free first launch."
    : 'This development build is not code-signed, so Windows SmartScreen may show "Windows protected your PC" the first time you run it. Select "More info", then "Run anyway", but only if you trust where you downloaded it.';
  return `Prism Mapper ${version} for Windows (64-bit)\n\nExtract the ENTIRE ZIP first: right-click the ZIP and choose Extract All. Open the Prism Mapper folder and double-click Prism Mapper.exe. Keep all files in that folder together.\n\n${signing}\n\nPrefer an installer? ${releaseName(version, "win32", "x64")}-Setup.exe on the same release page installs Prism Mapper for your user account without administrator rights and adds a Start Menu entry and an uninstaller. Run a newer Setup over an existing installation to update it. ${signed ? "Published signed releases also verify the installer and uninstaller signatures." : "Development installers are not code-signed either and may show the same SmartScreen prompt."}\n\nWindows support is new. This build was checked automatically on a Windows PC without a projector and has not yet been tested with a physical projector. Please report problems on the project's GitHub Issues page.\n\n${guide(" (press the Windows key + P and choose Extend)")}`;
}

// The options exist so the whole Windows packaging flow can be rehearsed on any
// host with a stand-in Electron runtime; a real release uses the defaults.
export async function stageRelease({
  platform = process.platform,
  arch = process.arch,
  runtime = path.join(root, "node_modules", "electron", "dist"),
  build = path.join(root, "dist"),
  output = path.join(root, "release", "distribution"),
  signMac = async (application) =>
    (await import("./sign-mac.mjs")).signMacApplication(application),
} = {}) {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const folder = releaseName(pkg.version, platform, arch);
  for (const [variable, host, actual] of [
    ["PRISM_TARGET_PLATFORM", process.platform, platform],
    ["PRISM_TARGET_ARCH", process.arch, arch],
  ]) {
    // A rehearsal for another platform is not the host the variable describes.
    if (
      host === actual &&
      process.env[variable] &&
      process.env[variable] !== actual
    )
      throw new Error(
        `${variable} does not match this packaging host (${actual})`,
      );
  }
  const staging = path.join(output, pkg.version, `${platform}-${arch}`);
  const contents = path.join(staging, folder);
  const archive = path.join(output, `${folder}.zip`);
  await stat(path.join(build, "index.html"));
  await stat(runtime);
  await mkdir(output, { recursive: true });
  await rm(archive, { force: true });
  await rm(`${archive}.sha256`, { force: true });
  // This directory is dedicated to disposable distribution staging. Never use
  // the user's locally installed release/Prism Mapper-darwin-* application.
  await rm(staging, { recursive: true, force: true });
  await mkdir(contents, { recursive: true });
  const mac = platform === "darwin";
  let signing = { signed: false, notarized: false };
  const application = path.join(
    contents,
    mac ? "Prism Mapper.app" : "Prism Mapper",
  );
  if (mac) {
    execFileSync("/usr/bin/ditto", [
      path.join(runtime, "Electron.app"),
      application,
    ]);
  } else {
    await cp(runtime, application, { recursive: true });
    await rename(
      path.join(application, "electron.exe"),
      path.join(application, "Prism Mapper.exe"),
    );
    // Newer Electron builds use this matching DLL name for Windows crash reports.
    const crashDll = path.join(application, "electron_wer.dll");
    if (await stat(crashDll).catch(() => null))
      await rename(crashDll, path.join(application, "Prism Mapper_wer.dll"));
    // Explorer, Task Manager, the taskbar and SmartScreen read the icon and the
    // version block of the executable, which still say "Electron" at this point.
    const metadata = executableMetadata({
      version: pkg.version,
      license: await readFile(path.join(root, "LICENSE"), "utf8"),
      fileName: "Prism Mapper.exe",
    });
    const stamped = await stampExecutableFile(
      path.join(application, "Prism Mapper.exe"),
      { iconFile: path.join(root, "build", "icon.ico"), metadata },
    );
    assertStamped(
      stamped,
      metadata,
      iconSizes(await readFile(path.join(root, "build", "icon.ico"))),
    );
    console.log(
      `Stamped Prism Mapper.exe: ${stamped.strings.ProductName} ${stamped.strings.ProductVersion}, icon sizes ${stamped.iconGroups.map((group) => group.sizes.join("/")).join(" | ")}`,
    );
  }
  const resources = path.join(
    application,
    ...(mac ? ["Contents", "Resources"] : ["resources"]),
  );
  await rm(path.join(resources, "default_app.asar"), { force: true });
  const applicationRoot = path.join(resources, "app");
  await mkdir(path.join(applicationRoot, "dist"), { recursive: true });
  const webOnly = await copyBuild(build, path.join(applicationRoot, "dist"));
  if (webOnly.length)
    console.log(
      `Left web-only build files out of the app: ${webOnly.join(", ")}`,
    );
  for (const relative of applicationFiles)
    await copyPublicFile(relative, path.join(applicationRoot, relative));
  await writeFile(
    path.join(applicationRoot, "package.json"),
    `${JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        license: pkg.license,
        main: "electron/main.cjs",
      },
      null,
      2,
    )}\n`,
  );
  for (const name of examples)
    await copyPublicFile(
      `examples/${name}`,
      path.join(contents, "Example projects", name),
    );
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
    await copyPublicFile(name, path.join(contents, name));
  for (const [source, target] of [
    ["LICENSE", "ELECTRON-LICENSE.txt"],
    ["LICENSES.chromium.html", "LICENSES.chromium.html"],
  ])
    await cp(path.join(runtime, source), path.join(contents, target));
  await writeFile(
    path.join(contents, "START HERE.txt"),
    startHereText(pkg.version, platform),
  );

  if (mac) {
    const plist = path.join(application, "Contents", "Info.plist");
    const bundleId = "org.prismmapper.desktop";
    for (const [key, value] of Object.entries({
      CFBundleName: "Prism Mapper",
      CFBundleDisplayName: "Prism Mapper",
      CFBundleIdentifier: bundleId,
      CFBundleShortVersionString: pkg.version,
      CFBundleVersion: pkg.version,
      NSMicrophoneUsageDescription:
        "Prism Mapper analyzes your selected audio input locally to animate effects when you press Start listening. Audio is never recorded or uploaded.",
      NSAudioCaptureUsageDescription:
        "Prism Mapper analyzes system audio locally to animate effects when you choose System output and press Start listening. Audio is never recorded or uploaded.",
    }))
      execFileSync("/usr/bin/plutil", [
        "-replace",
        key,
        "-string",
        value,
        plist,
      ]);
    execFileSync("/usr/bin/plutil", [
      "-replace",
      "CFBundleDocumentTypes",
      "-json",
      JSON.stringify(macDocumentTypes),
      plist,
    ]);
    // Helpers retain Electron's executable names, while bundle metadata identifies
    // this application and keeps helper bundle identifiers distinct.
    const frameworks = path.join(application, "Contents", "Frameworks");
    for (const name of await readdir(frameworks)) {
      if (!name.startsWith("Electron Helper") || !name.endsWith(".app"))
        continue;
      const helperPlist = path.join(frameworks, name, "Contents", "Info.plist");
      const suffix = name
        .slice("Electron Helper".length, -4)
        .replace(/[^a-zA-Z]/g, "")
        .toLowerCase();
      for (const [key, value] of Object.entries({
        CFBundleName: name.slice(0, -4).replace("Electron", "Prism Mapper"),
        CFBundleDisplayName: name
          .slice(0, -4)
          .replace("Electron", "Prism Mapper"),
        CFBundleIdentifier: `${bundleId}.helper${suffix ? `.${suffix}` : ""}`,
      }))
        execFileSync("/usr/bin/plutil", [
          "-replace",
          key,
          "-string",
          value,
          helperPlist,
        ]);
    }
    // Replace Electron's icon with the Prism Mapper icon before signing seals
    // the bundle (Info.plist already names electron.icns as the icon file).
    await cp(
      path.join(root, "build", "icon.icns"),
      path.join(application, "Contents", "Resources", "electron.icns"),
    );
    signing = await signMac(application);
  }

  // This record is outside the downloadable folder; it contains no secrets or
  // paths. Finalization reconstructs its paths and verifies actual signatures.
  await writeFile(
    path.join(staging, "release-stage.json"),
    JSON.stringify({ version: pkg.version, platform, arch, signing }) + "\n",
  );
  return { archive, contents, folder, application, staging, signing };
}

export async function verifyMacApplication(application, signing) {
  const helper = await import("./sign-mac.mjs");
  helper.verifyMacApplication(application, {
    ...signing,
    team: process.env.PRISM_MAC_TEAM_ID || signing.team,
  });
}

// External signing happens between staging and finalization on Windows. The
// final signature is verified before a ZIP or checksum is created.
export async function finalizeRelease({
  platform = process.platform,
  arch = process.arch,
  output = path.join(root, "release", "distribution"),
  requireSigned = requireSignedRelease(),
  windowsSigned = windowsSigningEnabled(),
  verifyWindows = verifyWindowsApplication,
  verifyMac = verifyMacApplication,
} = {}) {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const folder = releaseName(pkg.version, platform, arch);
  const staging = path.join(output, pkg.version, `${platform}-${arch}`);
  const contents = path.join(staging, folder);
  const archive = path.join(output, `${folder}.zip`);
  const mac = platform === "darwin";
  const application = path.join(
    contents,
    mac ? "Prism Mapper.app" : "Prism Mapper",
  );
  const stage = JSON.parse(
    await readFile(path.join(staging, "release-stage.json"), "utf8"),
  );
  if (
    stage.version !== pkg.version ||
    stage.platform !== platform ||
    stage.arch !== arch ||
    typeof stage.signing?.signed !== "boolean" ||
    typeof stage.signing?.notarized !== "boolean"
  )
    throw new Error(
      "The staged release does not match this version and platform. Stage it again before signing.",
    );
  let signing = stage.signing;
  if (mac) {
    if (requireSigned && (!signing.signed || !signing.notarized))
      throw new Error(
        "A published Mac release requires Developer ID signing and notarization. Configure the MAC_* credentials or use a dry run.",
      );
    await verifyMac(application, signing);
  } else if (windowsSigned) {
    signing = await verifyWindows(application);
    if (signing?.signed !== true)
      throw new Error(
        "The staged Windows application did not pass signature verification",
      );
  } else if (requireSigned) {
    throw new Error(
      "A published Windows release requires Artifact Signing. Configure the Windows signing variables or use a dry run.",
    );
  }
  await writeFile(
    path.join(contents, "START HERE.txt"),
    startHereText(pkg.version, platform, signing),
  );

  await rm(archive, { force: true });
  const appPrefix = mac
    ? "Prism Mapper.app/Contents/Resources/app"
    : "Prism Mapper/resources/app";
  const required = [
    "START HERE.txt",
    "ELECTRON-LICENSE.txt",
    "LICENSES.chromium.html",
    `${appPrefix}/package.json`,
    `${appPrefix}/dist/index.html`,
    ...applicationFiles.map((name) => `${appPrefix}/${name}`),
    ...examples.map((name) => `Example projects/${name}`),
    ...(mac
      ? [
          "Prism Mapper.app/Contents/MacOS/Electron",
          "Prism Mapper.app/Contents/Resources/electron.icns",
        ]
      : ["Prism Mapper/Prism Mapper.exe"]),
  ];
  let entries;
  if (mac) {
    execFileSync("/usr/bin/ditto", [
      "-c",
      "-k",
      "--norsrc",
      "--noextattr",
      "--noqtn",
      "--keepParent",
      contents,
      archive,
    ]);
    execFileSync("/usr/bin/unzip", ["-tqq", archive]);
    entries = execFileSync("/usr/bin/unzip", ["-Z1", archive], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
      .trim()
      .split("\n");
  } else {
    await createZip(contents, archive);
    entries = await verifyZip(archive);
  }
  verifyArchiveEntries(entries, folder, required);
  const checksum = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(
    `${archive}.sha256`,
    `${checksum}  ${path.basename(archive)}\n`,
  );
  console.log(`Verified release archive:\n${archive}\nSHA-256: ${checksum}`);
  return { archive, checksum, contents, folder, application, staging, signing };
}

export async function packageRelease(options = {}) {
  await stageRelease(options);
  return finalizeRelease(options);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length === 0) await packageRelease();
  else if (args.length === 1 && args[0] === "--stage-only")
    await stageRelease();
  else if (args.length === 1 && args[0] === "--finalize")
    await finalizeRelease();
  else
    throw new Error(
      "Usage: node scripts/package-release.mjs [--stage-only|--finalize]",
    );
}
