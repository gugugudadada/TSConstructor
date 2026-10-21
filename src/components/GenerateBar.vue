<script setup>
/* 生成条（主列）：D4 批量生成——seed 可复现；一候选一差异签名。
   （机械拒绝计数 / 多样性 / 软约束通过率 / 随机增强基线对照 = RQ3「检查与评估」，属第二阶段左副列，本阶段不涉及。） */
import { computed } from 'vue';
import { store, variationGate, generateCandidates, exportAllBatches, toast } from '../store.js';

const gate = computed(() => variationGate());
const lb = computed(() => store.lastBatch);
const total = computed(() => (store.batches.length
  ? store.batches.reduce((n, b) => n + (b.candidates?.length ?? 0), 0)
  : store.candidates.length));
const batchCount = computed(() => store.batches.length || (store.candidates.length ? 1 : 0));

function doGen() {
  const r = generateCandidates();
  if (!r.ok) toast(r.msg);
}
</script>

<template>
  <div class="genbar">
    <span>数量 <input v-model.number="store.count" type="number" min="1" max="100" class="num-in" /></span>
    <span>seed <input v-model.number="store.seed" type="number" class="num-in" /></span>
    <button class="btn primary" :disabled="!gate.ok" :title="gate.ok ? '按泛化控制实例化配方 → 一候选一差异签名' : gate.msg" @click="doGen()">生成候选 ×{{ store.count }}</button>
    <button class="btn" :disabled="!total" title="把所有批次的候选合并导出为一个 JSON（供 1NN 脚本直接当训练集）" @click="exportAllBatches()">导出全部批次</button>
    <span v-if="!gate.ok" class="hint bad">{{ gate.msg }}</span>

    <span v-if="lb" class="hint gen-note">
      批 #{{ lb.id }} · 产出 <b>{{ lb.generated }}</b> / {{ lb.count }}（seed {{ lb.seed }}） · 累计 {{ total }} 条 / {{ batchCount }} 批
    </span>
  </div>
</template>
