const { tavilySearch } = require("./tavily-proxy");
const { naverNewsSearch } = require("./naver-proxy");
const { generateReport } = require("./report-generator");
const { saveReport } = require("./report-store");
const { sendReportToKakao } = require("./kakao-notify");
const { getLoginUrl } = require("./kakao-proxy");
const { rankByRelevance } = require("./search-relevance");

const RESULT_LIMIT = 8;
const NAVER_FETCH_COUNT = 30;

function stripHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

async function fetchTavily(query) {
  const opts = {
    query,
    search_depth: "basic",
    max_results: 15,
    include_answer: false,
    topic: "news",
    days: 14,
  };

  try {
    const data = await tavilySearch(opts);
    if ((data.results || []).length) return data;
  } catch (err) {
    if (/not configured|401|deactivated/i.test(err.message)) throw err;
  }

  return tavilySearch({
    ...opts,
    topic: "general",
  });
}

async function fetchNaver(query) {
  return naverNewsSearch({
    query,
    display: NAVER_FETCH_COUNT,
    sort: "sim",
  });
}

async function runSearch(keyword) {
  const query = typeof keyword === "string" ? keyword.trim() : "";
  if (!query) {
    const err = new Error("keyword is required");
    err.status = 400;
    throw err;
  }

  const [tavilySettled, naverSettled] = await Promise.allSettled([
    fetchTavily(query),
    fetchNaver(query),
  ]);

  const tavilyRanked = tavilySettled.status === "fulfilled"
    ? rankByRelevance(query, (tavilySettled.value.results || []).map((item) => ({
        title: item.title || "",
        description: item.content || "",
        url: item.url || "",
        published_date: item.published_date || "",
        score: item.score,
        _raw: item,
      })), { limit: RESULT_LIMIT })
    : [];

  const tavily =
    tavilySettled.status === "fulfilled"
      ? {
          ok: true,
          query,
          results: tavilyRanked.map(({ _raw, relevanceScore }) => ({
            ..._raw,
            relevanceScore,
          })),
        }
      : { ok: false, error: tavilySettled.reason?.message || "Tavily search failed" };

  const naverRaw =
    naverSettled.status === "fulfilled"
      ? naverSettled.value
      : { ok: false, error: naverSettled.reason?.message || "Naver search failed" };

  const naverItemsRaw =
    naverSettled.status === "fulfilled"
      ? (naverRaw.items || []).map((item) => ({
          title: stripHtml(item.title),
          description: stripHtml(item.description),
          link: item.link || "",
          originallink: item.originallink || "",
          pubDate: item.pubDate || "",
        }))
      : [];

  const naverRanked = rankByRelevance(query, naverItemsRaw, { limit: RESULT_LIMIT });

  const naver =
    naverSettled.status === "fulfilled"
      ? {
          ok: true,
          lastBuildDate: naverRaw.lastBuildDate,
          total: naverRaw.total,
          start: naverRaw.start,
          display: naverRanked.length,
          items: naverRanked,
        }
      : naverRaw;

  return {
    keyword: query,
    tavily,
    naver,
    summary: {
      tavilyCount: tavily.ok ? (tavily.results || []).length : 0,
      naverCount: naver.ok ? (naver.items || []).length : 0,
    },
  };
}

async function runReport(keyword, tavily, naver) {
  const query = typeof keyword === "string" ? keyword.trim() : "";
  if (!query) {
    const err = new Error("keyword is required");
    err.status = 400;
    throw err;
  }

  let report = { ok: false, error: null };
  try {
    report = await generateReport(query, tavily, naver);

    if (report.ok) {
      try {
        const saved = await saveReport({
          topic: query,
          title: report.title,
          summary: report.summary,
          content: report.body,
          sources: report.sources,
          source_type: "search",
        });
        report.saved = true;
        report.savedId = saved.id;
        report.savedAt = saved.created_at;

        try {
          await sendReportToKakao({
            id: saved.id,
            title: report.title,
            summary: report.summary,
          });
          report.kakaoSent = true;
        } catch (kakaoErr) {
          report.kakaoSent = false;
          report.kakaoError = kakaoErr.message || "카카오톡 전송 실패";
          report.kakaoLoginUrl = kakaoErr.loginUrl || getLoginUrl();
        }
      } catch (saveErr) {
        report.saved = false;
        report.saveError = saveErr.message || "보고서 저장 실패";
      }
    }
  } catch (err) {
    report = { ok: false, error: err.message || "보고서 생성 실패" };
  }

  return report;
}

async function runResearch(keyword) {
  const search = await runSearch(keyword);
  const report = await runReport(search.keyword, search.tavily, search.naver);
  return { ...search, report };
}

module.exports = { runSearch, runReport, runResearch };
