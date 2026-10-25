import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as OpenCC from 'opencc-js';
import { translateTitleToZh } from './title-translation.js';
import { normalizeCategoryTags, categoryHashTag } from './category-tags.js';

const execFileAsync = promisify(execFile);
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const zh = (text = '') => toSimplified(String(text));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const TITLE_TRANSLATION_FIXES = [
  [/白峰美宇/g, '白峰美羽'],
  [/Remu Suzumori/gi, '凉森玲梦'],
  [/Suzumori Remu/gi, '凉森玲梦'],
  [/铃森蕾梦/g, '凉森玲梦'],
  [/鈴森蕾梦/g, '凉森玲梦'],
  [/您可以/g, '你可以'],
];

function fixTitleTranslation(text = '') {
  let fixed = String(text || '');
  for (const [from, to] of TITLE_TRANSLATION_FIXES) fixed = fixed.replace(from, to);
  return fixed;
}

import { coreSync, lookupPublic } from './catalog-core.js';
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
  const aircontrol = /^(O(?:AE|ME))-?(\d+)$/.exec(code);
  if (aircontrol) return `${aircontrol[1]}-${aircontrol[2]}`;
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

async function translateJaToZh(text, force = false) {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  if (!force && !/[\u3040-\u30ff]/.test(raw)) return zh(raw);
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

function unique(arr) { return [...new Set(arr.filter(Boolean))]; }

const GENRE_TRANSLATIONS = new Map([
  ['Big Tits', '巨乳'],
  ['Big Breasts', '巨乳'],
  ['Featured Actress', '单体作品'],
  ['Individual', '单体作品'],
  ['Hi-Def', '高清'],
  ['Hd', '高清'],
  ['ハイビジョン', '高清'],
  ['中出し', '中出'],
  ['フェラ', '口交'],
  ['独占配信', '独家'],
  ['おもちゃ', '玩具'],
  ['女子校生', '女学生'],
  ['東京恋人他30％OFF', ''],
  ['东京恋人他30％OFF', ''],
  ['东京恋人他30%OFF', ''],
  ['Idol Video', '写真'],
  ['Advertising Idol', '写真偶像'],
  ['Sexy', '性感'],
  ['Tall Girl', '高个子'],
  ['Tall Lady', '高个子'],
  ['Beautiful Girl', '美少女'],
  ['Pretty Girl', '美少女'],
  ['姉・妹', '姐妹'],
  ['姉妹', '姐妹'],
  ['単体作品', '单体作品'],
  ['寝取り・寝取られ・ＮＴＲ', 'NTR'],
  ['寝取り・寝取られ・NTR', 'NTR'],
  ['ハメ撮り', '自拍性爱'],
  ['スレンダー', '苗条'],
  ['ドラマ', '剧情'],
  ['アイドル・芸能人', '偶像艺人'],
  ['アクメ・オーガズム', '高潮'],
  ['潮吹き', '潮吹'],
  ['スポーツ', '运动'],
  ['カワイイ', '可爱'],
  ['水着', '泳装'],
  ['ランジェリー', '内衣'],
  ['イメージビデオ', '写真'],
  ['ノーブラ', '无胸罩'],
  ['Pantyhose', '连裤袜'],
  ['Creampie', '中出'],
  ['Cheating Wife', 'NTR'],
  ['Married Woman', '人妻'],
  ['Exclusive Distribution', '独家'],
  ['Deep Throat', '深喉'],
  ['Drama', '剧情'],
  ['Fetish', '恋物'],
  ['Handjob', '手交'],
  ['Tit Job', '乳交'],
  ['Kissing', '接吻'],
  ['Kiss', '接吻'],
  ['Cunnilingus', '舔阴'],
  ['Beautiful Breasts', '美乳'],
  ['Lingerie', '内衣'],
  ['Mature Woman', '熟女'],
  ['Milf', '熟女'],
  ['Nurse', '护士'],
  ['Office Lady', 'OL'],
  ['Orgy', '乱交'],
  ['POV', '主观视角'],
  ['Subjective Perspective', '主观视角'],
  ['Doggy Style', '后入'],
  ['School Girl', '女学生'],
  ['Slender', '苗条'],
  ['Squirting', '潮吹'],
  ['Teacher', '教师'],
  ['Threesome', '3P'],
  ['VR Exclusive', 'VR'],
  ['My Amateur', '素人作品'],
  ['CENSORED', '有码'],
  ['Cum Inside', '中出'],
  ['Toy', '玩具'],
  ['Masturbation', '自慰'],
  ['Blowjob', '口交'],
  ['Uncensored', '无码'],
  ['Affair', '出轨'],
  ['Cowgirl', '骑乘位'],
  ['Housewife', '人妻'],
  ['Mature', '熟女'],
]);

const CANONICAL_GENRES = new Set([...GENRE_TRANSLATIONS.values()].filter(Boolean));
const TAG_ORDER = ['人妻', '巨乳', '单体作品', 'NTR', '中出', '高清', '独家'];

function translateGenre(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (GENRE_TRANSLATIONS.has(raw)) return GENRE_TRANSLATIONS.get(raw);
  const titleCase = raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  if (GENRE_TRANSLATIONS.has(titleCase)) return GENRE_TRANSLATIONS.get(titleCase);
  return zh(raw);
}


function cleanTitle(text = '', code = '') {
  let t = decodeBasicEntities(String(text || ''));
  t = t.replace(/<\/?title\b[^>]*>/gi, ' ')
    .replace(/<meta\b[\s\S]*$/i, ' ')
    .replace(/&lt;\/?title\b[\s\S]*$/i, ' ')
    .replace(/&lt;meta\b[\s\S]*$/i, ' ')
    .replace(/\s*(?:エロ動画|アダルトビデオ|MGS動画|Prestige Group|プレステージ グループ)\s*[\s\S]*$/i, ' ')
    .replace(/^[A-Z]+-?\d+\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (code) {
    const escapedCode = String(code).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`\\b${escapedCode}\\b`, 'ig');
    t = t.replace(re, '').replace(/\s+/g, ' ').trim();
    const fc2 = /^FC2-PPV-(\d+)$/i.exec(String(code));
    if (fc2) {
      const fc2TitleRe = new RegExp(`\\b(?:FC2\\s*(?:-|\\s)?PPV\\s*(?:-|\\s)?|FC2\\s*(?:-|\\s)?|PPV\\s*(?:-|\\s)?)${fc2[1]}\\b`, 'ig');
      t = t.replace(fc2TitleRe, '').replace(/\s+/g, ' ').trim();
    }
  }
  return t;
}

function decodeBasicEntities(text = '') {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&hellip;/g, '…');
}

const BLOCKED_TAGS = new Set(['无码破解', '有码', 'CENSORED']);

function normalizeTags(tags = []) {
  const normalized = unique(tags.filter(Boolean).map((tag) => String(tag).trim()).filter((tag) => tag && !BLOCKED_TAGS.has(tag)));
  return normalized.sort((a, b) => {
    const ai = TAG_ORDER.indexOf(a);
    const bi = TAG_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return 0;
  });
}

const S1_MAKER_ALIASES = new Set([
  'エスワン',
  'エスワンナンバーワンスタイル',
  's1',
  's1no1style',
  'esuwan',
  'esuwannumberonestyle',
]);

const MOODYZ_MAKER_ALIASES = new Set([
  'ムーディーズ',
  'moodyz',
]);

function normalizeMaker(maker = '') {
  return String(maker)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
}

export function isS1Maker(maker = '') {
  return S1_MAKER_ALIASES.has(normalizeMaker(maker));
}

export function isMoodyzMaker(maker = '') {
  return MOODYZ_MAKER_ALIASES.has(normalizeMaker(maker));
}

export async function translateOfficialTags(tags = [], translator = null) {
  const translate = translator || ((tag) => translateJaToZh(tag, true));
  const translated = [];
  for (const tag of tags) {
    const shouldTranslate = !CANONICAL_GENRES.has(tag) && /[\u3040-\u30ff\u3400-\u9fff]/.test(tag);
    const text = shouldTranslate ? await translate(tag) : tag;
    const normalized = translateGenre(zh(text)).trim();
    const untranslated = shouldTranslate && (
      normalized === zh(tag).trim() || /[\u3040-\u30ff]/.test(normalized)
    );
    if (!untranslated && normalized && !BLOCKED_TAGS.has(normalized) && !translated.includes(normalized)) translated.push(normalized);
  }
  return translated;
}


export function isExactProductCode(a, b) {
  return coreSync('codes', [a, b]).same_work;
}
export function isJavdbCover(url = '') {
  try { return /(^|\.)(javdb\.com|jdbstatic\.com|jdbimgs\.com|tp\.spfcas\.com)$/.test(new URL(url).hostname); }
  catch { return false; }
}

export async function queryJav321(input, { coreOptions = {}, translateTitle = translateTitleToZh, translateTags = null } = {}) {
  const code = normalizeCode(input);
  if (!code || !/(?:FC2-PPV-\d+|[A-Z]+-?\d+)/.test(code)) throw new Error('请输入番号，例如：SSIS-001');
  const result = await lookupPublic(code, coreOptions);
  const fields = result.metadata;
  if (!['title', 'performers', 'studio', 'release_date', 'tags'].some(k => fields[k]?.length)) throw new Error('未找到相关番号');
  const tags = normalizeTags(normalizeCategoryTags(fields.tags || []));
  const actors = result.cast.map(a => a.name);
  let originalTitle = cleanTitle(fields.title || result.code, result.code).replace(/[」』"'“”‘’：:、，。\s]+$/g, '').trim();
  const chineseTitle = /\p{Script=Han}/u.test(originalTitle) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(originalTitle.normalize('NFKC'));
  const translatedTitle = cleanTitle(chineseTitle ? zh(originalTitle) : fixTitleTranslation(zh(await translateTitle(originalTitle, { names: actors }))), result.code).replace(/[」』"'“”‘’：:、，。\s]+$/g, '').trim();
  const actorTags = [];
  for (const actor of result.cast) for (const name of [actor.name, actor.name_zh]) {
    const tag = toHashTag(name || '');
    if (tag && !actorTags.includes(tag)) actorTags.push(tag);
  }
  const tagTags = /^(?:FC2-PPV-|FC2-)/i.test(result.code) ? [] : tags.slice(0, 20).map(categoryHashTag).filter(Boolean);
  const caption = [
    `<b>番号：</b>${toHashTag(result.code)}`,
    `<b>标题：</b>${htmlEscape(translatedTitle || result.code)}`,
    fields.release_date ? `<b>日期：</b>${htmlEscape(zh(fields.release_date))}` : '',
    actorTags.length ? `<b>演员：</b>${htmlEscape(actorTags.join(' '))}` : '',
    tagTags.length ? `<b>标签：</b>${htmlEscape(tagTags.join(' '))}` : '',
  ].filter(Boolean).join('\n');
  return { code: result.code, detail: { code: result.code, rawTitle: originalTitle, maker: fields.studio || '', releaseDate: fields.release_date || '', actors, tags },
    caption, cover: result.cover?.url || '', publicMetadata: result, source: 'shared-catalog' };
}
