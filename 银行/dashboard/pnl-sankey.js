// 个股页利润流向桑基图
// 数据：stock_data/<code>.json 的 pnl_sankey 段
(function (global) {
  "use strict";

  const COLORS = {
    blue: "#2f6fed",
    cyan: "#0ea5e9",
    purple: "#8b5cf6",
    orange: "#f59e0b",
    yellow: "#ca8a04",
    red: "#d1453b",
    gray: "#6b7280",
    green: "#1a9e5c",
  };

  const OPEX_SPLITS = [
    { id: "staffWage", key: "wage", label: "工资奖金", color: "yellow" },
    { id: "staffSocial", key: "social", label: "社保年金", color: "yellow" },
    { id: "staffOther", key: "staffOther", label: "员工其他", color: "yellow" },
    { id: "daa", key: "daa", label: "折旧租赁", color: "gray" },
    { id: "admin", key: "admin", label: "其他行政", color: "orange" },
  ];

  const NODE_HELP = {
    invInt: {
      title: "投资利息",
      body: "对应年报利息收入附注的「金融投资利息收入」。主要是债券（国债、政金债、地方债、信用债），以及按摊余成本或FVOCI计量的同业存单、部分非标等，按实际利率计入利息收入。不是投资收益：股息、价差、处置损益记投资收益；交易性浮盈亏记公允价值变动。",
    },
  };

  function nz(v) {
    return v == null || Number.isNaN(Number(v)) ? 0 : Number(v);
  }

  function fen(yi) {
    return Math.round(yi * 100);
  }

  function yiFromFen(f) {
    return f / 100;
  }

  function fmtYi(n) {
    const abs = Math.abs(n);
    const digits = abs >= 100 ? 0 : 1;
    return `${Number(n).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}亿`;
  }

  function pct(n, d) {
    if (!d) return "—";
    return `${((n / d) * 100).toFixed(1)}%`;
  }

  function grossOf(d) {
    const fvGain = d.fv > 0 ? d.fv : 0;
    if (d.loan != null && d.invInt != null && d.pbcIb != null) {
      return nz(d.loan) + nz(d.invInt) + nz(d.pbcIb) + nz(d.feeInc) + nz(d.invest) + nz(d.otherNi) + fvGain;
    }
    return nz(d.intInc) + nz(d.feeInc) + nz(d.invest) + nz(d.otherNi) + fvGain;
  }

  function summaryNote(d) {
    const intExp = nz(d.depInt) + nz(d.wholesaleInt) || nz(d.intExp);
    const parts = [`利息支出合计 ${fmtYi(intExp)}`];
    if (nz(d.depInt) > 0.05 && nz(d.wholesaleInt) > 0.05) {
      parts[0] += `，其中存款 ${fmtYi(d.depInt)}、批发融资 ${fmtYi(d.wholesaleInt)}`;
    }
    if (d.depBreak) {
      const timeInt = nz(d.depBreak.corpTime) + nz(d.depBreak.retailTime);
      parts.push(`存款里定期占 ${fmtYi(timeInt)}（${pct(timeInt, d.depInt)}）`);
      if (nz(d.depBreak.retailDemand) > 0.05) {
        parts[parts.length - 1] += `，零售活期仅 ${fmtYi(d.depBreak.retailDemand)}`;
      }
    } else {
      parts.push("年报未披露存款利息拆项");
    }
    if (d.loan != null) {
      parts.push("图上利息支出优先从贷款利息扣减，避免色带交叉；合计仍与附注勾稽");
    }
    return `${parts.join("。")}。`;
  }

  function fmtYoy(cur, prev) {
    if (prev == null || !Number.isFinite(prev)) return "同比 —（上年无此流向）";
    if (prev === 0) return cur === 0 ? "同比 0.0%" : "同比 —";
    const r = ((cur - prev) / Math.abs(prev)) * 100;
    const sign = r > 0 ? "+" : "";
    return `同比 ${sign}${r.toFixed(1)}%`;
  }

  function allocateWaterfill(sources, sinks) {
    const src = sources.map((s) => ({ id: s.id, left: fen(s.value) }));
    const snk = sinks.map((s) => ({ id: s.id, left: fen(s.value) }));
    const links = [];
    let i = 0;
    let j = 0;
    while (i < src.length && j < snk.length) {
      const v = Math.min(src[i].left, snk[j].left);
      if (v > 0) {
        links.push({ source: src[i].id, target: snk[j].id, value: yiFromFen(v) });
        src[i].left -= v;
        snk[j].left -= v;
      }
      if (src[i].left <= 0) i += 1;
      if (snk[j].left <= 0) j += 1;
    }
    return links;
  }

  function allocate(sources, sinks) {
    const src = sources.map((s) => ({ id: s.id, left: fen(s.value) }));
    const snk = sinks.map((s) => ({ id: s.id, left: fen(s.value) }));
    const sumT = snk.reduce((a, b) => a + b.left, 0);
    const links = [];
    for (let i = 0; i < src.length; i++) {
      const lastI = i === src.length - 1;
      for (let j = 0; j < snk.length; j++) {
        const lastJ = j === snk.length - 1;
        let v;
        if (lastI) v = snk[j].left;
        else if (lastJ) v = src[i].left;
        else {
          v = Math.round((src[i].left * sinks[j].value * 100) / sumT);
          v = Math.max(0, Math.min(v, src[i].left, snk[j].left));
        }
        if (v > 0) {
          links.push({ source: src[i].id, target: snk[j].id, value: yiFromFen(v) });
          src[i].left -= v;
          snk[j].left -= v;
        }
      }
    }
    return links;
  }

  function ribbon(x0, y0, x1, y1, w) {
    const mid = (x0 + x1) / 2;
    const t = Math.max(w / 2, 0.6);
    return `M ${x0} ${y0 - t} C ${mid} ${y0 - t} ${mid} ${y1 - t} ${x1} ${y1 - t} L ${x1} ${y1 + t} C ${mid} ${y1 + t} ${mid} ${y0 + t} ${x0} ${y0 + t} Z`;
  }

  function buildFlow(d) {
    const fvLoss = d.fv < 0 ? -d.fv : 0;
    const fvGain = d.fv > 0 ? d.fv : 0;
    const investToOp = Math.max(nz(d.invest) - fvLoss, 0);
    const hasLoanSplit = d.loan != null && d.invInt != null && d.pbcIb != null;
    const intExp = nz(d.depInt) + nz(d.wholesaleInt) || nz(d.intExp);
    const col0 = [];
    if (hasLoanSplit) {
      col0.push(
        { id: "loan", label: "贷款利息", col: 0, color: "blue" },
        { id: "invInt", label: "投资利息", col: 0, color: "blue" },
        { id: "pbcIb", label: "央行同业利息", col: 0, color: "blue" },
      );
    } else if (d.intInc) {
      col0.push({ id: "intInc", label: "利息收入", col: 0, color: "blue" });
    }
    if (nz(d.feeInc) > 0.05) col0.push({ id: "feeInc", label: "手续费收入", col: 0, color: "cyan" });
    if (nz(d.invest) > 0.05) col0.push({ id: "invest", label: "投资收益", col: 0, color: "purple" });
    if (nz(d.otherNi) > 0.05) col0.push({ id: "otherNi", label: "其他非息", col: 0, color: "purple" });
    if (fvGain > 0.05) col0.push({ id: "fvGain", label: "公允价值变动", col: 0, color: "purple" });

    const col1 = [];
    if (intExp > 0.05) col1.push({ id: "intExp", label: "利息支出", col: 1, color: "orange" });
    if (nz(d.feeExp) > 0.05) col1.push({ id: "feeExp", label: "手续费支出", col: 1, color: "gray" });
    if (fvLoss > 0.05) col1.push({ id: "fvLoss", label: "公允价值损失", col: 1, color: "red" });

    const col2 = [];
    if (d.depBreak) {
      col2.push(
        { id: "corpDemand", label: "对公活期", col: 2, color: "yellow" },
        { id: "retailDemand", label: "零售活期", col: 2, color: "yellow" },
        { id: "corpTime", label: "对公定期", col: 2, color: "orange" },
        { id: "retailTime", label: "零售定期", col: 2, color: "orange" },
      );
    } else if (nz(d.depInt) > 0.05) {
      col2.push({ id: "depInt", label: "存款利息", col: 2, color: "orange" });
    }
    if (nz(d.wholesaleInt) > 0.05) col2.push({ id: "wholesale", label: "批发融资", col: 2, color: "orange" });
    col2.push({ id: "opInc", label: "营业收入", col: 2, color: "cyan" });

    const nodes = col0.concat(col1, col2, [
      { id: "opex", label: "业务及管理费", col: 3, color: "yellow" },
      { id: "credit", label: "信用减值", col: 3, color: "red" },
    ]);
    if (nz(d.otherCost) > 0.05) nodes.push({ id: "otherCost", label: "其他经营成本", col: 3, color: "gray" });
    nodes.push({ id: "pretax", label: "税前利润", col: 3, color: "green" });

    const opexBreak = d.opexBreak;
    if (opexBreak) {
      OPEX_SPLITS.forEach((s) => {
        if (nz(opexBreak[s.key]) > 0.05) {
          nodes.push({ id: s.id, label: s.label, col: 4, color: s.color });
        }
      });
    }
    if (nz(d.tax) > 0.05) nodes.push({ id: "tax", label: "所得税", col: 4, color: "gray" });
    nodes.push({ id: "parent", label: "归母净利润", col: 4, color: "green" });
    if (nz(d.minority) > 0.05) nodes.push({ id: "minority", label: "少数股东", col: 4, color: "gray" });

    const links = [];
    if (hasLoanSplit && intExp > 0.05) {
      links.push(
        ...allocateWaterfill(
          [
            { id: "loan", value: d.loan },
            { id: "invInt", value: d.invInt },
            { id: "pbcIb", value: d.pbcIb },
          ],
          [
            { id: "intExp", value: intExp },
            { id: "opInc", value: nz(d.nii) },
          ],
        ),
      );
    } else if (d.intInc && intExp > 0.05) {
      links.push(
        ...allocateWaterfill(
          [{ id: "intInc", value: d.intInc }],
          [
            { id: "intExp", value: intExp },
            { id: "opInc", value: nz(d.nii) },
          ],
        ),
      );
    } else if (d.intInc) {
      links.push({ source: "intInc", target: "opInc", value: d.intInc });
    }

    if (intExp > 0.05) {
      if (d.depBreak) {
        links.push(
          ...allocate(
            [{ id: "intExp", value: intExp }],
            [
              { id: "corpDemand", value: d.depBreak.corpDemand },
              { id: "retailDemand", value: d.depBreak.retailDemand },
              { id: "corpTime", value: d.depBreak.corpTime },
              { id: "retailTime", value: d.depBreak.retailTime },
              { id: "wholesale", value: nz(d.wholesaleInt) },
            ].filter((x) => nz(x.value) > 0),
          ),
        );
      } else {
        const sinks = [];
        if (nz(d.depInt) > 0.05) sinks.push({ id: "depInt", value: d.depInt });
        if (nz(d.wholesaleInt) > 0.05) sinks.push({ id: "wholesale", value: d.wholesaleInt });
        if (sinks.length) links.push(...allocate([{ id: "intExp", value: intExp }], sinks));
      }
    }

    if (nz(d.feeExp) > 0.05) links.push({ source: "feeInc", target: "feeExp", value: d.feeExp });
    if (nz(d.feeInc) - nz(d.feeExp) > 0.05) {
      links.push({ source: "feeInc", target: "opInc", value: d.feeInc - nz(d.feeExp) });
    }
    if (investToOp > 0.05) links.push({ source: "invest", target: "opInc", value: investToOp });
    if (nz(d.otherNi) > 0.05) links.push({ source: "otherNi", target: "opInc", value: d.otherNi });
    if (fvGain > 0.05) links.push({ source: "fvGain", target: "opInc", value: fvGain });
    if (fvLoss > 0.05) links.push({ source: "invest", target: "fvLoss", value: fvLoss });

    links.push({ source: "opInc", target: "opex", value: d.opex });
    if (opexBreak) {
      links.push(
        ...allocate(
          [{ id: "opex", value: d.opex }],
          OPEX_SPLITS.map((s) => ({ id: s.id, value: nz(opexBreak[s.key]) })).filter((x) => x.value > 0.05),
        ),
      );
    }
    if (nz(d.credit) > 0.05) links.push({ source: "opInc", target: "credit", value: d.credit });
    if (nz(d.otherCost) > 0.05) links.push({ source: "opInc", target: "otherCost", value: d.otherCost });
    links.push({ source: "opInc", target: "pretax", value: d.pretax });
    if (nz(d.tax) > 0.05) links.push({ source: "pretax", target: "tax", value: d.tax });
    links.push({ source: "pretax", target: "parent", value: d.parent });
    if (nz(d.minority) > 0.05) links.push({ source: "pretax", target: "minority", value: d.minority });

    return { nodes, links };
  }

  function flowValues(d) {
    const { nodes, links } = buildFlow(d);
    const inSum = {};
    const outSum = {};
    nodes.forEach((n) => {
      inSum[n.id] = 0;
      outSum[n.id] = 0;
    });
    links.forEach((l) => {
      outSum[l.source] = (outSum[l.source] || 0) + l.value;
      inSum[l.target] = (inSum[l.target] || 0) + l.value;
    });
    const nodeValue = {};
    nodes.forEach((n) => {
      nodeValue[n.id] = Math.max(inSum[n.id] || 0, outSum[n.id] || 0);
    });
    const linkValue = {};
    links.forEach((l) => {
      linkValue[`${l.source}|${l.target}`] = l.value;
    });
    return { nodes, links, nodeValue, linkValue };
  }

  function labelOf(nodes, id) {
    const n = nodes.find((x) => x.id === id);
    return n ? n.label : id;
  }

  function layout(nodes, links) {
    const W = 1180;
    const H = 680;
    const left = 142;
    const right = 140;
    const top = 22;
    const bottom = 12;
    const nodeW = 14;
    const gap = 12;
    const cols = 5;
    const inner = W - left - right - nodeW;
    const colX = (c) => left + (c * inner) / (cols - 1);

    const inSum = {};
    const outSum = {};
    const valueOf = {};
    nodes.forEach((n) => {
      inSum[n.id] = 0;
      outSum[n.id] = 0;
    });
    links.forEach((l) => {
      outSum[l.source] = (outSum[l.source] || 0) + l.value;
      inSum[l.target] = (inSum[l.target] || 0) + l.value;
    });
    nodes.forEach((n) => {
      valueOf[n.id] = Math.max(inSum[n.id] || 0, outSum[n.id] || 0);
    });

    const byCol = [[], [], [], [], []];
    nodes.forEach((n) => byCol[n.col].push(n));
    let maxCol = 0;
    byCol.forEach((col) => {
      const sum = col.reduce((a, n) => a + (valueOf[n.id] || 0), 0);
      if (sum > maxCol) maxCol = sum;
    });
    const opexSplitCount = byCol[4].filter((n) => OPEX_SPLITS.some((s) => s.id === n.id)).length;
    const maxGaps = Math.max(
      Math.max(byCol[0].length - 1, 0),
      Math.max(byCol[2].length - 1, 0),
      Math.max(byCol[3].length - 1, 0),
      Math.max(opexSplitCount - 1, 0),
      2,
    );
    const scale = (H - top - bottom - gap * maxGaps) / Math.max(maxCol, 1);
    const laid = [];
    const pos = {};

    function place(colNodes, startY) {
      let y = startY;
      let lastLabel = -999;
      colNodes.forEach((n) => {
        const h = Math.max((valueOf[n.id] || 0) * scale, 2);
        const labelInside = h > 36 ? Math.min(h * 0.12, 28) : Math.min(h / 2, 7);
        let labelY = y + labelInside + 4;
        if (labelY < 16) labelY = 16;
        if (labelY - lastLabel < 13) labelY = lastLabel + 13;
        lastLabel = labelY;
        const node = {
          ...n,
          value: valueOf[n.id] || 0,
          x: colX(n.col),
          y,
          w: nodeW,
          h,
          labelY,
        };
        laid.push(node);
        pos[n.id] = node;
        y += h + gap;
      });
    }

    const col1Int = byCol[1].filter((n) => n.id === "intExp");
    const col1Extra = byCol[1].filter((n) => n.id !== "intExp");
    const col2Splits = byCol[2].filter((n) => n.id !== "opInc");
    const col2Op = byCol[2].filter((n) => n.id === "opInc");

    place(byCol[0], top);
    place(col1Int, top);
    if (col2Splits.length) {
      // 有利息拆分：拆分项顶对齐利息支出；手续费/公允损失紧挨其下
      place(col2Splits.concat(col2Op), top);
      place(col1Extra, pos.intExp ? pos.intExp.y + pos.intExp.h + gap : top);
    } else {
      // 无拆分（如杭州银行）：手续费/公允损失放到利息支出右侧，营业收入下移对齐剩余利息，避免色带上穿重叠
      place(
        col1Extra.map((n) => ({ ...n, col: 2 })),
        top,
      );
      let opY = pos.intExp ? pos.intExp.y + pos.intExp.h + gap : top;
      col1Extra.forEach((n) => {
        const p = pos[n.id];
        if (p) opY = Math.max(opY, p.y + p.h + gap);
      });
      place(col2Op, opY);
    }
    place(byCol[3], pos.opInc ? pos.opInc.y : top);
    const opexSplitSet = new Set(OPEX_SPLITS.map((s) => s.id));
    place(
      byCol[4].filter((n) => opexSplitSet.has(n.id)),
      pos.opex ? pos.opex.y : top,
    );
    place(
      byCol[4].filter((n) => !opexSplitSet.has(n.id)),
      pos.pretax ? pos.pretax.y : top,
    );

    const srcOff = {};
    const tgtOff = {};
    const order = links.slice().sort((a, b) => {
      const sa = pos[a.source];
      const sb = pos[b.source];
      const ta = pos[a.target];
      const tb = pos[b.target];
      if (!sa || !sb || !ta || !tb) return 0;
      if (sa.y !== sb.y) return sa.y - sb.y;
      return ta.y - tb.y;
    });
    const laidLinks = [];
    order.forEach((l) => {
      const s = pos[l.source];
      const t = pos[l.target];
      if (!s || !t) return;
      const w = Math.max(l.value * scale, 1.2);
      srcOff[s.id] = srcOff[s.id] || 0;
      tgtOff[t.id] = tgtOff[t.id] || 0;
      const y0 = s.y + srcOff[s.id] + w / 2;
      const y1 = t.y + tgtOff[t.id] + w / 2;
      srcOff[s.id] += w;
      tgtOff[t.id] += w;
      laidLinks.push({
        ...l,
        width: w,
        color: s.color,
        cx: (s.x + s.w + t.x) / 2,
        cy: (y0 + y1) / 2,
        path: ribbon(s.x + s.w, y0, t.x, y1, w),
        hitPath: ribbon(s.x + s.w, y0, t.x, y1, Math.max(w, 12)),
      });
    });
    return { W, H, laidNodes: laid, laidLinks };
  }

  function tipFor(hover, nodes, links, curMaps, prevMaps) {
    if (hover.kind === "link") {
      const srcLabel = labelOf(nodes, hover.source);
      const tgtLabel = labelOf(nodes, hover.target);
      return {
        title: `${srcLabel} → ${tgtLabel}`,
        amount: fmtYi(hover.value),
        sharePrev: `占${srcLabel} ${pct(hover.value, curMaps.nodeValue[hover.source])}`,
        shareNext: `占${tgtLabel} ${pct(hover.value, curMaps.nodeValue[hover.target])}`,
        yoy: fmtYoy(hover.value, prevMaps.linkValue[`${hover.source}|${hover.target}`]),
      };
    }
    const incoming = links.filter((l) => l.target === hover.id);
    const outgoing = links.filter((l) => l.source === hover.id);
    let sharePrev;
    if (incoming.length === 1) {
      const srcLabel = labelOf(nodes, incoming[0].source);
      sharePrev = `占${srcLabel} ${pct(hover.value, curMaps.nodeValue[incoming[0].source])}`;
    } else if (incoming.length === 0) {
      sharePrev = "收入起点";
    } else {
      const top = incoming.reduce((a, b) => (a.value >= b.value ? a : b));
      const srcLabel = labelOf(nodes, top.source);
      sharePrev = `最大流入占${srcLabel} ${pct(top.value, curMaps.nodeValue[top.source])}`;
    }
    let shareNext = "";
    if (outgoing.length === 1) {
      const tgtLabel = labelOf(nodes, outgoing[0].target);
      shareNext = `占${tgtLabel} ${pct(outgoing[0].value, curMaps.nodeValue[outgoing[0].target])}`;
    } else if (outgoing.length > 1) {
      const top = outgoing.reduce((a, b) => (a.value >= b.value ? a : b));
      const tgtLabel = labelOf(nodes, top.target);
      shareNext = `最大流出占${tgtLabel} ${pct(top.value, curMaps.nodeValue[top.target])}`;
    }
    return {
      title: hover.label,
      amount: fmtYi(hover.value),
      sharePrev,
      shareNext,
      yoy: fmtYoy(hover.value, prevMaps.nodeValue[hover.id]),
    };
  }

  function render(container, opts) {
    const years = opts.years || {};
    const year = opts.year;
    const d = years[year];
    if (!d) {
      container.innerHTML = '<p class="placeholder">该报告期暂无利润流向。</p>';
      return;
    }
    const prev = opts.prevYear ? years[opts.prevYear] : null;
    const curMaps = flowValues(d);
    const prevMaps = prev ? flowValues(prev) : { nodeValue: {}, linkValue: {} };
    const { nodes, links } = curMaps;
    const laid = layout(nodes, links);
    const pills = (opts.yearList || [year])
      .map(
        (y) =>
          `<button type="button" class="pnl-year-btn${y === year ? " active" : ""}" data-year="${y}">${y}年报</button>`,
      )
      .join("");

    const gross = grossOf(d);
    const per100 = gross ? Math.round((d.parent / gross) * 100) : 0;
    const parentOfGross = pct(d.parent, gross);
    container.innerHTML = `
      <div class="pnl-toolbar">
        <div class="pnl-year-pills">${pills}</div>
      </div>
      <div class="pnl-hero">
        <div class="pnl-stat">
          <div class="pnl-stat-value">${fmtYi(gross)}</div>
          <div class="pnl-stat-label">${year}毛收入</div>
        </div>
        <div class="pnl-stat">
          <div class="pnl-stat-value">${fmtYi(d.opInc)}</div>
          <div class="pnl-stat-label">营业收入</div>
        </div>
        <div class="pnl-stat pnl-stat-parent">
          <div class="pnl-stat-value">${fmtYi(d.parent)}</div>
          <div class="pnl-stat-label">归母净利润</div>
        </div>
        <div class="pnl-stat pnl-stat-share">
          <div class="pnl-stat-value">${parentOfGross}</div>
          <div class="pnl-stat-label">毛收入→归母</div>
        </div>
      </div>
      <div class="pnl-callout">
        <div class="pnl-callout-title">${year}年每100元毛收入，约${per100}元变成归母净利润</div>
        <div class="pnl-callout-body">${summaryNote(d)}</div>
      </div>
      <div class="pnl-chart-head">
        <span>${year}年报利润流向</span>
        <span class="pnl-chart-head-note">悬停色带：金额、占上一节点、占后一输出项、同比</span>
      </div>
      <div class="pnl-chart-wrap">
        <svg viewBox="0 0 ${laid.W} ${laid.H}" width="100%" role="img" aria-label="${opts.name || ""}利润流向桑基图" class="pnl-svg"></svg>
        <div class="pnl-tip hidden"></div>
      </div>
      <p class="pnl-caption">利息收入扣到利息支出再进营收，是排版用水填，不是分账户对应。</p>
    `;

    const svg = container.querySelector(".pnl-svg");
    const tipEl = container.querySelector(".pnl-tip");
    const ns = "http://www.w3.org/2000/svg";
    let hover = null;

    function setTip(h) {
      hover = h;
      laid.laidLinks.forEach((l) => {
        const on = !h
          ? true
          : h.kind === "link"
            ? l.source === h.source && l.target === h.target
            : l.source === h.id || l.target === h.id;
        l.el.setAttribute("fill-opacity", h ? (on ? "0.52" : "0.08") : "0.28");
      });
      laid.laidNodes.forEach((n) => {
        const on = !h || (h.kind === "node" ? n.id === h.id : h.source === n.id || h.target === n.id);
        n.el.setAttribute("opacity", on ? "1" : "0.25");
        n.textEl.setAttribute("fill", on ? "#1f2430" : "#b0b4bc");
      });
      if (!h) {
        tipEl.classList.add("hidden");
        container.querySelector(".pnl-caption").textContent =
          "利息收入扣到利息支出再进营收，是排版用水填，不是分账户对应。";
        return;
      }
      const tip = tipFor(h, nodes, links, curMaps, prevMaps);
      const shareHtml = `<div>${tip.sharePrev}</div>${tip.shareNext ? `<div>${tip.shareNext}</div>` : ""}`;
      tipEl.innerHTML = `<div class="pnl-tip-title">${tip.title}</div><div>金额 ${tip.amount}</div>${shareHtml}<div>${tip.yoy}</div>`;
      tipEl.classList.remove("hidden");
      const laidItem =
        h.kind === "link"
          ? laid.laidLinks.find((l) => l.source === h.source && l.target === h.target)
          : laid.laidNodes.find((n) => n.id === h.id);
      const wrap = container.querySelector(".pnl-chart-wrap");
      const rect = wrap.getBoundingClientRect();
      const sx = rect.width / laid.W;
      const sy = rect.height / laid.H;
      const cx = laidItem && laidItem.cx != null ? laidItem.cx : laidItem ? laidItem.x + laidItem.w / 2 : laid.W / 2;
      const cy = laidItem && laidItem.cy != null ? laidItem.cy : laidItem ? laidItem.y : 24;
      let left = cx * sx - 120;
      let top = cy * sy - 108;
      left = Math.max(8, Math.min(left, rect.width - 248));
      top = Math.max(8, Math.min(top, rect.height - 118));
      tipEl.style.left = `${left}px`;
      tipEl.style.top = `${top}px`;
      const shareText = tip.shareNext ? `${tip.sharePrev} · ${tip.shareNext}` : tip.sharePrev;
      container.querySelector(".pnl-caption").textContent =
        `${tip.title}  ${tip.amount} · ${shareText} · ${tip.yoy}`;
    }

    laid.laidLinks.forEach((l) => {
      const g = document.createElementNS(ns, "g");
      g.style.cursor = "pointer";
      const hit = document.createElementNS(ns, "path");
      hit.setAttribute("d", l.hitPath);
      hit.setAttribute("fill", "#fff");
      hit.setAttribute("fill-opacity", "0");
      const vis = document.createElementNS(ns, "path");
      vis.setAttribute("d", l.path);
      vis.setAttribute("fill", COLORS[l.color] || COLORS.gray);
      vis.setAttribute("fill-opacity", "0.28");
      vis.style.pointerEvents = "none";
      l.el = vis;
      g.appendChild(hit);
      g.appendChild(vis);
      g.addEventListener("mouseenter", () =>
        setTip({ kind: "link", source: l.source, target: l.target, value: l.value }),
      );
      g.addEventListener("mouseleave", () => setTip(null));
      svg.appendChild(g);
    });

    laid.laidNodes.forEach((n) => {
      const g = document.createElementNS(ns, "g");
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", n.x);
      rect.setAttribute("y", n.y);
      rect.setAttribute("width", n.w);
      rect.setAttribute("height", n.h);
      rect.setAttribute("rx", "2");
      rect.setAttribute("fill", COLORS[n.color] || COLORS.gray);
      n.el = rect;
      const help = NODE_HELP[n.id];
      const text = document.createElementNS(ns, "text");
      const textX = n.col === 0 ? n.x - 8 - (help ? 18 : 0) : n.x + n.w + 8;
      text.setAttribute("x", textX);
      text.setAttribute("y", n.labelY);
      text.setAttribute("text-anchor", n.col === 0 ? "end" : "start");
      text.setAttribute("fill", "#1f2430");
      text.setAttribute("font-size", "11");
      text.setAttribute("font-weight", n.id === "parent" ? "600" : "400");
      text.style.pointerEvents = "none";
      text.textContent = `${n.label} ${fmtYi(n.value)}`;
      n.textEl = text;
      rect.addEventListener("mouseenter", () =>
        setTip({ kind: "node", id: n.id, label: n.label, value: n.value }),
      );
      rect.addEventListener("mouseleave", () => setTip(null));
      g.appendChild(rect);
      g.appendChild(text);
      svg.appendChild(g);
    });

    const wrap = container.querySelector(".pnl-chart-wrap");
    function positionNodeHelp() {
      if (!wrap || !svg) return;
      const svgRect = svg.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      if (!svgRect.width) return;
      const sx = svgRect.width / laid.W;
      const sy = svgRect.height / laid.H;
      wrap.querySelectorAll(".pnl-node-help").forEach((btn) => {
        const n = laid.laidNodes.find((x) => x.id === btn.getAttribute("data-node-id"));
        if (!n) return;
        const x = n.x - 17;
        const y = n.labelY - 5;
        btn.style.left = `${svgRect.left - wrapRect.left + x * sx - 7}px`;
        btn.style.top = `${svgRect.top - wrapRect.top + y * sy - 7}px`;
      });
    }
    laid.laidNodes.forEach((n) => {
      const help = NODE_HELP[n.id];
      if (!help || !wrap) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "col-help-btn pnl-node-help";
      btn.textContent = "?";
      btn.setAttribute("data-node-id", n.id);
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", `${help.title}的含义`);
      btn.setAttribute("data-help-title", help.title);
      btn.setAttribute("data-help-body", help.body);
      wrap.appendChild(btn);
    });
    positionNodeHelp();
    if (typeof ResizeObserver !== "undefined" && wrap) {
      const ro = new ResizeObserver(positionNodeHelp);
      ro.observe(wrap);
    }

    container.querySelectorAll(".pnl-year-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (typeof opts.onYearChange === "function") opts.onYearChange(btn.getAttribute("data-year"));
      });
    });
  }

  global.PnlSankey = { render, fmtYi, pct };
})(window);
