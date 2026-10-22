<script setup>
/* 泛化控制（主列）：明确"哪些维度变化、哪些保持"（D4）。
   轴 = 基源替换（换谁承载）/ 片段与纹理源替换（换谁供材）/ 参数扰动 / 区间平移 / 区间长度 / 残差注入。
   🔴 seed 只保证可复现，不等于有足够多样性；此处只声明"哪些维度可变"，实际变化核对在下方。 */
import { computed } from 'vue';
import { store } from '../store.js';

const a = computed(() => store.axes);
const lastAxes = computed(() => store.lastBatch?.axisCounts ?? null);
function note() {
  const bits = [];
  if (a.value.source) bits.push('基源替换');
  if (a.value.segment) bits.push('片段/纹理源替换');
  if (a.value.param > 0) bits.push(`参数扰动 ±${(a.value.param * 100).toFixed(0)}%`);
  if (a.value.anchor > 0) bits.push(`区间平移 ±${a.value.anchor} 点`);
  if (a.value.width > 0) bits.push(`区间长度 ±${(a.value.width * 100).toFixed(0)}%`);
  if (a.value.residual > 0) bits.push(`残差注入 ≤${a.value.residual.toFixed(2)}σ`);
  return bits.length ? bits.join(' · ') : '（当前全部锁定——候选将逐位相同，不可行于多样性）';
}
</script>

<template>
  <div class="dev vary">
    <div class="dev-head"><b>泛化控制</b><span class="hint dev-sub">哪些维度可变</span></div>
    <div class="va-body">
      <label class="va-chk" title="基源替换：在不同「基源」样本上执行同一配方（需要 ≥2 个基源）">
        <input v-model="store.axes.source" type="checkbox" /> 基源替换（换谁承载）
      </label>
      <label class="va-chk" title="片段 / 纹理源替换：克隆与纹理改从其它「片段」「纹理」参考取材（需要 ≥2 个供体）">
        <input v-model="store.axes.segment" type="checkbox" /> 片段 / 纹理源替换（换谁供材）
      </label>

      <div class="va-row">
        <span class="va-label">参数扰动</span>
        <input v-model.number="store.axes.param" type="range" min="0" max="0.5" step="0.01" />
        <span class="va-val">±{{ Math.round(a.param * 100) }}%</span>
      </div>
      <div class="va-row">
        <span class="va-label">区间平移</span>
        <input v-model.number="store.axes.anchor" type="range" min="0" max="12" step="1" />
        <span class="va-val">±{{ a.anchor }}</span>
      </div>
      <div class="va-row">
        <span class="va-label">区间长度</span>
        <input v-model.number="store.axes.width" type="range" min="0" max="0.5" step="0.01" />
        <span class="va-val">±{{ Math.round(a.width * 100) }}%</span>
      </div>
      <div class="va-row">
        <span class="va-label">残差注入</span>
        <input v-model.number="store.axes.residual" type="range" min="0" max="0.3" step="0.01" />
        <span class="va-val">{{ a.residual.toFixed(2) }}σ</span>
      </div>

      <div class="va-note">当前声明：{{ note() }}</div>
      <div v-if="lastAxes" class="va-note">
        上一批实际：基源换 {{ lastAxes.baseSwap }} · 源换 {{ lastAxes.segSwap }} · 参数 {{ lastAxes.param }} · 区间平移 {{ lastAxes.anchor }} · 区间长度 {{ lastAxes.width }} · 残差 {{ lastAxes.residual }}
      </div>
    </div>
  </div>
</template>
