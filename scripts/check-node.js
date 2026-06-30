/**
 * Node.js 설치 여부 확인 — npm run dev 실행 전 자동 호출
 */

const MIN_MAJOR = 20;

function parseVersion(version) {
  const match = String(version || "").match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

let major = 0;
try {
  major = parseVersion(process.version);
} catch {
  major = 0;
}

if (major < MIN_MAJOR) {
  console.error("");
  console.error("Node.js가 설치되어 있지 않거나 버전이 너무 낮습니다.");
  console.error(`필요: Node.js ${MIN_MAJOR}+  ·  현재: ${process.version || "없음"}`);
  console.error("");
  console.error("https://nodejs.org/ 에서 LTS 버전을 설치한 뒤 다시 실행하세요.");
  console.error("");
  process.exit(1);
}
