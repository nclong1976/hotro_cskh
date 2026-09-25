import React, { useEffect } from 'react';
import { X, Download } from 'lucide-react';

/**
 * ImageLightbox — Xem ảnh đính kèm chat ở kích thước TO và SẮC NÉT (ảnh gốc,
 * không bị nén/scale bởi bong bóng chat nhỏ). Đóng bằng nút X, click nền
 * đen, hoặc phím Esc.
 */
export default function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    if (!src) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    // Khoá scroll nền trong lúc xem ảnh toàn màn hình
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20
          flex items-center justify-center text-white transition-colors z-10"
        aria-label="Đóng"
      >
        <X className="w-5 h-5" />
      </button>

      <a
        href={src}
        download
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute top-4 right-16 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20
          flex items-center justify-center text-white transition-colors z-10"
        aria-label="Tải ảnh gốc"
        title="Tải ảnh gốc"
      >
        <Download className="w-4.5 h-4.5" />
      </a>

      <img
        src={src}
        alt="Ảnh đính kèm — xem đầy đủ"
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl select-none"
        draggable={false}
      />
    </div>
  );
}
