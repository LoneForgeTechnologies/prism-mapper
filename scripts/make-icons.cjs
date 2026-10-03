// Regenerates every raster icon from assets/icon.svg. Output is committed, so
// this only needs to run when the artwork changes:  node scripts/make-icons.cjs
//
// Produces: build/icon.png, icon.ico and icon.icns (desktop), the Android
// adaptive-icon layers in assets/, and the web-app icons in public/.
const fs = require("node:fs");
const path = require("node:path");
const { launchBrowser } = require("../tests/browser.cjs");

const root = path.resolve(__dirname, "..");
const master = fs.readFileSync(path.join(root, "assets/icon.svg"), "utf8");
const open = master.match(/<svg[^>]*>/)[0];
const defs = master.match(/<defs>[\s\S]*?<\/defs>/)[0];
const backdrop = master.match(/<rect id="backdrop"[^>]*\/>/)[0];
const mark = master.match(/<g id="mark">[\s\S]*<\/g>(?=\s*<\/svg>)/)[0];

const compose = (body, extraDefs = "") =>
  `${open}${defs.replace("</defs>", `${extraDefs}</defs>`)}${body}</svg>`;

const variants = {
  // Square art with no transparency: iOS, Android and maskable web icons.
  fullbleed: compose(`${backdrop}${mark}`),
  // Rounded corners on a transparent canvas: Windows, favicon, web "any" icons.
  rounded: compose(
    `<g clip-path="url(#round)">${backdrop}${mark}</g>`,
    `<clipPath id="round"><rect width="1024" height="1024" rx="224"/></clipPath>`,
  ),
  // macOS tile: 824px body with the standard margin and a soft shadow.
  mac: compose(
    `<rect x="100" y="112" width="824" height="824" rx="185" fill="#000" opacity="0.5" filter="url(#shadow)"/>` +
      `<g transform="translate(100 100) scale(0.8046875)" clip-path="url(#tile)">${backdrop}${mark}</g>`,
    `<clipPath id="tile"><rect width="1024" height="1024" rx="230"/></clipPath>` +
      `<filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur stdDeviation="14"/></filter>`,
  ),
  // Android adaptive icon layers. The mark is shrunk to survive circular masks.
  foreground: compose(
    `<g transform="translate(102.4 102.4) scale(0.8)">${mark}</g>`,
  ),
  background: compose(backdrop),
};

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (svg, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace(
        open,
        open.replace(
          "<svg",
          `<svg style="display:block;width:${size}px;height:${size}px"`,
        ),
      )}</body></html>`,
    );
    return page.screenshot({ omitBackground: true, type: "png" });
  };
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), data);
    console.log("wrote", file, `${(data.length / 1024).toFixed(1)} KB`);
  };

  // Desktop
  write("build/icon.png", await render(variants.rounded, 1024));
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = [];
  for (const size of icoSizes)
    icoImages.push([size, await render(variants.rounded, size)]);
  write("build/icon.ico", ico(icoImages));
  const icnsImages = {};
  for (const size of [16, 32, 64, 128, 256, 512, 1024])
    icnsImages[size] = await render(variants.mac, size);
  write("build/icon.icns", icns(icnsImages));

  // Android adaptive layers and a flat fallback (also the Capacitor asset sources)
  write("assets/icon-only.png", await render(variants.fullbleed, 1024));
  write("assets/icon-foreground.png", await render(variants.foreground, 1024));
  write("assets/icon-background.png", await render(variants.background, 1024));

  // Web app
  write("public/icons/icon-192.png", await render(variants.rounded, 192));
  write("public/icons/icon-512.png", await render(variants.rounded, 512));
  write(
    "public/icons/icon-maskable-512.png",
    await render(variants.fullbleed, 512),
  );
  write("public/apple-touch-icon.png", await render(variants.fullbleed, 180));
  write("public/favicon.svg", Buffer.from(variants.rounded));
  write("public/favicon-32.png", await render(variants.rounded, 32));

  await browser.close();
}

// ICO container holding PNG frames (Windows Vista and later).
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const [size, data] of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map(([, data]) => data)]);
}

// ICNS container with PNG payloads (macOS 10.7 and later).
function icns(bySize) {
  const types = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
    ["ic11", 32],
    ["ic12", 64],
    ["ic13", 256],
    ["ic14", 512],
  ];
  const chunks = types.map(([type, size]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(8 + bySize[size].length, 4);
    return Buffer.concat([head, bySize[size]]);
  });
  const total = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...chunks]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
