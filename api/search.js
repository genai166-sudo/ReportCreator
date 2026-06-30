const { naverNewsSearch } = require("../lib/naver-proxy");
const { parseBody, setCors, sendError } = require("../lib/api-utils");

function queryParams(req) {
  return { ...(req.query || {}) };
}

module.exports = async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const params = req.method === "GET" ? queryParams(req) : parseBody(req);
    const data = await naverNewsSearch(params);
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err);
  }
};
