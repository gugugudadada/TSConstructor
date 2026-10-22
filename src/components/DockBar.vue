<script setup>
/* Dock：横切层——数据集（会话边界）+ 目标类别摘要 + 素材/候选计数 + 撤销 + 记录 + 帮助。 */
import { computed, ref } from 'vue';
import { store, undo, undoDepth, exportCandidates, exportRecipe, importRecipeFile } from '../store.js';
import { ui } from '../ui.js';
import { DATASETS } from '../data/datasets.js';

const targetLabel = computed(() => store.target?.name ?? '—');
const dsName = computed(() => store.datasetName ?? '—');
const canUndo = computed(() => undoDepth() > 0);
const candidateTotal = computed(() => (store.batches.length
  ? store.batches.reduce((n, b) => n + (b.candidates?.length ?? 0), 0)
  : store.candidates.length));
const hasOut = computed(() => candidateTotal.value > 0);

function pickDataset(id) {
  if (id === store.datasetId) return;
  ui.pendingDataset = id;
}
function confirmSwitch() {
  const id = ui.pendingDataset;
  if (!id) return;
  ui.pendingDataset = null;
  /* 数据集切换会重建会话；seed / 生成数量是跨会话保留的设置，随 URL 显式带走。 */
  const seed = Number(store.seed);
  const count = Number(store.count);
  const q = new URLSearchParams({
    ds: id,
    gseed: String(Number.isFinite(seed) ? seed >>> 0 : 42),
    gcount: String(Number.isFinite(count) ? Math.max(1, Math.min(100, Math.round(count))) : 24),
  });
  location.assign(`${location.pathname}?${q.toString()}`);
}
const pendingName = computed(() => DATASETS.find((d) => d.id === ui.pendingDataset)?.name ?? '');
const open = ref(false);
const recipeFileEl = ref(null);

function pickRecipe() {
  recipeFileEl.value?.click();
}
async function onRecipeFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (store.steps.length && !window.confirm(`导入配方会替换当前 ${store.steps.length} 步，继续？`)) return;
  await importRecipeFile(file);
}
</script>

<template>
  <header class="dock">
    <div class="brand">TSConstructor <span class="sub">示例驱动的一维时序类别构造 · Demo（第一阶段）</span></div>

    <span class="ds-wrap">
      <button class="chip" title="切换数据集 = 结束当前会话（显式确认）" @click="open = !open">{{ dsName }} ▾</button>
      <div v-if="open" class="ds-menu">
        <button
          v-for="d in DATASETS" :key="d.id" class="ds-item" :class="{ on: d.id === store.datasetId }"
          @click="open = false; pickDataset(d.id)"
        >{{ d.name }}<span class="hint"> · {{ d.taskHint }}</span></button>
      </div>
    </span>

    <div class="meta">
      <span class="chip plain">目标 {{ targetLabel }}</span>
      <span class="chip plain">素材 <b>{{ store.refs.length }}</b></span>
      <span class="chip plain">配料 <b>{{ store.steps.length }}</b></span>
      <span class="chip plain" title="本会话所有生成批次累计">候选 <b>{{ candidateTotal }}</b></span>
      <button class="chip" :disabled="!canUndo" :title="canUndo ? '撤销上一步（Ctrl+Z）' : '无可撤销操作'" @click="undo()">撤销</button>
      <button class="chip" title="导出候选（含配方 / 差异签名）" :disabled="!hasOut" @click="exportCandidates()">导出候选</button>
      <button class="chip" title="导出当前配方（可复现）" @click="exportRecipe()">导出配方</button>
      <button class="chip" title="导入配方 JSON（替换当前配方；素材源按角色自动重绑）" @click="pickRecipe()">导入配方</button>
      <input ref="recipeFileEl" type="file" accept=".json,application/json" hidden @change="onRecipeFile" />
      <button class="chip" @click="ui.drawer = 'records'">记录 <b>{{ store.records.length }}</b></button>
      <button class="chip" @click="ui.drawer = 'help'">帮助</button>
    </div>
  </header>

  <div v-if="ui.pendingDataset" class="modal-mask">
    <div class="modal-box ds-confirm">
      <div class="modal-head"><b>切换数据集 = 结束当前会话 → {{ pendingName }}</b></div>
      <p class="mnote">
        将丢失（<b>不会自动导出</b>）：素材 {{ store.refs.length }} · 配方步 {{ store.steps.length }}
        · 候选 {{ candidateTotal }} · 记录 {{ store.records.length }}。目标类别 / 容器随会话结束。
      </p>
      <p class="mnote">天然重建（不算损失）：投影基底 · 类分布 · 样本列表。跨会话保留：seed / 生成数量。</p>
      <div class="m-actions">
        <button class="btn sm ghost" @click="ui.pendingDataset = null">取消</button>
        <button class="btn sm primary" @click="confirmSwitch">确认切换</button>
      </div>
    </div>
  </div>
</template>
