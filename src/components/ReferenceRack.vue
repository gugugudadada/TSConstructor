<script setup>
/* 参考素材架（副列 → 主列）：跨旧类别取材的统一容器。
   角色 = 基源（承载体，决定"在谁身上构造"）/ 片段（克隆供体）/ 纹理（纹理供体），可叠加。
   片段角色带可选区间（拖拽刷选）——对应 D1"选择源样本、局部区间或可复用片段"。 */
import { computed, ref } from 'vue';
import {
  store, removeRef, toggleRefRole, setRefSeg, refClassSummary, valuesOf,
  classLabelOf, primaryBaseId, sampleOf, selectBase,
} from '../store.js';

const summary = computed(() => refClassSummary());
const baseId = computed(() => primaryBaseId());

const SEG_W = 240, SEG_H = 30;
const segDrag = ref(null);

function polyOf(sampleId) {
  const v = valuesOf(sampleId);
  if (!v || !store.yRange) return '';
  const { min, max } = store.yRange; const span = (max - min) || 1; const L = v.length; const pts = [];
  for (let k = 0; k < L; k += 3) {
    const x = 2 + (k / (L - 1)) * (SEG_W - 4);
    const y = SEG_H - 3 - ((v[k] - min) / span) * (SEG_H - 6);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}
function segX(i) { return 2 + (i / (store.length - 1)) * (SEG_W - 4); }
function segIdx(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * SEG_W;
  return Math.max(0, Math.min(store.length - 1, Math.round(((px - 2) / (SEG_W - 4)) * (store.length - 1))));
}
function segDown(e, r) { segDrag.value = { id: r.id, i0: segIdx(e), i1: segIdx(e) }; }
function segMove(e) { if (segDrag.value) segDrag.value = { ...segDrag.value, i1: segIdx(e) }; }
function segUp(r) {
  const d = segDrag.value; segDrag.value = null;
  if (d && d.id === r.id) { const lo = Math.min(d.i0, d.i1), hi = Math.max(d.i0, d.i1); if (hi - lo >= 2) setRefSeg(r.id, [lo, hi]); }
}
const ROLES = [['base', '基源'], ['segment', '片段'], ['texture', '纹理']];
</script>

<template>
  <div class="dev rack">
    <div class="dev-head">
      <b>参考素材架</b>
      <span class="hint dev-sub">基源 × {{ store.refs.filter((r) => r.roles.includes('base')).length }} · 片段 × {{ store.refs.filter((r) => r.roles.includes('segment')).length }} · 纹理 × {{ store.refs.filter((r) => r.roles.includes('texture')).length }}</span>
    </div>
    <div class="rk-body">
      <div v-if="!store.refs.length" class="rk-empty">
        素材架为空——在结构面或列表里勾选样本，用上方 <b>＋基源 / ＋片段 / ＋纹理</b> 成批加入。
        允许并鼓励从<b>不同旧类别</b>取材（跨类参考）。
      </div>
      <div
        v-for="r in store.refs" :key="r.id" class="rk-row"
        :class="{ proto: r.sampleId === baseId, 'base-row': r.roles.includes('base') }"
        :title="r.roles.includes('base') ? (r.sampleId === baseId ? '当前工作基源' : '点击切换为工作基源') : ''"
        @click="r.roles.includes('base') && selectBase(r.sampleId)"
      >
        <div class="rk-top">
          <span class="rk-id">{{ r.sampleId }}</span>
          <span class="rk-cls">类 {{ classLabelOf(sampleOf(r.sampleId)?.class) }}</span>
          <span v-if="r.sampleId === baseId" class="rk-cls" title="工作模板在它身上构造">★ 工作基源</span>
          <span v-else-if="r.roles.includes('base')" class="rk-cls">点击切换</span>
          <button class="rk-x" title="移出素材架" @click.stop="removeRef(r.id)">✕</button>
        </div>
        <div class="rk-roles">
          <button
            v-for="[key, name] in ROLES" :key="key" class="rk-role" :class="{ on: r.roles.includes(key) }"
            :title="`切换角色：${name}${key === 'base' ? '（承载体）' : key === 'segment' ? '（克隆供体）' : '（纹理供体）'}`"
            @click.stop="toggleRefRole(r.id, key)"
          >{{ name }}</button>
          <span v-if="r.roles.includes('segment')" class="rk-cls">片段区间 {{ r.seg[0] }}–{{ r.seg[1] }}</span>
        </div>
        <svg
          v-if="r.roles.includes('segment')" class="rk-seg-svg" :viewBox="`0 0 ${SEG_W} ${SEG_H}`"
          @click.stop @mousedown.prevent="segDown($event, r)" @mousemove="segMove" @mouseup="segUp(r)" @mouseleave="segUp(r)"
        >
          <polyline :points="polyOf(r.sampleId)" fill="none" stroke="#898781" stroke-width="1" vector-effect="non-scaling-stroke" />
          <rect :x="segX(r.seg[0])" y="2" :width="Math.max(1, segX(r.seg[1]) - segX(r.seg[0]))" :height="SEG_H - 4" fill="rgba(42,120,214,0.14)">
            <title>片段源区间（canonical 点）——拖拽重选</title>
          </rect>
          <rect
            v-if="segDrag?.id === r.id" :x="segX(Math.min(segDrag.i0, segDrag.i1))" y="2"
            :width="Math.max(1, segX(Math.max(segDrag.i0, segDrag.i1)) - segX(Math.min(segDrag.i0, segDrag.i1)))" :height="SEG_H - 4"
            fill="rgba(42,120,214,0.24)"
          />
        </svg>
      </div>
    </div>
    <div class="rk-comp">
      <span class="hint">取材构成：</span>
      <span v-for="c in summary" :key="c.key" class="rk-cc">类 {{ c.label }} × {{ c.n }}</span>
      <span v-if="summary.length > 1" class="hint" style="color:#b5451f">跨 {{ summary.length }} 个旧类别取材</span>
      <span v-if="!summary.length" class="hint">（空）</span>
    </div>
  </div>
</template>
