/* 临时一键 Wafer 测试汇总：
 *   - 默认模式两份结果（全量训练 / 仅正常类训练）
 *   - scripts/wafer_test 下每个 JSON 各跑一次自定义稀有类增强模式
 *   - 所有结果汇总成一张表
 *
 * 用法：
 *   npm run test:wafer:suite
 */
import { readdirSync } from 'node:fs';
import { basename, resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const script = resolve(here, 'wafer-1nn.mjs');
const dataDir = resolve(root, 'scripts/wafer_test');

function runCli(args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`子进程失败：${args.join(' ')}\n${r.stderr || r.stdout || ''}`);
  }
  const text = (r.stdout ?? '').trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`无法解析 --json 输出：${text.slice(0, 500)}\n${e.message}`);
  }
}

function metric(result, label) {
  return result.per.find((x) => x.label === label) ?? {
    label, precision: 0, recall: 0, f1: 0, support: 0,
  };
}
function pct(x) { return `${(x * 100).toFixed(2)}%`; }
function classSummary(counts) {
  return Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' / ');
}
function compactMetric(m) {
  return `${pct(m.precision)} / ${pct(m.recall)} / ${m.f1.toFixed(3)}`;
}

function collect() {
  const files = readdirSync(dataDir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort();
  if (!files.length) throw new Error(`没有 JSON 文件：${dataDir}`);

  const rows = [];
  const base = runCli(['--json']);
  for (const result of base.results) {
    rows.push({
      mode: '默认',
      source: result.title,
      trainCount: result.trainCount,
      trainDist: classSummary(result.trainCounts),
      testCount: result.testCount,
      result,
    });
  }
  for (const file of files) {
    const payload = runCli(['--train', join('scripts/wafer_test', file), '--json']);
    const result = payload.results[0];
    rows.push({
      mode: '自定义',
      source: basename(file),
      trainCount: result.trainCount,
      trainDist: classSummary(result.trainCounts),
      testCount: result.testCount,
      result,
    });
  }
  return { base, files, rows };
}

const { base, files, rows } = collect();
const rareLabel = base.rareLabel;
const normalLabel = base.normalLabel;
const short = (label) => (label === rareLabel ? '稀有(-1)' : label === normalLabel ? '正常(1)' : label);

console.log(`Wafer 测试汇总`);
console.log(`测试集：${base.testData} · ${base.testCount} 条`);
console.log(`wafer_test JSON：${files.length} 个`);
console.log('');
console.log('| # | 模式 | 训练来源 | 训练数 | 训练类分布 | 测试数 | 准确率 | Macro-F1 | 稀有类 P/R/F1 | 正常类 P/R/F1 | 耗时(ms) |');
console.log('|---:|---|---|---:|---|---:|---:|---:|---|---|---:|');
rows.forEach((row, i) => {
  const r = row.result;
  const rare = metric(r, rareLabel);
  const normal = metric(r, normalLabel);
  console.log(`| ${i + 1} | ${row.mode} | ${row.source} | ${row.trainCount} | ${row.trainDist} | ${row.testCount} | ${pct(r.acc)} | ${r.macroF1.toFixed(4)} | ${compactMetric(rare)} | ${compactMetric(normal)} | ${r.elapsedMs.toFixed(0)} |`);
});
console.log('');
console.log(`共 ${rows.length} 份结果：默认 ${base.results.length} + 自定义 ${files.length}。`);
console.log(`稀有类标签：${rareLabel} · 正常类标签：${normalLabel}`);
