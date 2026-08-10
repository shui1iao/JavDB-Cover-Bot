import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCode, parseAircontrolOfficialDetail } from '../src/jav321.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('Aircontrol codes accept hyphenated and compact input while preserving other routes', () => {
  assert.equal(normalizeCode('OAE-176'), 'OAE-176');
  assert.equal(normalizeCode('OAE176'), 'OAE-176');
  assert.equal(normalizeCode('OME-713'), 'OME-713');
  assert.equal(normalizeCode('OME713'), 'OME-713');
  assert.equal(normalizeCode('4361640'), 'FC2-PPV-4361640');
  assert.equal(normalizeCode('FC2-PPV-4361640'), 'FC2-PPV-4361640');
  assert.equal(normalizeCode('SSIS348'), 'SSIS348');
});

test('Aircontrol parser extracts adjacent actor nodes once across duplicated performer rows', () => {
  const detail = parseAircontrolOfficialDetail(fixture('aircontrol-ome432.html'), 'OME-432');

  assert.ok(detail);
  assert.equal(detail.code, 'OME-432');
  assert.deepEqual(detail.actors, ['徳江かな', '桜りん']);
  assert.equal(detail.cover, 'https://pics.dmm.co.jp/digital/video/ome00432/ome00432pl.jpg');
});

test('Aircontrol parser keeps official portrait art when no matching DMM digital product exists', () => {
  const html = fixture('aircontrol-ome432.html').replace(
    /<a href="http:\/\/www\.dmm\.co\.jp\/digital\/videoa\/[^<]+<\/a>/,
    ''
  );
  const detail = parseAircontrolOfficialDetail(html, 'OME-432');

  assert.ok(detail);
  assert.equal(detail.cover, 'https://www.i-dol.tv/contents/works/ome432/ome432-ps.jpg');
});

test('Aircontrol parser canonicalizes compact input against DVD plus streaming product codes', () => {
  const detail = parseAircontrolOfficialDetail(fixture('aircontrol-ome432.html'), 'OME432');

  assert.ok(detail);
  assert.equal(detail.code, 'OME-432');
  assert.deepEqual(detail.actors, ['徳江かな', '桜りん']);
});

test('Aircontrol parser returns stable Simplified Chinese labels for common OME-713 genres', () => {
  const detail = parseAircontrolOfficialDetail(fixture('aircontrol-ome713.html'), 'OME713');

  assert.ok(detail);
  assert.deepEqual(detail.tags, ['巨乳', '泳装', '内衣', '写真', '无胸罩']);
  assert.doesNotMatch(detail.tags.join(' '), /[\u3040-\u30ff]/);
});
