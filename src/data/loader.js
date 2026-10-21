/* UCR 格式装载（首列标签 + 等长数值列）——承 v4 data/loader.js 的最小数据契约。
   opts.metaCols：标签后附加的溯源列数（本 demo 暂不用）。 */

export function parseTxt(text, metaCols = 0) {
  const samples = [];
  let idx = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const tok = line.split(/\s+/);
    if (tok.length < 2 + metaCols) continue;
    const cls = tok[0];
    const values = tok.slice(1 + metaCols).map(Number);
    if (values.some((v) => !Number.isFinite(v))) continue;
    samples.push({ id: `s${String(++idx).padStart(4, '0')}`, class: cls, values });
  }
  return samples;
}

export function classLabelOf(key) {
  const n = Number(key);
  return Number.isNaN(n) ? String(key) : String(n);
}

export function buildDataset(text, name = 'Dataset', opts = {}) {
  const samples = parseTxt(text, opts.metaCols ?? 0);
  if (samples.length < 4) throw new Error(`样本太少（${samples.length} 条）——不是有效的 UCR 格式？`);
  const L = samples[0].values.length;
  const bad = samples.find((s) => s.values.length !== L);
  if (bad) throw new Error(`样本长度不一致（${L} vs ${bad.values.length} 点）`);
  const counts = new Map();
  for (const s of samples) counts.set(s.class, (counts.get(s.class) ?? 0) + 1);
  if (counts.size < 2) throw new Error('只有单一类别——无法做类不均衡分析');
  const classes = [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: classLabelOf(key),
      count,
      ratio: count / samples.length,
    }))
    .sort((a, b) => b.count - a.count);
  return { name, length: L, samples, classes };
}
