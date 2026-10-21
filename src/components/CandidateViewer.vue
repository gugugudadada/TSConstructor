<script setup>
/* 第二阶段左副列的临时候选查看器（最小实现）：
   查看本会话所有批次的候选，逐条点选、看候选波形与基源对照。
   只做“查看”，不做质量评分 / 覆盖 / 裁决 / 归档。 */
import { computed, ref } from 'vue';
import { store, valuesOf } from '../store.js';

const VB_W = 260, VB_H = 82;
const PAD = { l: 4, r: 4, t: 6, b: 12 };
const batchFilter = ref('all');

const batches = computed(() => {
  if (store.batches.length) return store.batches;
  if (!store.candidates.length) return [];
  return [{ id: store.lastBatch?.id ?? 1, seed: store.lastBatch?.seed, generated: store.candidates.length, candidates: store.candidates }];
});
const allCandidates = computed(() => batches.value.flatMap((b) => (b.candidates ?? [])));
const visible = computed(() => {
  if (batchFilter.value === 'all') return allCandidates.value;
  const b = batches.value.find((x) => String(x.id) === String(batchFilter.value));
  return b?.candidates ?? [];
});
const selected = computed(() => {
  const hit = visible.value.find((c) => c.id === store.selectedCandidateId);
  return hit ?? visible.value[0] ?? null;
});
const baseValues = computed(() => (selected.value?.baseId ? valuesOf(selected.value.baseId) : null));
const yDom = computed(() => {
  const c = selected.value;
  if (!c) return { min: -1, max: 1 };
  let min = Infinity, max = -Infinity;
  for (const v of c.values ?? []) { if (v < min) min = v; if (v > max) max = v; }
  for (const v of baseValues.value ?? []) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min)) return { min: -1, max: 1 };
  const m = (max - min) * 0.08 || 1;
  return { min: min - m, max: max + m };
});
const L = computed(() => selected.value?.values?.length ?? 0);
function X(i) { return PAD.l + (i / Math.max(1, L.value - 1)) * (VB_W - PAD.l - PAD.r); }
function Y(v) { const d = yDom.value; return PAD.t + ((d.max - v) / (d.max - d.min)) * (VB_H - PAD.t - PAD.b); }
function pathOf(values) {
  if (!values?.length) return '';
  return values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
}
function miniPoints(values) {
  if (!values?.length) return '';
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  const d = (max - min) || 1;
  return values.map((v, i) => `${(2 + (i / Math.max(1, values.length - 1)) * 60).toFixed(1)},${(17 - ((v - min) / d) * 14).toFixed(1)}`).join(' ');
}
function selectCandidate(c) { store.selectedCandidateId = c.id; }
function tagText(t) {
  const parts = Array.isArray(t.parts) ? t.parts : [];
  return `${t.label ?? t.opId ?? '变化'}${parts.length ? ` · ${parts.join(' / ')}` : ''}`;
}
</script>

<template>
  <div class="dev candidate-viewer">
    <div class="dev-head">
      <b>候选结果（临时查看器）</b>
      <span class="hint">本会话 {{ allCandidates.length }} 条</span>
      <span class="hint" style="margin-left:auto">仅查看 · 其他检查暂不实现</span>
    </div>

    <div v-if="!allCandidates.length" class="cv-empty">
      尚无候选——先回到阶段①，在生成条点「生成候选」。
    </div>

    <template v-else>
      <div class="cv-toolbar">
        <span class="hint">批次</span>
        <select v-model="batchFilter" class="cv-select">
          <option value="all">全部（{{ allCandidates.length }}）</option>
          <option v-for="b in batches" :key="b.id" :value="String(b.id)">
            批 #{{ b.id }}（{{ b.candidates?.length ?? 0 }}）
          </option>
        </select>
        <span class="hint">当前 {{ visible.length }} 条</span>
      </div>

      <div class="cv-list">
        <button
          v-for="c in visible" :key="c.id" class="cv-row"
          :class="{ on: selected?.id === c.id }" @click="selectCandidate(c)"
        >
          <svg class="cv-spark" viewBox="0 0 64 20" aria-hidden="true">
            <polyline :points="miniPoints(c.values)" fill="none" stroke="#eb6834" stroke-width="1" />
          </svg>
          <span class="cv-id">{{ c.id }}</span>
          <span class="cv-batch">#{{ c.batchId }}</span>
          <span class="cv-base" :title="`基源 ${c.baseId ?? '—'} · 类 ${c.baseClass ?? '—'}`">{{ c.baseClass ?? '—' }}</span>
          <span class="cv-tagcount" :title="`${c.tags?.length ?? 0} 条差异签名`">{{ c.tags?.length ?? 0 }}</span>
        </button>
        <div v-if="!visible.length" class="hint" style="padding:8px">该批次没有候选。</div>
      </div>

      <div v-if="selected" class="cv-detail">
        <div class="cv-meta">
          <b>{{ selected.id }}</b>
          <span>批 #{{ selected.batchId }}</span>
          <span>seed {{ selected.seed }}</span>
          <span>基源 {{ selected.baseId ?? '—' }} · 类 {{ selected.baseClass ?? '—' }}</span>
          <span>目标 {{ selected.label ?? store.target?.name ?? '—' }}</span>
        </div>
        <div class="cv-legend">
          <span><i class="cv-sw base" />基源</span>
          <span><i class="cv-sw cand" />候选</span>
          <span class="hint">{{ L }} 点</span>
        </div>
        <svg class="cv-svg" :viewBox="`0 0 ${VB_W} ${VB_H}`" preserveAspectRatio="none">
          <polyline v-if="baseValues" :points="pathOf(baseValues)" fill="none" stroke="#898781" stroke-width="1" vector-effect="non-scaling-stroke" />
          <polyline :points="pathOf(selected.values)" fill="none" stroke="#eb6834" stroke-width="1.8" vector-effect="non-scaling-stroke" />
          <text :x="PAD.l" :y="VB_H - 3" class="cv-axis">t 0–{{ L - 1 }}</text>
        </svg>
        <div class="cv-tags">
          <span v-for="(t, i) in (selected.tags ?? [])" :key="i" class="cv-tag" :title="tagText(t)">{{ tagText(t) }}</span>
          <span v-if="!selected.tags?.length" class="hint">无差异签名</span>
        </div>
      </div>
    </template>
  </div>
</template>
