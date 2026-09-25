import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Send, Loader2, ChevronDown, ImagePlus } from 'lucide-react';
import { useConversationChat } from '@/hooks/useConversationChat';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import ImageLightbox from '@/components/chat/ImageLightbox';
import { getImageFileFromClipboard, CHAT_IMAGE_ACCEPT, ChatImageError } from '@/lib/chatImageUtils';

// ─── Avatar helpers ──────────────────────────────────────────────────────────
const UserAvatar = () => (
  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md">
    <span className="text-white text-xs font-bold">U</span>
  </div>
);

const AdminAvatar = () => (
  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 shadow-md">
    <span className="text-white text-xs font-bold">CS</span>
  </div>
);

// ─── Typing Dots ─────────────────────────────────────────────────────────────
const TypingDots = () => (
  <div className="flex items-center gap-1 px-3 py-2">
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce"
        style={{ animationDelay: `${i * 0.15}s` }}
      />
    ))}
  </div>
);

// ─── Message Bubble ───────────────────────────────────────────────────────────
const MessageBubble = ({ msg, isOwn, onImageClick }) => {
  const time = msg.created_at
    ? new Date(msg.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isOwn && <AdminAvatar />}
      <div className={`max-w-[78%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
        {msg.image_url && (
          <button
            type="button"
            onClick={() => onImageClick?.(msg.image_url)}
            className="relative block mb-1 rounded-2xl overflow-hidden border border-white/10 shadow-sm
              max-w-[220px] group"
            title="Bấm để xem ảnh cỡ đầy đủ, sắc nét"
          >
            <img
              src={msg.image_url}
              alt="Hình ảnh đính kèm"
              className={`block w-full max-h-[280px] object-cover transition-opacity ${msg._uploading ? 'opacity-60' : 'group-hover:opacity-90'}`}
              loading="lazy"
            />
            {msg._uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              </div>
            )}
          </button>
        )}
        {msg.message && (
          <div
            className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
              isOwn
                ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-br-sm'
                : 'bg-white/10 text-white rounded-bl-sm border border-white/10'
            }`}
          >
            {msg.message}
          </div>
        )}
        <span className="text-[10px] text-white/35 mt-1 px-1">{time}</span>
      </div>
      {isOwn && <UserAvatar />}
    </div>
  );
};

// ─── Main ChatWidget ──────────────────────────────────────────────────────────
/**
 * ChatWidget — Widget hỗ trợ trực tuyến nổi góc phải màn hình.
 * Dùng useConversationChat để kết nối Supabase Realtime.
 */
export default function ChatWidget({ open, onClose }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const messagesEndRef = useRef(null);
  const scrollAreaRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const { messages, isLoading, adminIsTyping, send, sendImage, isSendingImage, notifyTyping } =
    useConversationChat(user);

  // Gửi 1 file ảnh (dùng chung cho nút đính kèm & thao tác dán clipboard)
  const handleSendImageFile = useCallback(async (file) => {
    if (!file) return;
    try {
      await sendImage(file);
    } catch (err) {
      toast({
        title: 'Không gửi được ảnh',
        description: err instanceof ChatImageError ? err.message : 'Vui lòng thử lại sau.',
        variant: 'destructive',
      });
    }
  }, [sendImage, toast]);

  const handlePickImage = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleSendImageFile(file);
  }, [handleSendImageFile]);

  // Cho phép dán ảnh chụp màn hình trực tiếp (Ctrl+V / Cmd+V) vào ô nhập tin
  // nhắn — hệ thống tự nhận diện ảnh trong clipboard và gửi ngay, không cần
  // lưu file ra máy rồi mới chọn lại.
  const handlePaste = useCallback((e) => {
    const file = getImageFileFromClipboard(e.clipboardData);
    if (file) {
      e.preventDefault();
      handleSendImageFile(file);
    }
  }, [handleSendImageFile]);

  // Scroll xuống cuối khi có tin mới
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, adminIsTyping, open]);

  // Theo dõi scroll để hiện nút "↓"
  const onScroll = () => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 80);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Xử lý input typing
  const handleInputChange = useCallback((e) => {
    setText(e.target.value);
    notifyTyping(true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => notifyTyping(false), 1500);
  }, [notifyTyping]);

  const handleSend = useCallback(async () => {
    if (!text.trim()) return;
    const t = text;
    setText('');
    notifyTyping(false);
    clearTimeout(typingTimeoutRef.current);
    await send(t);
    inputRef.current?.focus();
  }, [text, send, notifyTyping]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Không hiện widget cho admin
  if (!user || user.role === 'admin' || user.role === 'super_admin') return null;

  return (
    <>
      {/* ── Chat Panel ─────────────────────────────────────────── */}
      <div
        className={`fixed bottom-24 right-4 z-[9997]
          w-[360px] max-w-[calc(100vw-2rem)]
          flex flex-col rounded-2xl overflow-hidden
          bg-[#0f1225]/95 backdrop-blur-xl
          border border-white/10 shadow-2xl shadow-black/60
          transition-all duration-300 origin-bottom-right
          ${open
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-90 translate-y-4 pointer-events-none'
          }`}
        style={{ height: '520px' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[#1a1f3c] to-[#141830] border-b border-white/10 shrink-0">
          <div className="relative">
            <AdminAvatar />
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0f1225]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-none">Hỗ trợ 24/7</p>
            <p className="text-emerald-400 text-[11px] mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
              Trực tuyến
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages Area */}
        <div
          ref={scrollAreaRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto px-3 py-4 space-y-3 scroll-smooth"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
        >
          {/* Welcome message */}
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-400/20 flex items-center justify-center">
                <MessageSquare className="w-8 h-8 text-amber-400" />
              </div>
              <div className="text-center">
                <p className="text-white font-semibold text-sm">Xin chào! 👋</p>
                <p className="text-white/50 text-xs mt-1 leading-relaxed">
                  Đội ngũ CSKH của chúng tôi luôn sẵn sàng hỗ trợ bạn 24/7.
                  Hãy gửi tin nhắn để bắt đầu!
                </p>
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => {
            const isOwn = msg.sender_role === 'user';
            return <MessageBubble key={msg.id} msg={msg} isOwn={isOwn} onImageClick={setLightboxSrc} />;
          })}

          {/* Admin typing indicator */}
          {adminIsTyping && (
            <div className="flex items-end gap-2">
              <AdminAvatar />
              <div className="bg-white/10 border border-white/10 rounded-2xl rounded-bl-sm shadow-sm">
                <TypingDots />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-20 right-4 w-8 h-8 rounded-full
              bg-white/15 backdrop-blur border border-white/10
              flex items-center justify-center text-white/70
              hover:bg-white/25 transition-colors shadow-lg"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}

        {/* Input Area */}
        <div className="px-3 py-3 border-t border-white/10 shrink-0 bg-[#0f1225]/50 backdrop-blur-sm">
          <div className="flex items-end gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2
            focus-within:border-amber-400/50 focus-within:ring-1 focus-within:ring-amber-400/20 transition-all">
            <input
              ref={fileInputRef}
              type="file"
              accept={CHAT_IMAGE_ACCEPT}
              className="hidden"
              onChange={handlePickImage}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSendingImage}
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mb-0.5
                text-white/50 hover:text-amber-400 hover:bg-white/5 transition-colors disabled:opacity-40"
              title="Gửi hình ảnh"
            >
              {isSendingImage
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ImagePlus className="w-4 h-4" />}
            </button>
            <textarea
              ref={inputRef}
              id="chat-widget-input"
              value={text}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              placeholder="Nhập tin nhắn hoặc dán ảnh (Ctrl+V)..."
              className="flex-1 bg-transparent text-white text-sm placeholder:text-white/35
                resize-none outline-none min-h-[24px] max-h-24 leading-6"
              style={{ fieldSizing: 'content' }}
            />
            <button
              id="chat-widget-send"
              onClick={handleSend}
              disabled={!text.trim()}
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                bg-gradient-to-br from-amber-400 to-orange-500
                text-white disabled:opacity-40 disabled:cursor-not-allowed
                hover:opacity-90 active:scale-95 transition-all shadow-md"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-white/25 text-center mt-1.5">
            Shift+Enter để xuống dòng · Dán (Ctrl+V) hoặc bấm 🖼️ để gửi ảnh
          </p>
        </div>
      </div>

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  );
}
