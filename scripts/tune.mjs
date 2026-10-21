/* 临时标定脚本（不参与运行时）：在 Node 里离线试配方，确定布景用基源 / 片段源 / 参数，
   使工作模板机械通过声明的硬约束（tailDrop ≤ −0.35 · roughness ≥ 0.14）。
   用法：node scripts/tune.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildDataset } from '../src/data/loader.js';
import {
  runRecipe, structureFingerprint, roughnessOf, tailDropOf, euclid,
} from '../src/engine/recipe.js';

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, '..', 'public', 'data', 'Wafer_TRAIN.txt'), 'utf8');
const ds = buildDataset(text, 'wafer');
const POS = '1.0000000e+00';
const NEG = '-1.0000000e+00';
const byClass = (k) => ds.samples.filter((s) => s.class === k);
const valuesOf = new Map(ds.samples.map((s) => [s.id, s.values]));
const sampleValues = (id) => valuesOf.get(id) ?? null;
const L = ds.length;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const stats = (arr) => ({ n: arr.length, rough: mean(arr.map((s) => roughnessOf(s.values))), roughSd: sd(arr.map((s) => roughnessOf(s.values))), tail: mean(arr.map((s) => tailDropOf(s.values))) });

console.log('classes:', ds.classes.map((c) => `${c.key}:${c.count}`).join(' '));
console.log('class1', stats(byClass(POS)));
console.log('class-1', stats(byClass(NEG)));

function centroid(arr) {
  const c = new Array(L).fill(0);
  for (const s of arr) for (let i = 0; i < L; i++) c[i] += s.values[i];
  for (let i = 0; i < L; i++) c[i] /= arr.length;
  return c;
}
const c1 = centroid(byClass(POS));
const rep1 = byClass(POS).reduce((b, s) => (euclid(s.values, c1) < euclid(b.values, c1) ? s : b));
const donor = [...byClass(NEG)].sort((a, b) => tailDropOf(a.values) - tailDropOf(b.values))[0];
console.log('rep1 =', rep1.id, 'donor =', donor.id);

function test(label, steps, baseId = rep1.id) {
  const run = runRecipe(sampleValues(baseId), steps, { sampleValues, noiseSeed: 49 });
  const fp = structureFingerprint(run.values);
  const failed = run.stages.filter((s) => s.failed);
  const ok = fp.tailDrop <= -0.35 && fp.roughness >= 0.14;
  console.log(`${ok ? 'PASS' : 'fail'} ${label.padEnd(34)} tail=${fp.tailDrop.toFixed(3).padStart(7)} rough=${fp.roughness.toFixed(4)} peaks=${fp.peakCount} std=${fp.std.toFixed(3)}${failed.length ? '  ✗STEP:' + failed.map((f) => f.label).join('+') : ''}`);
  return ok;
}

const V = (o) => ({ pos: true, width: true, amp: true, src: false, ...o });
const segSpan = [112, 151];

const transplant = {
  id: 'st1', kind: 'transplant', enabled: true, source: donor.id,
  srcSpan: segSpan, dstSpan: segSpan, alpha: 1.0, seam: 7,
  vary: V({ width: false, src: true }),
};
const stepTail = { id: 'st3', kind: 'component', component: 'step', enabled: true, anchor: 66, width: 6, amp: -0.35, mix: 'add', weight: 1, vary: V() };
const plateauTail = { id: 'st3b', kind: 'component', component: 'plateau', enabled: true, anchor: 132, width: 34, amp: -0.45, mix: 'add', weight: 1, vary: V() };
const osc = { id: 'st2', kind: 'component', component: 'oscillation', enabled: true, anchor: 96, width: 48, period: 7, amp: 0.16, mix: 'add', weight: 1, vary: V() };
const resid = { id: 'st4', kind: 'texture', enabled: true, source: donor.id, amount: 0.35, win: 9, vary: V({ pos: false, width: false, src: true }) };
const deform = { id: 'st5', kind: 'deform', enabled: true, anchor: 124, width: 7, amp: -0.2, vary: V() };

test('transplant only', [transplant]);
test('transplant+step', [transplant, stepTail]);
test('transplant+plateau', [transplant, plateauTail]);
test('transplant+osc', [transplant, osc]);
test('transplant+osc+resid', [transplant, osc, resid]);
test('transplant+step+osc+resid', [transplant, stepTail, osc, resid]);
test('transplant+plateau+osc+resid', [transplant, plateauTail, osc, resid]);
test('transplant+step+osc+resid+deform', [transplant, stepTail, osc, resid, deform]);
test('plateau+osc+resid (no transplant)', [plateauTail, osc, resid]);

console.log('--- FINAL seed recipe ---');
plateauTail.amp = -0.5; osc.amp = 0.08; resid.amount = 0.2; deform.amp = -0.15;
const FINAL = [transplant, plateauTail, osc, resid, deform];
const t = runRecipe(valuesOf.get(rep1.id), FINAL, { sampleValues, noiseSeed: 49 });
const fp = structureFingerprint(t.values);
console.log('rep1', rep1.id, 'donor', donor.id, 'template:', { ...fp, features: undefined });
let pass = 0;
const pool = byClass(POS).slice(0, 300);
for (const s of pool) {
  const r2 = runRecipe(valuesOf.get(s.id), FINAL, { sampleValues, noiseSeed: 49 });
  const f2 = structureFingerprint(r2.values);
  if (f2.tailDrop <= -0.35 && f2.roughness >= 0.14) pass += 1;
}
console.log(`poolPass=${pass}/300`);
for (const k of ['peakCount', 'valleyCount', 'stepCount', 'plateauCount', 'rampCount', 'pulseCount']) console.log(' ', k, fp[k]);
