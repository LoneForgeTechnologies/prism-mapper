// Read-only readiness report. Prints setting names and status, never secrets.
import { spawnSync } from "node:child_process";
import { macSigningConfig } from "./sign-mac.mjs";

const env = process.env;
let ready = true;
console.log("Prism Mapper signing readiness (no credentials changed)");
try {
  const mac = macSigningConfig(env);
  console.log(
    `Mac package settings: ${mac ? "configured" : "missing Developer ID and notarization settings"}`,
  );
  if (!mac) ready = false;
} catch (error) {
  console.log(`Mac package settings: ${error.message}`);
  ready = false;
}
if (process.platform === "darwin") {
  const result = spawnSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8" },
  );
  const count = (result.stdout?.match(/"Developer ID Application:/g) ?? [])
    .length;
  console.log(
    `Valid Developer ID Application identities in the local Keychain: ${count}`,
  );
  if (!count || result.status !== 0) ready = false;
}
for (const name of [
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_SUBSCRIPTION_ID",
  "PRISM_WINDOWS_SIGNING_ENDPOINT",
  "PRISM_WINDOWS_SIGNING_ACCOUNT",
  "PRISM_WINDOWS_CERTIFICATE_PROFILE",
  "PRISM_WINDOWS_EXPECTED_PUBLISHER",
]) {
  const present = Boolean(env[name]);
  console.log(`${name}: ${present ? "set" : "missing"}`);
  if (!present) ready = false;
}
console.log(
  "GitHub may store these separately in its release-signing environment; this report checks only the current terminal.",
);
console.log(
  "Setup: docs/signing.md. Account enrollment and identity verification must be completed by the owner.",
);
process.exitCode = ready ? 0 : 1;
