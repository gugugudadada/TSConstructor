/* 数据集登记表（Demo · 第一阶段）。
   🔴 只列 TRAIN / 可用侧——测试集永不进界面（评估脚本专用；与 v4 的 honor 条款一致）。
   说明：本 demo 的"缺类重建"实验在界面内**隐藏**目标类样本（不参与素材选择与规则设计）；
   是否导出隐藏类用于离线评估由用户显式选择，界面上明确标注"仅评估"。 */
export const DATASETS = [
  {
    id: 'wafer',
    name: 'Wafer · TRAIN',
    short: 'Wafer',
    file: '/data/Wafer_TRAIN.txt',
    defaultClass: '-1.0000000e+00',   // 稀有类（97 / 903）——缺类重建的天然起点
    defaultBasis: 'tsne',
    taskHint: '目标类稀有：缺陷型（-1）样本在全量中仅 97 条',
  },
  {
    id: 'ecg',
    name: 'ECG5000 · TRAIN',
    short: 'ECG5000',
    file: '/data/ECG5000_TRAIN.txt',
    defaultClass: '4',                 // 类 4 为次稀少类，便于跨类取材演示
    defaultBasis: 'tsne',
    taskHint: '五类心拍：可用多类作为跨类素材（演示"从不同旧类别取材"）',
  },
];
