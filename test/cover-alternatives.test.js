import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const state={pages:new Map(),calls:[]};globalThis.__coverSourcesTest=state;
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier==='node:child_process' && context.parentURL===new URL('../src/jav321.js',import.meta.url).href){
    const code=`export function execFile(){}
      execFile[Symbol.for('nodejs.util.promisify.custom')]=async(command,args)=>{
        const s=globalThis.__coverSourcesTest;s.calls.push(args);const html=s.pages.get(args.at(-1));
        if(html===undefined)throw Error('upstream unavailable');return {stdout:html,stderr:''};
      };`;
    return {url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true};
  }return next(specifier,context);
}});
const api=await import('../src/jav321.js');hooks.deregister();after(()=>delete globalThis.__coverSourcesTest);
const page=(code,cover)=>`<html><head><title>${code} fixture</title><link rel="canonical" href="https://3xplanet.com/${code.toLowerCase()}/"><meta property="og:image" content="${cover}"></head><body><h1>${code} fixture</h1></body></html>`;
test('alternative discovery yields exact same-code 3xplanet cover lazily and uses bounded requests',async()=>{
  state.calls=[];state.pages=new Map([['https://3xplanet.com/kbi-098/',page('KBI-098','https://images.invalid/kbi-098.jpg')]]);
  assert.equal(typeof api.findCoverAlternatives,'function');
  const iterator=api.findCoverAlternatives('KBI-098');
  assert.deepEqual(await iterator.next(),{value:'https://images.invalid/kbi-098.jpg',done:false});
  await iterator.return();assert.equal(state.calls.length,1);
  assert.equal(state.calls[0][state.calls[0].indexOf('--max-time')+1],'8');
});
test('similar code and watermarked pages never become alternate covers',async()=>{
  for(const html of [page('KBI-0980','https://images.invalid/wrong.jpg'),page('KBI-098','https://cdn.jdbstatic.com/watermark.jpg')]){
    state.pages=new Map([['https://3xplanet.com/kbi-098/',html]]);
    const urls=[];for await(const url of api.findCoverAlternatives('KBI-098'))urls.push(url);
    assert.deepEqual(urls,[]);
  }
});
test('3xplanet failure continues to exact MissAV metadata instead of stopping lookup',async()=>{
  const html='<html><head><link rel="canonical" href="https://missav.ai/en/kbi-098"><meta property="og:image" content="https://fourhoi.com/kbi-098/cover.jpg"></head><body><span>Title:</span><span>KBI-098 fixture</span></body></html>';
  state.pages=new Map([['https://missav.ai/en/kbi-098',html]]);
  const urls=[];for await(const url of api.findCoverAlternatives('KBI-098'))urls.push(url);
  assert.deepEqual(urls,['https://fourhoi.com/kbi-098/cover.jpg']);
});
