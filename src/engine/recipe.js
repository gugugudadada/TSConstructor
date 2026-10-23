/* 构造配方引擎（Demo · 第一阶段核心）
   = 把"直接编辑 + 组件组合"整理为**结构化、可复用、可变化**的配方，并在不同源样本上执行。

   设计要点（对应 idea 的 RQ1/RQ2）：
   · 配方 = 有序 **操作步**（step）：组件 / 点拖拽 / 时间弯曲 / 克隆 / 纹理 / 擦除 / 水平平移 / 幅值缩放；
     每步都结构化记录对象、区间、参数、源样本，而不是只存最终数组。
   · 每步带 `vary`：哪些维度允许在生成时变化（位置 / 宽度 / 强度 / 源）。
   · runRecipe：给定基源样本 + 配方 → 结果曲线 + 逐级中间结果 + **逐点归因贡献**。
   · 归因贡献使"哪些来自源样本、哪些由构造规则引入"可被计算（来源构成带 = RQ3 反馈，第二阶段使用）。
   · 引擎另备 结构指纹 / 目标属性 / 保留约束 求值（供第二阶段判据板）；第一阶段不调用。
   · instantiateSteps：按"泛化控制"的轴（基源替换 / 参数扰动 / 锚点漂移 / 宽度缩放 /
     片段源与纹理源替换 / 残差注入）实例化配方 → 每条候选携带"为何不同"的差异签名。

   🔴 确定性：所有随机源 = mulberry32 种子链；同 seed 同设置 → 逐位一致。
   🔴 不静默：不可行 / 失败都显式记录（失败原因）。 */

import { mulberry32, cosineWindow, smoothMap } from './ops.js';
import { detectAll } from './structures.js';

export const RECIPE_SPEC_VERSION = 'recipe-v1.0.0';
export const VARIATION_SPEC_VERSION = 'variation-v1.0.0';

/* ═══════════ 基础统计（确定性） ═══════════ */

export function medianOf(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  if (!n) return 0;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export function basicStats(values) {
  const L = values.length;
  let mean = 0, mn = Infinity, mx = -Infinity;
  for (const v of values) { mean += v; if (v < mn) mn = v; if (v > mx) mx = v; }
  mean /= L;
  let vr = 0;
  for (const v of values) vr += (v - mean) ** 2;
  return { mean, min: mn, max: mx, std: Math.sqrt(vr / L) || 1e-12 };
}

/* 对称滑动平均（边缘窗收缩）——残差提取的"趋势面" */
export function movingAvg(values, win = 9) {
  const L = values.length;
  const out = new Float64Array(L);
  const h = Math.max(1, Math.floor(win / 2));
  for (let i = 0; i < L; i++) {
    const a = Math.max(0, i - h), b = Math.min(L - 1, i + h);
    let s = 0;
    for (let k = a; k <= b; k++) s += values[k];
    out[i] = s / (b - a + 1);
  }
  return out;
}

export function residualOf(values, win = 9) {
  const ma = movingAvg(values, win);
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] - ma[i];
  return out;
}

/* 粗糙度 = 二阶差分绝对均值（与 v4 几何引擎同口径的"高频能量"读数） */
export function roughnessOf(values) {
  let s = 0;
  for (let i = 1; i < values.length - 1; i++) s += Math.abs(values[i + 1] - 2 * values[i] + values[i - 1]);
  return s / Math.max(1, values.length - 2);
}

/* 尾部电平差 = 中位(后 25 点) − 中位(前 25 点)（登记口径，固定点数而非比例） */
export function tailDropOf(values) {
  const n = values.length;
  const w = Math.min(25, n);
  if (!w) return 0;
  return medianOf(values.slice(n - w)) - medianOf(values.slice(0, w));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ═══════════ 组件库（可直接编辑的构造基底） ═══════════ */

function gauss(i, a, w) { const z = (i - a) / Math.max(1e-6, w); return Math.exp(-0.5 * z * z); }

export const COMPONENTS = [
  {
    key: 'pulse', name: '脉冲', glyph: '⌒', color: '#e07a2f', family: '组件',
    note: '区间中心的高斯峰（宽度控制形状）',
    params: [
      { key: 'width', label: '宽度', unit: '点', min: 1, max: 60, step: 1, def: 7 },
      { key: 'amp', label: '强度', unit: '×σ', min: -3, max: 3, step: 0.05, def: 0.9 },
    ],
  },
  {
    key: 'plateau', name: '平台', glyph: '▬', color: '#7a6fb0', family: '组件',
    note: '区间内的平滑抬升 / 压平段',
    params: [
      { key: 'width', label: '长度', unit: '点', min: 3, max: 100, step: 1, def: 26 },
      { key: 'amp', label: '强度', unit: '×σ', min: -3, max: 3, step: 0.05, def: -0.4 },
    ],
  },
  {
    key: 'trend', name: '趋势', glyph: '╱', color: '#8d99a6', family: '组件',
    note: '区间内线性倾斜（总变化量）',
    params: [
      { key: 'amp', label: '强度', unit: '×σ', min: -2, max: 2, step: 0.02, def: 0.4 },
    ],
  },
  {
    key: 'oscillation', name: '震荡', glyph: '∿', color: '#4a8f8a', family: '组件',
    note: '区间内包络正弦震荡（周期 + 包络宽）',
    params: [
      { key: 'width', label: '包络宽', unit: '点', min: 3, max: 100, step: 1, def: 34 },
      { key: 'period', label: '周期', unit: '点', min: 3, max: 60, step: 1, def: 7 },
      { key: 'amp', label: '强度', unit: '×σ', min: -2, max: 2, step: 0.02, def: 0.14 },
    ],
  },
  {
    key: 'noise', name: '噪声', glyph: '▒', color: '#a0a0a0', family: '组件',
    note: '区间内种子化均匀抖动（可选平滑）',
    params: [
      { key: 'amp', label: '强度', unit: '×σ', min: 0, max: 0.6, step: 0.005, def: 0.05 },
      { key: 'win', label: '平滑窗', unit: '点', min: 1, max: 9, step: 2, def: 1 },
    ],
  },
];

export function componentByKey(key) { return COMPONENTS.find((c) => c.key === key) ?? null; }

/* 组件形状（单位 = σ 的倍数；未乘 stdBase）。
   作用区间 = op.span；区间外为 0。区间内仍由组件自己的形状参数（width/period 等）决定形。
   ctx.noiseSeed 供噪声组件使用。 */
export function componentShape(op, L, ctx = {}) {
  const out = new Float64Array(L);
  let a0 = 0, a1 = L - 1;
  if (Array.isArray(op.span)) {
    a0 = clamp(Math.round(Math.min(op.span[0], op.span[1])), 0, L - 1);
    a1 = clamp(Math.round(Math.max(op.span[0], op.span[1])), 0, L - 1);
  }
  if (a1 < a0) { const t = a0; a0 = a1; a1 = t; }
  const a = (a0 + a1) / 2;
  const w = Math.max(1e-6, op.width ?? 8);
  switch (op.component) {
    case 'pulse':
      for (let i = a0; i <= a1; i++) out[i] = gauss(i, a, w);
      break;
    case 'plateau': {
      const edge = Math.max(1, w * 0.10);
      const h = w / 2;
      for (let i = a0; i <= a1; i++) out[i] = 0.5 * (Math.tanh((i - (a - h)) / edge) - Math.tanh((i - (a + h)) / edge));
      break;
    }
    case 'oscillation': {
      const period = Math.max(2, op.period ?? 8);
      for (let i = a0; i <= a1; i++) out[i] = Math.sin((2 * Math.PI * (i - a)) / period) * gauss(i, a, w);
      break;
    }
    case 'trend':
      for (let i = a0; i <= a1; i++) out[i] = ((i - a0) / Math.max(1, a1 - a0) - 0.5) * 2;   // 区间内 −1 → +1
      break;
    case 'noise': {
      const rng = mulberry32((ctx.noiseSeed ?? 1) >>> 0);
      const win = Math.max(1, op.win ?? 1);
      const raw = new Float64Array(L);
      for (let i = 0; i < L; i++) raw[i] = rng() * 2 - 1;
      if (win > 1) {
        const ma = movingAvg(raw, win);
        let s = 0;
        for (let i = 0; i < L; i++) s += ma[i] * ma[i];
        s = Math.sqrt(s / L) || 1e-12;
        for (let i = 0; i < L; i++) raw[i] = ma[i] / s;
      }
      for (let i = a0; i <= a1; i++) out[i] = raw[i];
      break;
    }
    default:
      return null;
  }
  return out;
}

/* ═══════════ 操作步执行 ═══════════ */

function interpArr(arr, x) {
  const i = clamp(Math.floor(x), 0, arr.length - 1);
  const f = x - i;
  const j = Math.min(i + 1, arr.length - 1);
  return arr[i] * (1 - f) + arr[j] * f;
}

/* 时间弯曲（区间内线性形变 + 两侧线性补偿 + 重采样回原长；与 v4 口径一致，余弦核平滑） */
function warpTime(values, span, f, delta) {
  const L = values.length;
  let a = clamp(Math.round(span[0]), 0, L - 1);
  let b = clamp(Math.round(span[1]), 0, L - 1);
  if (b < a) { const t = a; a = b; b = t; }
  const S = b - a;
  if (S < 2) return null;
  if (Math.abs(f - 1) < 1e-9 && Math.round(delta) === 0) return values.slice();
  let segStart = a + Math.round(delta);
  if (segStart < 0) segStart = 0;
  let segEnd = segStart + S * f;
  if (segEnd > L - 1) {
    const Sfit = Math.floor((L - 1 - segStart) / f);
    if (Sfit < 2) return null;
    segEnd = segStart + Sfit * f;
  }
  const map = new Float64Array(L);
  for (let k = 0; k < L; k++) {
    let t;
    if (k < segStart) t = segStart <= 0 ? 0 : a * (k / segStart);
    else if (k <= segEnd) t = a + (k - segStart) / f;
    else t = segEnd >= L - 1 ? L - 1 : b + (k - segEnd) * ((L - 1 - b) / Math.max(1e-9, L - 1 - segEnd));
    map[k] = clamp(t, 0, L - 1);
  }
  map[0] = 0; map[L - 1] = L - 1;
  const sm = smoothMap(map, Math.max(1, Math.round(0.08 * S)));
  const out = new Array(L);
  for (let k = 0; k < L; k++) out[k] = interpArr(values, sm[k]);
  return out;
}

/* 单步执行：返回新数组（或 null = 机械不可行 + reason） */
export function applyStep(cur, step, ctx) {
  const L = cur.length;
  const base = ctx.baseValues ?? cur;
  const stdBase = ctx.stdBase ?? basicStats(base).std;
  switch (step.kind) {
    case 'component': {
      const shape = componentShape(step, L, ctx);
      if (!shape) return { values: null, reason: '无可用参考源（纹理）' };
      const wt = step.weight ?? 1;
      const amp = step.amp ?? 0;
      if (!amp) return { values: cur.slice(), unit: '×σ' };
      const out = new Array(L);
      if (step.mix === 'multiply') {
        for (let i = 0; i < L; i++) out[i] = cur[i] * (1 + wt * amp * shape[i]);
      } else if (step.mix === 'replace') {
        const loc = movingAvg(base, 15);
        for (let i = 0; i < L; i++) out[i] = (1 - wt) * cur[i] + wt * (loc[i] + stdBase * amp * shape[i]);
      } else {
        for (let i = 0; i < L; i++) out[i] = cur[i] + stdBase * amp * shape[i];
      }
      return { values: out, unit: '×σ' };
    }
    case 'texture': {
      /* 素材·纹理：借参考样本的高频残差，按 stdBase·amount 注入全条。 */
      const donor = ctx.sampleValues ? ctx.sampleValues(step.source) : null;
      if (!donor) return { values: null, reason: '纹理源缺失' };
      const amount = Number.isFinite(step.amount) ? step.amount : 0;
      if (!amount) return { values: cur.slice(), unit: '×σ' };
      const r = residualOf(donor, step.win ?? 9);
      let s = 0;
      for (let i = 0; i < r.length; i++) s += r[i] * r[i];
      s = Math.sqrt(s / Math.max(1, r.length)) || 1e-12;
      const out = new Array(L);
      for (let i = 0; i < L; i++) out[i] = cur[i] + stdBase * amount * (r[i] ?? 0) / s;
      return { values: out, unit: '×σ' };
    }
    case 'deform': {
      const out = new Array(L);
      const a = step.anchor, w = Math.max(1, step.width);
      for (let i = 0; i < L; i++) out[i] = cur[i] + step.amp * gauss(i, a, w);
      return { values: out };
    }
    case 'warp': {
      const out = warpTime(cur, step.span, step.factor ?? 1, step.delta ?? 0);
      if (!out) return { values: null, reason: '区间过短 / 越界（不可无损）' };
      return { values: out };
    }
    case 'transplant': {
      const donor = ctx.sampleValues ? ctx.sampleValues(step.source) : null;
      if (!donor) return { values: null, reason: '片段源缺失' };
      let s0 = clamp(Math.round(Math.min(step.srcSpan[0], step.srcSpan[1])), 0, donor.length - 1);
      let s1 = clamp(Math.round(Math.max(step.srcSpan[0], step.srcSpan[1])), 0, donor.length - 1);
      if (s1 - s0 + 1 < 3) return { values: null, reason: '片段过短（至少 3 点）' };
      let snap = donor.slice(s0, s1 + 1);
      let dst0, dst1;
      if (step.dstSpan) {
        dst0 = clamp(Math.round(Math.min(step.dstSpan[0], step.dstSpan[1])), 0, L - 1);
        dst1 = clamp(Math.round(Math.max(step.dstSpan[0], step.dstSpan[1])), 0, L - 1);
        if (dst1 - dst0 + 1 < 3) return { values: null, reason: '落点区间过短（至少 3 点）' };
        const dl = dst1 - dst0 + 1;
        if (dl !== snap.length) {
          const re = new Array(dl);
          for (let k = 0; k < dl; k++) re[k] = interpArr(snap, (k * (snap.length - 1)) / Math.max(1, dl - 1));
          snap = re;
        }
      } else {
        dst0 = clamp(Math.round(step.dstStart ?? 0), 0, L - 1);
        dst1 = dst0 + snap.length - 1;
        if (dst1 > L - 1) return { values: null, reason: '落点越界' };
      }
      const len = snap.length;
      const alpha = step.alpha ?? 1;
      const seam = Math.max(1, Math.min(step.seam ?? 6, Math.floor(len / 3)));
      const out = cur.slice();
      for (let k = 0; k < len; k++) {
        let bf = alpha;
        if (k < seam) bf *= 0.5 * (1 - Math.cos((Math.PI * k) / seam));
        else if (k >= len - seam) bf *= 0.5 * (1 - Math.cos((Math.PI * (len - 1 - k)) / seam));
        out[dst0 + k] = out[dst0 + k] * (1 - bf) + snap[k] * bf;
      }
      return { values: out };
    }
    case 'erase': {
      if (!step.span) return { values: null, reason: '缺少区间' };
      const d0 = clamp(Math.round(Math.min(step.span[0], step.span[1])), 0, L - 1);
      const d1 = clamp(Math.round(Math.max(step.span[0], step.span[1])), 0, L - 1);
      const n = d1 - d0 + 1;
      if (n < 3) return { values: null, reason: '区间过短（至少 3 点）' };
      /* 擦除 = 用区间两端点做余弦平滑桥接；两端点保持原值，内部不再保留原形状。 */
      const y0 = cur[d0];
      const y1 = cur[d1];
      const out = cur.slice();
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const s = 0.5 - 0.5 * Math.cos(Math.PI * t);
        out[d0 + k] = y0 + (y1 - y0) * s;
      }
      return { values: out };
    }
    case 'scale': {
      /* 幅值缩放：以区间内当前值的局部均值为 pivot，两端余弦羽化回原值。 */
      if (!step.span) return { values: null, reason: '缺少区间' };
      const d0 = clamp(Math.round(Math.min(step.span[0], step.span[1])), 0, L - 1);
      const d1 = clamp(Math.round(Math.max(step.span[0], step.span[1])), 0, L - 1);
      const n = d1 - d0 + 1;
      if (n < 3) return { values: null, reason: '区间过短（至少 3 点）' };
      const factor = Number.isFinite(step.factor) ? step.factor : 1;
      if (Math.abs(factor - 1) < 1e-9) return { values: cur.slice(), unit: '×' };
      let pivot = 0;
      for (let k = 0; k < n; k++) pivot += cur[d0 + k];
      pivot /= n;
      const seam = Math.max(1, Math.min(Math.round(step.feather ?? 8), Math.floor(n / 3)));
      const out = cur.slice();
      for (let k = 0; k < n; k++) {
        let w = 1;
        if (k < seam) w = 0.5 * (1 - Math.cos((Math.PI * k) / seam));
        else if (k >= n - seam) w = 0.5 * (1 - Math.cos((Math.PI * (n - 1 - k)) / seam));
        out[d0 + k] = cur[d0 + k] + (factor - 1) * (cur[d0 + k] - pivot) * w;
      }
      return { values: out, unit: '×' };
    }
    case 'shift': {
      /* 水平平移：在选区内把波形整体左右平移，区间外不变；两端余弦羽化回原位。 */
      if (!step.span) return { values: null, reason: '缺少区间' };
      const d0 = clamp(Math.round(Math.min(step.span[0], step.span[1])), 0, L - 1);
      const d1 = clamp(Math.round(Math.max(step.span[0], step.span[1])), 0, L - 1);
      const n = d1 - d0 + 1;
      if (n < 3) return { values: null, reason: '区间过短（至少 3 点）' };
      const delta = clamp(Math.round(Number.isFinite(step.delta) ? step.delta : 0), -(n - 1), n - 1);
      if (!delta) return { values: cur.slice(), unit: '点' };
      const seam = Math.max(1, Math.min(Math.round(step.feather ?? 8), Math.floor(n / 3)));
      const out = cur.slice();
      for (let k = 0; k < n; k++) {
        const src = clamp(k - delta, 0, n - 1);
        let w = 1;
        if (k < seam) w = 0.5 * (1 - Math.cos((Math.PI * k) / seam));
        else if (k >= n - seam) w = 0.5 * (1 - Math.cos((Math.PI * (n - 1 - k)) / seam));
        out[d0 + k] = cur[d0 + k] * (1 - w) + cur[d0 + src] * w;
      }
      return { values: out, unit: '点' };
    }
    default:
      return { values: null, reason: `未知操作：${step.kind}` };
  }
}

/* 运行配方：返回 { values, stages, contribs } */
export function runRecipe(baseValues, steps, ctx = {}) {
  let cur = baseValues.slice();
  const stages = [{ id: 'base', kind: 'base', label: '基源', values: cur.slice() }];
  const contribs = [];
  const stdBase = basicStats(baseValues).std;
  const runCtx = { ...ctx, baseValues, stdBase };
  for (const step of steps) {
    if (step.enabled === false) continue;
    const prev = cur;
    const r = applyStep(cur, step, runCtx);
    if (!r.values) {
      stages.push({ id: step.id, kind: step.kind, label: stepLabel(step), values: prev, note: r.reason, failed: true });
      continue;
    }
    cur = r.values;
    const diff = new Float64Array(cur.length);
    let mx = 0;
    for (let i = 0; i < cur.length; i++) { const d = Math.abs(cur[i] - prev[i]); diff[i] = d; if (d > mx) mx = d; }
    contribs.push({ id: step.id, kind: step.kind, label: stepLabel(step), diff, max: mx, unit: r.unit ?? null });
    stages.push({ id: step.id, kind: step.kind, label: stepLabel(step), values: cur.slice(), note: r.note, max: mx });
  }
  return { values: cur, stages, contribs, stdBase };
}

/* 逐点归因：每个点被哪一步主导（贡献低于阈值 → 归为"源样本保留"） */
export function attributionOf(contribs, baseValues, shareThreshold = 0.05) {
  const L = baseValues.length;
  const st = basicStats(baseValues);
  const scale = Math.max(1e-9, st.std);
  const owners = new Array(L).fill(null);
  const amounts = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    let best = null, bv = 0;
    for (const c of contribs) { const d = c.diff[i]; if (d > bv) { bv = d; best = c; } }
    if (best && bv > shareThreshold * scale) { owners[i] = best.id; amounts[i] = bv; }
  }
  return { owners, amounts, scale };
}

/* 来源构成（两类口径：主导点数占比 / 变化量占比）——供"来源构成带"与 RQ2 证据 */
export function sourceComposition(steps, contribs, owners, baseValues) {
  const catOf = (kind) => (kind === 'transplant' || kind === 'texture' ? 'borrowed'
    : kind === 'component' ? 'component' : 'direct');
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const byCat = { base: 0, component: 0, borrowed: 0, direct: 0 };
  const byStep = new Map();
  const L = baseValues.length;
  for (let i = 0; i < L; i++) {
    const id = owners[i];
    if (!id) { byCat.base += 1; continue; }
    const s = stepById.get(id);
    const cat = catOf(s?.kind ?? 'component', s?.component ?? null);
    byCat[cat] += 1;
    byStep.set(id, (byStep.get(id) ?? 0) + 1);
  }
  let totalChange = 0;
  const changeByCat = { base: 0, component: 0, borrowed: 0, direct: 0 };
  for (const c of contribs) {
    const cat = catOf(c.kind, stepById.get(c.id)?.component ?? null);
    let s = 0;
    for (let i = 0; i < L; i++) s += c.diff[i];
    totalChange += s;
    changeByCat[cat] += s;
  }
  const norm = (o) => {
    const t = Object.values(o).reduce((a, b) => a + b, 0) || 1;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / t]));
  };
  return {
    dominant: norm(byCat),
    change: norm(changeByCat),
    byStep: Object.fromEntries(byStep),
    totalChange,
    covered: 1 - (byCat.base / L),
  };
}

export function stepLabel(step) {
  switch (step.kind) {
    case 'component': { const c = componentByKey(step.component); return c ? c.name : step.component; }
    case 'deform': return '点拖拽';
    case 'warp': return '时间形变';
    case 'transplant': return '克隆';
    case 'texture': return '纹理';
    case 'erase': return '区间擦除';
    case 'scale': return '缩放';
    case 'shift': return '水平平移';
    default: return step.kind;
  }
}

/* ═══════════ 结构指纹 / 目标属性 / 保留约束 ═══════════ */

export function structureFingerprint(values) {
  const det = detectAll(values);
  const st = basicStats(values);
  const counts = {
    peakCount: det.peak.instances.length,
    valleyCount: det.valley.instances.length,
    stepCount: det.step.instances.length,
    plateauCount: det.plateau.instances.length,
    pulseCount: det.pulse.instances.length,
    rampCount: det.ramp.instances.length,
  };
  return {
    ...counts,
    ampMax: st.max,
    ampMin: st.min,
    std: st.std,
    mean: st.mean,
    roughness: roughnessOf(values),
    tailDrop: tailDropOf(values),
    features: {
      peak: det.peak.instances,
      valley: det.valley.instances,
      step: det.step.instances,
      plateau: det.plateau.instances,
      pulse: det.pulse.instances,
      ramp: det.ramp.instances,
    },
  };
}

export const ATTR_DEFS = [
  { key: 'tailDrop', label: '尾部电平差', unit: '原值', ops: ['≤', '≥', '∈'], tol: 0.04, hint: '中位(后 25 点) − 中位(前 25 点)' },
  { key: 'roughness', label: '粗糙度', unit: '二阶差分均值', ops: ['≤', '≥', '∈'], tol: 0.012, hint: '逐点二阶差分绝对均值——高频扰动强度' },
  { key: 'peakCount', label: '峰数量', unit: '个', ops: ['≤', '≥', '∈', '≈'], tol: 0, integer: true, hint: '几何峰检测（与 v4 引擎同口径）' },
  { key: 'valleyCount', label: '谷数量', unit: '个', ops: ['≤', '≥', '∈', '≈'], tol: 0, integer: true },
  { key: 'stepCount', label: '阶跃数量', unit: '个', ops: ['≤', '≥', '∈', '≈'], tol: 0, integer: true },
  { key: 'plateauCount', label: '平台数量', unit: '个', ops: ['≤', '≥', '∈', '≈'], tol: 0, integer: true },
  { key: 'rampCount', label: '斜坡数量', unit: '个', ops: ['≤', '≥', '∈', '≈'], tol: 0, integer: true },
  { key: 'pulseCount', label: '脉冲数量', unit: '个', ops: ['≤', '≥', '∈', '≈'], tol: 0, integer: true },
  { key: 'ampMax', label: '最大值', unit: '原值', ops: ['≤', '≥', '∈'], tol: 0.1 },
  { key: 'ampMin', label: '最小值', unit: '原值', ops: ['≤', '≥', '∈'], tol: 0.1 },
  { key: 'std', label: '标准差', unit: '原值', ops: ['≤', '≥', '∈'], tol: 0.05 },
];

export function attrDef(key) { return ATTR_DEFS.find((a) => a.key === key) ?? null; }
export function attrValue(key, fp) { return fp[key]; }

export function evalPredicate(op, lo, hi, v) {
  if (v == null || !Number.isFinite(v)) return null;
  if (op === '≤') return hi == null ? null : v <= hi + 1e-9;
  if (op === '≥') return lo == null ? null : v >= lo - 1e-9;
  if (op === '≈') return lo == null ? null : Math.abs(v - lo) <= (hi ?? 0) + 1e-9;
  const a = lo == null ? -Infinity : lo;
  const b = hi == null ? Infinity : hi;
  return v >= a - 1e-9 && v <= b + 1e-9;
}

export function describeInvariant(inv) {
  const def = attrDef(inv.key);
  const name = def?.label ?? inv.key;
  if (inv.op === '≤') return `${name} ≤ ${fmt(inv.hi)}`;
  if (inv.op === '≥') return `${name} ≥ ${fmt(inv.lo)}`;
  if (inv.op === '≈') return `${name} ≈ ${fmt(inv.lo)}${inv.hi ? ` ±${fmt(inv.hi)}` : ''}`;
  return `${name} ∈ [${inv.lo == null ? '−∞' : fmt(inv.lo)}, ${inv.hi == null ? '∞' : fmt(inv.hi)}]`;
}
function fmt(v) { if (v == null) return '—'; const a = Math.abs(v); return a >= 10 ? v.toFixed(2) : v.toFixed(3); }

/* 约束求值：输入值数组或已算好的指纹 */
export function evalInvariant(inv, fp) {
  const def = attrDef(inv.key);
  const v = attrValue(inv.key, fp);
  const pass = evalPredicate(inv.op, inv.lo, inv.hi, v);
  return { key: inv.key, label: def?.label ?? inv.key, value: v, pass, text: describeInvariant(inv) };
}

export function evalInvariants(invs, fp) {
  const rows = invs.filter((x) => x.mode !== 'off').map((inv) => ({ id: inv.id, mode: inv.mode, ...evalInvariant(inv, fp) }));
  const hard = rows.filter((r) => r.mode === 'hard');
  const soft = rows.filter((r) => r.mode === 'soft');
  return {
    rows,
    hardFail: hard.some((r) => r.pass === false),
    softFail: soft.some((r) => r.pass === false),
    passCount: rows.filter((r) => r.pass === true).length,
    failCount: rows.filter((r) => r.pass === false).length,
  };
}

/* ═══════════ 泛化控制：按轴实例化配方 ═══════════ */

export function defaultVary(kind) {
  if (kind === 'component') return { pos: true, width: true, amp: true, src: false };
  if (kind === 'deform') return { pos: true, width: true, amp: true, src: false };
  /* warp 的时间位移 delta 属于"位置"轴；它没有幅值轴，别把"强"误接到 delta。 */
  if (kind === 'warp') return { pos: true, width: true, amp: false, src: false };
  if (kind === 'transplant') return { pos: true, width: true, amp: true, src: true };
  if (kind === 'erase') return { pos: true, width: false, amp: false, src: false };
  if (kind === 'scale') return { pos: true, width: false, amp: true, src: false };
  if (kind === 'shift') return { pos: true, width: false, amp: false, src: false };
  if (kind === 'texture') return { pos: false, width: false, amp: true, src: true };
  return { pos: true, width: true, amp: true, src: false };
}

/* 组件的「位 / 宽」现在都作用于 span：位 = 区间平移，宽 = 区间长度变化。 */
export function varyTagsOf(step) {
  const v = step.vary ?? defaultVary(step.kind);
  const out = [];
  if (v.pos) out.push(['pos', '位']);
  if (v.width) out.push(['width', '宽']);
  if (v.amp) out.push(['amp', '强']);
  if (v.src && (step.kind === 'transplant' || step.kind === 'texture')) out.push(['src', '源']);
  return out;
}

function spanOf(step, L) {
  const a = Array.isArray(step.span) ? step.span[0] : 0;
  const b = Array.isArray(step.span) ? step.span[1] : L - 1;
  return [clamp(Math.round(Math.min(a, b)), 0, L - 1), clamp(Math.round(Math.max(a, b)), 0, L - 1)];
}

function shiftSpan(step, d, L) {
  let [a, b] = spanOf(step, L);
  let len = b - a + 1;
  if (len > L) len = L;
  a = clamp(a + d, 0, L - len);
  step.span = [a, a + len - 1];
}

function scaleSpan(step, factor, L) {
  let [a, b] = spanOf(step, L);
  const len = b - a + 1;
  const center = (a + b) / 2;
  let nl = clamp(Math.round(len * factor), 3, L);
  a = clamp(Math.round(center - nl / 2), 0, L - nl);
  step.span = [a, a + nl - 1];
  return [len, nl];
}

function pickOther(pool, current, rng) {
  if (!pool || !pool.length) return current;
  const others = pool.filter((id) => id !== current);
  if (!others.length) return pool[Math.floor(rng() * pool.length)];
  return others[Math.floor(rng() * others.length)];
}

/* 实例化配方：opts = {
     rng, L, axes: {source, segment, param, anchor, width, residual},
     baseId, basePool: [id], segmentPool: [id], texturePool: [id],
     sampleValues(id) -> values|null, noiseSeed
   }
   返回 { steps, tags }；tags 为"差异签名"条目。 */
export function instantiateSteps(steps, opts) {
  const { rng, L, axes, sampleValues } = opts;
  const out = [];
  const tags = [];
  const jf = (v, axis, min, max) => clamp(v * (1 + (rng() * 2 - 1) * axis), min, max);
  const jp = (v, axis, min, max, integer) => {
    let n = v + (rng() * 2 - 1) * axis;
    if (integer) n = Math.round(n);
    return clamp(n, min, max);
  };
  for (const step of steps) {
    if (step.enabled === false) continue;
    const s = JSON.parse(JSON.stringify(step));
    const vary = step.vary ?? defaultVary(step.kind);
    const parts = [];
    if (s.kind === 'component') {
      if (vary.pos) {
        const before = spanOf(s, L);
        const d = Math.round((rng() * 2 - 1) * axes.anchor);
        if (d !== 0) {
          shiftSpan(s, d, L);
          parts.push(`位${d > 0 ? '+' : ''}${d}`);
        } else {
          s.span = before;
        }
      }
      if (vary.width) {
        const [oldLen, newLen] = scaleSpan(s, 1 + (rng() * 2 - 1) * axes.width, L);
        if (newLen !== oldLen) parts.push(`宽${pct(oldLen, newLen)}`);
      }
      if (s.amp != null && vary.amp) { const nv = jf(s.amp, axes.param, -3, 3); if (nv !== s.amp) parts.push(`强${pct(s.amp, nv)}`); s.amp = nv; }
    } else if (s.kind === 'deform') {
      if (vary.pos) { const nv = jp(s.anchor, axes.anchor, 0, L - 1, false); if (nv !== s.anchor) parts.push(`位${delta(s.anchor, nv)}`); s.anchor = nv; }
      if (vary.width) { const nv = jf(s.width, axes.width, 1, L / 2); if (nv !== s.width) parts.push(`宽${pct(s.width, nv)}`); s.width = nv; }
      if (vary.amp) { const nv = jf(s.amp, axes.param, -10, 10); if (nv !== s.amp) parts.push(`强${pct(s.amp, nv)}`); s.amp = nv; }
    } else if (s.kind === 'warp') {
      if (s.delta != null && vary.pos) { const nv = Math.round(jp(s.delta, axes.anchor, -12, 12, true)); if (nv !== s.delta) parts.push(`位${delta(s.delta, nv)}`); s.delta = nv; }
      if (vary.width) { const nv = clamp(s.factor * (1 + (rng() * 2 - 1) * axes.width * 0.4), 0.8, 1.25); if (nv !== s.factor) parts.push(`f${pct(s.factor, nv)}`); s.factor = nv; }
    } else if (s.kind === 'transplant') {
      if (vary.src && axes.segment && opts.segmentPool?.length) {
        const old = s.source;
        s.source = pickOther(opts.segmentPool, old, rng);
        if (s.source !== old) parts.push('源换');
      }
      if (vary.pos) {
        const d = Math.round((rng() * 2 - 1) * axes.anchor);
        if (d !== 0) {
          s.srcSpan = [clamp(s.srcSpan[0] + d, 0, L - 1), clamp(s.srcSpan[1] + d, 0, L - 1)];
          if (s.dstSpan) s.dstSpan = [clamp(s.dstSpan[0] + d, 0, L - 1), clamp(s.dstSpan[1] + d, 0, L - 1)];
          else s.dstStart = clamp(s.dstStart + d, 0, L - 1);
          parts.push(`位${d > 0 ? '+' : ''}${d}`);
        }
      }
      if (vary.width && s.dstSpan) {
        const len = s.dstSpan[1] - s.dstSpan[0] + 1;
        const nl = Math.max(3, Math.round(jf(len, axes.width, 3, L)));
        if (nl !== len) { s.dstSpan = [s.dstSpan[0], clamp(s.dstSpan[0] + nl - 1, 0, L - 1)]; parts.push(`宽${nl - len > 0 ? '+' : ''}${nl - len}`); }
      }
      /* 克隆的"强度"轴 = 混合系数 alpha；此前 UI 允许勾选但实例化没有消费该轴。 */
      if (s.alpha != null && vary.amp) {
        const nv = clamp(s.alpha * (1 + (rng() * 2 - 1) * axes.param), 0, 1);
        if (nv !== s.alpha) parts.push(`强${pct(s.alpha, nv)}`);
        s.alpha = nv;
      }
    } else if (s.kind === 'texture') {
      if (vary.src && axes.segment && opts.texturePool?.length) {
        const old = s.source;
        s.source = pickOther(opts.texturePool, old, rng);
        if (s.source !== old) parts.push('源换');
      }
      if (vary.amp) {
        const baseAmount = Number.isFinite(s.amount) ? s.amount : 0;
        const nv = clamp(baseAmount * (1 + (rng() * 2 - 1) * axes.param), 0, 1.5);
        if (nv !== s.amount) parts.push(`强${pct(baseAmount, nv)}`);
        s.amount = nv;
      }
    } else if (s.kind === 'erase') {
      if (vary.pos) {
        const d = Math.round((rng() * 2 - 1) * axes.anchor);
        if (d !== 0) { s.span = [clamp(s.span[0] + d, 0, L - 1), clamp(s.span[1] + d, 0, L - 1)]; parts.push(`位${d > 0 ? '+' : ''}${d}`); }
      }
    } else if (s.kind === 'scale') {
      if (vary.pos) {
        const d = Math.round((rng() * 2 - 1) * axes.anchor);
        if (d !== 0) { s.span = [clamp(s.span[0] + d, 0, L - 1), clamp(s.span[1] + d, 0, L - 1)]; parts.push(`位${d > 0 ? '+' : ''}${d}`); }
      }
      if (vary.amp) {
        const baseFactor = Number.isFinite(s.factor) ? s.factor : 1;
        const nv = clamp(baseFactor * (1 + (rng() * 2 - 1) * axes.param), 0.5, 2);
        if (nv !== s.factor) parts.push(`强${pct(baseFactor, nv)}`);
        s.factor = nv;
      }
    } else if (s.kind === 'shift') {
      if (vary.pos) {
        const d = Math.round((rng() * 2 - 1) * axes.anchor);
        if (d !== 0) { s.span = [clamp(s.span[0] + d, 0, L - 1), clamp(s.span[1] + d, 0, L - 1)]; parts.push(`位${d > 0 ? '+' : ''}${d}`); }
      }
    }
    if (parts.length) tags.push({ opId: step.id, kind: s.kind, label: stepLabel(s), parts });
    out.push(s);
  }
  return { steps: out, tags };
}

function delta(a, b) { const d = b - a; return `${d >= 0 ? '+' : ''}${Math.round(d * 10) / 10}`; }
function pct(a, b) { const p = ((b - a) / (Math.abs(a) || 1)) * 100; return `${p >= 0 ? '+' : ''}${Math.round(p)}%`; }

/* 全条残差注入（全局差异来源之一）：借用某参考样本的残差，按 σ 比例加入 */
export function injectResidual(values, donorValues, amountSigma, win = 9) {
  if (!donorValues || amountSigma <= 0) return values.slice();
  const r = residualOf(donorValues, win);
  const s = Math.sqrt(r.reduce((t, v) => t + v * v, 0) / r.length) || 1e-12;
  const st = basicStats(values).std;
  const k = (amountSigma * st) / s;
  return values.map((v, i) => v + r[i] * k);
}

/* 随机增强基线（idea §9 对照 2：常见随机增强）——增益 + 抖动，不含结构操作、不含约束设计 */
export function randomAugment(baseValues, rng, { gain = 0.12, jitter = 0.08 } = {}) {
  const st = basicStats(baseValues);
  const g = 1 + (rng() * 2 - 1) * gain;
  return baseValues.map((v) => v * g + (rng() * 2 - 1) * jitter * st.std);
}

/* 候选集的多样性读数（确定性）：平均/最近两两欧氏距离，按"数据尺度"归一 */
export function diversityOf(list, scale) {
  const n = list.length;
  if (n < 2) return { mean: 0, min: 0, n };
  let sum = 0, cnt = 0, mn = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = euclid(list[i], list[j]);
      sum += d; cnt += 1; if (d < mn) mn = d;
    }
  }
  return { mean: sum / cnt / (scale || 1), min: mn / (scale || 1), n };
}

export function euclid(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}
