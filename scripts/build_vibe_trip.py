#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Vibe2Trip · 心动旅行卡组装器 (build_vibe_trip.py)

作用：把「旅行审美画像 + 飞猪 flyai skill 的真实返回」组装成一张可直接决策的
『心动旅行卡』——心动解读 / 命定目的地 / 按天行程 / 可预订清单 + 总预算区间。

设计原则（诚实口径）：
- 本脚本【不产生任何价格/房态/航班/景点数据】，只做聚合、排序、排版。
- 所有金额与商品信息必须来自你喂给它的 flyai 真实返回 JSON。
- --sample 数据仅用于【离线演示排版逻辑】，其中价格为占位示例，运行时会显著标注
  SAMPLE，切勿当作真实飞猪数据。

用法：
  python3 build_vibe_trip.py --bundle my_flyai_bundle.json   # 真实返回组装
  cat my_flyai_bundle.json | python3 build_vibe_trip.py       # 管道输入
  python3 build_vibe_trip.py --sample                         # 仅演示排版（占位数据）

bundle JSON 结构：
{
  "vibe_profile": {
     "source": "用户上传的灵感图",
     "morphology": "湖景/古镇", "palette": "暖调治愈", "mood": "松弛",
     "activity": ["Citywalk","美食"], "pace": "慢生活", "season": "四季皆宜",
     "culture_nature": "人文 6 : 自然 4",
     "heart_reason": "一句话心动理由",
     "recognized_place": "杭州（若认出）或 null"
  },
  "destinations": [{"name":"杭州","match":"暖调+慢生活+湖景人文，命中 4 个维度","preferred":true}],
  "constraints": {"origin":"北京","dates":"2026-11-08 ~ 2026-11-10","days":3,
                   "travelers":"2人(情侣)","budget":"中等","assumptions":["日期为默认假设"]},
  "pois":    [{"name":"西湖","day":1,"slot":"上午","vibe_tag":"松弛/湖景","duration":"3h","url":"..."}],
  "flights": [{"leg":"去程","no":"MUxxxx","dep":"08:00","arr":"10:20","price":780,"url":"..."}],
  "hotels":  [{"name":"...","star":5,"price":880,"poi":"西湖","vibe_tag":"暖调度假","score":4.8,"url":"..."}]
}
"""
import argparse
import json
import sys

VIBE_DIMS = [
    ("morphology", "地貌场景"),
    ("palette", "色调光线"),
    ("mood", "氛围情绪"),
    ("activity", "活动暗示"),
    ("pace", "节奏快慢"),
    ("season", "季节感"),
    ("culture_nature", "人文/自然"),
]


def load_bundle(args):
    if args.sample:
        return sample_bundle(), True
    if args.bundle:
        with open(args.bundle, "r", encoding="utf-8") as f:
            return json.load(f), False
    data = sys.stdin.read()
    if not data.strip():
        raise SystemExit("未提供输入：请用 --bundle <file>、管道输入，或 --sample 演示。")
    return json.loads(data), False


def sample_bundle():
    # ⚠️ 占位示例数据，仅用于演示排版逻辑；价格/航班/酒店/景点均非真实飞猪返回。
    return {
        "vibe_profile": {
            "source": "SAMPLE 示例灵感图", "morphology": "湖景 + 古镇水乡",
            "palette": "暖调治愈", "mood": "松弛", "activity": ["Citywalk", "美食探店"],
            "pace": "慢生活度假", "season": "四季皆宜", "culture_nature": "人文 6 : 自然 4",
            "heart_reason": "示例：一种想慢下来、被水汽和暖光包裹的感觉（占位，非真实）",
            "recognized_place": "杭州（示例）",
        },
        "destinations": [
            {"name": "杭州（示例）", "match": "暖调+慢生活+湖景人文，命中 4 个维度", "preferred": True},
        ],
        "constraints": {"origin": "北京", "dates": "示例日期", "days": 2,
                        "travelers": "2人", "budget": "中等",
                        "assumptions": ["这是演示用的占位数据"]},
        "pois": [
            {"name": "西湖（示例）", "day": 1, "slot": "上午", "vibe_tag": "松弛/湖景", "duration": "3h"},
            {"name": "河坊街（示例）", "day": 1, "slot": "晚上", "vibe_tag": "烟火气/美食", "duration": "2h"},
        ],
        "flights": [
            {"leg": "去程", "no": "SAMPLE", "dep": "08:00", "arr": "10:20", "price": 700},
            {"leg": "返程", "no": "SAMPLE", "dep": "20:00", "arr": "22:20", "price": 720},
        ],
        "hotels": [
            {"name": "湖景高分酒店（示例）", "star": 5, "price": 880, "poi": "西湖", "vibe_tag": "暖调度假", "score": 4.8},
        ],
    }


def money(v):
    return ("¥%d" % v) if isinstance(v, (int, float)) else "—"


def fmt_list(v):
    if isinstance(v, list):
        return "、".join(str(x) for x in v)
    return str(v) if v else "图中未体现"


def render(bundle, is_sample):
    vp = bundle.get("vibe_profile", {})
    dests = bundle.get("destinations", [])
    con = bundle.get("constraints", {})
    pois = bundle.get("pois", [])
    flights = bundle.get("flights", [])
    hotels = bundle.get("hotels", [])

    out = ["# 🎨 心动旅行卡 · Vibe2Trip\n"]
    if is_sample:
        out.append("> ⚠️ SAMPLE 演示数据：以下画像/价格/航班/酒店均为占位示例，非真实飞猪返回。\n")

    # ① 心动解读（审美画像）
    out.append("## ① 心动解读 · 旅行审美画像")
    out.append("- 灵感来源：%s" % vp.get("source", "—"))
    for key, label in VIBE_DIMS:
        out.append("- %s：%s" % (label, fmt_list(vp.get(key))))
    if vp.get("recognized_place"):
        out.append("- 识别地点：%s" % vp["recognized_place"])
    if vp.get("heart_reason"):
        out.append("- 💗 心动理由：%s" % vp["heart_reason"])
    out.append("")

    # ② 命定目的地
    out.append("## ② 命定目的地")
    if not dests:
        out.append("_（未给出目的地候选）_")
    for d in dests:
        star = " ⭐首选" if d.get("preferred") else ""
        out.append("- **%s**%s —— 匹配：%s" % (d.get("name", "—"), star, d.get("match", "—")))
    out.append("")

    # ③ 出行约束
    out.append("## ③ 出行约束")
    out.append("- 出发地：%s ｜ 日期：%s ｜ 天数：%s ｜ 同行：%s ｜ 预算：%s" % (
        con.get("origin", "—"), con.get("dates", "—"), con.get("days", "—"),
        con.get("travelers", "—"), con.get("budget", "—")))
    if con.get("assumptions"):
        out.append("- 默认假设：%s" % "；".join(con["assumptions"]))
    out.append("")

    # ④ 按天行程
    out.append("## ④ 按天行程")
    if not pois:
        out.append("_（未获取到真实景点数据，请检查 search-poi 调用）_")
    days = {}
    for p in pois:
        days.setdefault(p.get("day", 1), []).append(p)
    order = {"上午": 0, "下午": 1, "晚上": 2}
    for d in sorted(days):
        out.append("**第 %s 天**" % d)
        for p in sorted(days[d], key=lambda x: order.get(x.get("slot", ""), 9)):
            line = "- %s · %s" % (p.get("slot", "全天"), p.get("name", "—"))
            tags = []
            if p.get("vibe_tag"):
                tags.append("契合:%s" % p["vibe_tag"])
            if p.get("duration"):
                tags.append("约%s" % p["duration"])
            if tags:
                line += "（%s）" % "，".join(tags)
            if p.get("url"):
                line += " → [详情](%s)" % p["url"]
            out.append(line)
        out.append("")

    # ⑤ 可预订清单
    out.append("## ⑤ 可预订清单")
    out.append("**交通**")
    if not flights:
        out.append("- _（未获取到真实交通数据）_")
    for f in flights:
        line = "- %s %s %s→%s %s" % (
            f.get("leg", ""), f.get("no", ""), f.get("dep", ""), f.get("arr", ""), money(f.get("price")))
        if f.get("url"):
            line += " → [预订](%s)" % f["url"]
        out.append(line)
    out.append("\n**住宿**")
    if not hotels:
        out.append("- _（未获取到真实住宿数据）_")
    for h in sorted(hotels, key=lambda x: x.get("price", 0)):
        star = ("%d星" % h["star"]) if h.get("star") else ""
        score = ("评分%.1f" % h["score"]) if h.get("score") else ""
        line = "- %s %s %s %s/晚" % (h.get("name", "—"), star, score, money(h.get("price")))
        extras = []
        if h.get("poi"):
            extras.append("近%s" % h["poi"])
        if h.get("vibe_tag"):
            extras.append("契合:%s" % h["vibe_tag"])
        if extras:
            line += "（%s）" % "，".join(extras)
        if h.get("url"):
            line += " → [预订](%s)" % h["url"]
        out.append(line)

    # 总预算区间（由真实价格汇总，口径透明）
    nights = max(0, (con.get("days") or 1) - 1) if isinstance(con.get("days"), int) else 0
    rt = sum(f.get("price", 0) for f in flights if isinstance(f.get("price"), (int, float)))
    if hotels:
        hmin = min(h.get("price", 0) for h in hotels)
        hmax = max(h.get("price", 0) for h in hotels)
        lo = rt + hmin * nights
        hi = rt + hmax * nights
        out.append("\n**总预算区间（人均不含门票餐饮）**：约 %s ~ %s" % (money(lo), money(hi)))
        out.append("> 口径：往返交通真实合计 + 住宿真实单晚×%d 晚；门票/餐饮/市内交通未含。" % nights)
    out.append("")

    out.append("---\n_由 Vibe2Trip 组装；审美画像为模型的审美推断，价格与商品来自飞猪 flyai 真实返回（SAMPLE 模式除外）。_")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="Vibe2Trip 心动旅行卡组装器")
    ap.add_argument("--bundle", help="审美画像 + flyai 真实返回组装成的 bundle JSON 文件路径")
    ap.add_argument("--sample", action="store_true", help="用占位示例数据演示排版（非真实）")
    ap.add_argument("--out", help="输出 markdown 文件路径（默认打印到 stdout）")
    args = ap.parse_args()

    bundle, is_sample = load_bundle(args)
    md = render(bundle, is_sample)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(md)
        print("已写出：%s%s" % (args.out, "（SAMPLE 演示数据）" if is_sample else ""))
    else:
        print(md)


if __name__ == "__main__":
    main()
