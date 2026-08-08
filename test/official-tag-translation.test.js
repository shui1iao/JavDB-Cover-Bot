import test from 'node:test';
import assert from 'node:assert/strict';
import { translateOfficialTags } from '../src/jav321.js';

test('unknown official Japanese labels use the async translator and never pass through unchanged', async () => {
  const translated = await translateOfficialTags(
    ['競泳水着', '巨乳'],
    async (tag) => tag === '競泳水着' ? '竞技泳装' : tag
  );

  assert.deepEqual(translated, ['竞技泳装', '巨乳']);
  assert.doesNotMatch(translated.join(' '), /[\u3040-\u30ff]/);
});

test('failed official tag translation drops untranslated Japanese labels', async () => {
  const translated = await translateOfficialTags(['競泳水着', 'ノーパン'], async (tag) => tag);

  assert.deepEqual(translated, []);
});
