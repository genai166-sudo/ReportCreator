/**
 * 로컬 개발 서버 (대안) — Vercel CLI 없이 빠르게 테스트할 때
 * Vercel과 동일 환경: npm run dev  (vercel dev)
 *
 * 실행: npm run dev:node
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { readRawBody } = require("../lib/parse-upload");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const API_DIR = path.join(ROOT, "api");

// api 폴더 하위 .js 파일을 /api/... 경로에 자동 등록
function loadApiHandlers(dir = API_DIR, routePrefix = "/api") {
  const handlers = {};
  if (!fs.existsSync(dir)) return handlers;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(handlers, loadApiHandlers(fullPath, `${routePrefix}/${entry.name}`));
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const route = `${routePrefix}/${entry.name.replace(/\.js$/, "")}`;
    try {
      handlers[route] = require(fullPath);
    } catch (err) {
      console.error(`Failed to load API route ${route}:`, err.message);
    }
  }

  return handlers;
}

const apiHandlers = loadApiHandlers();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function toVercelRequest(req, body, query = {}) {
  return {
    method: req.method,
    url: req.url,
    query,
    body,
  };
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
  const query = Object.fromEntries(searchParams.entries());
  let body = {};

  if (pathname === "/api/analyze-file" && req.method === "POST") {
    try {
      const rawBody = await readRawBody(req);
      body = { __rawBody: rawBody };
      const vercelReq = Object.assign({}, toVercelRequest(req, body, query), {
        rawBody,
        headers: req.headers,
      });
      const vercelRes = createVercelResponse(res);
      await apiHandlers[pathname](vercelReq, vercelRes);
      return;
    } catch (err) {
      res.writeHead(err.status || 400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  if (req.method === "POST") {
    try {
      body = await readBody(req);
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  const vercelReq = toVercelRequest(req, body, query);
  const vercelRes = createVercelResponse(res);

  const handler = apiHandlers[pathname];
  if (handler) {
    await handler(vercelReq, vercelRes);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not Found", path: pathname }));
}

function serveStatic(req, res, pathname) {
  let urlPath = pathname === "/" ? "/index.html" : pathname;
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
  console.log("API routes:");
  for (const route of Object.keys(apiHandlers).sort()) {
    console.log(`  ${route}`);
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
