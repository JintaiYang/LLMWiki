"""Recompute V5 comparisons using the shared model and frozen V4 baseline."""
import argparse
import hashlib
import json
from pathlib import Path
from book_score import DIMENSIONS, score_book as preview_score


ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = {"基准": [25, 30, 25, 10, 10], "偏现金": [20, 40, 25, 5, 10],
             "偏盈利": [35, 25, 20, 10, 10], "偏家底": [20, 25, 35, 10, 10]}


def scenario_total(score, weights):
    if not score["rankable"]:
        return None
    return round(min(sum(d["score"] / d["max"] * w for d, w in zip(score["dimensions"], weights)), score["risk_cap"]), 2)


def run(source, output):
    if output.with_suffix('.json').resolve() == source.resolve() or (ROOT / 'dashboard').resolve() in output.resolve().parents:
        raise ValueError('Preview output must not overwrite production dashboard files')
    payload = source.read_bytes()
    data = json.loads(payload)
    active = str(data['model']['version']).startswith('V5')
    baseline_path = ROOT / '04_运维报告/白酒评分V4切换前基线_20261017.json'
    baseline = {c['code']: c['v4_total'] for c in json.loads(baseline_path.read_text())['companies']} if baseline_path.exists() else {}
    if active and not baseline:
        raise ValueError('V5 production snapshot requires the frozen V4 baseline for comparisons')
    verifications = [{"code": c["code"], "name": c["name"], "field": key, **value}
                     for c in data["companies"] for key, value in c.get("provenance", {}).get("fields", {}).items()
                     if str(value.get("provider", "")).startswith("iFind")]
    results = [{"code": c["code"], "name": c["name"], "previous": baseline[c['code']] if baseline else c["score"]["total"],
                "preview": preview_score(c["annual"])} for c in data["companies"]]
    for r in results:
        r["scenarios"] = {name: scenario_total(r["preview"], weights) for name, weights in SCENARIOS.items()}
    for scenario in SCENARIOS:
        ranked = sorted((r for r in results if r["scenarios"][scenario] is not None), key=lambda r: -r["scenarios"][scenario])
        previous, rank = None, 0
        for index, r in enumerate(ranked, 1):
            if r["scenarios"][scenario] != previous:
                rank = index
            r.setdefault("ranks", {})[scenario] = rank
            previous = r["scenarios"][scenario]
    package = {"version": "V5-book-model-comparison" if active else "V5-book-design-preview", "designed_at": "2026-10-17", "financial_as_of": data["as_of"],
               "source_sha256": hashlib.sha256(payload).hexdigest(), "source": str(source.resolve()),
               "production_model": data["model"]["version"], "v4_baseline_file": str(baseline_path) if baseline else None,
               "verified_supplements": verifications, "dimensions": DIMENSIONS,
               "scenarios": SCENARIOS, "companies": results}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.with_suffix('.json').write_text(json.dumps(package, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    show = lambda v: '缺项' if v is None else f'{v:.2f}'
    lines = ['---', 'type: analysis', 'status: growing', 'industry: 白酒', 'market: 中国',
             'tags: [评分设计, 离线试算, 待验证]', 'source_url: ""', 'evidence_level: low',
             'updated: 2026-10-17', 'related: ["[[../05_知识库/11_研究框架/白酒财报质量评分V5设计]]"]',
             'next_action: "持续补证并检验锚点；正式网页已采用 V5"' if active else 'next_action: "审查公式与敏感性；尚未替换正式 V4"', '---', '', '# 白酒评分 V5：19 家对照复算', '',
             f'财务研究快照截至 {data["as_of"]}，设计与试算日期 2026-10-17。未刷新行情或财报。', '',
             '设计规则见 [[../05_知识库/11_研究框架/白酒财报质量评分V5设计]]；全部单项贡献保存在同名 JSON。', '',
             '**正式网页已采用 V5，V4 列保留切换前基线；安全核验均待补证，分数不代表收益预测。**' if active else '**这里是候选公式的历史财务观察分，正式看板仍使用 V4；安全核验均待补证，不代表投资排名或收益预测。**', '',
             '| 公司 | V4 | V5 | 差额 | 盈利/25 | 现金/30 | 家底/25 | 韧性/10 | 回报/10 | 风险上限 |',
             '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
    for r in sorted(results, key=lambda r: (r['preview']['total'] is None, -(r['preview']['total'] or 0))):
        s = r['preview']
        difference = s['total'] - r['previous'] if s['total'] is not None and r['previous'] is not None else None
        lines.append('| ' + ' | '.join([r['name'], show(r['previous']), show(s['total']), show(difference),
                                      *(show(d['score']) for d in s['dimensions']), str(s['risk_cap'])]) + ' |')
    if verifications:
        lines += ['', '## 已核验的单项补缺', '',
                  '以下历史报表单项通过补充证据导入，未对普通空白实施填零。完整证据见相应来源记录。', '']
        lines += [f'- {v["name"]} {v["field"]}：{v.get("indicator", "")}；原披露日期 {v.get("source_date", "")}。' for v in verifications]
    lines += ['', '## 缺项与观察项', '']
    for r in results:
        s = r['preview']
        details = s['missing'] + s['risk_missing'] + s['observations']
        if details:
            lines.append(f'- {r["name"]}：' + '；'.join(details) + (f'；已知贡献 {s["known_points"]:.2f}，覆盖 {s["coverage"]:.0%}，基于已知风险的区间 {s["score_range"]}' if s['missing'] else ''))
    lines += ['', '## 权重敏感性', '', '仅对单项及数值风险资料完整的公司计算候选分数名次。各情景不补缺项，不重新分摊缺项权重。', '',
              '| 公司 | 基准分 | 偏现金分 | 偏盈利分 | 偏家底分 | 四情景名次范围 |', '| --- | ---: | ---: | ---: | ---: | --- |']
    for r in results:
        ranks = list(r.get('ranks', {}).values())
        lines.append('| ' + ' | '.join([r['name'], *(show(v) for v in r['scenarios'].values()), f'{min(ranks)}–{max(ranks)}' if ranks else '资料不足']) + ' |')
    lines += ['', '## 限制', '', '- 权重敏感性不是收益回测，也没有证明此版优于 V4。',
              '- 毛利、净利、现金和资产质量可能相关；需要更长历史检验，不能根据这一期高分公司倒推最优权重。',
              '- 严格现金债务覆盖、审计、担保与资金占用尚未完成核验。观察分完整不等于排雷完成。',
              '- 新旧分数比较同时受权重、指标、最新年约束和风险规则变化影响，不能全部解释为企业经营变化。', '',
              f'源快照 SHA-256：`{package["source_sha256"]}`。']
    output.with_suffix('.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({'companies': len(results), 'complete_previews': sum(r['preview']['rankable'] for r in results),
                      'production_model_unchanged': data['model']['version'], 'output': str(output)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'dashboard/data.json')
    parser.add_argument('--output', type=Path, default=ROOT / '04_运维报告/白酒评分V5试算_20261017')
    args = parser.parse_args()
    run(args.input, args.output)
