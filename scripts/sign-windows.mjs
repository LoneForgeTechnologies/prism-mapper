import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./sign-windows.ps1", import.meta.url));

export function windowsSigningEnabled(env = process.env) {
  return env.PRISM_WINDOWS_SIGNING_ENABLED === "true";
}

export function requireSignedRelease(env = process.env) {
  return env.PRISM_REQUIRE_SIGNED_RELEASE === "true";
}

export function verifyWindowsApplication(
  application,
  { run = execFileSync } = {},
) {
  run(
    "pwsh.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      script,
      "-Folder",
      path.resolve(application),
      "-VerifyOnly",
    ],
    { stdio: "inherit" },
  );
  return { signed: true, notarized: false };
}

export function verifyWindowsFile(filename, { run = execFileSync } = {}) {
  run(
    "pwsh.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      script,
      "-FilePath",
      path.resolve(filename),
      "-VerifyOnly",
    ],
    { stdio: "inherit" },
  );
}

// Inno's $q/$f expansion quotes both paths. The callback is a fixed script,
// not a shell command supplied through an environment variable.
export function installerSigningCommand(scriptPath = script) {
  if (/["\r\n$]/.test(scriptPath))
    throw new Error(
      "The signing-script path contains unsupported command characters",
    );
  return `pwsh.exe -NoProfile -NonInteractive -File $q${scriptPath}$q -FilePath $f`;
}
