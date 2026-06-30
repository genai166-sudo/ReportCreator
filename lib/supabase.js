const { createClient } = require("@supabase/supabase-js");

let client = null;

function getEnvKey(name) {
  const raw = process.env[name] || "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

function getSupabaseClient() {
  if (client) return client;

  const url = getEnvKey("SUPABASE_URL");
  const key = getEnvKey("SUPABASE_SECRET_KEY") || getEnvKey("SUPABASE_PUBLIC_KEY");

  if (!url || !key) {
    const err = new Error("SUPABASE_URL / SUPABASE_SECRET_KEY is not configured on the server");
    err.status = 500;
    throw err;
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}

function isSupabaseConfigured() {
  const url = getEnvKey("SUPABASE_URL");
  const key = getEnvKey("SUPABASE_SECRET_KEY") || getEnvKey("SUPABASE_PUBLIC_KEY");
  return Boolean(url && key);
}

module.exports = { getSupabaseClient, isSupabaseConfigured, getEnvKey };
