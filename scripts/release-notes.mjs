// The "Downloads" section at the top of a GitHub release: which file to take,
// what to expect from apps that are not code-signed, and how to check a
// download. The release workflow puts the notes GitHub generates from the
// changes below it.
//
//   node scripts/release-notes.mjs <version> [downloads folder]
//
// With a folder, the phone and tablet rows appear only for files that are in
// it, so the notes never point at a download that does not exist. Every app
// runs locally after installation; generating the notes needs no network.
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { androidName, iosName, releaseName } from "./release-name.mjs";

export function releaseNotes(version, files = null, { signed = false } = {}) {
  const windows = releaseName(version, "win32", "x64");
  const apple = releaseName(version, "darwin", "arm64");
  const intel = releaseName(version, "darwin", "x64");
  const android = androidName(version);
  const ios = iosName(version);
  const has = (name) => files === null || files.includes(name);

  const rows = [
    ["Windows 10 or 11, 64-bit, with an installer", `\`${windows}-Setup.exe\``],
    [
      "Windows 10 or 11, 64-bit, without installing (extract the ZIP)",
      `\`${windows}.zip\``,
    ],
    ["Mac with Apple silicon", `\`${apple}.zip\``],
    ["Mac with an Intel processor", `\`${intel}.zip\``],
  ];
  if (has(android)) rows.push(["Android phone or tablet", `\`${android}\``]);
  rows.push([
    "iPhone or iPad",
    has(ios) ? `\`${ios}\` for sideloading` : "Build it with Xcode on a Mac",
  ]);
  const table = rows
    .map(([device, file]) => `| ${device} | ${file} |`)
    .join("\n");

  const phones = [];
  if (has(android))
    phones.push(
      `**Android.** Download \`${android}\` on the phone and open it. Android asks you to allow installs from the app you opened it with (Chrome or Files). Allow that, go back and tap **Install**. Google Play Protect may still warn about an app distributed outside Google Play. ${signed ? "This APK is signed with the permanent release key, so later releases using that key can update it. Earlier development APKs used a different key and may need to be uninstalled first." : "Android installs a newer version over an older one only when both were signed with the same key, and development builds do not promise that."} If an update will not install, uninstall Prism Mapper first, but save your projects as files before that, because uninstalling deletes the app's data. The app has no internet permission, and it asks for the microphone only when you tap **Start listening**.`,
    );
  phones.push(
    [
      "**iPhone and iPad.** iOS only runs apps that are signed through an Apple developer account, and Prism Mapper is not in the App Store.",
      has(ios) &&
        "The `.ipa` file is unsigned. This is a development sideload artifact, including in releases whose desktop and Android apps are signed. It is for people who sideload with a tool such as AltStore or Sideloadly and their own Apple ID, or who sign it themselves. A free Apple ID installation needs refreshing every 7 days, so plan for that expiry before relying on it for an extended offline project. Normal public iPhone and iPad installation requires App Store distribution.",
      `${has(ios) ? "You can also build" : "Build"} the app with Xcode on a Mac, see docs/building-mobile.md in the source. Once installed, the app runs locally without an internet connection.`,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return `## Downloads

Download an app from the GitHub release assets below, install or extract it, and use it locally. The apps include everything needed to run Prism Mapper offline. No internet connection is required after installation. To build from source, download or clone the GitHub project and follow README.md and docs/building-mobile.md in the source; acquiring build tools and dependencies requires internet access before going offline.

| Your device | Download |
| --- | --- |
${table}

**Please read: this is a half vibe-coded, half-tested project.** Much of the code was written by directing AI coding assistants, and the testing is only partly done. Automated tests cover a lot of the editor, the renderer and the Windows installer. The Windows, Mac, Android, iPhone and iPad builds of this version were started by automation on cloud computers, emulators and simulators, not by a person on a real device, and none of them has been tested with a physical projector yet. The last check with a real projector was on a Mac with an earlier version, see VALIDATION.md in the source. Expect rough edges, and please report them on the GitHub Issues page.

${signed ? "The Windows app, installer and uninstaller have verified publisher signatures and timestamps. The Mac apps are signed with Developer ID, notarized by Apple and include stapled notarization tickets. Windows SmartScreen can still warn about a new signed download while reputation builds. The unsigned iOS development artifact is described separately below." : "These development desktop builds are not code-signed with verified publisher identities, so Windows and macOS may warn about them the first time you start them."} The same installation guidance is in the START HERE file inside each ZIP.

**Windows.** ${signed ? "Check the verified publisher when opening the download. A new signed release can still show a SmartScreen warning; signing alone does not guarantee an immediate warning-free launch." : 'SmartScreen may show "Windows protected your PC". Select **More info**, then **Run anyway**, but only if you trust where you downloaded the file. To avoid the prompt for the ZIP, right-click the downloaded ZIP, choose Properties, tick **Unblock**, press OK and then extract it.'} By default the installer needs no administrator rights and installs for your user account (a dialog at the start offers all users instead). It adds a Start Menu entry and an uninstaller, and a newer Setup run over an installed copy updates it.

**Mac.** ${signed ? "The app is signed with Developer ID and notarized by Apple. Move Prism Mapper.app to Applications and open it. macOS may ask you to confirm the first launch of a downloaded app." : "The app is ad-hoc signed, not notarized by Apple. Move Prism Mapper.app to Applications and open it. If macOS blocks it, open System Settings, then Privacy & Security, and use **Open Anyway** after the first launch attempt, but only if you trust the download."}

${phones.join("\n\n")}

**Check a download.** Every file has a \`.sha256\` file, and \`SHA256SUMS.txt\` lists them all. On Windows run \`Get-FileHash <file>\` in PowerShell, on a Mac run \`shasum -a 256 <file>\` in Terminal. The result must equal the number in the \`.sha256\` file.
`;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const [version, folder] = args;
  if (!version || args.length > 2 || args.some((arg) => arg.startsWith("--")))
    throw new Error(
      "Usage: node scripts/release-notes.mjs <version> [downloads folder]",
    );
  process.stdout.write(
    releaseNotes(version, folder ? readdirSync(folder) : null, {
      signed: process.env.PRISM_REQUIRE_SIGNED_RELEASE === "true",
    }),
  );
}
