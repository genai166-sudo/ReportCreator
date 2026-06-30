/**
 * Gemini Files API — SDK 업로드 → 분석 → 삭제
 */

const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { uploadBufferWithSdk } = require("./file-upload");

const GEMINI_MODEL = "gemini-2.5-flash";
const FILES_BASE = "https://generativelanguage.googleapis.com/v1beta/files";
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "audio/wav",
  "audio/x-wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/aiff",
  "audio/x-aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);

const EXT_MIME = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".aiff": "audio/aiff",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

function getGeminiApiKey() {
  const raw = process.env.GEMINI_API_KEY || "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

function inferMimeType(name, mimeType) {
  const normalized = String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (normalized && normalized !== "application/octet-stream") {
    return normalized === "audio/mp3" ? "audio/mpeg" : normalized;
  }

  const ext = String(name || "")
    .toLowerCase()
    .match(/\.[^.]+$/)?.[0];
  return ext ? EXT_MIME[ext] || "" : "";
}

function assertAllowedMime(mimeType) {
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    const err = new Error(
      "Unsupported file type. Allowed: PDF, image (JPEG/PNG/WebP/GIF/HEIC), audio (WAV/MP3/AIFF/AAC/OGG/FLAC)"
    );
    err.status = 415;
    throw err;
  }
}

function requireApiKey() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not configured on the server");
    err.status = 500;
    throw err;
  }
  return apiKey;
}

function requirePrompt(prompt) {
  const instruction = String(prompt || "").trim();
  if (!instruction) {
    const err = new Error("prompt is required");
    err.status = 400;
    throw err;
  }
  return instruction;
}

function validateFileMeta({ fileName, mimeType, bytes, checkSize = true }) {
  const resolvedMime = inferMimeType(fileName, mimeType);
  assertAllowedMime(resolvedMime);

  if (checkSize) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) {
      const err = new Error("file size is required");
      err.status = 400;
      throw err;
    }
    if (size > MAX_FILE_BYTES) {
      const err = new Error(`File too large (max ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB)`);
      err.status = 413;
      throw err;
    }
  }

  return { resolvedMime };
}

function extractText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

async function waitForFileActive(fileName, apiKey, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(
      `${FILES_BASE}/${encodeURIComponent(fileName)}?key=${encodeURIComponent(apiKey)}`
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = new Error(data?.error?.message || `Gemini file status failed (${res.status})`);
      err.status = 502;
      throw err;
    }

    const state = data?.state || data?.file?.state;
    if (state === "ACTIVE") return data;
    if (state === "FAILED") {
      const err = new Error(data?.error?.message || "Gemini file processing failed");
      err.status = 502;
      throw err;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  const err = new Error("Gemini file processing timed out");
  err.status = 504;
  throw err;
}

async function deleteGeminiFile(fileName, apiKey) {
  if (!fileName) return;
  try {
    const fileManager = new GoogleAIFileManager(apiKey);
    await fileManager.deleteFile(fileName);
  } catch {
    try {
      await fetch(`${FILES_BASE}/${encodeURIComponent(fileName)}?key=${encodeURIComponent(apiKey)}`, {
        method: "DELETE",
      });
    } catch {
      // ignore
    }
  }
}

async function generateFromFile({ fileUri, mimeType, prompt, apiKey }) {
  const res = await fetch(`${GENERATE_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Gemini generateContent failed (${res.status})`);
    err.status = res.status === 401 || res.status === 403 ? 401 : 502;
    throw err;
  }

  const text = extractText(data);
  if (!text) {
    const err = new Error("Gemini returned empty analysis");
    err.status = 502;
    throw err;
  }

  return {
    text,
    model: GEMINI_MODEL,
    finishReason: data?.candidates?.[0]?.finishReason || null,
    usage: data?.usageMetadata || null,
  };
}

async function analyzeUploadedGeminiFile({ fileUri, geminiFileName, mimeType, fileName, prompt, bytes }) {
  const apiKey = requireApiKey();
  const { resolvedMime } = validateFileMeta({ fileName, mimeType, bytes, checkSize: Boolean(bytes) });
  const instruction = requirePrompt(prompt);

  try {
    await waitForFileActive(geminiFileName, apiKey);

    const result = await generateFromFile({
      fileUri,
      mimeType: resolvedMime,
      prompt: instruction,
      apiKey,
    });

    return {
      ok: true,
      model: result.model,
      analysis: result.text,
      finishReason: result.finishReason,
      usage: result.usage,
      fileName: fileName || null,
      mimeType: resolvedMime,
      bytes: bytes || null,
    };
  } finally {
    await deleteGeminiFile(geminiFileName, apiKey);
  }
}

async function analyzeFileBuffer({ buffer, mimeType, fileName, prompt }) {
  const apiKey = requireApiKey();

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error("file is required");
    err.status = 400;
    throw err;
  }

  const { resolvedMime } = validateFileMeta({
    fileName,
    mimeType,
    bytes: buffer.length,
  });
  const instruction = requirePrompt(prompt);

  let uploaded = null;
  try {
    uploaded = await uploadBufferWithSdk(buffer, resolvedMime, fileName || "upload", apiKey);
    return analyzeUploadedGeminiFile({
      fileUri: uploaded.uri,
      geminiFileName: uploaded.name,
      mimeType: resolvedMime,
      fileName,
      prompt: instruction,
      bytes: buffer.length,
    });
  } catch (err) {
    if (uploaded?.name) await deleteGeminiFile(uploaded.name, apiKey);
    throw err;
  }
}

module.exports = {
  analyzeFileBuffer,
  analyzeUploadedGeminiFile,
  getGeminiApiKey,
  GEMINI_MODEL,
  ALLOWED_MIME,
  inferMimeType,
  MAX_FILE_BYTES,
};
