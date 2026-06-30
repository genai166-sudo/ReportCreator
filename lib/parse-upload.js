const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function readRawBody(req, maxBytes = MAX_UPLOAD_BYTES) {
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
    return Promise.resolve(req.rawBody);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const err = new Error(`File too large (max ${Math.floor(maxBytes / 1024 / 1024)}MB)`);
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractBoundary(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  return match?.[1] || match?.[2] || "";
}

function parseMultipart(buffer, contentType) {
  const boundary = extractBoundary(contentType);
  if (!boundary) {
    const err = new Error("multipart boundary missing");
    err.status = 400;
    throw err;
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delimiter);
  if (start === -1) {
    const err = new Error("invalid multipart body");
    err.status = 400;
    throw err;
  }

  start += delimiter.length;
  if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;

  while (start < buffer.length) {
    let end = buffer.indexOf(delimiter, start);
    if (end === -1) end = buffer.length;

    let part = buffer.subarray(start, end);
    if (part.length >= 2 && part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      const body = part.subarray(headerEnd + 4);
      const nameMatch = headerText.match(/name="([^"]+)"/i);
      const filenameMatch = headerText.match(/filename="([^"]*)"/i);
      const typeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);

      parts.push({
        name: nameMatch?.[1] || "",
        filename: filenameMatch?.[1] || "",
        contentType: typeMatch?.[1]?.trim() || "",
        body,
      });
    }

    start = end + delimiter.length;
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;
  }

  return parts;
}

function fromJsonBody(body) {
  const prompt = body.prompt ?? body.instruction ?? body.query ?? "";
  const fileObj = body.file || {};

  let buffer;
  if (typeof fileObj.data === "string") {
    buffer = Buffer.from(fileObj.data, "base64");
  } else if (typeof body.data === "string") {
    buffer = Buffer.from(body.data, "base64");
  }

  return {
    prompt: String(prompt || "").trim(),
    fileName: fileObj.name || fileObj.filename || body.fileName || "upload",
    mimeType: fileObj.mimeType || fileObj.mime_type || body.mimeType || "",
    buffer,
  };
}

function fromMultipartParts(parts) {
  const fields = {};
  let filePart = null;

  for (const part of parts) {
    if (part.name === "file" || part.filename) {
      filePart = part;
      continue;
    }
    fields[part.name] = part.body.toString("utf8");
  }

  if (!filePart?.body?.length) {
    const err = new Error("file field is required");
    err.status = 400;
    throw err;
  }

  return {
    prompt: String(fields.prompt || fields.instruction || fields.query || "").trim(),
    fileName: filePart.filename || "upload",
    mimeType: filePart.contentType || "",
    buffer: filePart.body,
  };
}

async function parseUploadRequest(req) {
  const contentType = req.headers?.["content-type"] || req.headers?.["Content-Type"] || "";

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    const hasBase64 =
      typeof req.body?.file?.data === "string" || typeof req.body?.data === "string";
    if (hasBase64) {
      return fromJsonBody(req.body);
    }
  }

  const raw = await readRawBody(req);

  if (contentType.includes("application/json")) {
    let json = {};
    try {
      json = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      const err = new Error("Invalid JSON body");
      err.status = 400;
      throw err;
    }
    return fromJsonBody(json);
  }

  if (contentType.includes("multipart/form-data")) {
    const parts = parseMultipart(raw, contentType);
    return fromMultipartParts(parts);
  }

  const err = new Error("Content-Type must be multipart/form-data or application/json");
  err.status = 415;
  throw err;
}

module.exports = {
  MAX_UPLOAD_BYTES,
  parseUploadRequest,
  readRawBody,
};
