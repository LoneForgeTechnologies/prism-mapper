import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const normalized = (value) => value.replace(/[\s:]/g, "").toUpperCase();

export function verifyApkSigner(output, expected) {
  const fingerprint = normalized(expected);
  if (!/^[A-F0-9]{64}$/.test(fingerprint))
    throw new Error(
      "The expected Android signing fingerprint must be a SHA256 certificate digest",
    );
  const signers = [
    ...output.matchAll(
      /^Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9: ]+)$/gim,
    ),
  ].map((match) => normalized(match[1]));
  if (signers.length !== 1 || signers[0] !== fingerprint)
    throw new Error(
      "The APK signing certificate does not match the permanent release key",
    );
  return fingerprint;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const expected = process.argv[2];
  if (!expected || process.argv.length !== 3)
    throw new Error(
      "Usage: apksigner verify --print-certs app.apk | node scripts/verify-apk-signer.mjs <expected SHA256>",
    );
  verifyApkSigner(readFileSync(0, "utf8"), expected);
  console.log("Verified permanent Android release signing certificate");
}
