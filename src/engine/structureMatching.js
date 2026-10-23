/* 结构/自定义结构目标：描述、匹配、把目标解析成当前步骤的 span。
 *
 * 目标只在执行/生成前解析，不把“结构分支”塞进 applyStep：
 *   - 命中：改写步骤的 span（区间操作/组件）；
 *   - 失败：步骤级失败，保留前值并记录原因；
 *   - 自定义结构使用区间模板，在参考相对位置附近搜索相似形状；
 *   - 同一目标的多个步骤共享一个 offset：先平移后，后面的步骤自动跟随平移后的位置。
 */
import { detectEditableStructures, STRUCTURE_TYPES } from './structureAdapter.js';

export const TARGETABLE_KINDS = ['component', 'warp', 'erase', 'scale', 'shift'];

export const MATCH_CONFIG = {
  maxDistance: 0.5,
  ambiguityMargin: 0.08,
  customMinScore: 0.55,
};

const TYPE_LABEL = Object.fromEntries(STRUCTURE_TYPES.map((t) => [t.key, t.label]));

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function descriptorOfStructure(instance) {
  return {
    type: instance.type,
    relativePosition: instance.relativePosition,
    normalizedWidth: instance.normalizedWidth,
    relativeLevel: instance.relativeLevel ?? null,
    prominence: instance.prominence ?? null,
    direction: instance.direction ?? null,
  };
}

export function targetSummary(target) {
  if (!target) return '（无目标）';
  if (target.kind === 'region') return target.label || '区间';
  if (target.kind === 'custom') {
    const d = target.descriptor ?? {};
    return `自定义 ${target.label ?? ''} · 宽 ${d.width ?? '?'} 点 · 相对 ${Math.round((d.relativePosition ?? 0) * 100)}%`;
  }
  const d = target.descriptor;
  if (!d) return target.label || '结构';
  const bits = [TYPE_LABEL[d.type] ?? d.type, `相对 ${Math.round((d.relativePosition ?? 0) * 100)}%`, `宽 ${Math.round((d.normalizedWidth ?? 0) * 100)}%`];
  if (d.direction) bits.push(d.direction === 'up' ? '上升' : '下降');
  return bits.join(' · ');
}

/* ── 命名结构（P1 检测器） ── */

function structureDistance(descriptor, inst) {
  if (!descriptor || descriptor.type !== inst.type) return Infinity;
  const terms = [];
  terms.push({ w: 1.0, d: clamp(Math.abs(descriptor.relativePosition - inst.relativePosition), 0, 1) });
  const wDesc = Math.max(0.02, descriptor.normalizedWidth ?? 0);
  terms.push({ w: 0.8, d: clamp(Math.abs((descriptor.normalizedWidth ?? 0) - inst.normalizedWidth) / wDesc, 0, 1) });
  if (inst.type === 'peak' || inst.type === 'valley') {
    if (descriptor.relativeLevel != null && inst.relativeLevel != null) terms.push({ w: 0.5, d: clamp(Math.abs(descriptor.relativeLevel - inst.relativeLevel) / 1.5, 0, 1) });
    if (descriptor.prominence != null && inst.prominence != null) terms.push({ w: 0.8, d: clamp(Math.abs(descriptor.prominence - inst.prominence) / 1.5, 0, 1) });
  } else if (inst.type === 'plateau') {
    if (descriptor.relativeLevel != null && inst.relativeLevel != null) terms.push({ w: 0.5, d: clamp(Math.abs(descriptor.relativeLevel - inst.relativeLevel) / 1.5, 0, 1) });
  } else if (inst.type === 'ramp') {
    if (descriptor.direction && inst.direction && descriptor.direction !== inst.direction) terms.push({ w: 1.0, d: 1 });
    if (descriptor.relativeLevel != null && inst.relativeLevel != null) terms.push({ w: 0.5, d: clamp(Math.abs(descriptor.relativeLevel - inst.relativeLevel) / 1.5, 0, 1) });
  }
  const wSum = terms.reduce((s, x) => s + x.w, 0) || 1;
  return terms.reduce((s, x) => s + x.w * x.d, 0) / wSum;
}

function publicCandidate(c) {
  return {
    type: c.instance.type,
    label: TYPE_LABEL[c.instance.type] ?? c.instance.type,
    distance: +c.distance.toFixed(4),
    score: +c.score.toFixed(4),
    startIndex: c.instance.startIndex,
    endIndex: c.instance.endIndex,
    centerIndex: c.instance.centerIndex,
  };
}

function matchNamedStructure(descriptor, values, config) {
  const detection = detectEditableStructures(values, config.sensitivity ?? config);
  const candidates = detection.instances
    .filter((s) => s.type === descriptor?.type)
    .map((instance) => {
      const distance = structureDistance(descriptor, instance);
      return { instance, distance, score: 1 - distance };
    })
    .filter((c) => Number.isFinite(c.distance))
    .sort((a, b) => a.distance - b.distance || a.instance.centerIndex - b.instance.centerIndex);
  if (!candidates.length) {
    return { status: 'failed', reason: `没有检测到${TYPE_LABEL[descriptor?.type] ?? '对应'}结构`, span: null, candidates: [] };
  }
  const best = candidates[0];
  if (best.distance > MATCH_CONFIG.maxDistance) {
    return { status: 'failed', reason: `最近结构距离 ${best.distance.toFixed(3)} 超过阈值`, span: null, candidates: candidates.slice(0, 5).map(publicCandidate) };
  }
  const second = candidates[1];
  if (second && second.distance - best.distance < MATCH_CONFIG.ambiguityMargin) {
    return { status: 'failed', reason: `结构候选歧义（距离差 ${(second.distance - best.distance).toFixed(3)}）`, span: null, candidates: candidates.slice(0, 5).map(publicCandidate) };
  }
  return {
    status: 'matched',
    reason: '',
    span: [best.instance.startIndex, best.instance.endIndex],
    center: best.instance.centerIndex,
    score: best.score,
    type: descriptor.type,
    candidates: candidates.slice(0, 5).map(publicCandidate),
  };
}

/* ── 自定义结构（区间模板） ── */

function zNormalize(values) {
  const n = values.length;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= Math.max(1, n);
  let ss = 0;
  for (const v of values) ss += (v - mean) ** 2;
  const std = Math.sqrt(ss / Math.max(1, n)) || 1e-12;
  return { mean, std, norm: values.map((v) => (v - mean) / std) };
}

function resample(values, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * (values.length - 1)) / Math.max(1, n - 1);
    const a = Math.floor(x);
    const b = Math.min(values.length - 1, a + 1);
    const f = x - a;
    out[i] = values[a] * (1 - f) + values[b] * f;
  }
  return out;
}

function correlation(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / Math.max(1, a.length);
}

function matchCustomStructure(descriptor, values) {
  const L = values.length;
  const template = descriptor?.template;
  const refWidth = Math.max(3, Math.round(descriptor?.width ?? template?.length ?? 3));
  if (!Array.isArray(template) || !template.length) {
    return { status: 'failed', reason: '自定义结构缺少模板', span: null, candidates: [] };
  }
  const expected = (descriptor.relativePosition ?? 0.5) * Math.max(0, L - 1);
  const radius = Math.max(8, Math.round(L * 0.18));
  const widths = [...new Set([0.8, 0.9, 1, 1.1, 1.2]
    .map((f) => Math.round(refWidth * f))
    .map((w) => clamp(w, 3, L)))]
    .sort((a, b) => Math.abs(a - refWidth) - Math.abs(b - refWidth));
  const candidates = [];
  for (const width of widths) {
    const t = zNormalize(resample(template, width)).norm;
    const half = width / 2;
    const minStart = clamp(Math.round(expected - radius - half), 0, L - width);
    const maxStart = clamp(Math.round(expected + radius - half), 0, L - width);
    for (let start = minStart; start <= maxStart; start++) {
      const win = zNormalize(values.slice(start, start + width)).norm;
      const center = start + half;
      const positionPenalty = 0.18 * Math.min(1, Math.abs(center - expected) / Math.max(1, radius));
      const widthPenalty = 0.22 * Math.min(1, Math.abs(width - refWidth) / Math.max(1, refWidth));
      const score = correlation(t, win) - positionPenalty - widthPenalty;
      candidates.push({ start, end: start + width - 1, center, width, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.center - expected) - Math.abs(b.center - expected));
  if (!candidates.length) return { status: 'failed', reason: '自定义结构没有候选项', span: null, candidates: [] };
  const best = candidates[0];
  if (!Number.isFinite(best.score) || best.score < MATCH_CONFIG.customMinScore) {
    return { status: 'failed', reason: `自定义结构相似度 ${best.score.toFixed(3)} 低于阈值`, span: null, candidates: candidates.slice(0, 5) };
  }
  return {
    status: 'matched',
    reason: '',
    span: [best.start, best.end],
    center: best.center,
    score: best.score,
    type: 'custom',
    candidates: candidates.slice(0, 5),
  };
}

export function matchTarget(target, values, config = {}) {
  if (!target) return { status: 'failed', reason: '缺少目标', span: null };
  if (target.kind === 'region' || target.mode === 'region' || target.descriptor?.mode === 'region') {
    const span = Array.isArray(target.span) ? [...target.span] : null;
    return span ? { status: 'matched', reason: '', span, score: 1, type: 'region', candidates: [] }
      : { status: 'failed', reason: '区间目标缺少 span', span: null, candidates: [] };
  }
  if (target.kind === 'custom' || target.mode === 'custom' || target.descriptor?.type === 'custom') {
    return matchCustomStructure(target.descriptor ?? target, values);
  }
  if (target.kind === 'structure' || target.mode === 'structure') {
    return matchNamedStructure(target.descriptor, values, config);
  }
  return { status: 'failed', reason: `未知目标类型：${target.kind ?? target.mode ?? '?'}`, span: null, candidates: [] };
}

/* 解析步骤目标，并让同一目标下的步骤跟随前序平移。 */
export function resolveStepTargets(steps, baseValues, config = {}) {
  if (!steps.some((s) => s.target)) return { steps: steps.map((s) => ({ ...s })), resolutions: [] };
  const groups = new Map();
  const resolutions = [];
  const L = baseValues.length;
  const out = steps.map((step) => {
    if (!step.target) return { ...step };
    const key = step.target.id ?? step.target.label ?? step.target.kind ?? 'target';
    let group = groups.get(key);
    if (!group) {
      group = { match: matchTarget(step.target, baseValues, config), offset: 0 };
      groups.set(key, group);
    }
    const next = { ...step };
    const match = group.match;
    if (match.status !== 'matched' || !match.span) {
      next.targetStatus = { status: 'failed', reason: match.reason || '目标匹配失败', target: step.target, resolved: null };
      resolutions.push({ id: step.id, status: 'failed', reason: next.targetStatus.reason });
      return next;
    }
    const moved = [match.span[0] + group.offset, match.span[1] + group.offset];
    const span = [clamp(moved[0], 0, L - 1), clamp(moved[1], 0, L - 1)];
    if (span[1] - span[0] < 2) {
      next.targetStatus = { status: 'failed', reason: `目标平移后越界或过短（${moved[0]}-${moved[1]}）`, target: step.target, resolved: null };
      resolutions.push({ id: step.id, status: 'failed', reason: next.targetStatus.reason });
      return next;
    }
    if (TARGETABLE_KINDS.includes(step.kind)) next.span = span;
    next.targetStatus = {
      status: 'matched',
      reason: '',
      target: step.target,
      resolved: { span: [...span] },
      score: match.score == null ? null : +match.score.toFixed(4),
      matchedType: match.type,
    };
    resolutions.push({ id: step.id, status: 'matched', resolved: { span: [...span] } });
    if (step.enabled !== false && step.kind === 'shift') {
      group.offset += Number(step.delta) || 0;
    }
    return next;
  });
  return { steps: out, resolutions };
}

export function targetTagsOf(steps) {
  const out = [];
  for (const step of steps ?? []) {
    const st = step.targetStatus;
    if (!st) continue;
    const label = step.target?.label ?? '目标';
    if (st.status === 'matched') {
      out.push({ opId: step.id, kind: 'target', label: '目标', parts: [label, `区间 ${st.resolved?.span?.[0]}-${st.resolved?.span?.[1]}`] });
    } else {
      out.push({ opId: step.id, kind: 'target', label: '目标失败', parts: [st.reason || '匹配失败'] });
    }
  }
  return out;
}
