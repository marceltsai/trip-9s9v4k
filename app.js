// Read-only companion view of a trip from the 旅途口袋 app.
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
  // Where the trip is (usually its hotel), and whether the viewer's own
  // position has been asked for yet.
  let tripCenter = null, tripCenterLabel = '', askedGps = false;
  // Recommendations: the ones bundled for the trip's area plus those fetched
  // live around wherever the list is centered.
  let bundledRecs = [], recsNote = '', recsSeq = 0;
  const recsDone = [];

  // Trips the app keeps up to date live in the cloud; the files under data/
  // are the versions published from the computer. The cloud copy wins.
  const API_KEY = 'AIzaSyBKHEGlxuAqRE8zjO3sE9gZOu15lWYKZsk';
  const DOCS = 'https://firestore.googleapis.com/v1/projects/travel-pocket-61d1b/databases/(default)/documents';

  async function fetchCloud(id) {
    try {
      const r = await fetch(`${DOCS}/trips/${encodeURIComponent(id)}?key=${API_KEY}`, { cache: 'no-store' });
      if (!r.ok) return null;
      return JSON.parse((await r.json()).fields.json.stringValue);
    } catch (e) { return null; }
  }
  async function fetchStatic(id) {
    try {
      const r = await fetch(`data/${encodeURIComponent(id)}.json`);
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }

  async function load() {
    // No index of trips on purpose: each trip is reachable only by its own link.
    const id = params.get('trip');
    if (!id || !/^[\w-]+$/.test(id)) throw new Error('連結缺少行程代號');
    const [cloud, local] = await Promise.all([fetchCloud(id), fetchStatic(id)]);
    if (!cloud && !local) throw new Error('找不到這個行程');
    // Colors chosen in the app, when the cloud copy carries them.
    if (cloud && cloud.theme && window.applyShareTheme) window.applyShareTheme(cloud.theme);
    data = {
      trip: (cloud || local).trip,
      places: (cloud && cloud.places && cloud.places.length ? cloud : local || cloud).places || [],
      recs: (local && local.recs) || [],
    };
    trip = data.trip;
    trip.plans = trip.plans || [];
    // Old links name the lists; newer trips carry them in their data.
    const lists = params.get('lists')?.split(',').map((s) => s.trim()).filter(Boolean)
      || (trip.lists && trip.lists.length ? trip.lists : null);
    saved = data.places.filter((p) => !lists || p.lists.some((l) => lists.includes(l)));
    if (trip.ledgerId && /^[A-Za-z0-9]{10,64}$/.test(trip.ledgerId)) {
      const tab = document.createElement('a');
      tab.href = `ledger.html?id=${encodeURIComponent(trip.ledgerId)}`;
      tab.innerHTML = '<span class="ico">💰</span>分帳';
      document.querySelector('.tabbar').append(tab);
      document.querySelector('.tabbar').classList.add('four');
    }
    bundledRecs = data.recs;
    recs = cleanRecs(bundledRecs);
    // A trip made on the phone may have no located stop yet.
    tripCenter = trip.center || (saved[0] && { lat: saved[0].lat, lng: saved[0].lng }) || { lat: 25.0478, lng: 121.517 };
    tripCenterLabel = trip.lodging[0] ? `以 ${trip.lodging[0].name.split('（')[0]} 為中心` : '以行程地點為中心';
    center = tripCenter;
    centerLabel = tripCenterLabel;
    $('use-trip').textContent = trip.lodging[0] ? '🏨 以住宿為中心' : '🧳 以行程地點為中心';
    document.title = trip.title;
    renderTrip();
    renderChips();
    renderList();
    loadPhotos(id);
  }

  // Overpass elements → recommendations, without duplicates or saved places.
  function cleanRecs(elements) {
    const seen = new Set();
    return elements.map(toRec).filter(Boolean).filter((r) => {
      const key = `${r.name}@${r.lat.toFixed(3)},${r.lng.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      // Already saved places are not "recommendations".
      return !saved.some((p) => km(p, r) < 0.08 && (p.name.includes(r.name) || r.name.includes(p.name) || (r.altName && p.name.includes(r.altName))));
    });
  }

  // Looks up what is around the current center in OpenStreetMap, like the
  // app does, so recommendations work wherever the viewer is.
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  async function loadRecsAround(c, radius) {
    const r = Math.min(Math.max(radius || 3000, 500), 3000);
    // Already looked up a circle that covers this one.
    if (recsDone.some((d) => km(d.c, c) * 1000 + r <= d.r + 50)) return;
    const seq = ++recsSeq;
    recsNote = '正在找附近的推薦…';
    renderList();
    const around = `around:${r},${c.lat},${c.lng}`;
    const q = `[out:json][timeout:40];(nw(${around})["amenity"~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|food_court|place_of_worship)$"]["name"];nw(${around})["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park|hotel|hostel|guest_house|motel)$"]["name"];nw(${around})["shop"~"^(mall|department_store|bakery|confectionery|pastry|gift|books)$"]["name"];nw(${around})["historic"]["name"];nw(${around})["leisure"~"^(park|garden)$"]["name"];);out center tags qt;`;
    let elements = null;
    for (const url of OVERPASS) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 50000);
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        elements = (await res.json()).elements;
        break;
      } catch (e) { /* try the next server */ }
    }
    if (elements) {
      recsDone.push({ c, r });
      bundledRecs = bundledRecs.concat(elements);
      recs = cleanRecs(bundledRecs);
    }
    if (seq === recsSeq) recsNote = elements ? '' : '推薦資料暫時抓不到，稍後再試';
    renderList();
    if (map && view === 'map') renderMap();
  }

  // Pictures added in the app are small separate cloud entries.
  function loadPhotos(id) {
    document.querySelectorAll('img[data-photo]').forEach(async (el) => {
      try {
        const r = await fetch(`${DOCS}/trips/${encodeURIComponent(id)}_ph_${el.dataset.photo}?key=${API_KEY}`);
        if (!r.ok) return;
        const b64 = (await r.json()).fields.jpeg.stringValue;
        if (/^[A-Za-z0-9+/=]+$/.test(b64)) el.src = `data:image/jpeg;base64,${b64}`;
      } catch (e) { /* the card just stays without a picture */ }
    });
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
      out.push({ t: parse(l.checkIn), icon: '🛏️', title: `入住 ${l.name}`, sub: `${hm(parse(l.checkIn))} 後可入住 · ${l.nights} 晚`, lat: l.lat, lng: l.lng, q: l.lat == null ? (l.address || l.name) : null, stop: true });
      out.push({ t: parse(l.checkOut), icon: '🧳', title: '退房', sub: `${hm(parse(l.checkOut))} 前退房`, lat: l.lat, lng: l.lng, q: l.lat == null ? (l.address || l.name) : null });
    }
    for (const a of trip.activities) {
      out.push({ t: parse(a.entryStart), icon: '🎫', title: `${a.category} 換票入場`, sub: `${window_(a)} · ${a.venue}`, lat: a.lat, lng: a.lng, q: a.lat == null ? (a.address || a.venue || a.name) : null, stop: true });
    }
    for (const p of trip.plans) {
      out.push({
        t: parse(`${p.date}T${p.start || '00:00'}`), untimed: !p.start, icon: PLAN_ICON[p.category] || '📌',
        title: p.title || p.place,
        sub: [p.end ? `到 ${p.end}` : '', p.place && p.place !== p.title ? p.place : '', p.note || ''].filter(Boolean).join(' · '),
        lat: p.lat, lng: p.lng, q: p.lat == null ? p.place : null, stop: true,
      });
    }
    out.forEach((e, i) => { e.i = i; });
    // Same-time items keep their order; untimed plans come first on their day.
    return out.sort((a, b) => (a.t - b.t) || ((a.untimed ? 0 : 1) - (b.untimed ? 0 : 1)) || (a.i - b.i));
  }
  // The dashed path with a small chubby cartoon airliner (same shapes as the
  // app's cartoon_plane.dart) flying along it from the first airport code to
  // the second, leaving little puffs. With reduced motion on, it rests near the end.
  const ARC = 'M4 30 Q50 -14 82 22';
  const PL = {
    body: 'M19 1 C19 -8 10 -10.5 2 -10 C-8 -9.5 -16 -7 -22 -3.5 Q-24.5 -1.5 -22 0.8 C-16 4.5 -8 8.5 2 8.8 C10 9.2 19 8 19 1 Z',
    farWing: 'M3 -6 L-5 -16 Q-7.5 -18.5 -10 -16.2 L-7 -6 Z',
    nearWing: 'M6 2 L-3 14.5 Q-5.5 17.5 -9 15.6 L-6.5 3 Z',
    fin: 'M-12 -6.5 L-18.5 -17 Q-20.5 -19.5 -22.5 -17 L-21.5 -3.5 Z',
    farTail: 'M-15 -3 L-21 -8 Q-23 -9.5 -24 -7 L-20.5 -1.5 Z',
    nearTail: 'M-15 1.5 L-21.5 6 Q-23.5 7.5 -24.5 5 L-21 0.2 Z',
  };
  const TIP = '#FFC83D';
  const EDGE = 'stroke="rgba(0,0,0,.28)" stroke-width=".8" stroke-linejoin="round"';
  const part = (d, extra = '') => `<path d="${d}" style="fill:var(--primary)"/><path d="${d}" fill="url(#plShade)"/>${extra}<path d="${d}" fill="none" ${EDGE}/>`;
  const PLANE_SHAPES = `<defs><linearGradient id="plShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
    <clipPath id="plBody"><path d="${PL.body}"/></clipPath><clipPath id="plFar"><path d="${PL.farWing}"/></clipPath><clipPath id="plNear"><path d="${PL.nearWing}"/></clipPath></defs>
    <g fill="none" stroke="#fff" stroke-width="4.8" stroke-linejoin="round">${Object.values(PL).map((d) => `<path d="${d}"/>`).join('')}<rect x="-3" y="7" width="8.5" height="5" rx="2.5"/></g>
    ${part(PL.farWing, `<rect x="-11" y="-19.5" width="15" height="4.2" fill="${TIP}" clip-path="url(#plFar)"/><path d="${PL.farWing}" fill="#000" opacity=".12"/>`)}
    ${part(PL.farTail, `<path d="${PL.farTail}" fill="#000" opacity=".12"/>`)}
    ${part(PL.fin)}
    ${part(PL.body, `<g clip-path="url(#plBody)"><ellipse cx="19.75" cy="0" rx="12.25" ry="14" fill="#F3F6FA" stroke="rgba(0,0,0,.15)"/><rect x="-12" y="-8.6" width="16" height="2" rx="1" fill="#fff" opacity=".45"/></g>`)}
    <rect x="10.5" y="-7" width="6.3" height="5.2" rx="2.6" fill="#fff" opacity=".92" ${EDGE}/>
    ${[4, -0.8, -5.6, -10.4].map((x) => `<rect x="${x - 1.6}" y="-6.2" width="3.2" height="4.6" rx="1.6" fill="#fff" opacity=".85" stroke="${TIP}" stroke-width=".7"/>`).join('')}
    ${part(PL.nearTail)}
    ${part(PL.nearWing, `<rect x="-11" y="13.2" width="18" height="5" fill="${TIP}" clip-path="url(#plNear)"/>`)}
    <rect x="-3" y="7" width="8.5" height="5" rx="2.5" fill="#EEF2F6" ${EDGE}/><ellipse cx="5" cy="9.5" rx="1.4" ry="1.9" style="fill:var(--primary)"/><ellipse cx="5.1" cy="9.5" rx=".7" ry=".9" fill="#fff"/>`;
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DUR = '4.2s';
  const MOTION = (begin) => `<animateMotion dur="${DUR}" begin="${begin}s" repeatCount="indefinite" path="${ARC}" rotate="auto" calcMode="spline" keyTimes="0;.85;1" keyPoints="0;1;1" keySplines=".42 0 .58 1;0 0 1 1"/>`;
  function flightArc() {
    let plane;
    if (still) {
      plane = `<g transform="translate(76 21) rotate(40) scale(.9)">${PLANE_SHAPES}</g>`;
    } else {
      const puffs = [1, 2, 3, 4].map((k) => `<circle r="${(3.6 - k * 0.6).toFixed(1)}" style="fill:var(--secondary)" opacity="0">${MOTION((k * 0.13).toFixed(2))}<animate attributeName="opacity" begin="${(k * 0.13).toFixed(2)}s" values="0;${(0.5 - k * 0.1).toFixed(1)};${(0.5 - k * 0.1).toFixed(1)};0;0" keyTimes="0;.02;.85;.98;1" dur="${DUR}" repeatCount="indefinite"/></circle>`).join('');
      plane = `${puffs}<g>${MOTION(0)}<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;.85;.98;1" dur="${DUR}" repeatCount="indefinite"/><g><animateTransform attributeName="transform" type="rotate" values="-4;4;-4" dur=".84s" repeatCount="indefinite"/><g transform="scale(.9)">${PLANE_SHAPES}</g></g></g>`;
    }
    return `<svg viewBox="0 0 100 34" aria-hidden="true"><path d="${ARC}" fill="none" stroke="currentColor" stroke-opacity=".4" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 6"/>${plane}</svg>`;
  }  const PLAN_ICON = { sight: '⛩️', food: '🍽️', transport: '🚆', shopping: '🛍️', other: '📌' };
  const dest = (e) => e.lat != null ? `${e.lat},${e.lng}` : e.q || null;
  // Google Maps directions through a day's stops from wherever the viewer is.
  function routeUrl(dayEvents) {
    const stops = dayEvents.filter((e) => e.stop).map(dest).filter(Boolean).slice(0, 10);
    if (stops.length < 2) return null;
    const u = new URL('https://www.google.com/maps/dir/');
    u.searchParams.set('api', '1');
    u.searchParams.set('destination', stops[stops.length - 1]);
    u.searchParams.set('waypoints', stops.slice(0, -1).join('|'));
    return u.toString();
  }
  const airport = (code) => ({ TPE: 'Taoyuan International Airport Terminal 1', FUK: 'Fukuoka Airport International Terminal', PUS: 'Gimhae International Airport' }[code]);
  const window_ = (a) => a.entryEnd ? `${hm(parse(a.entryStart))}–${hm(parse(a.entryEnd))}` : hm(parse(a.entryStart));
  const navTo = (e) => e.lat != null ? navUrl(e.lat, e.lng) : e.q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.q)}` : null;

  function renderTrip() {
    const start = parse(trip.startDate), end = parse(trip.endDate), today = dayOnly(new Date());
    const days = daysBetween(start, end) + 1;
    const [big, small] = today < start ? [daysBetween(today, start), '天後出發'] : today <= end ? ['✈', `旅行第 ${daysBetween(start, today) + 1} 天`] : ['✓', '已結束'];
    let h = `<div class="hero"><div style="flex:1;min-width:0"><h2>${esc(trip.title)}</h2>
      <div class="dates">${md(start)} – ${md(end)}</div><div class="nights">${days} 天 ${days - 1} 夜</div></div>
      <div class="countdown"><b>${big}</b><span>${small}</span></div></div>`;
    if (trip.ledgerId && /^[A-Za-z0-9]{10,64}$/.test(trip.ledgerId)) {
      h += `<a class="card pad ledger-link" href="ledger.html?id=${encodeURIComponent(trip.ledgerId)}">
        <span class="ico">💰</span><span><b>分帳</b><small>每個人付了多少、還欠多少</small></span><span aria-hidden="true">›</span></a>`;
    }

    if (trip.reminders.length) {
      h += `<div class="card pad reminders"><h3>🔔 注意事項</h3>${trip.reminders.map((r, i) => [r, i]).sort((a, b) => (parse(a[0].date) - parse(b[0].date)) || (a[1] - b[1])).map(([r]) => {
        const d = parse(r.date);
        return `<div class="reminder${d < today ? ' past' : ''}"><b>${md(d)}</b><span>${esc(r.text)}</span></div>`;
      }).join('')}</div>`;
    }

    if (trip.flights.length) h += '<div class="section-title">航班</div>';
    for (const leg of trip.flights) {
      const f = leg.segments[0], l = leg.segments[leg.segments.length - 1];
      // A return trip reads right to left, like the plane flies.
      const back = leg.direction === '回程';
      const fromName = esc(f.from.split(' ')[1] || ''), toName = esc(l.to.split(' ')[1] || '');
      h += `<div class="card pad"><div class="leg-head">${back ? '🛬' : '🛫'} ${esc(leg.direction)}　${back ? `${toName} ← ${fromName}` : `${fromName} → ${toName}`}<span class="date">${md(parse(f.depart))}</span></div>`;
      leg.segments.forEach((s, i) => {
        const fc = s.from.split(' ')[0], tc = s.to.split(' ')[0];
        const dep = parse(s.depart), arr = parse(s.arrive);
        const mins = Math.round((arr - dep) / 60000) - (utcOffset(tc) - utcOffset(fc)) * 60;
        const dur = `${Math.floor(mins / 60)} 小時${mins % 60 ? ` ${mins % 60} 分` : ''}`;
        const plus = daysBetween(dep, arr);
        // Where it takes off and where it lands; a return flight swaps the sides
        // and the plane flies right to left.
        const fromBlock = (end) => `<div${end ? ' class="end"' : ''}><div class="code">${esc(fc)}</div><div class="time">${hm(dep)}</div><div class="name">${esc(s.from.slice(fc.length).trim())}</div></div>`;
        const toBlock = (end) => `<div${end ? ' class="end"' : ''}><div class="code">${esc(tc)}</div><div class="time">${hm(arr)}${plus > 0 ? ` +${plus}` : ''}</div><div class="name">${esc(s.to.slice(tc.length).trim())}</div></div>`;
        h += `<div class="seg">${back ? toBlock(false) : fromBlock(false)}
          <div class="arc${back ? ' flip' : ''}">${flightArc()}${dur}</div>
          ${back ? fromBlock(true) : toBlock(true)}</div>
          <div class="tags"><span class="tag">✈ ${esc(s.flight)}</span><span class="tag">${esc(s.airline)}</span>
          ${airport(fc) ? `<a class="btn" style="margin-left:auto;padding:4px 12px" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(airport(fc))}" target="_blank" rel="noopener">導航到機場</a>` : ''}</div>`;
        if (i < leg.segments.length - 1 && leg.layover) h += `<div class="layover">⏱️ 轉機　${esc(leg.layover)}</div>`;
      });
      h += '</div>';
    }

    if (trip.lodging.length) h += '<div class="section-title">住宿</div>';
    for (const l of trip.lodging) {
      h += placeCard({ image: l.image, photo: l.photo, title: l.name, badge: `${l.nights} 晚`, lat: l.lat, lng: l.lng, mapsUrl: l.mapsUrl, q: l.address || l.name,
        boxes: `<div class="datebox"><small>入住</small><b>${md(parse(l.checkIn))}</b>${hm(parse(l.checkIn))} 後</div><span>→</span><div class="datebox"><small>退房</small><b>${md(parse(l.checkOut))}</b>${hm(parse(l.checkOut))} 前</div>`,
        lines: [['📍', l.address], ['🛏️', l.room], ['📅', l.cancellation]] });
    }

    if (trip.activities.length) h += '<div class="section-title">活動與票券</div>';
    for (const a of trip.activities) {
      h += placeCard({ image: a.image, photo: a.photo, title: a.name, badge: a.category, lat: a.lat, lng: a.lng, mapsUrl: a.mapsUrl, q: a.address || a.venue || a.name,
        boxes: `<div class="datebox"><small>換票入場</small><b>${md(parse(a.entryStart))}</b>${window_(a)}</div><div class="datebox"><small>票種</small><b>${esc(a.ticket)}</b>&nbsp;</div>`,
        lines: [['🏟️', a.venue], ['📍', a.address]],
        warn: a.notes.length ? `<div class="warn"><b>❗ 入場須知</b><ul>${a.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '' });
    }

    const costs = trip.costs || [];
    if (costs.length) {
      const totals = {};
      costs.forEach((c) => { totals[c.currency] = (totals[c.currency] || 0) + Number(c.amount || 0); });
      const amt = (n, cur) => `${esc(cur)} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
      h += `<div class="section-title">費用</div><div class="card pad costs">
        ${costs.map((c) => `<div class="line"><span style="flex:1">${esc(c.label)}${c.date ? ` <small>${md(parse(c.date.slice(0, 10)))}</small>` : ''}</span><b>${amt(c.amount, c.currency)}</b></div>`).join('')}
        <div class="line total-line"><span style="flex:1">合計</span><b>${Object.entries(totals).map(([cur, n]) => amt(n, cur)).join(' + ')}</b></div>
        ${trip.ledgerId ? `<p class="center-note">每個人付了多少、還欠多少，請看<a href="ledger.html?id=${encodeURIComponent(trip.ledgerId)}">分帳</a></p>` : ''}
      </div>`;
    }

    h += '<div class="section-title">每日行程</div><div class="card pad timeline">';
    const evs = events();
    let day = null;
    evs.forEach((e, i) => {
      const d = dayOnly(e.t);
      if (+d !== +day) {
        day = d;
        const route = routeUrl(evs.filter((x) => +dayOnly(x.t) === +d));
        h += `<div class="day"><b>第 ${daysBetween(start, d) + 1} 天</b>${md(d)}${route ? `<a class="btn day-route" href="${esc(route)}" target="_blank" rel="noopener">🗺️ 當天路線</a>` : ''}</div>`;
      }
      const last = i === evs.length - 1 || +dayOnly(evs[i + 1].t) !== +d;
      const nav = navTo(e);
      h += `<div class="ev"><div class="t">${e.untimed ? '待定' : hm(e.t)}</div><div class="rail"><div class="dot">${e.icon}</div>${last ? '' : '<div class="bar"></div>'}</div>
        <div class="txt"><b>${esc(e.title)}</b><small>${esc(e.sub)}</small></div>
        ${nav ? `<a class="nav" href="${esc(nav)}" target="_blank" rel="noopener" aria-label="導航">🧭</a>` : '<span></span>'}</div>`;
    });
    if (!evs.length) h += '<p class="empty">還沒有行程</p>';
    h += '</div>';

    if (trip.baggage) h += `<div class="section-title">行李</div><div class="card pad">🧳 ${esc(trip.baggage)}</div>`;
    h += '<p class="credit">由「旅途口袋」App 分享 · 唯讀頁面</p>';
    $('view-trip').innerHTML = h;

    document.querySelectorAll('[data-nearby]').forEach((b) => b.addEventListener('click', () => {
      const [lat, lng, rec] = b.dataset.nearby.split(',');
      askedGps = true;
      setCenter({ lat: +lat, lng: +lng }, `以 ${b.dataset.label} 為中心`);
      showRecs = rec === '1';
      switchView('list');
    }));
  }

  function placeCard(o) {
    const lines = o.lines.filter(([, v]) => v).map(([i, v]) => `<div class="line"><span>${i}</span><span>${esc(v)}</span></div>`).join('');
    const short = esc(o.title.split('（')[0].split('「')[0]);
    // Stays added by hand may have no coordinates yet: navigate by name or address.
    const located = o.lat != null && o.lng != null;
    return `<div class="card">
      <div class="photo">${o.photo && /^[a-z0-9]+$/.test(o.photo) ? `<img data-photo="${o.photo}" alt="">` : o.image ? `<img src="images/${esc(o.image.split('/').pop())}" alt="">` : ''}<h3>${esc(o.title)}</h3>${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ''}</div>
      <div class="pad"><div class="dates2">${o.boxes}</div><div style="margin-top:10px">${lines}</div>${o.warn || ''}
      <div class="actions"><a class="btn fill" href="${esc(located ? navUrl(o.lat, o.lng) : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.q || o.title)}`)}" target="_blank" rel="noopener">🧭 導航</a>
        ${located ? `<button class="btn" type="button" data-nearby="${o.lat},${o.lng},0" data-label="${short}">📌 附近收藏</button>
        <button class="btn" type="button" data-nearby="${o.lat},${o.lng},1" data-label="${short}">✨ 附近推薦</button>` : ''}
        <a class="btn" href="${esc(o.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.q || o.title)}`)}" target="_blank" rel="noopener">🗺️ 地圖</a></div></div></div>`;
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
    $('center-note').textContent = `${centerLabel}，依距離排序${showRecs && recsNote ? `　${recsNote}` : ''}`;
    const items = showRecs ? r : s;
    const ul = $('places');
    if (!items.length) {
      // Far from the trip, its saved places are simply not nearby.
      const far = !showRecs && center !== tripCenter && saved.length && km(center, tripCenter) > 30;
      ul.innerHTML = `<li class="empty" style="display:block">${showRecs && recsNote ? esc(recsNote)
        : far ? '你現在離這趟行程的地點很遠，附近沒有這趟行程的收藏。可以按上面的「以住宿為中心」看行程那邊的收藏。'
        : `這個範圍內沒有${showRecs ? '推薦地點' : '收藏'}，試試放大距離`}</li>`;
    } else {
      ul.innerHTML = items.slice(0, 300).map(({ p, m }, i) => {
        const c = CATS[p.category] || CATS.other;
        const sub = p.rec ? [fmtDist(m), p.kind, p.hours].filter(Boolean).join(' · ') : `${fmtDist(m)} · ${p.lists.join('、')}`;
        return `<li data-i="${i}"><div class="ic${p.rec ? ' rec' : ''}" style="${p.rec ? '' : `background:${c.color}`}">${c.icon}</div>
          <div class="main"><b>${esc(p.name)}</b><small>${esc(sub)}</small></div>
          <span class="acts"><a class="nav" href="${esc(mapUrl(p))}" target="_blank" rel="noopener" aria-label="Google 地圖">🗺️</a><a class="nav" href="${navUrl(p.lat, p.lng)}" target="_blank" rel="noopener" aria-label="導航">🧭</a></span></li>`;
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

  const mapUrl = (p) => p.mapsUrl || searchUrl(p.altName || p.name, p.lat, p.lng);

  function openSheet(p, m) {
    const c = CATS[p.category] || CATS.other;
    $('sheet-body').innerHTML = `<h3>${c.icon} ${esc(p.name)}</h3>
      ${p.altName ? `<div class="sub">${esc(p.altName)}</div>` : ''}
      <p class="sub">${esc(p.rec ? p.kind : c.label)} · 距離 ${fmtDist(m)}</p>
      ${p.address ? `<p>📍 ${esc(p.address)}</p>` : ''}
      ${p.hours ? `<p>🕒 ${esc(p.hours)}</p>` : ''}
      ${p.lists ? `<div class="lists">${p.lists.map((l) => `<span class="tag">${esc(l)}</span>`).join('')}</div>` : '<p class="sub">附近推薦（OpenStreetMap），不是收藏</p>'}
      <div class="actions"><a class="btn fill" href="${navUrl(p.lat, p.lng)}" target="_blank" rel="noopener">🧭 導航</a>
      <a class="btn" href="${esc(mapUrl(p))}" target="_blank" rel="noopener">🗺️ Google 地圖</a></div>`;
    $('sheet').hidden = false;
  }
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('sheet').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').hidden = true; });

  function setCenter(c, label) {
    center = c; centerLabel = label;
    renderList();
    if (map) { renderMap(); map.setView([c.lat, c.lng], 15); }
    loadRecsAround(c, maxDist);
  }

  // Centers on where the viewer is. Without permission (or a position) the
  // list says so and stays on the trip's own place.
  function useGps(auto) {
    askedGps = true;
    const fallback = (why) => {
      if (auto) { centerLabel = `${why}，目前${tripCenterLabel}`; renderList(); loadRecsAround(center, maxDist); }
      else $('center-note').textContent = `${why}，請允許瀏覽器使用定位`;
    };
    if (!navigator.geolocation) { fallback('這個瀏覽器無法定位'); return; }
    $('center-note').textContent = '正在取得你的位置…';
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }, '以你的位置為中心'),
      () => fallback('無法取得你的位置'),
      { enableHighAccuracy: true, timeout: 15000 });
  }

  $('seg-saved').addEventListener('click', () => { showRecs = false; renderList(); });
  $('seg-recs').addEventListener('click', () => { showRecs = true; renderList(); });
  $('distance').addEventListener('change', (e) => { maxDist = +e.target.value; renderList(); if (map) renderMap(); loadRecsAround(center, maxDist); });
  $('use-gps').addEventListener('click', () => useGps(false));
  $('use-trip').addEventListener('click', () => { askedGps = true; setCenter(tripCenter, tripCenterLabel); });

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
    // The first look at the list or map centers on the viewer, unless a
    // "nearby" button on a trip card already chose a center.
    if ((v === 'list' || v === 'map') && !askedGps) useGps(true);
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  load().catch((e) => { $('view-trip').innerHTML = `<p class="empty">找不到這個行程（${esc(e.message)}），請確認連結是否完整。</p>`; });
})();

