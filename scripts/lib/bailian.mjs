// Vibe2Trip · lib/bailian.mjs
// 阿里云百炼（DashScope）OpenAI 兼容接口封装：多模态 Qwen-VL 读图 + 文本 Qwen 编排。
// 端点：https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
// 鉴权：Authorization: Bearer <DASHSCOPE_API_KEY>（即百炼 API-KEY）
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export function extractJson(text) {
  if (!text) throw new Error('模型无输出');
  // 先尝试 ```json ... ``` 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cand = fence ? fence[1] : text;
  const iObj = cand.indexOf('{');
  const iArr = cand.indexOf('[');
  let i = -1, open = '{', close = '}';
  if (iArr >= 0 && (iObj < 0 || iArr < iObj)) { i = iArr; open = '['; close = ']'; }
  else if (iObj >= 0) { i = iObj; }
  if (i < 0) throw new Error('模型输出中无 JSON：' + text.slice(0, 300));
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < cand.length; j++) {
    const c = cand[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return JSON.parse(cand.slice(i, j + 1)); }
  }
  throw new Error('模型 JSON 不完整：' + cand.slice(i, i + 300));
}

async function call(body, apiKey) {
  if (!apiKey) throw new Error('缺少 DASHSCOPE_API_KEY（百炼 API-KEY），请写入 .env');
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`百炼接口 ${res.status}：${txt.slice(0, 400)}`);
  const json = JSON.parse(txt);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(p => p.text || '').join('');
  throw new Error('百炼返回结构异常：' + txt.slice(0, 300));
}

// 多模态读图：image 为 base64（不含前缀），mime 如 image/jpeg
// 默认 qwen3-vl-plus：部分百炼工作空间未开通 qwen-vl-max*（403 access_denied），qwen3-vl-plus 覆盖最广
export async function chatVL({ system, text, imageBase64, mime = 'image/jpeg', model = process.env.VIBE_VL_MODEL || 'qwen3-vl-plus', apiKey, temperature = 0.4 }) {
  const userContent = [];
  if (imageBase64) userContent.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } });
  userContent.push({ type: 'text', text });
  return call({ model, temperature, messages: [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
  ] }, apiKey);
}

// 纯文本编排
export async function chatText({ system, text, model = 'qwen-plus-latest', apiKey, temperature = 0.5 }) {
  return call({ model, temperature, messages: [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ] }, apiKey);
}
