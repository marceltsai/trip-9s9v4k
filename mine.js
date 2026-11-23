// "我的" tab on the trip page: each companion signs in with Google and keeps
// their own packing list, shopping list (with prices to compare) and proxy
// buys for this trip. Nobody else - not even the trip owner - can read them;
// the database rules only let an account touch documents named after it.
(() => {
  const API_KEY = 'AIzaSyBKHEGlxuAqRE8zjO3sE9gZOu15lWYKZsk';
  const PROJECT = 'travel-pocket-61d1b';
  const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const PROXY_PAGE = 'https://marceltsai.github.io/trip-9s9v4k/proxy.html';
  const CURS = ['JPY', 'KRW', 'USD', 'EUR', 'THB', 'HKD', 'CNY', 'SGD', 'GBP', 'TWD'];
  const MODES = { fixed: '設定匯率', manual: '自己填台幣', live: '即時匯率' };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const twd = (n) => `NT$ ${Math.round(n || 0).toLocaleString('en-US')}`;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const secretId = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = crypto.getRandomValues(new Uint8Array(28));
    return Array.from(a, (x) => chars[x % chars.length]).join('');
  };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  firebase.initializeApp({ apiKey: API_KEY, authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT });
  const auth = firebase.auth();

  let user = null;
  let lists = null; // { pack, shop, paid, proxyShares, rates }
  let tab = 'pack';
  let loading = false;
  let saveTimer = null;
  const live = {}; // currency -> TWD per unit, fetched today

  // --- Cloud (Firestore REST with the signed-in user's token) ---
  const docName = () => `${user.uid}_${window.__trip.id}`;
  async function call(method, path, fields) {
    const token = await user.getIdToken();
    const res = await fetch(`${DOCS}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(fields ? { 'Content-Type': 'application/json' } : {}) },
      body: fields ? JSON.stringify({ fields }) : undefined,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`雲端回應 ${res.status}`);
    return method === 'GET' ? res.json() : null;
  }
  async function loadLists() {
    loading = true; render();
    // Sign-in can finish before the trip itself has loaded.
    while (!window.__trip) await new Promise((r) => setTimeout(r, 200));
    try {
      const doc = await call('GET', `userLists/${docName()}`);
      lists = doc ? JSON.parse(doc.fields.json.stringValue) : {};
    } catch (e) {
      lists = null; status(`讀取失敗：${e.message}`);
    }
    if (lists) {
      lists.pack ||= []; lists.shop ||= []; lists.paid ||= []; lists.proxyShares ||= {};
      lists.rates ||= { mode: 'live', currency: 'JPY', fixed: { JPY: 0.21 } };
    }
    loading = false; render();
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await call('PATCH', `userLists/${docName()}`, { json: { stringValue: JSON.stringify(lists) } });
        status('');
      } catch (e) { status(`儲存失敗，請檢查網路：${e.message}`); }
    }, 700);
  }
  function status(t) { const el = $('mine-status'); if (el) el.textContent = t; }

  // Photos: shrunk in the browser and kept as separate small documents.
  async function shrink(file, side = 1280, quality = 0.72) {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality).split(',')[1];
  }
  async function savePhoto(file) {
    const name = newId();
    const b64 = await shrink(file);
    await call('PATCH', `userLists/${docName()}_ph_${name}`, { jpeg: { stringValue: b64 } });
    photoCache[name] = `data:image/jpeg;base64,${b64}`;
    return name;
  }
  const photoCache = {};
  async function photoUrl(name) {
    if (photoCache[name]) return photoCache[name];
    const doc = await call('GET', `userLists/${docName()}_ph_${name}`);
    const b64 = doc?.fields?.jpeg?.stringValue;
    return (photoCache[name] = b64 ? `data:image/jpeg;base64,${b64}` : '');
  }
  function fillPhotos(root) {
    root.querySelectorAll('img[data-mine-photo]').forEach(async (el) => {
      const src = await photoUrl(el.dataset.minePhoto).catch(() => '');
      if (src) el.src = src;
    });
  }

  // --- Exchange rates ---
  async function liveRate(cur) {
    if (cur === 'TWD') return 1;
    if (live[cur]) return live[cur];
    try {
      const r = await (await fetch(`https://open.er-api.com/v6/latest/${cur}`)).json();
      if (r.result === 'success' && r.rates.TWD) return (live[cur] = r.rates.TWD);
    } catch (e) { /* offline */ }
    return null;
  }
  const quickRate = (cur) => cur === 'TWD' ? 1 : (live[cur] || lists.rates.fixed[cur] || null);
  const toTwd = (amount, cur) => { const r = quickRate(cur); return r == null ? null : amount * r; };

  // --- Rendering ---
  const inLine = () => /Line\//i.test(navigator.userAgent);
  function render() {
    const root = $('view-mine');
    if (!root || root.hidden) return;
    if (!window.__trip) { root.innerHTML = '<p class="empty">行程載入中…</p>'; return; }
    if (inLine() && !user) {
      const u = new URL(location.href); u.searchParams.set('openExternalBrowser', '1');
      root.innerHTML = `<div class="card pad"><h3>請用手機瀏覽器開啟</h3>
        <p>LINE 裡面的瀏覽器不能登入 Google。按下面的按鈕，會改用你手機的瀏覽器（Chrome 或 Safari）打開這一頁。</p>
        <a class="btn fill" href="${esc(u.toString())}">用手機瀏覽器開啟</a></div>`;
      return;
    }
    if (!user) {
      root.innerHTML = `<div class="card pad mine-intro"><h3>🎒 我的打包與購物清單</h3>
        <p>用 Google 帳號登入後，可以管理你自己這趟的：</p>
        <ul><li>行前打包清單（打勾）</li><li>想買的東西、各家價格比一比</li><li>幫別人代購：記金額、購買證明，一鍵把明細傳給對方</li></ul>
        <p class="sub">只有你自己看得到你的清單，其他同行者和行程建立者都看不到。</p>
        <div id="mine-login"></div>
        <p class="sub" id="mine-status"></p></div>`;
      showLoginButton();
      return;
    }
    if (loading || !lists) {
      root.innerHTML = `<p class="empty">${loading ? '讀取你的清單…' : '讀不到你的清單'}</p><p class="sub" id="mine-status"></p>`;
      return;
    }
    const packDone = lists.pack.filter((p) => p.done).length;
    root.innerHTML = `
      <div class="mine-user"><span>👤 ${esc(user.displayName || user.email)}</span>
        <button class="link" id="mine-rates" type="button">💱 匯率</button>
        <button class="link" id="mine-logout" type="button">登出</button></div>
      <div class="segmented mine-seg">
        <button type="button" data-t="pack" class="${tab === 'pack' ? 'on' : ''}">打包 ${packDone}/${lists.pack.length}</button>
        <button type="button" data-t="shop" class="${tab === 'shop' ? 'on' : ''}">購物（含代購）</button>
      </div>
      <p class="sub" id="mine-status"></p>
      <div id="mine-body"></div>`;
    root.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { tab = b.dataset.t; render(); }; });
    $('mine-logout').onclick = () => { window.google?.accounts?.id?.disableAutoSelect(); auth.signOut(); };
    $('mine-rates').onclick = rateSheet;
    if (tab === 'pack') renderPack(); else renderShop();
  }

  function renderPack() {
    const body = $('mine-body');
    const done = lists.pack.filter((p) => p.done).length;
    body.innerHTML = `
      ${window.__trip.baggage ? `<div class="card pad mine-bag">🧳 行李限制：${esc(window.__trip.baggage)}</div>` : ''}
      <form class="mine-add" id="pack-form"><input id="pack-input" placeholder="要帶的東西（可用、分隔一次加多個）" autocomplete="off"><button class="btn fill" type="submit">新增</button></form>
      ${lists.pack.length ? `<div class="mine-progress"><b>已打包 ${done} / ${lists.pack.length}</b><div class="bar"><i style="width:${lists.pack.length ? done / lists.pack.length * 100 : 0}%"></i></div></div>` : '<p class="empty">還沒有打包清單。上面輸入要帶的東西，例如「護照、網卡、充電器」。</p>'}
      <ul class="mine-pack">${lists.pack.map((p) => `
        <li><label><input type="checkbox" data-id="${p.id}" ${p.done ? 'checked' : ''}><span class="${p.done ? 'done' : ''}">${esc(p.text)}</span></label>
        <button class="link danger" data-del="${p.id}" type="button" aria-label="刪除">✕</button></li>`).join('')}</ul>
      ${done ? '<button class="link" id="pack-reset" type="button">全部取消勾選</button>' : ''}`;
    $('pack-form').onsubmit = (e) => {
      e.preventDefault();
      const parts = $('pack-input').value.split(/[\n、,，]/).map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return;
      parts.forEach((t) => lists.pack.push({ id: newId(), text: t }));
      save(); render(); $('pack-input')?.focus();
    };
    body.querySelectorAll('input[data-id]').forEach((c) => { c.onchange = () => { lists.pack.find((p) => p.id === c.dataset.id).done = c.checked; save(); render(); }; });
    body.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { lists.pack = lists.pack.filter((p) => p.id !== b.dataset.del); save(); render(); }; });
    if ($('pack-reset')) $('pack-reset').onclick = () => { lists.pack.forEach((p) => { p.done = false; }); save(); render(); };
  }

  function cheapest(prices) {
    let best = -1, bestV = Infinity;
    prices.forEach((p, i) => { const v = toTwd(p.amount, p.currency); if (v != null && v < bestV) { bestV = v; best = i; } });
    return best;
  }

  function itemCard(s) {
    const best = s.prices?.length > 1 ? cheapest(s.prices) : -1;
    const p = s.purchase;
    return `<div class="card pad mine-item${p && !s.requester ? ' bought' : ''}">
      <div class="row"><b>${esc(s.name)}${s.qty > 1 ? ` ×${s.qty}` : ''}</b>
        <button class="link" data-edit="${s.id}" type="button">修改</button></div>
      ${s.where ? `<div class="sub">🏪 ${esc(s.where)}</div>` : ''}
      ${s.note ? `<div class="sub">📝 ${esc(s.note)}</div>` : ''}
      ${p && p.amount ? `<div class="mine-paid"><b>已買：${esc(p.currency)} ${num(p.amount)} ≈ ${twd(p.twd)}${p.fee ? ` ＋代購費 ${twd(p.fee)}` : ''}</b>
        <div class="sub">${esc(p.date)}${p.where ? `・${esc(p.where)}` : ''}・${MODES[p.rateMode] || ''}</div>
        ${(p.proofs || []).length ? `<div class="mine-photos">${p.proofs.map((n) => `<img data-mine-photo="${esc(n)}" alt="購買證明">`).join('')}</div>` : ''}</div>` : (p ? '<div class="sub">✅ 已買到</div>' : '')}
      ${(s.prices || []).map((pr, i) => {
        const v = toTwd(pr.amount, pr.currency);
        return `<div class="mine-price${i === best ? ' best' : ''}" data-price="${s.id}:${pr.id}">${i === best ? '✅' : '🏷️'} ${esc(pr.where || '某處')}・${esc((pr.date || '').slice(5))}
          <span>${esc(pr.currency)} ${num(pr.amount)}${v != null && pr.currency !== 'TWD' ? ` ≈${twd(v)}` : ''}${i === best ? ' 最便宜' : ''}</span></div>`;
      }).join('')}
      <div class="mine-actions">
        ${p ? `<button class="btn" data-unbuy="${s.id}" type="button">改回還沒買</button>` : `<button class="btn" data-price-add="${s.id}" type="button">🏷️ 記價格</button>
        <button class="btn fill" data-buy="${s.id}" type="button">🛒 買到了</button>`}
      </div></div>`;
  }

  function renderShop() {
    const body = $('mine-body');
    const mine = lists.shop.filter((s) => !s.requester);
    const reqs = [...new Set(lists.shop.filter((s) => s.requester).map((s) => s.requester))];
    let h = `<button class="btn fill" id="shop-add" type="button">＋ 新增</button>`;
    if (!lists.shop.length) {
      h += `<div class="card pad"><h3>怎麼用</h3>
        <p><b>1. 先列出想買的</b><br>按「新增」。幫別人買的話，在「幫誰買」填上名字。</p>
        <p><b>2. 看到價格就記下來</b><br>在商品下按「記價格」。記了兩家以上，最便宜的會標出來。</p>
        <p><b>3. 買到了按「買到了」</b><br>幫別人買的會要你填實付金額和購買證明，之後可以一鍵把明細傳給對方。</p></div>`;
    }
    if (mine.length) {
      h += `<h3 class="mine-group">🙋 自己要買</h3>`;
      h += mine.filter((s) => !s.purchase).map(itemCard).join('');
      const done = mine.filter((s) => s.purchase);
      if (done.length) h += `<p class="sub">已買到 ${done.length}</p>` + done.map(itemCard).join('');
    }
    for (const r of reqs) {
      const items = lists.shop.filter((s) => s.requester === r);
      const bought = items.filter((s) => s.purchase);
      const total = bought.reduce((t, s) => t + (s.purchase.twd || 0) + (s.purchase.fee || 0), 0);
      const paid = lists.paid.includes(r);
      h += `<div class="mine-group row"><h3>🎁 幫 ${esc(r)} 買</h3>
        <button class="chip${paid ? ' on' : ''}" data-paid="${esc(r)}" type="button">${paid ? '已收款' : '未收款'}</button>
        <button class="link" data-share="${esc(r)}" type="button">📤 分享</button></div>
        <p class="sub">已買 ${bought.length}/${items.length}・應收 ${twd(total)}</p>`;
      h += items.map(itemCard).join('');
    }
    body.innerHTML = h;
    fillPhotos(body);
    $('shop-add').onclick = () => itemSheet();
    body.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => itemSheet(lists.shop.find((s) => s.id === b.dataset.edit)); });
    body.querySelectorAll('[data-price-add]').forEach((b) => { b.onclick = () => priceSheet(lists.shop.find((s) => s.id === b.dataset.priceAdd)); });
    body.querySelectorAll('[data-price]').forEach((b) => {
      b.onclick = () => { const [sid, pid] = b.dataset.price.split(':'); const s = lists.shop.find((x) => x.id === sid); priceSheet(s, s.prices.find((x) => x.id === pid)); };
    });
    body.querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => buySheet(lists.shop.find((s) => s.id === b.dataset.buy)); });
    body.querySelectorAll('[data-unbuy]').forEach((b) => {
      b.onclick = () => { if (!confirm('改回「還沒買」？這筆購買紀錄會刪除。')) return; delete lists.shop.find((s) => s.id === b.dataset.unbuy).purchase; save(); render(); };
    });
    body.querySelectorAll('[data-paid]').forEach((b) => {
      b.onclick = () => { const r = b.dataset.paid; lists.paid = lists.paid.includes(r) ? lists.paid.filter((x) => x !== r) : [...lists.paid, r]; save(); render(); };
    });
    body.querySelectorAll('[data-share]').forEach((b) => { b.onclick = () => shareRequester(b.dataset.share); });
    body.querySelectorAll('img[data-mine-photo]').forEach((img) => { img.onclick = () => img.src && window.open(img.src, '_blank'); });
  }

  // --- Sheets (forms) ---
  function sheet(html, onOpen) {
    $('sheet-body').innerHTML = html;
    $('sheet').hidden = false;
    onOpen($('sheet-body'));
  }
  const closeSheet = () => { $('sheet').hidden = true; };
  const curOptions = (cur) => [...new Set([...CURS, cur])].map((c) => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('');

  function itemSheet(old) {
    const known = [...new Set(lists.shop.map((s) => s.requester).filter(Boolean))];
    sheet(`<h3>${old ? '修改商品' : '新增要買的東西'}</h3>
      <form class="mine-form" id="f">
        <label>商品名稱<input name="name" required value="${esc(old?.name)}"></label>
        <label>數量<input name="qty" type="number" min="1" value="${old?.qty || 1}"></label>
        <label>幫誰買（留空＝自己要買）<input name="req" list="reqs" value="${esc(old?.requester)}"></label>
        <datalist id="reqs">${known.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <label>打算去哪家店買（選填）<input name="where" value="${esc(old?.where)}"></label>
        <label>備註（顏色、尺寸、型號…）<textarea name="note" rows="2">${esc(old?.note)}</textarea></label>
        <div class="row"><button class="btn fill" type="submit">儲存</button>
        ${old ? '<button class="btn danger" type="button" id="del">刪除</button>' : ''}</div>
      </form>`, (el) => {
      el.querySelector('#f').onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const s = old || { id: newId(), prices: [] };
        s.name = f.get('name').trim(); s.qty = Math.max(1, parseInt(f.get('qty'), 10) || 1);
        s.requester = f.get('req').trim() || undefined; s.where = f.get('where').trim(); s.note = f.get('note').trim();
        if (!s.name) return;
        if (!old) lists.shop.push(s);
        save(); closeSheet(); render();
      };
      const del = el.querySelector('#del');
      if (del) del.onclick = () => { if (confirm(`刪除「${old.name}」？`)) { lists.shop = lists.shop.filter((s) => s !== old); save(); closeSheet(); render(); } };
    });
  }

  function priceSheet(item, old) {
    sheet(`<h3>${old ? '修改價格' : '記下價格'}：${esc(item.name)}</h3>
      <form class="mine-form" id="f">
        <div class="row"><select name="cur">${curOptions(old?.currency || lists.rates.currency)}</select>
        <label class="grow">價格<input name="amount" inputmode="decimal" required value="${old ? old.amount : ''}"></label></div>
        <label>在哪裡看到<input name="where" value="${esc(old?.where || item.where)}"></label>
        <div class="row"><button class="btn fill" type="submit">儲存</button>
        ${old ? '<button class="btn danger" type="button" id="del">刪除這筆</button>' : ''}</div>
      </form>`, (el) => {
      el.querySelector('#f').onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const amount = parseFloat(String(f.get('amount')).replace(/,/g, ''));
        if (!(amount > 0)) return;
        const p = old || { id: newId(), date: today() };
        p.amount = amount; p.currency = f.get('cur'); p.where = f.get('where').trim();
        if (!old) (item.prices ||= []).push(p);
        liveRate(p.currency).then(() => render());
        save(); closeSheet(); render();
      };
      const del = el.querySelector('#del');
      if (del) del.onclick = () => { item.prices = item.prices.filter((x) => x !== old); save(); closeSheet(); render(); };
    });
  }

  function buySheet(item) {
    const proxy = !!item.requester;
    const best = cheapest(item.prices || []);
    const bp = best >= 0 ? item.prices[best] : null;
    let mode = lists.rates.mode;
    const proofs = [];
    sheet(`<h3>買到「${esc(item.name)}」</h3>
      <form class="mine-form" id="f">
        <div class="row"><select name="cur">${curOptions(bp?.currency || lists.rates.currency)}</select>
        <label class="grow">實付金額${item.qty > 1 ? `（${item.qty} 件合計）` : ''}${proxy ? '' : '（選填）'}<input name="amount" inputmode="decimal" value="${bp ? bp.amount * item.qty : ''}"></label></div>
        <div class="chips" id="modes">${Object.entries(MODES).map(([k, v]) => `<button type="button" class="chip${k === mode ? ' on' : ''}" data-mode="${k}">${v}</button>`).join('')}</div>
        <label id="twd-wrap" hidden>台幣金額（例如刷卡帳單上的）<input name="twd" inputmode="decimal"></label>
        <p class="sub" id="rate-note"></p>
        ${proxy ? '<label>代購費（台幣，選填）<input name="fee" inputmode="decimal"></label>' : ''}
        <label>在哪裡買的<input name="where" value="${esc(bp?.where || item.where)}"></label>
        <label>${proxy ? '購買證明（收據、商品照片）' : '照片（選填）'}<input type="file" accept="image/*" multiple id="proof"></label>
        <div class="mine-photos" id="proof-list"></div>
        ${proxy ? `<p class="sub">${esc(item.requester)} 的金額會記在你的代購帳裡（不會進旅程的共用記帳）。</p>` : ''}
        <p id="owe"></p>
        <button class="btn fill" type="submit" id="save">儲存</button>
      </form>`, (el) => {
      const f = el.querySelector('#f');
      let rate = null;
      const amountV = () => parseFloat(String(f.amount.value).replace(/,/g, ''));
      const twdV = () => mode === 'manual' ? parseFloat(f.twd.value) : (amountV() > 0 && rate ? amountV() * rate : null);
      const update = () => {
        const t = twdV();
        const fee = proxy ? (parseFloat(f.fee.value) || 0) : 0;
        el.querySelector('#owe').innerHTML = t != null && !isNaN(t) ? `<b>${proxy ? `${esc(item.requester)} 應付：` : '約 '}${twd(t + fee)}</b>` : '';
      };
      const loadRate = async () => {
        el.querySelector('#twd-wrap').hidden = mode !== 'manual';
        const cur = f.cur.value;
        rate = mode === 'manual' ? null : mode === 'fixed' ? (cur === 'TWD' ? 1 : lists.rates.fixed[cur] || null) : await liveRate(cur);
        el.querySelector('#rate-note').textContent = mode === 'manual' ? '' : rate ? `1 ${cur} = ${rate < 1 ? rate.toFixed(4) : rate.toFixed(2)} TWD` : (mode === 'fixed' ? `還沒設定 ${cur} 的匯率，請按上方「💱 匯率」設定或改用其他方式` : '查不到即時匯率，請改用其他方式');
        update();
      };
      el.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { mode = b.dataset.mode; el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); loadRate(); }; });
      f.cur.onchange = loadRate; f.amount.oninput = update; if (f.twd) f.twd.oninput = update; if (f.fee) f.fee.oninput = update;
      el.querySelector('#proof').onchange = async (e) => {
        const btn = el.querySelector('#save'); btn.disabled = true; btn.textContent = '照片上傳中…';
        for (const file of e.target.files) {
          try { const n = await savePhoto(file); proofs.push(n); el.querySelector('#proof-list').insertAdjacentHTML('beforeend', `<img src="${photoCache[n]}" alt="">`); } catch (err) { alert(`照片上傳失敗：${err.message}`); }
        }
        btn.disabled = false; btn.textContent = '儲存';
      };
      loadRate();
      f.onsubmit = (e) => {
        e.preventDefault();
        let a = amountV(); let t = twdV();
        if (!proxy && !(a > 0)) { a = 0; t = 0; }
        if (!(a >= 0) || t == null || isNaN(t) || (proxy && !(a > 0))) { alert('請填好實付金額和台幣換算'); return; }
        item.purchase = { amount: a, currency: f.cur.value, twd: t, rateMode: mode, date: today(), fee: proxy ? (parseFloat(f.fee.value) || 0) : 0, where: f.where.value.trim(), proofs };
        save(); closeSheet(); render();
      };
    });
  }

  function rateSheet() {
    const r = lists.rates;
    sheet(`<h3>💱 匯率設定</h3>
      <form class="mine-form" id="f">
        <p>預設換算方式（每一筆都可以臨時改）</p>
        <div class="chips">${Object.entries(MODES).map(([k, v]) => `<button type="button" class="chip${k === r.mode ? ' on' : ''}" data-mode="${k}">${v}</button>`).join('')}</div>
        <div class="row"><label>常用幣別<select name="cur">${curOptions(r.currency)}</select></label>
        <label class="grow">設定匯率：1 單位 = ? TWD<input name="fixed" inputmode="decimal" value="${r.fixed[r.currency] || ''}"></label></div>
        <p class="sub" id="live-note">查詢今天匯率中…</p>
        <button class="btn fill" type="submit">完成</button>
      </form>`, (el) => {
      const f = el.querySelector('#f');
      const showLive = async () => { const v = await liveRate(f.cur.value); el.querySelector('#live-note').textContent = v ? `今天的即時匯率：1 ${f.cur.value} = ${v.toFixed(4)} TWD` : '查不到今天的匯率'; };
      el.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { r.mode = b.dataset.mode; el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); }; });
      f.cur.onchange = () => { f.fixed.value = r.fixed[f.cur.value] || ''; showLive(); };
      showLive();
      f.onsubmit = (e) => {
        e.preventDefault();
        r.currency = f.cur.value;
        const v = parseFloat(f.fixed.value);
        if (v > 0) r.fixed[r.currency] = v; else delete r.fixed[r.currency];
        save(); closeSheet(); render();
      };
    });
  }

  // --- Sharing a requester's page ---
  async function shareRequester(req) {
    const items = lists.shop.filter((s) => s.requester === req);
    const bought = items.filter((s) => s.purchase);
    const total = bought.reduce((t, s) => t + (s.purchase.twd || 0) + (s.purchase.fee || 0), 0);
    const lines = [`【${window.__trip.title}】代購明細 - ${req}`,
      ...items.map((s) => s.purchase
        ? `・${s.name}${s.qty > 1 ? ` ×${s.qty}` : ''}：${s.purchase.currency} ${num(s.purchase.amount)} ≈ ${twd(s.purchase.twd)}${s.purchase.fee ? `（代購費 ${twd(s.purchase.fee)}）` : ''}`
        : `・${s.name}${s.qty > 1 ? ` ×${s.qty}` : ''}：還沒買到`),
      `總計：${twd(total)}`];
    status('正在產生分享網頁…');
    try {
      const share = lists.proxyShares[req] || { id: secretId(), uploaded: [] };
      const wanted = [...new Set(bought.flatMap((s) => s.purchase.proofs || []))];
      for (const n of wanted.filter((x) => !share.uploaded.includes(x))) {
        const src = await photoUrl(n);
        if (src) await call('PATCH', `proxyPages/${share.id}_ph_${n}`, { jpeg: { stringValue: src.split(',')[1] }, owner: { stringValue: user.uid } });
      }
      const r2 = (v) => Math.round(v * 100) / 100;
      const page = {
        updatedAt: new Date().toISOString(), theme: window.__trip.theme || undefined, trip: window.__trip.title, requester: req,
        paid: lists.paid.includes(req), total: r2(total),
        items: items.map((s) => ({
          name: s.name, qty: s.qty || 1, note: s.note || undefined,
          ...(s.purchase ? { amount: s.purchase.amount, currency: s.purchase.currency, twd: r2(s.purchase.twd), fee: s.purchase.fee ? r2(s.purchase.fee) : undefined, date: s.purchase.date, where: s.purchase.where || undefined, proofs: s.purchase.proofs || [] } : {}),
        })),
      };
      await call('PATCH', `proxyPages/${share.id}`, { json: { stringValue: JSON.stringify(page) }, owner: { stringValue: user.uid } });
      share.uploaded = wanted;
      lists.proxyShares[req] = share;
      save(); status('');
      const url = `${PROXY_PAGE}?id=${share.id}`;
      const text = `${lines.join('\n')}\n\n明細與購買證明：${url}`;
      if (navigator.share) await navigator.share({ text }).catch(() => {});
      else { await navigator.clipboard.writeText(text); alert('已複製明細和連結，可以貼到 LINE 傳給對方'); }
    } catch (e) { status(`分享失敗：${e.message}`); }
  }

  // --- Sign-in ---
  // Google's own button signs in right on this page and hands back a token,
  // which Firebase accepts. No redirect, so browsers that block third-party
  // storage (which broke the redirect flow on github.io) are fine.
  const CLIENT_ID = '435174422188-grnee91pqpue3tf1oq6qkh5aqf1358rb.apps.googleusercontent.com';
  let gisReady = false;
  function showLoginButton() {
    const el = $('mine-login');
    if (!el) return;
    if (!window.google?.accounts?.id) {
      el.innerHTML = '<p class="sub">載入 Google 登入中…</p>';
      setTimeout(showLoginButton, 300);
      return;
    }
    if (!gisReady) {
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async (resp) => {
          status('登入中…');
          try {
            await auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(resp.credential));
          } catch (e) { status(`登入失敗：${e.message}`); }
        },
        ux_mode: 'popup',
        use_fedcm_for_prompt: true,
      });
      gisReady = true;
    }
    el.innerHTML = '';
    google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'zh-TW', width: 280 });
  }
  auth.onAuthStateChanged((u) => {
    user = u; lists = null;
    if (u) loadLists(); else render();
  });

  window.renderMine = render;
})();
