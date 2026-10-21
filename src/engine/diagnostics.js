/* 编辑方向诊断（距离统计层）—— ⚠ 复用自 v2 `src/engine/diagnostics.js`（README D1：引擎/工具代码可直接复用）。
   2026-10-06 原样承继（含全部口径与边界注释）。

   🔴 R5.4 口径（逐字承 v2）：
     Δ(x) = d(x, 类A质心) − d(x, 类B质心)；**A = 目标类（本系统要增强的那类），B = 另一个类**；
     **同侧样本 Δ < 0**（符号即"偏向哪一侧"，不取绝对值）。
     先例：`v2/docs/reports/m2-diag.md:13`。**只用质心，不训练分类器；禁写 "Fisher direction"**。
   ⚠ 存在条件：二分类 + 类标签 + 质心几何——不满足时 `axisDelta` 返回 `null`（调用方**自隐**，不得渲染成 0）。
   ⚠ Dmed 定标原则：`d(v, s) / median(类内两两互距)`（相对漂移比，无量纲）——直系祖先 `v2/docs/prereg/m2-v1.2.md:23`。 */

export const MAX_INTRA = 300;

export function dist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/* 分位数（R type-7 / numpy 默认） */
export function quantile(sorted, p) {
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function summarize(values) {
  const v = [...values].sort((a, b) => a - b);
  return {
    n: v.length,
    min: v.length ? v[0] : null,
    q25: quantile(v, 0.25),
    median: quantile(v, 0.5),
    q75: quantile(v, 0.75),
    q95: quantile(v, 0.95),
    max: v.length ? v[v.length - 1] : null,
  };
}

/* 目标类两两互距（基准尺 = Dmed 的来源）；n > cap 时等距抽样并自报 */
export function pairwiseDist(samples, cap = MAX_INTRA) {
  const total = samples.length;
  let xs = samples;
  let mode = 'all';
  if (total > cap) {
    mode = 'stride';
    xs = Array.from({ length: cap }, (_, i) => samples[Math.floor((i * total) / cap)]);
  }
  const values = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) values.push(dist(xs[i].values, xs[j].values));
  }
  return { values, n: xs.length, of: total, mode };
}

/* 候选逐条：d(到自身源) / r(相对漂移比, 以 intraMedian=Dmed 为尺) / dNN(到最近真实类样本，排除源自身) */
export function candidateDistances(candidates, samples, sourceOf, intraMedian) {
  const rows = candidates.map((c) => {
    const s = sourceOf(c);
    const d = s ? dist(c.values, s.values) : null;
    let dnn = null;
    if (s) {
      for (const x of samples) {
        if (x.id === s.id) continue;
        const t = dist(c.values, x.values);
        if (dnn === null || t < dnn) dnn = t;
      }
    }
    return { id: c.id, source: s ? s.id : null, d, r: d !== null && intraMedian ? d / intraMedian : null, dNN: dnn };
  });
  return rows;
}

export function centroidOf(samples) {
  if (!samples || !samples.length) return null;
  const L = samples[0].values.length;
  const c = new Array(L).fill(0);
  for (const s of samples) for (let j = 0; j < L; j++) c[j] += s.values[j];
  for (let j = 0; j < L; j++) c[j] /= samples.length;
  return c;
}

export function distToCentroid(values, c) {
  let s = 0;
  for (let i = 0; i < values.length; i++) { const d = values[i] - c[i]; s += d * d; }
  return Math.sqrt(s);
}

/* 返回 { ca, cb, of } 或 null（存在条件不满足 → 调用方整层自隐） */
export function axisBasis(clsA, clsB) {
  const ca = centroidOf(clsA), cb = centroidOf(clsB);
  if (!ca || !cb || ca.length !== cb.length) return null;
  return { ca, cb, of: { a: clsA.length, b: clsB.length } };
}

/* 逐点 Δ = d(x, 类A) − d(x, 类B)；A = 目标类 → 同侧样本 Δ < 0（符号方向已在 v2 被 smoke 钉住，勿改序） */
export function axisDelta(basis, values) {
  if (!basis) return null;
  return distToCentroid(values, basis.ca) - distToCentroid(values, basis.cb);
}
