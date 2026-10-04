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

function contentType(filename) {
  return (
    mimeTypes[path.extname(filename).toLowerCase()] ||
    "application/octet-stream"
  );
}

// The whole file, read by Node instead of by Chromium's file loader. Node
// reaches files that Chromium's loader cannot: on Windows a path of more than
// 259 characters, and a share named as \\localhost\share (Chromium reads
// file://localhost/ as the local disk).
async function streamWholeFile(filename, request) {
  const stat = await fs.promises.stat(filename);
  if (!stat.isFile()) return new Response("Not found", { status: 404 });
  const headers = {
    "Content-Type": contentType(filename),
    "Content-Length": String(stat.size),
    "Accept-Ranges": "bytes",
  };
  const body =
    request.method === "HEAD" || stat.size === 0
      ? null
      : Readable.toWeb(fs.createReadStream(filename));
  return new Response(body, { status: 200, headers });
}

async function serveMediaFile(filename, request, fetchFile) {
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    let failure;
    try {
      const response = await fetchFile(pathToFileURL(filename).href, {
        method: request.method,
      });
      if (response.ok) return response;
      failure = new Error(`The file could not be loaded (${response.status})`);
    } catch (error) {
      failure = error;
    }
    try {
      return await streamWholeFile(filename, request);
    } catch {
      throw failure;
    }
  }
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
    "Content-Type": contentType(filename),
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
