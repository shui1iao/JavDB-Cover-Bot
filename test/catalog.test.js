import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { queryJav321, normalizeCode } from '../src/jav321.js';
import { recoverCover } from '../src/cover-recovery.js';
import { coreSync } from '../src/catalog-core.js';
import { categoryPolicy as policy, normalizeCategoryTags, categoryHashTag, CATEGORY_POLICY_SHA256 } from '../src/category-tags.js';
const root = mkdtempSync(join(tmpdir(), 'catalog-offline-'));
after(() => rmSync(root, { recursive: true, force: true }));
execFileSync(process.env.CATALOG_PYTHON || '/opt/catalog-venv/bin/python', [fileURLToPath(new URL('./synthetic.py', import.meta.url)), root]);
const digest = b => createHash('sha256').update(b).digest('hex');
const query = (name, code) => queryJav321(code || JSON.parse(readFileSync(join(root, name + '.json'))).code, {
  coreOptions: { responses: join(root, name + '.json'), stateDir: join(root, 'state-' + name) },
  translateTitle: async () => '合成标题 <安全> & 保持',
  translateTags: async () => { throw Error('Categories must never call translation'); },
});
function caption(result) {
  const $ = cheerio.load(result.caption, null, false);
  assert.equal($('script,a,img').length, 0);
  assert.ok(result.caption.startsWith(`<b>番号：</b>#${result.code}\n`));
  assert.ok(result.caption.includes('&lt;安全&gt; &amp;'));
  assert.ok(result.caption.includes('<b>日期：</b>2026-01-01'));
  const line = result.caption.split('\n').find(s => s.startsWith('<b>标签：</b>'));
  if (!line) return [];
  const tags = line.slice('<b>标签：</b>'.length).split(' ');
  assert.equal(new Set(tags).size, tags.length);
  assert.ok(tags.length <= 20);
  for (const tag of tags) assert.match(tag, /^#[\p{L}\p{M}\p{N}_]+$/u);
  assert.doesNotMatch(line, /Description|SyntheticSynopsis/);
  return tags;
}
test('public frozen policy: full mapping, exact drops and codec', () => {
  assert.equal(CATEGORY_POLICY_SHA256, '0ed52ba0ce3b0f21e54591aa5f5c4768bcbf90ce76690e92b5d3421a8fb5a0c3');
  assert.equal(policy.categories.length, 306); assert.equal(policy.merge_groups.length, 83); assert.equal(policy.drop.length, 21);
  assert.equal(Object.keys(policy.raw_to_canonical_id).length, 413);
  const byId = new Map(policy.categories.map(c => [c.canonical_id, c]));
  for (const [raw, id] of Object.entries(policy.raw_to_canonical_id)) assert.deepEqual(normalizeCategoryTags([raw, raw]), [byId.get(id).original_label]);
  assert.deepEqual(normalizeCategoryTags(policy.drop.map(c => c.raw_name)), []);
  for (const c of policy.categories) {
    assert.equal(categoryHashTag(c.original_label), '#' + c.hashtag_token);
    assert.equal(policy.token_to_canonical_id[c.hashtag_token.normalize('NFKC')], c.canonical_id);
  }
  assert.equal('authorizations' in policy, false);
});
test('original glyphs, four Japanese labels, unknowns and compound hashtags', () => {
  for (const label of ['パイズリ', '顔射', '主観', 'お姉さん', '未収録繁體・空 白', 'NeverApprovedGenre']) assert.deepEqual(normalizeCategoryTags([label, label]), [label]);
  assert.deepEqual(normalizeCategoryTags(['3P、4P', '3P・4P']), ['3P・4P']);
  assert.equal(categoryHashTag('3P・4P'), '#3P_4P');
  assert.equal(categoryHashTag('未収録繁體・空 白'), '#未収録繁體_空_白');
  for (const c of policy.categories) for (const alias of c.search_aliases) if (!(alias in policy.raw_to_canonical_id) && !policy.drop.some(d => d.raw_name === alias)) assert.deepEqual(normalizeCategoryTags([alias]), [alias]);
});
for (const name of ['official', 'names']) test(`${name}: real query caption, raw categories and bilingual cast`, async () => {
  const r = await query(name); const tags = caption(r);
  assert.equal(r.publicMetadata.metadata.field_sources.tags, name === 'official' ? 'aircontrol' : 'javdb');
  for (const tag of ['#パイズリ', '#顔射', '#主観', '#お姉さん', '#3P_4P', '#未収録繁體_空_白', '#素人']) assert.ok(tags.includes(tag));
  assert.ok(!tags.includes('#乳交') && !tags.includes('#BIGセール') && !tags.includes('#CENSORED'));
  assert.match(r.caption, /#涼森れむ #凉森玲梦 #三上悠亜 #三上悠亚 #素人 #架空テスト/);
  assert.equal(r.detail.releaseDate, '2026-01-01');
  assert.equal(r.detail.rawTitle, '合成テスト作品の長いタイトル');
  assert.equal(r.source, 'shared-catalog');
});
test('existing order, blocked values, 20 cap, FC2 normalized code and no category output', async () => {
  const r = await query('cap');
  assert.deepEqual(r.detail.tags.slice(0, 4), ['人妻', '巨乳', '未収録一', '未収録0']);
  assert.equal(caption(r).length, 20);
  const fc2 = await query('fc2'); assert.equal(fc2.code, 'FC2-PPV-1234567');
  assert.equal(normalizeCode('1234567'), fc2.code);
  assert.doesNotMatch(fc2.caption, /<b>标签：/); caption(fc2);
});
test('GANA pair real query: same cover, eight actual genres, no Description contamination', async () => {
  let coverHash;
  for (const code of ['GANA-3342', '200GANA-3342']) {
    const r = await query('gana', code); const tags = caption(r);
    assert.equal(r.code, code); assert.equal(r.publicMetadata.identity, 'GANA-3342');
    assert.equal(r.publicMetadata.metadata.field_sources.tags, '3xplanet');
    assert.equal(r.publicMetadata.metadata.tags.length, 8); assert.equal(tags.length, 8);
    const cover = r.publicMetadata.cover; assert.ok(cover); assert.deepEqual(cover.size, [960, 540]);
    if (coverHash) assert.equal(cover.sha256, coverHash); coverHash = cover.sha256;
    const selected = await recoverCover(r, join(root, 'tmp'), { cacheRoot: join(root, 'covers') });
    assert.equal(digest(readFileSync(selected.file)), coverHash); await selected.cleanup();
    const cached = await recoverCover({ ...r, publicMetadata: { ...r.publicMetadata, cover: null } }, join(root, 'tmp'), { cacheRoot: join(root, 'covers') });
    assert.equal(cached.source, 'cache'); assert.equal(digest(readFileSync(cached.file)), coverHash); await cached.cleanup();
  }
});
test('v0.3.12 HOI exact-source prefix cover fallback remains available', async () => {
  const r = await query('hoi'); caption(r);
  assert.equal(r.publicMetadata.identity, 'HOI-367');
  assert.ok(r.publicMetadata.cover);
  assert.equal(r.publicMetadata.cover.url, 'https://3xplanetimg.com/covers/synthetic-hoi.jpg');
  assert.equal(r.publicMetadata.metadata.field_sources.title, 'javdb');
  assert.deepEqual(r.detail.actors, ['涼森れむ', '三上悠亜', '素人', '架空テスト']);
  assert.equal(coreSync('codes', ['HOI-367', '420HOI-367']).same_work, false);
});
for (const name of ['hoi-ambiguous', 'hoi-conflict', 'hoi-title-mismatch']) test(`${name}: strict HOI negative guard`, async () => {
  const r = await query(name); caption(r); assert.equal(r.publicMetadata.cover, null);
});
test('installed core API/version and identity guard negatives', () => {
  assert.equal(coreSync('info').version, '2026.10.25.1');
  assert.equal(coreSync('codes', ['GANA-3342', '200GANA-3342']).same_work, true);
  assert.equal(coreSync('codes', ['GANA-3342', '999GANA-3342']).same_work, false);
  assert.equal(coreSync('codes', ['200GANA-3342', '200GANA-3343']).same_work, false);
});
