import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as covers from '../src/cover-recovery.js';

// Synthetic dimension fixtures; never used in production or live checks.
const png = await readFile(new URL('./fixtures/landscape.png', import.meta.url));
const portrait = await readFile(new URL('./fixtures/portrait.png', import.meta.url));
const primary = 'https://primary.invalid/landscape.jpg';
const alternate = 'https://secondary.invalid/cover.jpg';
const result = { code: 'KBI-098', cover: primary, caption: 'unchanged' };
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'cover-recovery-test-'));
  const temp = join(root, 'tmp');const cache = join(root, 'cache');await mkdir(temp);
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = { calls: [], failures: new Set(), bodies: new Map(), discoveries: [], alternatives: [alternate] };
  const options = {
    cacheRoot: cache,
    download: async (url, tmpRoot, config) => {
      state.calls.push(url);assert.ok(config.timeoutSeconds <= 8);
      assert.equal(config.officialFallback,false);
      if (state.failures.has(url)) throw Error('timeout');
      const dir = await mkdtemp(join(tmpRoot, 'download-'));const file=join(dir,'image.jpg');
      await writeFile(file, state.bodies.get(url) || png);
      return {file,cleanup:()=>rm(dir,{recursive:true,force:true})};
    },
    alternatives: async function* (code) { state.discoveries.push(code);yield* state.alternatives; },
  };
  return { root, temp, cache, state, options };
}

test('healthy original landscape wins even if a fallback was cached previously', async t => {
  const {temp,state,options}=await setup(t);
  state.failures.add(primary);
  const first=await covers.recoverCover(result,temp,options);await first.cleanup();
  state.failures.clear();state.calls=[];state.discoveries=[];
  const next=await covers.recoverCover(result,temp,options);
  assert.equal(next.source,primary);assert.deepEqual(state.calls,[primary]);assert.deepEqual(state.discoveries,[]);
  await next.cleanup();assert.deepEqual(await readdir(temp),[]);
});

test('primary timeout discovers a same-code alternate and preserves result metadata', async t => {
  const {temp,state,options}=await setup(t);state.failures.add(primary);
  const copy=structuredClone(result);const cover=await covers.recoverCover(result,temp,options);
  assert.deepEqual(state.calls,[primary,alternate]);assert.deepEqual(state.discoveries,['KBI-098']);
  assert.equal(cover.source,alternate);assert.deepEqual(await readFile(cover.file),png);
  assert.deepEqual(result,copy);await cover.cleanup();assert.deepEqual(await readdir(temp),[]);
});

test('cache survives a new call and all-source outage but does not replace primary priority', async t => {
  const {temp,state,options}=await setup(t);state.failures.add(primary);
  const first=await covers.recoverCover(result,temp,options);await first.cleanup();
  state.failures.add(alternate);state.calls=[];state.discoveries=[];
  const cached=await covers.recoverCover(result,temp,options);
  assert.equal(cached.source,'cache');assert.deepEqual(state.calls,[primary]);assert.deepEqual(state.discoveries,[]);
  assert.deepEqual(await readFile(cached.file),png);await cached.cleanup();
});

test('cache never crosses product codes', async t => {
  const {temp,state,options}=await setup(t);
  const first=await covers.recoverCover(result,temp,options);await first.cleanup();
  state.failures=new Set([primary,alternate]);
  await assert.rejects(covers.recoverCover({...result,code:'KBI-099'},temp,options),/cover/i);
});

test('HTML 200 response is rejected, cleaned and replaced by an actual image', async t => {
  const {temp,state,options}=await setup(t);state.bodies.set(primary,Buffer.from('<html>challenge</html>'));
  const cover=await covers.recoverCover(result,temp,options);assert.equal(cover.source,alternate);
  await cover.cleanup();assert.deepEqual(await readdir(temp),[]);
});

test('no primary cover still discovers alternatives; duplicate and watermarked sources are skipped', async t => {
  const {temp,state,options}=await setup(t);state.failures.add(primary);
  state.alternatives=[primary,'https://cdn.jdbstatic.com/x.jpg',alternate,alternate];
  const cover=await covers.recoverCover(result,temp,options);
  assert.deepEqual(state.calls,[primary,alternate]);await cover.cleanup();
  const noPrimary=await covers.recoverCover({code:'KBI-100'},temp,options);
  assert.equal(noPrimary.source,alternate);await noPrimary.cleanup();
});

test('corrupt cache is not sent and all failures clean temporary files', async t => {
  const {temp,cache,state,options}=await setup(t);
  const first=await covers.recoverCover(result,temp,options);await first.cleanup();
  for (const file of await readdir(cache)) if (file.endsWith('.image')) await writeFile(join(cache,file),'not an image');
  state.failures=new Set([primary,alternate]);
  await assert.rejects(covers.recoverCover(result,temp,options),/cover/i);
  assert.deepEqual(await readdir(temp),[]);
});

test('cache write failure cannot suppress a successfully downloaded cover', async t => {
  const {temp,root,options}=await setup(t);const blocked=join(root,'not-a-directory');await writeFile(blocked,'x');
  const cover=await covers.recoverCover(result,temp,{...options,cacheRoot:blocked});
  assert.equal(cover.source,primary);await cover.cleanup();
});

test('portrait cache cannot hide an available landscape alternative', async t => {
  const {temp,state,options}=await setup(t);
  state.bodies.set(primary,portrait);
  const initial=await covers.recoverCover(result,temp,options);await initial.cleanup();
  state.failures.add(primary);state.calls=[];
  const cover=await covers.recoverCover(result,temp,options);
  assert.equal(cover.source,alternate);assert.deepEqual(await readFile(cover.file),png);
  await cover.cleanup();assert.deepEqual(await readdir(temp),[]);
});

test('portrait alternative is held while later landscape is tried and then cleaned', async t => {
  const {temp,state,options}=await setup(t);state.failures.add(primary);
  state.bodies.set(alternate,portrait);const wide='https://third.invalid/wide.jpg';
  state.alternatives=[alternate,wide];
  const cover=await covers.recoverCover(result,temp,options);
  assert.equal(cover.source,wide);assert.deepEqual(state.calls,[primary,alternate,wide]);
  await cover.cleanup();assert.deepEqual(await readdir(temp),[]);
});

test('cached portrait remains usable if no landscape source works', async t => {
  const {temp,state,options}=await setup(t);state.bodies.set(primary,portrait);
  const initial=await covers.recoverCover(result,temp,options);await initial.cleanup();
  state.failures=new Set([primary,alternate]);state.discoveries=[];
  const cover=await covers.recoverCover(result,temp,options);
  assert.equal(cover.source,'cache');assert.deepEqual(state.discoveries,['KBI-098']);
  assert.deepEqual(await readFile(cover.file),portrait);await cover.cleanup();
});

test('Prestige original timeout tries a landscape before official portrait', async t => {
  const {temp,state,options}=await setup(t);
  const mirror='https://www.jav321.com/images/prestige/abw/257/pf_o1_abw-257.jpg';
  const official='https://www.prestige-av.com/api/media/goods/prestige/abw/257/pf_abw-257.jpg?w=482&f=jpg';
  state.failures.add(mirror);
  let cover=await covers.recoverCover({code:'ABW-257',cover:mirror},temp,options);
  assert.deepEqual(state.calls,[mirror,alternate]);await cover.cleanup();
  state.calls=[];state.failures.add(alternate);state.bodies.set(official,portrait);
  cover=await covers.recoverCover({code:'ABW-257',cover:mirror},temp,{...options,cacheRoot:join(temp,'empty-cache')});
  assert.deepEqual(state.calls,[mirror,alternate,official]);assert.equal(cover.source,official);
  await cover.cleanup();
});

test('cache has a bounded byte budget', async t => {
  const {temp,cache,options}=await setup(t);
  for(const code of ['KBI-098','KBI-099','KBI-100']){
    const cover=await covers.recoverCover({...result,code},temp,{...options,maxCacheBytes:png.length*2});await cover.cleanup();
  }
  const files=(await readdir(cache)).filter(f=>f.endsWith('.image'));
  let bytes=0;for(const f of files)bytes+=(await readFile(join(cache,f))).length;
  assert.ok(bytes<=png.length*2);
});
