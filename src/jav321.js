import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as cheerio from 'cheerio';
import * as OpenCC from 'opencc-js';
import { ACTRESS_NAME_FIXES } from './actress-names.js';
import { queryJavdb } from './javdb.js';

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

function normalizeActorName(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return '';
  if (/^(?:amateur|素人)$/i.test(raw)) return '素人';
  return raw;
}

async function curlText(url, postFields = null, referer = 'https://www.jav321.com/') {
  const args = [
    '-fsSL', '--compressed', '--max-time', '25',
    '-A', UA,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
    '-H', `Referer: ${referer}`,
  ];
  if (postFields) args.push('--data', postFields);
  args.push(url);
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function translateJaToZh(text) {
  const raw = String(text || '').trim();
  if (!raw) return raw;
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

async function translateNameToZh(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const mapped = ACTRESS_NAME_FIXES.get(raw) || ACTRESS_NAME_FIXES.get(zh(raw));
  if (mapped) return mapped;
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

function pickFirst(re, html) {
  const m = re.exec(html);
  return m?.[1]?.trim() || '';
}

function pickAll(re, html) {
  return [...html.matchAll(re)].map((m) => m[1]?.trim()).filter(Boolean);
}

function absDmm(url = '') {
  if (!url) return '';
  let fixed = url.startsWith('//') ? `https:${url}` : url;
  if (fixed.startsWith('http://')) fixed = `https://${fixed.slice(7)}`;
  // DMM ps/jp images are tiny thumbnails; pl is the usable cover size.
  fixed = fixed.replace(/(\/digital\/video\/[^/]+\/[^/.]+)(?:ps|jp)(\.jpg)$/i, '$1pl$2');
  return fixed;
}

// JavDB/JDBStatic images carry a visible watermark. JavDB remains useful for
// metadata fallback, but its cover URLs must never reach Telegram.
export function isJavdbCover(url = '') {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'javdb.com'
      || hostname.endsWith('.javdb.com')
      || hostname === 'jdbstatic.com'
      || hostname.endsWith('.jdbstatic.com');
  } catch {
    return false;
  }
}

function allowedCover(url = '') {
  return isJavdbCover(url) ? '' : url;
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

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
]);

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

export function parseS1OfficialTags(html = '', code = '') {
  const normalizedCode = normalizeCode(code).replace(/[^A-Z0-9]/g, '');
  if (!normalizedCode || !html) return [];

  const $ = cheerio.load(html);
  const codeLabel = $('.th').filter((_, el) => $(el).text().trim() === '品番').first();
  const pageCodeText = codeLabel.siblings('.td').first().text()
    || codeLabel.parent().find('.td').first().text();
  const pageCode = String(pageCodeText || '')
    .normalize('NFKC')
    .replace(/^\s*(?:DVD|配信)\s*/i, '')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();
  if (pageCode !== normalizedCode) return [];

  const tags = $('a[href*="/works/list/genre/"]')
    .map((_, el) => translateGenre($(el).text().trim()))
    .get();
  return unique(tags.filter((tag) => tag && !BLOCKED_TAGS.has(tag)));
}

export function parseMoodyzOfficialTags(html = '', code = '') {
  return parseS1OfficialTags(html, code);
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

async function translateOfficialTags(tags = []) {
  const translated = [];
  for (const tag of tags) {
    const text = /[\u3040-\u30ff]/.test(tag) ? await translateJaToZh(tag) : tag;
    const normalized = translateGenre(zh(text)).trim();
    if (normalized && !BLOCKED_TAGS.has(normalized) && !translated.includes(normalized)) translated.push(normalized);
  }
  return translated;
}

async function fetchOfficialTags(code, maker = '') {
  const source = isS1Maker(maker)
    ? { base: 'https://s1s1s1.com', parse: parseS1OfficialTags }
    : (isMoodyzMaker(maker)
      ? { base: 'https://moodyz.com', parse: parseMoodyzOfficialTags }
      : null);
  if (!source) return [];

  const slug = normalizeCode(code).replace(/[^A-Z0-9]/g, '').toLowerCase();
  if (!slug) return [];
  try {
    const url = `${source.base}/works/detail/${encodeURIComponent(slug)}`;
    const html = await curlText(url, null, `${source.base}/works/`);
    return translateOfficialTags(source.parse(html, code));
  } catch {
    return [];
  }
}

export function parseThreeXPlanetTags(description = '') {
  const text = decodeBasicEntities(zh(description));
  const jpGenreBlock = pickFirst(
    /(?:ジャンル|商品タグ|商品标签)[：:]\s*(.*?)(?=\s+(?:出演者|東京恋人|品番|配信開始日|発売日|販売日|贩売日|销售日|収録時間|収录时间|收录时间|監督|监督|メーカー|レーベル)[：:]|\s+~~DOWNLOAD~~|$)/i,
    text
  );
  if (jpGenreBlock) {
    return normalizeTags(jpGenreBlock.split(/\s+/).map((tag) => translateGenre(tag)));
  }

  const enTagsBlock = pickFirst(
    /Tags:\s*(.*?)(?=\s+(?:品番|配信開始日|発売日|販売日|贩売日|销售日|収録時間|収录时间|收录时间|監督|监督|メーカー|レーベル|出演者|Release date|Duration|Director|Maker|Label|Genre|Actress|Performer|Starring|Studio)[：:]|\s+【|\s+~~DOWNLOAD~~|$)/i,
    text
  );
  const normalizeMetadataValue = (value) => String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const excludedValues = new Set([
    ...pickFirst(/Starring:\s*(.*?)\s+Studio:/i, text).split(/[,，]/),
    ...pickFirst(/Studio:\s*(.*?)\s+Tags:/i, text).split(/[,，]/),
  ].map(normalizeMetadataValue).filter(Boolean));
  const tags = enTagsBlock
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag && !excludedValues.has(normalizeMetadataValue(tag)));
  return normalizeTags(tags.map((tag) => translateGenre(tag)));
}

async function fetchMissavDetail(code) {
  const slug = String(code || '').toLowerCase();
  if (!slug) return null;
  for (const base of ['https://missav.ai/en/', 'https://missav.com/en/']) {
    try {
      const html = await curlText(`${base}${encodeURIComponent(slug)}`, null, base);
      if (!new RegExp(String(code).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i').test(html)) continue;
      const getBlock = (label) => pickFirst(new RegExp(`<span>${label}:<\/span>([\\s\\S]*?)<\/div>`, 'i'), html);
      const linkTexts = (block) => [...String(block || '').matchAll(/<a [^>]*>([^<]+)<\/a>/gi)].map((m) => zh(m[1]));
      const title = zh(pickFirst(/<span>Title:<\/span>\s*<span[^>]*>([^<]+)<\/span>/i, html));
      const releaseDate = pickFirst(/<span>Release date:<\/span>\s*<time[^>]*>([^<]+)<\/time>/i, html);
      let actors = linkTexts(getBlock('Actress'));
      const titleActor = title.includes('/') ? title.split('/')[0].trim() : '';
      if (titleActor && /[\u3040-\u30ff\u3400-\u9fff]/.test(titleActor)) actors = [titleActor];
      const tags = normalizeTags(linkTexts(getBlock('Genre')).map(translateGenre));
      const cover = absDmm(
        pickFirst(/<meta property="og:image" content="([^"]+)"/i, html) ||
        pickFirst(/<meta name="twitter:image" content="([^"]+)"/i, html)
      );
      return { rawTitle: title, releaseDate, code: String(code).toUpperCase(), actors, tags, cover, source: 'missav' };
    } catch {}
  }
  return null;
}

async function fetchMissavTags(code) {
  return (await fetchMissavDetail(code))?.tags || [];
}

async function fetchThreeXPlanetDetail(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const slug = normalized.toLowerCase();
  try {
    const html = await curlText(`https://3xplanet.com/${encodeURIComponent(slug)}/`, null, 'https://3xplanet.com/');
    if (!new RegExp(normalized.replace(/[-/\^$*+?.()|[\]{}]/g, '\\$&'), 'i').test(html)) return null;
    const rawTitle = zh(
      pickFirst(/<h1[^>]*>([^<]+)<\/h1>/i, html) ||
      pickFirst(/<meta property="og:title" content="([^"]+)"/i, html) ||
      pickFirst(/<title>([^<]+)<\/title>/i, html)
    ).replace(/\s+-\s+3xplanet.*$/i, '').trim();
    const description = decodeBasicEntities(zh(
      pickFirst(/<meta name="description" content="([^"]+)"/i, html) ||
      pickFirst(/<meta property="og:description" content="([^"]+)"/i, html)
    ));
    const releaseDate = pickFirst(/(?:配信開始日|発売日|販売日|贩売日|销售日)[：:]\s*([0-9/.-]+)/i, description);
    const maker = pickFirst(/メーカー[：:]\s*(.*?)\s+(?:レーベル|ジャンル|出演者|~~DOWNLOAD~~)/i, description)
      || pickFirst(/Studio:\s*(.*?)\s+Tags:/i, description);
    const actorJa = pickFirst(/出演者[：:]\s*([^\s]+(?:[、,，]\s*[^\s]+)*)\s+(?:サイズ|~~DOWNLOAD~~)/i, description);
    const actorEn = pickFirst(/Starring:\s*(.*?)\s+Studio:/i, description);
    const actors = unique([
      ...actorJa.split(/[、,，]/),
      ...actorEn.split(/[,，]/),
    ].map((name) => zh(name).trim()).filter(Boolean));
    const tags = parseThreeXPlanetTags(description);
    const cover = absDmm(
      pickFirst(/<meta property="og:image" content="([^"]+)"/i, html) ||
      pickFirst(/<meta name="twitter:image" content="([^"]+)"/i, html) ||
      pickFirst(/<img[^>]+src="([^"]*3xplanet[^"<>]*_cover\.jpg)"/i, html)
    );
    if (!cover) return null;
    return { rawTitle, maker: zh(maker), releaseDate, code: normalized, actors, tags, cover, source: '3xplanet' };
  } catch {
    return null;
  }
}

async function fetchJavDatabaseTags(code) {
  const slug = String(code || '').toLowerCase();
  if (!slug) return [];
  try {
    const html = await curlText(`https://www.javdatabase.com/movies/${encodeURIComponent(slug)}/`, null, 'https://www.javdatabase.com/');
    const block = pickFirst(/<b>Genre\(s\):\s*<\/b>([\s\S]*?)<\/p>/i, html);
    return normalizeTags([...block.matchAll(/<a [^>]*>([^<]+)<\/a>/gi)].map((m) => translateGenre(m[1]))).slice(0, 20);
  } catch {
    return [];
  }
}

async function fetchJavdbMeta(code) {
  const normalized = normalizeCode(code);
  try {
    const result = await queryJavdb(normalized);
    const matchedCode = normalizeCode(result?.item?.code || result?.detail?.code || '');
    if (matchedCode !== normalized) return { tags: [], actors: [] };
    return {
      rawTitle: result?.detail?.rawTitle || result?.item?.title || '',
      releaseDate: result?.detail?.releaseDate || result?.item?.meta || '',
      maker: result?.detail?.maker || '',
      tags: normalizeTags(result?.detail?.tags || []),
      actors: (result?.detail?.actors || [])
        .filter((a) => !a?.gender || a.gender === 'female')
        .map((a) => a?.name || a)
        .filter(Boolean),
    };
  } catch {
    return { tags: [], actors: [] };
  }
}

function extractActorsFromTitle(title = '') {
  const raw = String(title || '').trim();
  const tail = raw.split(/[。！？!?.]/).pop()?.trim() || '';
  if (/^[\u3400-\u9fff\u3040-\u30ffー・\s]+$/.test(tail) && /[\u3040-\u30ff]/.test(tail)) {
    return tail.split(/[\s、,，]+/).filter(Boolean);
  }
  return [];
}

function parseDetail(html) {
  const $ = cheerio.load(html);
  const panel = $('.panel.panel-info').first();
  const panelHtml = panel.html() || html;
  const panelText = panel.text().replace(/\s+/g, ' ').trim();
  const heading = panel.find('.panel-heading h3').first();
  heading.find('small').remove();
  const rawTitle = cleanTitle(
    heading.text() || pickFirst(/<title>([\s\S]*?)<\/title>/i, html),
    pickFirst(/<b>品番<\/b>:\s*([^<]+)/i, panelHtml).toUpperCase()
  );
  const maker = pickFirst(/<b>メーカー<\/b>:\s*(?:<a [^>]*>)?([^<]+)/i, panelHtml);
  const releaseDate = pickFirst(/<b>配信開始日<\/b>:\s*([^<]+)/i, panelHtml);
  const code = pickFirst(/<b>品番<\/b>:\s*([^<]+)/i, panelHtml).toUpperCase();
  const actorBlock = pickFirst(/<b>出演者<\/b>:\s*([\s\S]*?)<br>/i, panelHtml);
  const actors = actorBlock && actorBlock.length < 500
    ? unique([...actorBlock.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1].trim()))
    : [];
  const tags = unique(pickAll(/<a href="\/genre\/[^>]+>([^<]+)<\/a>/gi, panelHtml));
  const cover = absDmm(
    panel.find('img.img-responsive').first().attr('src') ||
    pickFirst(/poster="([^"]+)"/i, panelHtml) ||
    pickFirst(/<img[^>]+src="([^"]+\/digital\/video\/[^"]+pl\.jpg)"/i, panelHtml) ||
    pickFirst(/<img[^>]+src="([^"]+\/digital\/video\/[^"]+ps\.jpg)"/i, panelHtml) ||
    pickFirst(/<img[^>]+src="([^"]+\/digital\/amateur\/[^"]+jp\.jpg)"/i, panelHtml)
  );
  return { rawTitle, maker, releaseDate, code, actors, tags, cover, panelText };
}

export async function queryJav321(input) {
  const code = normalizeCode(input);
  if (!code || !/(?:FC2-PPV-\d+|[A-Z]+-?\d+)/.test(code)) throw new Error('请输入番号，例如：SSIS-001');

  let detail;
  try {
    const html = await curlText('https://www.jav321.com/search', `sn=${encodeURIComponent(code)}`);
    if (!html || !/配信開始日|出演者|メーカー/.test(html)) throw new Error('not found on jav321');
    detail = parseDetail(html);
  } catch {
    detail = await fetchMissavDetail(code);
  }
  const javdbMeta = await fetchJavdbMeta(detail?.code || code);
  let threeXPlanetDetail = null;
  if (!detail && !javdbMeta?.rawTitle) {
    threeXPlanetDetail = await fetchThreeXPlanetDetail(code);
  }
  if (!detail && javdbMeta?.rawTitle) {
    detail = {
      rawTitle: javdbMeta.rawTitle,
      releaseDate: javdbMeta.releaseDate,
      maker: javdbMeta.maker || '',
      code,
      actors: javdbMeta.actors || [],
      tags: javdbMeta.tags || [],
      cover: '',
      source: 'javdb',
    };
  }
  if (!detail && threeXPlanetDetail?.cover) {
    detail = threeXPlanetDetail;
  }
  if (!detail) throw new Error('未找到相关番号');
  detail.cover = allowedCover(detail.cover);
  const needsThreeXContent = !detail.cover || !detail.actors?.length || !detail.tags?.length;
  const needsMaker = !(detail.maker || javdbMeta.maker);
  threeXPlanetDetail = threeXPlanetDetail || ((needsThreeXContent || needsMaker)
    ? await fetchThreeXPlanetDetail(detail.code || code)
    : null);
  if (threeXPlanetDetail?.cover && needsThreeXContent) {
    // 3xplanet often has the actual composite cover for amateur entries where jav321/DMM returns a mismatched small jacket.
    detail.cover = allowedCover(threeXPlanetDetail.cover);
    if (!detail.releaseDate && threeXPlanetDetail.releaseDate) detail.releaseDate = threeXPlanetDetail.releaseDate;
  }
  if ((!detail.actors || !detail.actors.length) && !javdbMeta.actors.length && threeXPlanetDetail?.actors?.length) detail.actors = threeXPlanetDetail.actors;
  if ((!detail.tags || !detail.tags.length) && threeXPlanetDetail?.tags?.length) detail.tags = threeXPlanetDetail.tags;
  const officialTags = await fetchOfficialTags(
    detail.code || code,
    detail.maker || javdbMeta.maker || threeXPlanetDetail?.maker || ''
  );
  detail.tags = officialTags.length
    ? officialTags
    : (javdbMeta.tags.length ? javdbMeta.tags : (detail.tags || []));
  if ((!detail.actors || !detail.actors.length) && javdbMeta.actors.length) detail.actors = javdbMeta.actors;
  if (!detail.actors || !detail.actors.length) detail.actors = extractActorsFromTitle(detail.rawTitle);
  if (!detail.tags.length && detail.source === 'missav') detail.tags = detail.tags || [];
  const cleanJavdbTitle = cleanTitle(javdbMeta.rawTitle || '', detail.code || code);
  let originalTitle = cleanJavdbTitle || cleanTitle(detail.rawTitle || code, detail.code || code);
  originalTitle = originalTitle.replace(/[」』"'“”‘’：:、，。\s]+$/g, '').trim();
  detail.rawTitle = originalTitle;
  const translatedTitle = cleanTitle(await translateJaToZh(originalTitle), detail.code || code).replace(/[」』"'“”‘’：:、，。\s]+$/g, '').trim();

  const actorTags = [];
  for (const rawName of detail.actors || []) {
    const normalizedRawName = normalizeActorName(rawName);
    const zhName = normalizeActorName(await translateNameToZh(normalizedRawName));
    for (const name of [normalizedRawName, zhName]) {
      const tag = toHashTag(name);
      if (tag && !actorTags.includes(tag)) actorTags.push(tag);
    }
  }
  const tagTags = /^(?:FC2-PPV-|FC2-)/i.test(detail.code || code)
    ? []
    : (detail.tags || []).slice(0, 20).map((t) => toHashTag(zh(t))).filter(Boolean);

  const caption = [
    `<b>番号：</b>${toHashTag(detail.code || code)}`,
    `<b>标题：</b>${htmlEscape(translatedTitle || code)}`,
    detail.releaseDate ? `<b>日期：</b>${htmlEscape(zh(detail.releaseDate))}` : '',
    actorTags.length ? `<b>演员：</b>${htmlEscape(actorTags.join(' '))}` : '',
    tagTags.length ? `<b>标签：</b>${htmlEscape(tagTags.join(' '))}` : '',
  ].filter(Boolean).join('\n');

  return { code, detail, cover: detail.cover, caption, source: 'jav321' };
}
