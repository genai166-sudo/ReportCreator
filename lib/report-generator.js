const { renderPrompt } = require("./prompt-loader");
const { callGemini, GEMINI_MODEL } = require("./gemini-proxy");

function buildSearchContext(keyword, tavily, naver) {
  const lines = [`# 검색 주제: ${keyword}`, ""];

  if (tavily?.ok && (tavily.results || []).length) {
    lines.push("## 글로벌 검색 (Tavily)");
    tavily.results.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title || "제목 없음"}`);
      if (item.content) lines.push(`   요약: ${item.content.slice(0, 400)}`);
      if (item.url) lines.push(`   URL: ${item.url}`);
      lines.push("");
    });
  }

  if (naver?.ok && (naver.items || []).length) {
    lines.push("## 국내 검색 (Naver)");
    naver.items.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title || "제목 없음"}`);
      if (item.description) lines.push(`   요약: ${item.description.slice(0, 400)}`);
      const url = item.originallink || item.link;
      if (url) lines.push(`   URL: ${url}`);
      lines.push("");
    });
  }

  return lines.join("\n").trim();
}

function parseReport(text) {
  const raw = String(text || "").trim();

  const title = raw.match(/\[제목\]\s*(.+?)(?=\n\[요약\]|$)/s)?.[1]?.trim() || "";
  const summary = raw.match(/\[요약\]\s*(.+?)(?=\n\[본문\]|$)/s)?.[1]?.trim() || "";
  const bodyBlock = raw.match(/\[본문\]\s*([\s\S]+)/)?.[1]?.trim() || "";

  let body = bodyBlock;
  let sources = "";

  const sourcesMatch = bodyBlock.match(
    /(?:^|\n)\s*4\.\s*참고한 출처 목록\s*\n?([\s\S]*)$/i
  );
  if (sourcesMatch) {
    sources = sourcesMatch[1].trim();
    body = bodyBlock.slice(0, sourcesMatch.index).trim();
  }

  return { title, summary, body, sources, raw };
}

async function generateReport(keyword, tavily, naver) {
  const hasTavily = tavily?.ok && (tavily.results || []).length > 0;
  const hasNaver = naver?.ok && (naver.items || []).length > 0;

  if (!hasTavily && !hasNaver) {
    const err = new Error("보고서 작성을 위한 검색 결과가 없습니다.");
    err.status = 400;
    throw err;
  }

  const searchContext = buildSearchContext(keyword, tavily, naver);
  const prompt = renderPrompt("report-prompt", {
    KEYWORD: keyword,
    SEARCH_RESULTS: searchContext,
  });

  const gemini = await callGemini({
    prompt,
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 4096,
    },
  });

  const parsed = parseReport(gemini.text);

  return {
    ok: true,
    model: GEMINI_MODEL,
    ...parsed,
  };
}

module.exports = { buildSearchContext, parseReport, generateReport };
