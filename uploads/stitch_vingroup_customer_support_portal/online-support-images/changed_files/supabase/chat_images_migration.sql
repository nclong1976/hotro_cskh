-- ====================================================================
-- LIVE CHAT CSKH — MIGRATION v3: HỖ TRỢ GỬI HÌNH ẢNH
-- Chạy file này trong Supabase SQL Editor sau khi đã chạy schema.sql
-- và chat_migration.sql (v2).
--
-- Cho phép người chơi (và Admin) gửi hình ảnh trong khung chat hỗ trợ
-- trực tuyến. Ảnh được tải lên Supabase Storage (bucket "app-assets",
-- thư mục "chat/") và chỉ lưu URL công khai vào bảng chat_messages —
-- không lưu base64 trong DB để tránh phình dung lượng và để ảnh luôn
-- đồng bộ real-time, đúng kích thước gốc, sắc nét trên mọi thiết bị.
-- ====================================================================

-- 1. THÊM CỘT LƯU ẢNH ĐÍNH KÈM (backward-compatible — nullable)
ALTER TABLE public.chat_messages
    ADD COLUMN IF NOT EXISTS image_url TEXT,
    ADD COLUMN IF NOT EXISTS image_width INTEGER,
    ADD COLUMN IF NOT EXISTS image_height INTEGER;

-- Cho phép message rỗng khi tin nhắn chỉ có ảnh (không có chữ đi kèm)
ALTER TABLE public.chat_messages ALTER COLUMN message SET DEFAULT '';

-- 2. INDEX phụ trợ lọc nhanh các tin nhắn có ảnh (vd thống kê, kiểm duyệt)
CREATE INDEX IF NOT EXISTS idx_chat_messages_has_image
    ON public.chat_messages ((image_url IS NOT NULL))
    WHERE image_url IS NOT NULL;

-- 3. LƯU Ý VỀ SUPABASE STORAGE
-- Bucket "app-assets" đã được dùng sẵn cho banner (folder "banners/").
-- Ảnh chat sẽ được tải lên cùng bucket này ở thư mục "chat/".
-- Đảm bảo bucket "app-assets" đang ở chế độ PUBLIC (Storage → app-assets →
-- Settings → Public bucket = ON) để getPublicUrl() trả về link xem được
-- trực tiếp trên trình duyệt, không cần ký token.
--
-- Nếu bucket chưa tồn tại, tạo bằng lệnh sau (chạy 1 lần, bỏ qua nếu đã có):
--
--   insert into storage.buckets (id, name, public)
--   values ('app-assets', 'app-assets', true)
--   on conflict (id) do nothing;
--
-- Và cho phép public đọc + người dùng đã đăng nhập (hoặc ẩn danh, tuỳ app)
-- tải ảnh lên thư mục chat/:
--
--   DROP POLICY IF EXISTS "Public read app-assets" ON storage.objects;
--   CREATE POLICY "Public read app-assets"
--     ON storage.objects FOR SELECT
--     USING (bucket_id = 'app-assets');
--
--   DROP POLICY IF EXISTS "Public upload app-assets" ON storage.objects;
--   CREATE POLICY "Public upload app-assets"
--     ON storage.objects FOR INSERT
--     WITH CHECK (bucket_id = 'app-assets');
