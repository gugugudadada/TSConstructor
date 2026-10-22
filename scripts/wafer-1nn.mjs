/* Wafer 端到端 1NN 训练 + 测试（无第三方依赖）。
 *
 * 默认模式：
 *   1) 全量训练：Wafer_TRAIN 全部 1000 条；
 *   2) 仅正常类训练：Wafer_TRAIN 中 label = 1.0000000e+00 的 903 条；
 *   两者都用 Wafer_TEST 全量 6164 条测试。
 *
 * 自定义模式：
 *   训练 = Wafer_TRAIN 中非稀有类 + 导出 JSON 全部候选（全部标为稀有类）；
 *   原始 Wafer_TRAIN 的稀有类不参与训练；测试 = Wafer_TEST 全量。
 *
 * 1NN = 原始值欧氏距离，不做归一化、不重采样。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const DEFAULT_TRAIN_DATA = resolve(root, 'public/data/Wafer_TRAIN.txt');
const DEFAULT_TEST_DATA = resolve(root, 'public/data/Wafer_TEST.txt');
const DEFAULT_RARE_LABEL = '-1.0000000e+00';
const DEFAULT_NORMAL_LABEL = '1.0000000e+00';

function parseArgs(argv) {
  const out = {
    train: 'default',
    trainData: DEFAULT_TRAIN_DATA,
    testData: DEFAULT_TEST_DATA,
    rareLabel: DEFAULT_RARE_LABEL,
    normalLabel: DEFAULT_NORMAL_LABEL,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a === '--train') out.train = argv[++i];
    else if (a === '--train-data') out.trainData = resolve(argv[++i]);
    else if (a === '--test-data') out.testData = resolve(argv[++i]);
    else if (a === '--rare-label') out.rareLabel = String(argv[++i]);
    else if (a === '--normal-label') out.normalLabel = String(argv[++i]);
    else throw new Error(`未知参数：${a}（用 --help 查看）`);
  }
  return out;
}

function usage() {
  console.log(`Wafer 1NN 端到端测试

默认模式（输出两份结果）：
  npm run test:wafer
  - 全量训练：Wafer_TRAIN 全部 1000 条
  - 仅正常类：仅 label=1.0000000e+00 的 903 条
  - 测试：Wafer_TEST 全量 6164 条

自定义稀有类增强模式（单份结果）：
  npm run test:wafer:custom
  npm run test:wafer -- --train scripts/wafer_test/xxxx.json
  - 训练：Wafer_TRAIN 非稀有类 + JSON 全部候选（标为稀有类）
  - 原始稀有类排除；测试仍为 Wafer_TEST 全量

选项：
  --train default|<export.json>  训练模式；默认 default
  --train-data <file>           原始训练集
  --test-data <file>            原生测试集
  --rare-label <label>          自定义候选的稀有类（默认 -1.0000000e+00）
  --normal-label <label>        默认模式“仅正常类”的标签（默认 1.0000000e+00）
  --json                        输出机器可读 JSON（供 suite 使用）
  -h, --help
`);
}

function parseUcr(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const label = parts[0];
    const values = parts.slice(1).map(Number);
    if (values.some((v) => !Number.isFinite(v))) continue;
    rows.push({ label, values });
  }
  return rows;
}

function euclid(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function nearest1nn(x, train) {
  let best = null;
  let bestD = Infinity;
  for (const s of train) {
    const d = euclid(x, s.values);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function loadExport(path) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  let candidates = Array.isArray(doc.candidates) ? doc.candidates : [];
  if (!candidates.length && Array.isArray(doc.batches)) {
    candidates = doc.batches.flatMap((b) => (Array.isArray(b.candidates) ? b.candidates : []));
  }
  if (!candidates.length) throw new Error(`导出文件里没有 candidates：${path}`);
  return { doc, candidates };
}

function countLabels(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.label, (m.get(r.label) ?? 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function classifyTable(test, train) {
  const rows = [];
  for (const t of test) {
    const hit = nearest1nn(t.values, train);
    rows.push({ truth: t.label, pred: hit?.label ?? '∅' });
  }
  return rows;
}

function report(rows) {
  const labels = [...new Set(rows.flatMap((r) => [r.truth, r.pred]))].sort();
  const cm = Object.fromEntries(labels.map((a) => [a, Object.fromEntries(labels.map((b) => [b, 0]))]));
  for (const r of rows) cm[r.truth][r.pred] += 1;
  const correct = rows.filter((r) => r.truth === r.pred).length;
  const acc = rows.length ? correct / rows.length : 0;
  const per = labels.map((label) => {
    let tp = 0, fp = 0, fn = 0;
    for (const r of rows) {
      if (r.truth === label && r.pred === label) tp += 1;
      else if (r.truth !== label && r.pred === label) fp += 1;
      else if (r.truth === label && r.pred !== label) fn += 1;
    }
    const p = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    const f1 = p + rec ? (2 * p * rec) / (p + rec) : 0;
    const support = rows.filter((r) => r.truth === label).length;
    return { label, precision: p, recall: rec, f1, support };
  });
  const macroF1 = per.length ? per.reduce((s, x) => s + x.f1, 0) / per.length : 0;
  return { acc, correct, total: rows.length, macroF1, per, cm, labels };
}

function fmtPct(x) { return `${(x * 100).toFixed(2)}%`; }

const args = parseArgs(process.argv.slice(2));
if (args.help) { usage(); process.exit(0); }
const isCustom = args.train !== 'default';

const rawTrain = parseUcr(readFileSync(args.trainData, 'utf8'));
const rawTest = parseUcr(readFileSync(args.testData, 'utf8'));
if (!rawTrain.length) throw new Error(`训练集为空：${args.trainData}`);
if (!rawTest.length) throw new Error(`测试集为空：${args.testData}`);
const allLengths = new Set([...rawTrain, ...rawTest].map((r) => r.values.length));
if (allLengths.size !== 1) throw new Error(`训练/测试样本长度不一致：${[...allLengths].join(', ')}`);
const L = rawTrain[0].values.length;
const testCounts = countLabels(rawTest);

const runs = [];
if (!isCustom) {
  runs.push({
    key: 'default-full',
    title: '默认 / 全量训练',
    sourceInfo: 'Wafer_TRAIN 全量',
    trainRows: rawTrain.map((r) => ({ values: r.values, label: r.label })),
  });
  const normalRows = rawTrain.filter((r) => r.label === args.normalLabel);
  if (!normalRows.length) throw new Error(`默认正常类标签没有样本：${args.normalLabel}`);
  runs.push({
    key: 'default-normal-only',
    title: `默认 / 仅标签 ${args.normalLabel}`,
    sourceInfo: `Wafer_TRAIN 仅 ${args.normalLabel}`,
    trainRows: normalRows.map((r) => ({ values: r.values, label: r.label })),
  });
} else {
  const exportPath = resolve(args.train);
  const loaded = loadExport(exportPath);
  const rareLabel = args.rareLabel;
  const normal = rawTrain.filter((r) => r.label !== rareLabel);
  if (!normal.length) throw new Error(`原始训练集中没有非稀有类样本（稀有标签 ${rareLabel}）`);
  const generated = loaded.candidates.map((c) => {
    if (!Array.isArray(c.values) || c.values.length !== L) {
      throw new Error(`候选 ${c.id ?? '?'} 的 values 长度不是 ${L}`);
    }
    return { values: c.values.map(Number), label: rareLabel };
  });
  runs.push({
    key: `custom:${basename(exportPath)}`,
    title: `自定义 / ${basename(exportPath)}`,
    sourceInfo: `正常类 ${normal.length} 条 + 增强稀有类 ${generated.length} 条；原始稀有类排除 ${rawTrain.length - normal.length} 条`,
    trainRows: [...normal.map((r) => ({ values: r.values, label: r.label })), ...generated],
    exportPath,
    generatedCount: generated.length,
  });
}

const results = runs.map((run) => {
  const t0 = performance.now();
  const rows = classifyTable(rawTest, run.trainRows);
  const elapsedMs = performance.now() - t0;
  const r = report(rows);
  return {
    key: run.key,
    title: run.title,
    sourceInfo: run.sourceInfo,
    trainCount: run.trainRows.length,
    trainCounts: countLabels(run.trainRows),
    testCount: rawTest.length,
    testCounts,
    acc: r.acc,
    correct: r.correct,
    total: r.total,
    macroF1: r.macroF1,
    per: r.per,
    cm: r.cm,
    labels: r.labels,
    elapsedMs,
    ...(run.exportPath ? { exportPath: run.exportPath, generatedCount: run.generatedCount } : {}),
  };
});

if (args.json) {
  const payload = {
    mode: isCustom ? 'custom' : 'default',
    trainData: args.trainData,
    testData: args.testData,
    length: L,
    testCount: rawTest.length,
    testCounts,
    normalLabel: args.normalLabel,
    rareLabel: args.rareLabel,
    results,
  };
  console.log(JSON.stringify(payload));
} else {
  console.log(`模式        : ${isCustom ? 'custom' : 'default'}`);
  console.log(`训练数据    : ${args.trainData}`);
  console.log(`测试数据    : ${args.testData}`);
  console.log(`样本长度    : ${L}`);
  console.log(`测试集      : ${rawTest.length} 条（原生完整 test）`);
  console.log(`测试类分布  : ${Object.entries(testCounts).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
  console.log(`分类器      : 1NN（原始值欧氏距离，无归一化）`);
  for (const r of results) {
    console.log(`\n=== ${r.title} ===`);
    console.log(`训练集      : ${r.sourceInfo} · ${r.trainCount} 条`);
    console.log(`训练类分布  : ${Object.entries(r.trainCounts).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
    console.log(`准确率      : ${fmtPct(r.acc)}（${r.correct}/${r.total}）`);
    console.log(`Macro-F1    : ${r.macroF1.toFixed(4)}`);
    console.log(`耗时        : ${r.elapsedMs.toFixed(1)} ms`);
    console.log('\n每类：');
    console.log('  label              precision  recall    f1       support');
    for (const x of r.per) {
      console.log(`  ${x.label.padEnd(18)} ${fmtPct(x.precision).padStart(9)} ${fmtPct(x.recall).padStart(9)} ${x.f1.toFixed(4).padStart(8)} ${String(x.support).padStart(8)}`);
    }
    console.log('\n混淆矩阵（行=真实，列=预测）：');
    console.log(`  ${''.padEnd(18)} ${r.labels.map((x) => x.padStart(10)).join(' ')}`);
    for (const a of r.labels) {
      console.log(`  ${a.padEnd(18)} ${r.labels.map((b) => String(r.cm[a][b]).padStart(10)).join(' ')}`);
    }
  }
}
