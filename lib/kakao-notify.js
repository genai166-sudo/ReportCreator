const {
  isKakaoConfigured,
  sendMemoText,
  getPublicUrl,
  getLoginUrl,
} = require("./kakao-proxy");

function truncate(text, max) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function buildReportUrl(reportId) {
  const base = getPublicUrl();
  if (!base) {
    const err = new Error("APP_PUBLIC_URL is not configured on the server");
    err.status = 500;
    throw err;
  }
  return `${base.replace(/\/+$/, "")}/report.html?id=${reportId}`;
}

function buildMemoText(title, summary) {
  const headline = truncate(title, 60) || "제목 없음";
  const body = truncate(summary, 90);
  const text = `[리서치 보고서]\n${headline}\n\n${body}`;
  return text.slice(0, 200);
}

async function sendReportToKakao({ id, title, summary }) {
  if (!isKakaoConfigured()) {
    const err = new Error("카카오톡 연동이 필요합니다. 로그인 후 다시 시도하세요.");
    err.status = 401;
    err.loginUrl = getLoginUrl();
    throw err;
  }

  const reportUrl = buildReportUrl(id);
  const text = buildMemoText(title, summary);
  await sendMemoText(text, reportUrl);
  return { sent: true, reportUrl };
}

module.exports = { sendReportToKakao, buildReportUrl, buildMemoText, truncate };
