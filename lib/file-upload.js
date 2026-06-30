const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { getSupabaseClient, isSupabaseConfigured } = require("./supabase");

const STORAGE_BUCKET = "temp-analysis";
const VERCEL_SAFE_BYTES = 3.5 * 1024 * 1024;

function safeFileName(name) {
  return String(name || "upload").replace(/[^\w.\-()가-힣]/g, "_").slice(0, 120);
}

function randomStoragePath(fileName) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `analysis/${id}/${safeFileName(fileName)}`;
}

async function createTempUploadTarget(fileName) {
  if (!isSupabaseConfigured()) {
    const err = new Error("대용량 파일 업로드를 위해 Supabase Storage 설정이 필요합니다.");
    err.status = 500;
    throw err;
  }

  const supabase = getSupabaseClient();
  const storagePath = randomStoragePath(fileName);

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });

  if (error) {
    const msg = String(error.message || "");
    const err = new Error(
      msg.includes("Bucket not found") || msg.includes("related resource does not exist")
        ? `Storage bucket '${STORAGE_BUCKET}' not found — Supabase 대시보드에서 버킷을 생성하세요.`
        : msg || "Failed to create signed upload URL"
    );
    err.status = 502;
    throw err;
  }

  return {
    storagePath,
    bucket: STORAGE_BUCKET,
    signedUrl: data.signedUrl,
    token: data.token,
    maxBytes: 50 * 1024 * 1024,
  };
}

async function downloadStorageFile(storagePath) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath);

  if (error || !data) {
    const err = new Error(error?.message || "Uploaded file not found in storage");
    err.status = 404;
    throw err;
  }

  return Buffer.from(await data.arrayBuffer());
}

async function deleteStorageFile(storagePath) {
  if (!storagePath) return;
  try {
    const supabase = getSupabaseClient();
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
  } catch {
    // ignore cleanup errors
  }
}

async function uploadBufferWithSdk(buffer, mimeType, displayName, apiKey) {
  const fileManager = new GoogleAIFileManager(apiKey);
  const upload = await fileManager.uploadFile(buffer, {
    mimeType,
    displayName: displayName || "upload",
  });
  return upload.file;
}

module.exports = {
  STORAGE_BUCKET,
  VERCEL_SAFE_BYTES,
  createTempUploadTarget,
  downloadStorageFile,
  deleteStorageFile,
  uploadBufferWithSdk,
  safeFileName,
};
