/* TSC2 Demo · 入口：装载数据集 → 挂载。
   数据集 = 会话身份：`?ds=<id>` 指定；无参数 = 首开（**空容器**：素材架 / 画布 / 配方皆空，目标未设定）。
   可选示例布景：`?seed=1`（把 Wafer「缺陷候选类」的完整构造一次性布置好，便于快速查看）。
   跨数据集保留：DockBar 切换时把生成 seed / 数量写入 `?gseed=&gcount=`，由本文件读回。
   Ctrl+Z = 操作类撤销栈；离开前若有会话产物则确认（无隐式持久化）。 */
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import * as api from './store.js';
import { ui } from './ui.js';
import { euclid, tailDropOf, roughnessOf } from './engine/recipe.js';

window.__t2 = api;   // 走查钩子

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    api.undo();
    e.preventDefault();
  }
});
/* 离开提示：仅在用户真正开始操作后、且存在"用户产物"时提示（布景演示 + 异步嵌入不计） */
let userActive = false;
const markActive = () => { userActive = true; };
window.addEventListener('pointerdown', markActive, { once: true, capture: true });
window.addEventListener('keydown', markActive, { once: true, capture: true });
window.addEventListener('beforeunload', (e) => {
  if (window.__t2SkipGuard) return;   // 走查钩子：允许受控刷新
  if (!userActive) return;
  if (api.store.records.some((r) => r.action !== 'session-init' && !r.seeded)) { e.preventDefault(); e.returnValue = ''; }
});

const params = new URLSearchParams(location.search);
const dsParam = params.get('ds');
const seedDemo = params.get('seed') === '1';   // 显式布景：首开默认空容器
/* 数据集切换时由 DockBar 显式带走：seed / 生成数量（不参与布景 seed=1）。 */
const gSeed = Number(params.get('gseed'));
if (params.get('gseed') != null && Number.isFinite(gSeed)) api.store.seed = gSeed >>> 0;
const gCount = Number(params.get('gcount'));
if (params.get('gcount') != null && Number.isFinite(gCount)) {
  api.store.count = Math.max(1, Math.min(100, Math.round(gCount)));
}
api.init(dsParam ?? undefined).then(() => {
  if (seedDemo) seedScenario();
  createApp(App).mount('#app');
});

/* ── 示例布景（**仅 `?seed=1` 时执行**）：Wafer「缺陷候选类」的完整构造示例 ──
   目标：新建一个"缺陷候选类"（尾部电平下沉 + 高频粗糙度升高）——所有旧类别都可作素材；
   素材：从"正常类"取承载基源、从"稀有/缺陷类"取片段形态与纹理参考（跨旧类别取材）；
   配方：克隆 + 平台压低尾部 + 震荡 + 纹理 + 点拖拽；
   泛化：基源替换 / 源替换 / 参数·锚点·宽度扰动 / 残差注入。
   （目标属性硬约束、指纹钉住、机械拒绝、基线对照 = RQ3，属第二阶段左副列，本阶段不涉及。） */
function seedScenario() {
  const st = api.store;
  if (!st.dataset) return;                          // 数据加载失败时不布置布景
  const classes = st.dataset.classes;               // 已按计数降序
  const common = classes[0].key;                    // 常见类（承载体）
  const rare = classes[classes.length - 1].key;     // 稀有类（形态/纹理供体）

  api.setTargetNew({
    name: '缺陷候选类（新建）',
    desc: `目标模式：尾部电平下沉（缺陷型）+ 高频粗糙度升高。承载取「类 ${api.classLabelOf(common)}」，形态与纹理取「类 ${api.classLabelOf(rare)}」——跨旧类别取材。`,
  });

  /* ── 素材 ── */
  const mats = api.materialSamples();
  const pool = (key) => mats.filter((s) => s.class === key);
  const centroid = (list) => {
    const L = list[0].values.length; const c = new Array(L).fill(0);
    for (const s of list) for (let i = 0; i < L; i++) c[i] += s.values[i];
    for (let i = 0; i < L; i++) c[i] /= list.length; return c;
  };
  const distSort = (list, c) => [...list].sort((a, b) => euclid(a.values, c) - euclid(b.values, c));

  const commonList = distSort(pool(common), centroid(pool(common)));
  const base0 = commonList[0].id;                                    // 最接近类中心 = 代表性承载基源
  const base1 = commonList[Math.floor(commonList.length * 0.40)].id; // 另一承载基源（供"基源替换"泛化）
  const segsSorted = [...pool(rare)].sort((a, b) => tailDropOf(a.values) - tailDropOf(b.values));
  const seg0 = segsSorted[0].id;
  const seg1 = segsSorted[1]?.id ?? seg0;
  const texSorted = [...pool(rare)].filter((s) => s.id !== seg0).sort((a, b) => roughnessOf(b.values) - roughnessOf(a.values));
  const tex0 = texSorted[0]?.id ?? seg0;

  api.addRef(base0, ['base']);
  api.addRef(base1, ['base']);
  api.addRef(seg0, ['segment']);
  api.addRef(seg1, ['segment']);
  api.addRef(tex0, ['texture']);
  api.setCurrent(base0);
  ui.inspectId = base0;

  /* ── 选区（供时间形变 / 组件默认落点） ── */
  api.addRegion([112, 151]);

  /* ── 配方（走公开 API，等价于一次用户编辑会话） ── */
  const last = () => st.steps[st.steps.length - 1];
  api.addTransplant({ source: seg0, srcSpan: [112, 151], dstSpan: [112, 151], alpha: 1, seam: 7 });
  api.setStepVary(last().id, 'width', false);                       // 片段长度保持（长度是结构，不被缩放）
  api.addComponent('plateau');
  api.updateStep(last().id, { anchor: 132, width: 34, amp: -0.5 }); // 压低尾部电平
  api.addComponent('oscillation');
  api.updateStep(last().id, { anchor: 96, width: 48, period: 7, amp: 0.08 });
  api.addTexture({ source: tex0, amount: 0.2, win: 9 });            // 借稀有类纹理的高频残差
  api.setStepVary(last().id, 'pos', false);
  api.setStepVary(last().id, 'width', false);
  api.addDeform({ anchor: 124, width: 7, amp: -0.15 });

  /* ── 生成一批 ── */
  st.count = 24; st.seed = 42;
  api.generateCandidates();
  if (st.candidates.length) api.selectCandidate(st.candidates[0].id);
  api.rec('session-init', `布景已布置：目标「${st.target.name}」· 素材 ${st.refs.length} · 配方 ${st.steps.length} 步 · 候选 ${st.candidates.length}`);
  /* 布景产生的记录标记为"演示预置"：离开页面时不计入"未保存的用户工作" */
  for (const r of st.records) r.seeded = true;
}
