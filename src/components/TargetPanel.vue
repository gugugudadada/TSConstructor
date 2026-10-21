<script setup>
/* 目标类别卡（副列顶）：任务 scope 的显式声明 + 两种入口（新建类别 / 缺类重建）。
   🔴 目标模式只能由人声明——系统不自动决定目标，也不静默替换目标。
   （目标属性 / 保留约束 / 判据 = RQ3「检查与裁决」，属第二阶段左副列，本阶段不涉及。） */
import { computed, ref } from 'vue';
import { store, setTargetNew, setTargetMissing, classLabelOf, toast } from '../store.js';
import { ui } from '../ui.js';
import { DATASETS } from '../data/datasets.js';

const modeText = computed(() => (!store.target ? '未设定' : store.target.mode === 'missing' ? '缺类重建' : '新建类别'));

/* ── 弹窗本地草稿 ── */
const draft = ref({ name: '', desc: '', cls: '' });
const allClasses = computed(() => store.dataset?.classes ?? []);
const defaultCls = computed(() => {
  const def = DATASETS.find((d) => d.id === store.datasetId)?.defaultClass;
  if (def != null) {
    /* 数据文件里的类 token 可能是 `4.0000000e+00`，而登记表写的是 `4`；按数值再匹配一次。 */
    const numDef = Number(def);
    const found = allClasses.value.find((c) => c.key === def
      || (Number.isFinite(numDef) && Number.isFinite(Number(c.key)) && Number(c.key) === numDef));
    if (found) return found.key;
  }
  return allClasses.value[allClasses.value.length - 1]?.key ?? '';
});

function openModal(tab) {
  ui.targetTab = tab;
  draft.value = {
    name: tab === 'new' ? '缺陷候选类（新建）' : '',
    desc: tab === 'new' ? '用户新建的目标类别：所有旧类别都可作为参考素材（跨类取材）。' : '',
    cls: store.target?.mode === 'missing' ? store.target.key : defaultCls.value,
  };
  ui.targetModal = true;
}
function confirm() {
  const d = draft.value;
  if (ui.targetTab === 'new') {
    if (!d.name.trim()) { toast('请填写目标类别名称'); return; }
    setTargetNew({ name: d.name.trim(), desc: d.desc.trim() });
  } else {
    if (!d.cls) { toast('请选择要隐藏/重建的类别'); return; }
    setTargetMissing(d.cls);
  }
  ui.targetModal = false;
}
</script>

<template>
  <div class="dev">
    <div class="dev-head"><b>目标类别（任务 scope）</b><span class="hint">D1 · 构造阶段不使用该类隐藏样本</span></div>
    <div class="tcard">
      <div class="tc-top">
        <span class="tc-mode" :class="store.target?.mode">{{ modeText }}</span>
        <span class="tc-name">{{ store.target?.name ?? '（未设定）' }}</span>
        <span class="tc-actions">
          <button class="btn xs" @click="openModal('new')">新建类别…</button>
          <button class="btn xs ghost" @click="openModal('missing')">缺类重建…</button>
        </span>
      </div>
      <div class="tc-desc">{{ store.target?.desc }}</div>
    </div>
  </div>

  <div v-if="ui.targetModal" class="modal-mask" @click.self="ui.targetModal = false">
    <div class="modal-box">
      <div class="modal-head">
        <b>目标类别</b>
        <span class="mtabs">
          <button class="mtab" :class="{ on: ui.targetTab === 'new' }" @click="ui.targetTab = 'new'">新建类别</button>
          <button class="mtab" :class="{ on: ui.targetTab === 'missing' }" @click="ui.targetTab = 'missing'">缺类重建</button>
        </span>
        <button class="modal-x" @click="ui.targetModal = false">✕</button>
      </div>

      <template v-if="ui.targetTab === 'new'">
        <p class="mnote">新建一个目标类别：<b>所有旧类别</b>都可作为参考素材（示范"从不同旧类别取材"）。系统不自动决定目标模式。</p>
        <div class="mrow"><label>类别名</label><input v-model="draft.name" type="text" placeholder="例如：缺陷候选类（新建）" /></div>
        <div class="mrow"><label>领域说明</label><input v-model="draft.desc" type="text" placeholder="目标模式的语义（供追溯，不用于自动推断）" /></div>
      </template>

      <template v-else>
        <p class="mnote">
          选定一个已有类别作为"目标语义"，其 TRAIN 样本将从素材中<b>隐藏</b>（不参与源样本选择 / 参数调整 / 规则设计）。
          界面只显示"该类的语义与计数"，不显示波形点。
        </p>
        <div class="mrow">
          <label>目标类</label>
          <select v-model="draft.cls">
            <option v-for="c in allClasses" :key="c.key" :value="c.key">类 {{ c.label }}（{{ c.count }} 条 · {{ (c.ratio * 100).toFixed(1) }}%）</option>
          </select>
        </div>
      </template>

      <div class="m-actions">
        <button class="btn sm ghost" @click="ui.targetModal = false">取消</button>
        <button class="btn sm primary" @click="confirm">确定（重建容器）</button>
      </div>
      <p class="mnote">确定 = 显式重建容器：素材 / 配方 / 候选 / 选区全部清空（记录保留留痕）。</p>
    </div>
  </div>
</template>
