import { reactive } from 'vue';

/* 帧级 UI 状态（非任务状态）——只影响"哪一列显示什么"与瞬态弹层。
   一帧两列：左副列 = 探索与定位（D1，随阶段切换）；右主列 = 编辑与生成（D2–D4，恒在）。
   本 demo 第一阶段完整；阶段②目前只有临时候选查看器，其余 RQ3 仍为占位（工作留痕：见 docs/IDEA_A）。 */
export const ui = reactive({
  phase: 1,              // 副列：1 = ① 探索与定位；2 = ② 候选审查与检查（临时查看器）
  targetModal: false,    // 目标类别构建 / 缺类重建弹窗
  targetTab: 'new',      // 弹窗页签：'new' | 'missing'
  inspectId: null,       // 副列列表内联展开的样本 id
  drawer: null,          // null | 'records' | 'help'
  pendingDataset: null,  // 待确认的数据集切换（会话边界）
  recFilter: '全部',     // 记录抽屉的族过滤
});
