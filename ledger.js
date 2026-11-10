// Read-only expense page for companions. The app works out every figure and
// publishes it, so this page only displays; it holds no calculation of its own.
(() => {
  'use strict';

  // Public Firebase web config. The database rules are what protect the data:
  // anyone with a ledger's secret id can read it, only the owner can write.
  const API_KEY = 'AIzaSyBKHEGlxuAqRE8zjO3sE9gZOu15lWYKZsk';
  const DOCS = 'https://firestore.googleapis.com/v1/projects/travel-pocket-61d1b/databases/(default)/documents';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const id = new URLSearchParams(location.search).get('id') || '';
  let data = null;
  let view = 'entries';
  let person = '';
  let debtPerson = '';
  const images = new Map();
  const receiptsById = () => new Map((data.receipts || []).map((r) => [r.id, r]));

  const whole = (n) => Math.round(Math.abs(n)).toLocaleString('en-US');
  const money = (n, cur = data.baseCurrency) => `${n < 0 ? '-' : ''}${cur} ${whole(n)}`;
  const exact = (n, cur) => `${cur} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const WEEK = '日一二三四五六';

  function parseDate(s) {
    const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function dayLabel(s) {
    const d = parseDate(s);
    return d ? `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` : (s || '');
  }

  async function load() {
    if (!/^[A-Za-z0-9]{10,64}$/.test(id)) return fail('這個連結不完整，請向分享的人重新要一次。');
    $('reload').disabled = true;
    try {
      const res = await fetch(`${DOCS}/ledgers/${id}?key=${API_KEY}`, { cache: 'no-store' });
      if (res.status === 404) return fail('這本帳已停止分享，或連結不正確。');
      if (!res.ok) throw new Error(String(res.status));
      const doc = await res.json();
      data = JSON.parse(doc.fields.json.stringValue);
      if (data.theme && window.applyShareTheme) window.applyShareTheme(data.theme);
      $('status').textContent = '';
      $('tabs').hidden = false;
      document.title = `${data.title} 分帳`;
      $('page-title').textContent = data.title;
      render();
    } catch (e) {
      if (data) return; // Keep showing what's already on screen.
      fail('目前讀取不到資料，請確認網路後再試。', true);
    } finally {
      $('reload').disabled = false;
    }
  }

  function fail(message, retry) {
    $('tabs').hidden = true;
    document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
    $('status').innerHTML = esc(message) +
      (retry ? '<br><button class="btn" type="button" id="retry">再試一次</button>' : '');
    if (retry) $('retry').onclick = load;
  }

  function render() {
    for (const b of document.querySelectorAll('#tabs button')) {
      const on = b.dataset.view === view;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
    ({ entries: renderEntries, settle: renderSettle, pays: renderPays,
       fund: renderFund, debts: renderDebts, receipts: renderReceipts })[view]();
  }

  function personChips(current, withAll) {
    const chip = (value, label) => `<button type="button" class="chip ${current === value ? 'on' : ''}" data-person="${esc(value)}" aria-pressed="${current === value}">${esc(label)}</button>`;
    return `<div class="chips person-chips" role="group" aria-label="選擇成員">
      ${withAll ? chip('', '全部') : ''}${data.members.map((m) => chip(m, m)).join('')}
    </div>`;
  }
  function bindChips(root, choose) {
    root.querySelectorAll('[data-person]').forEach((b) => {
      b.onclick = () => { choose(b.dataset.person); render(); };
    });
  }
  function savePerson() { try { localStorage.setItem('ledgerPerson', person); } catch (e) { /* optional */ } }

  function renderEntries() {
    const root = $('view-entries');
    const shown = data.entries.filter((e) => !person ||
      (e.isFundIncome ? e.payer === person : e.split[person] !== undefined || e.payer === person));
    const mine = person ? shown.reduce((s, e) => s + (e.split[person] || 0), 0) : null;
    let html = `<div class="total">
        <small>${person ? `${esc(person)} 應分攤` : '總支出'}</small>
        <b>${money(person ? mine : data.totalSpent)}</b>
        ${data.entries.some((e) => e.isFundIncome) ? `<div class="sub">公基金餘額 ${money(data.fundBalance)}</div>` : ''}
      </div>
      <p class="updated">最後更新 ${esc(new Date(data.updatedAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }))}</p>
      ${data.tripUrl ? `<p class="back"><a href="${esc(data.tripUrl)}">看這趟旅程的行程 →</a></p>` : ''}
      ${personChips(person, true)}`;
    if (!shown.length) html += '<p class="empty">還沒有紀錄</p>';
    let day = null;
    let open = false;
    shown.forEach((e) => {
      const d = (e.date || '').slice(0, 10);
      if (d !== day) {
        if (open) html += '</ul>';
        html += `<h2 class="day-title">${esc(dayLabel(e.date))}</h2><ul class="rows">`;
        open = true;
        day = d;
      }
      const share = person && e.split[person] !== undefined ? e.split[person] : null;
      html += `<li><button type="button" class="row" data-entry="${esc(e.id)}">
        <span aria-hidden="true">${e.isFundIncome ? '🐷' : '🧾'}</span>
        <span class="grow"><b>${esc(e.item || (e.isFundIncome ? '公基金收入' : '支出'))}</b>
          <small>${esc(e.isFundIncome ? `${e.payer} 繳入` : `${e.payer} 付 · ${Object.keys(e.split).length} 人分攤`)}${e.note ? ` · ${esc(e.note)}` : ''}</small></span>
        <span class="amt">${e.isFundIncome ? '+' : ''}${exact(e.amount, e.currency)}
          ${share !== null ? `<small>你 ${money(share)}</small>` : (e.currency !== data.baseCurrency ? `<small>≈ ${money(e.base)}</small>` : '')}</span>
      </button></li>`;
    });
    if (open) html += '</ul>';
    root.innerHTML = html;
    bindChips(root, (p) => { person = p; savePerson(); });
    root.querySelectorAll('[data-entry]').forEach((b) => {
      b.onclick = () => openEntry(data.entries.find((e) => e.id === b.dataset.entry));
    });
  }

  function renderSettle() {
    const root = $('view-settle');
    let html = '<h2 class="section-title">最少轉帳方式</h2>';
    if (data.fundBalance < -0.5) {
      html += `<p class="note-warn">公基金超支 ${money(-data.fundBalance)}，所以大家要補錢進公基金。</p>`;
    }
    if (!data.clearance.length) {
      html += '<div class="card pad">目前沒有需要轉帳的金額 🎉</div>';
    } else {
      html += `<ul class="rows">${data.clearance.map((t) => `<li><div class="row">
        <span class="grow"><b>${esc(t.from)} → ${esc(t.to)}</b></span>
        <span class="amt">${money(t.amount)}</span></div></li>`).join('')}</ul>`;
    }
    html += '<h2 class="section-title">每人明細</h2>';
    html += data.settlements.map((s) => {
      const net = Math.round(s.net);
      const badge = net === 0 ? '<span>已結清</span>'
        : net > 0 ? `<span class="due">應收 ${money(s.net)}</span>`
        : `<span class="owed">應付 ${money(-s.net)}</span>`;
      const fig = (k, v) => `<div><dt>${k}</dt><dd>${whole(v)}</dd></div>`;
      return `<div class="card pad">
        <div class="person-head"><h3>${esc(s.person)}</h3>${badge}</div>
        <dl class="figures">${fig('代墊', s.advanced)}${fig('已繳公基金', s.fundPaid)}${fig('應分攤', s.shouldPay)}${fig('已還', s.paidOut)}${fig('已收', s.received)}</dl>
      </div>`;
    }).join('');
    root.innerHTML = html;
  }

  function renderPays() {
    const root = $('view-pays');
    root.innerHTML = data.payments.length
      ? `<ul class="rows">${data.payments.map((p) => `<li><div class="row">
          <span class="grow"><b>${esc(p.payer)} → ${esc(p.payee)}</b>
            <small>${esc(dayLabel(p.date))}${p.note ? ` · ${esc(p.note)}` : ''}</small></span>
          <span class="amt">${exact(p.amount, p.currency)}</span></div></li>`).join('')}</ul>`
      : '<p class="empty">還沒有還款紀錄</p>';
  }

  function renderFund() {
    const root = $('view-fund');
    const out = data.entries.filter((e) => !e.isFundIncome && e.payer === data.fundName);
    root.innerHTML = `<div class="total"><small>公基金餘額</small><b>${money(data.fundBalance)}</b></div>
      <h2 class="section-title">各成員繳納</h2>
      <ul class="rows">${data.settlements.map((s) => `<li><div class="row">
        <span class="grow"><b>${esc(s.person)}</b></span><span class="amt">${money(s.fundPaid)}</span></div></li>`).join('')}</ul>
      <h2 class="section-title">公基金支出 ${out.length} 筆</h2>
      ${out.length ? `<ul class="rows">${out.map((e) => `<li><div class="row">
        <span class="grow"><b>${esc(e.item)}</b><small>${esc(dayLabel(e.date))}</small></span>
        <span class="amt">-${money(e.base)}</span></div></li>`).join('')}</ul>` : '<p class="empty">沒有支出</p>'}`;
  }

  function renderDebts() {
    const root = $('view-debts');
    const who = data.members.includes(debtPerson) ? debtPerson
      : (data.members.includes(person) ? person : data.members[0]);
    const debts = (data.debts && data.debts[who]) || {};
    const payees = Object.keys(debts);
    const s = data.settlements.find((x) => x.person === who);
    let html = `${personChips(who, false)}
      <p class="note">逐筆列出每個人欠誰，已還的部分從最早的項目扣除。實際轉帳請看「結算」，金額已互相抵銷。</p>`;
    if (!payees.length) {
      html += `<div class="card pad">${esc(who)} 沒有欠其他成員的項目${s && Math.round(s.net) < 0 ? `<br><small>要補進公基金的部分請看「結算」，共 ${money(-s.net)}</small>` : ''}</div>`;
    }
    for (const payee of payees) {
      const lines = debts[payee];
      const sum = lines.reduce((a, l) => a + l.amount, 0);
      html += `<h2 class="section-title">欠 ${esc(payee)} ${money(sum)}</h2>
        <ul class="rows">${lines.map((l) => `<li><div class="row">
          <span class="grow"><b>${esc(l.item)}</b><small>${esc(dayLabel(l.date))}</small></span>
          <span class="amt">${money(l.amount)}</span></div></li>`).join('')}</ul>`;
    }
    root.innerHTML = html;
    bindChips(root, (p) => { debtPerson = p; });
  }

  async function receiptImage(rid) {
    if (!images.has(rid)) {
      images.set(rid, fetch(`${DOCS}/ledgers/${id}/receipts/${rid}?key=${API_KEY}`).then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const doc = await res.json();
        return `data:image/jpeg;base64,${doc.fields.data.bytesValue}`;
      }).catch((e) => { images.delete(rid); throw e; }));
    }
    return images.get(rid);
  }

  function renderReceipts() {
    const root = $('view-receipts');
    const list = data.receipts || [];
    if (!list.length) { root.innerHTML = '<p class="empty">沒有收據</p>'; return; }
    const missing = list.filter((r) => !r.hasImage).length;
    root.innerHTML = `${missing ? `<p class="note">${missing} 張舊收據的圖片還沒補上。</p>` : ''}
      <div class="grid">${list.map((r) => `<button type="button" class="shot" data-receipt="${esc(r.id)}" ${r.hasImage ? '' : 'disabled'}>
        <div class="pic" id="pic-${esc(r.id)}">${r.hasImage ? '載入中…' : '圖片未上傳'}</div>
        <div class="cap">${esc([r.code, r.name].filter(Boolean).join(' '))}</div>
      </button>`).join('')}</div>`;
    root.querySelectorAll('[data-receipt]').forEach((b) => {
      b.onclick = () => openReceipt(receiptsById().get(b.dataset.receipt));
    });
    (async () => { // One at a time so a slow phone isn't flooded.
      for (const r of list.filter((x) => x.hasImage)) {
        const box = $(`pic-${r.id}`);
        if (!box) continue;
        try {
          const src = await receiptImage(r.id);
          const img = new Image();
          img.alt = [r.code, r.name].filter(Boolean).join(' ');
          img.src = src;
          box.replaceChildren(img);
        } catch (e) { box.textContent = '讀取失敗'; }
      }
    })();
  }

  function openSheet(html) {
    $('sheet-body').innerHTML = `${html}<button type="button" class="btn close" id="sheet-close">關閉</button>`;
    $('sheet').hidden = false;
    $('sheet-close').onclick = closeSheet;
    $('sheet-close').focus();
  }
  function closeSheet() { $('sheet').hidden = true; $('sheet-body').innerHTML = ''; }

  function openEntry(e) {
    if (!e) return;
    const byId = receiptsById();
    const linked = (e.receiptIds || []).map((r) => byId.get(r)).filter(Boolean);
    const rate = e.currency !== data.baseCurrency
      ? `<p class="sub">${money(e.base)}（匯率 1 ${esc(e.currency)} = ${e.rate} ${esc(data.baseCurrency)}）</p>` : '';
    const split = Object.entries(e.split).map(([m, v]) =>
      `<div class="share-row"><span>${esc(m)}</span><b>${money(v)}</b></div>`).join('');
    openSheet(`<h3>${esc(e.item || (e.isFundIncome ? '公基金收入' : '支出'))}</h3>
      <p class="sub">${esc(dayLabel(e.date))} · ${esc(e.payer)} ${e.isFundIncome ? '繳入' : '付款'}</p>
      <div class="sheet-amount">${exact(e.amount, e.currency)}</div>${rate}
      ${e.note ? `<p>${esc(e.note)}</p>` : ''}
      ${split ? `<h4>分攤</h4>${split}` : ''}
      ${linked.map((r) => r.hasImage
        ? `<div class="big-receipt" data-big="${esc(r.id)}">載入 ${esc(r.code)}…</div>`
        : `<p class="note">${esc(r.code)}：圖片未上傳</p>`).join('')}`);
    document.querySelectorAll('[data-big]').forEach((box) => showBig(box, box.dataset.big));
  }

  function openReceipt(r) {
    if (!r || !r.hasImage) return;
    const items = data.entries.filter((e) => (e.receiptIds || []).includes(r.id));
    openSheet(`<h3>${esc([r.code, r.name].filter(Boolean).join(' '))}</h3>
      ${items.map((e) => `<p class="sub">${esc(e.item)} · ${money(e.base)}</p>`).join('')}
      <div class="big-receipt" id="big">載入中…</div>`);
    showBig($('big'), r.id);
  }

  async function showBig(box, rid) {
    try {
      const img = new Image();
      img.alt = '收據';
      img.src = await receiptImage(rid);
      box.replaceChildren(img);
    } catch (e) { box.textContent = '圖片讀取失敗'; }
  }

  $('tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    view = b.dataset.view;
    render();
    scrollTo(0, 0);
  });
  $('reload').onclick = load;
  $('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) closeSheet(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && data) load(); });
  try { person = localStorage.getItem('ledgerPerson') || ''; } catch (e) { /* optional */ }

  load();
})();
