# 架构与数据流（已验证实现）

## 总体架构

```
┌──────────────┐  灵感图(base64)   ┌──────────────────────────────────────┐
│    用户       │ ───────────────▶ │  ① 百炼 DashScope · Qwen-VL (qwen3-vl-plus) │
│ (一张心动的图) │                  │     审美解构 → 7 维 Vibe Profile + 候选目的地 │
└──────────────┘                  └───────────────────┬──────────────────┘
       ▲                                              │ 结构化 JSON
       │                                              ▼
       │                              ┌──────────────────────────────────────┐
       │   心动旅行卡                  │  ② 编排器 scripts/vibe_trip.mjs (Node)   │
       │  (card.html / card.md)       │     选目的地 → 生成 flyai 检索参数          │
       │                              └───────────────────┬──────────────────┘
       │                                                  │ spawn node flyai-bundle.cjs
       │                                                  ▼
       │                              ┌──────────────────────────────────────┐
       │                              │  ③ 飞猪 flyai 官方 bundle (自包含,无npm)  │
       │                              │     → MCP https://flyai.open.fliggy.com/mcp │
       │                              │     真实库存：景点/酒店/机票/火车(可预订)    │
       │                              └───────────────────┬──────────────────┘
       │                                                  │ 真实 JSON
       │                                                  ▼
       │                              ┌──────────────────────────────────────┐
       │                              │  ④ 百炼 DashScope · Qwen (qwen-plus)     │
       │                              │     把真实 POI 编排成 天/时段 + 契合标签     │
       │                              └───────────────────┬──────────────────┘
       │                                                  │ bundle.json
       │                                                  ▼
       └──────────────────────────────────  ⑤ render.mjs → 心动旅行卡 (HTML+MD)
```

## flyai 的两条接入路径（重要，避免后来者踩坑）

飞猪 flyai 以 **OpenClaw 协议 skill** 提供，执行体是 npm 包 `@fly-ai/flyai-cli`；其后端是一个**带签名鉴权的 MCP server**（`https://flyai.open.fliggy.com/mcp`，`Authorization: Bearer` + `FLYAI_SIGN_SECRET` 逐请求签名）。由此得出两条**互不替代**的接入路径：

- **主路径（作品主形态）· 百炼 Managed Agent 官方 skill**：在 Managed Agent 会话云沙箱内 `npx skills add alibaba-flyai/flyai-skill` 安装**官方 skill**，由 skill 自己做逐请求签名——**能拿到真实数据**。这是官方参赛形态（见 `agent/managed_agent_system_prompt.md`、`agent/console_checklist.md`）。
- **本地复现路径 · 通用客户端无法挂载 MCP**：flyai 后端不能被百炼控制台"自定义插件 / 通用 MCP 客户端"直接挂载（通用 MCP 客户端只发静态 Bearer、不会逐请求签名）。但其 npm 包内 `dist/flyai-bundle.cjs` 是**自包含 bundle（仅依赖 Node 内置模块，commander 已内联）**，故本地最稳的接入是：用 `node` 直跑官方 bundle 作为执行体，编排器抓取其 stdout JSON——**无需 npm/npx，也无需逆向签名**。
- 百炼"大脑"的价值在两种路径里一致：Qwen-VL 读图审美解构 + Qwen 行程编排。本地路径通过 DashScope OpenAI 兼容接口调用（`https://dashscope.aliyuncs.com/compatible-mode/v1`，读图 `qwen3-vl-plus`、编排 `qwen-plus-latest`），满足大赛"必须使用百炼"的要求，多模态正是本作品核心。


## 数据流（一次完整运行）

1. **审美解构（百炼 Qwen-VL）**：灵感图 base64 → 输出 7 维画像 + 心动理由 + 2~3 个真实候选目的地 + `poi_query`（category 必须用 flyai 校验的**中文枚举**，见下）。认出地点则直说，认不出给神似候选。
2. **选目的地**：取 `preferred` 候选（或 `--dest` 覆盖），去掉括号后缀。
3. **真实检索（flyai）**：
   - `search-poi --city-name <城市> [--category <中文枚举>] [--keyword <词>]` → 真实景点（name/desc/经纬度/mainPic/jumpUrl/ticketInfo）
   - `search-hotel --dest-name <城市> --check-in-date .. --check-out-date .. --sort rate_desc` → 真实酒店（name/star/price/rate/detailUrl/mainPic/interestsPoi）
   - `search-flight --origin <出发地> --destination <城市> --dep-date .. --sort-type 3`（去/返各一次）→ 真实航班（journeys.segments 的航班号/时刻 + ticketPrice + jumpUrl）
   - category 非法或无结果时**换参重试一次**，仍无则如实标注。
4. **行程编排（百炼 Qwen）**：把真实 POI 列表 + 画像喂给 Qwen，输出 天/时段/契合标签/时长/理由；**只用给定的真实 POI，不得新增**。Qwen 不可用时回退到启发式排期（仍只用真实 POI）。
5. **组装渲染**：bundle.json → `render.mjs` 生成自包含 HTML 卡 + Markdown 卡；价格掩码时显著标注且不计算预算区间。

## 关键实现细节（踩坑记录）

- **flyai `--category` 校验的是中文枚举**（自然风光/山湖田园/人文古迹/古镇古村/…），`--help` 里印的英文枚举是误导；编排器用 `POI_CATEGORIES` 白名单校验后再传。
- **Windows 下 flyai bundle 打印完 JSON 后进程 teardown 会报 `Assertion failed ... UV_HANDLE_CLOSING`**（无害，stdout 已完整）；封装层只认 stdout、忽略退出码，并用括号配对从混杂输出中抽取 JSON。
- **体验模式价格掩码**：未配正式 `FLYAI_API_KEY` 时，酒店价返回 `¥6x` 这类掩码（航班 `ticketPrice` 反而可能是真实数字）；渲染层检测到任一掩码即整体标注"体验模式"，绝不把掩码当真实价格、也不据此算预算。
- **无 npm 安装**：`scripts/setup_flyai.mjs` 直接 fetch npm registry tarball，用内置极简 tar 解包出 `dist/flyai-bundle.cjs` 到 `vendor/`（已 gitignore）。

## 关键设计约束（诚实与可验证）

- **零杜撰**：金额、房态、航班号、景点一律来自 flyai 真实返回；脚本层不产生任何价格或商品数据，只做聚合/排序/排版。
- **审美推断与真实数据分区**：画像解读标为"审美推断"，可预订项标为"真实查到"，两者不混淆。
- **可追溯**：每条可预订项保留预订链接（jumpUrl/detailUrl）。
- **失败如实**：调用失败或无结果时明确告知，可换参重试一次，仍无则标"待人工确认"。
- **离线演示隔离**：`--sample` 的占位数据显著标注 SAMPLE，与真实链路物理隔离。

## 差异化定位（为什么这样设计）

同赛道已有多方案比价、行中断救援、订单截图核对、塔罗测评猜目的地等作品。Vibe2Trip 刻意**不碰**这些红海，聚焦唯一空地：
**从用户"已经心动的审美/氛围图"反解旅行**——把感性画像翻译成真实供给。核心壁垒在"审美解构 → 供给映射"这层翻译逻辑（承载于提示词 + 编排器），而非造轮子。
