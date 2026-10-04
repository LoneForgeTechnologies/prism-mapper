import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sign as signElectronApp } from "@electron/osx-sign";
import { notarize } from "@electron/notarize";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A partial setup is an error, never an invitation to publish unsigned code.
export function macSigningConfig(env = process.env) {
  const identity = env.PRISM_MAC_SIGNING_IDENTITY;
  const profile = env.PRISM_MAC_NOTARY_PROFILE;
  const api = [
    env.PRISM_MAC_NOTARY_KEY_ID,
    env.PRISM_MAC_NOTARY_ISSUER_ID,
    env.PRISM_MAC_NOTARY_KEY_PATH,
  ];
  const configured =
    identity ||
    profile ||
    api.some(Boolean) ||
    env.PRISM_MAC_SIGNING_KEYCHAIN ||
    env.PRISM_MAC_TEAM_ID;
  if (!configured) {
    if (env.PRISM_REQUIRE_SIGNED_RELEASE === "true")
      throw new Error(
        "A signed Mac release requires a Developer ID Application identity and notarization credentials. See docs/signing.md.",
      );
    return null;
  }
  const team = identity?.match(
    /^Developer ID Application: .+ \(([A-Z0-9]{10})\)$/,
  )?.[1];
  if (!team)
    throw new Error(
      "PRISM_MAC_SIGNING_IDENTITY must be the full Developer ID Application certificate name, including its team ID.",
    );
  if (env.PRISM_MAC_TEAM_ID && env.PRISM_MAC_TEAM_ID !== team)
    throw new Error(
      "The Mac signing identity does not match PRISM_MAC_TEAM_ID.",
    );
  if (profile && api.some(Boolean))
    throw new Error(
      "Choose a notary Keychain profile or an API key, not both.",
    );
  if (!profile && !api.every(Boolean))
    throw new Error(
      "Mac notarization requires PRISM_MAC_NOTARY_PROFILE or all three PRISM_MAC_NOTARY_KEY_ID/ISSUER_ID/KEY_PATH settings.",
    );
  return {
    identity,
    team,
    keychain: env.PRISM_MAC_SIGNING_KEYCHAIN,
    credentials: profile
      ? { keychainProfile: profile }
      : {
          appleApiKeyId: api[0],
          appleApiIssuer: api[1],
          appleApiKey: path.resolve(api[2]),
        },
  };
}

function command(file, args) {
  const result = spawnSync(file, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0)
    throw new Error(
      `${path.basename(file)} failed (${result.status}): ${output}`,
    );
  return output;
}

export function verifyMacApplication(
  appPath,
  { signed = false, notarized = false, team, run = command } = {},
) {
  run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ]);
  if (signed) {
    const details = run("/usr/bin/codesign", [
      "--display",
      "--verbose=4",
      appPath,
    ]);
    if (
      !/^Authority=Developer ID Application:.+$/m.test(details) ||
      !/^CodeDirectory[^\n]*\bflags=0x[0-9a-f]+\([^)]*\bruntime\b/m.test(
        details,
      ) ||
      !/^Timestamp=.+$/m.test(details) ||
      (team && !details.split("\n").includes(`TeamIdentifier=${team}`))
    )
      throw new Error(
        "Mac application is missing its expected Developer ID signature, hardened runtime, team or secure timestamp.",
      );
  }
  if (notarized) {
    run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
    run("/usr/sbin/spctl", [
      "--assess",
      "--type",
      "execute",
      "--verbose=4",
      appPath,
    ]);
  }
}

export async function signMacApplication(
  appPath,
  {
    env = process.env,
    platform = process.platform,
    run = command,
    sign = signElectronApp,
    submit = notarize,
  } = {},
) {
  if (platform !== "darwin") throw new Error("Mac signing must run on macOS.");
  const config = macSigningConfig(env);
  if (!config) {
    run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);
    verifyMacApplication(appPath, { run });
    return { signed: false, notarized: false };
  }
  // osx-sign signs nested Electron code inside out. --deep is for verification,
  // not Developer ID signing. Entitlements cover JIT and local audio input only.
  await sign({
    app: appPath,
    identity: config.identity,
    keychain: config.keychain,
    type: "distribution",
    platform: "darwin",
    identityValidation: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: () => ({
      hardenedRuntime: true,
      entitlements: path.join(root, "build/entitlements.mac.plist"),
    }),
  });
  verifyMacApplication(appPath, { signed: true, team: config.team, run });
  // notarize waits for Apple's acceptance and staples the ticket to the app,
  // allowing the finished download to be assessed on an offline computer.
  await submit({ appPath, ...config.credentials });
  verifyMacApplication(appPath, {
    signed: true,
    notarized: true,
    team: config.team,
    run,
  });
  return { signed: true, notarized: true, team: config.team };
}
