// Read-only companion view of a trip from the 附近收藏 app.
// Link format: ?trip=<id>&lists=<list>,<list>   (lists optional: all lists when absent)
(() => {
  const params = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CATS = {
    food: { label: '美食', icon: '🍜', color: '#e5533d' },
    cafe: { label: '咖啡甜點', icon: '☕', color: '#8d5a3b' },
    attraction: { label: '景點', icon: '⛩️', color: '#2e8b57' },
    shopping: { label: '購物', icon: '🛍️', color: '#7b4fd6' },
    lodging: { label: '住宿', icon: '🏨', color: '#1e6fd9' },
    other: { label: '其他', icon: '📍', color: '#6b7280' },
  };
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  // Dates in the data are local wall-clock times without a zone; parse them as such.
  const parse = (s) => { const [d, t = '00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysBetween = (a, b) => Math.round((dayOnly(b) - dayOnly(a)) / 86400000);
  const fmtDist = (m) => m < 1000 ? `${Math.round(m)} 公尺` : m < 100000 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.round(m / 1000)} 公里`;
  const km = (a, b) => {
    const r = 6371, d2r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * d2r, dLng = (b.lng - a.lng) * d2r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(x));
  };
  const navUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const searchUrl = (q, lat, lng, z = 19) => `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${lat},${lng},${z}z`;
  const utcOffset = (code) => ({ TPE: 8, TSA: 8, KHH: 8, RMQ: 8 }[code] ?? 9);

  // --- OpenStreetMap recommendation parsing (same rules as the app) ---
  const CUISINE = { ramen: '拉麵', sushi: '壽司', udon: '烏龍麵', soba: '蕎麥麵', noodle: '麵食', japanese: '日式料理', chinese: '中式料理', korean: '韓式料理', italian: '義式料理', french: '法式料理', pizza: '披薩', burger: '漢堡', beef_bowl: '牛丼', curry: '咖哩', yakiniku: '燒肉', yakitori: '燒鳥', izakaya: '居酒屋', tempura: '天婦羅', tonkatsu: '豬排', okonomiyaki: '大阪燒', seafood: '海鮮', steak_house: '牛排', coffee_shop: '咖啡廳', cake: '蛋糕', donut: '甜甜圈', ice_cream: '冰品', chicken: '雞肉料理', motsunabe: '牛腸鍋', hot_pot: '火鍋', gyoza: '煎餃' };
  function classify(t) {
    const c = (t.cuisine || '').split(';')[0];
    switch (t.amenity) {
      case 'cafe': return ['cafe', CUISINE[c] || '咖啡廳'];
      case 'ice_cream': return ['cafe', '冰品'];
      case 'restaurant': case 'food_court': return ['food', CUISINE[c] || '餐廳'];
      case 'fast_food': return ['food', CUISINE[c] || '速食'];
      case 'bar': case 'pub': return ['food', CUISINE[c] || '酒吧'];
      case 'place_of_worship': return ['attraction', t.religion === 'shinto' ? '神社' : t.religion === 'buddhist' ? '寺廟' : '宗教場所'];
    }
    switch (t.shop) {
      case 'bakery': return ['cafe', '麵包店'];
      case 'confectionery': case 'pastry': return ['cafe', '甜點店'];
      case 'mall': return ['shopping', '購物中心'];
      case 'department_store': return ['shopping', '百貨公司'];
      case 'gift': return ['shopping', '伴手禮'];
      case 'books': return ['shopping', '書店'];
    }
    switch (t.tourism) {
      case 'hotel': case 'guest_house': case 'motel': return ['lodging', '旅館'];
      case 'hostel': return ['lodging', '青年旅館'];
      case 'museum': return ['attraction', '博物館'];
      case 'gallery': return ['attraction', '美術館'];
      case 'viewpoint': return ['attraction', '觀景點'];
      case 'zoo': return ['attraction', '動物園'];
      case 'aquarium': return ['attraction', '水族館'];
      case 'theme_park': return ['attraction', '主題樂園'];
      case 'attraction': return ['attraction', '景點'];
    }
    if (t.historic) return ['attraction', '古蹟'];
    if (t.leisure === 'park') return ['attraction', '公園'];
    if (t.leisure === 'garden') return ['attraction', '庭園'];
    return null;
  }
  function toRec(e) {
    const t = e.tags || {};
    if (!t.name) return null;
    const cls = classify(t);
    const c = e.center || e;
    if (!cls || c.lat == null) return null;
    const zh = t['name:zh-Hant'] || t['name:zh-TW'] || t['name:zh'];
    const name = zh || t.name;
    return { rec: true, name, altName: name === t.name ? null : t.name, lat: c.lat, lng: c.lon, category: cls[0], kind: cls[1], hours: t.opening_hours || null };
  }

  // --- State ---
  let data, trip, saved = [], recs = [];
  let view = 'trip', showRecs = false, cats = new Set(), maxDist = 1000;
  let center = null, centerLabel = '', map = null, mapLayer = null;

  async function load() {
    // No index of trips on purpose: each trip is reachable only by its own link.
    const id = params.get('trip');
    if (!id || !/^[\w-]+$/.test(id)) throw new Error('連結缺少行程代號');
    data =await fetch(`data/${encodeURIComponent(id)}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    trip = data.trip;
    const lists = params.get('lists')?.split(',').map((s) => s.trim()).filter(Boolean);
    saved = data.places.filter((p) => !lists || p.lists.some((l) => lists.includes(l)));
    const seen = new Set();
    recs = data.recs.map(toRec).filter(Boolean).filter((r) => {
      const key = `${r.name}@${r.lat.toFixed(3)},${r.lng.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      // Already saved places are not "recommendations".
      return !saved.some((p) => km(p, r) < 0.08 && (p.name.includes(r.name) || r.name.includes(p.name) || (r.altName && p.name.includes(r.altName))));
    });
    center = trip.center;
    centerLabel = trip.lodging[0] ? `以 ${trip.lodging[0].name.split('（')[0]} 為中心` : '以行程地點為中心';
    document.title = trip.title;
    renderTrip();
    renderChips();
    renderList();
  }

  // --- 行程 ---
  function events() {
    const out = [];
    for (const leg of trip.flights) {
      leg.segments.forEach((s, i) => {
        const from = s.from.split(' '), to = s.to.split(' ');
        out.push({ t: parse(s.depart), icon: '🛫', title: `${s.flight}  ${from[1] || from[0]} → ${to[1] || to[0]}`, sub: `${hm(parse(s.depart))} 起飛 · ${hm(parse(s.arrive))} 抵達 · ${s.airline}`, q: airport(from[0]) });
        if (i < leg.segments.length - 1 && leg.layover) out.push({ t: parse(s.arrive), icon: '⏱️', title: '轉機', sub: leg.layover });
      });
    }
    for (const l of trip.lodging) {
      out.push({ t: parse(l.checkIn), icon: '🛏️', title: `入住 ${l.name}`, sub: `${hm(parse(l.checkIn))} 後可入住 · ${l.nights} 晚`, lat: l.lat, lng: l.lng });
      out.push({ t: parse(l.checkOut), icon: '🧳', title: '退房', sub: `${hm(parse(l.checkOut))} 前退房`, lat: l.lat, lng: l.lng });
    }
    for (const a of trip.activities) {
      out.push({ t: parse(a.entryStart), icon: '🎫', title: `${a.category} 換票入場`, sub: `${window_(a)} · ${a.venue}`, lat: a.lat, lng: a.lng });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  const airport = (code) => ({ TPE: 'Taoyuan International Airport Terminal 1', FUK: 'Fukuoka Airport International Terminal', PUS: 'Gimhae International Airport' }[code]);
  const window_ = (a) => a.entryEnd ? `${hm(parse(a.entryStart))}–${hm(parse(a.entryEnd))}` : hm(parse(a.entryStart));
  const navTo = (e) => e.q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.q)}` : e.lat != null ? navUrl(e.lat, e.lng) : null;

  function renderTrip() {
    const start = parse(trip.startDate), end = parse(trip.endDate), today = dayOnly(new Date());
    const days = daysBetween(start, end) + 1;
    const [big, small] = today < start ? [daysBetween(today, start), '天後出發'] : today <= end ? ['✈', `旅行第 ${daysBetween(start, today) + 1} 天`] : ['✓', '已結束'];
    let h = `<div class="hero"><div style="flex:1;min-width:0"><h2>${esc(trip.title)}</h2>
      <div class="dates">${md(start)} – ${md(end)}</div><div class="nights">${days} 天 ${days - 1} 夜</div></div>
      <div class="countdown"><b>${big}</b><span>${small}</span></div></div>`;

    if (trip.reminders.length) {
      h += `<div class="card pad reminders"><h3>🔔 注意事項</h3>${trip.reminders.map((r) => {
        const d = parse(r.date);
        return `<div class="reminder${d < today ? ' past' : ''}"><b>${md(d)}</b><span>${esc(r.text)}</span></div>`;
      }).join('')}</div>`;
    }

    if (trip.flights.length) h += '<div class="section-title">航班</div>';
    for (const leg of trip.flights) {
      const f = leg.segments[0], l = leg.segments[leg.segments.length - 1];
      h += `<div class="card pad"><div class="leg-head">${leg.direction === '回程' ? '🛬' : '🛫'} ${esc(leg.direction)}　${esc(f.from.split(' ')[1] || '')} → ${esc(l.to.split(' ')[1] || '')}<span class="date">${md(parse(f.depart))}</span></div>`;
      leg.segments.forEach((s, i) => {
        const fc = s.from.split(' ')[0], tc = s.to.split(' ')[0];
        const dep = parse(s.depart), arr = parse(s.arrive);
        const mins = Math.round((arr - dep) / 60000) - (utcOffset(tc) - utcOffset(fc)) * 60;
        const dur = `${Math.floor(mins / 60)} 小時${mins % 60 ? ` ${mins % 60} 分` : ''}`;
        const plus = daysBetween(dep, arr);
        h += `<div class="seg"><div><div class="code">${esc(fc)}</div><div class="time">${hm(dep)}</div><div class="name">${esc(s.from.slice(fc.length).trim())}</div></div>
          <div class="arc"><svg viewBox="0 0 100 34" aria-hidden="true"><path d="M4 30 Q50 -14 82 22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 6"/><text x="84" y="28" font-size="16" fill="currentColor">✈</text></svg>${dur}</div>
          <div class="end"><div class="code">${esc(tc)}</div><div class="time">${hm(arr)}${plus > 0 ? ` +${plus}` : ''}</div><div class="name">${esc(s.to.slice(tc.length).trim())}</div></div></div>
          <div class="tags"><span class="tag">✈ ${esc(s.flight)}</span><span class="tag">${esc(s.airline)}</span>
          ${airport(fc) ? `<a class="btn" style="margin-left:auto;padding:4px 12px" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(airport(fc))}" target="_blank" rel="noopener">導航到機場</a>` : ''}</div>`;
        if (i < leg.segments.length - 1 && leg.layover) h += `<div class="layover">⏱️ 轉機　${esc(leg.layover)}</div>`;
      });
      h += '</div>';
    }

    if (trip.lodging.length) h += '<div class="section-title">住宿</div>';
    for (const l of trip.lodging) {
      h += placeCard({ image: l.image, title: l.name, badge: `${l.nights} 晚`, lat: l.lat, lng: l.lng, mapsUrl: l.mapsUrl,
        boxes: `<div class="datebox"><small>入住</small><b>${md(parse(l.checkIn))}</b>${hm(parse(l.checkIn))} 後</div><span>→</span><div class="datebox"><small>退房</small><b>${md(parse(l.checkOut))}</b>${hm(parse(l.checkOut))} 前</div>`,
        lines: [['📍', l.address], ['🛏️', l.room]] });
    }

    if (trip.activities.length) h += '<div class="section-title">活動與票券</div>';
    for (const a of trip.activities) {
      h += placeCard({ image: a.image, title: a.name, badge: a.category, lat: a.lat, lng: a.lng, mapsUrl: a.mapsUrl,
        boxes: `<div class="datebox"><small>換票入場</small><b>${md(parse(a.entryStart))}</b>${window_(a)}</div><div class="datebox"><small>票種</small><b>${esc(a.ticket)}</b>&nbsp;</div>`,
        lines: [['🏟️', a.venue], ['📍', a.address]],
        warn: a.notes.length ? `<div class="warn"><b>❗ 入場須知</b><ul>${a.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '' });
    }

    h += '<div class="section-title">每日行程</div><div class="card pad timeline">';
    const evs = events();
    let day = null;
    evs.forEach((e, i) => {
      const d = dayOnly(e.t);
      if (+d !== +day) { day = d; h += `<div class="day"><b>第 ${daysBetween(start, d) + 1} 天</b>${md(d)}</div>`; }
      const last = i === evs.length - 1 || +dayOnly(evs[i + 1].t) !== +d;
      const nav = navTo(e);
      h += `<div class="ev"><div class="t">${hm(e.t)}</div><div class="rail"><div class="dot">${e.icon}</div>${last ? '' : '<div class="bar"></div>'}</div>
        <div class="txt"><b>${esc(e.title)}</b><small>${esc(e.sub)}</small></div>
        ${nav ? `<a class="nav" href="${nav}" target="_blank" rel="noopener" aria-label="導航">🧭</a>` : '<span></span>'}</div>`;
    });
    h += '</div>';

    if (trip.baggage) h += `<div class="section-title">行李</div><div class="card pad">🧳 ${esc(trip.baggage)}</div>`;
    h += '<p class="credit">由「附近收藏」App 分享 · 唯讀頁面</p>';
    $('view-trip').innerHTML = h;

    document.querySelectorAll('[data-nearby]').forEach((b) => b.addEventListener('click', () => {
      const [lat, lng, rec] = b.dataset.nearby.split(',');
      setCenter({ lat: +lat, lng: +lng }, `以 ${b.dataset.label} 為中心`);
      showRecs = rec === '1';
      switchView('list');
    }));
  }

  function placeCard(o) {
    const lines = o.lines.filter(([, v]) => v).map(([i, v]) => `<div class="line"><span>${i}</span><span>${esc(v)}</span></div>`).join('');
    const short = esc(o.title.split('（')[0].split('「')[0]);
    return `<div class="card">
      <div class="photo">${o.image ? `<img src="images/${esc(o.image.split('/').pop())}" alt="">` : ''}<h3>${esc(o.title)}</h3>${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ''}</div>
      <div class="pad"><div class="dates2">${o.boxes}</div><div style="margin-top:10px">${lines}</div>${o.warn || ''}
      <div class="actions"><a class="btn fill" href="${navUrl(o.lat, o.lng)}" target="_blank" rel="noopener">🧭 導航</a>
        <button class="btn" type="button" data-nearby="${o.lat},${o.lng},0" data-label="${short}">📌 附近收藏</button>
        <button class="btn" type="button" data-nearby="${o.lat},${o.lng},1" data-label="${short}">✨ 附近推薦</button>
        ${o.mapsUrl ? `<a class="btn" href="${esc(o.mapsUrl)}" target="_blank" rel="noopener">🗺️ 地圖</a>` : ''}</div></div></div>`;
  }

  // --- 清單 ---
  function renderChips() {
    $('chips').innerHTML = Object.entries(CATS).map(([k, c]) => `<button class="chip${cats.has(k) ? ' on' : ''}" data-cat="${k}" type="button">${c.icon} ${c.label}</button>`).join('');
    $('chips').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.cat;
      cats.has(k) ? cats.delete(k) : cats.add(k);
      renderChips(); renderList(); if (map) renderMap();
    }));
  }

  function filtered(items) {
    return items.map((p) => ({ p, m: km(center, p) * 1000 }))
      .filter(({ p, m }) => (!cats.size || cats.has(p.category)) && (!maxDist || m <= maxDist))
      .sort((a, b) => a.m - b.m);
  }

  function renderList() {
    const s = filtered(saved), r = filtered(recs);
    $('count-saved').textContent = s.length;
    $('count-recs').textContent = r.length;
    $('seg-saved').classList.toggle('on', !showRecs);
    $('seg-recs').classList.toggle('on', showRecs);
    $('center-note').textContent = `${centerLabel}，依距離排序`;
    const items = showRecs ? r : s;
    const ul = $('places');
    if (!items.length) {
      ul.innerHTML = `<li class="empty" style="display:block">這個範圍內沒有${showRecs ? '推薦地點' : '收藏'}，試試放大距離</li>`;
    } else {
      ul.innerHTML = items.slice(0, 300).map(({ p, m }, i) => {
        const c = CATS[p.category] || CATS.other;
        const sub = p.rec ? [fmtDist(m), p.kind, p.hours].filter(Boolean).join(' · ') : `${fmtDist(m)} · ${p.lists.join('、')}`;
        return `<li data-i="${i}"><div class="ic${p.rec ? ' rec' : ''}" style="${p.rec ? '' : `background:${c.color}`}">${c.icon}</div>
          <div class="main"><b>${esc(p.name)}</b><small>${esc(sub)}</small></div>
          <a class="nav" href="${navUrl(p.lat, p.lng)}" target="_blank" rel="noopener" aria-label="導航">🧭</a></li>`;
      }).join('');
      ul.querySelectorAll('li[data-i]').forEach((li) => li.addEventListener('click', (ev) => {
        if (ev.target.closest('a')) return;
        const { p, m } = items[+li.dataset.i];
        openSheet(p, m);
      }));
    }
    $('list-credit').innerHTML = showRecs
      ? `推薦資料來自 OpenStreetMap，沒有評分 · <a href="${searchUrl('restaurants', center.lat, center.lng, 16)}" target="_blank" rel="noopener">在 Google 地圖找附近美食</a>`
      : '';
  }

  function openSheet(p, m) {
    const c = CATS[p.category] || CATS.other;
    $('sheet-body').innerHTML = `<h3>${c.icon} ${esc(p.name)}</h3>
      ${p.altName ? `<div class="sub">${esc(p.altName)}</div>` : ''}
      <p class="sub">${esc(p.rec ? p.kind : c.label)} · 距離 ${fmtDist(m)}</p>
      ${p.address ? `<p>📍 ${esc(p.address)}</p>` : ''}
      ${p.hours ? `<p>🕒 ${esc(p.hours)}</p>` : ''}
      ${p.lists ? `<div class="lists">${p.lists.map((l) => `<span class="tag">${esc(l)}</span>`).join('')}</div>` : '<p class="sub">附近推薦（OpenStreetMap），不是收藏</p>'}
      <div class="actions"><a class="btn fill" href="${navUrl(p.lat, p.lng)}" target="_blank" rel="noopener">🧭 導航</a>
      ${p.rec ? `<a class="btn" href="${searchUrl(p.altName || p.name, p.lat, p.lng)}" target="_blank" rel="noopener">⭐ 看評價</a>`
              : `<a class="btn" href="${esc(p.mapsUrl || searchUrl(p.name, p.lat, p.lng))}" target="_blank" rel="noopener">🗺️ Google 地圖</a>`}</div>`;
    $('sheet').hidden = false;
  }
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('sheet').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').hidden = true; });

  function setCenter(c, label) {
    center = c; centerLabel = label;
    renderList();
    if (map) { renderMap(); map.setView([c.lat, c.lng], 15); }
  }

  $('seg-saved').addEventListener('click', () => { showRecs = false; renderList(); });
  $('seg-recs').addEventListener('click', () => { showRecs = true; renderList(); });
  $('distance').addEventListener('change', (e) => { maxDist = +e.target.value; renderList(); if (map) renderMap(); });
  $('use-gps').addEventListener('click', () => {
    if (!navigator.geolocation) { $('center-note').textContent = '這個瀏覽器無法定位'; return; }
    $('center-note').textContent = '正在取得位置…';
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }, '以你的位置為中心'),
      () => { $('center-note').textContent = '無法取得位置，請允許瀏覽器使用定位'; },
      { enableHighAccuracy: true, timeout: 15000 });
  });

  // --- 地圖 ---
  function renderMap() {
    if (!map) {
      map = L.map('map').setView([center.lat, center.lng], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      mapLayer = L.layerGroup().addTo(map);
    }
    mapLayer.clearLayers();
    const pin = (cls, html, style = '') => L.divIcon({ className: '', html: `<div class="pin ${cls}" style="${style}">${html}</div>`, iconSize: null });
    filtered(recs).slice(0, 300).forEach(({ p, m }) => L.marker([p.lat, p.lng], { icon: pin('rec', (CATS[p.category] || CATS.other).icon) }).on('click', () => openSheet(p, m)).addTo(mapLayer));
    filtered(saved).forEach(({ p, m }) => { const c = CATS[p.category] || CATS.other; L.marker([p.lat, p.lng], { icon: pin('', c.icon, `background:${c.color}`), zIndexOffset: 500 }).on('click', () => openSheet(p, m)).addTo(mapLayer); });
    L.marker([center.lat, center.lng], { icon: pin('me', ''), zIndexOffset: 1000 }).addTo(mapLayer);
    if (maxDist) L.circle([center.lat, center.lng], { radius: maxDist, color: '#1e88e5', weight: 1.5, fillOpacity: 0.06 }).addTo(mapLayer);
  }

  // --- Tabs ---
  function switchView(v) {
    view = v;
    ['trip', 'list', 'map'].forEach((n) => { $(`view-${n}`).hidden = n !== v; });
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('page-title').textContent = { trip: '行程', list: '附近的收藏', map: '地圖' }[v];
    if (v === 'list') renderList();
    if (v === 'map') { renderMap(); setTimeout(() => map.invalidateSize(), 50); }
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  load().catch((e) => { $('view-trip').innerHTML = `<p class="empty">找不到這個行程（${esc(e.message)}），請確認連結是否完整。</p>`; });
})();
