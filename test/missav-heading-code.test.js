import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMissavDetailPage } from '../src/jav321.js';

const page = ({ canonical = 'HOI-371', heading = 'HOI-371 sample', title = 'Sample', extra = '' } = {}) => `
<html><head><title>Product details</title>
<link rel="canonical" href="https://missav.ai/en/${canonical.toLowerCase()}">
<meta property="og:image" content="https://example.test/cover.jpg">
</head><body><main><h1>${heading}</h1>
<div><span>Title:</span><span>${title}</span></div>${extra}</main></body></html>`;

test('MissAV accepts exact canonical and main heading when Title omits code', () => {
  const result = parseMissavDetailPage(page(), 'HOI-371');
  assert.ok(result);
  assert.equal(result.code, 'HOI-371');
  assert.equal(result.rawTitle, 'Sample');
  assert.equal(result.cover, 'https://example.test/cover.jpg');
});

test('MissAV accepts the observed product-title container without a main element', () => {
  const html = page().replace('<main>', '<div class="content-without-search"><div class="flex-1 order-first">')
    .replace('</main>', '</div></div>');
  assert.equal(parseMissavDetailPage(html, 'HOI-371')?.code, 'HOI-371');
});

test('MissAV heading fallback rejects recommendation H1 and ambiguous product headings', () => {
  const cases = [
    page({ heading: 'HOI-372 sample' }).replace('<main>', '<aside><h1>HOI-371 recommendation</h1></aside><main>'),
    page({ heading: 'Sample' }).replace('<main>', '<aside><h1>HOI-371 recommendation</h1></aside><main>'),
    page().replace('<h1>HOI-371 sample</h1>', '<aside><h1>HOI-371 recommendation</h1></aside>'),
    page({ extra: '<h1>HOI-372 other</h1>' }),
    page().replace('<main>', '<div>').replace('</main>', '</div>'),
  ];
  for (const html of cases) assert.equal(parseMissavDetailPage(html, 'HOI-371'), null);
});

test('MissAV heading fallback rejects wrong canonical, heading, conflicting Title and recommendations', () => {
  for (const options of [
    { canonical: 'HOI-3710' },
    { heading: 'HOI-3710 sample' },
    { heading: 'HOI-372 sample' },
    { title: 'HOI-372 sample' },
    { heading: 'Sample', extra: '<aside>HOI-371 recommended</aside>' },
    { heading: 'Video not found', extra: '<aside>HOI-371 recommended</aside>' },
  ]) assert.equal(parseMissavDetailPage(page(options), 'HOI-371'), null, JSON.stringify(options));
});
