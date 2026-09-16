const fs = require("node:fs");
const { Readable } = require("node:stream");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const mimeTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
};

function parseByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !size || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= size ||
      end < start
    )
      return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function serveMediaFile(filename, request, fetchFile) {
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader)
    return fetchFile(pathToFileURL(filename).href, { method: request.method });
  // Electron's file fetch currently ignores Range headers. Stream only the requested
  // bytes so large video seeking remains bounded and Chromium receives a real 206.
  const stat = await fs.promises.stat(filename);
  if (!stat.isFile()) return new Response("Not found", { status: 404 });
  const range = parseByteRange(rangeHeader, stat.size);
  if (!range)
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${stat.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  const headers = {
    "Content-Type":
      mimeTypes[path.extname(filename).toLowerCase()] ||
      "application/octet-stream",
    "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
    "Content-Length": String(range.end - range.start + 1),
    "Accept-Ranges": "bytes",
  };
  const body =
    request.method === "HEAD"
      ? null
      : Readable.toWeb(
          fs.createReadStream(filename, { start: range.start, end: range.end }),
        );
  return new Response(body, { status: 206, headers });
}

module.exports = { parseByteRange, serveMediaFile };
