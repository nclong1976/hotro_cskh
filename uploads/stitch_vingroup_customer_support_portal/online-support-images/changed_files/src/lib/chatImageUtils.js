// ─── chatImageUtils ───────────────────────────────────────────────────────
// Tiện ích xử lý ảnh cho khung Hỗ Trợ Trực Tuyến: nhận ảnh từ input file
// hoặc từ thao tác dán (Ctrl+V / Cmd+V), tự động chuẩn hoá chiều xoay
// (EXIF), và chỉ nén lại khi ảnh thực sự quá khổ — nếu không, giữ nguyên
// file gốc để hình luôn hiển thị TO và SẮC NÉT khi người dùng bấm xem
// toàn màn hình (không bị mờ do nén lại nhiều lần).

// Kích thước cạnh dài tối đa sau xử lý — đủ lớn để xem rõ chi tiết (vd
// biên lai chuyển khoản, ảnh chụp lỗi game) nhưng không quá nặng khi tải lên.
const MAX_DIMENSION = 2560;

// Ảnh gốc nhỏ hơn ngưỡng này thì giữ nguyên, không xử lý lại (tránh nén
// thêm một lần nữa làm giảm độ nét so với bản gốc người dùng gửi).
const SKIP_REPROCESS_BYTES = 6 * 1024 * 1024; // 6MB

// Giới hạn dung lượng file gốc được chấp nhận.
export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024; // 20MB

export const CHAT_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif";

export class ChatImageError extends Error {}

/** Đọc kích thước + dữ liệu ảnh bằng <img>, tự áp dụng xoay theo EXIF của trình duyệt. */
function loadImageElement(objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ChatImageError("Không thể đọc được tệp ảnh này."));
    img.src = objectUrl;
  });
}

async function loadBitmap(file) {
  if (typeof window !== "undefined" && "createImageBitmap" in window) {
    try {
      // imageOrientation: 'from-image' tự xoay đúng chiều theo EXIF, tránh
      // ảnh chụp từ điện thoại bị nằm ngang khi hiển thị trong chat.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // rơi xuống fallback bên dưới nếu trình duyệt/định dạng không hỗ trợ
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    return img;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getDims(source) {
  return {
    width: source.naturalWidth || source.width,
    height: source.naturalHeight || source.height,
  };
}

/**
 * Chuẩn bị 1 file ảnh để gửi trong chat hỗ trợ trực tuyến.
 * - Ảnh vượt quá MAX_DIMENSION: resize về đúng cạnh dài tối đa, giữ chất
 *   lượng cao (không làm ảnh bị vỡ/mờ khi nhìn to trên Lightbox).
 * - Ảnh vừa vặn & không quá nặng: giữ nguyên file gốc — "sắc nét" tuyệt đối.
 * Trả về { file, width, height } sẵn sàng để upload lên Supabase Storage.
 */
export async function prepareChatImage(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    throw new ChatImageError("Chỉ có thể gửi tệp hình ảnh (PNG, JPG, WEBP, GIF).");
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new ChatImageError("Ảnh quá lớn (tối đa 20MB). Vui lòng chọn ảnh nhỏ hơn.");
  }

  const source = await loadBitmap(file);
  const { width, height } = getDims(source);
  if (source.close) source.close(); // giải phóng ImageBitmap nếu có

  const longEdge = Math.max(width, height);
  const needsResize = longEdge > MAX_DIMENSION;
  const canKeepOriginal = !needsResize && file.size <= SKIP_REPROCESS_BYTES;

  if (canKeepOriginal) {
    return { file, width, height };
  }

  // Vẽ lại qua canvas ở độ phân giải tối ưu, dùng smoothing chất lượng cao
  // để ảnh "giải nén" ra vẫn to và sắc nét thay vì bị răng cưa/mờ.
  const scale = needsResize ? MAX_DIMENSION / longEdge : 1;
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const drawSource = await loadBitmap(file);
  ctx.drawImage(drawSource, 0, 0, targetW, targetH);
  if (drawSource.close) drawSource.close();

  // Giữ định dạng PNG cho ảnh chụp màn hình (nhiều chữ/đường thẳng cần nét
  // căng, PNG không nén mất dữ liệu); ảnh JPEG/khác xuất lại chất lượng cao.
  const isPng = file.type === "image/png";
  const outputType = isPng ? "image/png" : "image/jpeg";
  const quality = isPng ? undefined : 0.95;

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ChatImageError("Không thể xử lý ảnh."))),
      outputType,
      quality
    );
  });

  const ext = isPng ? "png" : "jpg";
  const outFile = new File([blob], renameForOutput(file.name, ext), { type: outputType });

  return { file: outFile, width: targetW, height: targetH };
}

function renameForOutput(originalName, ext) {
  const base = (originalName || "image").replace(/\.[a-z0-9]+$/i, "");
  return `${base}.${ext}`;
}

/**
 * Lấy file ảnh đầu tiên từ 1 sự kiện paste (Ctrl+V / Cmd+V), nếu có.
 * Trả về null nếu clipboard không chứa ảnh (vd người dùng dán chữ thường).
 */
export function getImageFileFromClipboard(clipboardData) {
  if (!clipboardData || !clipboardData.items) return null;
  for (const item of clipboardData.items) {
    if (item.kind === "file" && item.type && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        // Ảnh dán từ clipboard thường không có tên — đặt tên có timestamp
        // để dễ phân biệt khi xử lý phía server/lưu trữ.
        const ext = (item.type.split("/")[1] || "png").replace("jpeg", "jpg");
        return new File([file], `paste_${Date.now()}.${ext}`, { type: item.type });
      }
    }
  }
  return null;
}
