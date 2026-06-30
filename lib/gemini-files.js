/**
 * Gemini Files API — 업로드 → 분석 → 삭제 (일회성)
 * 모델: gemini-2.5-flash (무료 티어)
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const FILES_BASE = "https://generativelanguage.googleapis.com/v1beta/files";
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

function extractText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

async function uploadGeminiFile({ buffer, mimeType, displayName, apiKey }) {
  const startRes = await fetch(`${UPLOAD_BASE}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
    },
    body: JSON.stringify({
      file: { display_name: displayName || "upload" },
    }),
  });

  if (!startRes.ok) {
    const data = await startRes.json().catch(() => ({}));
    const err = new Error(data?.error?.message || `Gemini upload start failed (${startRes.status})`);
    err.status = 502;
    throw err;
  }

  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    const err = new Error("Gemini upload URL missing");
    err.status = 502;
    throw err;
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(buffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: buffer,
  });

  const fileInfo = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    const err = new Error(fileInfo?.error?.message || `Gemini upload failed (${uploadRes.status})`);
    err.status = 502;
    throw err;
  }

  const file = fileInfo.file;
  if (!file?.uri || !file?.name) {
    const err = new Error("Gemini upload response missing file metadata");
    err.status = 502;
    throw err;
  }

  return file;
}

async function waitForFileActive(fileName, apiKey, timeoutMs = 60_000) {
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

    await new Promise((r) => setTimeout(r, 1500));
  }

  const err = new Error("Gemini file processing timed out");
  err.status = 504;
  throw err;
}

async function deleteGeminiFile(fileName, apiKey) {
  if (!fileName) return;

  try {
    await fetch(`${FILES_BASE}/${encodeURIComponent(fileName)}?key=${encodeURIComponent(apiKey)}`, {
      method: "DELETE",
    });
  } catch {
    // 분석 결과 반환 우선 — 삭제 실패는 무시
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

async function analyzeFileBuffer({ buffer, mimeType, fileName, prompt }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not configured on the server");
    err.status = 500;
    throw err;
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error("file is required");
    err.status = 400;
    throw err;
  }

  const resolvedMime = inferMimeType(fileName, mimeType);
  assertAllowedMime(resolvedMime);

  const instruction = String(prompt || "").trim();
  if (!instruction) {
    const err = new Error("prompt is required");
    err.status = 400;
    throw err;
  }

  let uploaded = null;
  try {
    uploaded = await uploadGeminiFile({
      buffer,
      mimeType: resolvedMime,
      displayName: fileName || "upload",
      apiKey,
    });

    await waitForFileActive(uploaded.name, apiKey);

    const result = await generateFromFile({
      fileUri: uploaded.uri,
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
      bytes: buffer.length,
    };
  } finally {
    if (uploaded?.name) {
      await deleteGeminiFile(uploaded.name, apiKey);
    }
  }
}

module.exports = {
  analyzeFileBuffer,
  getGeminiApiKey,
  GEMINI_MODEL,
  ALLOWED_MIME,
  inferMimeType,
};
