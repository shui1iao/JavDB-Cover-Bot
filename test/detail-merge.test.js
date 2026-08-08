import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeThreeXPlanetDetail } from '../src/jav321.js';

test('3xplanet fills missing Aircontrol metadata without replacing the official cover', () => {
  const official = {
    rawTitle: 'Official title',
    maker: 'Aircontrol',
    releaseDate: '2026-08-25',
    code: 'OME-713',
    actors: [],
    tags: [],
    cover: 'https://www.i-dol.tv/contents/works/ome713/ome713-ps.jpg',
    source: 'aircontrol',
  };
  const fallback = {
    rawTitle: 'Aggregator title',
    maker: 'Other maker',
    releaseDate: '2026-08-26',
    code: 'OME-713',
    actors: ['桐山瑠衣'],
    tags: ['巨乳'],
    cover: 'https://3xplanetimg.com/ome713_cover.jpg',
    source: '3xplanet',
  };

  assert.deepEqual(mergeThreeXPlanetDetail({ ...official }, fallback), {
    ...official,
    actors: ['桐山瑠衣'],
    tags: ['巨乳'],
  });
});
