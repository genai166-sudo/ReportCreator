/**
 * Gemini 파일 분석
 * - 소용량(≤3.5MB): inline_data (Files API 없음, Vercel 안전)
 * - 대용량: SDK 업로드 → ACTIVE 대기 → 분석 → 삭제
 */

const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const { uploadBufferWithSdk, VERCEL_SAFE_BYTES } = require("./file-upload");

const GEMINI_MODEL = "gemini-2.5-flash";
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

function formatAnalysisResult({ text, model, finishReason, usage, fileName, mimeType, bytes }) {
  return {
    ok: true,
    model: model || GEMINI_MODEL,
    analysis: text,
    finishReason: finishReason || null,
    usage: usage || null,
    fileName: fileName || null,
    mimeType: mimeType || null,
    bytes: bytes ?? null,
  };
}

async function callGenerateContent(apiKey, contents, generationConfig = {}) {
  const res = await fetch(`${GENERATE_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
        ...generationConfig,
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

async function generateFromInline({ buffer, mimeType, prompt, apiKey }) {
  const result = await callGenerateContent(apiKey, [
    {
      role: "user",
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: mimeType,
            data: buffer.toString("base64"),
          },
        },
      ],
    },
  ]);
  return result;
}

async function waitForFileActive(fileManager, fileName, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const file = await fileManager.getFile(fileName);
    const state = file?.state;

    if (state === FileState.ACTIVE) return file;
    if (state === FileState.FAILED) {
      const err = new Error(file?.error?.message || "Gemini file processing failed");
      err.status = 502;
      throw err;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  const err = new Error("Gemini file processing timed out");
  err.status = 504;
  throw err;
}

async function deleteGeminiFile(fileManager, fileName) {
  if (!fileName) return;
  try {
    await fileManager.deleteFile(fileName);
  } catch {
    // ignore cleanup errors
  }
}

async function generateFromFile({ fileUri, mimeType, prompt, apiKey }) {
  return callGenerateContent(apiKey, [
    {
      role: "user",
      parts: [
        { text: prompt },
        { file_data: { mime_type: mimeType, file_uri: fileUri } },
      ],
    },
  ]);
}

async function analyzeUploadedGeminiFile({ fileUri, geminiFileName, mimeType, fileName, prompt, bytes }) {
  const apiKey = requireApiKey();
  const { resolvedMime } = validateFileMeta({ fileName, mimeType, bytes, checkSize: Boolean(bytes) });
  const instruction = requirePrompt(prompt);
  const fileManager = new GoogleAIFileManager(apiKey);

  try {
    await waitForFileActive(fileManager, geminiFileName);

    const result = await generateFromFile({
      fileUri,
      mimeType: resolvedMime,
      prompt: instruction,
      apiKey,
    });

    return formatAnalysisResult({
      ...result,
      fileName,
      mimeType: resolvedMime,
      bytes: bytes || null,
    });
  } finally {
    await deleteGeminiFile(fileManager, geminiFileName);
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

  if (buffer.length <= VERCEL_SAFE_BYTES) {
    const result = await generateFromInline({
      buffer,
      mimeType: resolvedMime,
      prompt: instruction,
      apiKey,
    });
    return formatAnalysisResult({
      ...result,
      fileName,
      mimeType: resolvedMime,
      bytes: buffer.length,
    });
  }

  const fileManager = new GoogleAIFileManager(apiKey);
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
    if (uploaded?.name) await deleteGeminiFile(fileManager, uploaded.name);
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
  validateFileMeta,
  MAX_FILE_BYTES,
  VERCEL_SAFE_BYTES,
};
