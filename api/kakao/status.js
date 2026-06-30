const { isKakaoConfigured, getRestApiKey, getLoginUrl } = require("../../lib/kakao-proxy");
const { setCors } = require("../../lib/api-utils");

module.exports = async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    configured: isKakaoConfigured(),
    hasAppKey: Boolean(getRestApiKey()),
    hasRefreshToken: isKakaoConfigured(),
    loginUrl: getLoginUrl(),
  });
};
