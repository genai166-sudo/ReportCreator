const { getSupabaseClient } = require("./supabase");

function bodyAsMarkdown(body) {
  return String(body || "").trim();
}

async function saveReport({ topic, title, summary, content, sources, source_type = "search" }) {
  const supabase = getSupabaseClient();

  const row = {
    topic: String(topic || "").trim(),
    title: String(title || "").trim(),
    summary: String(summary || "").trim() || null,
    content: bodyAsMarkdown(content) || null,
    sources: String(sources || "").trim() || null,
    source_type,
  };

  if (!row.topic || !row.title) {
    const err = new Error("topic and title are required to save a report");
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from("reports")
    .insert(row)
    .select("id, topic, title, summary, content, sources, source_type, created_at")
    .single();

  if (error) {
    const err = new Error(error.message || "Failed to save report");
    err.status = 502;
    throw err;
  }

  return data;
}

async function listReports(limit = 50) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("reports")
    .select("id, topic, title, summary, source_type, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    const err = new Error(error.message || "Failed to load reports");
    err.status = 502;
    throw err;
  }

  return data || [];
}

module.exports = { saveReport, listReports, bodyAsMarkdown };
