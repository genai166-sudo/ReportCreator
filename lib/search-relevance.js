/**
 * 검색 결과 관련도 점수 — 제목·요약에서 키워드 일치도 기준
 */

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(text, keyword) {
  if (!text || !keyword) return 0;
  return (text.match(new RegExp(escapeRegExp(keyword), "gi")) || []).length;
}

function keywordTokens(keyword) {
  return normalizeText(keyword)
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function hasSecondaryTagPattern(title, keyword) {
  const t = normalizeText(title);
  const k = normalizeText(keyword);
  const idx = t.indexOf(k);
  if (idx <= 0) return false;

  const before = t.slice(0, idx);
  const separators = [":", "·", "|", " - ", " — "];
  for (const sep of separators) {
    const sepIdx = before.lastIndexOf(sep);
    if (sepIdx >= 0) {
      const prefix = before.slice(0, sepIdx).trim();
      const segment = before.slice(sepIdx + sep.length).trim();
      const tagged = segment || prefix;
      if (tagged.length >= 2 && !tagged.includes(k) && !prefix.includes(k)) {
        return true;
      }
    }
  }
  return false;
}

function scoreItem(keyword, item) {
  const kw = normalizeText(keyword);
  const title = normalizeText(item.title);
  const description = normalizeText(item.description || item.content || "");
  const tokens = keywordTokens(kw);

  if (!kw) return 0;

  let score = 0;

  if (title.includes(kw)) score += 50;
  else if (tokens.length > 1 && tokens.every((t) => title.includes(t))) score += 35;
  else if (tokens.some((t) => title.includes(t))) score += 10;

  if (title.startsWith(kw)) score += 25;
  else {
    const idx = title.indexOf(kw);
    if (idx >= 0 && idx <= 12) score += 18;
    else if (idx > 12 && idx <= 30) score += 8;
  }

  if (description.includes(kw)) score += 12;
  else if (tokens.every((t) => description.includes(t))) score += 8;

  score += Math.min(countOccurrences(title, kw) * 6, 18);
  score += Math.min(countOccurrences(description, kw) * 2, 8);

  if (hasSecondaryTagPattern(item.title || "", kw)) score -= 40;

  if (!title.includes(kw) && !tokens.some((t) => title.includes(t))) score -= 20;

  if (typeof item.score === "number") score += item.score * 10;

  return score;
}

function rankByRelevance(keyword, items, { limit = 8, minScore = 20 } = {}) {
  const scored = (items || []).map((item) => ({
    ...item,
    relevanceScore: scoreItem(keyword, item),
  }));

  const ranked = scored
    .filter((item) => {
      if (item.relevanceScore < minScore) return false;
      if (hasSecondaryTagPattern(item.title || "", keyword) && item.relevanceScore < 55) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  if (ranked.length >= limit) return ranked.slice(0, limit);

  const fallback = scored
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);

  return ranked.length ? ranked : fallback;
}

module.exports = { scoreItem, rankByRelevance, hasSecondaryTagPattern };
