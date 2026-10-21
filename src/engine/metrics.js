/* Metric 登记表（canonical definition）+ 计算实现 —— Step 3 §二 2.5 的开发契约。
   🔴 规则：新增 metric 走同一登记 + CHOOSE 检查；不得只写"距离/幅值/宽度"而不定义口径。 */

/* 度量登记表版本（step-07 v1.1 §六 P0-4）：任一定义变更即 bump——
   判据语义复现 = criterionVersion + metricSpecVersion（另：候选生成 = generationSpecVersion）。 */
export const METRIC_SPEC_VERSION = 'met-v1.0.0';

export const METRICS = [
  {
    key: 'density', name: 'Cell Count', zh: '密度格计数',
    def: '样本所在网格单元内的目标类样本数', space: 'canonical 投影平面 · 10×10 规则网格',
    unit: '条', scope: '当前目标类', abs: true,
  },
  {
    key: 'peak', name: 'Peak Amplitude', zh: '峰幅',
    def: 'max(v)——序列最大值（绝对口径，非相对基线）', space: '原始值域',
    unit: '原值', scope: '单样本', abs: true,
  },
  {
    key: 'width', name: 'Peak–Valley Width', zh: '峰谷宽',
    def: '|argmax(v) − argmin(v)|', space: '原始索引域',
    unit: '采样点', scope: '单样本', abs: true,
  },
  {
    key: 'dist', name: 'Distance to Centroid', zh: '类内距离',
    def: '样本到当前目标类质心的欧氏距离', space: 'canonical 投影平面（与结构面一致，可目验）',
    unit: '平面单位', scope: '当前目标类', abs: true,
  },
];

/* 密度格：以目标类的投影范围为方形域，规则 bins×bins 网格 */
export function buildDensity(proj, targetIdx, bins = 10) {
  if (!targetIdx.length) {
    return {
      bins, x0: 0, y0: 0, cell: 1, counts: new Int32Array(bins * bins),
      cellOf: new Map(), max: 0, span: 1, cx: 0, cy: 0,
    };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of targetIdx) {
    const p = proj[i];
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9) * 1.02;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const x0 = cx - span / 2, y0 = cy - span / 2;
  const cell = span / bins;
  const counts = new Int32Array(bins * bins);
  const cellOf = new Map();
  for (const i of targetIdx) {
    const p = proj[i];
    const c = Math.min(bins - 1, Math.max(0, Math.floor((p.x - x0) / cell)));
    const r = Math.min(bins - 1, Math.max(0, Math.floor((p.y - y0) / cell)));
    const k = r * bins + c;
    counts[k] += 1;
    cellOf.set(i, k);
  }
  let max = 0; for (const v of counts) if (v > max) max = v;
  return { bins, x0, y0, cell, counts, cellOf, max, span, cx, cy };
}

export function centroidOf(proj, idx) {
  let sx = 0, sy = 0;
  for (const i of idx) { sx += proj[i].x; sy += proj[i].y; }
  const n = Math.max(1, idx.length);
  return { x: sx / n, y: sy / n };
}

/* 数据集级纵轴范围（所有小波形共用——保证列表/池条之间的形状可比） */
export function yRangeOf(samples) {
  let min = Infinity, max = -Infinity;
  for (const s of samples) for (const v of s.values) { if (v < min) min = v; if (v > max) max = v; }
  return { min, max };
}

export function fmtNum(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(3);
}

/* 逐样本读数（只对目标类计算；两个展示位置同一数据源） */
export function computeMetricValues(samples, proj, density, centroid, targetIdx) {
  const values = new Map();
  for (const i of targetIdx) {
    const s = samples[i];
    let mi = 0, ma = 0;
    for (let k = 1; k < s.values.length; k++) {
      if (s.values[k] < s.values[mi]) mi = k;
      if (s.values[k] > s.values[ma]) ma = k;
    }
    const p = proj[i];
    values.set(s.id, {
      density: density.cellOf.has(i) ? density.counts[density.cellOf.get(i)] : 0,
      peak: s.values[ma],
      width: Math.abs(ma - mi),
      dist: Math.hypot(p.x - centroid.x, p.y - centroid.y),
    });
  }
  return values;
}
