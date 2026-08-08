import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThreeXPlanetTags } from '../src/jav321.js';

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
