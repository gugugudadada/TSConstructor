<script setup>
/* 帧（Demo · 第一阶段）：两列——
   左副列（窄）：阶段 ① 探索与定位（已实现）/ ② 候选审查与检查（临时候选查看器；其余 RQ3 占位）；
   右主列（宽）：编辑与生成（D2–D4：表达 + 泛化），恒在。
   每个装置一个槽位（.slot），装置自身滚动兜底。 */
import { computed } from 'vue';
import { store, primaryBaseId, sampleOf, classLabelOf, stepLabel } from './store.js';
import { ui } from './ui.js';
import DockBar from './components/DockBar.vue';
import TargetPanel from './components/TargetPanel.vue';
import ClassBar from './components/ClassBar.vue';
import StructureSurface from './components/StructureSurface.vue';
import ReferenceRack from './components/ReferenceRack.vue';
import NavList from './components/NavList.vue';
import EditCanvas from './components/EditCanvas.vue';
import CandidateViewer from './components/CandidateViewer.vue';
import ComponentPalette from './components/ComponentPalette.vue';
import RecipePanel from './components/RecipePanel.vue';
import VariationPanel from './components/VariationPanel.vue';
import GenerateBar from './components/GenerateBar.vue';
import RecordDrawer from './components/RecordDrawer.vue';

const baseId = computed(() => primaryBaseId());
const baseCls = computed(() => classLabelOf(sampleOf(baseId.value)?.class));
const stepNames = computed(() => store.steps.map((s) => stepLabel(s)).join(' → ') || '（空）');
</script>

<template>
  <DockBar />

  <main class="w4">
    <!-- ═ 左副列（窄）：内容随阶段切换 ═ -->
    <section class="col-side">
      <div class="phase-bar">
        <span class="pb-label">阶段</span>
        <button class="phase-btn" :class="{ on: ui.phase === 1 }" @click="ui.phase = 1">① 探索与定位</button>
        <button class="phase-btn" :class="{ on: ui.phase === 2 }" @click="ui.phase = 2">② 候选审查与检查</button>
        <span class="pb-hint hint">{{ ui.phase === 1 ? 'D1 · 目标类别 + 跨类素材' : '占位（本阶段不实现）' }}</span>
      </div>

      <template v-if="ui.phase === 1">
        <div class="slot s-target"><TargetPanel /></div>
        <div class="slot s-bars"><ClassBar /></div>
        <div class="slot s-plane"><StructureSurface /></div>
        <div class="slot s-rack"><ReferenceRack /></div>
        <div class="slot s-list"><NavList /></div>
      </template>

      <template v-else>
        <div class="slot" style="flex:1 1 auto">
          <CandidateViewer />
        </div>
      </template>
    </section>

    <!-- ═ 右主列（宽）：编辑与生成，恒在 ═ -->
    <section class="col-main">
      <div class="slot s-srcbar">
        <div class="srcbar4" style="display:flex;align-items:center;gap:8px;padding:5px 10px;background:var(--panel);border:1px solid var(--line);border-radius:6px;font-size:12px">
          <span style="color:var(--muted)">工作模板</span>
          <b v-if="baseId">基源 {{ baseId }}<span class="hint"> · 类 {{ baseCls }}</span></b>
          <b v-else class="hint">未指定基源</b>
          <span class="hint">配方：{{ stepNames }}</span>
          <span class="hint" style="margin-left:auto">目标：{{ store.target?.name ?? '—' }}</span>
          <button v-if="!baseId" class="btn sm" @click="ui.phase = 1">去副列取材 ▸</button>
        </div>
      </div>

      <div class="slot s-canvas"><EditCanvas /></div>

      <div class="slot s-tools">
        <div class="s-toolsrow">
          <ComponentPalette />
          <RecipePanel />
        </div>
      </div>

      <div class="slot s-vary"><VariationPanel /></div>

      <div class="slot s-gen"><GenerateBar /></div>
    </section>
  </main>

  <RecordDrawer />

  <div v-if="store.loadError" class="modal-mask">
    <div class="modal-box"><div class="modal-head"><b>数据加载失败</b></div><p class="mnote">{{ store.loadError }}</p></div>
  </div>

  <div v-if="store.toast" class="toast-pop" role="status">{{ store.toast }}</div>
</template>
