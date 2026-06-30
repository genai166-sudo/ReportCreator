const { analyzeFileBuffer } = require("../lib/gemini-files");
const { parseUploadRequest } = require("../lib/parse-upload");
const { setCors, sendError } = require("../lib/api-utils");

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const upload = await parseUploadRequest(req);
    const result = await analyzeFileBuffer({
      buffer: upload.buffer,
      mimeType: upload.mimeType,
      fileName: upload.fileName,
      prompt: upload.prompt,
    });

    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
