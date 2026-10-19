# flyai skill 命令速查（真实能力，来自官方仓库与文档）

飞猪官方 skill，OpenClaw 协议原生能力，实时直连飞猪官方商品库与动态库存，返回结果**可真实预订**。
在智能体会话中以 `/flyai <command> --参数 值` 形式调用；同一套操作也可通过 `flyai` CLI 执行。

## 安装与配置（本仓库已验证的无 npm 方式）

```bash
# 本仓库方式：无需 npm/npx，自动下载官方自包含 bundle 到 vendor/flyai/
node scripts/setup_flyai.mjs
# 之后编排器以 `node vendor/flyai/flyai-bundle.cjs <command> --参数 值` 调用

# 官方原始方式（供参考，需要 npm 环境）：
#   clawhub install flyai
#   npx skills add alibaba-flyai/flyai-skill
#   flyai config set FLYAI_API_KEY "你的Key"
```

> 重要事实：flyai 后端是一个**带签名鉴权的 MCP server**（`https://flyai.open.fliggy.com/mcp`，
> `Authorization: Bearer` + 逐请求签名）。因此它**不能**被"自定义插件 / 通用 MCP 客户端"直接挂载
> （通用客户端只发静态 Bearer、不做逐请求签名）。两条可行接入：
> ① 百炼 **Managed Agent 云沙箱内** `npx skills add alibaba-flyai/flyai-skill` 装**官方 skill**（主路径）；
> ② 本地用 `node` 直跑 npm 包内**自包含 bundle** `dist/flyai-bundle.cjs`（仅依赖 Node 内置模块），无需 npm/npx。

## 调用额度（来自参赛指南）
- 访客（未注册/未登录）：总次数 300 次
- 注册用户：累计赠送 5000 次；用完后每日补充 100 次
- 更多额度：加入大赛交流群 @管理员申请

## 命令清单

| 命令 | 用途 | 必填 | 常用可选参数 |
|------|------|------|--------------|
| `keyword-search` | 泛旅行发现（酒店/机票/门票/度假/邮轮/签证/电话卡等） | `--query` | — |
| `ai-search` | 语义/混合意图综合检索，拿不准用哪个时首选 | `--query` | — |
| `fliggy-fast-search` | 快速综合检索 | `--query` | — |
| `search-flight` | 机票比价 | `--origin` | `--destination` `--dep-date` `--back-date` `--journey-type` `--seat-class-name` `--max-price` `--sort-type` `--transfer-city` `--dep-hour-start/end` |
| `search-train` | 火车票比价 | `--origin` | `--destination` `--dep-date` `--seat-class-name`（二等/一等/商务/硬卧/软卧） |
| `search-hotel` | 酒店比价 | `--dest-name` | `--key-words` `--poi-name` `--hotel-types` `--check-in-date` `--check-out-date` `--hotel-stars` `--hotel-bed-types` `--max-price` `--sort` |
| `search-poi` | 景点/活动 | `--city-name` | `--keyword` `--poi-level` `--category` |
| `search-marriott-hotel` | 万豪系酒店 | `--dest-name` | `--hotel-brands` `--hotel-name` `--poi-name` 价格/床型/排序/入离日期 |
| `search-marriott-package` | 万豪套餐 | `--keyword` | `--sort-type`（price_asc / price_desc） |

## 已验证的实现细节（踩坑记录）

**① `search-poi --category` 校验的是中文枚举**（`--help` 印的英文是误导，传英文会直接报错）：
自然风光、山湖田园、森林丛林、峡谷瀑布、沙滩海岛、沙漠草原、人文古迹、古镇古村、历史古迹、
园林花园、宗教场所、公园乐园、主题乐园、水上乐园、影视基地、动物园、植物园、海洋馆、
体育场馆、演出赛事、剧院剧场、博物馆、纪念馆、展览馆、地标建筑、市集、文创街区、
城市观光、户外活动、滑雪、漂流、冲浪、潜水、露营、温泉。

**② 真实返回字段（已实测）**：
- `search-poi` → `data.itemList[]`：`name` `category` `description` `address` `latitude/longitude` `mainPic` `jumpUrl`(可预订) `freePoiStatus` `listRank` `ticketInfo{price,itemId,skuName}`
- `search-hotel` → `data.itemList[]`：`name` `star`(如"经济型/高档型") `price`(字符串) `rate` `address` `mainPic` `detailUrl`(可预订) `interestsPoi`(如"近西湖") `brandName` `decorationTime`
- `search-flight` → `data.itemList[]`：`ticketPrice` `jumpUrl` `totalDuration` `tags` `journeys[].segments[]{marketingTransportNo, marketingTransportName, depCityName, arrCityName, depDateTime, arrDateTime, depStationName, arrStationName, seatClassName}`、`journeys[].journeyType`(直达/中转)

**③ 体验模式价格掩码**：未配正式 `FLYAI_API_KEY` 时，`search-hotel` 的 `price` 返回 `¥6x`/`¥3xx` 这类掩码
（`search-flight` 的 `ticketPrice` 反而可能是真实数字）。渲染层检测到任一掩码即整体标注"体验模式"，
不据此计算预算区间。配正式 Key 后为真实价格。

## 官方查询示例
- 「我想在北京订酒店」 / 「上海外滩附近有什么好酒店？」 / 「广州天河五星级酒店」 / 「深圳今晚有房吗？」
- 「查明天北京到上海的航班」 / 「国际航班到纽约」
- 「帮我规划杭州3日行程」 / 「带娃去迪士尼有什么推荐？」
- 「What's the cheapest direct flight from Beijing to Bangkok in May?」
- 「Compare 4-star hotels in Sanya with twin beds for under ¥500/night, sorted by rating」

## 在 Vibe2Trip 里的映射
- 审美解构得到目的地/调性 → `search-poi` 拿契合氛围的玩法、`search-hotel` 拿契合调性的住宿、`search-flight`/`search-train` 拿交通。
- 住宿/交通筛选 = 把审美画像（暖调治愈/慢生活/湖景人文…）翻译成 `--poi-name` / `--hotel-stars` / `--max-price` / `--sort` 等真实参数。
- 总预算区间 = 对真实返回的交通价与住宿单晚价做汇总（口径透明，不做花哨多方案对比）。
- 用户微调画像（"再松弛一点/多些人文"）= 换 POI 关键词或住宿筛选后重新检索、重排。

> 说明：命令与参数以 `flyai --help` 的实时输出为准；本文档为设计期整理的快照。
