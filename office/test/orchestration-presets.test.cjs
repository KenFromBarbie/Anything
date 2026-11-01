'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const catalog = require('../src/shared/modelCatalog.json');

const { ORCHESTRATION_PRESETS, matchingPreset } = loadTs('src/shared/orchestrationPresets.ts');
const { modelForRole } = loadTs('src/main/config.ts');

test('every preset names Claude models the pickers offer', () => {
  const ids = new Set(catalog.providers.claude.map((m) => m.id));
  for (const p of ORCHESTRATION_PRESETS) {
    for (const link of ['michael', 'staff', 'floor', 'others']) {
      assert.ok(ids.has(p[link]), `${p.id}.${link} = ${p[link]}`);
    }
  }
});

test('the models a preset sets match it back; hand-set models match none', () => {
  const balanced = ORCHESTRATION_PRESETS.find((p) => p.id === 'balanced');
  assert.equal(matchingPreset(balanced)?.id, 'balanced');
  assert.equal(matchingPreset({ ...balanced, floor: 'claude-opus-5' }), null);
});

test('staff and floor workers run on the models a preset saved', () => {
  const cfg = { staffModel: 'claude-opus-5-5', floorModel: 'claude-sonnet-5-5' };
  assert.equal(modelForRole({ isStaff: true }, cfg), 'claude-opus-5-5');
  assert.equal(modelForRole({ role: 'worker' }, cfg), 'claude-sonnet-5-5');
  assert.equal(modelForRole({ isStaff: true }), 'claude-sonnet-5-5');
  assert.equal(modelForRole({ role: 'worker' }), 'claude-haiku-5-5');
});

test("an owner's preset is recognised once its models are set", () => {
  const mine = { id: 'custom-x', label: 'Night shift', blurb: '', michael: 'claude-opus-5-5', staff: 'claude-haiku-5-5', floor: 'claude-haiku-5-5', others: 'claude-haiku-5-5' };
  assert.equal(matchingPreset(mine), null);
  assert.equal(matchingPreset(mine, [...ORCHESTRATION_PRESETS, mine])?.id, 'custom-x');
});
