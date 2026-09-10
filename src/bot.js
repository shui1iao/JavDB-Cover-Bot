import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { recoverCover } from './cover-recovery.js';
import { queryJav321, normalizeCode } from './jav321.js';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN is required');

const tmpDir = process.env.TMP_DIR || './data/tmp';
await mkdir(tmpDir, { recursive: true });

const allowed = new Set(String(process.env.ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const publicAccess = allowed.size === 0;
const spoiler = String(process.env.SPOILER ?? 'true').toLowerCase() !== 'false';

const bot = new Telegraf(token);

function isAllowed(ctx) {
  if (publicAccess) return true;
  return allowed.has(String(ctx.from?.id || ''));
}

bot.start((ctx) => ctx.reply('发送番号即可查询封面和简介，例如：SSIS-001'));
bot.help((ctx) => ctx.reply('直接发送番号，例如：SSIS-001\n也支持：/av SSIS-001'));

async function handleQuery(ctx, raw) {
  if (!isAllowed(ctx)) return ctx.reply('无权限使用。');
  const code = normalizeCode(raw);
  if (!code) return ctx.reply('发送番号即可查询，例如：SSIS-001');
  const loading = await ctx.reply('🔎 正在查询...');
  let coverFile;
  try {
    const result = await queryJav321(code);
    try {
      coverFile = await recoverCover(result, tmpDir, { cacheRoot: join(tmpDir, '..', 'covers') });
    } catch (e) {
      console.warn('[cover]', code, e);
    }
    if (coverFile?.file) {
      await ctx.replyWithPhoto({ source: coverFile.file }, {
        caption: result.caption,
        parse_mode: 'HTML',
        has_spoiler: spoiler,
      });
    } else {
      await ctx.reply(result.caption, { parse_mode: 'HTML', disable_web_page_preview: false });
    }
  } catch (e) {
    console.error('[query]', code, e);
    await ctx.reply('❌ 查询失败，请稍后重试。');
  } finally {
    try { await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id); } catch {}
    await coverFile?.cleanup?.();
  }
}

bot.command(['av', 'jav', 'javdb', 'jd'], (ctx) => handleQuery(ctx, ctx.message.text));
bot.on('text', (ctx) => handleQuery(ctx, ctx.message.text));

bot.catch((err) => console.error('[bot]', err));


await bot.telegram.setMyCommands([
  { command: 'start', description: '开始使用' },
  { command: 'help', description: '查看帮助' },
  { command: 'av', description: '查询番号封面和简介' },
  { command: 'jav', description: '查询番号信息' },
]).catch(() => {});
await bot.telegram.setMyDescription('发送番号，自动返回封面和中文简介。').catch(() => {});
await bot.telegram.setMyShortDescription('番号封面和中文简介查询').catch(() => {});

await bot.launch();
console.log(`javdb-cover-bot started, public=${publicAccess}, spoiler=${spoiler}`);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
