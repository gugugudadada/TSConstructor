<script setup>
/* 结构面（副列）：会话冻结的投影基底上，素材样本按类别着色；状态形 = 已勾选 / 已在素材架 / 当前。
   叠加"工作模板投影点"（橙）——回答"构造出的候选落在哪、离哪些类近"（D1 定位 + D5 关系的同一平面）。
   🔴 缺类重建时目标类样本不进此图（隐藏）；只报读数，不宣称"洞"或自动标注。 */
import { computed, ref, onMounted, onBeforeUnmount, watch, watchEffect } from 'vue';
import {
  store, setCurrent, toggleChecked, indexOf, projOf, setBasisMethod, toast, materialSamples,
  templateValues, primaryBaseId,
} from '../store.js';
import { ui } from '../ui.js';

const wrapEl = ref(null);
const cvEl = ref(null);
const ovEl = ref(null);
let ovRaf = 0;
const hover = ref(null);
const brush = ref(null);
const view = ref(null);
let drag = null;

const CLASS_COLORS = ['#2a78d6', '#7fa07a', '#c27b6b', '#6ba8a2', '#a08cc0', '#b08a5a', '#8d99a6'];
const classColor = computed(() => {
  const m = new Map();
  (store.dataset?.classes ?? []).forEach((c, i) => m.set(c.key, CLASS_COLORS[i % CLASS_COLORS.length]));
  return m;
});
function colorOf(key) { return classColor.value.get(key) ?? '#8d99a6'; }

const legend = computed(() => {
  const used = new Set(materialSamples().map((s) => s.class));
  return (store.dataset?.classes ?? []).filter((c) => used.has(c.key)).map((c) => ({ key: c.key, label: c.label, count: c.count, color: colorOf(c.key) }));
});

function pts() {
  const b = store.basis;
  if (!b?.proj) return [];
  return materialSamples().map((s) => ({ id: s.id, cls: s.class, p: b.proj[indexOf(s.id)] })).filter((r) => r.p);
}
function fit() {
  const el = wrapEl.value;
  const list = pts();
  if (!el || !list.length) return;
  const r = el.getBoundingClientRect();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const { p } of list) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9) * 1.06;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const k = (Math.min(r.width, r.height) / span);
  view.value = { k, fitK: k, px: cx, py: cy, w: r.width, h: r.height };
}
function toScreen(p) { const v = view.value; return [(p.x - v.px) * v.k + v.w / 2, -(p.y - v.py) * v.k + v.h / 2]; }
function toData(sx, sy) { const v = view.value; return { x: (sx - v.w / 2) / v.k + v.px, y: -(sy - v.h / 2) / v.k + v.py }; }

const templatePt = computed(() => {
  const v = templateValues.value;
  return v && v.length && store.basis?.transform ? store.basis.transform(v) : null;
});

function drawStatic() {
  const cv = cvEl.value;
  const v = view.value;
  if (!cv || !v || !store.basis) return;
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(v.w * dpr); cv.height = Math.round(v.h * dpr);
  cv.style.width = `${v.w}px`; cv.style.height = `${v.h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, v.w, v.h);

  const b = store.basis;
  const refIds = new Set(store.refs.map((r) => r.sampleId));
  for (const s of materialSamples()) {
    const i = indexOf(s.id);
    const p = b.proj?.[i];
    if (!p) continue;
    const sp = toScreen(p);
    ctx.fillStyle = colorOf(s.class);
    ctx.globalAlpha = 0.62;
    ctx.fillRect(sp[0] - 1.2, sp[1] - 1.2, 2.4, 2.4);
    ctx.globalAlpha = 1;
  }
  /* 勾选（细环） */
  for (const id of store.checked) {
    const i = indexOf(id); if (i == null) continue;
    const sp = toScreen(b.proj[i]);
    ctx.beginPath(); ctx.arc(sp[0], sp[1], 3.4, 0, Math.PI * 2);
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#0b0b0b'; ctx.stroke();
  }
  /* 素材架（实心 + 深描边） */
  for (const id of refIds) {
    const i = indexOf(id); if (i == null) continue;
    const sp = toScreen(b.proj[i]);
    ctx.beginPath(); ctx.arc(sp[0], sp[1], 4.4, 0, Math.PI * 2);
    ctx.fillStyle = colorOf(store.dataset.samples[i].class); ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#0b0b0b'; ctx.stroke();
  }
  /* 当前（白晕 + 深环） */
  if (store.currentId) {
    const i = indexOf(store.currentId);
    if (i != null) {
      const sp = toScreen(b.proj[i]);
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 6.5, 0, Math.PI * 2);
      ctx.lineWidth = 4.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 6.5, 0, Math.PI * 2);
      ctx.lineWidth = 1.8; ctx.strokeStyle = '#0b0b0b'; ctx.stroke();
    }
  }
}

function paintOverlay() {
  const ov = ovEl.value, cv = cvEl.value, v = view.value;
  if (!ov || !cv || !v) return;
  const ctx = ov.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ov.width = Math.round(v.w * dpr); ov.height = Math.round(v.h * dpr);
  ov.style.width = `${v.w}px`; ov.style.height = `${v.h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);
  ctx.drawImage(cv, 0, 0, v.w, v.h);
  /* 工作模板点：base 位置 → 模板位置的位移（虚线） */
  const pp = templatePt.value;
  const baseId = primaryBaseId();
  if (pp && baseId) {
    const bp = projOf(baseId);
    if (bp) {
      const a = toScreen(bp), c = toScreen(pp);
      ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(235,104,52,0.9)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  if (pp) {
    const c = toScreen(pp);
    ctx.beginPath(); ctx.moveTo(c[0], c[1] - 5); ctx.lineTo(c[0] + 5, c[1]); ctx.lineTo(c[0], c[1] + 5); ctx.lineTo(c[0] - 5, c[1]); ctx.closePath();
    ctx.fillStyle = '#eb6834'; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  const br = brush.value;
  if (br) {
    ctx.fillStyle = 'rgba(42,120,214,0.10)'; ctx.strokeStyle = 'rgba(42,120,214,0.85)'; ctx.lineWidth = 1;
    ctx.fillRect(br.x0, br.y0, br.x1 - br.x0, br.y1 - br.y0);
    ctx.strokeRect(br.x0 + 0.5, br.y0 + 0.5, br.x1 - br.x0, br.y1 - br.y0);
  }
}
function scheduleOverlay() { if (ovRaf) cancelAnimationFrame(ovRaf); ovRaf = requestAnimationFrame(() => { ovRaf = 0; paintOverlay(); }); }

function pos(e) { const r = cvEl.value.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function nearest(sx, sy, r = 9) {
  let best = null, bd = r;
  for (const s of materialSamples()) {
    const i = indexOf(s.id); const p = store.basis.proj?.[i]; if (!p) continue;
    const sp = toScreen(p); const d = Math.hypot(sp[0] - sx, sp[1] - sy);
    if (d < bd) { bd = d; best = s.id; }
  }
  return best;
}
function onDown(e) {
  if (e.button !== 0 || !view.value) return;
  const { x, y } = pos(e);
  if (e.shiftKey) { drag = { mode: 'pan', x, y, px: view.value.px, py: view.value.py }; }
  else { drag = { mode: 'brush', x, y }; brush.value = { x0: x, y0: y, x1: x, y1: y }; }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
function onMove(e) {
  if (!cvEl.value || !view.value) return;
  const { x, y } = pos(e);
  if (drag?.mode === 'brush') { brush.value = { x0: Math.min(drag.x, x), y0: Math.min(drag.y, y), x1: Math.max(drag.x, x), y1: Math.max(drag.y, y) }; hover.value = null; return; }
  if (drag?.mode === 'pan') { const v = view.value; view.value = { ...v, px: drag.px - (x - drag.x) / v.k, py: drag.py + (y - drag.y) / v.k }; return; }
  const id = nearest(x, y);
  hover.value = id ? { x, y, text: `${id} · 类 ${store.dataset.classes.find((c) => c.key === store.dataset.samples[indexOf(id)].class)?.label ?? '?'}` } : null;
}
function onUp(e) {
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
  const d = drag; drag = null;
  if (!d || d.mode !== 'brush') return;
  const b = brush.value; brush.value = null;
  if (!b) return;
  const { x, y } = pos(e);
  if (Math.hypot(x - b.x0, y - b.y0) < 4) { const id = nearest(b.x0, b.y0); if (id) setCurrent(id); return; }
  const p1 = toData(b.x0, b.y0), p2 = toData(b.x1, b.y1);
  const xa = Math.min(p1.x, p2.x), xb = Math.max(p1.x, p2.x), ya = Math.min(p1.y, p2.y), yb = Math.max(p1.y, p2.y);
  let n = 0;
  for (const s of materialSamples()) {
    const i = indexOf(s.id); const p = store.basis.proj?.[i]; if (!p) continue;
    if (p.x >= xa && p.x <= xb && p.y >= ya && p.y <= yb && !store.checked.includes(s.id)) { toggleChecked(s.id); n += 1; }
  }
  toast(n ? `框选勾选 ${n} 条（可在列表里成批加入素材架）` : '框选内没有新的素材样本');
}
function onWheel(e) {
  if (!view.value) return;
  e.preventDefault();
  const { x, y } = pos(e); const v = view.value;
  const before = toData(x, y);
  const k = Math.min(v.fitK * 60, Math.max(v.fitK * 0.08, v.k * Math.exp(-e.deltaY * 0.0015)));
  view.value = { ...v, k };
  const after = toData(x, y);
  view.value = { ...view.value, px: view.value.px + (before.x - after.x), py: view.value.py + (before.y - after.y) };
}

let ro = null;
onMounted(() => {
  fit();
  ro = new ResizeObserver(() => { fit(); drawStatic(); scheduleOverlay(); });
  if (wrapEl.value) ro.observe(wrapEl.value);
});
onBeforeUnmount(() => { ro?.disconnect(); if (ovRaf) cancelAnimationFrame(ovRaf); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); });

let lastBasis = null;
let lastTargetVersion = -1;
watch(
  () => [store.basis, store.targetVersion, store.checked.length, store.refs.length, store.currentId, view.value],
  () => {
    const basisChanged = store.basis !== lastBasis;
    const targetChanged = store.targetVersion !== lastTargetVersion;
    lastBasis = store.basis;
    lastTargetVersion = store.targetVersion;
    if (basisChanged || targetChanged) fit();
    drawStatic(); scheduleOverlay();
  },
  { immediate: true },
);
watchEffect(() => {
  void store.targetVersion; void store.currentId; void store.refs.length; void store.checked.length;
  if (view.value) scheduleOverlay();
});
/* 工作模板点随配方/预览/角色变化而移动；这些变化不一定改变 refs.length，需单独监听。 */
watch(templatePt, () => { if (view.value) scheduleOverlay(); });
</script>

<template>
  <div class="dev structure-surface">
    <div class="dev-head">
      <b>结构面</b>
      <select class="ss-embed" :value="store.basisMethod" :disabled="!!store.basisComputing" title="投影方法（会话内冻结，切换需重算）" @change="setBasisMethod($event.target.value)">
        <option value="pca">PCA</option>
        <option value="tsne">t-SNE</option>
        <option value="umap">UMAP</option>
      </select>
      <span v-if="store.basisComputing" class="ss-computing">{{ store.basisComputing.method }} 计算中… {{ Math.round(store.basisComputing.pct) }}%</span>
      <span class="hint dev-sub">点击 = 选中 · 拖拽/框选 = 批量勾选 · Shift+拖 = 平移 · 滚轮 = 缩放</span>
    </div>
    <div ref="wrapEl" class="ss-wrap">
      <canvas ref="cvEl" class="ss-canvas" @mousedown="onDown" @wheel="onWheel" @dblclick="fit()" @mouseleave="hover = null" />
      <canvas ref="ovEl" class="ss-overlay" aria-hidden="true" />
      <div class="ss-legend">
        <span v-for="c in legend" :key="c.key"><i class="sw" :style="{ background: c.color }" />{{ c.label }}（{{ c.count }}）</span>
        <span><i class="sw" style="box-shadow:0 0 0 1.5px #0b0b0b;background:#2a78d6" />素材架</span>
        <span><i class="sw" style="background:#eb6834;border-radius:0" />工作模板</span>
      </div>
      <div v-if="hover" class="ss-tip" :style="{ left: `${hover.x + 12}px`, top: `${hover.y + 10}px` }">{{ hover.text }}</div>
    </div>
  </div>
</template>
