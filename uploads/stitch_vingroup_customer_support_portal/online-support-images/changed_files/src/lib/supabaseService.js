import { supabase, isSupabaseConfigured } from './supabase';

// Đăng ký kênh Realtime dùng chung theo `key` — nhiều component (Home, HomeHeader,
// GamePlayScreen...) có thể cùng lắng nghe realtime cho CÙNG một user/kênh chat trên
// cùng một trang. Supabase trả về LẠI cùng một channel instance khi gọi `.channel()` với
// cùng tên topic, nên gọi `.on().subscribe()` lần thứ 2 trên kênh đã subscribe sẽ crash
// ("cannot add postgres_changes callbacks ... after subscribe()"). Dùng registry đếm số
// người nghe để chỉ tạo/subscribe kênh MỘT LẦN và chỉ removeChannel khi không còn ai lắng nghe.
const sharedChannels = new Map();

const subscribeShared = (key, createChannel) => (onMessage) => {
  if (!isSupabaseConfigured() || !supabase) return () => {};

  let entry = sharedChannels.get(key);
  if (!entry) {
    const listeners = new Set();
    let channel;
    try {
      channel = createChannel((payload) => {
        listeners.forEach((cb) => cb(payload));
      });
    } catch (e) {
      console.warn('Supabase realtime subscribe notice:', e?.message);
      return () => {};
    }
    entry = { channel, listeners };
    sharedChannels.set(key, entry);
  }
  entry.listeners.add(onMessage);

  return () => {
    entry.listeners.delete(onMessage);
    if (entry.listeners.size === 0) {
      supabase.removeChannel(entry.channel);
      sharedChannels.delete(key);
    }
  };
};

// ── Storage (bucket "app-assets") ───────────────────────────
// Bucket công khai duy nhất cho mọi file admin tải lên (banner ảnh/video, ảnh nền sảnh
// game...) — thay thế Base44 UploadFile cũ (đã lỗi thời, không có backend thật, luôn 404)
// vốn khiến admin không tải được ảnh và phải rơi vào phương án dự phòng Data URL (nhồi cả
// file base64 vào localStorage/app_settings, rất nặng và không đồng bộ tốt qua Realtime).
const STORAGE_BUCKET = 'app-assets';

/**
 * Tải 1 file lên Supabase Storage, trả về URL công khai (public URL).
 * `folder` giúp phân loại file theo khu vực sử dụng (banners/games/...).
 * Trả về null nếu Supabase chưa cấu hình hoặc upload thất bại — nơi gọi tự lo fallback.
 */
export const spUploadFile = async (file, folder = 'misc') => {
  if (!isSupabaseConfigured() || !file) return null;

  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase();
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'bin';
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });

  if (error) {
    console.error('Supabase storage upload error:', error);
    return null;
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
};

/**
 * Tải 1 ảnh đính kèm khung chat hỗ trợ trực tuyến lên Storage (thư mục "chat/").
 * Dùng chung `spUploadFile` — tách riêng hàm này để nơi gọi (widget chat) không
 * phải nhớ tên thư mục, và dễ đổi chiến lược lưu trữ ảnh chat sau này nếu cần.
 */
export const spUploadChatImage = (file) => spUploadFile(file, 'chat');

/**
 * Register user in Supabase CSDL (users_profile table)
 */
export const spRegisterUser = async ({ id: passedId, account, password, payPassword, fullName }) => {
  if (!isSupabaseConfigured()) return null;

  const acc = (account || '').trim().toLowerCase();
  const id = passedId || 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const role = acc === 'admin' || acc === 'admin1' || acc.startsWith('admin') ? 'admin' : 'user';

  // Check if account exists
  const { data: existing } = await supabase
    .from('users_profile')
    .select('id')
    .eq('account', acc)
    .maybeSingle();

  if (existing) {
    throw new Error('Tài khoản đã tồn tại trên cơ sở dữ liệu Supabase');
  }

  const newUser = {
    id,
    account: acc,
    email: `${acc}@app.internal`,
    full_name: fullName || acc,
    password_hash: password,
    pay_password: payPassword,
    role,
    balance: 0,
    locked: false,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('users_profile')
    .insert([newUser])
    .select()
    .single();

  if (error) {
    throw new Error(error.message || 'Lỗi khi đăng ký tài khoản trên Supabase');
  }

  return data;
};

/**
 * Login user via Supabase CSDL
 */
export const spLoginUser = async ({ account, password }) => {
  if (!isSupabaseConfigured()) return null;

  const acc = (account || '').trim().toLowerCase();

  const { data: user, error } = await supabase
    .from('users_profile')
    .select('*')
    .eq('account', acc)
    .maybeSingle();

  if (error || !user) {
    throw new Error('Tài khoản không tồn tại trên Supabase');
  }

  // password_hash có thể là plaintext (tài khoản cũ) hoặc bcrypt (được trigger
  // hash_user_secrets tự hash khi insert/update) — dùng RPC verify_login vì nó
  // xử lý đúng cả hai định dạng bằng crypt(), so sánh chuỗi thô ở đây sẽ luôn
  // thất bại với mật khẩu đã bị hash.
  const { data: verified, error: verifyError } = await supabase.rpc('verify_login', {
    p_account: acc,
    p_password: password,
  });

  if (verifyError || !verified || verified.length === 0) {
    throw new Error('Mật khẩu không chính xác');
  }

  if (user.locked) {
    throw new Error('Tài khoản đã bị tạm khóa bởi QTV');
  }

  return user;
};

/**
 * Fetch all users profile for Admin
 */
export const spListUsers = async () => {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('users_profile')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return null;
  return data;
};

/**
 * Fetch single user profile by ID or Account
 */
export const spGetUserProfile = async (userIdOrAccount) => {
  if (!isSupabaseConfigured() || !userIdOrAccount) return null;

  const { data, error } = await supabase
    .from('users_profile')
    .select('*')
    .or(`id.eq.${userIdOrAccount},account.eq.${userIdOrAccount}`)
    .maybeSingle();

  if (error) return null;
  return data;
};

/**
 * Update User Balance & Record Audit Transaction in Supabase
 */
export const spAdjustBalance = async (userId, newBalance, txData = null) => {
  if (!isSupabaseConfigured()) return null;

  const { data: user, error: uErr } = await supabase
    .from('users_profile')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();

  if (uErr) {
    console.error('Supabase balance update error:', uErr);
  }

  if (txData) {
    await supabase.from('transactions').insert([
      {
        id: txData.id || 'TX_' + Date.now().toString(36),
        user_id: userId,
        type: txData.type || 'ADMIN_ADJUST',
        amount: txData.amount,
        status: txData.status || 'completed',
        method: txData.method || 'System',
        reason: txData.reason || '',
        created_at: new Date().toISOString(),
      },
    ]);
  }

  return user;
};

/**
 * Xoá vĩnh viễn tài khoản khỏi Supabase — dùng khi Admin xoá người dùng, để tài khoản
 * không thể "hồi sinh" hoặc vẫn đăng nhập được từ một thiết bị khác.
 */
export const spDeleteUser = async (userId) => {
  if (!isSupabaseConfigured() || !userId) return false;

  const { error } = await supabase.from('users_profile').delete().eq('id', userId);
  if (error) {
    console.error('Supabase delete user error:', error);
    return false;
  }
  return true;
};

/**
 * Update user details in Supabase
 */
export const spUpdateUser = async (userId, patch) => {
  if (!isSupabaseConfigured()) return null;

  const updateData = { updated_at: new Date().toISOString() };
  if (patch.password) updateData.password_hash = patch.password;
  if (patch.payPassword) updateData.pay_password = patch.payPassword;
  if (patch.full_name !== undefined) updateData.full_name = patch.full_name;
  if (patch.email !== undefined) updateData.email = patch.email;
  if (patch.phone !== undefined) updateData.phone = patch.phone;
  if (patch.locked !== undefined) updateData.locked = patch.locked;
  if (patch.adminNote !== undefined) updateData.admin_note = patch.adminNote;
  if (patch.balance !== undefined) updateData.balance = patch.balance;
  if (patch.bankInfo !== undefined) updateData.bank_info = patch.bankInfo;

  const { data, error } = await supabase
    .from('users_profile')
    .update(updateData)
    .eq('id', userId)
    .select()
    .maybeSingle();

  if (error) {
    console.error('Supabase update user error:', error);
  }
  return data;
};

/**
 * Realtime Chat Support
 */
export const spFetchChatMessages = async (limit = 50) => {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return null;
  return data ? data.reverse() : [];
};

/**
 * Toàn bộ lịch sử chat của MỘT người dùng cụ thể — dùng để khôi phục hội thoại khi
 * người dùng mở khung chat trên thiết bị mới (khác với spFetchChatMessages ở trên,
 * vốn chỉ lấy N tin nhắn gần nhất trên TOÀN hệ thống, phù hợp cho màn hình Admin).
 */
export const spFetchUserChatMessages = async (userId, limit = 300) => {
  if (!isSupabaseConfigured() || !userId) return null;

  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) return null;
  return data || [];
};

export const spSendChatMessage = async (msg) => {
  if (!isSupabaseConfigured()) return null;

  const newMsg = {
    id: msg.id || 'msg_' + Date.now().toString(36),
    user_id: msg.userId || 'guest',
    username: msg.username || msg.sender || 'Khách',
    message: msg.text || msg.message || '',
    avatar: msg.avatar || '',
    // Bắt buộc để phía nhận (thiết bị khác) biết tin nhắn này của User hay của
    // Admin/Super Admin, tránh hiển thị nhầm bên trái/phải trên giao diện chat.
    sender_role: msg.senderRole || 'user',
    is_secret: !!msg.isSecret,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('chat_messages')
    .insert([newMsg])
    .select()
    .single();

  if (error) {
    console.error('Supabase send chat error:', error);
  }
  return data;
};

export const spSubscribeChat = subscribeShared('public:chat_messages', (emit) =>
  supabase
    .channel('public:chat_messages')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      (payload) => {
        if (payload.new) emit(payload.new);
      }
    )
    .subscribe()
);

/**
 * Banners Support
 */
export const spFetchBanners = async () => {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('banners')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) return null;
  return data;
};

/**
 * Realtime User Profile Subscription
 */
export const spSubscribeUserProfile = (userId, onProfileChange) => {
  if (!isSupabaseConfigured() || !supabase || !userId) return () => {};

  return subscribeShared(`public:users_profile:${userId}`, (emit) =>
    supabase
      .channel(`public:users_profile:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users_profile' },
        (payload) => {
          if (payload.new && (payload.new.id === userId || payload.new.account === userId)) {
            emit(payload.new);
          }
        }
      )
      .subscribe()
  )(onProfileChange);
};

/**
 * Transactions Sync
 */
export const spFetchUserTransactions = async (userId) => {
  if (!isSupabaseConfigured() || !userId) return null;

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return null;
  return data;
};

/**
 * Withdraw Requests Sync
 */
export const spFetchUserWithdrawRequests = async (userId) => {
  if (!isSupabaseConfigured() || !userId) return null;

  const { data, error } = await supabase
    .from('withdraw_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return null;
  return data;
};

/**
 * Game Bets Sync (Multi-Device) — đẩy vé cược (đang chờ/đã tất toán) lên Supabase
 * để mọi thiết bị đăng nhập cùng tài khoản đều thấy đúng lịch sử cược.
 */
export const spSyncGameBet = async (bet) => {
  if (!isSupabaseConfigured() || !bet) return null;

  const id = String(bet.betId || bet.id);
  const status = bet.status === 'SETTLED_WIN' ? 'win' : bet.status === 'SETTLED_LOSE' ? 'loss' : 'pending';

  const row = {
    id,
    user_id: bet.userId,
    game_type: bet.gameId || bet.game || 'unknown',
    amount: Number(bet.amount) || 0,
    payout: Number(bet.winAmount) || 0,
    status,
    details: {
      period: bet.period,
      key: bet.key || bet.itemKey,
      label: bet.label,
      lockedOdds: bet.lockedOdds ?? bet.odds,
      tabId: bet.tabId,
      tabLabel: bet.tabLabel,
      time: bet.time,
      created_date: bet.created_date || bet.timestamp,
      game: bet.game,
    },
  };

  // Không dùng upsert()/onConflict: một số môi trường Supabase có thể chưa có ràng buộc
  // UNIQUE/PRIMARY KEY thực sự trên cột id (lệch với supabase/schema.sql), khiến upsert
  // báo lỗi Postgres 42P10 ("no unique or exclusion constraint matching ON CONFLICT") và
  // vé cược không bao giờ được lưu. Tự làm UPSERT ở tầng ứng dụng: thử UPDATE trước, nếu
  // không có dòng nào khớp thì INSERT mới — hoạt động đúng bất kể ràng buộc DB thế nào.
  const { data: updated, error: updateError } = await supabase
    .from('game_bets')
    .update(row)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (updateError) {
    console.error('Supabase sync bet (update) error:', updateError);
  }

  if (updated) return updated;

  const { data: inserted, error: insertError } = await supabase
    .from('game_bets')
    .insert([row])
    .select()
    .maybeSingle();

  if (insertError) {
    console.error('Supabase sync bet (insert) error:', insertError);
  }
  return inserted;
};

export const spFetchUserGameBets = async (userId, limit = 300) => {
  if (!isSupabaseConfigured() || !userId) return null;

  const { data, error } = await supabase
    .from('game_bets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return null;
  return data;
};

/**
 * Admin: lấy TOÀN BỘ vé cược của TẤT CẢ người dùng (bất kể đăng nhập/chơi ở thiết bị nào)
 */
export const spListAllGameBets = async (limit = 500) => {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('game_bets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return null;
  return data;
};

/**
 * Admin: lấy TOÀN BỘ đơn rút tiền của TẤT CẢ người dùng để Admin luôn kiểm soát được
 * hàng đợi duyệt rút tiền dù người dùng gửi đơn từ thiết bị nào.
 */
export const spListAllWithdrawRequests = async (limit = 500) => {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('withdraw_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return null;
  return data;
};

/**
 * Admin: duyệt/từ chối đơn rút tiền — cập nhật trạng thái trên Supabase để mọi thiết bị
 * (kể cả thiết bị của người dùng gửi đơn) thấy đúng kết quả tức thì.
 */
export const spUpdateWithdrawRequestStatus = async (id, status) => {
  if (!isSupabaseConfigured() || !id) return null;

  const { data, error } = await supabase
    .from('withdraw_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('Supabase update withdraw request error:', error);
  }
  return data;
};

export const spCreateWithdrawRequest = async (req) => {
  if (!isSupabaseConfigured() || !req) return null;

  const newReq = {
    id: req.id || 'WR_' + Date.now().toString(36),
    user_id: req.userId,
    account: req.account || '',
    full_name: req.fullName || '',
    amount: req.amount,
    bank_info: req.bankInfo || {},
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('withdraw_requests')
    .insert([newReq])
    .select()
    .single();

  if (error) {
    console.error('Supabase create withdraw request error:', error);
  }
  return data;
};

/**
 * App Settings (Multi-Device) — cấu hình toàn hệ thống do Admin điều khiển (game
 * config, banner config, cài đặt chung), lưu dạng JSON blob theo key, để mọi thiết
 * bị người dùng đọc được cùng một cấu hình thay vì chỉ nằm trong localStorage của Admin.
 */
export const spGetAppSetting = async (key) => {
  if (!isSupabaseConfigured() || !key) return null;

  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('key', key)
    .maybeSingle();

  if (error) return null;
  return data;
};

export const spSetAppSetting = async (key, value) => {
  if (!isSupabaseConfigured() || !key) return null;

  const row = { key, value, updated_at: new Date().toISOString() };

  // Không dùng upsert()/onConflict — xem ghi chú tại spSyncGameBet ở trên: một số
  // môi trường Supabase có thể chưa có ràng buộc UNIQUE thật trên cột key, khiến
  // upsert báo lỗi 42P10. Tự làm UPSERT ở tầng ứng dụng: UPDATE trước, không có
  // dòng nào khớp thì INSERT mới.
  const { data: updated, error: updateError } = await supabase
    .from('app_settings')
    .update(row)
    .eq('key', key)
    .select()
    .maybeSingle();

  if (updateError) {
    console.error('Supabase set app setting (update) error:', updateError);
  }
  if (updated) return updated;

  const { data: inserted, error: insertError } = await supabase
    .from('app_settings')
    .insert([row])
    .select()
    .maybeSingle();

  if (insertError) {
    console.error('Supabase set app setting (insert) error:', insertError);
  }
  return inserted;
};

export const spSubscribeAppSetting = (key, onChange) => {
  if (!isSupabaseConfigured() || !supabase || !key) return () => {};

  return subscribeShared(`public:app_settings:${key}`, (emit) =>
    supabase
      .channel(`public:app_settings:${key}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${key}` },
        (payload) => {
          if (payload.new) emit(payload.new);
        }
      )
      .subscribe()
  )(onChange);
};

/**
 * Notifications (Multi-Device) — thông báo Admin gửi tới từng người dùng cụ thể,
 * lưu trên Supabase để chuyển phát thật tới máy của người dùng (trước đây chỉ ghi
 * vào localStorage của chính máy Admin nên không bao giờ tới được người nhận thật).
 */
export const spInsertNotifications = async (rows) => {
  if (!isSupabaseConfigured() || !rows || rows.length === 0) return null;

  const payload = rows.map((n) => ({
    id: n.id,
    user_id: n.userId,
    type: n.type || 'info',
    title: n.title || '',
    body: n.body || '',
    broadcast_id: n.broadcastId || null,
    audience: n.audience || null,
    read: false,
    created_at: n.created_at || new Date().toISOString(),
  }));

  const { data, error } = await supabase.from('notifications').insert(payload).select();

  if (error) {
    console.error('Supabase insert notifications error:', error);
  }
  return data;
};

export const spFetchUserNotifications = async (userId, limit = 100) => {
  if (!isSupabaseConfigured() || !userId) return null;

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return null;
  return data || [];
};

/**
 * Realtime: đẩy thông báo mới tới đúng người dùng NGAY khi Admin gửi, thay vì đợi
 * vòng poll 5s (hydrateUserNotifications) tiếp theo trong NotificationContext.jsx.
 */
export const spSubscribeUserNotifications = (userId, onNewNotification) => {
  if (!isSupabaseConfigured() || !supabase || !userId) return () => {};

  return subscribeShared(`public:notifications:${userId}`, (emit) =>
    supabase
      .channel(`public:notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.new) emit(payload.new);
        }
      )
      .subscribe()
  )(onNewNotification);
};

// ====================================================================
// LIVE CHAT CSKH — v2 (Conversations + Read Receipts + Typing)
// ====================================================================

/**
 * Lấy hoặc tạo mới conversation cho 1 user (1 user = 1 conversation).
 */
export const spGetOrCreateConversation = async (userId) => {
  if (!isSupabaseConfigured() || !userId) return null;

  const { data: existing } = await supabase
    .from('support_conversations')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) return existing;

  const newConv = {
    id: 'conv_' + userId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40),
    user_id: userId,
    status: 'open',
    unread_admin: 0,
    unread_user: 0,
    last_message_at: new Date().toISOString(),
    last_message_body: '',
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('support_conversations')
    .insert([newConv])
    .select()
    .single();

  if (error) {
    // Race condition: thử lấy lại
    const { data: retry } = await supabase
      .from('support_conversations')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return retry;
  }
  return data;
};

/**
 * Admin: lấy tất cả conversations, sort theo tin nhắn mới nhất.
 */
export const spFetchAllConversations = async () => {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('support_conversations')
    .select('*, users_profile:user_id(id, account, full_name, email, role)')
    .order('last_message_at', { ascending: false });

  if (error) { console.error('spFetchAllConversations:', error); return []; }
  return data || [];
};

/**
 * Lấy lịch sử tin nhắn của 1 conversation.
 */
export const spFetchConversationMessages = async (conversationId, limit = 200) => {
  if (!isSupabaseConfigured() || !conversationId) return [];

  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) { console.error('spFetchConversationMessages:', error); return []; }
  return data || [];
};

/**
 * Gửi tin nhắn kèm conversation_id (v2).
 * DB Trigger sẽ tự cập nhật last_message_at và unread counts.
 */
export const spSendChatMessageV2 = async (msg) => {
  if (!isSupabaseConfigured()) return null;

  const newMsg = {
    id: msg.id || 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    user_id: msg.userId || 'guest',
    username: msg.username || 'Khách',
    message: msg.message || msg.text || '',
    avatar: msg.avatar || '',
    sender_role: msg.senderRole || 'user',
    is_secret: !!msg.isSecret,
    conversation_id: msg.conversationId || null,
    // Ảnh đính kèm (hỗ trợ trực tuyến cho phép gửi hình ảnh / dán clipboard).
    // image_url trỏ tới file gốc trên Supabase Storage — luôn hiển thị đúng
    // kích thước & độ nét gốc, không đi qua nén base64 trong DB.
    image_url: msg.imageUrl || null,
    image_width: msg.imageWidth || null,
    image_height: msg.imageHeight || null,
    read_by_admin: msg.senderRole === 'admin' || msg.senderRole === 'super_admin',
    read_by_user: msg.senderRole === 'user',
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('chat_messages')
    .insert([newMsg])
    .select()
    .single();

  if (error) console.error('spSendChatMessageV2:', error);
  return data;
};

/**
 * Đánh dấu đã đọc tất cả tin nhắn trong conversation.
 * role = 'admin'|'super_admin' → reset unread_admin=0
 * role = 'user' → reset unread_user=0
 */
export const spMarkConversationRead = async (conversationId, role = 'user') => {
  if (!isSupabaseConfigured() || !conversationId) return;

  const isAdmin = role === 'admin' || role === 'super_admin';
  const msgPatch = isAdmin ? { read_by_admin: true } : { read_by_user: true };
  const convPatch = isAdmin ? { unread_admin: 0 } : { unread_user: 0 };

  await supabase
    .from('chat_messages')
    .update(msgPatch)
    .eq('conversation_id', conversationId)
    .eq(isAdmin ? 'read_by_admin' : 'read_by_user', false);

  await supabase
    .from('support_conversations')
    .update(convPatch)
    .eq('id', conversationId);
};

/**
 * Realtime: lắng nghe thay đổi danh sách conversations (Admin).
 */
export const spSubscribeConversations = subscribeShared(
  'public:support_conversations',
  (emit) =>
    supabase
      .channel('public:support_conversations')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'support_conversations' },
        (payload) => { if (payload.new) emit(payload.new); }
      )
      .subscribe()
);

/**
 * Realtime: lắng nghe tin nhắn mới trong 1 conversation cụ thể.
 */
export const spSubscribeConversationMessages = (conversationId, onMessage) => {
  if (!isSupabaseConfigured() || !supabase || !conversationId) return () => {};
  const key = `public:chat_messages:conv:${conversationId}`;
  return subscribeShared(key, (emit) =>
    supabase
      .channel(key)
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => { if (payload.new) emit(payload.new); }
      )
      .subscribe()
  )(onMessage);
};

/**
 * Typing indicator qua Supabase Broadcast (ephemeral, không lưu DB).
 */
export const spBroadcastTyping = (() => {
  const channels = new Map();

  const getChannel = (conversationId) => {
    if (!isSupabaseConfigured() || !supabase) return null;
    const key = `typing:${conversationId}`;
    if (!channels.has(key)) {
      const ch = supabase.channel(key);
      ch.subscribe();
      channels.set(key, ch);
    }
    return channels.get(key);
  };

  return {
    send: (conversationId, userId, role, isTyping) => {
      const ch = getChannel(conversationId);
      if (!ch) return;
      ch.send({ type: 'broadcast', event: 'typing', payload: { userId, role, isTyping } });
    },
    subscribe: (conversationId, onTyping) => {
      const ch = getChannel(conversationId);
      if (!ch) return () => {};
      ch.on('broadcast', { event: 'typing' }, ({ payload }) => onTyping(payload));
      return () => {};
    },
  };
})();
