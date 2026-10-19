#!/usr/bin/env node
// Vibe2Trip · scripts/test_demo_consistency.mjs
// 从静态演示卡中提取「卡内真实价格」，独立复算预算，与卡面显示数字逐一比对。
// 防的是这类事故：口径 small 文案被批量替换成别的城市的数字（总额对、明细错）。
// 运行： node scripts/test_demo_consistency.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failed = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) failed++; };

// 从一份整卡 HTML 抽取：交通单价列表、住宿单价列表、天数、同行人数、卡面预算数字
function parseCard(html) {
  const flights = [...html.matchAll(/<td class="price">¥([\d,.]+)<\/td>/g)].map(m => Number(m[1].replace(/,/g, '')));
  const hotels = [...html.matchAll(/<div class="hPrice">¥([\d,.]+)<small>/g)].map(m => Number(m[1].replace(/,/g, '')));
  const days = Number((html.match(/(\d+)天/) || [])[1]);
  const party = Number((html.match(/(\d+)\s*人同行合计/) || [])[1]);
  const bud = html.match(/<div class="budget">约 ¥([\d,.]+) ~ ¥([\d,.]+)<small>([\s\S]*?)<\/small>/);
  if (!bud) return null;
  const grab = (re) => { const m = bud[3].match(re); return m ? Number(m[1].replace(/,/g, '')) : null; };
  return {
    flights, hotels, days, party,
    totalLo: Number(bud[1].replace(/,/g, '')), totalHi: Number(bud[2].replace(/,/g, '')),
    perLo: grab(/人均 ¥([\d,.]+)~/), perHi: grab(/人均 ¥[\d,.]+~¥([\d,.]+)/),
    rt: grab(/往返交通 ¥([\d,.]+)\/人/),
    hLo: grab(/整间房费 ¥([\d,.]+)~/), hHi: grab(/整间房费 ¥[\d,.]+~¥([\d,.]+)/),
  };
}
// 与 render.mjs budgetOf 同式（独立实现，作为交叉校验）
function expect(c) {
  const nights = Math.max(0, c.days - 1);
  const rt = c.flights.reduce((a, b) => a + b, 0);
  const hLo = Math.min(...c.hotels) * nights, hHi = Math.max(...c.hotels) * nights;
  const perLo = rt + hLo / c.party, perHi = rt + hHi / c.party;
  return { rt, hLo, hHi, perLo, perHi, totalLo: perLo * c.party, totalHi: perHi * c.party };
}
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 1;  // 卡面取整，容差 1 元

console.log('\n== 苏州卡 (docs/demo/suzhou.html) ==');
{
  const c = parseCard(read('docs/demo/suzhou.html'));
  const e = expect(c);
  ok(c.party === 2 && c.days === 3, `同行 ${c.party} 人 / ${c.days} 天`);
  ok(near(c.rt, e.rt), `往返交通 ¥${c.rt} ＝ 卡内票价合计 ¥${e.rt}`);
  ok(near(c.hLo, e.hLo) && near(c.hHi, e.hHi), `整间房费 ¥${c.hLo}~¥${c.hHi} ＝ 复算 ¥${e.hLo}~¥${e.hHi}`);
  ok(near(c.perLo, e.perLo) && near(c.perHi, e.perHi), `人均 ¥${c.perLo}~¥${c.perHi} ＝ 复算 ¥${Math.round(e.perLo)}~${Math.round(e.perHi)}`);
  ok(near(c.totalLo, e.totalLo) && near(c.totalHi, e.totalHi), `合计 ¥${c.totalLo}~¥${c.totalHi} ＝ 复算 ¥${Math.round(e.totalLo)}~${Math.round(e.totalHi)}`);
}
console.log('\n== 阿勒泰卡 (docs/demo/altay.html) ==');
{
  const c = parseCard(read('docs/demo/altay.html'));
  const e = expect(c);
  ok(near(c.rt, e.rt) && near(c.hLo, e.hLo) && near(c.hHi, e.hHi), `明细与卡内票价/房价一致（¥${c.rt}/人, 房费 ¥${c.hLo}~¥${c.hHi}）`);
  ok(near(c.perLo, e.perLo) && near(c.totalLo, e.totalLo), `人均/合计自洽（¥${Math.round(e.perLo)} / ¥${Math.round(e.totalLo)}）`);
}
console.log('\n== 合并页 index.html：两张卡的 srcdoc 内嵌副本 ==');
{
  const idx = read('docs/demo/index.html');
  const blocks = [...idx.matchAll(/约 ¥([\d,.]+) ~ ¥([\d,.]+)<small>([\s\S]*?)<\/small>/g)].map(m => ({
    total: Number(m[1].replace(/,/g, '')), small: m[3].replace(/\s+/g, ' '),
  }));
  ok(blocks.length >= 2, `index.html 内可解析预算块 ${blocks.length} 个`);
  const suz = blocks.find(b => b.total === 312), alt = blocks.find(b => b.total === 3826);
  ok(!!suz && !!alt, '两张卡（312 / 3826）均在 index.html 中');
  // 决定性断言：各自的明细必须归属自己，不能互相串
  ok(suz && /人均 ¥156~¥342/.test(suz.small) && /往返交通 ¥24\/人/.test(suz.small), '苏州块含苏州明细（人均156~342 / 交通¥24）');
  ok(alt && /人均 ¥1913~¥3831/.test(alt.small) && /往返交通 ¥934\/人/.test(alt.small) && /1958~¥5794/.test(alt.small), '阿勒泰块含阿勒泰明细（人均1913~3831 / 交通¥934 / 房费1958~5794）');
  ok(alt && !/156~¥342/.test(alt.small) && !/¥24\/人/.test(alt.small), '阿勒泰块不再串入苏州数字');
  const keyframes = (idx.match(/src="data:image\/png;base64,/g) || []).length;
  ok(keyframes === 4, `真跑关键帧内嵌 ${keyframes}/4 张`);
  ok(idx.includes('v3'), '合并页已标注提示词版本口径');
}
console.log('\n' + (failed === 0 ? '=== ALL PASS ===' : '=== ' + failed + ' FAILED ==='));
process.exit(failed ? 1 : 0);
