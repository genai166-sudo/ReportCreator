const { tavilySearch } = require("./tavily-proxy");
const { naverNewsSearch } = require("./naver-proxy");
const { generateReport } = require("./report-generator");
const { saveReport } = require("./report-store");
const { sendReportToKakao } = require("./kakao-notify");
const { getLoginUrl } = require("./kakao-proxy");

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
    max_results: 8,
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
    display: 8,
    sort: "date",
  });
}

async function runResearch(keyword) {
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

  const tavily =
    tavilySettled.status === "fulfilled"
      ? { ok: true, query, ...tavilySettled.value }
      : { ok: false, error: tavilySettled.reason?.message || "Tavily search failed" };

  const naverRaw =
    naverSettled.status === "fulfilled"
      ? naverSettled.value
      : { ok: false, error: naverSettled.reason?.message || "Naver search failed" };

  const naver =
    naverSettled.status === "fulfilled"
      ? {
          ok: true,
          lastBuildDate: naverRaw.lastBuildDate,
          total: naverRaw.total,
          start: naverRaw.start,
          display: naverRaw.display,
          items: (naverRaw.items || []).map((item) => ({
            title: stripHtml(item.title),
            description: stripHtml(item.description),
            link: item.link || "",
            originallink: item.originallink || "",
            pubDate: item.pubDate || "",
          })),
        }
      : naverRaw;

  const summary = {
    tavilyCount: tavily.ok ? (tavily.results || []).length : 0,
    naverCount: naver.ok ? (naver.items || []).length : 0,
  };

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

  return {
    keyword: query,
    tavily,
    naver,
    summary,
    report,
  };
}

module.exports = { runResearch };
