const {
  exchangeCodeForToken,
  saveRefreshToken,
  isServerless,
  canPersistTokenFile,
  getRedirectUri,
} = require("../../../lib/kakao-proxy");

function queryParams(req) {
  return { ...(req.query || {}) };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const q = queryParams(req);
  if (q.error) {
    return res.status(400).send(`<h1>카카오 로그인 실패</h1><p>${q.error}</p>`);
  }
  if (!q.code) {
    return res.status(400).json({ error: "code is required" });
  }

  try {
    const tokens = await exchangeCodeForToken(q.code);
    const saved = tokens.refresh_token ? saveRefreshToken(tokens.refresh_token) : false;
    const onVercel = isServerless();

    const tokenBlock = tokens.refresh_token
      ? onVercel || !saved
        ? `<p><strong>Vercel:</strong> 아래 Refresh Token을 Vercel Environment Variables에 등록한 뒤 재배포하세요.</p>
<pre><code>KAKAO_REFRESH_TOKEN=${tokens.refresh_token}</code></pre>`
        : `<p>Refresh Token이 <code>.data/kakao-token.json</code> 에 저장되었습니다.</p>
<p>배포 시에는 Environment Variables에도 동일 값을 넣으세요:</p>
<pre><code>KAKAO_REFRESH_TOKEN=${tokens.refresh_token}</code></pre>`
      : `<p>Refresh Token이 없습니다. 동의 항목 <code>talk_message</code> 확인 후 다시 로그인하세요.</p>`;

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"/><title>카카오 연동 완료</title>
<style>body{font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:2rem;max-width:640px;margin:auto}
code,pre{background:#1a2a3d;padding:2px 6px;border-radius:4px;word-break:break-all}
a{color:#58a6ff}</style></head><body>
<h1>카카오톡 연동 완료</h1>
<p>OAuth 인증이 완료되었습니다. 이제 리서치 보고서가 카카오톡으로 전송됩니다.</p>
${tokenBlock}
<p>Redirect URI: <code>${getRedirectUri()}</code></p>
<p><a href="/">아카이브로 돌아가기</a></p></body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    return res.status(err.status || 500).send(`<h1>토큰 발급 실패</h1><p>${err.message}</p>`);
  }
};
