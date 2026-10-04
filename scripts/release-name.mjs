// The name every release file of a version starts with. No dependencies, so the
// release job can use it without installing the packages.
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
