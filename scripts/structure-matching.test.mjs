import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTarget, resolveStepTargets } from '../src/engine/structureMatching.js';

function baseWithBump(center, width = 12) {
  const L = 120;
  const out = new Array(L).fill(0);
  for (let i = center - width / 2; i <= center + width / 2; i++) {
    if (i >= 0 && i < L) out[i] += 2 * Math.exp(-0.5 * ((i - center) / (width / 5)) ** 2);
  }
  return out;
}

function customTarget(values, span, relativePosition, width) {
  const slice = values.slice(span[0], span[1] + 1);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length) || 1e-12;
  return {
    id: 'custom:test',
    kind: 'custom',
    label: '测试结构',
    span,
    descriptor: {
      type: 'custom',
      width,
      relativePosition,
      template: slice.map((v) => (v - mean) / std),
    },
  };
}

test('自定义结构在本样本原位置命中', () => {
  const values = baseWithBump(60);
  const target = customTarget(values, [54, 66], 60 / 119, 13);
  const r = matchTarget(target, values);
  assert.equal(r.status, 'matched');
  assert.ok(Math.abs(r.span[0] - 54) <= 2);
  assert.ok(Math.abs(r.span[1] - 66) <= 2);
});

test('自定义结构能在附近找到平移后的相似形状', () => {
  const source = baseWithBump(60);
  const target = customTarget(source, [54, 66], 60 / 119, 13);
  const moved = baseWithBump(70);
  const r = matchTarget(target, moved);
  assert.equal(r.status, 'matched');
  assert.ok(Math.abs(r.span[0] - 64) <= 3);
  assert.ok(Math.abs(r.span[1] - 76) <= 3);
});

test('同一目标的平移+缩放：后续步骤跟随平移后的区间', () => {
  const values = baseWithBump(60);
  const target = customTarget(values, [54, 66], 60 / 119, 13);
  const steps = [
    { id: 's1', kind: 'shift', enabled: true, span: [54, 66], delta: 6, feather: 0, target },
    { id: 's2', kind: 'scale', enabled: true, span: [54, 66], factor: 1.2, feather: 0, target },
  ];
  const r = resolveStepTargets(steps, values);
  assert.equal(r.steps[0].targetStatus.status, 'matched');
  assert.equal(r.steps[1].targetStatus.status, 'matched');
  assert.equal(r.steps[1].span[0] - r.steps[0].span[0], 6);
  assert.equal(r.steps[1].span[1] - r.steps[0].span[1], 6);
});
