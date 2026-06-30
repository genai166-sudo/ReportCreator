/**
 * Kakao OAuth + 카카오톡 나에게 보내기
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TOKEN_FILE = path.join(ROOT, ".data", "kakao-token.json");
const KAKAO_AUTH_URL = "https://kauth.kakao.com/oauth/authorize";
const KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const KAKAO_MEMO_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
const LOGIN_PATH = "/api/kakao/oauth/login";

function isServerless() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function canPersistTokenFile() {
  return !isServerless();
}

function getRestApiKey() {
  return (process.env.KAKAO_REST_API_KEY || "").trim().replace(/^["']|["']$/g, "");
}

function getClientSecret() {
  return (process.env.KAKAO_CLIENT_SECRET || "").trim().replace(/^["']|["']$/g, "");
}

function getRedirectUri() {
  return (process.env.KAKAO_REDIRECT_URI || "").trim().replace(/^["']|["']$/g, "");
}

function getPublicUrl() {
  return (process.env.APP_PUBLIC_URL || "").trim().replace(/^["']|["']$/g, "");
}

function getLoginUrl() {
  return LOGIN_PATH;
}

function loadTokenFile() {
  if (!canPersistTokenFile()) return {};
  try {
    if (!fs.existsSync(TOKEN_FILE)) return {};
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return {};
  }
}

function getRefreshToken() {
  const env = (process.env.KAKAO_REFRESH_TOKEN || "").trim().replace(/^["']|["']$/g, "");
  if (env) return env;
  if (!canPersistTokenFile()) return "";
  return loadTokenFile().refresh_token || "";
}

function saveRefreshToken(refreshToken) {
  if (!refreshToken || !canPersistTokenFile()) return false;
  try {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: refreshToken }));
    return true;
  } catch {
    return false;
  }
}

function isKakaoConfigured() {
  return Boolean(getRestApiKey() && getRefreshToken());
}

function buildOAuthLoginUrl() {
  const clientId = getRestApiKey();
  const redirectUri = getRedirectUri();
  if (!clientId || !redirectUri) {
    const err = new Error("KAKAO_REST_API_KEY / KAKAO_REDIRECT_URI is not configured");
    err.status = 500;
    throw err;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "talk_message",
  });
  return `${KAKAO_AUTH_URL}?${params}`;
}

async function postForm(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function exchangeCodeForToken(code) {
  const payload = {
    grant_type: "authorization_code",
    client_id: getRestApiKey(),
    redirect_uri: getRedirectUri(),
    code,
  };
  const secret = getClientSecret();
  if (secret) payload.client_secret = secret;
  return postForm(KAKAO_TOKEN_URL, payload);
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    const hint = isServerless()
      ? "KAKAO_REFRESH_TOKEN not set — OAuth 후 Vercel Environment Variables에 토큰 등록"
      : "KAKAO_REFRESH_TOKEN not set — /api/kakao/oauth/login 먼저 실행";
    const err = new Error(hint);
    err.status = 401;
    err.loginUrl = LOGIN_PATH;
    throw err;
  }
  const payload = {
    grant_type: "refresh_token",
    client_id: getRestApiKey(),
    refresh_token: refreshToken,
  };
  const secret = getClientSecret();
  if (secret) payload.client_secret = secret;

  const data = await postForm(KAKAO_TOKEN_URL, payload);
  if (data.refresh_token) saveRefreshToken(data.refresh_token);
  if (!data.access_token) {
    throw new Error("Kakao access_token missing");
  }
  return data.access_token;
}

async function sendMemoTemplate(templateObject) {
  const accessToken = await refreshAccessToken();

  const res = await fetch(KAKAO_MEMO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      template_object: JSON.stringify(templateObject),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.msg || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    if (res.status === 401) err.loginUrl = LOGIN_PATH;
    throw err;
  }
  return data;
}

async function sendMemoText(text, webUrl) {
  const linkUrl = webUrl || getPublicUrl();
  const template = {
    object_type: "text",
    text: String(text).slice(0, 200),
    link: { web_url: linkUrl, mobile_web_url: linkUrl },
    button_title: "보고서 보기",
  };
  return sendMemoTemplate(template);
}

module.exports = {
  buildOAuthLoginUrl,
  exchangeCodeForToken,
  sendMemoText,
  sendMemoTemplate,
  getRefreshToken,
  saveRefreshToken,
  isKakaoConfigured,
  isServerless,
  canPersistTokenFile,
  getPublicUrl,
  getRedirectUri,
  getRestApiKey,
  getLoginUrl,
};
