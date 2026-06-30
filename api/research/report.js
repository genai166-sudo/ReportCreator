const { runReport } = require("../../lib/research");
const { parseBody, setCors, sendError } = require("../../lib/api-utils");

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = parseBody(req);
    const keyword = body.keyword ?? body.query ?? body.topic;
    const report = await runReport(keyword, body.tavily, body.naver);
    return res.status(200).json({ report });
  } catch (err) {
    return sendError(res, err);
  }
};
