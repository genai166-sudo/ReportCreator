/**
 * Naver 검색 API 프록시 — NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
 * https://developers.naver.com/docs/serviceapi/search/news/news.md
 */

const NAVER_NEWS_URL = "https://openapi.naver.com/v1/search/news.json";

function getNaverCredentials() {
  const clientId = (process.env.NAVER_CLIENT_ID || "").trim().replace(/^["']|["']$/g, "");
  const clientSecret = (process.env.NAVER_CLIENT_SECRET || "").trim().replace(/^["']|["']$/g, "");
  return { clientId, clientSecret };
}

async function naverNewsSearch(params = {}) {
  const { clientId, clientSecret } = getNaverCredentials();
  if (!clientId || !clientSecret) {
    const err = new Error("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET is not configured on the server");
    err.status = 500;
    throw err;
  }

  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) {
    const err = new Error("query is required");
    err.status = 400;
    throw err;
  }

  const display = Math.min(Math.max(Number(params.display) || 10, 1), 100);
  const start = Math.min(Math.max(Number(params.start) || 1, 1), 1000);
  const sort = params.sort === "sim" ? "sim" : "date";

  const url = new URL(NAVER_NEWS_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("start", String(start));
  url.searchParams.set("sort", sort);

  const res = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.errorMessage || data.message || `Naver API HTTP ${res.status}`);
    err.status = res.status === 401 || res.status === 403 ? 401 : res.status;
    throw err;
  }

  return data;
}

module.exports = { naverNewsSearch, getNaverCredentials };
