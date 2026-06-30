/**
 * 로컬 개발 시작
 * - Vercel 로그인되어 있으면 vercel dev (배포와 동일 Serverless 런타임)
 * - 없으면 dev-server (동일 api/*.js 핸들러 + .env)
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || "3000";
const VERCEL_BIN = path.join(ROOT, "node_modules", "vercel", "dist", "index.js");

function hasEnvFile() {
  return fs.existsSync(path.join(ROOT, ".env"));
}

function isVercelLoggedIn() {
  if (!fs.existsSync(VERCEL_BIN)) return false;

  const result = spawnSync(process.execPath, [VERCEL_BIN, "whoami"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

function runNode(scriptRelative) {
  const script = path.join(ROOT, scriptRelative);
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function runVercelDev() {
  const child = spawn(process.execPath, [VERCEL_BIN, "dev", "--listen", PORT], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function main() {
  if (!hasEnvFile()) {
    console.warn("");
    console.warn("⚠ .env 파일이 없습니다.");
    console.warn("  copy .env.example .env  후 API 키를 입력하세요.");
    console.warn("");
  }

  const forceVercel = process.argv.includes("--vercel");
  const forceNode = process.argv.includes("--node");

  if (forceNode) {
    console.log("→ Node dev-server (npm run dev:node)");
    runNode("server/dev-server.js");
    return;
  }

  if (forceVercel || isVercelLoggedIn()) {
    if (forceVercel && !isVercelLoggedIn()) {
      console.error("");
      console.error("Vercel에 로그인되어 있지 않습니다.");
      console.error("  npx vercel login");
      console.error("");
      console.error("또는 로그인 없이 테스트:");
      console.error("  npm run dev:node");
      console.error("");
      process.exit(1);
    }

    console.log(`→ Vercel dev (http://localhost:${PORT}) — 배포와 동일 환경`);
    runVercelDev();
    return;
  }

  console.log("");
  console.log("Vercel 로그인 없음 → Node dev-server로 시작합니다.");
  console.log("  (동일 api/*.js 핸들러 · .env 자동 로드)");
  console.log("");
  console.log("배포와 100% 동일 환경이 필요하면:");
  console.log("  npx vercel login");
  console.log("  npm run dev:vercel");
  console.log("");
  runNode("server/dev-server.js");
}

main();
