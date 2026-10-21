/* 通用几何结构检测引擎（P1 · 2026-10-16）——判据板 v2 的"结构层"（数据集无关）。
   🔴 **本层只认几何，不认生理**：输出 = 峰 / 谷 / 脉冲 / 阶跃 / 平台 / 斜坡 的实例集；
   "R 峰 / T 波 / QRS / 等电线 / ST 段"这类命名属**领域层**（下一轮，且须先过验收门槛——
   见 docs/review/20261016-pjb/ruling.md §一 #2/#4）。
   🔴 **确定性**：禁 RNG；同输入 + 同参数 + 同 DETECTOR_SPEC_VERSION → 逐位一致
   （百次重跑断言在 tools/structures-sanity.mjs）。

   规格版本（判据 #19）：改任何检测规则或默认参数 = 版本 +1。

   通用约定
   - 输入 `values: number[]`（原始值域；**单位由数据契约声明，本层不换算**——见 docs/sample-contract.md）；
   - 输出 `{ instances, meta }`；实例 `i` = canonical 索引（相等值 run 取中点，向下取整）；
   - 高度/斜率类阈值默认口径 `×std`（样本标准差；std 恒 > 0，兜底 1e-12）；
     `unit:'abs'` 时按原值直接比（单位由上层契约声明为 mV 时才有物理含义）；
   - 首尾"缺一侧邻值"的位置不产生峰/谷实例（计入 `meta.edgeSkipped`，显式披露不静默）。

   检测器边界规则（逐条写死——gpt 复核 §四.1 要求；每条的注释即规格）
   - 峰：相等值 run 的中点，且 run 两端**严格**高于外侧邻值；显著性 = 经典地形显著性；
     去重 = 贪心 minGap 合并（窗内保留"更高 → 更显著 → 更小索引"者）。
   - 谷：峰的镜像（取负再镜像回来）。
   - 脉冲：峰的"窄而高"子集——半高宽（相对显著性基线）≤ wMax 且 高度 ≥ hMin。
   - 阶跃：滑动分割点两侧中值差 ≥ Δ 且**过渡带点数** ≤ tEdge；相邻候选按 W 合并（留更强）。
   - 平台：极差 ≤ ε 的**极大窗**（贪心最左最长、互不重叠；可贴数组两端），长度 ≥ nMin。
   - 斜坡：符号变化 ≤ 1 的**极大单调段**（"允许 1 点回折"），最小二乘斜率 ≥ sMin 且 |总变化| ≥ dTotal。 */

export const DETECTOR_SPEC_VERSION = 'struct-v1.0.0';

const stdOf = (v) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const s = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  return s > 0 ? s : 1e-12;
};
const medianOf = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

/* 经典地形显著性：从 **run 两端之外**（runStart−1 / runEnd+1）出发，走到"更高值"或数组端为止，
   取两侧极小值的较大者作基线。
   ⚠ 必须传 run 边界：平顶（相等值 run）若从 run 内部出发，会立刻撞上同值点被判 base=v → 高度 0（已修）。 */
function prominenceBase(values, runStart, runEnd) {
  const L = values.length;
  const v0 = values[runStart];
  let lm = v0;
  for (let k = runStart - 1; k >= 0; k--) {
    if (values[k] >= v0) break;
    if (values[k] < lm) lm = values[k];
  }
  let rm = v0;
  for (let k = runEnd + 1; k < L; k++) {
    if (values[k] >= v0) break;
    if (values[k] < rm) rm = values[k];
  }
  return Math.max(lm, rm);
}

/* 贪心 minGap 合并：按索引序；与"已保留的最后一个"距离 < minGap 时择优（更高 → 更显著 → 更小索引） */
function mergeByGap(list, minGap, scoreOf) {
  const out = [];
  for (const inst of list) {
    const last = out[out.length - 1];
    if (last && inst.i - last.i < minGap) {
      const a = scoreOf(last);
      const b = scoreOf(inst);
      if (b > a || (b === a && inst.i < last.i)) out[out.length - 1] = inst;
      continue;
    }
    out.push(inst);
  }
  return out;
}

/* ── ① 峰 Peak ── */
export function detectPeaks(values, opts = {}) {
  const { minHeight = 0.5, minProminence = 0.3, minGap = 8, unit = 'std' } = opts;
  const L = values.length;
  const scale = unit === 'std' ? stdOf(values) : 1;
  const hThr = minHeight * scale;
  const pThr = minProminence * scale;
  const raw = [];
  let edgeSkipped = 0;
  let i = 0;
  while (i < L) {
    let j = i;
    while (j + 1 < L && values[j + 1] === values[i]) j += 1;   // 相等值 run [i, j]
    const leftOk = i > 0 ? values[i - 1] < values[i] : false;
    const rightOk = j < L - 1 ? values[j + 1] < values[j] : false;
    if (leftOk && rightOk) {
      const mid = Math.floor((i + j) / 2);
      const base = prominenceBase(values, i, j);
      raw.push({ i: mid, i0: i, i1: j, value: values[mid], height: values[mid] - base, prominence: values[mid] - base, base, polarity: 1 });
    } else if ((i === 0 && rightOk) || (j === L - 1 && leftOk)) {
      edgeSkipped += 1;   // "看着像但缺一侧邻值"——只披露，不产生实例
    }
    i = j + 1;
  }
  const kept = mergeByGap(
    raw.filter((x) => x.height >= hThr && x.prominence >= pThr),
    minGap,
    (x) => x.value * 1e6 + x.prominence,   // 主键 value、次键 prominence（同值时按索引）
  );
  return {
    instances: kept,
    meta: { kind: 'peak', spec: DETECTOR_SPEC_VERSION, n: kept.length, raw: raw.length, edgeSkipped, scale, params: { minHeight, minProminence, minGap, unit } },
  };
}

/* ── ② 谷 Valley ──（峰的镜像：取负 → 检测 → 符号翻回） */
export function detectValleys(values, opts = {}) {
  const r = detectPeaks(values.map((v) => -v), opts);
  return {
    instances: r.instances.map((x) => ({ ...x, value: -x.value, height: x.height, prominence: x.prominence, base: -x.base, polarity: -1 })),
    meta: { ...r.meta, kind: 'valley' },
  };
}

/* ── ③ 脉冲 Pulse ──（峰中"窄而高"者：半高宽 ≤ wMax 且 高度 ≥ hMin；半高相对显著性基线） */
export function detectPulses(values, opts = {}) {
  const { wMax = 20, hMin = 1.0, unit = 'std', minGap = 8 } = opts;
  const scale = unit === 'std' ? stdOf(values) : 1;
  const pk = detectPeaks(values, { minHeight: 0, minProminence: 0.05, minGap, unit });
  const out = [];
  for (const p of pk.instances) {
    if (p.height < hMin * scale) continue;
    const half = p.base + p.height / 2;
    let l = p.i;
    while (l - 1 >= 0 && values[l - 1] > half) l -= 1;
    let r = p.i;
    while (r + 1 < values.length && values[r + 1] > half) r += 1;
    const width = r - l;
    if (width <= wMax) out.push({ ...p, i: p.i, width, halfLeft: l, halfRight: r });
  }
  return {
    instances: out,
    meta: { kind: 'pulse', spec: DETECTOR_SPEC_VERSION, n: out.length, scale, params: { wMax, hMin, unit, minGap } },
  };
}

/* ── ④ 阶跃 Step ──（两侧电平差 ≥ Δ 且过渡带 ≤ tEdge；相邻候选按 W 合并留更强）
   电平估计用**外窗**：m₁ = 中值[p−3W, p−W)、m₂ = 中值[p+W, p+3W)——比 glm 稿的相邻窗稳：
   相邻窗会被慢沿自身污染（实测：10 点慢沿在相邻窗下把过渡带数成 3，被误判为阶跃）。 */
export function detectSteps(values, opts = {}) {
  const { delta = 0.15, W = 12, tEdge = 3, unit = 'std' } = opts;
  const L = values.length;
  const scale = unit === 'std' ? stdOf(values) : 1;
  const dThr = delta * scale;
  const cand = [];
  for (let p = 3 * W; p <= L - 3 * W; p++) {
    const m1 = medianOf(values.slice(p - 3 * W, p - W));
    const m2 = medianOf(values.slice(p + W, p + 3 * W));
    const d = Math.abs(m2 - m1);
    if (d < dThr) continue;
    const lo = Math.min(m1, m2), hi = Math.max(m1, m2);
    const mid = (lo + hi) / 2;
    /* 沿定位（修：此前直接报滑窗 p，对 W=12 的方波会偏 5 点）：取"跨过中点电平"的首个点 */
    let cross = -1;
    for (let k = Math.max(0, p - 2 * W); k <= Math.min(L - 1, p + 2 * W); k++) {
      if (m2 > m1 ? values[k] >= mid : values[k] <= mid) { cross = k; break; }
    }
    if (cross < 0) continue;
    /* 过渡带（修：此前只在 [p−W, p+W] 内数，慢沿会漏数——窗口放宽到 ±4W） */
    let band = 0, bandLo = cross, bandHi = cross;
    for (let k = Math.max(0, cross - 4 * W); k <= Math.min(L - 1, cross + 4 * W); k++) {
      if (values[k] > lo + 0.1 * d && values[k] < hi - 0.1 * d) { band += 1; bandLo = Math.min(bandLo, k); bandHi = Math.max(bandHi, k); }
    }
    if (band <= tEdge) cand.push({ i: cross, i0: bandLo, i1: bandHi, value: (m1 + m2) / 2, height: d, width: band, from: m1, to: m2, polarity: Math.sign(m2 - m1) });
  }
  /* 合并：与"已保留最后一个"距离 ≤ W → 留 Δ 更大者（并列留更小索引） */
  const out = [];
  for (const c of cand) {
    const last = out[out.length - 1];
    if (last && c.i - last.i <= W) {
      if (c.height > last.height) out[out.length - 1] = c;
      continue;
    }
    out.push(c);
  }
  return {
    instances: out,
    meta: { kind: 'step', spec: DETECTOR_SPEC_VERSION, n: out.length, raw: cand.length, scale, params: { delta, W, tEdge, unit } },
  };
}

/* ── ⑤ 平台 Plateau ──（极差 ≤ ε 的极大窗，贪心最左最长、互不重叠，可贴两端） */
export function detectPlateaus(values, opts = {}) {
  const { nMin = 5, eps = 0.05, minAbsMedian = null, unit = 'std' } = opts;
  const L = values.length;
  const scale = unit === 'std' ? stdOf(values) : 1;
  const epsAbs = eps * scale;
  const out = [];
  let i = 0;
  while (i < L) {
    let j = i, lo = values[i], hi = values[i];
    while (j + 1 < L) {
      const nlo = Math.min(lo, values[j + 1]);
      const nhi = Math.max(hi, values[j + 1]);
      if (nhi - nlo > epsAbs) break;
      j += 1; lo = nlo; hi = nhi;
    }
    if (j - i + 1 >= nMin) {
      const seg = values.slice(i, j + 1);
      const med = medianOf(seg);
      if (minAbsMedian == null || Math.abs(med) >= minAbsMedian) {
        out.push({ i: Math.floor((i + j) / 2), i0: i, i1: j, width: j - i + 1, value: med, range: hi - lo, height: hi - lo, polarity: 0 });
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return {
    instances: out,
    meta: { kind: 'plateau', spec: DETECTOR_SPEC_VERSION, n: out.length, scale, params: { nMin, eps, minAbsMedian, unit } },
  };
}

/* ── ⑥ 斜坡 Ramp ──（符号变化 ≤ 1 的极大单调段；最小二乘斜率 ≥ sMin 且 |总变化| ≥ dTotal） */
export function detectRamps(values, opts = {}) {
  const { nMin = 4, sMin = 0.02, dTotal = 0.2, unit = 'std' } = opts;
  const L = values.length;
  const scale = unit === 'std' ? stdOf(values) : 1;
  const sThr = sMin * scale, dThr = dTotal * scale;
  const out = [];
  let i = 0;
  while (i < L) {
    let j = i, flips = 0, prevSign = 0;
    const tol = 1e-9 * Math.max(1e-12, scale);   // 差值容差：浮点噪声（~1e-16）不算回折
    while (j + 1 < L) {
      const d = values[j + 1] - values[j];
      const sgn = Math.abs(d) <= tol ? 0 : Math.sign(d);
      if (sgn !== 0 && prevSign !== 0 && sgn !== prevSign) {
        if (flips >= 1) break;   // 已用掉唯一一次回折
        flips += 1;
      }
      if (sgn !== 0) prevSign = sgn;
      j += 1;
    }
    const n = j - i + 1;
    if (n >= nMin) {
      const delta = values[j] - values[i];
      if (Math.abs(delta) >= dThr) {
        /* 最小二乘斜率（确定性） */
        const xm = (n - 1) / 2;
        let num = 0, den = 0, ym = 0;
        for (let k = 0; k < n; k++) ym += values[i + k];
        ym /= n;
        for (let k = 0; k < n; k++) { num += (k - xm) * (values[i + k] - ym); den += (k - xm) ** 2; }
        const slope = num / den;
        if (Math.abs(slope) >= sThr) {
          out.push({ i: Math.floor((i + j) / 2), i0: i, i1: j, width: n, value: slope, slope, height: Math.abs(delta), delta, polarity: Math.sign(slope) });
        }
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return {
    instances: out,
    meta: { kind: 'ramp', spec: DETECTOR_SPEC_VERSION, n: out.length, scale, params: { nMin, sMin, dTotal, unit } },
  };
}

/* ── 注册表（几何名；无生理语义） ── */
export const STRUCTURES = [
  { kind: 'peak', label: '峰', run: detectPeaks, params: { minHeight: 0.5, minProminence: 0.3, minGap: 8, unit: 'std' } },
  { kind: 'valley', label: '谷', run: detectValleys, params: { minHeight: 0.5, minProminence: 0.3, minGap: 8, unit: 'std' } },
  { kind: 'pulse', label: '脉冲', run: detectPulses, params: { wMax: 20, hMin: 1.0, minGap: 8, unit: 'std' } },
  { kind: 'step', label: '阶跃', run: detectSteps, params: { delta: 0.15, W: 12, tEdge: 3, unit: 'std' } },
  { kind: 'plateau', label: '平台', run: detectPlateaus, params: { nMin: 5, eps: 0.05, unit: 'std' } },
  { kind: 'ramp', label: '斜坡', run: detectRamps, params: { nMin: 4, sMin: 0.02, dTotal: 0.2, unit: 'std' } },
];
export function structureByKind(kind) { return STRUCTURES.find((s) => s.kind === kind) ?? null; }

/* 一把全跑（走查/可视化用；参数逐类可覆写） */
export function detectAll(values, paramsByKind = {}) {
  const out = {};
  for (const s of STRUCTURES) out[s.kind] = s.run(values, { ...s.params, ...(paramsByKind[s.kind] ?? {}) });
  return out;
}
