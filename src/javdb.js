import * as cheerio from 'cheerio';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import * as OpenCC from 'opencc-js';
import { ACTRESS_NAME_FIXES } from './actress-names.js';

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const zh = (text = '') => toSimplified(String(text));

// Keep proper nouns out of generic machine-translation mistakes.
// Example: Google renders 白峰ミウ as 白峰美宇, but ミウ as a Japanese given name is normally 美羽.
const TITLE_TRANSLATION_FIXES = [
  [/白峰美宇/g, '白峰美羽'],
];

function fixTitleTranslation(text = '') {
  let fixed = String(text || '');
  for (const [from, to] of TITLE_TRANSLATION_FIXES) fixed = fixed.replace(from, to);
  return fixed;
}

const execFileAsync = promisify(execFile);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export function normalizeCode(input) {
  const code = String(input || '')
    .trim()
    .replace(/^\/[a-z_]+(@\w+)?\s*/i, '')
    .replace(/\s+/g, '-')
    .replace(/[＿_]/g, '-')
    .replace(/-C$/i, '')
    .toUpperCase();
  const fc2 = /^(?:FC2(?:-PPV)?-)?(\d{5,})$/.exec(code);
  if (fc2) return `FC2-PPV-${fc2[1]}`;
  return code;
}

function htmlEscape(text = '') {
  return String(text).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;'
  }[m]));
}

function toHashTag(text = '') {
  const t = String(text).trim().replace(/\s+/g, '');
  if (!t) return '';
  return `#${t.replace(/[#.,，。:：;；!！?？()（）\[\]【】{}<>《》'"“”‘’、/\\|]/g, '')}`;
}

async function translateNameToZh(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const mapped = ACTRESS_NAME_FIXES.get(raw) || ACTRESS_NAME_FIXES.get(zh(raw));
  if (mapped) return mapped;
  // Common actress-name transliteration fixes. Google Translate often renders names too literally.
  const nameFixes = [
    [/ミウ/g, '美羽'],
    [/みう/g, '美羽'],
    [/ヒカリ/g, '光'],
    [/ひかり/g, '光'],
  ];
  let fixed = raw;
  for (const [from, to] of nameFixes) fixed = fixed.replace(from, to);
  if (fixed !== raw && !/[\u3040-\u30ff]/.test(fixed)) return zh(fixed).replace(/\s+/g, '');
  if (!/[\u3040-\u30ff]/.test(raw)) return zh(raw).replace(/\s+/g, '');
  const translated = await translateJaToZh(raw);
  return zh(translated).replace(/\s+/g, '');
}

async function curlText(url, referer = 'https://javdb.com/') {
  const { stdout } = await execFileAsync('curl', [
    '-fsSL', '--compressed', '--max-time', '25',
    '-A', UA,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
    '-H', `Referer: ${referer}`,
    url,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function translateJaToZh(text) {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  // If the title contains Japanese kana, translate it to Simplified Chinese.
  if (!/[\u3040-\u30ff]/.test(raw)) return zh(raw);
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=zh-CN&dt=t&q=${encodeURIComponent(raw)}`;
    const { stdout } = await execFileAsync('curl', [
      '-fsSL', '--compressed', '--max-time', '12',
      '-A', UA,
      '-H', 'Accept: application/json,text/plain,*/*',
      url,
    ], { maxBuffer: 1024 * 1024 });
    const data = JSON.parse(stdout);
    const translated = (data?.[0] || []).map((part) => part?.[0] || '').join('').trim();
    return fixTitleTranslation(zh(translated || raw));
  } catch {
    return fixTitleTranslation(zh(raw));
  }
}

async function curlBinary(url, outPath, referer = 'https://javdb.com/') {
  await execFileAsync('curl', [
    '-fsSL', '--compressed', '--max-time', '35',
    '-A', UA,
    '-H', 'Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
    '-H', `Referer: ${referer}`,
    '-o', outPath,
    url,
  ], { maxBuffer: 1024 * 1024 });
}

function absUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://javdb.com${url}`;
  return url;
}

function parseSearch(html) {
  const $ = cheerio.load(html);
  return $('.movie-list .item').toArray().map((el) => {
    const $a = $(el).find('a').first();
    const title = $a.find('.video-title').text().trim().replace(/\s+/g, ' ');
    const code = normalizeCode((/(FC2(?:-PPV)?-\d+|[A-Za-z]+-\d+)/i.exec(title)?.[1] || ''));
    return {
      code,
      title: zh(title),
      link: absUrl($a.attr('href') || ''),
      thumb: absUrl($a.find('.cover img').attr('src') || $a.find('img').attr('src') || ''),
      score: zh($a.find('.score span.value').text().trim()),
      meta: zh($a.find('.meta').text().trim().replace(/\s+/g, ' ')),
    };
  }).filter(x => x.link && x.title);
}

function parseDetail(html) {
  const $ = cheerio.load(html);
  const getValue = (label) => $(`.panel-block strong:contains("${label}")`).parent().find('.value').text().trim().replace(/\s+/g, ' ');
  const getLinkValue = (label) => $(`.panel-block strong:contains("${label}")`).parent().find('.value a').first().text().trim();
  const getLinks = (label) => $(`.panel-block strong:contains("${label}")`).parent().find('.value a').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const actorBlock = $(`.panel-block strong:contains("演員"), .panel-block strong:contains("演员")`).parent().find('.value');
  const actors = actorBlock.find('a').map((_, el) => {
    const $el = $(el);
    const gender = $el.next('.symbol').hasClass('female') ? 'female' : ($el.next('.symbol').hasClass('male') ? 'male' : 'unknown');
    return { name: zh($el.text().trim()), gender };
  }).get().filter((a) => a.name);
  return {
    rawTitle: $('.current-title').first().text().trim().replace(/\s+/g, ' '),
    director: zh(getLinkValue('導演') || getLinkValue('导演')),
    maker: zh(getLinkValue('片商')),
    series: zh(getLinkValue('系列')),
    releaseDate: zh(getValue('日期')),
    duration: zh(getValue('時長') || getValue('时长')),
    actors: actors.length ? actors : (getLinks('演員').length ? getLinks('演員') : getLinks('演员')).map((name) => ({ name: zh(name), gender: 'unknown' })),
    tags: (getLinks('類別').length ? getLinks('類別') : getLinks('类别')).map(zh),
    score: zh($('.score .value').first().text().trim()),
    cover: absUrl($('.video-cover img').attr('src') || $('.cover img').attr('src') || ''),
  };
}

export async function queryJavdb(input) {
  const code = normalizeCode(input);
  if (!code || !/(?:FC2-PPV-\d+|[A-Z]+-?\d+)/.test(code)) throw new Error('请输入番号，例如：SSIS-001');

  const searchUrl = `https://javdb.com/search?q=${encodeURIComponent(code)}&f=all`;
  const searchHtml = await curlText(searchUrl);
  const items = parseSearch(searchHtml);
  const item = items.find((it) => it.code === code) || items[0];
  if (!item) throw new Error('未找到相关番号');

  const detailHtml = await curlText(item.link, searchUrl);
  const detail = parseDetail(detailHtml);
  const cover = detail.cover || item.thumb;
  const originalTitle = detail.rawTitle || item.title || code;
  const translatedTitle = await translateJaToZh(originalTitle);

  const femaleActors = (detail.actors || []).filter((a) => a.gender === 'female');
  const displayActors = femaleActors.length ? femaleActors : (detail.actors || []).filter((a) => a.gender !== 'male');
  const actorTags = [];
  for (const actor of displayActors) {
    const rawName = actor.name;
    const zhName = await translateNameToZh(rawName);
    // Actor tags are ordered as: original Japanese name first, then Simplified Chinese name.
    for (const name of [rawName, zhName]) {
      const tag = toHashTag(name);
      if (tag && !actorTags.includes(tag)) actorTags.push(tag);
    }
  }
  const tagTags = (detail.tags || []).slice(0, 20).map(toHashTag).filter(Boolean);

  const caption = [
    `<b>番号：</b>${toHashTag(item.code || code)}`,
    `<b>标题：</b>${htmlEscape(translatedTitle || item.title || code)}`,
    detail.releaseDate ? `<b>日期：</b>${htmlEscape(detail.releaseDate)}` : '',
    actorTags.length ? `<b>演员：</b>${htmlEscape(actorTags.join(' '))}` : '',
    tagTags.length ? `<b>标签：</b>${htmlEscape(tagTags.join(' '))}` : '',
  ].filter(Boolean).join('\n');

  return { code, item, detail, cover, caption };
}

export async function downloadCover(coverUrl, tmpRoot) {
  if (!coverUrl) return null;
  const parsedUrl = new URL(coverUrl);
  const ext = extname(parsedUrl.pathname) || '.jpg';
  const hostname = parsedUrl.hostname;
  const referer = hostname.includes('fourhoi.com') ? 'https://missav.ai/' : 'https://javdb.com/';
  const dir = await mkdtemp(join(tmpRoot || tmpdir(), 'javdb-cover-'));
  const file = join(dir, `cover${ext}`);
  try {
    await curlBinary(coverUrl, file, referer);
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  return { file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
