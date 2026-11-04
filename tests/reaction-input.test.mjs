import test from 'node:test';
import assert from 'node:assert/strict';
import { filterReactionText } from '../runtime/reaction-input.mjs';

test('credential shapes, assignments, long digits and private keys are removed locally', () => {
  const examples = [
    'sk-' + 'fakeTest9'.repeat(5),
    'github_' + 'pat_' + 'FAKE9'.repeat(7),
    'ey' + 'J' + 'a'.repeat(15) + '.' + 'b'.repeat(15) + '.' + 'c'.repeat(15),
    'Authorization: Bearer short-private-value',
    'OPENROUTER_API_KEY="short value"',
    '"api_key":"shortSecret"',
    'password=superPrivate',
    '密钥：短密钥内容',
    'aB9cD8'.repeat(6),
    'abcdef12'.repeat(4),
    '123456789012345',
    '１２３４５６７８９',
    '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
  ];
  for (const value of examples) {
    const checked = filterReactionText(value);
    assert.ok(checked.filtered.numbers + checked.filtered.secrets > 0, 'expected redaction');
    assert.equal(checked.meaningful, false, 'a secret alone must not cause a paid analysis');
    assert.ok(!checked.text.includes(value));
  }
});

test('ordinary instructions and short technical numbers retain useful context', () => {
  for (const text of ['代理端口是 7897，帮我配置。', 'HTTP 401 又出现了，检查一下。', '现在是 0.1.9，继续改。', '使用 OPENROUTER_API_KEY 环境变量。']) {
    assert.deepEqual(filterReactionText(text), { text, filtered: { numbers: 0, secrets: 0 }, meaningful: true });
  }
  for (const text of ['123', '12345.6789', '12:34', '...']) assert.equal(filterReactionText(text).meaningful, false);
  assert.equal(filterReactionText('编号 123456789 有问题，继续检查。').text, '编号 [已过滤] 有问题，继续检查。');
});
