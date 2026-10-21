/* 复用自 v2 `src/engine/ops.js`（README D1：引擎/工具代码可直接复用——工具，不是设计）。
   2026-10-06：mulberry32 / peakWarp / cosineWindow 原样承继；peakWarp 改为同时返回**时间映射**
   （step-04 v1.1 §3.4 坐标系语义：区间在 canonical 声明，执行层按映射确定性地转到管线坐标）。
   2026-10-15：peakWarpMapped（峰锚时长弯曲）随"自动峰锚退役"删除——词表 changelog d2-v2.2.0。 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function peak(values) {
  let m = -Infinity;
  for (const v of values) if (v > m) m = v;
  return m;
}

/* 区间权重窗：区间内 = 1，区间外 = 0，两端各 rampFrac×区间长度 余弦平滑过渡。
   ⚠ 窗宽 rampFrac 为 [S:] 常数（step-04 §六）：v1 沿用 0.08，Step 8 定稿。 */
export function cosineWindow(L, i0, i1, rampFrac = 0.08) {
  const w = new Float64Array(L);
  const len = i1 - i0 + 1;
  const ramp = Math.max(1, Math.round(len * rampFrac));
  for (let k = 0; k < L; k++) {
    if (k < i0 - ramp || k > i1 + ramp) { w[k] = 0; continue; }
    if (k < i0) w[k] = 0.5 * (1 - Math.cos((Math.PI * (k - (i0 - ramp))) / ramp));
    else if (k > i1) w[k] = 0.5 * (1 - Math.cos((Math.PI * ((i1 + ramp) - k)) / ramp));
    else w[k] = 1;
  }
  return w;
}

/* F3 修复（v1.3.3）：时间映射余弦核平滑——对称核卷积对分段线性映射的**内部无影响**
   （线性函数的加权平均=原值），只在折点处磨平斜率突变；端点钉死。
   窗宽 R 由调用方给（口径 = 0.08×段长，比例）。 */
export function smoothMap(map, R) {
  const L = map.length;
  if (!(R >= 1)) return map;
  const w = [];
  let wsum = 0;
  for (let d = -R; d <= R; d++) { const c = 0.5 * (1 + Math.cos((Math.PI * d) / (R + 1))); w.push(c); wsum += c; }
  const out = new Float64Array(L);
  for (let k = 0; k < L; k++) {
    let s = 0;
    for (let d = -R; d <= R; d++) {
      const j = Math.min(L - 1, Math.max(0, k + d));
      s += map[j] * w[d + R];
    }
    out[k] = s / wsum;
  }
  out[0] = 0;
  out[L - 1] = L - 1;
  return out;
}
