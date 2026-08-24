import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseJav321DetailPage,
  parseMissavDetailPage,
  parseThreeXPlanetDetailPage,
} from '../src/jav321.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('JAV321 detail validation rejects a similar product code instead of substring matching', () => {
  const html = fixture('jav321-similar-code.html');

  assert.equal(parseJav321DetailPage(html, 'OME-713'), null);
  assert.equal(parseJav321DetailPage(html, 'OME-7130')?.code, 'OME-7130');
});

test('MissAV detail validation rejects a soft-404 page that only recommends the requested code', () => {
  assert.equal(parseMissavDetailPage(fixture('missav-soft-404.html'), 'OME-713'), null);
});

test('MissAV detail validation accepts only the exact canonical product code', () => {
  const detail = parseMissavDetailPage(fixture('missav-exact.html'), 'OME713');

  assert.ok(detail);
  assert.equal(detail.code, 'OME-713');
  assert.equal(detail.rawTitle, '桐山瑠衣 / OME-713 sample');
});

test('3xplanet detail validation rejects a page whose code only starts with the request', () => {
  const html = fixture('three-x-planet-similar-code.html');

  assert.equal(parseThreeXPlanetDetailPage(html, 'OME-713'), null);
  assert.equal(parseThreeXPlanetDetailPage(html, 'OME-7130')?.code, 'OME-7130');
});

test('3xplanet detail validation rejects soft-404/search pages containing recommendations', () => {
  assert.equal(parseThreeXPlanetDetailPage(fixture('three-x-planet-soft-404.html'), 'OME-713'), null);
});

test('3xplanet accepts an exact FC2 page without legacy metadata blocks', () => {
  const html = `
    <html><head>
      <link rel="canonical" href="https://3xplanet.com/fc2-ppv-4961121/">
      <meta property="og:url" content="https://3xplanet.com/fc2-ppv-4961121/">
      <meta property="og:image" content="https://3xplanetimg2.com/images/FC2-PPV-4961121_cover.jpg">
      <meta name="description" content="ビデオ情報 / Video Info 出演者 / Actress amateur メーカー / Studio FC2">
    </head><body>
      <h1>FC2-PPV-4961121 sample title</h1>
    </body></html>`;

  const detail = parseThreeXPlanetDetailPage(html, 'FC2-PPV-4961121');

  assert.ok(detail);
  assert.equal(detail.code, 'FC2-PPV-4961121');
  assert.equal(detail.cover, 'https://3xplanetimg2.com/images/FC2-PPV-4961121_cover.jpg');
});
