/* P1 结构适配层：复用现有 structures.js 的检测器，统一成可编辑结构实例。
 *
 * 现有 structures.js 继续承担“几何检测”；本文件只做：
 *   - 检测灵敏度预设（集中配置）
 *   - 原始 detector 输出 → 统一实例契约
 *   - 稳定 id / 相对位置 / 归一化宽度 / 适用属性
 *
 * 约束：
 *   - 纯函数、无 RNG；
 *   - 只做几何结构，不赋予领域语义；
 *   - 不替代 structureFingerprint() 的既有检测口径。
 */
import {
  detectPeaks, detectValleys, detectPlateaus, detectRamps, DETECTOR_SPEC_VERSION,
} from './structures.js';

export const STRUCTURE_TYPES = [
  { key: 'plateau', label: '平台', short: 'P', color: '#2a78d6' },
  { key: 'peak', label: '峰', short: '∧', color: '#e07a2f' },
  { key: 'valley', label: '谷', short: '∨', color: '#7a6fb0' },
  { key: 'ramp', label: '斜坡', short: 'R', color: '#4a8f8a' },
];

const TYPE_ORDER = Object.fromEntries(STRUCTURE_TYPES.map((t, i) => [t.key, i]));

function stdOf(values) {
  const n = values.length;
  if (!n) return 1e-12;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;
  let ss = 0;
  for (const v of values) ss += (v - mean) ** 2;
  return Math.sqrt(ss / n) || 1e-12;
}

const NORMAL = {
  peak: { minHeight: 0.5, minProminence: 0.3, minGap: 8, unit: 'std' },
  plateau: { nMin: 5, eps: 0.05, unit: 'std' },
  ramp: { nMin: 4, sMin: 0.02, dTotal: 0.2, unit: 'std' },
};

export const STRUCTURE_SENSITIVITY = {
  strict: {
    peak: { minHeight: 0.8, minProminence: 0.55, minGap: 10, unit: 'std' },
    plateau: { nMin: 7, eps: 0.035, unit: 'std' },
    ramp: { nMin: 6, sMin: 0.04, dTotal: 0.3, unit: 'std' },
  },
  normal: NORMAL,
  loose: {
    peak: { minHeight: 0.3, minProminence: 0.15, minGap: 6, unit: 'std' },
    plateau: { nMin: 4, eps: 0.08, unit: 'std' },
    ramp: { nMin: 3, sMin: 0.012, dTotal: 0.12, unit: 'std' },
  },
};

export const DEFAULT_STRUCTURE_SENSITIVITY = 'normal';

export function structureConfigFor(value = DEFAULT_STRUCTURE_SENSITIVITY) {
  const key = typeof value === 'string' ? value : value?.sensitivity;
  const preset = STRUCTURE_SENSITIVITY[key] ?? NORMAL;
  return {
    ...preset,
    peak: { ...preset.peak },
    plateau: { ...preset.plateau },
    ramp: { ...preset.ramp },
  };
}

export function structureSensitivityOf(value) {
  const key = typeof value === 'string' ? value : value?.sensitivity;
  return STRUCTURE_SENSITIVITY[key] ? key : DEFAULT_STRUCTURE_SENSITIVITY;
}

function instanceOf(type, raw, L, scale) {
  const start = Math.max(0, Math.min(L - 1, Math.floor(Math.min(raw.i0 ?? raw.i, raw.i1 ?? raw.i))));
  const end = Math.max(0, Math.min(L - 1, Math.ceil(Math.max(raw.i0 ?? raw.i, raw.i1 ?? raw.i))));
  const center = Math.max(start, Math.min(end, Math.round(raw.i ?? (start + end) / 2)));
  const width = end - start + 1;
  const isPeak = type === 'peak' || type === 'valley';
  const isRamp = type === 'ramp';
  const sigma = scale > 0 ? scale : 1e-12;
  const level = isRamp ? null : (Number.isFinite(raw.value) ? raw.value / sigma : null);
  const rawHeight = isRamp
    ? (Number.isFinite(raw.delta) ? Math.abs(raw.delta) : raw.height)
    : (Number.isFinite(raw.height) ? raw.height : raw.range);
  const height = Number.isFinite(rawHeight) ? rawHeight / sigma : null;
  const prominence = isPeak && Number.isFinite(raw.prominence) ? raw.prominence / sigma : null;
  const direction = isRamp ? (raw.delta >= 0 ? 'up' : 'down') : null;
  return {
    id: `${type}:${start}-${end}:${center}`,
    type,
    label: STRUCTURE_TYPES.find((t) => t.key === type)?.label ?? type,
    startIndex: start,
    endIndex: end,
    centerIndex: center,
    relativePosition: L > 1 ? center / (L - 1) : 0,
    width,
    normalizedWidth: L ? width / L : 0,
    level,
    relativeLevel: level,
    height,
    prominence,
    direction,
    properties: isPeak
      ? { base: raw.base ?? null, polarity: raw.polarity ?? null, value: raw.value ?? null }
      : isRamp
        ? { slope: raw.slope ?? null, delta: raw.delta ?? null, polarity: raw.polarity ?? null }
        : { range: raw.range ?? null, median: raw.value ?? null },
  };
}

/* values: number[]；config: 'strict'|'normal'|'loose' 或 { sensitivity }。 */
export function detectEditableStructures(values, config = DEFAULT_STRUCTURE_SENSITIVITY) {
  const L = Array.isArray(values) ? values.length : 0;
  const sensitivity = structureSensitivityOf(config);
  const cfg = structureConfigFor(config);
  if (!L) {
    return {
      instances: [], byType: { plateau: [], peak: [], valley: [], ramp: [] },
      meta: { spec: DETECTOR_SPEC_VERSION, sensitivity, config: cfg, length: 0, scale: 1, counts: { plateau: 0, peak: 0, valley: 0, ramp: 0, total: 0 } },
    };
  }

  const scale = stdOf(values);
  const raw = {
    plateau: detectPlateaus(values, cfg.plateau),
    peak: detectPeaks(values, cfg.peak),
    valley: detectValleys(values, cfg.peak),
    ramp: detectRamps(values, cfg.ramp),
  };
  const byType = {};
  const instances = [];
  for (const t of STRUCTURE_TYPES) {
    const list = (raw[t.key]?.instances ?? []).map((x) => instanceOf(t.key, x, L, scale));
    list.sort((a, b) => a.centerIndex - b.centerIndex || a.startIndex - b.startIndex);
    byType[t.key] = list;
    instances.push(...list);
  }
  instances.sort((a, b) => (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || (a.centerIndex - b.centerIndex));

  const counts = Object.fromEntries(STRUCTURE_TYPES.map((t) => [t.key, byType[t.key].length]));
  counts.total = instances.length;
  return {
    instances,
    byType,
    meta: { spec: DETECTOR_SPEC_VERSION, sensitivity, config: cfg, length: L, scale, counts },
  };
}
