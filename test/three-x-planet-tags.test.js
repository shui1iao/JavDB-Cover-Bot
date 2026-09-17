import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseThreeXPlanetTags, parseThreeXPlanetDetailPage } from '../src/jav321.js';

const expectedHeyzoTags = ['人妻', '中出', '无码', '出轨', '美乳', '口交', '骑乘位', '舔阴', '熟女'];

test('HEYZO detail has exactly translated tags without date, actor or synopsis fields', () => {
  const html = readFileSync(new URL('./fixtures/three-x-planet-heyzo-tags.html', import.meta.url), 'utf8');
  const detail = parseThreeXPlanetDetailPage(html, 'HEYZO-3791');
  assert.ok(detail);
  assert.deepEqual(detail.tags, expectedHeyzoTags);
});

for (const label of ['配信日', '再生時間', '再生时间', '出演', '女優タイプ', '女优タイプ', 'タグ']) {
  for (const colon of [':', '：']) {
    test(`English tags stop at HEYZO metadata label ${label}${colon}`, () => {
      assert.deepEqual(parseThreeXPlanetTags(`Tags: Beautiful Breasts ${label}${colon} metadata and synopsis`), ['美乳']);
    });
  }
  test(`Japanese genres stop at HEYZO metadata label ${label}`, () => {
    assert.deepEqual(parseThreeXPlanetTags(`ジャンル: 巨乳 美少女 ${label}: metadata and synopsis`), ['巨乳', '美少女']);
  });
}

test('English HEYZO genres translate and deduplicate without relying on later metadata', () => {
  assert.deepEqual(parseThreeXPlanetTags('Tags: UNCENSORED, affair, Beautiful Breasts, Blowjob, cowgirl, Creampie, Cum inside, Cunnilingus, HOUSEWIFE, Mature'), expectedHeyzoTags);
});

test('3xplanet tags stop before performer and product metadata', () => {
  const description = 'Starring: Ogura Nanami Studio: Esuwan number one style Tags: CENSORED, Esuwan number one style, Ogura Nanami, Cuckold, Work alone, pretty girl, Big tits 品番: SSIS-348 発売日: 2022-03-08 収録時間: 120 分 監督: サッポロ太郎 メーカー: エスワン ナンバーワンスタイル レーベル: S1 NO.1 STYLE ジャンル: 単体作品 巨乳 美少女 妹 寝取り、寝取られ ギリモザ 出演者: 小倉七海 ~~DOWNLOAD~~';

  assert.deepEqual(parseThreeXPlanetTags(description), [
    '巨乳',
    '单体作品',
    '美少女',
    '妹',
    '寝取り、寝取られ',
    'ギリモザ',
  ]);
});

test('3xplanet English tags stop before starring and studio metadata', () => {
  assert.deepEqual(
    parseThreeXPlanetTags('Tags: Big tits Starring: Alice Studio: S1'),
    ['巨乳']
  );
});

test('3xplanet English tags exclude repeated studio and actress values', () => {
  const description = 'Starring: Kamiki Ran Studio: FALENO Tags: CENSORED, FALENO, Kamiki Ran, pantyhose ~~DOWNLOAD~~';

  assert.deepEqual(parseThreeXPlanetTags(description), ['连裤袜']);
});
