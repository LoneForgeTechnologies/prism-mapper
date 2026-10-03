// Tells a real screenshot from a blank one, without any npm dependency.
//
//   node mobile/png-stats.mjs screenshot.png
//
// Prints a few numbers about the picture and exits with 1 when it looks like
// the app never drew anything: one colour covers nearly the whole screen, or
// there are hardly any different colours. A loading screen, a white WebView or
// a black screen all fail this check; the real interface passes it.

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Decodes an 8 or 16 bit, non-interlaced PNG into RGB values.
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE))
    throw new Error("Not a PNG file");
  let offset = 8;
  let header = null;
  let palette = null;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === "PLTE") palette = body;
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
  }
  if (!header) throw new Error("PNG has no header");
  const { width, height, depth, colorType, interlace } = header;
  if (interlace !== 0)
    throw new Error("Interlaced PNG files are not supported");
  if (depth !== 8 && depth !== 16)
    throw new Error(`PNG bit depth ${depth} is not supported`);
  const channels = CHANNELS[colorType];
  if (!channels)
    throw new Error(`PNG colour type ${colorType} is not supported`);
  if (colorType === 3 && (!palette || depth !== 8))
    throw new Error("Unsupported palette PNG");

  const bytesPerPixel = (channels * depth) / 8;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length < (stride + 1) * height)
    throw new Error("PNG data is truncated");

  // Undo the per-row filters.
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? pixels[row + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[row - stride + x] : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[row - stride + x - bytesPerPixel]
          : 0;
      let value = raw[source + x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const distanceLeft = Math.abs(estimate - left);
        const distanceUp = Math.abs(estimate - up);
        const distanceUpLeft = Math.abs(estimate - upLeft);
        value +=
          distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
            ? left
            : distanceUp <= distanceUpLeft
              ? up
              : upLeft;
      } else if (filter !== 0) throw new Error(`Unknown PNG filter ${filter}`);
      pixels[row + x] = value & 0xff;
    }
  }

  // Reduce everything to 8 bit RGB.
  const sample = depth / 8;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const at = i * bytesPerPixel;
    let r;
    let g;
    let b;
    if (colorType === 3) {
      const index = pixels[at] * 3;
      [r, g, b] = [palette[index], palette[index + 1], palette[index + 2]];
    } else if (channels <= 2) {
      r = g = b = pixels[at];
    } else {
      r = pixels[at];
      g = pixels[at + sample];
      b = pixels[at + 2 * sample];
    }
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return { width, height, rgb };
}

export function pictureStats({ width, height, rgb }) {
  const counts = new Map();
  const coarse = new Set();
  let lit = 0;
  let luma = 0;
  const count = width * height;
  for (let i = 0; i < count; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    coarse.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    if (Math.max(r, g, b) > 40) lit++;
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  let dominantKey = 0;
  let dominantCount = 0;
  for (const [key, value] of counts) {
    if (value > dominantCount) {
      dominantKey = key;
      dominantCount = value;
    }
  }
  return {
    width,
    height,
    exactColors: counts.size,
    coarseColors: coarse.size,
    dominantColor: `#${dominantKey.toString(16).padStart(6, "0")}`,
    dominantFraction: dominantCount / count,
    litFraction: lit / count,
    meanLuma: luma / count,
  };
}

// A picture is blank when one colour covers almost all of it or when almost
// no different colours exist. Returns the list of reasons (empty when fine).
export function blankReasons(
  stats,
  { maxDominant = 0.97, minColors = 24 } = {},
) {
  const reasons = [];
  if (stats.dominantFraction > maxDominant) {
    reasons.push(
      `${(stats.dominantFraction * 100).toFixed(1)}% of the picture is the single colour ${stats.dominantColor}`,
    );
  }
  if (stats.coarseColors < minColors) {
    reasons.push(
      `only ${stats.coarseColors} distinct colour${stats.coarseColors === 1 ? "" : "s"}`,
    );
  }
  return reasons;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node mobile/png-stats.mjs screenshot.png");
    process.exit(2);
  }
  try {
    const stats = pictureStats(decodePng(readFileSync(file)));
    console.log(JSON.stringify(stats));
    const reasons = blankReasons(stats);
    if (reasons.length) {
      console.error(`${file} looks blank: ${reasons.join("; ")}.`);
      process.exit(1);
    }
    console.log(
      `${file} has content: ${stats.coarseColors} colours, most common ${stats.dominantColor} at ${(stats.dominantFraction * 100).toFixed(1)}%.`,
    );
  } catch (error) {
    console.error(`Could not read ${file}: ${error.message}`);
    process.exit(2);
  }
}
