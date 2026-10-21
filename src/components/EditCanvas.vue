<script setup>
/* 编辑画布（主列）：D2/D3 表达层——直接拖拽 + 组件叠加，全部编译成结构化操作步。
   层叠 = 区间带 → 基源（灰）→ 各级中间（橙渐淡）→ 最终（橙）→ 拖拽预览（虚线）。
   （来源构成带 / 结构指纹芯片等"检查与证据"反馈 = RQ3，属第二阶段左副列，本阶段不涉及。） */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  store, workRun, templateValues,
  addRegion, removeRegion, selectRegion, setPreview, clearPreview, commitPreview,
  primaryBaseId, sampleOf, fmtNum,
} from '../store.js';
import { detectEditableStructures, STRUCTURE_TYPES } from '../engine/structureAdapter.js';
import SourceCorner from './SourceCorner.vue';

const svgEl = ref(null);
const wrapEl = ref(null);
const hover = ref(null);
const drag = ref(null);
const size = ref({ w: 900, h: 260 });
const VB_W = computed(() => Math.max(360, Math.round(size.value.w)));
const VB_H = computed(() => Math.max(150, Math.round(size.value.h)));
const PAD = { l: 46, r: 14, t: 22, b: 22 };

const run = computed(() => { void store.recipeVersion; void store.previewOp; return workRun.value; });
const baseId = computed(() => primaryBaseId());
const baseSample = computed(() => (baseId.value ? sampleOf(baseId.value) : null));
const L = computed(() => templateValues.value?.length || store.length);
const baseVals = computed(() => run.value.stages?.[0]?.values ?? []);

const yDom = computed(() => {
  const all = [baseVals.value, ...(run.value.stages ?? []).map((s) => s.values), run.value.values];
  let min = Infinity, max = -Infinity;
  for (const arr of all) for (const v of arr) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min)) { min = -1; max = 1; }
  const m = (max - min) * 0.08 || 1;
  return { min: min - m, max: max + m };
});
function X(i) { return PAD.l + (i / (L.value - 1)) * (VB_W.value - PAD.l - PAD.r); }
function Y(v) { const d = yDom.value; return PAD.t + ((d.max - v) / (d.max - d.min)) * (VB_H.value - PAD.t - PAD.b); }
function Yinv(py) { const d = yDom.value; return d.max - ((py - PAD.t) / (VB_H.value - PAD.t - PAD.b)) * (d.max - d.min); }
function pathOf(arr) { const p = []; for (let k = 0; k < arr.length; k++) p.push(`${X(k).toFixed(1)},${Y(arr[k]).toFixed(1)}`); return `M${p.join('L')}`; }

function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw || 1)); const c = raw / p; return (c <= 1 ? 1 : c <= 2 ? 2 : c <= 2.5 ? 2.5 : c <= 5 ? 5 : 10) * p; }
const yTickStep = computed(() => niceStep((yDom.value.max - yDom.value.min) / 5));
const yTicks = computed(() => { const d = yDom.value, st = yTickStep.value, out = []; for (let v = Math.ceil(d.min / st) * st; v <= d.max + 1e-9; v += st) out.push(+v.toFixed(9)); return out; });
const xTicks = computed(() => { const n = L.value; const st = n <= 40 ? 5 : n <= 120 ? 20 : n <= 260 ? 25 : 50; const out = []; for (let i = 0; i < n; i += st) out.push(i); return out; });
function fmtTick(v) { const st = yTickStep.value; const dec = Number.isInteger(st) ? 0 : (st * 10) % 1 === 0 ? 1 : (st * 100) % 1 === 0 ? 2 : 3; return v.toFixed(dec); }

const stageLines = computed(() => {
  const st = run.value.stages ?? [];
  const lines = [];
  st.forEach((s, idx) => {
    if (idx === 0) return;   // 基源单独画
    const isLast = idx === st.length - 1;
    const isPreview = s.id === '__preview';
    lines.push({
      id: s.id, label: s.label, path: pathOf(s.values), final: isLast && !isPreview, preview: isPreview,
      failed: !!s.failed, note: s.note,
      opacity: isLast ? 1 : 0.3 + 0.55 * ((idx + 1) / Math.max(1, st.length)),
    });
  });
  return lines;
});

/* ── 拖拽交互 ── */
function idxAt(e) {
  const r = svgEl.value.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * VB_W.value;
  return Math.max(0, Math.min(L.value - 1, Math.round(((px - PAD.l) / (VB_W.value - PAD.l - PAD.r)) * (L.value - 1))));
}
function valAt(e) {
  const r = svgEl.value.getBoundingClientRect();
  const py = ((e.clientY - r.top) / r.height) * VB_H.value;
  return Yinv(py);
}
function onMove(e) {
  const i = idxAt(e);
  if (drag.value) {
    drag.value = { ...drag.value, i1: i, v1: valAt(e) };
    if (drag.value.tool === 'deform') {
      setPreview({ kind: 'deform', anchor: drag.value.i0, width: drag.value.width, amp: drag.value.v0 - drag.value.v1 });
    }
    return;
  }
  hover.value = { i, v: run.value.values?.[i] ?? null, b: baseVals.value?.[i] ?? null };
}
function onDown(e) {
  if (e.button !== 0) return;
  if (!baseId.value) return;
  const i = idxAt(e);
  const tool = store.tool;
  if (tool === 'select') { drag.value = { tool, i0: i, i1: i }; return; }
  if (tool === 'deform') { const v = valAt(e); drag.value = { tool, i0: i, i1: i, v0: v, v1: v, width: store.brushWidth }; return; }
}
function onUp() {
  const d = drag.value; drag.value = null;
  if (!d) return;
  if (d.tool === 'select') {
    clearPreview();
    /* 允许从右往左划选区。 */
    if (Math.abs(d.i1 - d.i0) >= 2) addRegion([Math.min(d.i0, d.i1), Math.max(d.i0, d.i1)]);
    return;
  }
  if (d.tool === 'deform') {
    const amp = d.v0 - d.v1;
    clearPreview();
    if (Math.abs(amp) > 1e-4) commitPreview({ kind: 'deform', anchor: d.i0, width: d.width, amp });
    return;
  }
}

function onLeave() {
  hover.value = null;
  /* 拖出画布 = 取消这次拖拽；否则预览会留在 store.previewOp 里，继续影响工作模板。 */
  if (drag.value) clearPreview();
  drag.value = null;
}

const baseRunEmpty = computed(() => !baseId.value || !baseVals.value.length);

/* ── P1 结构检测（复用 structures.js；只做基源结构） ── */
const STRUCTURE_META = Object.fromEntries(STRUCTURE_TYPES.map((t) => [t.key, t]));
const STRUCTURE_SENSITIVITY_LABELS = { strict: '严格', normal: '标准', loose: '灵敏' };
const structureResult = computed(() => detectEditableStructures(baseVals.value, store.structureConfig.sensitivity));
const visibleStructures = computed(() => structureResult.value.instances.filter((s) => store.structureView.types[s.type]));
const selectedStructure = computed(() => visibleStructures.value.find((s) => s.id === store.structureView.selectedId) ?? null);
function structureMeta(type) { return STRUCTURE_META[type] ?? STRUCTURE_TYPES[0]; }
function structureIsInterval(s) { return s.type === 'plateau' || s.type === 'ramp'; }
function structureSummary(s) {
  const bits = [
    s.label,
    `位置 ${s.startIndex}–${s.endIndex}`,
    `中心 ${s.centerIndex}`,
    `宽 ${s.width}`,
    `相对 ${(s.relativePosition * 100).toFixed(0)}%`,
  ];
  if (s.type === 'peak' || s.type === 'valley') {
    if (s.prominence != null) bits.push(`显著性 ${s.prominence.toFixed(2)}σ`);
  } else if (s.type === 'plateau') {
    if (s.level != null) bits.push(`电平 ${s.level.toFixed(2)}σ`);
    if (s.height != null) bits.push(`起伏 ${s.height.toFixed(2)}σ`);
  } else if (s.type === 'ramp') {
    bits.push(s.direction === 'up' ? '上升' : '下降');
    if (s.height != null) bits.push(`高度 ${s.height.toFixed(2)}σ`);
  }
  return bits.join(' · ');
}
function selectStructure(id) { store.structureView.selectedId = id; }
function toggleStructureType(key) {
  store.structureView.types[key] = !store.structureView.types[key];
  store.structureView.selectedId = null;
}
function setStructureSensitivity(e) {
  store.structureConfig.sensitivity = e.target.value;
  store.structureView.selectedId = null;
}
watch(baseId, () => { store.structureView.selectedId = null; });

/* 克隆落点带：跟随当前/首个克隆步，长度 = 源段长度。 */
const cloneStep = computed(() => {
  const selected = store.steps.find((s) => s.id === store.selectedStepId);
  if (selected?.kind === 'transplant') return selected;
  return store.steps.find((s) => s.kind === 'transplant') ?? null;
});
const cloneTarget = computed(() => {
  const s = cloneStep.value;
  if (!s) return null;
  const a = Array.isArray(s.srcSpan) ? Math.min(s.srcSpan[0], s.srcSpan[1]) : 0;
  const b = Array.isArray(s.srcSpan) ? Math.max(s.srcSpan[0], s.srcSpan[1]) : 0;
  const len = Math.max(1, b - a + 1);
  const raw = s.dstSpan ? Math.min(s.dstSpan[0], s.dstSpan[1]) : (s.dstStart ?? 0);
  const start = Math.max(0, Math.min(L.value - 1, Math.round(raw)));
  return { start, end: Math.min(L.value - 1, start + len - 1) };
});

let ro = null;
onMounted(() => {
  const el = wrapEl.value; if (!el) return;
  const sync = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) size.value = { w: r.width, h: r.height }; };
  sync(); ro = new ResizeObserver(sync); ro.observe(el);
});
onBeforeUnmount(() => { ro?.disconnect(); clearPreview(); });
</script>

<template>
  <div class="dev">
    <div class="dev-head">
      <b>编辑画布</b>
      <span class="ci-toolbar">
        <button class="ci-tool" :class="{ on: store.tool === 'select' }" title="拖拽 = 划定选区（≤3；选区决定组件默认落点）" @click="store.tool = 'select'">选区</button>
        <button class="ci-tool" :class="{ on: store.tool === 'deform' }" title="在波形上按住并上下拖动 = 局部点拖拽（写入配方的点编辑步）" @click="store.tool = 'deform'">点拖拽</button>
        <span class="hint" title="点拖拽时，以按下点为中心向两侧平滑影响的采样点数">笔宽（点）</span>
        <input v-model.number="store.brushWidth" type="number" min="2" max="30" class="num-in" style="width:52px" title="点拖拽的高斯影响宽度，单位=采样点" />
        <button class="ci-tool" :class="{ on: store.structureView.show }" :disabled="baseRunEmpty" title="显示/隐藏基源结构检测（平台 / 峰 / 谷 / 斜坡）" @click="store.structureView.show = !store.structureView.show">结构</button>
      </span>
      <span class="ci-right">
        <span v-for="r in store.regions" :key="r.id" class="ci-region" :class="{ cur: r.id === store.selectedRegionId }" :title="`R${r.id} · ${r.span[0]}–${r.span[1]} · 点击选中`" @click="selectRegion(r.id)">
          R{{ r.id }} {{ r.span[0] }}–{{ r.span[1] }}<button class="ci-region-x" title="删除该选区" @click.stop="removeRegion(r.id)">✕</button>
        </span>
      </span>
    </div>
    <div ref="wrapEl" class="ci-wrap" title="选区/拖拽编辑 · 悬停 = 读数">
      <svg
        v-if="!baseRunEmpty" ref="svgEl" class="ci-svg" :viewBox="`0 0 ${VB_W} ${VB_H}`" preserveAspectRatio="none"
        @mousemove="onMove" @mousedown.prevent="onDown" @mouseup="onUp" @mouseleave="onLeave"
      >
        <g v-for="r in store.regions" :key="r.id">
          <rect :x="X(r.span[0])" :y="PAD.t" :width="Math.max(1, X(r.span[1]) - X(r.span[0]))" :height="VB_H - PAD.t - PAD.b" :fill="r.id === store.selectedRegionId ? '#f0efec' : '#f7f6f3'" />
          <text :x="X(r.span[0]) + 3" :y="PAD.t + 9" class="ci-axis">R{{ r.id }}</text>
        </g>
        <g v-if="cloneTarget" pointer-events="none">
          <rect :x="X(cloneTarget.start)" :y="PAD.t" :width="Math.max(1, X(cloneTarget.end) - X(cloneTarget.start))" :height="VB_H - PAD.t - PAD.b" fill="rgba(42,120,214,0.08)">
            <title>克隆落点（当前选区 / 默认落点）</title>
          </rect>
          <line :x1="X(cloneTarget.start)" :x2="X(cloneTarget.start)" :y1="PAD.t" :y2="VB_H - PAD.b" stroke="#2a78d6" stroke-width="1.2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" />
        </g>
        <rect v-if="drag && drag.tool === 'select'" :x="X(Math.min(drag.i0, drag.i1))" :y="PAD.t" :width="Math.max(1, X(Math.max(drag.i0, drag.i1)) - X(Math.min(drag.i0, drag.i1)))" :height="VB_H - PAD.t - PAD.b" fill="#f0efec" />
        <g class="ci-axes">
          <line :x1="PAD.l" :x2="PAD.l" :y1="PAD.t" :y2="VB_H - PAD.b" />
          <line :x1="PAD.l" :x2="VB_W - PAD.r" :y1="VB_H - PAD.b" :y2="VB_H - PAD.b" />
          <template v-for="t in yTicks" :key="`yt${t}`">
            <line :x1="PAD.l - 3" :x2="PAD.l" :y1="Y(t)" :y2="Y(t)" />
            <text class="ci-axis" :x="PAD.l - 5" :y="Y(t) + 3" text-anchor="end">{{ fmtTick(t) }}</text>
          </template>
          <template v-for="t in xTicks" :key="`xt${t}`">
            <line :x1="X(t)" :x2="X(t)" :y1="VB_H - PAD.b" :y2="VB_H - PAD.b + 3" />
            <text class="ci-axis" :x="X(t)" :y="VB_H - PAD.b + 13" text-anchor="middle">{{ t }}</text>
          </template>
        </g>
        <path :d="pathOf(baseVals)" fill="none" stroke="#898781" stroke-width="1.2" vector-effect="non-scaling-stroke" />
        <path
          v-for="ln in stageLines" :key="ln.id" :d="ln.path" fill="none"
          :stroke="ln.failed ? '#d8dee4' : '#eb6834'"
          :stroke-width="ln.final ? 2 : ln.preview ? 1.6 : 1"
          :stroke-dasharray="ln.preview ? '5 3' : ln.failed ? '3 3' : undefined"
          :opacity="ln.final ? 1 : ln.preview ? 0.9 : ln.failed ? 0.7 : ln.opacity"
          vector-effect="non-scaling-stroke"
        >
          <title>{{ ln.label }}{{ ln.failed ? `（机械不可行：${ln.note}）` : ln.preview ? '（预览——松手写入配方）' : '' }}</title>
        </path>
        <g v-if="store.structureView.show" class="ci-structures">
          <g
            v-for="s in visibleStructures" :key="s.id" class="ci-structure-mark"
            :class="{ on: selectedStructure && selectedStructure.id === s.id }"
            @mousedown.stop.prevent @click.stop="selectStructure(s.id)"
          >
            <template v-if="structureIsInterval(s)">
              <rect
                :x="X(s.startIndex)" :y="PAD.t" :width="Math.max(1, X(s.endIndex) - X(s.startIndex))" :height="VB_H - PAD.t - PAD.b"
                rx="2" :fill="structureMeta(s.type).color" fill-opacity="0.07"
                :stroke="structureMeta(s.type).color" :stroke-width="selectedStructure && selectedStructure.id === s.id ? 1.8 : 1"
                :stroke-dasharray="s.type === 'ramp' ? '4 3' : undefined"
              >
                <title>{{ structureSummary(s) }}</title>
              </rect>
              <text :x="X(s.startIndex) + 3" :y="PAD.t + 10" class="ci-structure-label" :fill="structureMeta(s.type).color">{{ structureMeta(s.type).short }}</text>
            </template>
            <template v-else>
              <line
                :x1="X(s.centerIndex)" :x2="X(s.centerIndex)" :y1="PAD.t" :y2="VB_H - PAD.b"
                :stroke="structureMeta(s.type).color" :stroke-width="selectedStructure && selectedStructure.id === s.id ? 2 : 1.2"
                stroke-dasharray="3 3" vector-effect="non-scaling-stroke"
              >
                <title>{{ structureSummary(s) }}</title>
              </line>
              <circle
                :cx="X(s.centerIndex)" :cy="Y(baseVals[s.centerIndex] ?? 0)" :r="selectedStructure && selectedStructure.id === s.id ? 4 : 3"
                :fill="structureMeta(s.type).color" stroke="#fff" stroke-width="1"
              />
              <text :x="X(s.centerIndex) + 4" :y="PAD.t + 10" class="ci-structure-label" :fill="structureMeta(s.type).color">{{ structureMeta(s.type).short }}</text>
            </template>
          </g>
        </g>
        <line v-if="hover" :x1="X(hover.i)" :x2="X(hover.i)" :y1="PAD.t" :y2="VB_H - PAD.b" stroke="#898781" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
        <text :x="VB_W - PAD.r" :y="VB_H - PAD.b - 5" class="ci-axis" text-anchor="end">t · 点 0–{{ L - 1 }}</text>
      </svg>
      <div v-else class="load-msg">
        尚未指定「基源」——到副列素材架把某个样本标为 <b>基源</b>，工作模板就在它身上构造。
      </div>
      <SourceCorner v-if="!baseRunEmpty" />
      <div v-if="hover && !baseRunEmpty" class="ci-readout">
        t={{ hover.i }} · 基源 <b>{{ fmtNum(hover.b) }}</b> → 模板 <b>{{ fmtNum(hover.v) }}</b>
      </div>
    </div>
    <div v-if="store.structureView.show && !baseRunEmpty" class="ci-struct-panel">
      <div class="ci-struct-head">
        <b>结构</b>
        <span class="hint">基源 {{ baseId }} · {{ structureResult.meta.counts.total }} 个</span>
        <span class="ci-struct-types">
          <button
            v-for="t in STRUCTURE_TYPES" :key="t.key" class="ci-struct-type"
            :class="{ on: store.structureView.types[t.key] }" :style="{ '--st-color': t.color }"
            :title="`显示/隐藏${t.label}`" @click="toggleStructureType(t.key)"
          >{{ t.label }}</button>
        </span>
        <span class="ci-struct-sens">
          <span class="hint">灵敏度</span>
          <select :value="store.structureConfig.sensitivity" @change="setStructureSensitivity">
            <option value="strict">严格</option>
            <option value="normal">标准</option>
            <option value="loose">灵敏</option>
          </select>
        </span>
      </div>
      <div v-if="selectedStructure" class="ci-struct-detail">{{ structureSummary(selectedStructure) }}</div>
      <div class="ci-struct-list">
        <button
          v-for="s in visibleStructures" :key="s.id" class="ci-struct-chip"
          :class="{ on: selectedStructure && selectedStructure.id === s.id }" :title="structureSummary(s)"
          @click="selectStructure(s.id)"
        >
          <span class="ci-struct-dot" :style="{ background: structureMeta(s.type).color }" />{{ structureMeta(s.type).label }}
          {{ Math.round(s.relativePosition * 100) }}% · {{ s.width }} 点
        </button>
        <span v-if="!visibleStructures.length" class="hint">
          {{ structureResult.meta.counts.total ? '当前类型筛选下无结构。' : '未检测到结构；可切换灵敏度或类型。' }}
        </span>
      </div>
    </div>
  </div>
</template>
