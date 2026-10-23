<script setup>
/* 方法板（主列）：三类方法——组件 / 编辑 / 素材。
   组件与编辑点击即加入配方（组件落在当前选区或整条；编辑类需要当前选区）。 */
import { computed } from 'vue';
import {
  addComponent, addWarp, addErase, addScale, addShift, addClone, addTexture,
  activeRegion, targetSpan, componentByKey, toast,
} from '../store.js';

const COMPONENT_KEYS = ['pulse', 'plateau', 'trend', 'oscillation', 'noise'];
const components = computed(() => COMPONENT_KEYS.map((key) => componentByKey(key)).filter(Boolean));

function editSpan() {
  return targetSpan() ?? activeRegion()?.span ?? null;
}
function addWarpHere() {
  const span = editSpan();
  if (!span) { toast('时间形变需要当前选区或结构目标'); return; }
  addWarp({ span, factor: 1.1, delta: 0 });
}
function addEraseHere() {
  const span = editSpan();
  if (!span) { toast('区间擦除需要当前选区或结构目标'); return; }
  addErase({ span });
}
function addScaleHere() {
  const span = editSpan();
  if (!span) { toast('缩放需要当前选区或结构目标'); return; }
  addScale({ span, factor: 1.2, feather: 8 });
}
function addShiftHere() {
  const span = editSpan();
  if (!span) { toast('平移需要当前选区或结构目标'); return; }
  addShift({ span, delta: 4, feather: 0 });
}
function addCloneHere() {
  addClone({ dstSpan: activeRegion()?.span ?? null });
}
function addTextureHere() {
  addTexture();
}
</script>

<template>
  <div class="dev palette">
    <div class="dev-head"><b>方法</b><span class="hint dev-sub">点击加入配方</span></div>
    <div class="pal-body">
      <div class="pal-fam">组件</div>
      <button
        v-for="c in components" :key="c.key" class="pal-item"
        :title="`${c.name}——${c.note}（参数：${c.params.map((p) => p.label).join(' / ')}）`"
        @click="addComponent(c.key)"
      >
        <span class="pal-glyph" :style="{ color: c.color }">{{ c.glyph }}</span>
        <span class="pal-name">{{ c.name }}</span>
        <span class="pal-note">{{ c.note }}</span>
      </button>

      <div class="pal-sep" />
      <div class="pal-fam">编辑</div>
      <button class="pal-item" title="在选区内做时间伸缩（改变局部时序 / 持续时间）" @click="addWarpHere()">
        <span class="pal-glyph">⇄</span><span class="pal-name">时间形变</span><span class="pal-note">区间内伸缩</span>
      </button>
      <button class="pal-item" title="用选区两端点做平滑桥接，移除区间内原有形状" @click="addEraseHere()">
        <span class="pal-glyph">⌫</span><span class="pal-name">区间擦除</span><span class="pal-note">两端平滑连接</span>
      </button>
      <button class="pal-item" title="把选区内的波形整体左右平移；羽化 0 = 完全刚体平移" @click="addShiftHere()">
        <span class="pal-glyph">↔</span><span class="pal-name">平移</span><span class="pal-note">区间左右移动</span>
      </button>
      <button class="pal-item" title="在选区内按局部均值缩放幅值（两端余弦羽化）" @click="addScaleHere()">
        <span class="pal-glyph">↕</span><span class="pal-name">缩放</span><span class="pal-note">幅值缩放</span>
      </button>

      <div class="pal-sep" />
      <div class="pal-fam">素材</div>
      <button class="pal-item" title="从副列「片段」列表选源，把源段克隆到当前选区；在小窗拖拽可改源段" @click="addCloneHere()">
        <span class="pal-glyph">⧉</span><span class="pal-name">克隆</span><span class="pal-note">源段 → 落点</span>
      </button>
      <button class="pal-item" title="从副列「纹理」列表选源，借用其高频残差注入全条" @click="addTextureHere()">
        <span class="pal-glyph">⋯</span><span class="pal-name">纹理</span><span class="pal-note">高频残差</span>
      </button>
    </div>
  </div>
</template>
