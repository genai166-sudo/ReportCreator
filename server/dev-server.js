/**
 * 로컬 개발 서버 — Vercel catch-all API 라우터와 동일 경로
 * 실행: npm run dev:node
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { handler, ROUTES } = require("../lib/api-router");
const { readRawBody } = require("../lib/parse-upload");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) reject(Object.assign(new Error("Payload too large"), { status: 413 }));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function createVercelResponse(res) {
  return {
    status(code) {
      this._status = code;
      return this;
    },
    setHeader(key, value) {
      res.setHeader(key, value);
      return this;
    },
    json(data) {
      if (!res.headersSent) {
        res.writeHead(this._status || 200, { "Content-Type": "application/json; charset=utf-8" });
      }
      res.end(JSON.stringify(data));
    },
    send(data) {
      if (!res.headersSent) {
        res.writeHead(this._status || 200);
      }
      res.end(data);
    },
    end(data) {
      if (data !== undefined) {
        if (!res.headersSent) {
          res.writeHead(this._status || 200);
        }
        res.end(data);
        return;
      }
      if (!res.headersSent) {
        res.writeHead(this._status || 204);
      }
      res.end();
    },
  };
}

async function dispatchApi(req, res, pathname, searchParams) {
  const segments = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const query = Object.fromEntries(searchParams.entries());
  query.slug = segments;

  const vercelReq = {
    method: req.method,
    url: req.url,
    query,
    headers: req.headers,
    body: {},
  };

  try {
    if (segments.join("/") === "analyze-file" && req.method === "POST") {
      vercelReq.rawBody = await readRawBody(req);
    } else if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      vercelReq.body = await readJsonBody(req);
    }

    await handler(vercelReq, createVercelResponse(res));
  } catch (err) {
    res.writeHead(err.status || 500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function serveStatic(req, res, pathname) {
  const urlPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, urlPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(parsed.pathname);

  if (pathname.startsWith("/api/")) {
    await dispatchApi(req, res, pathname, parsed.searchParams);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res, pathname);
    return;
  }

  res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Method not allowed" }));
});

server.listen(PORT, () => {
  console.log(`Archive: http://localhost:${PORT}`);
  console.log("API routes (single function):");
  for (const route of Object.keys(ROUTES).sort()) {
    console.log(`  /api/${route}`);
  }

  const warnings = [];
  if (!process.env.TAVILY_API_KEY) warnings.push("TAVILY_API_KEY");
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    warnings.push("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET");
  }
  if (!process.env.GEMINI_API_KEY) warnings.push("GEMINI_API_KEY");
  if (warnings.length) {
    console.warn(`⚠ 미설정: ${warnings.join(", ")} — .env.example 참고 후 .env 에 등록하세요`);
  }
});
