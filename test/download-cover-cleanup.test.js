import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadCover } from '../src/javdb.js';

async function fixture(t, status, body) {
  const root = await mkdtemp(join(tmpdir(), 'cover-cleanup-test-'));
  const server = createServer((req, res) => { res.writeHead(status); res.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, url: `http://127.0.0.1:${server.address().port}/cover.jpg` };
}

test('failed curl removes its temporary directory', async t => {
  const { root, url } = await fixture(t, 503, 'unavailable');
  await assert.rejects(downloadCover(url, root), /curl/);
  assert.deepEqual(await readdir(root), []);
});

test('invalid cover URL does not leak a temporary directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cover-invalid-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(downloadCover('not-a-url', root));
  assert.deepEqual(await readdir(root), []);
});

test('successful download remains available until cleanup', async t => {
  const { root, url } = await fixture(t, 200, 'cover-fixture');
  const cover = await downloadCover(url, root);
  assert.equal(await readFile(cover.file, 'utf8'), 'cover-fixture');
  await cover.cleanup();
  assert.deepEqual(await readdir(root), []);
});
