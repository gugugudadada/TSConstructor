<script setup>
/* 样本仪（内联体）：单样本波形 + 其类内参照（10–90 / IQR / 中位线）+ 悬停时刻的类内切片分布。
   ⚠ 逐时刻分位带会压平多峰——切片对照是补偿，不得砍。缺类重建时被隐藏类不在此出现。 */
import { computed, ref } from 'vue';
import { store, sampleOf, isHiddenSample } from '../store.js';

const props = defineProps({ id: { type: String, default: null } });
const hoverT = ref(null);
const svgEl = ref(null);

const sid = computed(() => props.id ?? store.currentId);
const sample = computed(() => (sid.value ? sampleOf(sid.value) : null));
const clsLabel = computed(() => {
  const c = store.dataset?.classes.find((x) => x.key === sample.value?.class);
  return c ? c.label : '—';
});

const band = computed(() => {
  const s = sample.value;
  if (!s) return null;
  const xs = store.dataset.samples.filter((x) => x.class === s.class && !isHiddenSample(x));
  if (!xs.length) return null;
  const L = xs[0].values.length;
  const cols = [];
  for (let t = 0; t < L; t++) cols.push(xs.map((x) => x.values[t]).sort((a, b) => a - b));
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.round(p * (arr.length - 1)))];
  return {
    L, cols,
    p10: cols.map((c) => q(c, 0.1)), p25: cols.map((c) => q(c, 0.25)), p50: cols.map((c) => q(c, 0.5)),
    p75: cols.map((c) => q(c, 0.75)), p90: cols.map((c) => q(c, 0.9)),
  };
});

const VB_W = 700, VB_H = 186;
const PAD = { l: 34, r: 8, t: 10, b: 18 };
const WAVE_R = 636, SLICE_X = 646, SLICE_W = 46;

const yDom = computed(() => {
  const b = band.value;
  if (!b) return { min: -1, max: 1 };
  let min = Infinity, max = -Infinity;
  for (let t = 0; t < b.L; t++) { if (b.p10[t] < min) min = b.p10[t]; if (b.p90[t] > max) max = b.p90[t]; }
  const s = sample.value;
  if (s) for (const v of s.values) { if (v < min) min = v; if (v > max) max = v; }
  const m = (max - min) * 0.06 || 1;
  return { min: min - m, max: max + m };
});
function X(t) { return PAD.l + (t / (band.value.L - 1)) * (WAVE_R - PAD.l); }
function Y(v) { const d = yDom.value; return PAD.t + ((d.max - v) / (d.max - d.min)) * (VB_H - PAD.t - PAD.b); }
function pathOf(arr) { return arr.map((v, t) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' '); }
function areaOf(lo, hi) {
  const fwd = hi.map((v, t) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`);
  const back = [];
  for (let t = lo.length - 1; t >= 0; t--) back.push(`${X(t).toFixed(1)},${Y(lo[t]).toFixed(1)}`);
  return `${fwd.join(' ')} ${back.join(' ')}`;
}

const slice = computed(() => {
  const b = band.value, t = hoverT.value;
  if (!b || t == null || t < 0 || t >= b.L) return null;
  const vals = b.cols[t]; const d = yDom.value; const bins = 24;
  const counts = new Array(bins).fill(0);
  for (const v of vals) { const k = Math.min(bins - 1, Math.max(0, Math.floor(((v - d.min) / (d.max - d.min)) * bins))); counts[k] += 1; }
  const max = Math.max(...counts, 1);
  return { t, counts, max, n: vals.length };
});
const sliceBars = computed(() => {
  if (!slice.value) return [];
  const d = yDom.value; const bins = slice.value.counts.length; const out = [];
  for (let k = 0; k < bins; k++) {
    const v = d.min + ((k + 0.5) / bins) * (d.max - d.min);
    out.push({ y: Y(v), len: (slice.value.counts[k] / slice.value.max) * (SLICE_W - 4), n: slice.value.counts[k] });
  }
  return out;
});

function onSvgMove(e) {
  const b = band.value; if (!b) return;
  const r = svgEl.value.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * VB_W;
  if (px < PAD.l || px > WAVE_R) { hoverT.value = null; return; }
  hoverT.value = Math.min(b.L - 1, Math.max(0, Math.round(((px - PAD.l) / (WAVE_R - PAD.l)) * (b.L - 1))));
}
</script>

<template>
  <div class="si-inline">
    <div class="si-inline-head">
      <span v-if="sample"><b>{{ sample.id }}</b> · 类 {{ clsLabel }} · {{ sample.values.length }} 点</span>
      <span v-else class="hint">未选择样本</span>
      <span class="hint">类内参照 = 10–90 带 / IQR 带 / 中位线 · 悬停 = 切片对照</span>
    </div>
    <svg v-if="band" ref="svgEl" class="si-svg" :viewBox="`0 0 ${VB_W} ${VB_H}`" preserveAspectRatio="none" @mousemove="onSvgMove" @mouseleave="hoverT = null">
      <polygon :points="areaOf(band.p10, band.p90)" fill="#e7e6e0" />
      <polygon :points="areaOf(band.p25, band.p75)" fill="#cfcec5" />
      <polyline :points="pathOf(band.p50)" fill="none" stroke="#52514e" stroke-width="1.4" vector-effect="non-scaling-stroke" />
      <polyline v-if="sample" :points="pathOf(sample.values)" fill="none" stroke="#2a78d6" stroke-width="2" vector-effect="non-scaling-stroke" />
      <line v-if="hoverT != null" :x1="X(hoverT)" :x2="X(hoverT)" :y1="PAD.t" :y2="VB_H - PAD.b" stroke="#898781" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
      <circle v-if="hoverT != null && sample" :cx="X(hoverT)" :cy="Y(sample.values[hoverT])" r="3" fill="#2a78d6" stroke="#ffffff" stroke-width="1.5" />
      <text :x="PAD.l" :y="VB_H - 5" class="si-axis">t 0–{{ band.L - 1 }}</text>
      <text :x="PAD.l - 6" :y="PAD.t + 8" class="si-axis" text-anchor="end">{{ yDom.max.toFixed(1) }}</text>
      <text :x="PAD.l - 6" :y="VB_H - PAD.b" class="si-axis" text-anchor="end">{{ yDom.min.toFixed(1) }}</text>
      <g v-if="slice">
        <rect :x="SLICE_X - 2" :y="PAD.t" :width="SLICE_W + 4" :height="VB_H - PAD.t - PAD.b" fill="#f6f5f1" />
        <rect v-for="(b, k) in sliceBars" :key="k" :x="SLICE_X" :y="b.y - 2.2" :width="Math.max(0, b.len)" :height="4.4" fill="#b9b7b0">
          <title>{{ `值区间样本数 ${b.n}` }}</title>
        </rect>
        <line v-if="sample" :x1="SLICE_X - 2" :x2="SLICE_X + SLICE_W + 2" :y1="Y(sample.values[slice.t])" :y2="Y(sample.values[slice.t])" stroke="#2a78d6" stroke-width="2" vector-effect="non-scaling-stroke" />
        <text :x="SLICE_X" :y="VB_H - 5" class="si-axis">t={{ slice.t }} · 类内 {{ slice.n }} 条</text>
      </g>
    </svg>
  </div>
</template>
