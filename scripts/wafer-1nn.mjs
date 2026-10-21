/* Wafer 端到端 1NN 训练 + 测试（无第三方依赖）。
 *
 * 默认训练集：
 *   node scripts/wafer-1nn.mjs
 * 或用应用“导出全部批次”的 JSON 直接做训练集：
 *   node scripts/wafer-1nn.mjs --train C:\path\to\tsc2-candidates-all-xxx.json
 *
 * 测试集固定为 Wafer_TRAIN.txt 的确定性分层留出集（默认 20%，seed 42）。
 * 导出文件默认使用候选的 baseClass 作为 1NN 标签；若目标类别本身存在于
 * Wafer 测试集（例如缺类重建），则自动改用目标类别标签。可用 --label 强制。
 *
 * 1NN = 原始值欧氏距离，不做归一化、不重采样。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function parseArgs(argv) {
  const out = {
    train: 'default',
    data: resolve(root, 'public/data/Wafer_TRAIN.txt'),
    ratio: 0.2,
    seed: 42,
    label: 'auto',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--train') out.train = argv[++i];
    else if (a === '--data') out.data = resolve(argv[++i]);
    else if (a === '--ratio') out.ratio = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--label') out.label = argv[++i];
    else throw new Error(`未知参数：${a}（用 --help 查看）`);
  }
  return out;
}

function usage() {
  console.log(`Wafer 1NN 端到端测试

用法：
  node scripts/wafer-1nn.mjs [选项]

选项：
  --train default|<export.json>  训练集；默认 = Wafer 默认训练划分
  --data <Wafer_TRAIN.txt>      原始数据（默认 public/data/Wafer_TRAIN.txt）
  --ratio 0.2                   测试集比例（默认 0.2）
  --seed 42                     分层划分随机种子
  --label auto|target|base      导出文件训练时的标签策略（默认 auto）
  -h, --help

示例：
  npm run test:wafer
  npm run test:wafer -- --train exports/tsc2-candidates-all-new-xxx.json
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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function splitStratified(rows, ratio, seed) {
  const ratioClamped = Math.max(0, Math.min(0.9, Number.isFinite(ratio) ? ratio : 0.2));
  const byClass = new Map();
  for (const r of rows) {
    if (!byClass.has(r.label)) byClass.set(r.label, []);
    byClass.get(r.label).push(r);
  }
  const rng = mulberry32(seed >>> 0);
  const train = [];
  const test = [];
  for (const label of [...byClass.keys()].sort()) {
    const arr = shuffle(byClass.get(label), rng);
    let nTest = arr.length > 1 ? Math.max(1, Math.round(arr.length * ratioClamped)) : 0;
    if (nTest >= arr.length) nTest = arr.length - 1;
    test.push(...arr.slice(0, nTest));
    train.push(...arr.slice(nTest));
  }
  return { train, test, ratio: ratioClamped };
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
  const target = doc.target ?? {};
  return { doc, candidates, target };
}

function labelFor(candidate, target, policy, testLabels) {
  const targetLabel = String(target.key ?? target.name ?? 'target');
  const baseLabel = candidate.baseClass != null ? String(candidate.baseClass) : null;
  if (policy === 'base') {
    if (baseLabel == null) throw new Error(`候选 ${candidate.id} 没有 baseClass，不能用 --label base`);
    return baseLabel;
  }
  if (policy === 'target') return String(candidate.label ?? targetLabel);
  /* auto：目标类在测试集里存在（缺类重建）→ 用目标类；否则按基源类。 */
  if (testLabels.has(targetLabel)) return String(candidate.label ?? targetLabel);
  if (baseLabel != null) return baseLabel;
  return String(candidate.label ?? targetLabel);
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
if (!['auto', 'target', 'base'].includes(args.label)) throw new Error(`--label 只能是 auto/target/base，收到 ${args.label}`);

const rawRows = parseUcr(readFileSync(args.data, 'utf8'));
if (!rawRows.length) throw new Error(`数据为空：${args.data}`);
const lengths = new Set(rawRows.map((r) => r.values.length));
if (lengths.size !== 1) throw new Error(`样本长度不一致：${[...lengths].join(', ')}`);
const L = rawRows[0].values.length;
const split = splitStratified(rawRows, args.ratio, args.seed);
const testLabels = new Set(split.test.map((r) => r.label));

let trainRows;
let sourceInfo;
if (args.train === 'default') {
  trainRows = split.train.map((r) => ({ values: r.values, label: r.label }));
  sourceInfo = 'default（Wafer 训练划分）';
} else {
  const exportPath = resolve(args.train);
  const loaded = loadExport(exportPath);
  if (loaded.doc.dataset?.length && Number(loaded.doc.dataset.length) !== L) {
    throw new Error(`导出文件长度 ${loaded.doc.dataset.length} 与 Wafer 长度 ${L} 不一致`);
  }
  trainRows = loaded.candidates.map((c) => {
    if (!Array.isArray(c.values) || c.values.length !== L) {
      throw new Error(`候选 ${c.id ?? '?'} 的 values 长度不是 ${L}`);
    }
    return { values: c.values.map(Number), label: labelFor(c, loaded.target, args.label, testLabels) };
  });
  const classes = new Set(trainRows.map((r) => r.label));
  sourceInfo = `导出文件（${loaded.candidates.length} 条 / ${classes.size} 类；标签策略 ${args.label}）`;
  if (classes.size === 1) {
    console.warn(`⚠ 导出训练集只有 1 个类别（${[...classes][0]}）——1NN 只会预测该类。`);
  }
}

if (!trainRows.length) throw new Error('训练集为空');
if (!split.test.length) throw new Error('测试集为空；请增大 --ratio');

const t0 = performance.now();
const rows = classifyTable(split.test, trainRows);
const elapsed = performance.now() - t0;
const r = report(rows);

console.log(`数据集      : ${args.data}`);
console.log(`样本长度    : ${L} · 原始 ${rawRows.length} 条 · 留出比例 ${(split.ratio * 100).toFixed(0)}% · seed ${args.seed}`);
console.log(`训练集      : ${sourceInfo} · ${trainRows.length} 条`);
console.log(`测试集      : ${split.test.length} 条`);
console.log(`分类器      : 1NN（原始值欧氏距离，无归一化）`);
console.log(`准确率      : ${fmtPct(r.acc)}（${r.correct}/${r.total}）`);
console.log(`Macro-F1    : ${r.macroF1.toFixed(4)}`);
console.log(`耗时        : ${elapsed.toFixed(1)} ms`);
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
