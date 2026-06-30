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

function firstMeaningfulLine(raw) {
  const lines = String(raw || "")
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter(Boolean);

  const skip = /^\[?(제목|요약|본문)\]?\s*:?\s*$/i;
  const candidate = lines.find(
    (line) =>
      !skip.test(line) &&
      !/^---+$/.test(line) &&
      !/^검색 주제\s*:/.test(line)
  );

  if (!candidate) return "";

  return candidate
    .replace(/^\[제목\]\s*:?\s*/i, "")
    .replace(/^제목\s*[:：]\s*/i, "")
    .slice(0, 200)
    .trim();
}

function parseReport(text, keyword = "") {
  const raw = String(text || "").trim();
  if (!raw) {
    return { title: "", summary: "", body: "", sources: "", raw };
  }

  let title =
    raw.match(/\[제목\]\s*:?\s*(.+?)(?=\n\s*\[요약\]|$)/si)?.[1]?.trim() || "";
  let summary =
    raw.match(/\[요약\]\s*:?\s*(.+?)(?=\n\s*\[본문\]|$)/si)?.[1]?.trim() || "";
  let bodyBlock =
    raw.match(/\[본문\]\s*:?\s*([\s\S]+)/si)?.[1]?.trim() || "";

  if (!title) {
    title =
      raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
      raw.match(/^##\s*제목\s*\n+(.+)/im)?.[1]?.trim() ||
      firstMeaningfulLine(raw);
  }

  if (!summary) {
    summary =
      raw.match(/^##\s*요약\s*\n+([\s\S]+?)(?=\n##|\n\s*\[본문\]|$)/im)?.[1]?.trim() ||
      "";
  }

  if (!bodyBlock) {
    bodyBlock =
      raw.match(/^##\s*본문\s*\n+([\s\S]+)/im)?.[1]?.trim() ||
      "";
  }

  let body = bodyBlock;
  let sources = "";

  const sourcesMatch = (bodyBlock || raw).match(
    /(?:^|\n)\s*4\.\s*참고한 출처 목록\s*\n?([\s\S]*)$/i
  );
  if (sourcesMatch) {
    const sourceBlock = bodyBlock || raw;
    sources = sourcesMatch[1].trim();
    body = sourceBlock.slice(0, sourcesMatch.index).trim();
  }

  if (!body) {
    body = bodyBlock || raw;
  }

  if (!title) {
    const topic = String(keyword || "").trim();
    title = topic ? `${topic} 리서치 보고서` : firstMeaningfulLine(body);
  }

  if (!summary && body) {
    summary = body.replace(/\s+/g, " ").slice(0, 280).trim();
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

  const parsed = parseReport(gemini.text, keyword);

  if (!parsed.title) {
    const err = new Error("AI 보고서에서 제목을 추출하지 못했습니다.");
    err.status = 502;
    throw err;
  }

  return {
    ok: true,
    model: GEMINI_MODEL,
    finishReason: gemini.finishReason || null,
    ...parsed,
  };
}

module.exports = { buildSearchContext, parseReport, generateReport };
