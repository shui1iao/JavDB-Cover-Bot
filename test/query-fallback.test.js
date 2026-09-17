import test from 'node:test';
import assert from 'node:assert/strict';
import { isJavdbCover, queryJav321 } from '../src/jav321.js';

// Regression: ABW-198 exists on JavDB, but JAV321 is currently blocked by
// Cloudflare and MissAV redirects to a 403 target. The bot should still find it
// through the JavDB fallback instead of reporting "未找到相关番号".
test('queryJav321 falls back to JavDB when JAV321 and MissAV do not return a detail page', async () => {
  const result = await queryJav321('ABW-198');

  assert.equal(result.code, 'ABW-198');
  assert.match(result.caption, /#ABW-198/);
  assert.ok(!result.cover || !isJavdbCover(result.cover), 'JavDB covers must never be returned');
});

// Regression: an exact JavDB match may have a working jdbstatic image, but it
// is watermarked and must not be exposed as the bot cover.
test('queryJav321 never returns a JavDB cover URL', async () => {
  const result = await queryJav321('HHL-141');

  assert.equal(result.code, 'HHL-141');
  assert.match(result.caption, /#HHL-141/);
  assert.ok(!result.cover || !isJavdbCover(result.cover));
});

// Regression: numeric FC2 shorthand 4361640 is not present as an exact JavDB
// search result, while 3xplanet has a detail page. The bot should still return
// the FC2 detail instead of stopping at JavDB's non-exact search miss.
test('queryJav321 falls back to 3xplanet for numeric FC2 entries missing from JavDB search', async () => {
  const result = await queryJav321('4361640');

  assert.equal(result.code, 'FC2-PPV-4361640');
  assert.equal(result.detail.code, 'FC2-PPV-4361640');
  assert.match(result.caption, /#FC2-PPV-4361640/);
  assert.doesNotMatch(result.caption, /<b>标签：<\/b>/, 'FC2 captions should not include a tags line');
  assert.doesNotMatch(result.detail.rawTitle, /^(?:FC2\s*)?PPV\s*4361640\b/i);
  assert.ok(result.cover, 'expected cover from 3xplanet fallback source');
});

// Regression: aggregator tags for SSIS-348 include technical or overly broad
// categories. The S1 product page has the authoritative structured genres.
test('queryJav321 prefers official S1 genres over aggregator tags', async () => {
  const result = await queryJav321('SSIS-348');

  assert.match(result.caption, /<b>标签：<\/b>#巨乳 #美少女 #姐妹 #单体作品 #NTR(?:\n|$)/);
  assert.doesNotMatch(result.caption, /#ギリモザ|#妹(?:\s|$)/);
});

test('HEYZO fallback emits only the translated tag line, never later metadata or synopsis', async () => {
  const result = await queryJav321('HEYZO-3791');
  assert.equal(result.code, 'HEYZO-3791');
  assert.equal(result.caption.split('\n').find(line => line.startsWith('<b>标签：</b>')),
    '<b>标签：</b>#人妻 #中出 #无码 #出轨 #美乳 #口交 #骑乘位 #舔阴 #熟女');
});

// Regression: MIDA-687 has no genre block on JAV321 or 3xplanet, while the
// Moodyz product page exposes authoritative structured genres.
test('queryJav321 uses official Moodyz genres when aggregators return no tags', async () => {
  const result = await queryJav321('MIDA-687');

  assert.match(result.caption, /<b>标签：<\/b>#高潮 #潮吹 #女学生 #运动 #美少女(?:\n|$)/);
});

// Regression: 3xplanet repeats the studio and actress inside its English Tags
// field for FSDSS-582; the real pantyhose genre must remain while those
// metadata values stay excluded, even when another source adds valid genres.
test('queryJav321 excludes studio and actress values from English aggregator tags', async () => {
  const result = await queryJav321('FSDSS-582');

  assert.match(result.caption, /<b>标签：<\/b>[^\n]*#连裤袜(?:\s|$)/);
  const tagsLine = result.caption.split('\n').find((line) => line.includes('<b>标签：</b>')) || '';
  assert.doesNotMatch(tagsLine, /#FALENO|#KamikiRan/);
});

// Regression: older Aircontrol image-video entries can be absent from JAV321,
// JavDB, MissAV, and 3xplanet while the manufacturer still has an exact page.
test('queryJav321 falls back to the official Aircontrol page for OAE entries', async () => {
  const result = await queryJav321('OAE-176');

  assert.equal(result.detail.source, 'aircontrol');
  assert.equal(result.detail.code, 'OAE-176');
  assert.equal(result.detail.releaseDate, '2019-01-25');
  // The official original stays stable; display translation may succeed or
  // fall back to that original depending on live translation availability.
  assert.equal(result.detail.rawTitle, 'ALL NUDE');
  assert.match(result.caption, /<b>标题：<\/b>[^\n]+/);
  assert.match(result.caption, /<b>演员：<\/b>#岬ななみ/);
  assert.match(result.caption, /<b>标签：<\/b>#美乳 #可爱(?:\n|$)/);
  assert.match(result.cover, /^https:\/\/pics\.dmm\.co\.jp\/digital\/video\/oae00176\/oae00176pl\.jpg$/);
});
