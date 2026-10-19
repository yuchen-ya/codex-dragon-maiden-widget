import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore, PRIVATE_SETTING_FIELDS } from '../runtime/config.mjs';
import { WhaleService } from '../runtime/service.mjs';
import { createDispatcher } from '../runtime/dispatcher.mjs';

const marker = 'PRIVACY_FIXTURE_ONLY';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-privacy-test-'));
  t.after(() => {
    const target = path.resolve(dir);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('whale-privacy-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const codex = path.join(dir, 'fixture-codex'); fs.mkdirSync(codex);
  fs.writeFileSync(path.join(codex, 'config.toml'), 'model_provider="fixture"\n[model_providers.fixture]\nbase_url="https://example.invalid/v1"\n[profiles.PRIVACY_FIXTURE_ONLY]\nmodel="PRIVACY_FIXTURE_ONLY"\n');
  const config = new ConfigStore({ dataDir: path.join(dir, 'data'), codexHome: codex, env: { [marker]: 'FAKE_FIXTURE_VALUE' } });
  config.save({ baseUrl: 'https://privacy-fixture-only.invalid/v1', keyEnv: marker, profile: marker,
    projectDir: path.join(dir, marker), dashboardUrl: 'https://privacy-fixture-only.invalid/billing',
    balancePath: '/' + marker, balanceField: 'data.' + marker, usedField: 'data.' + marker,
    models: { [marker]: { input: 1, cachedInput: 0.1, output: 3 }, 'other-fixture-model': { input: 2, cachedInput: 0.2, output: 4 } } });
  return config;
}

function assertSafe(info) {
  const json = JSON.stringify(info);
  assert.doesNotMatch(json, /PRIVACY_FIXTURE_ONLY|privacy-fixture-only|FAKE_FIXTURE_VALUE|other-fixture-model/i);
  for (const key of PRIVATE_SETTING_FIELDS) assert.equal(Object.hasOwn(info.settings, key), false, key);
  for (const key of PRIVATE_SETTING_FIELDS) assert.equal(typeof info.configured[key], 'boolean', key);
}

test('settings and status DTOs omit private values and resolving preserves internal account identity', t => {
  const config = fixture(t), before = config.resolve();
  assertSafe(config.settingsInfo()); assertSafe(config.publicInfo());
  assert.equal(config.publicInfo().hasKey, true);
  config.save({ currency: 'CNY', monitorSessions: false });
  const after = config.resolve();
  assert.equal(after.accountId, before.accountId); assert.equal(after.baseUrl, before.baseUrl);
  for (const key of PRIVATE_SETTING_FIELDS) assert.deepEqual(after.setting[key], before.setting[key], key);
});

test('explicit resets and per-model price edits preserve unrelated private settings', t => {
  const config = fixture(t), before = config.load();
  config.save({ baseUrl: '', pricingUpdate: { model: marker, prices: { input: 7, cachedInput: 1, output: 8 } } });
  assert.equal(config.load().baseUrl, '');
  assert.deepEqual(config.load().models['other-fixture-model'], before.models['other-fixture-model']);
  assert.equal(config.load().models[marker].input, 7);
  config.save({ pricingUpdate: { model: marker, prices: null } });
  assert.equal(Object.hasOwn(config.load().models, marker), false);
  assert.deepEqual(config.load().models['other-fixture-model'], before.models['other-fixture-model']);
  assert.throws(() => config.save({ pricingUpdate: { model: '__proto__', prices: null } }), /模型名称/);
  assert.equal(config.load().keyEnv, before.keyEnv);
});

test('configuration GET and PUT return only the privacy DTO', async t => {
  const config = fixture(t), service = new WhaleService({ config }), dispatcher = createDispatcher({ dataDir: config.dataDir, service, monitor: false, autoRefresh: false });
  try {
    for (const options of [{}, { method: 'PUT', body: { currency: 'CNY' } }]) {
      const response = await dispatcher.dispatch('/api/config', options);
      assert.equal(response.status, 200); assertSafe(JSON.parse(response.body));
    }
    assert.equal(config.load().keyEnv, marker);
  } finally { await dispatcher.close(); }
});
