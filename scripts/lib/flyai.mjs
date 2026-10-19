// Vibe2Trip · lib/flyai.mjs
// 对飞猪官方 flyai CLI bundle 的薄封装：spawn `node flyai-bundle.cjs <cmd> --k v`，
// 抓取 stdout 里的 JSON 并解析。不依赖 npm。
// 说明：Windows 下 bundle 打印完 JSON 后进程 teardown 可能报
// `Assertion failed ... UV_HANDLE_CLOSING`（无害），故只认 stdout、忽略退出码。
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.resolve(__dirname, '..', '..', 'vendor', 'flyai', 'flyai-bundle.cjs');

export function bundleReady() {
  return fs.existsSync(BUNDLE);
}
export function bundlePath() { return BUNDLE; }

// argsObj: { 'city-name': '杭州', keyword: '西湖' } → --city-name 杭州 --keyword 西湖
// 值为 undefined/null/'' 的键会被跳过；值为 true 当作无值 flag。
function buildArgs(cmd, argsObj = {}) {
  const a = [BUNDLE, cmd];
  for (const [k, v] of Object.entries(argsObj)) {
    if (v === undefined || v === null || v === '') continue;
    a.push('--' + k);
    if (v !== true) a.push(String(v));
  }
  return a;
}

// 从可能夹杂告警/断言的输出里抠出第一个完整 JSON 对象
function extractJson(stdout) {
  const s = stdout.toString('utf8');
  const i = s.indexOf('{');
  if (i < 0) throw new Error('flyai 无 JSON 输出：' + s.slice(0, 300));
  // 从第一个 { 起做括号配对，跳过字符串内的括号
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(i, j + 1)); }
  }
  throw new Error('flyai JSON 不完整：' + s.slice(i, i + 300));
}

export function runFlyai(cmd, argsObj = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!bundleReady()) {
      return reject(new Error('未找到 flyai bundle，请先运行： node scripts/setup_flyai.mjs'));
    }
    const env = { ...process.env };
    const key = opts.apiKey || process.env.FLYAI_API_KEY;
    if (key) env.FLYAI_API_KEY = key;
    const args = buildArgs(cmd, argsObj);
    execFile(process.execPath, args, { env, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        // 忽略 teardown 断言导致的非零退出码，只要有 stdout 就尝试解析
        try {
          const json = extractJson(stdout);
          resolve(json);
        } catch (e) {
          reject(new Error(`flyai ${cmd} 调用失败：${e.message}\n--- stderr ---\n${(stderr || '').slice(0, 500)}`));
        }
      });
  });
}

// 便捷方法（opts 原样透传给 runFlyai，保留调用方显式传入的 apiKey）
export const flyai = {
  searchPoi: (o, opts) => runFlyai('search-poi', o, opts),
  searchHotel: (o, opts) => runFlyai('search-hotel', o, opts),
  searchFlight: (o, opts) => runFlyai('search-flight', o, opts),
  searchTrain: (o, opts) => runFlyai('search-train', o, opts),
  aiSearch: (o, opts) => runFlyai('ai-search', o, opts),
  keywordSearch: (o, opts) => runFlyai('keyword-search', o, opts),
};
