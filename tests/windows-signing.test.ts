import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  installerSigningCommand,
  requireSignedRelease,
  verifyWindowsApplication,
  verifyWindowsFile,
  windowsSigningEnabled,
  // @ts-expect-error Plain Node ESM helper.
} from "../scripts/sign-windows.mjs";

test("Windows verification passes file paths as arguments, and signing must be explicitly enabled", () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run = (file: string, args: string[]) => calls.push({ file, args });
  const result = verifyWindowsApplication(path.resolve("app with spaces"), {
    run,
  });
  verifyWindowsFile(path.resolve("setup with spaces.exe"), { run });
  assert.deepEqual(result, { signed: true, notarized: false });
  assert.equal(calls[0].file, "pwsh.exe");
  assert.deepEqual(calls[0].args.slice(-3), [
    "-Folder",
    path.resolve("app with spaces"),
    "-VerifyOnly",
  ]);
  assert.deepEqual(calls[1].args.slice(-3), [
    "-FilePath",
    path.resolve("setup with spaces.exe"),
    "-VerifyOnly",
  ]);
  assert.throws(
    () =>
      verifyWindowsApplication("application", {
        run: () => {
          throw new Error("invalid signature");
        },
      }),
    /invalid signature/,
  );
  assert.equal(windowsSigningEnabled({}), false);
  assert.equal(
    windowsSigningEnabled({ PRISM_WINDOWS_SIGNING_ENABLED: "true" }),
    true,
  );
  assert.equal(
    windowsSigningEnabled({ PRISM_WINDOWS_SIGNING_ENABLED: "1" }),
    false,
  );
  assert.equal(
    requireSignedRelease({ PRISM_REQUIRE_SIGNED_RELEASE: "true" }),
    true,
  );
  assert.equal(requireSignedRelease({}), false);
  assert.equal(
    installerSigningCommand("C:\\Build folder\\sign-windows.ps1"),
    "pwsh.exe -NoProfile -NonInteractive -File $qC:\\Build folder\\sign-windows.ps1$q -FilePath $f",
  );
  for (const unsafe of [
    'C:\\bad"path.ps1',
    "C:\\bad\npath.ps1",
    "C:\\bad$f.ps1",
  ])
    assert.throws(
      () => installerSigningCommand(unsafe),
      /unsupported command characters/,
    );
});

test("Windows trust verification and publication gates are present in the executable signing path", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const helper = fs.readFileSync(
    path.join(root, "scripts/sign-windows.ps1"),
    "utf8",
  );
  assert.match(helper, /Get-AuthenticodeSignature -LiteralPath/);
  assert.match(helper, /Status -ne 'Valid'/);
  assert.match(helper, /TimeStamperCertificate/);
  assert.match(
    helper,
    /SignerCertificate\.Subject -ne \$env:PRISM_WINDOWS_EXPECTED_PUBLISHER/,
  );
  assert.match(helper, /Invoke-ArtifactSigning/);
  assert.match(
    helper,
    /-CodeSigningAccountName \$env:PRISM_WINDOWS_SIGNING_ACCOUNT/,
  );
  assert.match(helper, /-TimestampDigest SHA256/);
  const release = fs.readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  );
  const positions = [
    "--stage-only",
    "uses: azure/artifact-signing-action@v2",
    "--finalize",
  ].map((text) => release.indexOf(text));
  assert.ok(positions.every((position) => position >= 0));
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
  assert.match(release, /id-token: write/);
  assert.match(release, /environment: release-signing/);
  assert.match(
    release,
    /Remove temporary Mac signing credentials\s+if: \$\{\{ always\(\)/,
  );
  assert.match(release, /require_android_signing:/);
  const mobile = fs.readFileSync(
    path.join(root, ".github/workflows/mobile.yml"),
    "utf8",
  );
  assert.match(
    mobile,
    /if \[ "\$REQUIRE_SIGNING" = true \]; then[\s\S]*?exit 1/,
  );
});
