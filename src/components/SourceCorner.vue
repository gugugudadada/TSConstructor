<script setup>
/* 素材源角窗（主列画布左下）：克隆 / 纹理共用。
   克隆源只来自副列「片段」列表，纹理源只来自副列「纹理」列表。
   克隆可在小窗里拖拽刷选源段；纹理为整条残差，不选段。 */
import { computed, ref } from 'vue';
import {
  store, valuesOf, sampleOf, classLabelOf, segmentRefs, textureRefs,
  updateStep, activeRegion, toast, stepLabel, sparkPoints,
} from '../store.js';

const CC_W = 200, CC_H = 46;
const drag = ref(null);

const isClone = (s) => s?.kind === 'transplant';
const isTexture = (s) => s?.kind === 'texture';
const sourceSteps = computed(() => store.steps.filter((s) => isClone(s) || isTexture(s)));
const step = computed(() => {
  const selected = store.steps.find((s) => s.id === store.selectedStepId);
  if (selected && (isClone(selected) || isTexture(selected))) return selected;
  return sourceSteps.value[0] ?? null;
});
const kind = computed(() => (isClone(step.value) ? 'clone' : isTexture(step.value) ? 'texture' : null));
const options = computed(() => (kind.value === 'clone' ? segmentRefs() : kind.value === 'texture' ? textureRefs() : []));
const sourceId = computed(() => step.value?.source ?? '');
const sourceValues = computed(() => (sourceId.value ? valuesOf(sourceId.value) : null));
const poly = computed(() => (sourceValues.value ? sparkPoints(sourceValues.value, CC_W, CC_H, 4) : ''));
const span = computed(() => {
  if (!isClone(step.value) || !Array.isArray(step.value.srcSpan)) return null;
  const lim = Math.max(0, store.length - 1);
  const a = Math.max(0, Math.min(lim, Math.min(step.value.srcSpan[0], step.value.srcSpan[1])));
  const b = Math.max(0, Math.min(lim, Math.max(step.value.srcSpan[0], step.value.srcSpan[1])));
  return [a, b];
});
const targetText = computed(() => {
  const s = step.value;
  if (!s) return '—';
  return s.dstSpan ? `${s.dstSpan[0]}–${s.dstSpan[1]}` : `@${s.dstStart ?? '—'}`;
});

function X(i) { return 4 + (i / Math.max(1, store.length - 1)) * (CC_W - 8); }
function idxAt(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const px = ((e.clientX - r.left) / Math.max(1, r.width)) * CC_W;
  return Math.max(0, Math.min(store.length - 1, Math.round(((px - 4) / (CC_W - 8)) * (store.length - 1))));
}
function down(e) {
  if (!isClone(step.value)) return;
  const i = idxAt(e);
  drag.value = { i0: i, i1: i };
}
function move(e) {
  if (!drag.value) return;
  const i = idxAt(e);
  drag.value = { i0: Math.min(drag.value.i0, i), i1: Math.max(drag.value.i0, i) };
}
function up() {
  const d = drag.value;
  drag.value = null;
  if (!d || !isClone(step.value) || d.i1 - d.i0 < 2) return;
  updateStep(step.value.id, { srcSpan: [d.i0, d.i1] });
}
function pickSource(e) {
  const s = step.value;
  if (!s) return;
  const id = e.target.value;
  const ref = options.value.find((r) => r.sampleId === id);
  if (!ref) return;
  const patch = { source: id };
  if (isClone(s) && Array.isArray(ref.seg)) patch.srcSpan = [...ref.seg];
  updateStep(s.id, patch);
}
function useRegionForTarget() {
  const r = activeRegion();
  if (!r) { toast('先划一个选区作为克隆落点'); return; }
  if (!step.value) return;
  updateStep(step.value.id, { dstSpan: [...r.span], dstStart: null });
}
function optLabel(ref) {
  const sample = sampleOf(ref.sampleId);
  return sample ? `${ref.sampleId} · 类 ${classLabelOf(sample.class)}` : ref.sampleId;
}
</script>

<template>
  <div v-if="step" class="sc-corner">
    <div class="sc-head">
      <b>{{ kind === 'clone' ? '克隆源 A' : '纹理源' }}</b>
      <span class="hint sc-kind">{{ stepLabel(step) }}</span>
      <select class="sc-select" :value="sourceId" @change="pickSource">
        <option value="" disabled>选择{{ kind === 'clone' ? '片段' : '纹理' }}…</option>
        <option v-for="r in options" :key="r.sampleId" :value="r.sampleId">{{ optLabel(r) }}</option>
      </select>
    </div>
    <svg
      class="sc-svg" :viewBox="`0 0 ${CC_W} ${CC_H}`" preserveAspectRatio="none"
      @mousedown.prevent="down" @mousemove="move" @mouseup="up" @mouseleave="up"
    >
      <polyline :points="poly" fill="none" stroke="#898781" stroke-width="1" vector-effect="non-scaling-stroke" />
      <rect
        v-if="span" :x="X(span[0])" y="3"
        :width="Math.max(1, X(span[1]) - X(span[0]))" :height="CC_H - 6"
        fill="rgba(42,120,214,0.12)"
      >
        <title>克隆源段（A）</title>
      </rect>
      <rect
        v-if="drag" :x="X(drag.i0)" y="3"
        :width="Math.max(1, X(drag.i1) - X(drag.i0))" :height="CC_H - 6"
        fill="rgba(42,120,214,0.22)"
      />
    </svg>
    <div class="sc-hint">
      <template v-if="kind === 'clone'">
        拖拽 = 刷选源段 · 落点 {{ targetText }}
        <button class="sc-mini" @click="useRegionForTarget">落点 = 选区</button>
      </template>
      <template v-else>
        整条纹理 · 先选副列「纹理」素材，强度 / 趋势窗在配方中调
      </template>
    </div>
  </div>
</template>
