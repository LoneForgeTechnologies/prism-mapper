/**
 * Stand-ins for browser features that older web views lack. The Android 11
 * web view can be as old as Chrome 83, and Safari 14 is still in use, but
 * crypto.randomUUID and Array.prototype.at arrived in Chrome 92 and Safari
 * 15.4. Calling either on an older engine is a TypeError, and in start-up code
 * that is a blank page. The rest of the app uses these helpers and never the
 * newer calls; tests/compat.test.ts reads every source file to make sure.
 */

/** The last item of a list, or undefined when it is empty. Array.prototype.at(-1) needs Chrome 92. */
export function lastOf<T>(items: ArrayLike<T>): T | undefined {
  return items[items.length - 1];
}

/** The part of the Web Crypto object that newId uses. */
export interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

function currentCrypto(): RandomSource | undefined {
  try {
    return globalThis.crypto;
  } catch {
    return undefined;
  }
}

const HEX = "0123456789abcdef";

/**
 * A random version 4 UUID, for ids of layers and media. crypto.randomUUID is
 * used when there is one. Older web views, and pages served over plain http,
 * do not have it, so the same id is built from crypto.getRandomValues, and as
 * a last resort from Math.random: an id only has to differ from the others in
 * the same project.
 */
export function newId(source: RandomSource | undefined = currentCrypto()) {
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === "function")
    source.getRandomValues(bytes);
  else
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  let id = "";
  for (let i = 0; i < bytes.length; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) id += "-";
    id += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  }
  return id;
}
