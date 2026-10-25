import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTRESS_NAME_FIXES, getTrustedChineseActorName } from '../src/actress-names.js';

test('maps 美乃すずめ to the accepted Chinese name 美乃雀', () => {
  assert.equal(ACTRESS_NAME_FIXES.get('美乃すずめ'), '美乃雀');
});


test('trusted popular names and orthographic lookup variants have explicit Chinese matches', () => {
  for (const [name, chinese] of [
    ['涼森れむ', '凉森玲梦'], ['凉森れむ', '凉森玲梦'],
    ['八掛うみ', '八挂海'], ['八挂うみ', '八挂海'],
    ['三上悠亜', '三上悠亚'], ['桃乃木かな', '桃乃木香奈'],
    ['相沢みなみ', '相泽南'], ['相泽みなみ', '相泽南'],
    ['森沢かな', '森泽佳奈'], ['森泽かな', '森泽佳奈'],
    ['七沢みあ', '七泽米亚'], ['蓮実クレア', '莲实克蕾雅'],
    ['橋本ありな', '桥本有菜'], ['新ありな', '新有菜'],
  ]) assert.equal(getTrustedChineseActorName(name), chinese, name);
});

test('unverified names, wrong-name spellings, generic nicknames and romanizations never guess Chinese', () => {
  for (const name of ['藤井いよな', 'かのんちゃん', '初美なのか', '香水じゅん',
    '鈴森れむ', '铃森れむ', '白峰ミウ', 'ミウ', 'ひかり', '未登録ひかり',
    'Remu Suzumori', 'Yuko Ono', 'miru', 'amateur', '', null]) {
    assert.equal(getTrustedChineseActorName(name), '', String(name));
  }
  assert.equal(ACTRESS_NAME_FIXES.has('藤井いよな'), false);
  assert.equal(ACTRESS_NAME_FIXES.has('かのんちゃん'), false);
  assert.equal(ACTRESS_NAME_FIXES.has('鈴森れむ'), false);
});
