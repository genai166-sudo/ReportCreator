const { tavilySearch } = require("../lib/tavily-proxy");
const { parseBody, setCors, sendError } = require("../lib/api-utils");

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const data = await tavilySearch(parseBody(req));
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err);
  }
};
