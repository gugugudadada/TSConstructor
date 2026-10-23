<script setup>
/* 配方面板（主列）：有序操作步 = 透明、可复用、可修改的构造规则（D3）。
   每步 = 对象 + 区间 + 参数 + 源样本 + 可变化维度（vary）；不写最终数组。 */
import { computed } from 'vue';
import {
  store, componentByKey, updateStep, setStepVary, removeStep, toggleStepEnabled, moveStep,
  duplicateStep, clearSteps, selectStep, stepLabel, segmentRefs, textureRefs, activeRegion, toast,
  regionNameOfSpan,
} from '../store.js';

const LEN = computed(() => store.length);
const segPool = computed(() => {
  const ids = segmentRefs().map((r) => r.sampleId);
  for (const s of store.steps) {
    if (s.kind === 'transplant' && s.source && !ids.includes(s.source)) ids.push(s.source);
  }
  return ids;
});
const texPool = computed(() => {
  const ids = textureRefs().map((r) => r.sampleId);
  for (const s of store.steps) {
    if (s.kind === 'texture' && s.source && !ids.includes(s.source)) ids.push(s.source);
  }
  return ids;
});

function paramsFor(step) {
  if (step.kind === 'component') {
    const def = componentByKey(step.component);
    if (!def) return [];
    return def.params.filter((p) => step[p.key] != null);
  }
  if (step.kind === 'deform') {
    return [
      { key: 'anchor', label: '锚点', min: 0, max: LEN.value - 1, step: 1 },
      { key: 'width', label: '宽度', min: 1, max: 60, step: 1 },
      { key: 'amp', label: '强度', min: -3, max: 3, step: 0.01 },
    ];
  }
  if (step.kind === 'warp') return [{ key: 'factor', label: '伸缩', min: 0.8, max: 1.25, step: 0.005 }, { key: 'delta', label: '位移', min: -12, max: 12, step: 1 }];
  if (step.kind === 'transplant') return [{ key: 'alpha', label: '混合', min: 0, max: 1, step: 0.02 }, { key: 'seam', label: '接缝', min: 1, max: 20, step: 1 }];
  if (step.kind === 'erase') return [];
  if (step.kind === 'shift') {
    const max = Math.max(1, Math.abs((step.span?.[1] ?? 1) - (step.span?.[0] ?? 0)));
    return [{ key: 'delta', label: '位移', min: -max, max, step: 1 }, { key: 'feather', label: '羽化', min: 1, max: 20, step: 1 }];
  }
  if (step.kind === 'scale') return [{ key: 'factor', label: '缩放', min: 0.5, max: 2, step: 0.01 }, { key: 'feather', label: '羽化', min: 1, max: 20, step: 1 }];
  if (step.kind === 'texture') return [{ key: 'amount', label: '强度', min: 0, max: 1.5, step: 0.02 }, { key: 'win', label: '趋势窗', min: 3, max: 31, step: 2 }];
  return [];
}
const VARY_PARTS = [['pos', '位'], ['width', '宽'], ['amp', '强'], ['src', '源']];
function varyApplies(step, part) {
  if (step.kind === 'component') {
    if (part === 'src') return false;
    if (part === 'amp') return true;
    return part === 'pos' || part === 'width';
  }
  if (step.kind === 'texture') return part === 'src' || part === 'amp';
  if (part === 'src') return step.kind === 'transplant';
  if (part === 'width') return ['deform', 'warp', 'transplant'].includes(step.kind);
  if (part === 'amp') return ['deform', 'transplant', 'scale'].includes(step.kind);
  return ['deform', 'warp', 'transplant', 'erase', 'scale', 'shift'].includes(step.kind);
}
function spanLabel(span) {
  if (!Array.isArray(span)) return '整条';
  const name = regionNameOfSpan(span);
  if (name) return name;
  if (span[0] === 0 && span[1] === LEN.value - 1) return '整条';
  return `${span[0]}–${span[1]}`;
}
function scopeText(step) {
  if (step.kind === 'component') return spanLabel(step.span);
  if (step.kind === 'deform') return `t=${Math.round(step.anchor)}`;
  if (step.kind === 'warp' || step.kind === 'erase' || step.kind === 'scale' || step.kind === 'shift') return spanLabel(step.span);
  if (step.kind === 'texture') return '全条';
  if (step.kind === 'transplant') return `落点 ${step.dstSpan ? spanLabel(step.dstSpan) : `@${step.dstStart}`}`;
  return '';
}
function stepHint(step) {
  if (step.kind === 'transplant') return `克隆源 ${step.source} [${step.srcSpan[0]}–${step.srcSpan[1]}]`;
  if (step.kind === 'texture') return `纹理源 ${step.source ?? '（未指定）'}`;
  if (step.kind === 'erase') return '两端点平滑连接';
  if (step.kind === 'shift') return `位移 ${Number(step.delta ?? 0) >= 0 ? '+' : ''}${Math.round(Number(step.delta ?? 0))} 点`;
  if (step.kind === 'scale') return `×${Number(step.factor ?? 1).toFixed(2)}`;
  return '';
}
function pickDstFromRegion(step) {
  const r = activeRegion();
  if (!r) { toast('先划一个选区作为克隆落点'); return; }
  updateStep(step.id, { dstSpan: [...r.span], dstStart: null });
}
function setSrcPool(step, e) { updateStep(step.id, { source: e.target.value }); }
</script>

<template>
  <div class="dev recipe">
    <div class="dev-head">
      <b>配方（操作步）</b>
      <span class="hint dev-sub">{{ store.steps.length }} 步 · 执行序 = 列表序</span>
      <button class="btn xs ghost" style="margin-left:auto" :disabled="!store.steps.length" @click="clearSteps()">清空</button>
    </div>
    <div class="rc-body">
      <div v-if="!store.steps.length" class="rc-empty">
        配方为空——在左侧「方法」点入一个方法，或在编辑画布上直接拖拽/划选区。
        每一次操作都会编译成一条结构化操作步（可改参数、可声明可变化维度、可复现）。
      </div>
      <div
        v-for="(s, i) in store.steps" :key="s.id" class="pl-item"
        :class="{ sel: store.selectedStepId === s.id, off: s.enabled === false }" @click="selectStep(s.id)"
      >
        <div class="pl-head">
          <span class="pl-ord">{{ i + 1 }}</span>
          <span class="pl-name">{{ stepLabel(s) }}</span>
          <span class="pl-scope">{{ scopeText(s) }}</span>
          <span v-if="stepHint(s)" class="pl-scope" :title="stepHint(s)">· {{ stepHint(s) }}</span>
          <span class="pl-acts">
            <button :title="s.enabled === false ? '启用该步' : '停用该步（保留在配方中）'" @click.stop="toggleStepEnabled(s.id)">{{ s.enabled === false ? '○' : '●' }}</button>
            <button title="上移" @click.stop="moveStep(s.id, -1)">↑</button>
            <button title="下移" @click.stop="moveStep(s.id, 1)">↓</button>
            <button title="复制该步" @click.stop="duplicateStep(s.id)">⧉</button>
            <button title="移出该步" @click.stop="removeStep(s.id)">✕</button>
          </span>
        </div>

        <!-- 克隆 / 纹理源 -->
        <div v-if="s.kind === 'transplant' || s.kind === 'texture'" class="pl-src">
          <span>{{ s.kind === 'transplant' ? '克隆源' : '纹理源' }}</span>
          <select :value="s.source ?? ''" @click.stop @change="setSrcPool(s, $event)">
            <option value="" disabled>选择{{ s.kind === 'transplant' ? '片段' : '纹理' }}源…</option>
            <option v-for="id in (s.kind === 'transplant' ? segPool : texPool)" :key="id" :value="id">{{ id }}</option>
          </select>
          <template v-if="s.kind === 'transplant'">
            <span>落点 {{ s.dstSpan ? spanLabel(s.dstSpan) : `@${s.dstStart}` }}</span>
            <button class="btn xs ghost" @click.stop="pickDstFromRegion(s)">落点 = 当前选区</button>
          </template>
        </div>
        <!-- 参数滑条 -->
        <div v-for="p in paramsFor(s)" :key="p.key" class="pl-param">
          <span class="pl-label">{{ p.label }}</span>
          <span class="pl-track-wrap">
            <input
              class="pl-slider" type="range" :min="p.min" :max="p.max" :step="p.step" :value="s[p.key]"
              @click.stop @input="updateStep(s.id, { [p.key]: Number($event.target.value) })"
            />
          </span>
          <span class="pl-val">{{ Number(s[p.key]).toFixed(p.step >= 1 ? 0 : 2) }}</span>
        </div>

        <!-- 可变化维度 -->
        <div class="pl-vary">
          <span class="pl-vl">生成时可变：</span>
          <button
            v-for="[part, name] in VARY_PARTS" :key="part"
            v-show="varyApplies(s, part)" :class="{ on: (s.vary ?? {})[part] }"
            :title="`${name} 维度允许在生成时变化（否则锁定）`" @click.stop="setStepVary(s.id, part, !(s.vary ?? {})[part])"
          >{{ name }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
