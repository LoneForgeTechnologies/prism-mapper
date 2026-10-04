// The "Desktop downloads" section at the top of a GitHub release: which file to
// take, what to expect from an app that is not code-signed, and how to check a
// download. The release workflow puts the notes GitHub generates from the
// changes below it.
//
//   node scripts/release-notes.mjs <version>
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseName } from "./release-name.mjs";

export function releaseNotes(version) {
  const windows = releaseName(version, "win32", "x64");
  const apple = releaseName(version, "darwin", "arm64");
  const intel = releaseName(version, "darwin", "x64");
  return `## Desktop downloads

| Your computer | Download |
| --- | --- |
| Windows 10 or 11, 64-bit, with an installer | \`${windows}-Setup.exe\` |
| Windows 10 or 11, 64-bit, without installing (extract the ZIP) | \`${windows}.zip\` |
| Mac with Apple silicon | \`${apple}.zip\` |
| Mac with an Intel processor | \`${intel}.zip\` |

These community builds are not code-signed, so Windows and macOS warn about them the first time you start them. The same steps are in the START HERE file inside each ZIP.

**Windows.** SmartScreen may show "Windows protected your PC". Select **More info**, then **Run anyway**, but only if you trust where you downloaded the file. To avoid the prompt for the ZIP, right-click the downloaded ZIP, choose Properties, tick **Unblock**, press OK and then extract it. By default the installer needs no administrator rights and installs for your user account (a dialog at the start offers all users instead). It adds a Start Menu entry and an uninstaller, and a newer Setup run over an installed copy updates it.

**Mac.** The app is ad-hoc signed, not notarized by Apple. Move Prism Mapper.app to Applications and open it. If macOS blocks it, open System Settings, then Privacy & Security, and use **Open Anyway** after the first launch attempt, but only if you trust the download.

**Check a download.** Every file has a \`.sha256\` file, and \`SHA256SUMS.txt\` lists them all. On Windows run \`Get-FileHash <file>\` in PowerShell, on a Mac run \`shasum -a 256 <file>\` in Terminal. The result must equal the number in the \`.sha256\` file.

The Windows and Mac builds were started and checked automatically on computers without a projector. They have not yet been tested with a physical projector. Please report problems on the GitHub Issues page.
`;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const version = process.argv[2];
  if (!version)
    throw new Error("Usage: node scripts/release-notes.mjs <version>");
  process.stdout.write(releaseNotes(version));
}
