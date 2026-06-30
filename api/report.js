const { getReportById } = require("../lib/report-store");
const { setCors, sendError } = require("../lib/api-utils");

module.exports = async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const id = req.query?.id;
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }
    const report = await getReportById(id);
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }
    return res.status(200).json({ report });
  } catch (err) {
    return sendError(res, err);
  }
};
