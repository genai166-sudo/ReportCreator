const { parseBody, setCors } = require("../lib/api-utils");
const { isSupabaseConfigured } = require("../lib/supabase");
const { isKakaoConfigured } = require("../lib/kakao-proxy");

function getEnvKey(name) {
  const raw = process.env[name] || "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

module.exports = async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    runtime: "vercel-serverless",
    supabaseConfigured: isSupabaseConfigured(),
    tavilyConfigured: Boolean(getEnvKey("TAVILY_API_KEY")),
    naverConfigured: Boolean(getEnvKey("NAVER_CLIENT_ID") && getEnvKey("NAVER_CLIENT_SECRET")),
    geminiConfigured: Boolean(getEnvKey("GEMINI_API_KEY")),
    kakaoConfigured: isKakaoConfigured(),
  });
};
