#!/usr/bin/env node
// Vibe2Trip · setup_flyai.mjs
// 无需 npm/npx：直接从 npm registry 下载飞猪官方 flyai CLI 的自包含 bundle，
// 解压出 dist/flyai-bundle.cjs 放到 vendor/flyai/ 供编排器调用。
// 依赖：仅 node 内置模块（fetch / zlib / fs / path）。node >= 18。
//
// 用法： node scripts/setup_flyai.mjs [--version 1.0.16] [--registry https://registry.npmmirror.com/]
//       默认按 npmjs.org → npmmirror.com 顺序尝试（国内网络更稳）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const VENDOR = path.join(REPO, 'vendor', 'flyai');
const PKG = '@fly-ai/flyai-cli';
// 国内网络直连 registry.npmjs.org 常超时，按顺序尝试镜像；也可用 --registry 指定。
const REGISTRIES = [
  'https://registry.npmjs.org/',
  'https://registry.npmmirror.com/',
];
function registryList(flagVal) {
  if (flagVal) return [flagVal.endsWith('/') ? flagVal : flagVal + '/'];
  return REGISTRIES;
}
async function fetchMeta(registries) {
  const errs = [];
  for (const reg of registries) {
    try {
      const res = await fetch(reg + PKG.replace('/', '%2F'), { headers: { accept: 'application/json' } });
      if (!res.ok) { errs.push(`${reg} → HTTP ${res.status}`); continue; }
      return { meta: await res.json(), reg };
    } catch (e) { errs.push(`${reg} → ${e.message}`); }
  }
  throw new Error('所有 npm 源都拉取失败：\n  ' + errs.join('\n  ') + '\n可用 --registry https://你的镜像/ 重试。');
}

function argVal(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

// 极简 tar 解包（ustar，512 字节头）。只需取出 package/dist/flyai-bundle.cjs。
function untarPick(buf, wantSuffix) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeOct = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const type = header.subarray(156, 157).toString('utf8');
    if (!name) { off += 512; continue; }
    const size = sizeOct ? parseInt(sizeOct, 8) : 0;
    const dataStart = off + 512;
    if ((type === '0' || type === '\0' || type === '') && name.replace(/^package\//, '').endsWith(wantSuffix)) {
      return buf.subarray(dataStart, dataStart + size);
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function main() {
  const ver = argVal('--version', null);
  const { meta, reg } = await fetchMeta(registryList(argVal('--registry', null)));
  const version = ver || meta['dist-tags'].latest;
  const info = meta.versions && meta.versions[version];
  if (!info || !info.dist || !info.dist.tarball) throw new Error(`npm 源 ${reg} 未提供版本 ${version} 的 tarball`);
  const tarball = info.dist.tarball;
  console.log(`· 源 ${reg}\n· 版本 ${version}\n· 下载 ${tarball}`);
  const res = await fetch(tarball);
  if (!res.ok) throw new Error(`tarball 下载失败：HTTP ${res.status}`);
  const tgz = Buffer.from(await res.arrayBuffer());
  const tar = zlib.gunzipSync(tgz);
  const bundle = untarPick(tar, 'dist/flyai-bundle.cjs');
  if (!bundle) throw new Error('未在 tarball 中找到 dist/flyai-bundle.cjs');
  fs.mkdirSync(VENDOR, { recursive: true });
  const out = path.join(VENDOR, 'flyai-bundle.cjs');
  fs.writeFileSync(out, bundle);
  fs.writeFileSync(path.join(VENDOR, 'VERSION'), version + '\n');
  console.log(`✓ 已安装 flyai bundle → ${out} (${bundle.length} bytes)`);
  console.log('  自检： node ' + path.relative(REPO, out) + ' --help');
}

main().catch((e) => { console.error('setup 失败：', e.message); process.exit(1); });
