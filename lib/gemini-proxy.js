/**
 * Google Gemini 프록시 — GEMINI_API_KEY
 * 모델: gemini-2.5-flash
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function getGeminiApiKey() {
  const raw = process.env.GEMINI_API_KEY || "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

function extractText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

async function callGemini(body = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not configured on the server");
    err.status = 500;
    throw err;
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const hasContents = Array.isArray(body.contents) && body.contents.length > 0;

  if (!prompt && !hasContents) {
    const err = new Error("prompt or contents is required");
    err.status = 400;
    throw err;
  }

  const payload = {
    contents: hasContents
      ? body.contents
      : [{ role: "user", parts: [{ text: prompt }] }],
  };

  if (body.systemInstruction) {
    payload.systemInstruction = body.systemInstruction;
  }

  if (body.generationConfig) {
    payload.generationConfig = body.generationConfig;
  }

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || `Gemini HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status === 401 || res.status === 403 ? 401 : 502;
    throw err;
  }

  const text = extractText(data);
  const finishReason = data?.candidates?.[0]?.finishReason || null;

  return {
    text,
    model: GEMINI_MODEL,
    finishReason,
    usage: data.usageMetadata || null,
  };
}

module.exports = { callGemini, getGeminiApiKey, GEMINI_MODEL };
