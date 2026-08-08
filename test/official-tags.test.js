import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMoodyzMaker,
  isS1Maker,
  parseAircontrolOfficialDetail,
  parseMoodyzOfficialTags,
  parseS1OfficialTags,
} from '../src/jav321.js';

const s1DetailHtml = `
  <main>
    <div class="meta-row">
      <div class="th">品番</div>
      <div class="td"><div class="item"><p><span>DVD</span>SSIS348</p></div></div>
    </div>
    <a href="https://s1s1s1.com/works/list/genre/215">巨乳</a>
    <a href="https://s1s1s1.com/works/list/genre/330">美少女</a>
    <a href="https://s1s1s1.com/works/list/genre/5023">姉・妹</a>
    <a href="https://s1s1s1.com/works/list/genre/408">単体作品</a>
    <a href="https://s1s1s1.com/works/list/genre/138">寝取り・寝取られ・ＮＴＲ</a>
  </main>
`;

test('extracts and translates structured genres from the exact S1 product page', () => {
  assert.deepEqual(parseS1OfficialTags(s1DetailHtml, 'SSIS-348'), [
    '巨乳',
    '美少女',
    '姐妹',
    '单体作品',
    'NTR',
  ]);
});

test('rejects S1 genres when a requested code is only a prefix of the page code', () => {
  assert.deepEqual(parseS1OfficialTags(s1DetailHtml, 'SSIS-34'), []);
});

test('recognizes only exact normalized S1 maker aliases', () => {
  for (const maker of ['エスワン', 'エスワン ナンバーワンスタイル', 'S1', 'S1 NO.1 STYLE', 'Esuwan number one style']) {
    assert.equal(isS1Maker(maker), true, maker);
  }
  for (const maker of ['S10', 'MS1', 'NotEsuwan', 'Idea Pocket']) {
    assert.equal(isS1Maker(maker), false, maker);
  }
});

test('translates representative official S1 genres to Simplified Chinese', () => {
  const html = s1DetailHtml.replace(
    '</main>',
    '<a href="/works/list/genre/1">ハメ撮り</a><a href="/works/list/genre/2">スレンダー</a><a href="/works/list/genre/3">ドラマ</a><a href="/works/list/genre/4">アイドル・芸能人</a></main>'
  );
  assert.deepEqual(parseS1OfficialTags(html, 'SSIS-348').slice(-4), [
    '自拍性爱',
    '苗条',
    '剧情',
    '偶像艺人',
  ]);
});

test('extracts and translates structured genres from an exact Moodyz product page', () => {
  const html = `
    <div class="meta-row">
      <div class="th">品番</div>
      <div class="td"><p><span>DVD</span>MIDA687</p></div>
    </div>
    <a href="https://moodyz.com/works/list/genre/71">アクメ・オーガズム</a>
    <a href="https://moodyz.com/works/list/genre/43">潮吹き</a>
    <a href="https://moodyz.com/works/list/genre/103">女子校生</a>
    <a href="https://moodyz.com/works/list/genre/106">スポーツ</a>
    <a href="https://moodyz.com/works/list/genre/330">美少女</a>
  `;

  assert.deepEqual(parseMoodyzOfficialTags(html, 'MIDA-687'), [
    '高潮',
    '潮吹',
    '女学生',
    '运动',
    '美少女',
  ]);
});

test('recognizes only exact normalized Moodyz maker aliases', () => {
  for (const maker of ['ムーディーズ', 'MOODYZ', 'Moodyz']) assert.equal(isMoodyzMaker(maker), true, maker);
  for (const maker of ['MOODYZVR', 'NotMoodyz', 'ムーディーズプラス']) assert.equal(isMoodyzMaker(maker), false, maker);
});

const aircontrolDetailHtml = `
  <main>
    <dl><dt>出演</dt><dd><p>岬ななみ</p></dd></dl>
    <dl><dt>タイトル</dt><dd><h1>ALL NUDE</h1></dd></dl>
    <dl><dt>発売日 :</dt><dd><a>2019年1月25日</a></dd></dl>
    <dl><dt>ジャンル :</dt><dd><a>美乳</a><a>カワイイ</a></dd></dl>
    <dl><dt>レーベル :</dt><dd><a>antenna</a></dd></dl>
    <dl><dt>品番 :</dt><dd><span>DVDOAE176</span></dd></dl>
    <img src="/contents/works/oae176/oae176-ps.jpg" alt="ALL NUDE">
  </main>
`;

test('extracts an exact full detail from an Aircontrol product page', () => {
  assert.deepEqual(parseAircontrolOfficialDetail(aircontrolDetailHtml, 'OAE-176'), {
    rawTitle: 'ALL NUDE',
    maker: 'Aircontrol',
    releaseDate: '2019-01-25',
    code: 'OAE-176',
    actors: ['岬ななみ'],
    tags: ['美乳', '可爱'],
    cover: 'https://www.i-dol.tv/contents/works/oae176/oae176-ps.jpg',
    source: 'aircontrol',
  });
});

test('rejects Aircontrol details when the official page code is only a similar match', () => {
  assert.equal(parseAircontrolOfficialDetail(aircontrolDetailHtml, 'OAE-17'), null);
});
