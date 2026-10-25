"""Exact-work public HTML fallbacks ported from the MIT Bot.

No video URLs, login, playback, screenshots, fuzzy search or curl bypass.
Every request goes through the catalogue Web policy and its shared budgets.
"""
from __future__ import annotations
import re
import unicodedata
from urllib.parse import quote, urljoin, urlsplit, unquote
from bs4 import BeautifulSoup
from .. import codes
from .found import Found, is_same_work
from .web import Missing, Unreachable, Refused


def soup(html):
    return BeautifulSoup(html, 'html.parser')


def words(node):
    return node.get_text(' ', strip=True) if node else ''


def meta(page, name):
    node = page.find('meta', attrs={'property': name}) or page.find('meta', attrs={'name': name})
    return str(node.get('content') or '') if node else ''


def number_in(text):
    m = re.search(r'(?<![A-Za-z0-9])(?:FC2[ _-]*(?:PPV[ _-]*)?\d{5,}|\d*[A-Z]{2,10}[ _-]*\d+)(?![A-Za-z0-9])', text or '', re.I)
    return codes.canonical(m.group().replace(' ', '-')) if m else ''


def page_number(page):
    link = page.select_one('link[rel="canonical"]')
    url = str(link.get('href') or '') if link else meta(page, 'og:url')
    return codes.canonical(unquote(urlsplit(url).path.rstrip('/').split('/')[-1]))


def checked(code, found):
    if not is_same_work(code, found):
        raise Missing(f'{found.site}: other work')
    return found


def image_url(url):
    url = ('https:' + url) if url.startswith('//') else url
    if url.startswith('http://'):
        url = 'https://' + url[7:]
    return re.sub(r'(/digital/video/[^/]+/[^/.]+)(?:ps|jp)(\.jpg)$', r'\1pl\2', url, flags=re.I)


def title_cast(title):
    # Preserve the narrowly scoped original trailing-name fallback, not a full
    # title classifier. No reading-to-name reverse lookup or translation.
    tail = re.split(r'[。！？!?.]', title)[-1].strip()
    if tail and tail != title.strip() and re.fullmatch(r'[\u3400-\u9fff\u3040-\u30ffー・\s]+', tail) and re.search(r'[\u3040-\u30ff]', tail):
        names = tail.split()
        if all(len(n) <= 10 for n in names):
            return names
    return []


def parse_jav321(html, code, url='https://www.jav321.com/search'):
    page = soup(html)
    panel = page.select_one('.panel.panel-info')
    if panel is None:
        raise Missing('jav321: not a work page')
    cells = {}
    for head in panel.find_all('b'):
        chunks = []
        for node in head.next_siblings:
            if getattr(node, 'name', '') == 'br':
                break
            chunks.append(str(node))
        cells[words(head).rstrip(':：')] = soup(''.join(chunks).lstrip(':： '))
    get = lambda label: words(cells.get(label))
    heading = panel.select_one('.panel-heading h3')
    if heading:
        for small in heading.select('small'):
            small.decompose()
    title = words(heading)
    actors = [words(a) for a in (cells.get('出演者') or soup('')).select('a') if words(a)]
    actors = actors or title_cast(title)
    cover = panel.select_one('img.img-responsive')
    found = Found('jav321', url, number=get('品番'), title=title,
                  maker=get('メーカー'), released=get('配信開始日'),
                  cast=[{'name': n} for n in dict.fromkeys(actors)],
                  tags=[words(a) for a in panel.select('a[href^="/genre/"]') if words(a)],
                  covers=[image_url(str(cover.get('src') or ''))] if cover else [])
    return checked(code, found)


def jav321(code, web):
    url = 'https://www.jav321.com/search'
    reply = web.fetch(url, method='POST', body=('sn=' + quote(code)).encode(),
                      headers={'Content-Type': 'application/x-www-form-urlencoded'}, referer='https://www.jav321.com/')
    return parse_jav321(reply.text(), code, reply.url)


def parse_missav(html, code, url=''):
    page = soup(html)
    def block(label):
        for label_node in page.find_all('span'):
            if words(label_node).rstrip(':：') == label:
                return label_node.parent
        return None
    title_block = block('Title')
    title_spans = title_block.find_all('span', recursive=False) if title_block else []
    title = words(title_spans[1]) if len(title_spans) > 1 else ''
    headings = page.select('main h1') if page.select_one('main') else page.select('.content-without-search .flex-1.order-first h1')
    headings = [n for n in headings if not n.find_parent(['aside', 'nav', 'footer', 'header'])]
    heading_code = number_in(words(headings[0])) if len(headings) == 1 else ''
    printed = number_in(title) or heading_code
    if not title or re.search(r'not\s*found|\b404\b', words(page.title) + ' ' + ' '.join(words(n) for n in headings), re.I):
        raise Missing('missav: not a work page')
    if not codes.same_work(page_number(page), code) or not codes.same_work(printed, code):
        raise Missing('missav: canonical/heading mismatch')
    actor_block = block('Actress')
    actors = [words(a) for a in actor_block.select('a')] if actor_block else []
    if '/' in title:
        prefix = title.split('/')[0].strip()
        if re.search(r'[\u3040-\u30ff\u3400-\u9fff]', prefix):
            actors = [prefix]
    actors = actors or title_cast(title)
    genre_block, released = block('Genre'), block('Release date')
    image = image_url(meta(page, 'og:image') or meta(page, 'twitter:image'))
    return checked(code, Found('missav', url, number=printed, title=title,
                     released=words(released.find('time')) if released else '',
                     cast=[{'name': n} for n in dict.fromkeys(actors) if n],
                     tags=[words(a) for a in genre_block.select('a')] if genre_block else [],
                     covers=[image] if image else []))


def slug_spellings(code):
    """Zero padding is spelling only, never numeric-label prefix stripping."""
    values = [code]
    m = re.fullmatch(r'(\d*[A-Z]+)-(\d{1,3})', code)
    if m:
        values.append(m.group(1) + '-' + m.group(2).zfill(4))
    return values


def missav(code, web):
    trouble = None
    for host in ['missav.ai', 'missav.com']:
        for spelling in slug_spellings(code):
            url = f'https://{host}/en/{quote(spelling.lower())}'
            try:
                reply = web.fetch(url, referer=f'https://{host}/')
                return parse_missav(reply.text(), code, reply.url)
            except Refused as error:
                trouble = error
                break
            except (Missing, Unreachable) as error:
                trouble = error
    raise trouble or Missing('missav: missing')


_TAG_END = (r'出演者|出演|女優タイプ|女优タイプ|タグ|東京恋人|品番|配信開始日|配信日|'
            r'再生時間|再生时间|発売日|販売日|贩売日|销售日|収録時間|収录时间|收录时间|'
            r'監督|监督|メーカー|レーベル|Release date|Duration|Director|Maker|Label|Genre|Actress|Performer|Starring|Studio|Description')


def tag_tokens(description):
    """Raw genre values only: never date/cast/studio/synopsis metadata."""
    jp = re.search(r'(?:ジャンル|商品タグ|商品标签)[：:]\s*(.*?)(?=\s+(?:' + _TAG_END + r')[：:]|\s+~~DOWNLOAD~~|$)', description, re.I)
    if jp:
        return jp.group(1).split()
    en = re.search(r'Tags:\s*(.*?)(?=\s+(?:' + _TAG_END + r')[：:]|\s+【|\s+~~DOWNLOAD~~|$)', description, re.I)
    if not en:
        return []
    normalize = lambda s: unicodedata.normalize('NFKC', s).strip().casefold()
    excluded = set()
    for pattern in [r'Starring:\s*(.*?)\s+Studio:', r'Studio:\s*(.*?)\s+Tags:']:
        m = re.search(pattern, description, re.I)
        if m:
            excluded.update(normalize(v) for v in re.split('[,，]', m.group(1)))
    return [v.strip() for v in re.split('[,，]', en.group(1)) if v.strip() and normalize(v) not in excluded]


def parse_three_x(html, code, url=''):
    page = soup(html)
    title = words(page.find('h1')) or meta(page, 'og:title') or words(page.title)
    if not title or re.search(r'not\s*found|nothing\s+found|search\s+results|\b404\b', title, re.I):
        raise Missing('3xplanet: not a work page')
    description = meta(page, 'description') or meta(page, 'og:description')
    structured = re.search(r'品番[：:]\s*([A-Z0-9_-]+\d)', description, re.I)
    structured = structured.group(1) if structured else ''
    canonical_match = codes.same_work(page_number(page), code) and codes.same_work(number_in(title), code)
    if structured and not codes.same_work(structured, code):
        raise Missing('3xplanet: conflicting printed code')
    if not (structured and codes.same_work(structured, code)) and not canonical_match:
        raise Missing('3xplanet: no exact product identity')
    get = lambda pattern: (m.group(1).strip() if (m := re.search(pattern, description, re.I)) else '')
    maker = get(r'メーカー[：:]\s*(.*?)\s+(?:レーベル|ジャンル|出演者|~~DOWNLOAD~~)') or get(r'Studio:\s*(.*?)\s+Tags:')
    actor_ja = get(r'(?:出演者|出演)[：:]\s*(.*?)(?=\s+(?:サイズ|監督|メーカー|ジャンル|女優タイプ|女优タイプ|タグ|Description)[：:]|\s+~~DOWNLOAD~~|$)')
    actor_en = get(r'Starring:\s*(.*?)\s+Studio:')
    actors = [n.strip() for n in re.split('[、,，]', actor_ja or actor_en) if n.strip() and not re.fullmatch(r'[-—–―ー]+', n.strip())]
    actors = actors or title_cast(title)
    tags = tag_tokens(description)
    released = get(r'(?:配信開始日|配信日|発売日|販売日)[：:]\s*([0-9/.-]+)')
    image = image_url(meta(page, 'og:image') or meta(page, 'twitter:image'))
    return checked(code, Found('3xplanet', url, number=structured or number_in(title), title=title,
                     maker=maker, released=released.replace('/', '-'),
                     cast=[{'name': n} for n in dict.fromkeys(actors)], tags=tags,
                     covers=[image] if image else []))


def three_x(code, web):
    trouble = None
    for spelling in slug_spellings(code):
        url = f'https://3xplanet.com/{quote(spelling.lower())}/'
        try:
            reply = web.fetch(url, referer='https://3xplanet.com/')
            return parse_three_x(reply.text(), code, reply.url)
        except Refused:
            raise
        except (Missing, Unreachable) as error:
            trouble = error
    raise trouble or Missing('3xplanet: missing')


def parse_aircontrol(html, code, url=''):
    page = soup(html)
    def cell(label):
        return next((dl.find('dd') for dl in page.find_all('dl') if words(dl.find('dt')).replace(' ', '').startswith(label)), None)
    number_cell = cell('品番')
    code_node = number_cell.select_one('.works-info-desc-tx:not(.works-info-desc-tx--stream)') if number_cell else None
    printed = re.sub(r'^DVD\s*', '', unicodedata.normalize('NFKC', words(code_node or number_cell)), flags=re.I).strip()
    if not codes.same_work(printed, code):
        raise Missing('aircontrol: other work')
    title = words(cell('タイトル'))
    actors = []
    for dl in page.find_all('dl'):
        if not words(dl.find('dt')).replace(' ', '').startswith('出演'):
            continue
        dd = dl.find('dd')
        nodes = dd.select('a[href*="/idol/detail/"]') or dd.select('.works-info-desc-tx, p > span')
        actors += [words(n) for n in nodes] if nodes else re.split('[、,，]', words(dd))
    tag_cell = cell('ジャンル')
    released = words(cell('発売日'))
    m = re.search(r'(\d{4})年(\d+)月(\d+)日', released)
    if m:
        released = '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3)))
    slug = re.sub(r'[^a-z0-9]', '', code.lower())
    images = [str(img.get('src') or img.get('data-src') or '') for img in page.find_all('img')]
    covers = [urljoin('https://www.i-dol.tv/', u) for u in images if f'/contents/works/{slug}/' in u and u.endswith(f'/{slug}-ps.jpg')]
    for a in page.select('a[href*="dmm.co.jp/digital/videoa/"]'):
        cid = re.search(r'/cid=([a-z0-9_-]+)(?:/|$)', a.get('href') or '', re.I)
        if cid and codes.same_work(code, cid.group(1)):
            covers.insert(0, f'https://pics.dmm.co.jp/digital/video/{cid.group(1)}/{cid.group(1)}pl.jpg')
    if not title:
        raise Missing('aircontrol: no title')
    return checked(code, Found('aircontrol', url, number=printed, title=title, maker='Aircontrol',
                     released=released, cast=[{'name': n.strip()} for n in dict.fromkeys(actors) if n.strip()],
                     tags=[words(a) for a in tag_cell.select('a')] if tag_cell else [], covers=covers))


def aircontrol(code, web):
    if not re.fullmatch(r'O(?:AE|ME)-\d+', code):
        raise Missing('aircontrol: unsupported number')
    slug = re.sub('[^a-z0-9]', '', code.lower())
    url = f'https://www.i-dol.tv/works/detail/{slug}/'
    reply = web.fetch(url, referer='https://www.i-dol.tv/')
    return parse_aircontrol(reply.text(), code, reply.url)


def cover_lookup(found, code):
    """Only a plain full-code torrent filename on the selected exact JavDB detail.

    This is a cover-only relationship, NOT a work identity alias or cast merge.
    """
    if found.site != 'javdb' or not is_same_work(code, found) or not re.fullmatch(r'[A-Z]+-\d+', code):
        return None
    candidates = set()
    for name in found.raw.get('download_names', []):
        m = re.fullmatch(r'(\d{1,5}([A-Z]+-\d+))\.torrent', name, re.I)
        if m and codes.same_work(m.group(2), code):
            candidates.add(m.group(1).upper())
    key = title_key(found.title, code)
    return (next(iter(candidates)), key) if len(candidates) == 1 and len(key) >= 8 else None


def title_key(title, code):
    title = re.sub(r'^\s*' + re.escape(code) + r'\s*', '', title, flags=re.I)
    return ''.join(c.lower() for c in unicodedata.normalize('NFKC', title) if c.isalnum())
