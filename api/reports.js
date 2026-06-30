const { listReports } = require("../lib/report-store");
const { setCors, sendError } = require("../lib/api-utils");

module.exports = async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const reports = await listReports();
    return res.status(200).json({ reports });
  } catch (err) {
    return sendError(res, err);
  }
};
