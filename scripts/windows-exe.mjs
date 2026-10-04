// Gives the packaged Windows executable its own icon and version resources.
//
// Electron's runtime ships as electron.exe with Electron's icon and a version
// block that says "Electron". Explorer, Task Manager, SmartScreen and the
// taskbar all read those resources, so they are rewritten here. This uses
// resedit, a maintained pure-JavaScript editor, so it runs on every OS and can
// be unit tested anywhere (the rcedit package this replaces is deprecated on
// npm and its repository is archived).
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import * as ResEdit from "resedit";

const { NtExecutable, NtExecutableResource } = ResEdit;

// English (United States) and the Unicode code page, which is what Electron
// itself uses for its version block.
const LANGUAGE = { lang: 1033, codepage: 1200 };

// "0.5.0-beta.1" becomes "0.5.0.0": Windows wants four numeric fields. The
// text form of ProductVersion keeps the full version, suffix included.
export function numericVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match || match.slice(1).some((part) => Number(part) > 65535))
    throw new Error(`Cannot build a Windows file version from ${version}`);
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

export function copyrightLine(licenseText) {
  const line = licenseText
    .split(/\r?\n/)
    .find((candidate) => /^Copyright \(c\)/i.test(candidate));
  if (!line) throw new Error("LICENSE has no copyright line");
  return line.trim();
}

// The exact strings Windows shows for the executable.
export function executableMetadata({ version, license, fileName }) {
  return {
    fileVersion: numericVersion(version),
    productVersion: numericVersion(version),
    strings: {
      CompanyName: "Prism Mapper contributors",
      FileDescription: "Prism Mapper",
      FileVersion: numericVersion(version),
      InternalName: "Prism Mapper",
      LegalCopyright: copyrightLine(license),
      OriginalFilename: fileName,
      ProductName: "Prism Mapper",
      ProductVersion: version,
    },
  };
}

// Returns a new executable image; the input is not modified. A signed input is
// accepted (its signature is dropped, since it could no longer be valid).
export function stampExecutable(image, { icon, metadata }) {
  const executable = NtExecutable.from(image, { ignoreCert: true });
  const resources = NtExecutableResource.from(executable);
  const frames = ResEdit.Data.IconFile.from(icon).icons.map(
    (frame) => frame.data,
  );
  if (frames.length === 0) throw new Error("The icon file holds no images");
  // Replace every existing icon group so whichever one the shell picks is ours.
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const targets = groups.length
    ? groups.map((group) => ({ id: group.id, lang: group.lang }))
    : [{ id: 1, lang: LANGUAGE.lang }];
  for (const target of targets)
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      target.id,
      target.lang,
      frames,
    );
  const [existing] = ResEdit.Resource.VersionInfo.fromEntries(
    resources.entries,
  );
  const info = existing ?? ResEdit.Resource.VersionInfo.createEmpty();
  if (!existing) info.lang = LANGUAGE.lang;
  // Keep the language block the runtime already uses, so there is one table.
  const language = info.getAllLanguagesForStringValues()[0] ?? LANGUAGE;
  info.setFileVersion(metadata.fileVersion, language.lang);
  info.setProductVersion(metadata.productVersion, language.lang);
  info.setStringValues(language, metadata.strings);
  info.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);
  return Buffer.from(executable.generate());
}

// Read back what Windows will see. Used to prove a stamp took effect.
export function inspectExecutable(image) {
  const executable = NtExecutable.from(image, { ignoreCert: true });
  const resources = NtExecutableResource.from(executable);
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const language = info?.getAllLanguagesForStringValues()[0];
  const fixed = info?.fixedInfo;
  const dotted = (high, low) =>
    [high >>> 16, high & 0xffff, low >>> 16, low & 0xffff].join(".");
  return {
    strings: info && language ? info.getStringValues(language) : {},
    fileVersion: fixed
      ? dotted(fixed.fileVersionMS, fixed.fileVersionLS)
      : undefined,
    productVersion: fixed
      ? dotted(fixed.productVersionMS, fixed.productVersionLS)
      : undefined,
    iconGroups: groups.map((group) => ({
      id: group.id,
      sizes: group.icons.map((item) => item.width || 256),
    })),
  };
}

// The sizes (in pixels) of the images inside an .ico file.
export function iconSizes(icon) {
  return ResEdit.Data.IconFile.from(icon).icons.map(
    (frame) => frame.width || frame.data.width || 256,
  );
}

// Fail the build when a stamp did not take effect, instead of shipping a
// "Prism Mapper.exe" that still says Electron.
export function assertStamped(info, metadata, expectedSizes) {
  for (const [key, expected] of Object.entries(metadata.strings))
    if (info.strings[key] !== expected)
      throw new Error(
        `Windows executable ${key} is "${info.strings[key]}" instead of "${expected}"`,
      );
  if (
    info.fileVersion !== metadata.fileVersion ||
    info.productVersion !== metadata.productVersion
  )
    throw new Error(
      `Windows executable versions are ${info.fileVersion} and ${info.productVersion}`,
    );
  if (info.iconGroups.length === 0)
    throw new Error("Windows executable has no icon");
  for (const group of info.iconGroups) {
    const sizes = [...group.sizes].sort((a, b) => a - b);
    if (
      expectedSizes &&
      JSON.stringify(sizes) !==
        JSON.stringify([...expectedSizes].sort((a, b) => a - b))
    )
      throw new Error(
        `Icon group ${group.id} holds ${sizes.join("/")} instead of ${expectedSizes.join("/")}`,
      );
  }
}

// Rewrite an executable on disk. The result is written beside the original
// first and moved into place, so an interrupted run never leaves a half file.
export async function stampExecutableFile(file, { iconFile, metadata }) {
  const stamped = stampExecutable(await readFile(file), {
    icon: await readFile(iconFile),
    metadata,
  });
  const temporary = `${file}.stamped`;
  try {
    await writeFile(temporary, stamped);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return inspectExecutable(stamped);
}
