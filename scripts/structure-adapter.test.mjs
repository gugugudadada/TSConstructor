/* P1 结构适配层的最小单元测试（node --test）。
   只验证适配契约与既有检测器的接线，不把 Wafer 某一条样本写死为期望。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectEditableStructures, structureConfigFor, structureSensitivityOf,
} from '../src/engine/structureAdapter.js';

const PLATEAU = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0];
const PEAK = [0, 0, 0, 2, 0, 0, 0];
const VALLEY = [0, 0, 0, -2, 0, 0, 0];
const RAMP_UP = [0, 1, 2, 3, 4, 5, 6];
const RAMP_DOWN = [6, 5, 4, 3, 2, 1, 0];

test('空输入返回空结构与完整 meta', () => {
  const r = detectEditableStructures([]);
  assert.equal(r.instances.length, 0);
  assert.equal(r.meta.counts.total, 0);
  assert.equal(r.meta.length, 0);
  assert.equal(r.meta.sensitivity, 'normal');
});

test('平台检测可被适配为统一实例', () => {
  const r = detectEditableStructures(PLATEAU);
  assert.ok(r.byType.plateau.length >= 1);
  const p = r.byType.plateau[0];
  assert.equal(p.type, 'plateau');
  assert.ok(p.startIndex <= p.centerIndex && p.centerIndex <= p.endIndex);
  assert.ok(p.endIndex < PLATEAU.length);
  assert.ok(p.width >= 1);
  assert.ok(p.normalizedWidth > 0);
  assert.equal(p.direction, null);
});

test('峰与谷检测可被适配，且方向/属性口径清楚', () => {
  const peak = detectEditableStructures(PEAK);
  const valley = detectEditableStructures(VALLEY);
  assert.ok(peak.byType.peak.length >= 1);
  assert.ok(valley.byType.valley.length >= 1);
  const p = peak.byType.peak[0];
  const v = valley.byType.valley[0];
  assert.equal(p.type, 'peak');
  assert.equal(v.type, 'valley');
  assert.ok(p.centerIndex >= 0 && p.centerIndex < PEAK.length);
  assert.ok(v.centerIndex >= 0 && v.centerIndex < VALLEY.length);
  assert.ok(p.prominence != null);
  assert.ok(v.prominence != null);
});

test('斜坡适配包含方向与斜率属性', () => {
  const up = detectEditableStructures(RAMP_UP);
  const down = detectEditableStructures(RAMP_DOWN);
  assert.ok(up.byType.ramp.length >= 1);
  assert.ok(down.byType.ramp.length >= 1);
  const u = up.byType.ramp[0];
  const d = down.byType.ramp[0];
  assert.equal(u.direction, 'up');
  assert.equal(d.direction, 'down');
  assert.ok(Number.isFinite(u.properties.slope));
  assert.ok(Number.isFinite(d.properties.slope));
});

test('实例字段满足 P1/P2 所需的最小契约', () => {
  const r = detectEditableStructures(PLATEAU);
  for (const s of r.instances) {
    assert.equal(typeof s.id, 'string');
    assert.ok(['plateau', 'peak', 'valley', 'ramp'].includes(s.type));
    assert.ok(Number.isInteger(s.startIndex));
    assert.ok(Number.isInteger(s.endIndex));
    assert.ok(Number.isInteger(s.centerIndex));
    assert.ok(s.relativePosition >= 0 && s.relativePosition <= 1);
    assert.ok(s.normalizedWidth > 0 && s.normalizedWidth <= 1);
    assert.ok(s.startIndex <= s.centerIndex && s.centerIndex <= s.endIndex);
  }
});

test('同输入同配置结果稳定，实例 id 唯一', () => {
  const a = detectEditableStructures(PLATEAU);
  const b = detectEditableStructures(PLATEAU);
  assert.deepEqual(a, b);
  const ids = a.instances.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('配置预设集中管理，并可回显当前灵敏度', () => {
  const strict = structureConfigFor('strict');
  const loose = structureConfigFor('loose');
  assert.ok(strict.peak.minProminence > loose.peak.minProminence);
  assert.ok(strict.plateau.nMin >= loose.plateau.nMin);
  assert.equal(structureSensitivityOf('strict'), 'strict');
  assert.equal(structureSensitivityOf('unknown'), 'normal');
  const r = detectEditableStructures(PEAK, 'loose');
  assert.equal(r.meta.sensitivity, 'loose');
  assert.equal(r.meta.spec, 'struct-v1.0.0');
});
