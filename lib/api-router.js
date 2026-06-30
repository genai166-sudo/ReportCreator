const { parseBody, setCors, sendError } = require("./api-utils");
const { isSupabaseConfigured } = require("./supabase");
const { isKakaoConfigured, getRestApiKey, getLoginUrl, buildOAuthLoginUrl, exchangeCodeForToken, saveRefreshToken, isServerless, getRedirectUri } = require("./kakao-proxy");
const { runResearch, runSearch, runReport } = require("./research");
const { listReports, getReportById } = require("./report-store");
const { callGemini } = require("./gemini-proxy");
const { tavilySearch } = require("./tavily-proxy");
const { naverNewsSearch } = require("./naver-proxy");
const { analyzeFileBuffer, beginGeminiFileUpload, analyzeGeminiFileRef, uploadGeminiChunk, MAX_CHUNK_BYTES } = require("./gemini-files");
const { parseUploadRequest, readRawBody } = require("./parse-upload");

function getEnvKey(name) {
  const raw = process.env[name] || "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

function getRoutePath(req) {
  const slug = req.query?.slug;
  if (Array.isArray(slug)) return slug.filter(Boolean).join("/");
  if (slug) return String(slug).replace(/^\/+|\/+$/g, "");

  const original =
    req.headers?.["x-vercel-original-path"] ||
    req.headers?.["x-invoke-path"] ||
    req.headers?.["x-forwarded-uri"];
  if (original) {
    return String(original).split("?")[0].replace(/^\/api\/?/, "").replace(/^\/+|\/+$/g, "");
  }

  const url = req.url || "";
  const path = url.split("?")[0];
  return path.replace(/^\/api\/?(?:index)?\/?/, "").replace(/^\/+|\/+$/g, "");
}

async function prepareJsonBody(req, path) {
  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") return;
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return;
  if (path === "analyze-file") return;
  if (path === "analyze-file/init" || path === "analyze-file/run") return;
  if (path === "analyze-file/upload-chunk") return;

  const contentType = String(req.headers?.["content-type"] || "");
  if (!contentType.includes("application/json")) return;

  const raw = req.rawBody || (await readRawBody(req, 1024 * 1024));
  req.rawBody = raw;
  try {
    req.body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch {
    const err = new Error("Invalid JSON body");
    err.status = 400;
    throw err;
  }
}

async function handleHealth(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  return res.status(200).json({
    ok: true,
    runtime: "vercel-serverless",
    supabaseConfigured: isSupabaseConfigured(),
    tavilyConfigured: Boolean(getEnvKey("TAVILY_API_KEY")),
    naverConfigured: Boolean(getEnvKey("NAVER_CLIENT_ID") && getEnvKey("NAVER_CLIENT_SECRET")),
    geminiConfigured: Boolean(getEnvKey("GEMINI_API_KEY")),
    kakaoConfigured: isKakaoConfigured(),
  });
}

async function handleResearch(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = parseBody(req);
  const keyword = body.keyword ?? body.query ?? body.topic;
  const data = await runResearch(keyword);
  return res.status(200).json(data);
}

async function handleResearchSearch(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = parseBody(req);
  const keyword = body.keyword ?? body.query ?? body.topic;
  const data = await runSearch(keyword);
  return res.status(200).json(data);
}

async function handleResearchReport(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = parseBody(req);
  const keyword = body.keyword ?? body.query ?? body.topic;
  const report = await runReport(keyword, body.tavily, body.naver);
  return res.status(200).json({ report });
}

async function handleReports(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const reports = await listReports();
  return res.status(200).json({ reports });
}

async function handleReport(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: "id is required" });

  const report = await getReportById(id);
  if (!report) return res.status(404).json({ error: "Report not found" });
  return res.status(200).json({ report });
}

async function handleAnalyzeFileInit(req, res) {
  setCors(res, "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = parseBody(req);
  const result = await beginGeminiFileUpload({
    fileName: body.fileName || body.name,
    mimeType: body.mimeType || body.mime_type,
    size: body.size ?? body.bytes,
  });
  return res.status(200).json(result);
}

async function handleAnalyzeFileUploadChunk(req, res) {
  setCors(res, "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = parseBody(req);
  const uploadUrl = body.uploadUrl || body.upload_url;
  const offset = Number(body.offset);
  const finalize = Boolean(body.finalize);
  const data = body.data;

  if (!uploadUrl) {
    return res.status(400).json({ error: "uploadUrl is required" });
  }
  if (!Number.isFinite(offset) || offset < 0) {
    return res.status(400).json({ error: "offset is required" });
  }
  if (typeof data !== "string" || !data) {
    return res.status(400).json({ error: "data (base64 chunk) is required" });
  }

  const buffer = Buffer.from(data, "base64");
  if (!buffer.length) {
    return res.status(400).json({ error: "empty chunk" });
  }
  if (buffer.length > MAX_CHUNK_BYTES) {
    return res.status(413).json({ error: `Chunk too large (max ${Math.floor(MAX_CHUNK_BYTES / 1024 / 1024)}MB)` });
  }

  const result = await uploadGeminiChunk({ uploadUrl, offset, buffer, finalize });
  return res.status(200).json(result);
}

async function handleAnalyzeFileRun(req, res) {
  setCors(res, "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = parseBody(req);
  const result = await analyzeGeminiFileRef({
    fileUri: body.fileUri || body.file_uri,
    geminiFileName: body.geminiFileName || body.gemini_file_name,
    mimeType: body.mimeType || body.mime_type,
    fileName: body.displayName || body.fileName || body.name,
    prompt: body.prompt,
  });
  return res.status(200).json(result);
}

async function handleAnalyzeFile(req, res) {
  setCors(res, "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const upload = await parseUploadRequest(req);
  const result = await analyzeFileBuffer({
    buffer: upload.buffer,
    mimeType: upload.mimeType,
    fileName: upload.fileName,
    prompt: upload.prompt,
  });
  return res.status(200).json(result);
}

async function handleGemini(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const data = await callGemini(parseBody(req));
  return res.status(200).json(data);
}

async function handleTavily(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const data = await tavilySearch(parseBody(req));
  return res.status(200).json(data);
}

async function handleSearch(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const params = req.method === "GET" ? { ...(req.query || {}) } : parseBody(req);
  delete params.slug;
  const data = await naverNewsSearch(params);
  return res.status(200).json(data);
}

async function handleKakaoStatus(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  return res.status(200).json({
    configured: isKakaoConfigured(),
    hasAppKey: Boolean(getRestApiKey()),
    hasRefreshToken: isKakaoConfigured(),
    loginUrl: getLoginUrl(),
  });
}

async function handleKakaoOAuthLogin(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const url = buildOAuthLoginUrl();
  res.setHeader("Location", url);
  return res.status(302).end();
}

async function handleKakaoOAuthCallback(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const q = { ...(req.query || {}) };
  delete q.slug;

  if (q.error) {
    return res.status(400).send(`<h1>카카오 로그인 실패</h1><p>${q.error}</p>`);
  }
  if (!q.code) return res.status(400).json({ error: "code is required" });

  const tokens = await exchangeCodeForToken(q.code);
  const saved = tokens.refresh_token ? saveRefreshToken(tokens.refresh_token) : false;
  const onVercel = isServerless();

  const tokenBlock = tokens.refresh_token
    ? onVercel || !saved
      ? `<p><strong>Vercel:</strong> 아래 Refresh Token을 Vercel Environment Variables에 등록한 뒤 재배포하세요.</p>
<pre><code>KAKAO_REFRESH_TOKEN=${tokens.refresh_token}</code></pre>`
      : `<p>Refresh Token이 <code>.data/kakao-token.json</code> 에 저장되었습니다.</p>
<p>배포 시에는 Environment Variables에도 동일 값을 넣으세요:</p>
<pre><code>KAKAO_REFRESH_TOKEN=${tokens.refresh_token}</code></pre>`
    : `<p>Refresh Token이 없습니다. 동의 항목 <code>talk_message</code> 확인 후 다시 로그인하세요.</p>`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"/><title>카카오 연동 완료</title>
<style>body{font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:2rem;max-width:640px;margin:auto}
code,pre{background:#1a2a3d;padding:2px 6px;border-radius:4px;word-break:break-all}
a{color:#58a6ff}</style></head><body>
<h1>카카오톡 연동 완료</h1>
<p>OAuth 인증이 완료되었습니다. 이제 리서치 보고서가 카카오톡으로 전송됩니다.</p>
${tokenBlock}
<p>Redirect URI: <code>${getRedirectUri()}</code></p>
<p><a href="/">아카이브로 돌아가기</a></p></body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}

const ROUTES = {
  health: handleHealth,
  research: handleResearch,
  "research/search": handleResearchSearch,
  "research/report": handleResearchReport,
  reports: handleReports,
  report: handleReport,
  "analyze-file": handleAnalyzeFile,
  "analyze-file/init": handleAnalyzeFileInit,
  "analyze-file/upload-chunk": handleAnalyzeFileUploadChunk,
  "analyze-file/run": handleAnalyzeFileRun,
  gemini: handleGemini,
  tavily: handleTavily,
  search: handleSearch,
  "kakao/status": handleKakaoStatus,
  "kakao/oauth/login": handleKakaoOAuthLogin,
  "kakao/oauth/callback": handleKakaoOAuthCallback,
};

async function dispatch(req, res) {
  const path = getRoutePath(req);
  const handler = ROUTES[path];

  if (!handler) {
    return res.status(404).json({ error: "Not Found", path: `/api/${path}` });
  }

  if (path === "analyze-file" && req.method === "POST" && !req.rawBody) {
    req.rawBody = await readRawBody(req, 4 * 1024 * 1024);
  } else {
    await prepareJsonBody(req, path);
  }

  return handler(req, res);
}

async function handler(req, res) {
  try {
    await dispatch(req, res);
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { handler, dispatch, getRoutePath, ROUTES };
