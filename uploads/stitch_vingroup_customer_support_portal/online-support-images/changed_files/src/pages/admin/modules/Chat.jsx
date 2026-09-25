import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Search, Ghost, Trash2, MessageSquare,
  Loader2, RefreshCw, CheckCheck, Clock, ChevronDown, ImagePlus
} from 'lucide-react';
import { Panel, inputCls } from '../ui';
import { useAuth } from '@/lib/AuthContext';
import { useAdminChat } from '@/hooks/useAdminChat';
import { deleteChatMessage } from '@/lib/localChat';
import { useToast } from '@/components/ui/use-toast';
import ImageLightbox from '@/components/chat/ImageLightbox';
import { getImageFileFromClipboard, CHAT_IMAGE_ACCEPT, ChatImageError } from '@/lib/chatImageUtils';

// ─── Avatar ──────────────────────────────────────────────────────────────────
const Avatar = ({ name, role }) => {
  const isAdmin = role === 'admin' || role === 'super_admin';
  const letter = (name || 'U').charAt(0).toUpperCase();
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold shadow
      ${isAdmin
        ? 'bg-gradient-to-br from-amber-400 to-orange-500'
        : 'bg-gradient-to-br from-indigo-500 to-purple-600'
      }`}
    >
      {letter}
    </div>
  );
};

// ─── Typing dots ──────────────────────────────────────────────────────────────
const TypingDots = ({ label = 'đang gõ...' }) => (
  <div className="flex items-center gap-1.5 px-3 py-1.5">
    {[0, 1, 2].map((i) => (
      <span key={i} className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce"
        style={{ animationDelay: `${i * 0.15}s` }} />
    ))}
    <span className="text-[10px] text-white/40 ml-1">{label}</span>
  </div>
);

// ─── Message bubble ───────────────────────────────────────────────────────────
const MessageBubble = ({ msg, isFromAdmin, onDelete, canDelete, onImageClick }) => {
  const time = msg.created_at
    ? new Date(msg.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : '';
  const isRead = isFromAdmin ? msg.read_by_user : msg.read_by_admin;

  return (
    <div className={`group flex items-end gap-2 ${isFromAdmin ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Delete btn for super_admin */}
      {canDelete && (
        <button
          onClick={() => onDelete(msg.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg
            text-rose-400 hover:bg-rose-500/20 shrink-0 mb-1"
          title="Xóa tin nhắn"
        >
          <Trash2 size={13} />
        </button>
      )}

      <Avatar name={msg.username} role={msg.sender_role} />

      <div className={`max-w-[72%] flex flex-col ${isFromAdmin ? 'items-end' : 'items-start'}`}>
        {msg.image_url && (
          <button
            type="button"
            onClick={() => onImageClick?.(msg.image_url)}
            className="relative block mb-1 rounded-2xl overflow-hidden border border-white/10 shadow-sm
              max-w-[240px] group/img"
            title="Bấm để xem ảnh cỡ đầy đủ, sắc nét"
          >
            <img
              src={msg.image_url}
              alt="Hình ảnh đính kèm"
              className={`block w-full max-h-[300px] object-cover transition-opacity ${msg._uploading ? 'opacity-60' : 'group-hover/img:opacity-90'}`}
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
          <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm
            ${isFromAdmin
              ? 'bg-gradient-to-br from-[#7033ff] to-[#4b00ff] text-white rounded-br-sm'
              : 'bg-white/10 text-white rounded-bl-sm border border-white/10'
            }`}
          >
            {msg.message}
          </div>
        )}
        <div className={`flex items-center gap-1 mt-0.5 px-1 ${isFromAdmin ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px] text-white/35">{time}</span>
          {isFromAdmin && (
            isRead
              ? <CheckCheck size={12} className="text-indigo-400" title="Đã đọc" />
              : <CheckCheck size={12} className="text-white/25" title="Chưa đọc" />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Conversation Item ────────────────────────────────────────────────────────
const ConvItem = ({ conv, isActive, onClick }) => {
  const profile = conv.users_profile || {};
  const displayName = profile.full_name || profile.account || conv.user_id;
  const unread = conv.unread_admin || 0;
  const lastTime = conv.last_message_at
    ? new Date(conv.last_message_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 border-b border-white/5
        hover:bg-white/5 transition-colors flex items-start gap-2.5
        ${isActive ? 'bg-white/10 border-l-2 border-l-[#7033ff]' : ''}`}
    >
      <Avatar name={displayName} role="user" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <p className="text-sm font-medium text-white truncate">{displayName}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-white/35">{lastTime}</span>
            {unread > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center
                text-[10px] font-bold text-white bg-red-500 rounded-full">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
        </div>
        <p className="text-[11px] text-white/40 truncate">{conv.last_message_body || 'Chưa có tin nhắn'}</p>
      </div>
    </button>
  );
};

// ─── Quick Templates ──────────────────────────────────────────────────────────
const QUICK_TEMPLATES = [
  {
    label: '👋 Chào CSKH',
    text: 'Xin chào quý khách! CSKH 24/7 hân hạnh được phục vụ bạn. Bạn cần hỗ trợ về vấn đề gì ạ?',
  },
  {
    label: '🎁 Khuyến Mãi',
    text: `Xin chào! 👋\n\nTrân trọng gửi đến bạn chương trình "KHUYẾN MÃI TRI ÁN ĐẶC BIỆT" từ Marina Bay Sands MBS!\n⏰ Thời gian: 01/08/2026 - 31/08/2026\n\n🎁 NỘI DUNG:\n• Nạp 3,000$ → Nhận 288$\n• Nạp 5,000$ → Nhận 388$\n• Nạp 10,000$ → Nhận 888$\n• Nạp 50,000$ → Nhận 3,888$`,
  },
  {
    label: '💳 Hướng Dẫn Nạp',
    text: 'Để nạp tiền nhanh chóng, quý khách vào mục Nạp Tiền → Chọn Ngân hàng/Crypto USDT → Chuyển khoản theo mã QR. Tiền vào tài khoản tự động trong 1–3 phút!',
  },
  {
    label: '💸 Hướng Dẫn Rút',
    text: 'Để rút tiền, bạn vào mục Rút Tiền → Điền số tiền & thông tin Ngân hàng chính chủ → Bấm Xác nhận. Admin sẽ duyệt trong ít phút.',
  },
];

// ─── Main Chat Module ─────────────────────────────────────────────────────────
export default function Chat() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'super_admin';

  const {
    conversations,
    activeConvId,
    activeConversation,
    setActiveConvId,
    messages,
    userIsTyping,
    isLoadingConvs,
    isLoadingMsgs,
    sendReply,
    sendReplyImage,
    isSendingImage,
    notifyTyping,
    totalUnread,
    refreshConversations,
  } = useAdminChat();

  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const messagesEndRef = useRef(null);
  const scrollAreaRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Gửi ảnh đính kèm cho khách hàng (dùng chung cho nút đính kèm & dán clipboard)
  const handleSendImageFile = useCallback(async (file) => {
    if (!file || !activeConvId) return;
    try {
      await sendReplyImage(file, currentUser);
    } catch (err) {
      toast({
        title: 'Không gửi được ảnh',
        description: err instanceof ChatImageError ? err.message : 'Vui lòng thử lại sau.',
        variant: 'destructive',
      });
    }
  }, [sendReplyImage, currentUser, activeConvId, toast]);

  const handlePickImage = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleSendImageFile(file);
  }, [handleSendImageFile]);

  const handlePaste = useCallback((e) => {
    const file = getImageFileFromClipboard(e.clipboardData);
    if (file) {
      e.preventDefault();
      handleSendImageFile(file);
    }
  }, [handleSendImageFile]);

  // Scroll cuối khi có tin mới
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, userIsTyping]);

  const onScroll = () => {
    const el = scrollAreaRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
  };

  // Chọn conversation
  const handleSelectConv = useCallback((convId) => {
    setActiveConvId(convId, currentUser?.role);
  }, [setActiveConvId, currentUser?.role]);

  // Gửi tin nhắn
  const handleSend = useCallback(async () => {
    if (!text.trim() || !activeConvId) return;
    const t = text;
    setText('');
    notifyTyping(false, currentUser);
    clearTimeout(typingTimeoutRef.current);
    await sendReply(t, currentUser);
    inputRef.current?.focus();
  }, [text, activeConvId, sendReply, notifyTyping, currentUser]);

  // Typing
  const handleInputChange = (e) => {
    setText(e.target.value);
    notifyTyping(true, currentUser);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => notifyTyping(false, currentUser), 1500);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Xóa tin nhắn (Super Admin)
  const handleDeleteMessage = (msgId) => {
    if (!isSuperAdmin) return;
    deleteChatMessage(msgId);
    toast({ title: 'Đã xóa tin nhắn', description: 'Super Admin đã thu hồi tin nhắn.' });
  };

  // Quick template
  const sendTemplate = (templateText) => {
    if (!activeConvId) return;
    sendReply(templateText, currentUser);
  };

  // Lọc conversations theo search
  const filtered = conversations.filter((c) => {
    if (!q) return true;
    const profile = c.users_profile || {};
    const name = (profile.full_name || profile.account || '').toLowerCase();
    return name.includes(q.toLowerCase());
  });

  const activeProfile = activeConversation?.users_profile || {};
  const activeName = activeProfile.full_name || activeProfile.account || activeConvId;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#ffab40]" />
            Chăm Sóc Khách Hàng — Live Chat
            {isSuperAdmin && (
              <span className="bg-[#7033ff]/20 text-[#ebd39a] border border-[#7033ff]/50 text-xs px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <Ghost size={13} /> Super Admin
              </span>
            )}
            {totalUnread > 0 && (
              <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center text-xs font-bold text-white bg-red-500 rounded-full animate-pulse">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </h1>
          <p className="text-xs text-white/50 mt-0.5">
            Realtime qua Supabase — Hội thoại 1-1 với từng khách hàng
          </p>
        </div>
        <button
          onClick={refreshConversations}
          className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          title="Tải lại"
        >
          <RefreshCw size={15} className={isLoadingConvs ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 2-Column Layout */}
      <div className="grid lg:grid-cols-3 gap-4 h-[calc(100dvh-180px)] min-h-[480px]">

        {/* ── LEFT: Conversations List ────────────────────────── */}
        <Panel className="lg:col-span-1 overflow-hidden flex flex-col">
          {/* Search */}
          <div className="p-2.5 border-b border-white/10 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                className={`${inputCls} pl-8`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm khách hàng…"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {isLoadingConvs && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
              </div>
            )}

            {!isLoadingConvs && filtered.length === 0 && (
              <div className="px-4 py-8 text-center">
                <MessageSquare className="w-8 h-8 text-white/20 mx-auto mb-2" />
                <p className="text-xs text-white/40">Chưa có hội thoại nào</p>
              </div>
            )}

            {filtered.map((conv) => (
              <ConvItem
                key={conv.id}
                conv={conv}
                isActive={conv.id === activeConvId}
                onClick={() => handleSelectConv(conv.id)}
              />
            ))}
          </div>
        </Panel>

        {/* ── RIGHT: Chat Thread ──────────────────────────────── */}
        <Panel className="lg:col-span-2 overflow-hidden flex flex-col relative">
          {!activeConvId ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/30">
              <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                <MessageSquare className="w-8 h-8" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Chọn một hội thoại</p>
                <p className="text-xs mt-1">để bắt đầu trả lời khách hàng</p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread Header */}
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-white/[0.02] shrink-0">
                <div className="flex items-center gap-2.5">
                  <Avatar name={activeName} role="user" />
                  <div>
                    <p className="text-sm font-semibold text-white">{activeName}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] text-white/40">
                        {activeProfile.email || activeProfile.account || ''}
                      </p>
                      {activeConversation?.status === 'open' && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">
                          Mở
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {isSuperAdmin && (
                  <span className="text-[11px] text-white/30 flex items-center gap-1">
                    <Ghost size={12} /> Ghost Mode
                  </span>
                )}
              </div>

              {/* Messages */}
              <div
                ref={scrollAreaRef}
                onScroll={onScroll}
                className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scroll-smooth"
                style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}
              >
                {isLoadingMsgs && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
                  </div>
                )}

                {!isLoadingMsgs && messages.length === 0 && (
                  <p className="text-center text-white/30 text-sm py-8">
                    Chưa có tin nhắn. Hãy gửi lời chào đến khách hàng!
                  </p>
                )}

                {messages.map((msg) => {
                  const isFromAdmin = msg.sender_role === 'admin' || msg.sender_role === 'super_admin';
                  return (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      isFromAdmin={isFromAdmin}
                      onDelete={handleDeleteMessage}
                      canDelete={isSuperAdmin}
                      onImageClick={setLightboxSrc}
                    />
                  );
                })}

                {/* User typing indicator */}
                {userIsTyping && (
                  <div className="flex items-end gap-2">
                    <Avatar name={activeName} role="user" />
                    <div className="bg-white/10 border border-white/10 rounded-2xl rounded-bl-sm">
                      <TypingDots label="đang gõ..." />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Scroll button */}
              {showScrollBtn && (
                <button
                  onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="absolute bottom-28 right-6 w-8 h-8 rounded-full bg-white/15
                    backdrop-blur border border-white/10 flex items-center justify-center
                    text-white/70 hover:bg-white/25 transition-colors shadow-lg"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              )}

              {/* Quick Templates */}
              <div className="px-3 py-2 bg-white/[0.03] border-t border-white/10 flex items-center gap-1.5 overflow-x-auto shrink-0">
                <span className="text-[11px] font-semibold text-[#ffab40] shrink-0">Mẫu nhanh:</span>
                {QUICK_TEMPLATES.map((tmpl, i) => (
                  <button
                    key={i}
                    onClick={() => sendTemplate(tmpl.text)}
                    className="shrink-0 text-xs bg-white/8 hover:bg-[#ffab40] text-white/80
                      hover:text-black font-medium px-2.5 py-1 rounded-md border border-white/10
                      transition-colors whitespace-nowrap"
                  >
                    {tmpl.label}
                  </button>
                ))}
              </div>

              {/* Input Footer */}
              <div className="px-3 py-3 border-t border-white/10 shrink-0">
                <div className="flex items-end gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2
                  focus-within:border-[#ffab40]/50 focus-within:ring-1 focus-within:ring-[#ffab40]/20 transition-all">
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
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mb-0.5
                      text-white/50 hover:text-[#ffab40] hover:bg-white/5 transition-colors disabled:opacity-40"
                    title="Gửi hình ảnh cho khách hàng"
                  >
                    {isSendingImage
                      ? <Loader2 size={16} className="animate-spin" />
                      : <ImagePlus size={16} />}
                  </button>
                  <textarea
                    ref={inputRef}
                    id="admin-chat-input"
                    value={text}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    rows={1}
                    placeholder="Nhập phản hồi hoặc dán ảnh (Ctrl+V)..."
                    className="flex-1 bg-transparent text-white text-sm placeholder:text-white/35
                      resize-none outline-none min-h-[24px] max-h-24 leading-6"
                    style={{ fieldSizing: 'content' }}
                  />
                  <button
                    id="admin-chat-send"
                    onClick={handleSend}
                    disabled={!text.trim()}
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0
                      bg-gradient-to-r from-[#ffab40] to-[#e67e22] text-white
                      disabled:opacity-40 disabled:cursor-not-allowed
                      hover:opacity-90 active:scale-95 transition-all shadow-md"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}