// The name every release file of a version starts with. No dependencies, so the
// release job can use it without installing the packages.

// "Prism-Mapper-v0.5.0": the start of the name of every file of a release.
export function releasePrefix(version) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw new Error("Invalid release version");
  return `Prism-Mapper-v${version}`;
}

// The optional phone downloads. A release carries them when the mobile builds
// were made.
export function androidName(version) {
  return `${releasePrefix(version)}-Android.apk`;
}

export function iosName(version) {
  return `${releasePrefix(version)}-iOS-unsigned.ipa`;
}

export function releaseName(version, platform, arch) {
  const prefix = releasePrefix(version);
  if (!(
    (platform === "darwin" && ["arm64", "x64"].includes(arch)) ||
    (platform === "win32" && arch === "x64")
  ))
    throw new Error(
      "Release packaging supports macOS arm64/x64 and Windows x64",
    );
  return `${prefix}-${platform === "darwin" ? "macOS" : "Windows"}-${arch}`;
}
