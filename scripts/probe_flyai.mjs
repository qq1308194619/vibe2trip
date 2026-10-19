#!/usr/bin/env node
// Vibe2Trip · scripts/probe_flyai.mjs
// 可复现的"数据真实性探针"：用你自己的 FLYAI_API_KEY 直连飞猪官方 bundle，打印每个命令
// 实际返回了哪些字段，并判定价格是真值还是体验模式掩码。用于回答评委"数据是不是编的"。
// 用法： FLYAI_API_KEY=你的Key node scripts/probe_flyai.mjs
import { flyai, bundleReady } from './lib/flyai.mjs';

if (!bundleReady()) {
  console.error('未找到 flyai bundle，请先运行： node scripts/setup_flyai.mjs --version 1.0.16');
  process.exit(2);
}
if (!process.env.FLYAI_API_KEY) {
  console.warn('⚠️ 未设置 FLYAI_API_KEY —— 将走飞猪公共体验额度，价格通常被掩码（¥1xx / ¥6x）。\n');
}

const masked = (v) => /x|X|\*/.test(String(v ?? ''));
const line = (label, v, extra) => `  ${String(label).padEnd(26)} ${JSON.stringify(v ?? null).padEnd(10)} ${masked(v) ? '← 掩码(体验模式)' : (v == null ? '← 未返回' : '← 真实值')}${extra ? '  ' + extra : ''}`;

const results = {};
try {
  const t = await flyai.searchTrain({ origin: '上海', destination: '嘉兴', 'dep-date': '2026-11-08', 'sort-type': '3' });
  const it = (t?.data?.itemList || []);
  console.log(`\n[search-train] 上海→嘉兴 2026-11-08  命中 ${it.length} 条`);
  const s = it[0]?.journeys?.[0]?.segments?.[0] || {};
  results.train = it.length;
  console.log(line(it.length ? '首条 车次/座席' : '首条', null, it.length ? `${s.marketingTransportNo} ${s.depStationName}→${s.arrStationName} ${s.seatClassName}` : ''));
  if (it.length) console.log(line('ticketPrice', it[0].ticketPrice ?? it[0].price, it[0].jumpUrl ? '有预订链接' : '无链接'));
} catch (e) { console.log(`\n[search-train] 失败：${e.message.slice(0, 160)}`); results.train = 'ERR'; }

try {
  const h = await flyai.searchHotel({ 'dest-name': '嘉兴', 'poi-name': '乌镇西栅景区', 'check-in-date': '2026-11-08', 'check-out-date': '2026-11-10', sort: 'rate_desc' });
  const hi = (h?.data?.itemList || []);
  console.log(`\n[search-hotel] 乌镇西栅周边  命中 ${hi.length} 家`);
  hi.slice(0, 3).forEach(x => console.log(line(x.name, x.price, `star=${x.star || '-'} rate=${x.rate ?? '(未返回)'}`)));
  results.hotel = hi.length;
  results.hotelHasRate = hi.some(x => x.rate != null && x.rate !== '');
  results.hotelMasked = hi.some(x => masked(x.price));
} catch (e) { console.log(`\n[search-hotel] 失败：${e.message.slice(0, 160)}`); results.hotel = 'ERR'; }

try {
  const p = await flyai.searchPoi({ 'city-name': '嘉兴', category: '古镇古村', keyword: '乌镇' });
  const pi = (p?.data?.itemList || []);
  console.log(`\n[search-poi] 嘉兴/古镇古村/乌镇  命中 ${pi.length} 个`);
  pi.slice(0, 3).forEach(x => console.log(line(x.name, x.ticketInfo?.price, `category=${x.category || '-'} ${x.jumpUrl ? '有详情链接' : '无链接'}`)));
  results.poi = pi.length;
} catch (e) { console.log(`\n[search-poi] 失败：${e.message.slice(0, 160)}`); results.poi = 'ERR'; }

console.log('\n——— 字段覆盖结论（本作品据此决定卡片展示什么）———');
console.log(`  search-hotel 是否返回评分 rate ： ${results.hotelHasRate ? '是' : '否 —— 因此卡片不展示评分，标注"未返回"'}`);
console.log(`  酒店价格是否被掩码            ： ${results.hotelMasked ? '是（当前为体验模式额度）' : '否（正式 Key，真实价）'}`);
console.log('  规则：字段查不到就就地标注"未返回"，绝不跨字段推断、绝不补数。');
process.exit((results.train === 'ERR' && results.hotel === 'ERR' && results.poi === 'ERR') ? 1 : 0);