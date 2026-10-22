<script setup>
/* 抽屉（横切层）：记录留痕（demo 内全量）· 帮助（帧与契约）。 */
import { computed } from 'vue';
import { store } from '../store.js';
import { ui } from '../ui.js';

const FAMS = ['全部', 'target', 'refs', 'recipe', 'region', 'generate', 'export', 'basis', 'undo', 'session-init'];
const rows = computed(() => {
  const rs = [...store.records].reverse();
  return ui.recFilter === '全部' ? rs : rs.filter((r) => r.action === ui.recFilter);
});
const TITLES = { records: '记录 / 留痕', help: '帮助 · 帧与契约' };
</script>

<template>
  <aside class="drawer" :class="{ open: !!ui.drawer }">
    <div class="drawer-head">
      <b>{{ TITLES[ui.drawer] || '' }}</b>
      <button class="x" title="关闭" @click="ui.drawer = null">✕</button>
    </div>
    <div class="drawer-body">
      <template v-if="ui.drawer === 'records'">
        <p class="hint">每一次动作都显式留痕（含目标类别版本）；过滤只作用呈现。</p>
        <div class="rec-filters">
          <span class="rf-group">
            <button v-for="f in FAMS" :key="f" class="rec-chip" :class="{ on: ui.recFilter === f }" @click="ui.recFilter = f">{{ f }}</button>
          </span>
        </div>
        <ul class="rec-list">
          <li v-for="r in rows.slice(0, 600)" :key="r.seq"><code>{{ r.t }}</code> <b>{{ r.action }}</b> {{ r.detail }}</li>
          <li v-if="!rows.length" class="hint">（无匹配记录）</li>
          <li v-if="rows.length > 600" class="hint">显示最近 600 / 共 {{ rows.length }}</li>
        </ul>
        <p class="hint" style="color:#b5451f">会话记录随刷新丢失——导出是唯一出口（无隐式持久化）。</p>
      </template>

      <template v-else-if="ui.drawer === 'help'">
        <p class="hint">
          <b>帧</b>：左副列 = 探索与定位（D1）· 右主列 = 编辑与生成（D2–D4：表达 + 泛化）。<br />
          第一阶段完整；阶段②「候选审查与检查」目前提供临时候选查看器，其余 RQ3（判据板 / 质量维度 / 裁决）为占位。
        </p>
        <p class="hint">
          <b>核心对象 = 配方</b>：直接编辑与组件都编译成结构化操作步（对象 / 区间 / 参数 / 源样本 / 可变化维度）。
          生成 = 按泛化轴实例化配方——每条候选携带"为何不同"的差异签名。
        </p>
        <p class="hint">
          <b>三项契约</b>：① 目标类别 = 任务 scope，切换显式、可追（确定 = 重建容器）；<br />
          ② 投影基底按会话冻结（非线性投影为 kNN 近似，会话内不重算）；<br />
          ③ 一切读数走登记口径（粗糙度 / 尾部电平差 / 几何结构计数）。
        </p>
        <p class="hint">
          <b>不静默</b>：不可行与失败都显式记录——配方面板对失败步骤标注原因；素材架/画布状态始终可见。
        </p>
        <p class="hint">
          <b>操作</b>：<span class="kbd">Ctrl+Z</span> 撤销 · 结构面 点击选中 / 拖拽框选 / Shift 平移 / 滚轮缩放 ·
          编辑画布 选区 · 点拖拽（笔宽 = 横向高斯宽度，单位采样点）；时间形变 / 区间擦除 / 幅值平移 / 缩放从「方法」面板加入当前选区。
        </p>
        <p class="hint" style="color:#b5451f">
          隐藏测试集永不进界面；缺类重建时目标类 TRAIN 样本不参与素材选择与规则设计。
        </p>
      </template>
    </div>
  </aside>
</template>
