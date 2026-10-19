// Vibe2Trip · lib/render.mjs — bundle → 心动旅行卡（Markdown + 自包含 HTML）
const VIBE_DIMS = [
  ['morphology', '地貌场景'], ['palette', '色调光线'], ['mood', '氛围情绪'],
  ['activity', '活动暗示'], ['pace', '节奏快慢'], ['season', '季节感'],
  ['culture_nature', '人文/自然'],
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtList = (v) => Array.isArray(v) ? v.join('、') : (v || '图中未体现');

// 飞猪体验模式价格可能被掩码成 "¥1xx" / "¥6x"；正式 Key 才是真实数字
export function parsePrice(p) {
  if (p == null) return { num: null, masked: false, raw: '—' };
  if (typeof p === 'number') return { num: p, masked: false, raw: '¥' + p };
  const s = String(p);
  const masked = /x|X|\*/.test(s);
  const m = s.match(/\d+/);
  return { num: masked ? null : (m ? parseInt(m[0], 10) : null), masked, raw: s || '—' };
}
// 价格原文（含掩码形态如 ¥6x）一律转义后再插入，避免上游返回的字符串把标记带进卡片
const money = (p) => { const r = parsePrice(p); return esc(r.masked ? r.raw : (r.num != null ? '¥' + r.num : '—')); };

// 住宿单价是"每间每晚"，交通是"每人每段"。直接相加再标"人均"会高估人均成本，
// 因此住宿按同住人数分摊，并在口径里写清楚（party 默认 2 人）。
const partyOf = (con) => {
  const n = Number(con && con.party);
  return Number.isFinite(n) && n > 0 ? n : 2;
};
function budgetOf(b) {
  const con = b.constraints || {};
  const flights = b.flights || [], hotels = b.hotels || [];
  const nights = Math.max(0, (Number(con.days) || 1) - 1);
  const party = partyOf(con);
  const fnums = flights.map(f => parsePrice(f.price).num).filter(n => n != null);
  const hnums = hotels.map(h => parsePrice(h.price).num).filter(n => n != null);
  if (!hnums.length && !fnums.length) return { kind: 'none' };
  const rt = fnums.reduce((a, c) => a + c, 0);
  const hLo = Math.min(...(hnums.length ? hnums : [0])) * nights;
  const hHi = Math.max(...(hnums.length ? hnums : [0])) * nights;
  // rt = 每人往返交通合计（票价按人计）；hLo/hHi = 整间房 N 晚房费合计（按间计）。
  // 人均 = 自己的交通 + 房费 ÷ 同住人数；同行合计 = 人均 × 同住人数。
  const perLo = rt + hLo / party, perHi = rt + hHi / party;
  return {
    kind: hnums.length && fnums.length ? 'full' : (hnums.length ? 'hotel-only' : 'transport-only'),
    party, nights, rt, hLo, hHi,
    perLo, perHi,
    totalLo: perLo * party, totalHi: perHi * party,
    transportMasked: fnums.length === 0 && flights.length > 0,
  };
}
const rmb = (n) => Number.isInteger(n) ? String(n) : n.toFixed(0);

// ---------- Markdown ----------
export function renderMarkdown(b, isSample = false) {
  const vp = b.vibe_profile || {}, dests = b.destinations || [], con = b.constraints || {};
  const pois = b.pois || [], flights = b.flights || [], hotels = b.hotels || [];
  const o = ['# 🎨 心动旅行卡 · Vibe2Trip', ''];
  if (isSample) o.push('> ⚠️ SAMPLE 演示数据：画像/价格/航班/酒店均为占位示例，非真实飞猪返回。', '');
  if (b.priceMasked) o.push('> 🔒 部分价格被飞猪以**掩码**返回（如 ¥1x）：商品名与预订链接仍真实，掩码项不计入预算汇总。', '');

  o.push('## ① 心动解读 · 旅行审美画像');
  o.push('- 灵感来源：' + (vp.source || '—'));
  for (const [k, label] of VIBE_DIMS) o.push(`- ${label}：${fmtList(vp[k])}`);
  if (vp.recognized_place) o.push('- 识别地点：' + vp.recognized_place);
  if (vp.heart_reason) o.push('- 💗 心动理由：' + vp.heart_reason);
  o.push('');

  o.push('## ② 命定目的地');
  if (!dests.length) o.push('_（未给出目的地候选）_');
  for (const d of dests) o.push(`- **${d.name || '—'}**${d.preferred ? ' ⭐首选' : ''} —— 匹配：${d.match || '—'}`);
  o.push('');

  o.push('## ③ 出行约束');
  o.push(`- 出发地：${con.origin || '—'} ｜ 日期：${con.dates || '—'} ｜ 天数：${con.days || '—'} ｜ 同行：${con.travelers || '—'} ｜ 预算：${con.budget || '—'}`);
  if (con.assumptions?.length) o.push('- 默认假设：' + con.assumptions.join('；'));
  o.push('');

  o.push('## ④ 按天行程');
  if (!pois.length) o.push('_（未获取到真实景点数据）_');
  const days = {}; for (const p of pois) (days[p.day || 1] ||= []).push(p);
  const ord = { '上午': 0, '下午': 1, '晚上': 2 };
  for (const d of Object.keys(days).sort((a, c) => a - c)) {
    o.push(`**第 ${d} 天**`);
    for (const p of days[d].sort((x, y) => (ord[x.slot] ?? 9) - (ord[y.slot] ?? 9))) {
      let line = `- ${p.slot || '全天'} · ${p.name || '—'}`;
      const tags = []; if (p.vibe_tag) tags.push('契合:' + p.vibe_tag); if (p.duration) tags.push('约' + p.duration);
      if (tags.length) line += `（${tags.join('，')}）`;
      if (p.url) line += ` → [详情](${p.url})`;
      o.push(line);
    }
    o.push('');
  }

  o.push('## ⑤ 可预订清单');
  o.push('**交通**');
  if (!flights.length) o.push('- _（未获取到真实交通数据）_');
  for (const f of flights) {
    let line = `- ${f.leg || ''} ${f.no || ''} ${f.dep || ''}→${f.arr || ''} ${money(f.price)}`;
    if (f.url) line += ` → [预订](${f.url})`;
    o.push(line);
  }
  o.push('', '**住宿**');
  if (!hotels.length) o.push('- _（未获取到真实住宿数据）_');
  for (const h of hotels) {
    let line = `- ${h.name || '—'} ${h.star || ''} ${h.score ? '评分' + h.score : ''} ${money(h.price)}/晚`;
    const ex = []; if (h.poi) ex.push('近' + h.poi); if (h.vibe_tag) ex.push('契合:' + h.vibe_tag);
    if (ex.length) line += `（${ex.join('，')}）`;
    if (h.url) line += ` → [预订](${h.url})`;
    o.push(line);
  }

  const bd = budgetOf(b);
  if (bd.kind === 'full') {
    o.push('', `**总预算：${bd.party} 人同行约 ¥${rmb(bd.totalLo)} ~ ¥${rmb(bd.totalHi)}（人均约 ¥${rmb(bd.perLo)} ~ ¥${rmb(bd.perHi)}）**`);
    o.push(`> 口径（可直接复算）：人均 = 往返交通 ¥${rmb(bd.rt)}/人 + 整间房费 ¥${rmb(bd.hLo)}~¥${rmb(bd.hHi)}（真实单晚价 × ${bd.nights} 晚）÷ ${bd.party} 人同住；同行合计 = 人均 × ${bd.party}。不含门票/餐饮/市内交通。`);
  } else if (bd.kind === 'hotel-only') {
    o.push('', `**住宿预算：${bd.party} 人同行约 ¥${rmb(bd.hLo)} ~ ¥${rmb(bd.hHi)}（人均约 ¥${rmb(bd.hLo / bd.party)} ~ ¥${rmb(bd.hHi / bd.party)}）**`);
    o.push(`> 口径：住宿真实单晚 × ${bd.nights} 晚；交通价格被飞猪掩码/缺失，未计入。`);
  } else if (bd.kind === 'transport-only') {
    o.push('', `**交通预算：真实合计 ¥${bd.rt}/人（往返）**`);
    o.push(`> 口径：仅交通；住宿价格被飞猪掩码/缺失，未计入。`);
  } else {
    o.push('', '**总预算区间**：🔒 未获取到真实价格，无法汇总；商品名与预订链接仍真实。');
  }
  o.push('', '---', '_由 Vibe2Trip 组装；审美画像为百炼 Qwen-VL 的审美推断，价格与商品来自飞猪 flyai 真实返回。_');
  return o.join('\n');
}

// ---------- HTML（自包含，可直接截图/演示）----------
export function renderHTML(b, isSample = false) {
  const vp = b.vibe_profile || {}, dests = b.destinations || [], con = b.constraints || {};
  const pois = b.pois || [], flights = b.flights || [], hotels = b.hotels || [];
  const chips = VIBE_DIMS.map(([k, label]) => `<span class="chip"><b>${label}</b>${esc(fmtList(vp[k]))}</span>`).join('');
  const destCards = dests.map(d => `<div class="dest ${d.preferred ? 'pref' : ''}"><div class="dname">${esc(d.name)}${d.preferred ? ' <span class="star">⭐首选</span>' : ''}</div><div class="dmatch">${esc(d.match || '')}</div></div>`).join('');
  const days = {}; for (const p of pois) (days[p.day || 1] ||= []).push(p);
  const ord = { '上午': 0, '下午': 1, '晚上': 2 };
  const dayBlocks = Object.keys(days).sort((a, c) => a - c).map(d => {
    const items = days[d].sort((x, y) => (ord[x.slot] ?? 9) - (ord[y.slot] ?? 9)).map(p => `
      <div class="poi">
        ${p.pic ? `<img src="${esc(p.pic)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="poiBody">
          <div class="poiTop"><span class="slot">${esc(p.slot || '全天')}</span><a class="poiName" href="${esc(p.url || '#')}" target="_blank" rel="noopener">${esc(p.name)}</a></div>
          <div class="poiTags">${p.vibe_tag ? `<span class="tag">契合 · ${esc(p.vibe_tag)}</span>` : ''}${p.duration ? `<span class="tag ghost">约${esc(p.duration)}</span>` : ''}</div>
          ${p.reason ? `<div class="why">${esc(p.reason)}</div>` : ''}
        </div>
      </div>`).join('');
    return `<div class="day"><div class="dayLabel">第 ${esc(d)} 天</div>${items}</div>`;
  }).join('');
  const flightRows = flights.map(f => `<tr><td>${esc(f.leg)}</td><td>${esc(f.no)}</td><td>${esc(f.dep)} → ${esc(f.arr)}</td><td class="price">${money(f.price)}</td><td>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">预订</a>` : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">未获取到真实交通数据</td></tr>`;
  const hotelCards = hotels.map(h => `
    <div class="hotel">
      ${h.pic ? `<img src="${esc(h.pic)}" loading="lazy" onerror="this.style.display='none'">` : ''}
      <div class="hBody">
        <a class="hName" href="${esc(h.url || '#')}" target="_blank" rel="noopener">${esc(h.name)}</a>
        <div class="hMeta">${h.star ? `<span>${esc(h.star)}</span>` : ''}${h.score ? `<span>评分 ${esc(h.score)}</span>` : ''}${h.poi ? `<span>近${esc(h.poi)}</span>` : ''}</div>
        ${h.vibe_tag ? `<div class="tag">契合 · ${esc(h.vibe_tag)}</div>` : ''}
        <div class="hPrice">${money(h.price)}<small>/晚</small></div>
      </div>
    </div>`).join('') || `<div class="empty">未获取到真实住宿数据</div>`;

  const bd = budgetOf(b);
  let budgetHTML;
  if (bd.kind === 'full') {
    budgetHTML = `<div class="budget">约 ¥${rmb(bd.totalLo)} ~ ¥${rmb(bd.totalHi)}<small>${bd.party} 人同行合计 ｜ 人均 ¥${rmb(bd.perLo)}~¥${rmb(bd.perHi)} ＝ 往返交通 ¥${rmb(bd.rt)}/人 + 整间房费 ¥${rmb(bd.hLo)}~¥${rmb(bd.hHi)}（真实单晚价 × ${bd.nights} 晚）÷ ${bd.party} 人同住；不含门票/餐饮/市内交通</small></div>`;
  } else if (bd.kind === 'hotel-only') {
    budgetHTML = `<div class="budget">住宿约 ¥${rmb(bd.hLo)} ~ ¥${rmb(bd.hHi)}<small>${bd.party} 人同行 · 住宿${bd.nights}晚房费合计；交通价格被飞猪掩码/缺失，未计入</small></div>`;
  } else if (bd.kind === 'transport-only') {
    budgetHTML = `<div class="budget">交通真实合计 ¥${bd.rt}/人<small>往返；住宿价格被飞猪掩码/缺失，未计入</small></div>`;
  } else {
    budgetHTML = `<div class="budget locked">🔒 未获取到真实价格，无法汇总<small>商品名与预订链接仍真实</small></div>`;
  }

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>心动旅行卡 · Vibe2Trip</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--ink:#eef1f6;--sub:#9aa3b2;--line:#262b36;--acc:#ff7a59;--acc2:#6ee7c7}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#0f1115,#12151c);color:var(--ink);font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:32px 20px 64px}
.head{display:flex;align-items:center;gap:12px;margin-bottom:6px}.logo{font-size:26px}.title{font-size:24px;font-weight:800;letter-spacing:.5px}
.sub{color:var(--sub);margin:0 0 22px}.banner{background:#2a2416;border:1px solid #4a3d1c;color:#ffd479;padding:10px 14px;border-radius:10px;margin-bottom:18px;font-size:13px}
section{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:18px}
h2{font-size:16px;margin:0 0 14px;display:flex;align-items:center;gap:8px}h2 .n{color:var(--acc);font-weight:800}
.heart{background:linear-gradient(90deg,rgba(255,122,89,.14),transparent);border-left:3px solid var(--acc);padding:10px 14px;border-radius:8px;margin-bottom:14px;color:#ffd9cd}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{background:#1e232c;border:1px solid var(--line);border-radius:20px;padding:5px 12px;font-size:13px;color:var(--sub)}.chip b{color:var(--ink);margin-right:6px;font-weight:600}
.dests{display:flex;flex-wrap:wrap;gap:10px}.dest{flex:1 1 220px;background:#1b2029;border:1px solid var(--line);border-radius:12px;padding:12px 14px}.dest.pref{border-color:var(--acc);box-shadow:0 0 0 1px rgba(255,122,89,.3) inset}.dname{font-weight:700}.star{color:var(--acc);font-size:12px}.dmatch{color:var(--sub);font-size:13px;margin-top:4px}
.conline{color:var(--sub);font-size:14px}.assume{color:#ffd479;font-size:12px;margin-top:6px}
.day{margin-bottom:16px}.dayLabel{font-weight:700;color:var(--acc2);margin-bottom:8px}
.poi{display:flex;gap:12px;padding:10px 0;border-top:1px solid var(--line)}.poi img{width:74px;height:74px;object-fit:cover;border-radius:10px;flex:0 0 auto}
.poiBody{flex:1}.poiTop{display:flex;align-items:center;gap:8px}.slot{background:#232a35;color:var(--sub);border-radius:6px;padding:1px 8px;font-size:12px}.poiName{color:var(--ink);font-weight:600;text-decoration:none}.poiName:hover{color:var(--acc)}
.poiTags{margin:6px 0}.tag{display:inline-block;background:rgba(110,231,199,.12);color:var(--acc2);border-radius:6px;padding:1px 8px;font-size:12px;margin-right:6px}.tag.ghost{background:#232a35;color:var(--sub)}
.why{color:var(--sub);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}th{color:var(--sub);font-weight:500;font-size:12px}.price{color:var(--acc);font-weight:700}td a{color:var(--acc2);text-decoration:none}
.hotels{display:flex;flex-direction:column;gap:12px}.hotel{display:flex;gap:12px;background:#1b2029;border:1px solid var(--line);border-radius:12px;padding:10px}.hotel img{width:96px;height:96px;object-fit:cover;border-radius:10px;flex:0 0 auto}
.hBody{flex:1}.hName{color:var(--ink);font-weight:700;text-decoration:none}.hName:hover{color:var(--acc)}.hMeta{color:var(--sub);font-size:12px;margin:4px 0;display:flex;gap:10px;flex-wrap:wrap}.hPrice{color:var(--acc);font-weight:800;font-size:18px;margin-top:4px}.hPrice small{color:var(--sub);font-weight:400;font-size:12px}
.budget{margin-top:14px;background:linear-gradient(90deg,rgba(255,122,89,.16),transparent);border:1px solid rgba(255,122,89,.35);border-radius:12px;padding:14px;font-size:24px;font-weight:800;color:#ffb59e}.budget small{display:block;font-size:12px;color:var(--sub);font-weight:400;margin-top:4px}.budget.locked{color:#ffd479;border-color:#4a3d1c;background:linear-gradient(90deg,rgba(255,212,121,.12),transparent);font-size:16px}
.empty{color:var(--sub);font-size:13px;padding:8px 0}
.foot{color:var(--sub);font-size:12px;text-align:center;margin-top:20px}
</style></head><body><div class="wrap">
<div class="head"><span class="logo">🎨</span><span class="title">心动旅行卡 · Vibe2Trip</span></div>
<p class="sub">「这张图的感觉，帮我安排」—— 旅行审美解构师</p>
${isSample ? '<div class="banner">⚠️ SAMPLE 演示数据：画像/价格/航班/酒店均为占位示例，非真实飞猪返回。</div>' : ''}
${b.priceMasked ? '<div class="banner">🔒 部分价格被飞猪以掩码返回（如 ¥1x）：商品名与预订链接仍真实，掩码项不计入预算汇总。</div>' : ''}

<section><h2><span class="n">①</span> 心动解读 · 旅行审美画像</h2>
${vp.heart_reason ? `<div class="heart">💗 ${esc(vp.heart_reason)}</div>` : ''}
<div class="chips">${chips}</div>
${vp.recognized_place ? `<p class="conline" style="margin-top:12px">识别地点：${esc(vp.recognized_place)}</p>` : ''}
<p class="conline" style="margin-top:6px">灵感来源：${esc(vp.source || '—')}</p></section>

<section><h2><span class="n">②</span> 命定目的地</h2><div class="dests">${destCards || '<div class="empty">未给出目的地候选</div>'}</div></section>

<section><h2><span class="n">③</span> 出行约束</h2>
<div class="conline">出发地 ${esc(con.origin || '—')} ｜ 日期 ${esc(con.dates || '—')} ｜ ${esc(con.days || '—')}天 ｜ 同行 ${esc(con.travelers || '—')} ｜ 预算 ${esc(con.budget || '—')}</div>
${con.assumptions?.length ? `<div class="assume">默认假设：${esc(con.assumptions.join('；'))}</div>` : ''}</section>

<section><h2><span class="n">④</span> 按天行程</h2>${dayBlocks || '<div class="empty">未获取到真实景点数据</div>'}</section>

<section><h2><span class="n">⑤</span> 可预订清单</h2>
<h2 style="font-size:14px;color:var(--sub)">交通</h2>
<table><thead><tr><th>航段</th><th>车次/航班</th><th>时间</th><th>价格</th><th></th></tr></thead><tbody>${flightRows}</tbody></table>
<h2 style="font-size:14px;color:var(--sub);margin-top:18px">住宿</h2>
<div class="hotels">${hotelCards}</div>
${budgetHTML}</section>

<p class="foot">由 Vibe2Trip 组装 · 审美画像来自百炼 Qwen-VL 推断 · 价格与商品来自飞猪 flyai 真实返回</p>
</div></body></html>`;
}
