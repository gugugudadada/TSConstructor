<script setup>
/* 导航列表（副列）：素材样本表——默认序 = ID（唯一中性）· 排序方向由人。
   勾选 = 待入素材架；选中行展开 = 样本仪（内联）。缺类重建时被隐藏类不出现。 */
import { computed, watch, nextTick } from 'vue';
import {
  store, listRows, setListSort, setCurrent, toggleChecked, clearChecked, commitCheckedToRack,
  refsOf, sampleStats, classLabelOf, materialSamples,
} from '../store.js';
import { ui } from '../ui.js';
import SampleInstrument from './SampleInstrument.vue';

const rows = computed(() => listRows());
const total = computed(() => materialSamples().length);
const roleText = (roles) => roles.map((r) => ({ base: '基源', segment: '片段', texture: '纹理' }[r])).join('＋');

function spark(s) {
  const { min, max } = store.yRange; const span = (max - min) || 1; const L = s.values.length; const pts = [];
  for (let k = 0; k < L; k += 4) { const x = 1 + (k / (L - 1)) * 62; const y = 18 - ((s.values[k] - min) / span) * 16; pts.push(`${x.toFixed(1)},${y.toFixed(1)}`); }
  return pts.join(' ');
}
const isSort = (k, d) => store.listSort.key === k && store.listSort.dir === d;
function toggleInspect(id) { setCurrent(id); ui.inspectId = ui.inspectId === id ? null : id; }

watch(() => store.currentId, async (id) => {
  if (!id) return;
  await nextTick();
  document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'nearest' });
});
</script>

<template>
  <div class="dev nav-list">
    <div class="dev-head">
      <b>样本列表</b>
      <span class="hint">{{ rows.length }} / {{ total }} 条素材{{ store.listClass ? `（已按类过滤）` : '' }}</span>
      <span class="hint dev-sub">勾选后可成批加入素材架 · 班级角色可叠加</span>
    </div>
    <div class="nl-bulk">
      <span class="hint">已勾选 <b>{{ store.checked.length }}</b></span>
      <button class="btn xs" :disabled="!store.checked.length" title="把勾选样本加入素材架，角色＝基源（可多选不同旧类）" @click="commitCheckedToRack(['base'])">＋基源</button>
      <button class="btn xs" :disabled="!store.checked.length" title="把勾选样本加入素材架，角色＝片段" @click="commitCheckedToRack(['segment'])">＋片段</button>
      <button class="btn xs" :disabled="!store.checked.length" title="把勾选样本加入素材架，角色＝纹理" @click="commitCheckedToRack(['texture'])">＋纹理</button>
      <button class="btn xs ghost" :disabled="!store.checked.length" @click="clearChecked()">清空勾选</button>
    </div>
    <div class="nl-table-wrap">
      <table class="nl-table">
        <thead>
          <tr>
            <th class="nl-ck"></th>
            <th class="nl-id">ID</th>
            <th>波形</th>
            <th>类</th>
            <th title="逐点二阶差分绝对均值——高频扰动强度">
              粗糙度
              <span class="nl-sort"><button :class="{ on: isSort('roughness', 'asc') }" @click="setListSort('roughness', 'asc')">↑</button><button :class="{ on: isSort('roughness', 'desc') }" @click="setListSort('roughness', 'desc')">↓</button></span>
            </th>
            <th title="中位(后 25 点) − 中位(前 25 点)——尾部电平差">
              尾部差
              <span class="nl-sort"><button :class="{ on: isSort('tailDrop', 'asc') }" @click="setListSort('tailDrop', 'asc')">↑</button><button :class="{ on: isSort('tailDrop', 'desc') }" @click="setListSort('tailDrop', 'desc')">↓</button></span>
            </th>
            <th>角色</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="s in rows" :key="s.id">
            <tr
              :id="`row-${s.id}`"
              :class="{ cur: store.currentId === s.id, inref: !!refsOf(s.id) }"
              @click="toggleInspect(s.id)"
            >
              <td class="nl-ck"><input type="checkbox" :checked="store.checked.includes(s.id)" title="勾选（待入素材架）" @click.stop @change="toggleChecked(s.id)" /></td>
              <td class="nl-id">{{ s.id }}<span v-if="refsOf(s.id)" class="nl-dot" title="已在素材架">●</span></td>
              <td>
                <svg viewBox="0 0 64 20" width="64" height="20" aria-hidden="true"><polyline :points="spark(s)" fill="none" stroke="#52514e" stroke-width="1" /></svg>
              </td>
              <td class="nl-num">{{ classLabelOf(s.class) }}</td>
              <td class="nl-num">{{ (sampleStats(s.id)?.roughness ?? 0).toFixed(3) }}</td>
              <td class="nl-num">{{ (sampleStats(s.id)?.tailDrop ?? 0).toFixed(3) }}</td>
              <td class="nl-num" :title="refsOf(s.id) ? `素材架角色：${roleText(refsOf(s.id).roles)}` : ''">{{ refsOf(s.id) ? roleText(refsOf(s.id).roles) : '—' }}</td>
            </tr>
            <tr v-if="ui.inspectId === s.id" class="nl-expand">
              <td colspan="7"><SampleInstrument :id="s.id" /></td>
            </tr>
          </template>
          <tr v-if="!rows.length"><td colspan="7" class="hint" style="padding:10px">（无匹配样本）</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
