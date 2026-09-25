import { useState, useEffect, useRef, useCallback } from 'react';
import {
  spGetOrCreateConversation,
  spFetchConversationMessages,
  spSendChatMessageV2,
  spMarkConversationRead,
  spSubscribeConversationMessages,
  spBroadcastTyping,
  spUploadChatImage,
} from '@/lib/supabaseService';
import { isSupabaseConfigured } from '@/lib/supabase';
import { emitSocketEvent } from '@/lib/socket';
import { prepareChatImage } from '@/lib/chatImageUtils';

/**
 * useConversationChat — Hook cho phía User (Chat Widget).
 *
 * Cung cấp:
 * - messages: danh sách tin nhắn của conversation
 * - send(text): gửi tin nhắn
 * - conversation: metadata của conversation hiện tại
 * - adminIsTyping: admin đang gõ hay không
 * - isLoading: đang tải lịch sử
 * - notifyTyping(bool): báo cho admin biết user đang gõ
 */
export function useConversationChat(user) {
  const userId = user?.id;
  const userName = user?.full_name || user?.account || 'Khách';

  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [adminIsTyping, setAdminIsTyping] = useState(false);
  const [isSendingImage, setIsSendingImage] = useState(false);

  const adminTypingTimer = useRef(null);
  const convIdRef = useRef(null);

  // Khởi tạo: lấy hoặc tạo conversation, fetch lịch sử
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    const init = async () => {
      setIsLoading(true);
      try {
        const conv = await spGetOrCreateConversation(userId);
        if (cancelled || !conv) return;
        setConversation(conv);
        convIdRef.current = conv.id;

        const history = await spFetchConversationMessages(conv.id);
        if (!cancelled) setMessages(history || []);

        // Đánh dấu admin đã đọc
        await spMarkConversationRead(conv.id, 'user');
      } catch (err) {
        console.error('[useConversationChat] init error:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    init();
    return () => { cancelled = true; };
  }, [userId]);

  // Subscribe realtime tin nhắn mới trong conversation
  useEffect(() => {
    const convId = convIdRef.current;
    if (!convId || !isSupabaseConfigured()) return;

    const unsub = spSubscribeConversationMessages(convId, (newMsg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      // Nếu admin gửi → đánh dấu user đã đọc
      if (newMsg.sender_role === 'admin' || newMsg.sender_role === 'super_admin') {
        spMarkConversationRead(convId, 'user').catch(() => {});
        setConversation((prev) => prev ? { ...prev, unread_user: 0 } : prev);
      }
    });

    return () => unsub();
  }, [conversation?.id]);

  // Subscribe typing indicator từ admin
  useEffect(() => {
    const convId = convIdRef.current || conversation?.id;
    if (!convId || !isSupabaseConfigured()) return;

    const unsub = spBroadcastTyping.subscribe(convId, ({ role, isTyping }) => {
      if (role === 'admin' || role === 'super_admin') {
        setAdminIsTyping(isTyping);
        // Tự tắt typing sau 4s nếu không có update mới
        clearTimeout(adminTypingTimer.current);
        if (isTyping) {
          adminTypingTimer.current = setTimeout(() => setAdminIsTyping(false), 4000);
        }
      }
    });

    return () => {
      unsub();
      clearTimeout(adminTypingTimer.current);
    };
  }, [conversation?.id]);

  // Gửi tin nhắn
  const send = useCallback(async (text) => {
    if (!text?.trim() || !userId) return;
    const convId = convIdRef.current;

    const msgId = 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const optimistic = {
      id: msgId,
      user_id: userId,
      username: userName,
      message: text.trim(),
      sender_role: 'user',
      conversation_id: convId,
      read_by_admin: false,
      read_by_user: true,
      created_at: new Date().toISOString(),
    };

    // Optimistic update
    setMessages((prev) => [...prev, optimistic]);

    // Dừng typing khi gửi
    if (convId) {
      spBroadcastTyping.send(convId, userId, 'user', false);
    }

    // Lưu vào Supabase
    const saved = await spSendChatMessageV2({
      id: msgId,
      userId,
      username: userName,
      message: text.trim(),
      senderRole: 'user',
      conversationId: convId,
    });

    if (saved) {
      // Thay thế optimistic bằng server response
      setMessages((prev) => prev.map((m) => (m.id === msgId ? saved : m)));
    }

    // Emit socket để admin thấy ngay
    emitSocketEvent('chat:send_message', {
      ...optimistic,
      conversationId: convId,
      userId,
    });
  }, [userId, userName]);

  // Gửi ảnh đính kèm (từ nút chọn ảnh hoặc dán Ctrl+V/Cmd+V vào ô nhập).
  // Ảnh được xử lý (chuẩn hoá xoay EXIF, chỉ nén khi thực sự quá khổ để giữ
  // độ nét) rồi tải lên Supabase Storage, sau đó lưu URL vào tin nhắn —
  // đồng bộ real-time sang admin và mọi thiết bị khác của người dùng.
  const sendImage = useCallback(async (file, caption = '') => {
    if (!file || !userId) return;
    const convId = convIdRef.current;

    setIsSendingImage(true);
    const msgId = 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    try {
      const { file: preparedFile, width, height } = await prepareChatImage(file);

      // Optimistic preview: hiện ảnh ngay bằng blob local trong lúc chờ upload.
      const localPreviewUrl = URL.createObjectURL(preparedFile);
      const optimistic = {
        id: msgId,
        user_id: userId,
        username: userName,
        message: caption.trim(),
        image_url: localPreviewUrl,
        image_width: width,
        image_height: height,
        sender_role: 'user',
        conversation_id: convId,
        read_by_admin: false,
        read_by_user: true,
        created_at: new Date().toISOString(),
        _uploading: true,
      };
      setMessages((prev) => [...prev, optimistic]);

      const imageUrl = await spUploadChatImage(preparedFile);
      if (!imageUrl) throw new Error('upload_failed');

      const saved = await spSendChatMessageV2({
        id: msgId,
        userId,
        username: userName,
        message: caption.trim(),
        senderRole: 'user',
        conversationId: convId,
        imageUrl,
        imageWidth: width,
        imageHeight: height,
      });

      setMessages((prev) => prev.map((m) => (m.id === msgId ? (saved || { ...m, image_url: imageUrl, _uploading: false }) : m)));
      URL.revokeObjectURL(localPreviewUrl);

      emitSocketEvent('chat:send_message', {
        ...(saved || optimistic),
        conversationId: convId,
        userId,
      });

      return true;
    } catch (err) {
      console.error('[useConversationChat] sendImage error:', err);
      // Gửi thất bại — bỏ tin nhắn optimistic khỏi danh sách
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      throw err;
    } finally {
      setIsSendingImage(false);
    }
  }, [userId, userName]);

  // Thông báo user đang gõ cho admin
  const userTypingTimer = useRef(null);
  const notifyTyping = useCallback((isTyping) => {
    const convId = convIdRef.current || conversation?.id;
    if (!convId) return;
    clearTimeout(userTypingTimer.current);
    spBroadcastTyping.send(convId, userId, 'user', isTyping);
    if (isTyping) {
      // Tự dừng typing sau 3s
      userTypingTimer.current = setTimeout(() => {
        spBroadcastTyping.send(convId, userId, 'user', false);
      }, 3000);
    }
  }, [conversation?.id, userId]);

  // Unread count phía user
  const unreadUser = conversation?.unread_user || 0;

  return {
    conversation,
    messages,
    isLoading,
    adminIsTyping,
    unreadUser,
    send,
    sendImage,
    isSendingImage,
    notifyTyping,
  };
}
