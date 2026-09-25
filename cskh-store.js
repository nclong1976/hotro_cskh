(function () {
  if (window.VGStore) return;
  const KEY = 'vg-cskh-store-v1', SIG = 'vg-cskh-signal';
  const ch = 'BroadcastChannel' in window ? new BroadcastChannel('vg-cskh') : null;
  const subs = new Set(), sigSubs = new Set();
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { convs: [] }; } catch (e) { return { convs: [] }; } };
  const emit = () => { const d = load(); subs.forEach(f => f(d)); };
  const save = (d) => {
    localStorage.setItem(KEY, JSON.stringify(d));
    ch && ch.postMessage({ type: 'sync' });
    emit();
  };
  const mutate = (fn) => { const d = load(); fn(d); save(d); return d; };
  const conv = (d, id) => d.convs.find(c => c.id === id);
  const updateConv = (id, fn) => mutate(d => { const c = conv(d, id); if (c) fn(c); });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(-2).map(w => w[0]).join('').toUpperCase() || 'KH';
  const onSignal = (data) => sigSubs.forEach(f => f(data));
  ch && ch.addEventListener('message', e => { if (e.data && e.data.type === 'sync') emit(); else onSignal(e.data); });
  window.addEventListener('storage', e => {
    if (e.key === KEY) emit();
    if (e.key === SIG && e.newValue) { try { onSignal(JSON.parse(e.newValue)); } catch (x) {} }
  });
  window.VGStore = {
    load, save, mutate, updateConv, uid, initials,
    get: (id) => conv(load(), id),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    onSignal: (fn) => { sigSubs.add(fn); return () => sigSubs.delete(fn); },
    signal: (data) => { if (ch) ch.postMessage(data); else localStorage.setItem(SIG, JSON.stringify({ ...data, _t: Date.now() })); },
    addMessage: (id, msg) => updateConv(id, c => { c.messages.push({ id: uid(), ts: Date.now(), ...msg }); c.updatedAt = Date.now(); }),
    createConv: ({ identity, service }) => {
      const id = uid();
      const isPhone = /^[0-9\s+]{8,}$/.test(identity);
      const name = isPhone ? 'Khách hàng ' + identity.replace(/\s/g, '').slice(-4) : identity;
      mutate(d => {
        d.convs.unshift({
          id, ticket: '#VG-' + String(Date.now()).slice(-6), name, initials: initials(name), identity,
          phone: isPhone ? identity : '—', vinid: /^VID/i.test(identity) ? identity : '—',
          service: service || 'Khác', status: 'waiting', createdAt: Date.now(), updatedAt: Date.now(),
          agentName: '', customerOnline: true, rating: 0, note: '', tier: 'Khách hàng mới · Cổng CSKH', asset: '—', history: [],
          messages: [{ id: uid(), from: 'system', text: 'Khách hàng bắt đầu hội thoại', ts: Date.now() }]
        });
      });
      return id;
    },
    fmtTime: (ts) => ts ? new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '',
    imageToDataURL: (file, max = 1024) => new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = rej; img.src = url;
    })
  };
})();
