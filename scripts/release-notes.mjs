// The "Downloads" section at the top of a GitHub release: which file to take,
// what to expect from apps that are not code-signed, and how to check a
// download. The release workflow puts the notes GitHub generates from the
// changes below it.
//
//   node scripts/release-notes.mjs <version> [downloads folder] [--no-web-app]
//
// With a folder, the phone and tablet rows appear only for files that are in
// it, so the notes never point at a download that does not exist. With
// --no-web-app the notes leave out the address of the installable web app, for
// a release made while that site is not online.
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseName, releasePrefix } from "./release-name.mjs";

// Where the installable web app is published. It is the way onto an iPhone or
// iPad without an Apple developer account.
export const WEB_APP_URL =
  "https://loneforgetechnologies.github.io/prism-mapper/";

export function releaseNotes(version, files = null, { webApp = true } = {}) {
  const windows = releaseName(version, "win32", "x64");
  const apple = releaseName(version, "darwin", "arm64");
  const intel = releaseName(version, "darwin", "x64");
  const android = `${releasePrefix(version)}-Android.apk`;
  const ios = `${releasePrefix(version)}-iOS-unsigned.ipa`;
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
    webApp
      ? has(ios)
        ? `The web app, or \`${ios}\` for sideloading`
        : "The web app"
      : has(ios)
        ? `\`${ios}\` for sideloading`
        : "Build it with Xcode on a Mac",
  ]);
  const table = rows
    .map(([device, file]) => `| ${device} | ${file} |`)
    .join("\n");

  const phones = [];
  if (has(android))
    phones.push(
      `**Android.** Download \`${android}\` on the phone and open it. Android asks you to allow installs from the app you opened it with (Chrome or Files). Allow that, go back and tap **Install**. Google Play Protect may say the app comes from an unknown developer, which is true: it is not on Google Play. This early build is signed with the standard Android debug key, so if a later version uses a private key you will have to uninstall this one first. The app has no internet permission, and it asks for the microphone only when you tap **Start listening**.`,
    );
  phones.push(
    [
      "**iPhone and iPad.** iOS only runs apps that are signed through an Apple developer account, and Prism Mapper is not in the App Store.",
      webApp &&
        `The easy way is the web app: open ${WEB_APP_URL} in Safari, tap **Share**, then **Add to Home Screen**. It works offline once it has loaded.`,
      has(ios) &&
        "The `.ipa` file is unsigned. It is for people who sideload with a tool such as AltStore or Sideloadly and their own Apple ID, or who sign it themselves.",
      "You can also build the app with Xcode on a Mac, see docs/building-mobile.md in the source.",
    ]
      .filter(Boolean)
      .join(" "),
  );

  return `## Downloads

| Your device | Download |
| --- | --- |
${table}

**Please read: this is a half vibe-coded, half-tested project.** Much of the code was written by directing AI coding assistants, and the testing is only partly done. Automated tests cover a lot of the editor, the renderer and the Windows installer. The Windows, Mac, Android, iPhone and iPad builds of this version were started by automation on cloud computers, emulators and simulators, not by a person on a real device, and none of them has been tested with a physical projector yet. The last check with a real projector was on a Mac with an earlier version, see VALIDATION.md in the source. Expect rough edges, and please report them on the GitHub Issues page.

These community builds are not code-signed, so Windows and macOS warn about them the first time you start them. The same steps are in the START HERE file inside each ZIP.

**Windows.** SmartScreen may show "Windows protected your PC". Select **More info**, then **Run anyway**, but only if you trust where you downloaded the file. To avoid the prompt for the ZIP, right-click the downloaded ZIP, choose Properties, tick **Unblock**, press OK and then extract it. By default the installer needs no administrator rights and installs for your user account (a dialog at the start offers all users instead). It adds a Start Menu entry and an uninstaller, and a newer Setup run over an installed copy updates it.

**Mac.** The app is ad-hoc signed, not notarized by Apple. Move Prism Mapper.app to Applications and open it. If macOS blocks it, open System Settings, then Privacy & Security, and use **Open Anyway** after the first launch attempt, but only if you trust the download.

${phones.join("\n\n")}

**Check a download.** Every file has a \`.sha256\` file, and \`SHA256SUMS.txt\` lists them all. On Windows run \`Get-FileHash <file>\` in PowerShell, on a Mac run \`shasum -a 256 <file>\` in Terminal. The result must equal the number in the \`.sha256\` file.
`;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const webApp = !args.includes("--no-web-app");
  const [version, folder] = args.filter((arg) => !arg.startsWith("--"));
  if (!version)
    throw new Error(
      "Usage: node scripts/release-notes.mjs <version> [downloads folder] [--no-web-app]",
    );
  process.stdout.write(
    releaseNotes(version, folder ? readdirSync(folder) : null, { webApp }),
  );
}
