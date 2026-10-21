<script setup>
/* 类分布条：可用素材类（点击 = 过滤列表）· 缺类重建时展示被隐藏的目标类（计数可见、波形不可见）。
   只报数据事实（计数 / 占比），不替用户决定目标模式。 */
import { computed } from 'vue';
import { store, materialClasses, setListClass, classLabelOf, materialSamples } from '../store.js';

const hidden = computed(() => (store.target?.mode === 'missing' ? store.dataset?.classes.find((c) => c.key === store.target.key) ?? null : null));
const mats = computed(() => materialClasses());
const matTotal = computed(() => materialSamples().length);
</script>

<template>
  <div class="class-bar">
    <span class="cb-label">素材类</span>
    <button
      v-for="c in mats" :key="c.key" class="class-chip" :class="{ on: store.listClass === c.key }"
      :title="`类 ${c.label} · ${c.count} 条 · ${(c.ratio * 100).toFixed(1)}%${store.listClass === c.key ? '（再点一次取消过滤）' : '（点击过滤列表）'}`"
      @click="setListClass(c.key)"
    >类 {{ c.label }} · {{ c.count }}</button>
    <span v-if="hidden" class="class-chip hidden" :title="`目标类 ${hidden.label} 的 TRAIN 样本已从素材中隐藏（构造阶段不可用）`">类 {{ hidden.label }} · {{ hidden.count }}（已隐藏）</span>
    <span class="cb-hint">{{ mats.length }} 类可用 · 共 {{ matTotal }} 条</span>
  </div>
</template>
