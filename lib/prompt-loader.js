/**
 * prompt/ 폴더의 마크다운 프롬프트 로더
 */

const fs = require("fs");
const path = require("path");

const PROMPT_DIR = path.join(__dirname, "..", "prompt");
const cache = {};

function stripFrontmatter(text) {
  if (text.startsWith("---")) {
    const end = text.indexOf("---", 3);
    if (end !== -1) return text.slice(end + 3).trim();
  }
  return text.trim();
}

function loadPrompt(name) {
  if (cache[name]) return cache[name];

  const filePath = path.join(PROMPT_DIR, `${name}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  cache[name] = stripFrontmatter(raw);
  return cache[name];
}

function renderPrompt(name, variables = {}) {
  let template = loadPrompt(name);
  for (const [key, value] of Object.entries(variables)) {
    template = template.split(`{{${key}}}`).join(value);
  }
  const unresolved = template.match(/\{\{([A-Z_]+)\}\}/g);
  if (unresolved?.length) {
    const missing = [...new Set(unresolved.map((m) => m.slice(2, -2)))].join(", ");
    throw new Error(`Prompt '${name}' has unresolved placeholders: ${missing}`);
  }
  return template.trim();
}

module.exports = { loadPrompt, renderPrompt, PROMPT_DIR };
