import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
// @ts-expect-error Plain Node ESM helper.
import { verifyApkSigner } from "../scripts/verify-apk-signer.mjs";

const fingerprint = "0123456789ABCDEF".repeat(4);
const output = (digest: string) =>
  `Verifies\nSigner #1 certificate DN: CN=Example\nSigner #1 certificate SHA-256 digest: ${digest}\n`;

test("Android signer verification accepts only the configured public certificate", () => {
  assert.equal(
    verifyApkSigner(output(fingerprint.toLowerCase()), fingerprint),
    fingerprint,
  );
  assert.equal(
    verifyApkSigner(output(fingerprint), fingerprint.match(/../g)!.join(":")),
    fingerprint,
  );
  assert.throws(
    () => verifyApkSigner(output("F".repeat(64)), fingerprint),
    /does not match the permanent release key/,
  );
  assert.throws(
    () => verifyApkSigner("Verifies\n", fingerprint),
    /does not match/,
  );
  assert.throws(
    () =>
      verifyApkSigner(output(fingerprint) + output(fingerprint), fingerprint),
    /does not match/,
  );
  assert.throws(
    () => verifyApkSigner(output(fingerprint), "not-a-sha256"),
    /must be a SHA256/,
  );
});

test("the Android signer CLI fails closed on a mismatched APK signer", () => {
  const script = path.resolve(
    import.meta.dirname,
    "../scripts/verify-apk-signer.mjs",
  );
  const good = spawnSync(process.execPath, [script, fingerprint], {
    encoding: "utf8",
    input: output(fingerprint),
  });
  assert.equal(good.status, 0, good.stderr);
  assert.match(
    good.stdout,
    /Verified permanent Android release signing certificate/,
  );
  const bad = spawnSync(process.execPath, [script, fingerprint], {
    encoding: "utf8",
    input: output("F".repeat(64)),
  });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /does not match the permanent release key/);
});
