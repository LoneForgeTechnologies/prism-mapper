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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const applicationFiles = [
  "electron/main.cjs",
  "electron/preload.cjs",
  "electron/project.cjs",
  "electron/media.cjs",
  "electron/audio.cjs",
  "shared/patterns.json",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];
const examples = [
  "indoor-cube.prism.json",
  "architectural-study.prism.json",
  "halloween-haunt.prism.json",
];

export function releaseName(version, platform, arch) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw new Error("Invalid release version");
  if (!(
    (platform === "darwin" && ["arm64", "x64"].includes(arch)) ||
    (platform === "win32" && arch === "x64")
  ))
    throw new Error(
      "Release packaging supports macOS arm64/x64 and Windows x64",
    );
  return `Prism-Mapper-v${version}-${platform === "darwin" ? "macOS" : "Windows"}-${arch}`;
}

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

async function copyBuild(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory() && ["assets", "previews"].includes(entry.name)) {
      await mkdir(to, { recursive: true });
      await copyBuild(from, to);
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
}

function powershell(script, environment) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

export async function packageRelease() {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const folder = releaseName(pkg.version, process.platform, process.arch);
  for (const [variable, actual] of [
    ["PRISM_TARGET_PLATFORM", process.platform],
    ["PRISM_TARGET_ARCH", process.arch],
  ]) {
    if (process.env[variable] && process.env[variable] !== actual)
      throw new Error(
        `${variable} does not match this packaging host (${actual})`,
      );
  }
  const output = path.join(root, "release", "distribution");
  const staging = path.join(
    output,
    pkg.version,
    `${process.platform}-${process.arch}`,
  );
  const contents = path.join(staging, folder);
  const archive = path.join(output, `${folder}.zip`);
  const runtime = path.join(root, "node_modules", "electron", "dist");
  await stat(path.join(root, "dist", "index.html"));
  await stat(runtime);
  await mkdir(output, { recursive: true });
  // This directory is dedicated to disposable distribution staging. Never use
  // the user's locally installed release/Prism Mapper-darwin-* application.
  await rm(staging, { recursive: true, force: true });
  await mkdir(contents, { recursive: true });
  const mac = process.platform === "darwin";
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
  }
  const resources = path.join(
    application,
    ...(mac ? ["Contents", "Resources"] : ["resources"]),
  );
  await rm(path.join(resources, "default_app.asar"), { force: true });
  const applicationRoot = path.join(resources, "app");
  await mkdir(path.join(applicationRoot, "dist"), { recursive: true });
  await copyBuild(path.join(root, "dist"), path.join(applicationRoot, "dist"));
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
    `Prism Mapper ${pkg.version}\n\n${
      mac
        ? "Move Prism Mapper.app to Applications, then open it. This community build is ad-hoc signed, not notarized by Apple. If macOS blocks it, review System Settings > Privacy & Security after the first launch attempt and use Open Anyway only if you trust this download."
        : "Extract the ENTIRE ZIP first. Open the Prism Mapper folder and launch Prism Mapper.exe. Keep all files in that folder together. This community build is not signed with a Windows publisher certificate; Windows may ask you to confirm the download's publisher."
    }\n\nUse an extended desktop for your projector, then select its display in Prism Mapper. Line tool lets you trace corners; click the first point to close the outline. Each layer can play its own animation. Press B for blackout. Example projects are included in the Example projects folder; open them with the app's Open button.\n\nAudio react starts only when you press Start listening and approve the requested access. Audio is analyzed locally.\n\nUpdates: download the newer ZIP from this project's GitHub Releases page, quit Prism Mapper, and replace the application. Save your project before updating. There is no automatic updater.\n`,
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
    execFileSync(
      "/usr/bin/codesign",
      ["--force", "--deep", "--sign", "-", application],
      { stdio: "inherit" },
    );
    execFileSync(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", application],
      { stdio: "inherit" },
    );
  }

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
    mac
      ? "Prism Mapper.app/Contents/MacOS/Electron"
      : "Prism Mapper/Prism Mapper.exe",
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
    powershell(
      "$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath $env:PRISM_PACKAGE_DIR -DestinationPath $env:PRISM_PACKAGE_ZIP -CompressionLevel Optimal",
      { PRISM_PACKAGE_DIR: contents, PRISM_PACKAGE_ZIP: archive },
    );
    const listing = powershell(
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead($env:PRISM_PACKAGE_ZIP); try { foreach ($entry in $zip.Entries) { $stream = $entry.Open(); try { $stream.CopyTo([System.IO.Stream]::Null) } finally { $stream.Dispose() }; $entry.FullName } } finally { $zip.Dispose() }",
      { PRISM_PACKAGE_ZIP: archive },
    );
    entries = listing.trim().split(/\r?\n/);
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
  return archive;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await packageRelease();
