import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Load the real entry point, but replace every network-facing dependency.
// No dotenv credentials, upstream requests, or Telegram calls are used.
const stateKey = '__javCoverBotTest';
const state = { commands: new Map() };
let root;
let savedEnv;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'bot-query-test-'));
  savedEnv = { ...process.env };
  Object.assign(process.env, { BOT_TOKEN: 'test-only', TMP_DIR: root, ALLOWED_USER_IDS: '42', SPOILER: 'true' });
  globalThis[stateKey] = state;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const modules = {
        'dotenv/config': 'export {};',
        telegraf: `const state = globalThis.${stateKey};
          export class Telegraf {
            telegram = { setMyCommands: async () => {}, setMyDescription: async () => {}, setMyShortDescription: async () => {} };
            start() {} help() {} catch() {} stop() {} async launch() {}
            command(names, fn) { for (const name of names) state.commands.set(name, fn); }
            on(event, fn) { state.handler = fn; }
          }`,
        './jav321.js': `export const normalizeCode = raw => String(raw || '').trim().toUpperCase();
          export const queryJav321 = (...args) => globalThis.${stateKey}.query(...args);`,
        './cover-recovery.js': `export const recoverCover = (...args) => globalThis.${stateKey}.download(...args);`,
      };
      if (context.parentURL === new URL('../src/bot.js', import.meta.url).href && specifier in modules) {
        return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const sigint = process.listeners('SIGINT');
  const sigterm = process.listeners('SIGTERM');
  try {
    await import('../src/bot.js');
  } finally {
    hooks.deregister();
    for (const listener of process.listeners('SIGINT')) if (!sigint.includes(listener)) process.removeListener('SIGINT', listener);
    for (const listener of process.listeners('SIGTERM')) if (!sigterm.includes(listener)) process.removeListener('SIGTERM', listener);
    process.env = savedEnv;
  }
});
after(async () => {
  delete globalThis[stateKey];
  await rm(root, { recursive: true, force: true });
});

const caption = '<b>番号：</b>#KBI-098\n<b>标题：</b>测试 &amp; 简介';
function setup(t) {
  const replies = [];
  const photos = [];
  const deleted = [];
  const errors = t.mock.method(console, 'error', () => {});
  const warnings = t.mock.method(console, 'warn', () => {});
  const cleanup = t.mock.fn(async () => {});
  state.query = t.mock.fn(async () => ({ cover: 'https://example.invalid/cover.jpg', caption }));
  state.download = t.mock.fn(async () => ({ file: '/mock/cover.jpg', cleanup }));
  const ctx = {
    from: { id: 42 }, chat: { id: 99 }, message: { text: 'kbi-098' },
    reply: async (...args) => { replies.push(args); return { message_id: 123 }; },
    replyWithPhoto: async (...args) => { photos.push(args); },
    telegram: { deleteMessage: async (...args) => { deleted.push(args); } },
  };
  return { ctx, replies, photos, deleted, errors, warnings, cleanup };
}

test('cover timeout returns successful HTML metadata instead of query failure and removes loader', async (t) => {
  const { ctx, replies, photos, deleted, errors, warnings } = setup(t);
  const failure = new Error('Command failed: curl --max-time 35 secret-url: timeout');
  state.download = t.mock.fn(async () => { throw failure; });
  await state.handler(ctx);
  assert.deepEqual(replies, [
    ['🔎 正在查询...'],
    [caption, { parse_mode: 'HTML', disable_web_page_preview: false }],
  ]);
  assert.deepEqual(photos, []);
  assert.deepEqual(deleted, [[99, 123]]);
  assert.equal(errors.mock.callCount(), 0);
  assert.ok(warnings.mock.calls.some(({ arguments: args }) => args.includes(failure)), 'server log retains the actual cover error');
});

test('successful cover preserves photo HTML and spoiler options and cleans both resources', async (t) => {
  const { ctx, replies, photos, deleted, cleanup } = setup(t);
  await state.commands.get('av')(ctx);
  assert.deepEqual(replies, [['🔎 正在查询...']]);
  assert.deepEqual(photos, [[{ source: '/mock/cover.jpg' }, { caption, parse_mode: 'HTML', has_spoiler: true }]]);
  assert.deepEqual(deleted, [[99, 123]]);
  assert.equal(cleanup.mock.callCount(), 1);
  assert.deepEqual(state.query.mock.calls[0].arguments, ['KBI-098']);
  assert.equal(state.download.mock.calls[0].arguments[1], root);
});

test('lookup failure stays a failure without leaking curl details and removes loader', async (t) => {
  const { ctx, replies, photos, deleted, errors } = setup(t);
  const failure = new Error('Command failed: curl secret-url --max-time 25');
  state.query = t.mock.fn(async () => { throw failure; });
  await state.handler(ctx);
  assert.deepEqual(replies, [['🔎 正在查询...'], ['❌ 查询失败，请稍后重试。']]);
  assert.deepEqual(photos, []);
  assert.equal(state.download.mock.callCount(), 0);
  assert.deepEqual(deleted, [[99, 123]]);
  assert.ok(errors.mock.calls.some(({ arguments: args }) => args.includes(failure)), 'server log retains the actual lookup error');
});

test('photo send failure still cleans cover and loading message', async (t) => {
  const { ctx, replies, deleted, cleanup } = setup(t);
  ctx.replyWithPhoto = async () => { throw new Error('Telegram unavailable'); };
  await state.handler(ctx);
  assert.deepEqual(replies, [['🔎 正在查询...'], ['❌ 查询失败，请稍后重试。']]);
  assert.deepEqual(deleted, [[99, 123]]);
  assert.equal(cleanup.mock.callCount(), 1);
});

test('failed error reply still removes loader in finally', async (t) => {
  const { ctx, deleted } = setup(t);
  state.query = async () => { throw new Error('lookup failed'); };
  const reply = ctx.reply;
  ctx.reply = async (text, ...args) => {
    if (text.startsWith('❌')) throw new Error('reply unavailable');
    return reply(text, ...args);
  };
  await assert.rejects(state.handler(ctx), /reply unavailable/);
  assert.deepEqual(deleted, [[99, 123]]);
});

test('missing primary and exhausted recovery retain existing text path', async (t) => {
  const { ctx, replies, deleted } = setup(t);
  state.query = async () => ({ code: 'KBI-098', caption });
  state.download = t.mock.fn(async () => null);
  await state.handler(ctx);
  assert.deepEqual(replies[1], [caption, { parse_mode: 'HTML', disable_web_page_preview: false }]);
  assert.equal(state.download.mock.callCount(), 1);
  assert.deepEqual(deleted, [[99, 123]]);
});

test('missing primary cover can still return a recovered photo', async (t) => {
  const { ctx, photos, replies, cleanup } = setup(t);
  state.query = async () => ({ code: 'KBI-098', caption });
  await state.handler(ctx);
  assert.equal(photos.length, 1);
  assert.deepEqual(replies, [['🔎 正在查询...']]);
  assert.equal(cleanup.mock.callCount(), 1);
});

test('permissions and empty input do not start a lookup', async (t) => {
  const { ctx, replies, deleted } = setup(t);
  ctx.from.id = 7;
  await state.handler(ctx);
  ctx.from.id = 42;
  ctx.message.text = '';
  await state.handler(ctx);
  assert.deepEqual(replies, [['无权限使用。'], ['发送番号即可查询，例如：SSIS-001']]);
  assert.equal(state.query.mock.callCount(), 0);
  assert.deepEqual(deleted, []);
});
