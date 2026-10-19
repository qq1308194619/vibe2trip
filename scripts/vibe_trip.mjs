#!/usr/bin/env node
// Vibe2Trip · vibe_trip.mjs — 主编排器
// 一张灵感图 →(百炼 Qwen-VL 审美解构)→ 旅行审美画像 + 候选目的地
//            →(飞猪 flyai 真实数据)→ 景点/酒店/航班 →(百炼 Qwen 编排)→ 心动旅行卡
// 输出：outputs/<slug>/bundle.json + card.md + card.html
//
// 真实运行： node scripts/vibe_trip.mjs --image assets/demo.jpg --from 上海 --date 2026-11-08 --days 3 --people "2人情侣" --budget 中等
// 离线演示： node scripts/vibe_trip.mjs --sample
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO } from './lib/env.mjs';
import { chatVL, chatText, extractJson } from './lib/bailian.mjs';
import { flyai, bundleReady } from './lib/flyai.mjs';
import { VIBE_SYSTEM, planSystem, POI_CATEGORIES } from './lib/prompts.mjs';
import { renderMarkdown, renderHTML, parsePrice } from './lib/render.mjs';

loadEnv();
const A = process.argv.slice(2);
const get = (f, d) => { const i = A.indexOf(f); return i >= 0 && A[i + 1] ? A[i + 1] : d; };
const has = (f) => A.includes(f);

// flyai 的 --city-name/--origin/--destination 需要"地级市"；
// 模型可能给到镇/景区级（如"苏州同里古镇"），这里逐级回退出城市级候选。
function cityCandidates(dest) {
  const c = [];
  const push = (s) => { s = (s || '').trim(); if (s && !c.includes(s)) c.push(s); };
  push(dest);
  push(dest.replace(/(古镇|古城|水乡|景区|风景区|名胜区|旅游度假区|镇|乡|村|岛|山)$/, ''));
  if (dest.length > 2) push(dest.slice(0, 2));
  return c;
}

const log = (...a) => console.log('·', ...a);
const iso = (dt) => dt.toISOString().slice(0, 10);
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const slugify = (s) => (s || 'trip').replace(/[^\w\u4e00-\u9fa5]+/g, '_').slice(0, 40);

// ---- 兜底：无 VL/无 Key 时的启发式排期（仍只用真实 POI）----
function fallbackPlan(pois, days) {
  const slots = ['上午', '下午', '晚上'];
  return pois.map((p, i) => ({ ...p, day: Math.floor(i / 3) % days + 1, slot: slots[i % 3], duration: p.slot === '晚上' ? '2h' : '半天', vibe_tag: p.category || '契合画像', reason: '' }));
}

// ---- 真实 flyai 响应 → bundle 片段 ----
function mapPois(resp) {
  return (resp?.data?.itemList || []).map(x => ({
    name: x.name, category: x.category || '', desc: x.description || '',
    url: x.jumpUrl || '', pic: x.mainPic || '', address: x.address || '',
    ticket: x.ticketInfo?.price || null,
  }));
}
function mapHotels(resp, n = 3) {
  return (resp?.data?.itemList || []).slice(0, n).map(x => ({
    name: x.name, star: x.star || '', price: x.price, score: x.rate || null,
    poi: (x.interestsPoi || '').replace(/^近/, ''), url: x.detailUrl || '',
    pic: x.mainPic || '', address: x.address || '',
  }));
}
function mapFlight(resp, leg) {
  const it = (resp?.data?.itemList || [])[0];
  if (!it) return null;
  const segs = it.journeys?.[0]?.segments || [];
  const first = segs[0] || {}, last = segs[segs.length - 1] || {};
  const nos = segs.map(s => s.marketingTransportNo).filter(Boolean).join(' / ');
  return {
    leg, no: nos || (first.marketingTransportName || ''),
    dep: (first.depDateTime || '').slice(11, 16), arr: (last.arrDateTime || '').slice(11, 16),
    depCity: first.depCityName, arrCity: last.arrCityName,
    transfer: it.journeys?.[0]?.journeyType || '',
    price: it.ticketPrice ?? it.price, url: it.jumpUrl || '',
  };
}

async function main() {
  const outRoot = path.resolve(REPO, get('--out', 'outputs'));

  // ---------- 离线 SAMPLE ----------
  if (has('--sample')) {
    const bundle = sampleBundle();
    const dir = path.join(outRoot, 'sample'); fs.mkdirSync(dir, { recursive: true });
    writeCard(dir, bundle, true);
    return;
  }

  if (!bundleReady()) { console.error('缺少 flyai bundle，请先运行： node scripts/setup_flyai.mjs'); process.exit(1); }
  const vibeFile = get('--vibe', null);
  const image = get('--image', null);
  if (!vibeFile && !image) { console.error('请用 --image <图片路径>（读图解构）或 --vibe <画像.json>（复用画像），或 --sample 看离线演示。'); process.exit(1); }
  const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
  const FLYAI_API_KEY = process.env.FLYAI_API_KEY; // 可空→用 flyai 内置体验 key（价格掩码）
  if (!vibeFile && !DASHSCOPE_API_KEY) { console.error('缺少 DASHSCOPE_API_KEY（百炼 API-KEY），无法做审美解构。请写入 .env，或用 --vibe 复用已解构的画像。'); process.exit(1); }

  const from = get('--from', '上海');
  const days = parseInt(get('--days', '3'), 10) || 3;
  const date = get('--date', addDays(iso(new Date()), 30));
  const back = addDays(date, Math.max(1, days - 1));
  const people = get('--people', '2人');
  // 同住人数：用于把"每间每晚"的住宿价折算成人均（可用 --party 覆盖）
  const party = Math.max(1, parseInt(get('--party', (String(people).match(/\d+/) || ['2'])[0]), 10) || 2);
  const budget = get('--budget', '中等');
  const transport = get('--transport', 'flight');
  const assumptions = [];
  if (!get('--date', null)) assumptions.push('出行日期为默认（30天后）');
  if (!get('--from', null)) assumptions.push('出发地默认上海');

  // ---------- ① 审美解构：百炼 Qwen-VL 读图，或 --vibe 复用画像 ----------
  let vibe;
  if (vibeFile) {
    log('① 复用已解构画像：', vibeFile);
    vibe = JSON.parse(fs.readFileSync(path.resolve(vibeFile), 'utf8'));
    vibe.vibe_profile = vibe.vibe_profile || {};
    vibe.vibe_profile.source = vibe.vibe_profile.source || ('画像文件 ' + path.basename(vibeFile));
  } else {
    log('① 百炼 Qwen-VL 审美解构 …');
    const imgBuf = fs.readFileSync(path.resolve(image));
    const mime = /\.png$/i.test(image) ? 'image/png' : /\.webp$/i.test(image) ? 'image/webp' : 'image/jpeg';
    const b64 = imgBuf.toString('base64');
    const vlUser = `这是我的旅行灵感图。请按系统要求解构成审美画像，并给出 2~3 个真实候选目的地。\n我的出行约束（可用于目的地筛选）：出发地 ${from}，${date} 起 ${days} 天，${people}，预算 ${budget}。`;
    const vlRaw = await chatVL({ system: VIBE_SYSTEM, text: vlUser, imageBase64: b64, mime, apiKey: DASHSCOPE_API_KEY });
    vibe = extractJson(vlRaw);
    vibe.vibe_profile.source = '用户上传的灵感图（' + path.basename(image) + '）';
  }
  log('  画像：', vibe.vibe_profile.morphology, '/', vibe.vibe_profile.mood, '| 候选：', (vibe.destinations || []).map(d => d.name).join('、'));

  // ---------- 选目的地 ----------
  let dest = get('--dest', null);
  if (!dest) {
    const pref = (vibe.destinations || []).find(d => d.preferred) || (vibe.destinations || [])[0];
    dest = pref?.name || vibe.vibe_profile.recognized_place;
  }
  if (!dest) { console.error('未能确定目的地。'); process.exit(1); }
  dest = String(dest).replace(/[（(].*?[)）]/g, '').trim();
  log('② 命定目的地：', dest);

  // ---------- ③ flyai 真实数据 ----------
  log('③ 拉取飞猪真实数据 …');
  const pq = vibe.poi_query || {};
  const safeCat = POI_CATEGORIES.includes(pq.category) ? pq.category : undefined;
  if (pq.category && !safeCat) log('  忽略非法 category：', pq.category);
  const cands = cityCandidates(dest);
  let pois = [], poiCity = dest;
  for (const c of cands) {
    let r = await flyai.searchPoi({ 'city-name': c, category: safeCat, keyword: pq.keyword || undefined }, { apiKey: FLYAI_API_KEY });
    pois = mapPois(r);
    if (!pois.length && (safeCat || pq.keyword)) { r = await flyai.searchPoi({ 'city-name': c }, { apiKey: FLYAI_API_KEY }); pois = mapPois(r); }
    if (pois.length) { poiCity = c; break; }
  }
  if (poiCity !== dest) log('  城市级回退：', dest, '→', poiCity);
  const cap = Math.min(pois.length, days * 3);
  pois = pois.slice(0, cap);
  log('  景点', pois.length, '个');

  const hotelResp = await flyai.searchHotel({ 'dest-name': poiCity, 'poi-name': pq.keyword || undefined, 'check-in-date': date, 'check-out-date': back, sort: 'rate_desc' }, { apiKey: FLYAI_API_KEY });
  let hotels = mapHotels(hotelResp, 3);
  if (!hotels.length && pq.keyword) { // 景点附近无果则放宽到全城
    const r2 = await flyai.searchHotel({ 'dest-name': poiCity, 'check-in-date': date, 'check-out-date': back, sort: 'rate_desc' }, { apiKey: FLYAI_API_KEY });
    hotels = mapHotels(r2, 3);
  }
  log('  酒店', hotels.length, '家');

  const legFlight = async () => {
    const go = await flyai.searchFlight({ origin: from, destination: poiCity, 'dep-date': date, 'sort-type': '3' }, { apiKey: FLYAI_API_KEY });
    const backf = await flyai.searchFlight({ origin: poiCity, destination: from, 'dep-date': back, 'sort-type': '3' }, { apiKey: FLYAI_API_KEY });
    return [mapFlight(go, '去程'), mapFlight(backf, '返程')].filter(Boolean);
  };
  const legTrain = async () => {
    const go = await flyai.searchTrain({ origin: from, destination: poiCity, 'dep-date': date, 'sort-type': '3' }, { apiKey: FLYAI_API_KEY });
    const backf = await flyai.searchTrain({ origin: poiCity, destination: from, 'dep-date': back, 'sort-type': '3' }, { apiKey: FLYAI_API_KEY });
    return [mapFlight(go, '去程'), mapFlight(backf, '返程')].filter(Boolean);
  };
  let flights = [];
  let usedTransport = transport;
  if (transport === 'flight') {
    flights = await legFlight();
    if (flights.length < 2) { const t = await legTrain(); if (t.length > flights.length) { flights = t; usedTransport = 'train'; log('  该城市对无合适航班，回退高铁'); } }
  } else {
    flights = await legTrain();
    if (flights.length < 2) { const f = await legFlight(); if (f.length > flights.length) { flights = f; usedTransport = 'flight'; log('  回退航班'); } }
  }
  log('  交通', flights.length, '段（', usedTransport, '）');

  // ---------- ④ 百炼 Qwen 行程编排 ----------
  log('④ 百炼 Qwen 编排按天行程 …');
  let planned;
  try {
    const planRaw = await chatText({
      system: planSystem(days),
      text: JSON.stringify({ days, vibe_profile: vibe.vibe_profile, pois: pois.map(p => ({ name: p.name, category: p.category, desc: (p.desc || '').slice(0, 60) })) }),
      apiKey: DASHSCOPE_API_KEY,
    });
    const arr = extractJson(planRaw);
    const byName = Object.fromEntries(pois.map(p => [p.name, p]));
    const resolve = (nm) => {
      if (!nm) return null;
      if (byName[nm]) return byName[nm];
      const hits = pois.filter(p => p.name.includes(nm) || nm.includes(p.name));
      return hits.length ? hits[0] : null;
    };
    const usedNames = new Set();
    planned = (Array.isArray(arr) ? arr : [])
      .map(x => { const real = resolve(x.name); if (!real) return null;
        return { ...real, day: x.day, slot: x.slot, vibe_tag: x.vibe_tag, duration: x.duration, reason: x.reason }; })
      .filter(p => { if (!p || usedNames.has(p.name)) return false; usedNames.add(p.name); return true; });
    if (!planned.length) throw new Error('编排结果为空');
  } catch (e) {
    log('  编排回退到启发式（', e.message, '）');
    planned = fallbackPlan(pois, days);
  }

  // 住宿契合标签（轻量启发式，可被人工覆盖）
  hotels = hotels.map(h => ({ ...h, vibe_tag: h.star && /豪华|高档/.test(h.star) ? '品质度假' : (/经济|青旅/.test(h.star || '') ? '高性价比' : '舒适通勤') }));

  const priceMasked = [...hotels.map(h => h.price), ...flights.map(f => f.price)].some(p => parsePrice(p).masked);

  const bundle = {
    vibe_profile: vibe.vibe_profile,
    destinations: vibe.destinations || [],
    constraints: { origin: from, dates: `${date} ~ ${back}`, days, travelers: people, party, budget, assumptions },
    pois: planned, flights, hotels, priceMasked,
    _meta: { dest, transport: usedTransport, requested_transport: transport, generated_at: new Date().toISOString(), flyai_key: FLYAI_API_KEY ? 'official（正式 Key，真实价格）' : 'guest（体验模式，价格可能被掩码）' },
  };

  const dir = path.join(outRoot, slugify(dest) + '_' + date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify(bundle, null, 2));
  writeCard(dir, bundle, false);
}

function writeCard(dir, bundle, isSample) {
  fs.writeFileSync(path.join(dir, 'card.md'), renderMarkdown(bundle, isSample));
  fs.writeFileSync(path.join(dir, 'card.html'), renderHTML(bundle, isSample));
  console.log('\n✓ 心动旅行卡已生成：');
  console.log('  ' + path.join(dir, 'card.html'));
  console.log('  ' + path.join(dir, 'card.md'));
  console.log('  ' + path.join(dir, 'bundle.json'));
}

function sampleBundle() {
  return {
    vibe_profile: { source: 'SAMPLE 示例灵感图', morphology: '湖景 + 古镇水乡', palette: '暖调治愈', mood: '松弛', activity: ['Citywalk', '美食探店'], pace: '慢生活度假', season: '四季皆宜', culture_nature: '人文 6 : 自然 4', heart_reason: '示例：一种想慢下来、被水汽和暖光包裹的感觉（占位，非真实）', recognized_place: '杭州（示例）' },
    destinations: [{ name: '杭州（示例）', match: '暖调+慢生活+湖景人文，命中 4 个维度', preferred: true }],
    constraints: { origin: '上海', dates: '示例日期', days: 2, travelers: '2人', budget: '中等', assumptions: ['这是演示用的占位数据'] },
    pois: [
      { name: '西湖（示例）', day: 1, slot: '上午', vibe_tag: '松弛/湖景', duration: '3h', reason: '' },
      { name: '河坊街（示例）', day: 1, slot: '晚上', vibe_tag: '烟火气/美食', duration: '2h', reason: '' },
    ],
    flights: [{ leg: '去程', no: 'SAMPLE', dep: '08:00', arr: '10:20', price: 700 }, { leg: '返程', no: 'SAMPLE', dep: '20:00', arr: '22:20', price: 720 }],
    hotels: [{ name: '湖景高分酒店（示例）', star: '高档型', price: 880, poi: '西湖', vibe_tag: '暖调度假', score: 4.8 }],
    priceMasked: false,
  };
}

main().catch(e => { console.error('\n✗ 运行失败：', e.message); process.exit(1); });
