#!/usr/bin/env node
// Vibe2Trip · scripts/test_budget.mjs
// 预算口径回归测试：确保「交通按人 × 同住人数、房费整间 ÷ 同住人数」这条算式不会被改回去，
// 并验证掩码/缺失价格绝不进预算、价格字符串不产生 HTML 注入。
// 运行： node scripts/test_budget.mjs      （零依赖，仅 Node 内置模块；退出码非 0 即失败）
import { renderMarkdown, renderHTML, parsePrice } from './lib/render.mjs';

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); if (!cond) failed++; };

// 造一份最小 bundle：价格给真实形态（字符串带 ¥、掩码带 x），days/party 可控
const mk = ({ days, party, flights = [], hotels = [] }) => ({
  vibe_profile: { morphology: '水乡河道', palette: '暖金逆光', mood: '静谧', activity: ['摇橹船'], pace: '极慢', season: '深秋', culture_nature: '人文7:自然3', heart_reason: '想慢下来', recognized_place: '图中未体现', source: 'test' },
  destinations: [{ name: '嘉兴', preferred: true, match: 'x' }],
  constraints: { origin: '上海', dates: `2026-11-08 ~ 2026-11-${8 + Math.max(1, days - 1)}`, days, travelers: party + '人', party, budget: '中等', assumptions: [] },
  pois: [{ name: '西塘古镇', day: 1, slot: '上午', vibe_tag: '水道', duration: '3h', reason: '' }],
  flights: flights.map((p, i) => ({ leg: i ? '返程' : '去程', no: 'G00' + i, dep: '08:00', arr: '08:30', price: p, url: '' })),
  hotels: hotels.map((p, i) => ({ name: 'H' + i, star: '舒适型', price: p, score: 4.5, poi: '西塘', vibe_tag: '临水', url: '' })),
  priceMasked: false,
});
const budgetLine = (md) => md.split('\n').find(l => l.includes('总预算') || l.includes('住宿预算') || l.includes('交通预算')) || '';

console.log('\n[1] 嘉兴卡真实价格复算（高铁 ¥33/¥47，住宿 ¥145/¥458 每间每晚，2 人 3 天 2 晚）');
{
  const md = renderMarkdown(mk({ days: 3, party: 2, flights: [33, 47], hotels: [145, 458] }));
  const line = budgetLine(md);
  console.log('  → ' + line);
  ok(line.includes('人均约 ¥225 ~ ¥538'), '人均 = 交通 ¥80 + 房费分摊 ¥145~¥458 → ¥225~¥538');
  ok(line.includes('¥450 ~ ¥1076'), '2 人同行合计 = 人均 × 2 → ¥450~¥1076');
  ok(md.includes('÷ 2 人同住'), '口径写明房费按同住人数分摊');
}

console.log('\n[2] 独行（party=1）：合计应等于人均，不该出现分摊除数');
{
  const line = budgetLine(renderMarkdown(mk({ days: 3, party: 1, flights: [623, 623], hotels: [1444] })));
  console.log('  → ' + line);
  ok(line.includes('¥4134 ~ ¥4134') && line.includes('人均约 ¥4134 ~ ¥4134'), '1 人出行：交通 1246 + 房费 2888 = ¥4134，两值相同');
}

console.log('\n[3] 住宿被飞猪掩码（¥6x / ¥3xx）：只能报真实交通，掩码项不得进预算');
{
  const md = renderMarkdown(mk({ days: 3, party: 2, flights: [33, 47], hotels: ['¥6x', '¥3xx'] }));
  const line = budgetLine(md);
  console.log('  → ' + line);
  ok(/交通预算.*¥80\/人/.test(line), '仅汇总真实交通 ¥80/人');
  ok(md.includes('未计入'), '口径注明未计入项');
}

console.log('\n[4] 价格全缺：如实说"无法汇总"，绝不凭空造一个数');
{
  const md = renderMarkdown(mk({ days: 3, party: 2, flights: [], hotels: [] }));
  ok(md.includes('未获取到真实价格，无法汇总'), '输出"无法汇总"');
  ok(!/总预算：/.test(md), '不会生成总预算行');
}

console.log('\n[5] parsePrice：区分真实值 / 掩码 / 缺失');
{
  ok(parsePrice('¥6x').masked === true, '"¥6x" 判为掩码');
  ok(parsePrice('¥145').num === 145 && !parsePrice('¥145').masked, '"¥145" 判为真实 145');
  ok(parsePrice(33).num === 33, '数字直取');
  ok(parsePrice(null).num === null && !parsePrice(null).masked, 'null 不计入、不误判为掩码');
}

console.log('\n[6] HTML 与 Markdown 同数；价格串不得造成注入');
{
  const b = mk({ days: 3, party: 2, flights: [33, 47], hotels: [145, 458] });
  const h = renderHTML(b);
  const m = h.match(/<div class="budget">([\s\S]{0,200})/);
  ok(!!m && /约 ¥450 ~ ¥1076/.test(m[1]), 'HTML 合计与 Markdown 一致');
  const evil = renderHTML(mk({ days: 2, party: 2, flights: [100], hotels: ['<img src=x onerror=alert(1)>'] }));
  ok(!/<img src=x onerror/.test(evil), '含标记的价格串被转义');
}

console.log('\n' + (failed === 0 ? '=== ALL PASS ===' : '=== ' + failed + ' FAILED ==='));
process.exit(failed ? 1 : 0);
