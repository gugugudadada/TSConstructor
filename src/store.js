/* 全局状态（Demo · 第一阶段）
   ── 一帧两列：左副列 = 探索与定位（目标类别构建 + 跨类参考素材 + 结构面 + 样本列表），
      右主列 = 编辑与生成（直接编辑 + 方法/图层 → 配方 → 泛化控制 → 候选）。
   ── 三项契约（承 v4）：① 目标类别 = 任务 scope，切换显式、可追；② 投影基底按会话冻结；
      ③ 一切读数走登记口径（本 demo：粗糙度 / 尾部电平差 / 几何结构计数）。
   ── 核心对象：配方（store.steps）——直接编辑与组件都编译成结构化操作步；生成 = 按泛化轴实例化配方。 */

import { reactive, computed } from 'vue';
import { buildDataset } from './data/loader.js';
import { DATASETS } from './data/datasets.js';
import { pca2D } from './engine/pca.js';
import { makeKnnTransform } from './engine/embed.js';
import { yRangeOf, fmtNum } from './engine/metrics.js';
import { mulberry32 } from './engine/ops.js';
import {
  COMPONENTS, componentByKey, runRecipe, instantiateSteps, injectResidual, euclid,
  basicStats, roughnessOf, tailDropOf, RECIPE_SPEC_VERSION, VARIATION_SPEC_VERSION,
  defaultVary, stepLabel, medianOf,
} from './engine/recipe.js';

export const store = reactive({
  // ── 数据 ──
  dataset: null,
  datasetId: null,
  datasetName: null,
  datasetHint: null,
  loadError: null,
  length: 152,
  yRange: { min: -1, max: 1 },
  basis: null,
  basisMethod: 'pca',
  basisComputing: null,

  // ── 目标类别（任务 scope） ──
  target: null,            // null = 未设定；{ mode:'new'|'missing', key, name, desc }
  targetVersion: 0,

  // ── 探索（副列） ──
  currentId: null,         // 当前查看的样本
  hoverId: null,
  checked: [],             // 列表中勾选的样本 id（待加入素材）
  listClass: null,         // 列表的类别过滤（null=全部可用类别）
  listSort: { key: null, dir: null },
  multiClassView: true,

  // ── 参考素材（副列 → 主列） ──
  refs: [],                // [{id, sampleId, roles:['base'|'segment'|'texture'], seg:[i0,i1]|null}]

  // ── P1 结构视图（单源配置；检测本身复用 engine/structures.js） ──
  structureConfig: { sensitivity: 'normal' },
  structureView: {
    show: false,
    types: { plateau: true, peak: true, valley: true, ramp: true },
    selectedId: null,
  },

  // ── 配方（主列） ──
  steps: [],               // 结构化操作步（配方）
  selectedStepId: null,
  regions: [],             // 多选区（canonical）
  selectedRegionId: null,
  tool: 'select',
  brushWidth: 8,
  previewOp: null,         // 拖拽中的瞬态操作（不进配方）
  recipeVersion: 0,
  undoVersion: 0,         // 供 UI 感知撤销栈长度变化（栈本身不是响应式）

  // ── 泛化控制 ──
  axes: { source: true, segment: true, param: 0.20, anchor: 4, width: 0.15, residual: 0.10 },

  // ── 生成 ──
  count: 24,
  seed: 42,
  candidates: [],
  batches: [],             // 本会话所有生成批次（含候选；用于“导出全部批次”）
  lastBatch: null,
  selectedCandidateId: null,

  // ── 记录 / 瞬态 ──
  records: [],
  toast: '',
});

/* ═══════════ 非响应式缓存（避免大数组进 Vue 代理热路径） ═══════════ */
let sampleIndex = new Map();      // id → index
let rawValues = new Map();        // id → number[]（原始、非代理）
let statsCache = new Map();       // id → {roughness,tailDrop,...}
let classCentroidCache = new Map();
let refSeq = 0;
let stepSeq = 0;
let regionSeq = 0;
let batchSeq = 0;

let toastTimer = null;
export function toast(msg, ms = 2200) {
  store.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { store.toast = ''; }, ms);
}

let recSeq = 0;
export function rec(action, detail) {
  store.records.push({ seq: ++recSeq, t: new Date().toISOString().slice(11, 19), action, detail });
  return store.records[store.records.length - 1];
}

export function valuesOf(id) { return rawValues.get(id) ?? null; }
export function sampleOf(id) { const i = sampleIndex.get(id); return i == null ? null : store.dataset.samples[i]; }
export function indexOf(id) { return sampleIndex.get(id); }
export function projOf(id) {
  const i = sampleIndex.get(id);
  return i == null ? null : store.basis?.proj?.[i] ?? null;
}
export function classLabelOf(key) {
  const c = store.dataset?.classes.find((x) => x.key === key);
  return c ? c.label : String(key);
}

/* ═══════════ 数据集 / 基底 ═══════════ */

let basisCache = new Map();

export async function init(datasetId = DATASETS[0].id) {
  try {
    const meta = DATASETS.find((d) => d.id === datasetId) ?? DATASETS[0];
    const res = await fetch(meta.file);
    if (!res.ok) throw new Error(`数据加载失败 HTTP ${res.status}（${meta.file}）`);
    const text = await res.text();
    const ds = buildDataset(text, meta.name);
    store.dataset = ds;
    store.datasetId = meta.id;
    store.datasetName = meta.name;
    store.datasetHint = meta.taskHint ?? '';
    store.length = ds.length;
    sampleIndex = new Map(ds.samples.map((s, i) => [s.id, i]));
    rawValues = new Map(ds.samples.map((s) => [s.id, s.values]));
    statsCache = new Map();
    classCentroidCache = new Map();
    store.yRange = yRangeOf(ds.samples);
    const b0 = pca2D(ds.samples);
    b0.transform = b0.project;
    store.basis = b0;
    store.basisMethod = 'pca';
    basisCache = new Map([['pca', b0]]);
    rec('session-init', `${ds.samples.length} 条 · ${ds.classes.length} 类 · ${meta.name} · 基底冻结（PCA 2D）`);
    // 首开不预设目标类别（D1：目标模式由人声明）——素材架 / 画布 / 配方默认全空。
    // 登记表的 defaultClass 仅作为「缺类重建」弹窗的默认选中项（见 TargetPanel）。
    if (meta.defaultBasis && meta.defaultBasis !== 'pca') setBasisMethod(meta.defaultBasis);
  } catch (e) {
    store.loadError = String(e);
  }
}

function applyBasis(basis, method) {
  store.basis = basis;
  store.basisMethod = method;
}
export function setBasisMethod(m) {
  if (!store.dataset || store.basisComputing || m === store.basisMethod) return;
  if (basisCache.has(m)) { applyBasis(basisCache.get(m), m); rec('basis', `投影 → ${m}（缓存）`); return; }
  if (m === 'pca') {
    const b = pca2D(store.dataset.samples);
    b.transform = b.project;
    basisCache.set('pca', b);
    applyBasis(b, 'pca');
    return;
  }
  const L = store.dataset.length;
  const n = store.dataset.samples.length;
  const values = new Float32Array(n * L);
  store.dataset.samples.forEach((s, i) => values.set(s.values, i * L));
  store.basisComputing = { method: m, pct: 0 };
  const worker = new Worker(new URL('./workers/embed.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'progress') { if (store.basisComputing) store.basisComputing = { method: m, pct: d.pct }; return; }
    worker.terminate();
    store.basisComputing = null;
    if (d.type === 'done') {
      const basis = { proj: d.proj, method: m, transform: makeKnnTransform(store.dataset.samples, d.proj, 10, d.pca ?? null), summary: d.summary };
      basisCache.set(m, basis);
      applyBasis(basis, m);
      rec('basis', `投影 → ${m}（n=${d.summary?.n ?? n}）`);
    } else toast(`投影计算失败：${d.message ?? '未知错误'}`);
  };
  worker.onerror = (err) => { if (store.basisComputing) { store.basisComputing = null; worker.terminate(); toast(`投影计算失败：${err.message ?? 'Worker 错误'}`); } };
  worker.postMessage({ method: m, values, n, L, seed: 42 });
}

/* ═══════════ 目标类别（新建 / 缺类重建） ═══════════ */

export function isHiddenSample(s) {
  return !!s && !!store.target && store.target.mode === 'missing' && s.class === store.target.key;
}
export function materialClasses() {
  if (!store.dataset) return [];
  if (!store.target || store.target.mode !== 'missing') return store.dataset.classes;
  return store.dataset.classes.filter((c) => c.key !== store.target.key);
}
export function materialSamples() {
  if (!store.dataset) return [];
  return store.dataset.samples.filter((s) => !isHiddenSample(s));
}

export function setTargetMissing(classKey) {
  const label = classLabelOf(classKey);
  store.target = {
    mode: 'missing',
    key: classKey,
    name: `缺失类 · ${label}`,
    desc: `已知目标类别语义，但其 TRAIN 样本（${label}）在构造阶段从素材中隐藏。`,
  };
  onTargetChanged();
  rec('target', `目标类别 → 缺失类重建（${label}）；该类样本已从素材中隐藏`);
}

export function setTargetNew({ name, desc } = {}) {
  store.target = {
    mode: 'new',
    key: 'NEW',
    name: name || '新类别',
    desc: desc || '用户新建的目标类别：所有旧类别都可作为参考素材。',
  };
  onTargetChanged();
  rec('target', `目标类别 → 新建（${store.target.name}）`);
}

function onTargetChanged() {
  store.targetVersion += 1;
  store.refs = [];
  store.checked = [];
  store.steps = [];
  store.regions = [];
  store.selectedRegionId = null;
  store.selectedStepId = null;
  store.candidates = [];
  store.batches = [];
  store.lastBatch = null;
  store.selectedCandidateId = null;
  store.recipeVersion = 0;
  store.currentId = null;
  store.listClass = null;
  store.previewOp = null;
  store.structureView.selectedId = null;
  /* 目标切换 = 重建容器：旧容器的撤销栈不能把旧配方/选区带回来。 */
  undoStack.length = 0;
  store.undoVersion += 1;
}

/* ═══════════ 结构面 / 列表 ═══════════ */

export function sampleStats(id) {
  if (statsCache.has(id)) return statsCache.get(id);
  const v = valuesOf(id);
  const st = v ? basicStats(v) : null;
  const r = st ? { ...st, roughness: roughnessOf(v), tailDrop: tailDropOf(v) } : null;
  statsCache.set(id, r);
  return r;
}

export function listRows() {
  if (!store.dataset) return [];
  let rows = materialSamples();
  if (store.listClass) rows = rows.filter((s) => s.class === store.listClass);
  const { key, dir } = store.listSort;
  if (key && dir) {
    const mul = dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => mul * ((sampleStats(a.id)?.[key] ?? 0) - (sampleStats(b.id)?.[key] ?? 0)));
  } else {
    rows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  }
  return rows;
}
export function setListClass(key) { store.listClass = store.listClass === key ? null : key; }
export function setListSort(key, dir) {
  if (store.listSort.key === key && store.listSort.dir === dir) store.listSort = { key: null, dir: null };
  else store.listSort = { key, dir };
}
export function setCurrent(id) { store.currentId = id; }
export function toggleChecked(id) {
  const i = store.checked.indexOf(id);
  if (i < 0) store.checked.push(id); else store.checked.splice(i, 1);
}
export function clearChecked() { store.checked = []; }
export function commitCheckedToRack(roles) {
  if (!store.checked.length) return 0;
  const ids = [...store.checked];
  clearChecked();
  let k = 0;
  for (const id of ids) { if (addRef(id, roles)) k += 1; }
  rec('refs', `加入素材 ×${k}（角色：${roleText(roles)}）`);
  return k;
}

/* 代表性样本（供示例布景与"代表性"提示）：类内到原始质心最近者 */
export function representativeOf(classKey) {
  const cls = store.dataset.samples.filter((s) => s.class === classKey && !isHiddenSample(s));
  if (!cls.length) return null;
  if (!classCentroidCache.has(classKey)) {
    const L = cls[0].values.length;
    const c = new Array(L).fill(0);
    for (const s of cls) for (let i = 0; i < L; i++) c[i] += s.values[i];
    for (let i = 0; i < L; i++) c[i] /= cls.length;
    classCentroidCache.set(classKey, c);
  }
  const c = classCentroidCache.get(classKey);
  let best = cls[0], bd = Infinity;
  for (const s of cls) { const d = euclid(s.values, c); if (d < bd) { bd = d; best = s; } }
  return best;
}
export function extremeOf(classKey, fn, mode = 'max') {
  const cls = store.dataset.samples.filter((s) => s.class === classKey && !isHiddenSample(s));
  if (!cls.length) return null;
  return cls.reduce((best, s) => (mode === 'max' ? (fn(s) > fn(best) ? s : best) : (fn(s) < fn(best) ? s : best)));
}

/* ═══════════ 参考素材（基源 / 片段 / 纹理） ═══════════ */

function roleText(roles) {
  return roles.map((r) => ({ base: '基源', segment: '片段', texture: '纹理' }[r])).join('＋');
}
export function refsOf(sampleId) { return store.refs.find((r) => r.sampleId === sampleId) ?? null; }
export function addRef(sampleId, roles = ['segment']) {
  const sample = sampleId ? sampleOf(sampleId) : null;
  if (!sample || isHiddenSample(sample)) return false;
  const ex = refsOf(sampleId);
  const rs = (roles && roles.length ? roles : ['segment']);
  if (ex) {
    for (const r of rs) if (!ex.roles.includes(r)) ex.roles.push(r);
    if (ex.roles.length) rec('refs', `${sampleId} 角色 → ${roleText(ex.roles)}`);
    return true;
  }
  const L = store.length;
  store.refs.push({
    id: `r${++refSeq}`,
    sampleId,
    roles: [...rs],
    seg: [Math.floor(L * 0.4), Math.floor(L * 0.72)],
  });
  rec('refs', `加入素材 ${sampleId}（${roleText(rs)}）`);
  return true;
}
export function removeRef(refId) {
  const i = store.refs.findIndex((r) => r.id === refId);
  if (i < 0) return;
  rec('refs', `移出素材 ${store.refs[i].sampleId}`);
  store.refs.splice(i, 1);
}
export function setRefRoles(refId, roles) {
  const r = store.refs.find((x) => x.id === refId);
  if (!r) return;
  if (!roles.length) { removeRef(refId); return; }
  r.roles = [...new Set(roles)];
  rec('refs', `${r.sampleId} 角色 → ${roleText(r.roles)}`);
}
export function toggleRefRole(refId, role) {
  const r = store.refs.find((x) => x.id === refId);
  if (!r) return;
  if (r.roles.includes(role)) setRefRoles(refId, r.roles.filter((x) => x !== role));
  else setRefRoles(refId, [...r.roles, role]);
}
export function setRefSeg(refId, seg) {
  const r = store.refs.find((x) => x.id === refId);
  if (!r || !seg) return;
  const lim = Math.max(0, store.length - 1);
  const a = Math.max(0, Math.min(lim, Math.min(seg[0], seg[1])));
  const b = Math.max(0, Math.min(lim, Math.max(seg[0], seg[1])));
  r.seg = [Math.round(a), Math.round(b)];
}
export function clearRefs() { store.refs = []; rec('refs', '清空素材'); }
export function baseRefs() { return store.refs.filter((r) => r.roles.includes('base')); }
export function segmentRefs() { return store.refs.filter((r) => r.roles.includes('segment')); }
export function textureRefs() { return store.refs.filter((r) => r.roles.includes('texture')); }
export function primaryBaseId() { return baseRefs()[0]?.sampleId ?? null; }
export function refClassSummary() {
  const m = new Map();
  for (const r of store.refs) {
    const c = sampleOf(r.sampleId)?.class ?? '?';
    if (!m.has(c)) m.set(c, 0);
    m.set(c, m.get(c) + 1);
  }
  return [...m.entries()].map(([key, n]) => ({ key, label: classLabelOf(key), n }));
}

/* ═══════════ 选区 ═══════════ */

/* 选区 / 操作区间统一夹到当前数据集并排序。 */
function normSpan(span) {
  if (!span) return null;
  const lim = Math.max(0, store.length - 1);
  const a = Math.max(0, Math.min(lim, Math.round(Math.min(span[0], span[1]))));
  const b = Math.max(0, Math.min(lim, Math.round(Math.max(span[0], span[1]))));
  return [a, b];
}
export function addRegion(span) {
  const sp = normSpan(span);
  if (!sp) return false;
  const [a, b] = sp;
  if (b - a < 2) return false;
  pushUndo('新增选区');
  const id = ++regionSeq;
  store.regions.push({ id, span: [a, b] });
  store.selectedRegionId = id;
  rec('region', `新增选区 R${id} [${a}, ${b}]`);
  return true;
}
export function selectRegion(id) { store.selectedRegionId = id; }
export function regionNameOfSpan(span) {
  if (!Array.isArray(span)) return null;
  const sp = normSpan(span);
  if (!sp) return null;
  const r = store.regions.find((x) => x.span[0] === sp[0] && x.span[1] === sp[1]);
  return r ? `R${r.id}` : null;
}
export function removeRegion(id) {
  const i = store.regions.findIndex((r) => r.id === id);
  if (i < 0) return;
  pushUndo('删除选区');
  store.regions.splice(i, 1);
  if (store.selectedRegionId === id) store.selectedRegionId = store.regions[store.regions.length - 1]?.id ?? null;
  rec('region', `删除选区 R${id}`);
}
export function clearRegions() { store.regions = []; store.selectedRegionId = null; }
export function activeRegion() { return store.regions.find((r) => r.id === store.selectedRegionId) ?? null; }

/* ═══════════ 配方：操作步 ═══════════ */

const undoStack = [];
export function pushUndo(label) {
  undoStack.push({
    label,
    steps: JSON.parse(JSON.stringify(store.steps)),
    regions: JSON.parse(JSON.stringify(store.regions)),
    selectedRegionId: store.selectedRegionId,
    recipeVersion: store.recipeVersion,
  });
  if (undoStack.length > 80) undoStack.shift();
  store.undoVersion += 1;
}
export function undo() {
  const e = undoStack.pop();
  if (!e) { toast('没有可撤销的操作'); return; }
  store.steps = e.steps;
  store.regions = e.regions;
  store.selectedRegionId = e.selectedRegionId;
  store.recipeVersion = e.recipeVersion;
  store.previewOp = null;
  store.undoVersion += 1;
  rec('undo', `撤销：${e.label}`);
}
export function undoDepth() { void store.undoVersion; return undoStack.length; }

export function newStepId() { return `st${++stepSeq}`; }

export function addComponent(key) {
  const def = componentByKey(key);
  if (!def) return;
  const L = store.length;
  const reg = activeRegion();
  const span = reg ? normSpan(reg.span) : [0, L - 1];
  const width = reg ? Math.max(3, span[1] - span[0]) : (def.params.find((p) => p.key === 'width')?.def ?? 8);
  const params = {};
  for (const p of def.params) {
    if (p.key === 'width') params.width = width;
    else params[p.key] = p.def;
  }
  /* 只有真正能落进配方时才压撤销栈——失败操作不应留下空撤销。 */
  pushUndo(`加入组件 ${def.name}`);
  const step = {
    id: newStepId(), kind: 'component', component: key, enabled: true,
    span, mix: 'add', weight: 1, ...params,
    vary: defaultVary('component'),
  };
  store.steps.push(step);
  store.selectedStepId = step.id;
  bumpRecipe();
  rec('recipe', `组件 ${def.name} → 配方（区间 ${span[0]}–${span[1]}）`);
}

export function addDeform({ anchor, width, amp }) {
  pushUndo('点拖拽');
  const step = { id: newStepId(), kind: 'deform', enabled: true, anchor, width: width ?? store.brushWidth, amp, vary: defaultVary('deform') };
  store.steps.push(step);
  store.selectedStepId = step.id;
  bumpRecipe();
  rec('recipe', `点拖拽 → 配方（t=${Math.round(anchor)}，Δ=${amp.toFixed(3)}，宽 ${Math.round(width ?? store.brushWidth)}）`);
}

export function addWarp({ span, factor = 1, delta = 0 }) {
  const sp = normSpan(span);
  if (!sp || sp[1] - sp[0] < 2) return;
  pushUndo('时间形变');
  const step = { id: newStepId(), kind: 'warp', enabled: true, span: sp, factor, delta, vary: defaultVary('warp') };
  store.steps.push(step);
  store.selectedStepId = step.id;
  bumpRecipe();
  rec('recipe', `时间形变 → 配方（${sp[0]}–${sp[1]}，f=${factor.toFixed(3)}，δ=${delta}）`);
}

export function addTransplant({ source, srcSpan, dstSpan, alpha = 1, seam = 6 }) {
  if (!source) { toast('克隆需要一个「片段」参考素材'); return; }
  const src = normSpan(srcSpan);
  if (!src || src[1] - src[0] < 2) { toast('克隆源段过短（至少 3 点）'); return; }
  const dst = dstSpan ? normSpan(dstSpan) : null;
  if (dstSpan && (!dst || dst[1] - dst[0] < 2)) { toast('克隆落点区间过短（至少 3 点）'); return; }
  pushUndo('克隆');
  const step = {
    id: newStepId(), kind: 'transplant', enabled: true,
    source, srcSpan: src, dstSpan: dst,
    dstStart: dst ? null : Math.round(store.length * 0.5),
    alpha, seam, vary: defaultVary('transplant'),
  };
  store.steps.push(step);
  store.selectedStepId = step.id;
  bumpRecipe();
  rec('recipe', `克隆 → 配方（${source} [${src[0]},${src[1]}] → ${dst ? `[${dst[0]},${dst[1]}]` : '落点' + step.dstStart}）`);
}

/* 克隆入口：源只能来自副列的「片段」列表；落点优先当前选区。 */
export function addClone({ source, srcSpan, dstSpan } = {}) {
  const pool = segmentRefs();
  if (!pool.length) { toast('克隆需要先在副列素材架选定「片段」素材'); return; }
  const ref = pool.find((r) => r.sampleId === source) ?? pool[0];
  const src = normSpan(srcSpan ?? ref.seg);
  if (!src || src[1] - src[0] < 2) { toast('克隆源段至少需要 3 点'); return; }
  const dst = dstSpan ? normSpan(dstSpan) : (activeRegion()?.span ?? null);
  addTransplant({ source: ref.sampleId, srcSpan: src, dstSpan: dst, alpha: 1, seam: 6 });
}

export function addTexture({ source, amount = 0.2, win = 9 } = {}) {
  const pool = textureRefs();
  if (!pool.length) { toast('纹理需要先在副列素材架选定「纹理」素材'); return; }
  const ref = pool.find((r) => r.sampleId === source) ?? pool[0];
  const amountNum = Number(amount);
  const amt = Math.max(0, Math.min(1.5, Number.isFinite(amountNum) ? amountNum : 0.2));
  const w = Math.max(3, Math.min(31, Math.round(Number(win) || 9)));
  pushUndo('纹理');
  const step = {
    id: newStepId(), kind: 'texture', enabled: true,
    source: ref.sampleId, amount: amt, win: w,
    vary: defaultVary('texture'),
  };
  store.steps.push(step);
  store.selectedStepId = step.id;
  bumpRecipe();
  rec('recipe', `纹理 → 配方（${ref.sampleId}，${amt.toFixed(2)}σ）`);
}

export function addErase({ span }) {
  const sp = normSpan(span);
  if (!sp || sp[1] - sp[0] < 2) { toast('区间擦除需要至少 3 点的选区'); return; }
  pushUndo('区间擦除');
  const step = { id: newStepId(), kind: 'erase', enabled: true, span: sp, vary: defaultVary('erase') };
  store.steps.push(step);
  store.selectedStepId = step.id;
  bumpRecipe();
  rec('recipe', `区间擦除 → 配方（${sp[0]}–${sp[1]}，两端点平滑连接）`);
}

export function addScale({ span, factor = 1.2, feather = 8 }) {
  const sp = normSpan(span);
  if (!sp || sp[1] - sp[0] < 2) { toast('缩放需要至少 3 点的选区'); return; }
  const f = Math.max(0.5, Math.min(2, Number(factor) || 1));
  const ft = Math.max(1, Math.min(20, Math.round(Number(feather) || 8)));
  pushUndo('缩放');
  const step = { id: newStepId(), kind: 'scale', enabled: true, span: sp, factor: f, feather: ft, vary: defaultVary('scale') };
  store.steps.push(step);
  store.selectedStepId = step.id;
  bumpRecipe();
  rec('recipe', `缩放 → 配方（${sp[0]}–${sp[1]}，×${f.toFixed(2)}）`);
}

export function addShift({ span, delta = 4, feather = 8 }) {
  const sp = normSpan(span);
  if (!sp || sp[1] - sp[0] < 2) { toast('水平平移需要至少 3 点的选区'); return; }
  const n = sp[1] - sp[0] + 1;
  const d = Math.round(Math.max(-(n - 1), Math.min(n - 1, Number(delta) || 0)));
  const ft = Math.max(1, Math.min(20, Math.round(Number(feather) || 8)));
  pushUndo('水平平移');
  const step = { id: newStepId(), kind: 'shift', enabled: true, span: sp, delta: d, feather: ft, vary: defaultVary('shift') };
  store.steps.push(step);
  store.selectedStepId = step.id;
  bumpRecipe();
  rec('recipe', `水平平移 → 配方（${sp[0]}–${sp[1]}，${d >= 0 ? '+' : ''}${d} 点）`);
}

export function updateStep(id, patch) {
  const s = store.steps.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  bumpRecipe();
}
export function setStepVary(id, part, on) {
  const s = store.steps.find((x) => x.id === id);
  if (!s) return;
  s.vary = { ...(s.vary ?? defaultVary(s.kind)), [part]: on };
  bumpRecipe();
}

export function removeStep(id) {
  const i = store.steps.findIndex((x) => x.id === id);
  if (i < 0) return;
  pushUndo(`移出 ${stepLabel(store.steps[i])}`);
  const [s] = store.steps.splice(i, 1);
  if (store.selectedStepId === id) store.selectedStepId = null;
  bumpRecipe();
  rec('recipe', `移出操作步：${stepLabel(s)}`);
}
export function toggleStepEnabled(id) {
  const s = store.steps.find((x) => x.id === id);
  if (!s) return;
  s.enabled = !s.enabled;
  bumpRecipe();
}
export function moveStep(id, dir) {
  const i = store.steps.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= store.steps.length) return;
  pushUndo('调整执行顺序');
  const [s] = store.steps.splice(i, 1);
  store.steps.splice(j, 0, s);
  bumpRecipe();
}
export function duplicateStep(id) {
  const s = store.steps.find((x) => x.id === id);
  if (!s) return;
  pushUndo('复制操作步');
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = newStepId();
  const i = store.steps.findIndex((x) => x.id === id);
  store.steps.splice(i + 1, 0, copy);
  store.selectedStepId = copy.id;
  bumpRecipe();
}
export function clearSteps() {
  if (!store.steps.length) return;
  pushUndo('清空配方');
  store.steps = [];
  store.selectedStepId = null;
  bumpRecipe();
  rec('recipe', '清空配方');
}
export function selectStep(id) { store.selectedStepId = id; }
function bumpRecipe() {
  store.recipeVersion += 1;
}

export function setPreview(op) { store.previewOp = op; }
export function clearPreview() { store.previewOp = null; }
export function commitPreview(op) {
  store.previewOp = null;
  if (!op) return null;
  if (op.kind === 'deform') {
    if (!op.amp) return null;
    addDeform({ anchor: op.anchor, width: op.width, amp: op.amp });
    return 'deform';
  }
  /* 时间形变没有 amp 字段——原实现用 !op.amp 一刀切，导致形变预览永远提交不了。 */
  if (op.kind === 'warp') { addWarp({ span: op.span, factor: op.factor, delta: op.delta }); return 'warp'; }
  return null;
}

/* ═══════════ 配方执行（工作模板） ═══════════ */

export function activeSteps() {
  const list = store.steps.slice();
  if (store.previewOp) list.push({ ...store.previewOp, id: '__preview', enabled: true });
  return list;
}
export const workRun = computed(() => {
  const baseId = primaryBaseId();
  const base = baseId ? valuesOf(baseId) : null;
  if (!base || !store.dataset) return { values: [], stages: [], contribs: [], stdBase: 1, empty: true };
  return runRecipe(base, activeSteps(), { sampleValues: valuesOf, noiseSeed: store.seed + 7 });
});
export const templateValues = computed(() => workRun.value.values);

/* ═══════════ 生成 ═══════════ */

export function variationGate() {
  if (!store.dataset) return { ok: false, msg: '数据未载入' };
  if (!primaryBaseId()) return { ok: false, msg: '先在副列素材架里指定至少一个「基源」参考样本' };
  if (!store.steps.length) return { ok: false, msg: '配方为空——先在主列做一次编辑（组件或直接编辑）' };
  if (!store.steps.some((s) => s.enabled !== false)) return { ok: false, msg: '配方里的操作步全部停用——至少启用一步再生成' };
  return { ok: true, msg: '' };
}

export function generateCandidates() {
  const gate = variationGate();
  if (!gate.ok) return { ok: false, msg: gate.msg };
  const L = store.length;
  const bPool = baseRefs().map((r) => r.sampleId);
  const sPool = segmentRefs().map((r) => r.sampleId);
  const tPool = (textureRefs().length ? textureRefs() : segmentRefs()).map((r) => r.sampleId);
  if (!tPool.length) tPool.push(...bPool);
  const axes = { ...store.axes };
  const basePool = axes.source && bPool.length > 1 ? bPool : [bPool[0]];
  const count = Math.max(1, Math.min(100, Math.round(Number(store.count) || 1)));
  if (store.count !== count) store.count = count;
  const seed = Number(store.seed) >>> 0;
  if (store.seed !== seed) store.seed = seed;
  const batchId = ++batchSeq;
  const out = [];
  for (let k = 0; k < count; k++) {
    const candSeed = (seed + 1013904223 * (k + 1)) >>> 0;
    const crng = mulberry32(candSeed);
    const baseId = basePool[Math.floor(crng() * basePool.length)];
    const baseVals = valuesOf(baseId);
    const noiseSeed = Math.floor(crng() * 2 ** 31);
    const inst = instantiateSteps(store.steps, {
      rng: crng, L, axes, baseId, basePool, segmentPool: sPool.length ? sPool : basePool, texturePool: tPool, sampleValues: valuesOf, noiseSeed,
    });
    const run = runRecipe(baseVals, inst.steps, { sampleValues: valuesOf, noiseSeed });
    let vals = run.values;
    const tags = [...inst.tags];
    if (axes.residual > 0) {
      const donorId = tPool[Math.floor(crng() * tPool.length)] ?? baseId;
      const amt = axes.residual * (0.6 + crng() * 0.8);
      vals = injectResidual(vals, valuesOf(donorId), amt);
      tags.push({ opId: '__residual', kind: 'global', label: '残差注入', parts: [`${amt.toFixed(2)}σ`], donorId });
    }
    out.push({
      id: `c${batchId}-${out.length + 1}`,
      batchId,
      baseId,
      baseClass: sampleOf(baseId)?.class ?? null,
      label: store.target?.key ?? 'target',
      values: vals.map((v) => +v.toFixed(4)),
      seed: candSeed,
      noiseSeed,
      steps: inst.steps,
      tags,
      recipeVersion: store.recipeVersion,
      spec: RECIPE_SPEC_VERSION,
    });
  }
  store.candidates = out;
  store.selectedCandidateId = out[0]?.id ?? null;
  store.lastBatch = {
    id: batchId, seed: store.seed, count: store.count, generated: out.length,
    axes, spec: RECIPE_SPEC_VERSION, variationSpec: VARIATION_SPEC_VERSION, at: new Date().toISOString(),
    axisCounts: axisCounts(out),
  };
  store.batches.push({ ...store.lastBatch, candidates: out });
  rec('generate', `批次 #${batchId}：${out.length} 条候选（seed ${store.seed}）`);
  return { ok: true, n: out.length };
}

function axisCounts(cands) {
  const c = { baseSwap: 0, segSwap: 0, param: 0, anchor: 0, width: 0, residual: 0 };
  const baseUsed = new Set();
  for (const cand of cands) {
    baseUsed.add(cand.baseId);
    if (cand.tags.some((t) => t.parts?.includes('源换'))) c.segSwap += 1;
    /* 强 = 幅值/混合系数扰动；f / 宽 / 周 = 宽度（时间）轴。 */
    if (cand.tags.some((t) => t.parts?.some((p) => p.startsWith('强')))) c.param += 1;
    if (cand.tags.some((t) => t.parts?.some((p) => p.startsWith('位') || p.startsWith('δ')))) c.anchor += 1;
    if (cand.tags.some((t) => t.parts?.some((p) => p.startsWith('宽') || p.startsWith('周') || p.startsWith('f')))) c.width += 1;
    if (cand.tags.some((t) => t.label === '残差注入')) c.residual += 1;
  }
  c.baseSwap = baseUsed.size > 1 ? cands.length : 0;
  return c;
}

/* 随机增强基线（idea §9 对照 2）：属第二阶段「评估/检查」，本阶段不涉及 */

export function selectedCandidate() {
  return store.candidates.find((c) => c.id === store.selectedCandidateId) ?? null;
}
export function selectCandidate(id) { store.selectedCandidateId = id; }

/* ═══════════ 导出 ═══════════ */

export function exportCandidates() {
  const ty = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const payload = {
    exportSpec: 'tsc2-candidates-v1.0.0',
    exportedAt: new Date().toISOString(),
    dataset: { id: store.datasetId, name: store.datasetName, length: store.length, classes: store.dataset.classes.map((c) => ({ key: c.key, label: c.label, count: c.count })) },
    target: { ...store.target, version: store.targetVersion },
    recipe: {
      version: store.recipeVersion,
      spec: RECIPE_SPEC_VERSION,
      steps: JSON.parse(JSON.stringify(store.steps)),
      baseIds: baseRefs().map((r) => r.sampleId),
      segmentIds: segmentRefs().map((r) => r.sampleId),
      textureIds: textureRefs().map((r) => r.sampleId),
    },
    axes: { ...store.axes },
    variationSpec: VARIATION_SPEC_VERSION,
    batch: store.lastBatch,
    candidates: store.candidates.map((c) => ({
      id: c.id, baseId: c.baseId, seed: c.seed, noiseSeed: c.noiseSeed,
      values: c.values, tags: c.tags,
      steps: c.steps,
    })),
  };
  downloadJson(`tsc2-candidates-${store.target?.mode ?? 'task'}-${ty}.json`, payload);
  rec('export', `导出候选 ${store.candidates.length} 条（含配方与差异签名）`);
}

export function exportAllBatches() {
  const batches = store.batches.length
    ? store.batches
    : (store.candidates.length ? [{ ...(store.lastBatch ?? {}), candidates: store.candidates }] : []);
  if (!batches.length) { toast('还没有候选可导出'); return; }
  const all = [];
  for (const b of batches) for (const c of b.candidates ?? []) all.push(c);
  if (!all.length) { toast('还没有候选可导出'); return; }
  const ty = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const payload = {
    exportSpec: 'tsc2-candidates-all-v1.0.0',
    exportedAt: new Date().toISOString(),
    dataset: {
      id: store.datasetId, name: store.datasetName, length: store.length,
      classes: store.dataset.classes.map((c) => ({ key: c.key, label: c.label, count: c.count })),
    },
    target: { ...store.target, version: store.targetVersion },
    axes: { ...store.axes },
    variationSpec: VARIATION_SPEC_VERSION,
    counts: { batches: batches.length, candidates: all.length },
    batches: batches.map(({ candidates, ...meta }) => meta),
    candidates: all.map((c) => ({
      id: c.id, batchId: c.batchId, baseId: c.baseId, baseClass: c.baseClass ?? null,
      label: c.label ?? store.target?.key ?? 'target',
      values: c.values, seed: c.seed, noiseSeed: c.noiseSeed,
      steps: c.steps, tags: c.tags,
      recipeVersion: c.recipeVersion, spec: c.spec,
    })),
  };
  downloadJson(`tsc2-candidates-all-${store.target?.mode ?? 'task'}-${ty}.json`, payload);
  rec('export', `导出全部批次 ${all.length} 条（${batches.length} 批）`);
  toast(`已导出全部批次：${batches.length} 批 / ${all.length} 条候选`);
}

export function exportRecipe() {
  const payload = {
    exportSpec: 'tsc2-recipe-v1.0.0',
    exportedAt: new Date().toISOString(),
    dataset: { id: store.datasetId, name: store.datasetName },
    target: { ...store.target, version: store.targetVersion },
    recipe: { version: store.recipeVersion, spec: RECIPE_SPEC_VERSION, steps: JSON.parse(JSON.stringify(store.steps)) },
    axes: { ...store.axes },
    inventory: {
      baseIds: baseRefs().map((r) => r.sampleId),
      segmentIds: segmentRefs().map((r) => r.sampleId),
      textureIds: textureRefs().map((r) => r.sampleId),
      byClass: refClassSummary(),
    },
  };
  downloadJson(`tsc2-recipe-${store.recipeVersion}.json`, payload);
  rec('export', `导出配方 v${store.recipeVersion}`);
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ═══════════ 导入配方 ═══════════ */

const IMPORTABLE_KINDS = new Set(['component', 'deform', 'warp', 'erase', 'scale', 'shift', 'transplant', 'texture']);

function importVary(kind, raw) {
  const v = defaultVary(kind);
  if (raw && typeof raw === 'object') {
    for (const key of ['pos', 'width', 'amp', 'src']) {
      if (typeof raw[key] === 'boolean') v[key] = raw[key];
    }
  }
  return v;
}

function importNum(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* 源按“角色 + 序号”重绑：配方本身不依赖导出时那一批具体素材。
   当前没有对应角色素材时，保留 JSON 中的样本 id（同数据集仍可直接运行）。 */
function bindImportedSource(rawSource, role, ctx) {
  const invIds = role === 'segment' ? ctx.invSegment : ctx.invTexture;
  const current = role === 'segment' ? ctx.currentSegment : ctx.currentTexture;
  if (rawSource && invIds.includes(rawSource) && current.length) {
    const slot = Math.max(0, invIds.indexOf(rawSource));
    const id = current[slot] ?? current[0];
    return { id, rebound: id !== rawSource };
  }
  if (rawSource && ctx.allIds.has(rawSource)) return { id: rawSource, rebound: false };
  if (current.length) return { id: current[0], rebound: true };
  return { id: null, rebound: false };
}

function sanitizeImportedStep(raw, ctx) {
  if (!raw || typeof raw !== 'object' || !IMPORTABLE_KINDS.has(raw.kind)) return null;
  const kind = raw.kind;
  const s = {
    ...raw,
    id: newStepId(),
    kind,
    enabled: raw.enabled !== false,
    vary: importVary(kind, raw.vary),
  };

  if (kind === 'component') {
    const def = componentByKey(raw.component);
    if (!def) return null;
    s.component = raw.component;
    s.span = normSpan(raw.span) ?? [0, ctx.L - 1];
    s.mix = 'add';
    s.weight = 1;
    for (const p of def.params) {
      s[p.key] = importNum(raw[p.key], p.def, p.min, p.max);
    }
    return s;
  }

  if (kind === 'deform') {
    s.anchor = Math.round(importNum(raw.anchor, 0, 0, ctx.L - 1));
    s.width = importNum(raw.width, store.brushWidth, 1, Math.max(1, ctx.L / 2));
    s.amp = importNum(raw.amp, 0, -10, 10);
    return s;
  }

  if (kind === 'warp') {
    const span = normSpan(raw.span);
    if (!span || span[1] - span[0] < 2) return null;
    s.span = span;
    s.factor = importNum(raw.factor, 1, 0.5, 2);
    s.delta = Math.round(importNum(raw.delta, 0, -ctx.L, ctx.L));
    return s;
  }
  if (kind === 'erase') {
    const span = normSpan(raw.span);
    if (!span || span[1] - span[0] < 2) return null;
    s.span = span;
    delete s.mode;
    delete s.feather;
    return s;
  }
  if (kind === 'scale') {
    const span = normSpan(raw.span);
    if (!span || span[1] - span[0] < 2) return null;
    s.span = span;
    s.factor = importNum(raw.factor, 1, 0.5, 2);
    s.feather = Math.round(importNum(raw.feather, 8, 1, 20));
    return s;
  }
  if (kind === 'shift') {
    const span = normSpan(raw.span);
    if (!span || span[1] - span[0] < 2) return null;
    const n = span[1] - span[0] + 1;
    s.span = span;
    s.delta = Math.round(importNum(raw.delta, 4, -(n - 1), n - 1));
    s.feather = Math.round(importNum(raw.feather, 8, 1, 20));
    return s;
  }
  if (kind === 'transplant') {
    const src = normSpan(raw.srcSpan);
    if (!src || src[1] - src[0] < 2) return null;
    const dst = raw.dstSpan ? normSpan(raw.dstSpan) : null;
    if (raw.dstSpan && (!dst || dst[1] - dst[0] < 2)) return null;
    const bound = bindImportedSource(raw.source, 'segment', ctx);
    s.source = bound.id;
    if (bound.rebound) ctx.rebound += 1;
    if (!bound.id) { s.enabled = false; ctx.missingSources += 1; }
    s.srcSpan = src;
    s.dstSpan = dst;
    s.dstStart = dst ? null : Math.round(importNum(raw.dstStart, ctx.L / 2, 0, ctx.L - 1));
    s.alpha = importNum(raw.alpha, 1, 0, 1);
    s.seam = Math.round(importNum(raw.seam, 6, 1, 60));
    return s;
  }
  if (kind === 'texture') {
    const bound = bindImportedSource(raw.source, 'texture', ctx);
    s.source = bound.id;
    if (bound.rebound) ctx.rebound += 1;
    if (!bound.id) { s.enabled = false; ctx.missingSources += 1; }
    s.amount = importNum(raw.amount, 0.2, 0, 1.5);
    s.win = Math.round(importNum(raw.win, 9, 3, 31));
    return s;
  }
  return null;
}

export function importRecipeText(text, filename = '配方') {
  let payload;
  try {
    payload = JSON.parse(String(text ?? ''));
  } catch (err) {
    toast(`导入配方失败：JSON 无效（${String(err?.message ?? err)}）`);
    return { ok: false, msg: 'JSON 无效' };
  }

  const recipeField = payload?.recipe;
  const rawSteps = Array.isArray(payload) ? payload
    : Array.isArray(recipeField) ? recipeField
      : Array.isArray(recipeField?.steps) ? recipeField.steps
        : Array.isArray(payload?.steps) ? payload.steps
          : null;
  if (!rawSteps) {
    toast('导入配方失败：文件里没有 steps 数组');
    return { ok: false, msg: '缺少 steps' };
  }

  const inv = payload.inventory
    ?? (recipeField && !Array.isArray(recipeField) ? recipeField : {});
  const ctx = {
    L: store.length,
    allIds: sampleIndex,
    invSegment: Array.isArray(inv.segmentIds) ? inv.segmentIds : [],
    invTexture: Array.isArray(inv.textureIds) ? inv.textureIds : [],
    currentSegment: segmentRefs().map((r) => r.sampleId),
    currentTexture: textureRefs().map((r) => r.sampleId),
    rebound: 0,
    missingSources: 0,
  };

  const imported = [];
  let skipped = 0;
  for (const raw of rawSteps) {
    const step = sanitizeImportedStep(raw, ctx);
    if (step) imported.push(step);
    else skipped += 1;
  }
  if (!imported.length) {
    toast('导入配方失败：没有可用的操作步');
    return { ok: false, msg: '没有可用操作步' };
  }

  pushUndo('导入配方');
  store.steps = imported;
  store.selectedStepId = imported.find((s) => s.enabled !== false)?.id ?? imported[0].id;
  store.previewOp = null;
  bumpRecipe();

  const datasetMismatch = !!(payload?.dataset?.id && store.datasetId && payload.dataset.id !== store.datasetId);
  const notes = [];
  if (skipped) notes.push(`跳过 ${skipped} 步`);
  if (ctx.missingSources) notes.push(`${ctx.missingSources} 步缺源已停用`);
  if (ctx.rebound) notes.push(`${ctx.rebound} 步源已按角色重绑`);
  if (datasetMismatch) notes.push('数据集不同，区间已按当前长度裁剪');
  const detail = `导入配方 ${filename}：${imported.length} 步${notes.length ? ` · ${notes.join(' · ')}` : ''}`;
  rec('import', detail);
  toast(detail, 4200);
  return {
    ok: true,
    imported: imported.length,
    skipped,
    rebound: ctx.rebound,
    missingSources: ctx.missingSources,
    datasetMismatch,
  };
}

export async function importRecipeFile(file) {
  if (!file) { toast('没有选择配方文件'); return { ok: false, msg: '没有选择文件' }; }
  if (file.size > 5 * 1024 * 1024) {
    toast('导入配方失败：文件超过 5 MB');
    return { ok: false, msg: '文件过大' };
  }
  try {
    const text = typeof file.text === 'function'
      ? await file.text()
      : await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ''));
        fr.onerror = () => reject(new Error('读取文件失败'));
        fr.readAsText(file);
      });
    return importRecipeText(text, file.name);
  } catch (err) {
    toast(`导入配方失败：${String(err?.message ?? err)}`);
    return { ok: false, msg: String(err?.message ?? err) };
  }
}

/* ═══════════ 展示辅助 ═══════════ */

export function recipeText() {
  if (!store.steps.length) return '（空——从方法栏点入，或在画布上直接编辑）';
  return store.steps.map((s, i) => `${i + 1}. ${stepLabel(s)}${s.enabled === false ? '（停用）' : ''}`).join(' · ');
}
export function sparkPoints(values, w, h, pad = 1) {
  if (!values?.length) return '';
  const { min, max } = store.yRange;
  const span = (max - min) || 1;
  const L = values.length;
  const pts = [];
  const stride = Math.max(1, Math.floor(L / 64));
  for (let k = 0; k < L; k += stride) {
    const x = pad + (k / (L - 1)) * (w - 2 * pad);
    const y = h - pad - ((values[k] - min) / span) * (h - 2 * pad);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}
export { fmtNum, COMPONENTS, componentByKey, stepLabel, medianOf };
