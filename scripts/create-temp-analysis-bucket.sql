-- Supabase SQL Editor에서 1회 실행
-- 대용량 파일 분석용 임시 Storage 버킷

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('temp-analysis', 'temp-analysis', false, 52428800)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;
