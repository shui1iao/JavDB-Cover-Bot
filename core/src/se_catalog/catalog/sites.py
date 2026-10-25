"""Readers for the public catalogue sites.

Each reader takes a canonical work number and a `Web`, and returns a `Found`
that has already been checked to describe that exact work, or raises
`Missing` / `Unreachable` / `Refused`.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup

from .. import codes
from .found import Found, is_same_work
from .makers import studio_site
from .fallbacks import jav321, missav, three_x, aircontrol
from .web import Missing, Unreachable, Web

JST = timezone(timedelta(hours=9))


def _soup(text: str) -> BeautifulSoup:
    return BeautifulSoup(text, "html.parser")


def _words(node) -> str:
    return " ".join(node.get_text(" ", strip=True).split()) if node is not None else ""


def _squeeze(text) -> str:
    return " ".join(str(text or "").split())


def _date_from(text: str) -> str:
    m = re.search(r"(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})", text or "")
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else ""


def _checked(code: str, found: Found) -> Found:
    if not is_same_work(code, found):
        raise Missing(f"{found.site}: page is another work")
    return found


# ------------------------------------------------------------------ r18.dev
R18 = "https://r18.dev/videos/vod/movies/detail/-/"


def r18dev(code: str, web: Web) -> Found:
    base = web.fetch(R18 + "dvd_id=" + quote(code) + "/json", referer="https://r18.dev/").json()
    if not isinstance(base, dict):
        raise Unreachable("r18dev: unexpected reply")
    cid = str(base.get("content_id") or "")
    named = lambda key: str(((base.get(key) or {}) if isinstance(base.get(key), dict) else {}).get("name") or "")
    jacket = (base.get("images") or {}).get("jacket_image") or {}
    found = Found("r18dev", R18 + "dvd_id=" + quote(code) + "/json", number=code, content_id=cid,
                  maker=named("maker"), label=named("label"), released=str(base.get("release_date") or ""),
                  tags=[str(c.get("name") or "") for c in base.get("categories") or [] if isinstance(c, dict)],
                  covers=[u.strip() for u in (jacket.values() if isinstance(jacket, dict) else []) if isinstance(u, str) and u.strip()],
                  raw={"content_id": cid})
    if not is_same_work(code, Found("r18dev", "", content_id=cid)):
        raise Missing("r18dev: id mismatch")
    # Japanese wording lives in the 'combined' document; without it we keep only language-neutral fields.
    try:
        full = web.fetch(R18 + "combined=" + quote(cid) + "/json", referer="https://r18.dev/").json() if cid else None
    except (Missing, Unreachable):
        full = None
    if isinstance(full, dict) and full.get("content_id") == cid:
        found.title = _squeeze(full.get("title_ja"))
        found.series = _squeeze(full.get("series_name_ja"))
        found.label = str(full.get("label_name_ja") or found.label)
        found.cast = [{"name": str(a.get("name_kanji") or ""), "id": str(a.get("id") or ""),
                       "image": ("https://pics.dmm.co.jp/mono/actjpgs/" + quote(str(a["image_url"]), safe=""))
                       if a.get("image_url") and "/" not in str(a["image_url"]) else ""}
                      for a in full.get("actresses") or [] if isinstance(a, dict) and a.get("name_kanji")]
        ja = [str(c.get("name_ja") or c.get("name_en") or "") for c in full.get("categories") or [] if isinstance(c, dict)]
        if any(ja):
            found.tags = [t for t in ja if t]
    return found


# ------------------------------------------------------------------ DMM
DMM_API = "https://api.video.dmm.co.jp/graphql"
_DMM_ONE = ("query Work($id: ID!) { ppvContent(id: $id) { id title makerContentId makerReleasedAt duration "
            "maker { name } label { name } series { name } actresses { id name imageUrl } genres { name } "
            "packageImage { largeUrl } } }")
_DMM_FIND = ("query Find($limit: Int!, $sort: ContentSearchPPVSort!, $queryWord: String) { legacySearchPPV("
             "limit: $limit, sort: $sort, queryWord: $queryWord) { result { contents { id } } } }")
_NUMBER = re.compile(r"^(\d{3})?([A-Z]{2,8})-?(\d{1,5})$")


def _dmm_ask(web: Web, query: str, variables: dict) -> dict:
    reply = web.fetch(DMM_API, method="POST", body=json.dumps({"query": query, "variables": variables}).encode(),
                      headers={"Content-Type": "application/json", "Accept": "application/json"},
                      referer="https://video.dmm.co.jp/", limit=1048576)
    data = reply.json()
    if not isinstance(data, dict) or not isinstance(data.get("data"), dict):
        raise Unreachable("dmm: query refused")
    return data["data"]


def dmm(code: str, web: Web) -> Found:
    m = _NUMBER.match(str(code or "").upper())
    if not m:
        raise Missing("dmm: not a catalogue number")
    shop, letters, number = m.group(1) or "", m.group(2), int(m.group(3))
    guess = f"{shop}{letters.lower()}{number:05d}"
    tried = []

    def load(cid):
        tried.append(cid)
        item = _dmm_ask(web, _DMM_ONE, {"id": cid}).get("ppvContent")
        if isinstance(item, dict) and item.get("id") and is_same_work(code, Found("dmm", "", number=str(item.get("makerContentId") or ""), content_id=str(item["id"]))):
            return item
        return None

    item = load(guess)
    if item is None:
        hits = _dmm_ask(web, _DMM_FIND, {"limit": 30, "sort": "RELEASE_DATE", "queryWord": f"{letters} {number}"})
        rows = (((hits.get("legacySearchPPV") or {}).get("result") or {}).get("contents")) or []
        choices = []
        for row in rows:
            cid = str((row or {}).get("id") or "").lower()
            shape = re.fullmatch(r"(?:h_\d+|\d+)?([a-z]+)(\d+)([a-z]*)", cid)
            if shape and shape.group(1) == letters.lower() and int(shape.group(2)) == number and (not shop or cid.startswith(shop)):
                choices.append((bool(shape.group(3)), cid))
        for _, cid in sorted(choices):
            if cid in tried or len(tried) > 2:
                continue
            item = load(cid)
            if item:
                break
    if item is None:
        raise Missing("dmm: no such work")
    cid = str(item["id"])
    when = str(item.get("makerReleasedAt") or "")
    try:
        moment = datetime.fromisoformat(when.replace("Z", "+00:00"))
        when = (moment.astimezone(JST) if moment.tzinfo else moment).date().isoformat()
    except ValueError:
        when = when[:10]
    pick = lambda key: str(((item.get(key) or {}) if isinstance(item.get(key), dict) else {}).get("name") or "")
    return Found("dmm", "https://video.dmm.co.jp/av/content/?id=" + quote(cid, safe=""), number=str(item.get("makerContentId") or ""),
                 content_id=cid, title=_squeeze(item.get("title")), maker=pick("maker"), label=pick("label"),
                 series=pick("series"), released=when,
                 cast=[{"name": str(a["name"]), "id": str(a.get("id") or ""), "image": str(a.get("imageUrl") or "")}
                       for a in item.get("actresses") or [] if isinstance(a, dict) and a.get("name")],
                 tags=[str(g["name"]) for g in item.get("genres") or [] if isinstance(g, dict) and g.get("name")],
                 covers=[u for u in [str((item.get("packageImage") or {}).get("largeUrl") or "")] if u],
                 raw={"content_id": cid})


# ------------------------------------------------------------- studio sites
def studio(code: str, web: Web) -> Found:
    target = studio_site(code)
    if target is None:
        raise Missing("makers: no official site for this label")
    host, name = target
    slug = re.sub(r"[^a-z0-9]", "", code.lower())
    url = f"https://{host}/works/detail/{slug}"
    page = _soup(web.fetch(url, site="makers", referer=f"https://{host}/").text())
    rows = {}
    for item in page.select(".p-workPage__table > .item"):
        head = item.select_one(".th")
        if head is None:
            continue
        rows[_words(head)] = item
    numbers = [re.sub(r"^(DVD|BD|配信|Blu-ray)\s*", "", _words(p)) for p in rows["品番"].select("p")] if "品番" in rows else []
    heading = page.select_one(".p-workPage__title")
    if heading is None:
        raise Missing("makers: not a work page")
    if not name:
        title_tag = _words(page.select_one("title"))
        bracket = re.search(r"【([^】]+)】", title_tag)
        name = re.sub(r"\s*[（(].*$", "", bracket.group(1)).strip() if bracket else ""
    links = lambda key: [_words(a) for a in rows[key].select("a")] if key in rows else []
    slide = page.select_one(".swiper-slide img")
    cover = str((slide.get("data-src") or slide.get("src") or "") if slide else "")
    found = Found("makers", url, number=numbers[0] if numbers else "", title=_words(heading),
                  cast=[{"name": n} for n in links("女優")], maker=name,
                  label=(links("レーベル") or [""])[0], series=(links("シリーズ") or [""])[0],
                  released=_date_from(" ".join(links("発売日")) or _words(rows.get("発売日"))),
                  tags=links("ジャンル"), covers=[cover] if cover.startswith("https://") else [])
    return _checked(code, found)


# ------------------------------------------------------------------ MGStage
def mgstage(code: str, web: Web) -> Found:
    for spelling in codes.search_spellings(code):
        url = f"https://www.mgstage.com/product/product_detail/{quote(spelling)}/"
        try:
            page = _soup(web.fetch(url, headers={"Cookie": "adc=1"}, referer="https://www.mgstage.com/").text())
        except Missing:
            continue
        cells = {}
        for row in page.select("table tr"):
            th, td = row.select_one("th"), row.select_one("td")
            if th is not None and td is not None:
                cells[_words(th).rstrip("：:")] = td
        big = page.select_one("a#EnlargeImage")
        found = Found("mgstage", url, number=_words(cells.get("品番")), title=_words(page.select_one("h1.tag")),
                      cast=[{"name": n} for n in _words(cells.get("出演")).split() if n != "----"],
                      maker=_words(cells.get("メーカー")), label=_words(cells.get("レーベル")),
                      series=_words(cells.get("シリーズ")).replace("----", ""),
                      released=_date_from(_words(cells.get("配信開始日")) or _words(cells.get("商品発売日"))),
                      tags=[_words(a) for a in cells["ジャンル"].select("a")] if "ジャンル" in cells else [],
                      covers=[urljoin(url, big.get("href"))] if big is not None and big.get("href") else [])
        if is_same_work(code, found):
            return found
    raise Missing("mgstage: no such work")


# ------------------------------------------------------- Prestige / FALENO / DAHLIA
def prestige(code: str, web: Web) -> Found:
    search = web.fetch("https://www.prestige-av.com/api/search?" + "&".join(
        f"{k}={quote(str(v))}" for k, v in {"isEnabledQuery": "true", "searchText": code, "isEnableAggregation": "false",
                                             "release": "false", "reservation": "false", "soldOut": "false", "from": 0,
                                             "aggregationTermsSize": 0, "size": 20}.items()),
                       referer="https://www.prestige-av.com/").json()
    hits = ((search or {}).get("hits") or {}).get("hits") or []
    for hit in hits:
        src = (hit or {}).get("_source") or {}
        if not codes.same_work(code, str(src.get("deliveryItemId") or "")) or not src.get("productUuid"):
            continue
        item = web.fetch("https://www.prestige-av.com/api/product/" + quote(str(src["productUuid"])),
                         referer="https://www.prestige-av.com/").json()
        if not isinstance(item, dict):
            continue
        pkg = (item.get("packageImage") or {}).get("path") if isinstance(item.get("packageImage"), dict) else ""
        names = lambda key: [str(x.get("name") or "") for x in item.get(key) or [] if isinstance(x, dict) and x.get("name")]
        return Found("prestige", "https://www.prestige-av.com/goods/" + quote(str(src["productUuid"])),
                     number=str(src.get("deliveryItemId") or ""), title=_squeeze(item.get("title")),
                     cast=[{"name": n} for n in names("actress")], maker=str((item.get("maker") or {}).get("name") or "プレステージ"),
                     label=str((item.get("label") or {}).get("name") or ""), series=str((item.get("series") or {}).get("name") or ""),
                     tags=names("genre"), covers=["https://www.prestige-av.com/api/media/" + pkg.lstrip("/")] if pkg else [])
    raise Missing("prestige: no such work")


def _wordpress_works(site: str, host: str, prefix: str, code: str, web: Web) -> Found:
    slug = re.sub(r"[^a-z0-9]", "", code.lower())
    posts = web.fetch(f"https://{host}{prefix}/wp-json/wp/v2/works?slug={slug}", referer=f"https://{host}/").json()
    if not isinstance(posts, list) or not posts:
        raise Missing(f"{site}: no such work")
    post = posts[0]
    title = BeautifulSoup(str((post.get("title") or {}).get("rendered") or ""), "html.parser").get_text(" ", strip=True)
    acf = post.get("acf") if isinstance(post.get("acf"), dict) else {}
    cast = [n for n in re.split(r"[、,／/\s]+", str(acf.get("actress") or acf.get("performer") or "")) if n]
    found = Found(site, f"https://{host}{prefix}/works/{slug}/", number=code, title=title, cast=[{"name": n} for n in cast],
                  maker="FALENO" if site == "faleno" else "DAHLIA", covers=[])
    return _checked(code, found)


def faleno(code: str, web: Web) -> Found:
    return _wordpress_works("faleno", "faleno.jp", "/top", code, web)


def dahlia(code: str, web: Web) -> Found:
    return _wordpress_works("dahlia", "dahlia-av.jp", "", code, web)


# ------------------------------------------------------------------ AVBase
_MONTHS = {m: i for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}


def _avbase_date(value) -> str:
    m = re.match(r"^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{4})", str(value or ""))
    if m and m.group(1) in _MONTHS:
        return f"{m.group(3)}-{_MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"
    return _date_from(str(value or ""))


def _avbase_works(code: str, spelling: str, web: Web) -> list:
    reply = web.fetch("https://www.avbase.net/works?q=" + quote(spelling), referer="https://www.avbase.net/")
    blob = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', reply.text(), re.S)
    try:
        props = json.loads(blob.group(1))["props"]["pageProps"] if blob else None
    except (ValueError, KeyError, TypeError):
        props = None
    if not isinstance(props, dict):
        raise Unreachable("avbase: page layout not recognised")
    exact = [w for w in props.get("works") or [] if isinstance(w, dict) and codes.same_work(code, str(w.get("work_id") or ""))]
    return exact or [w for w in props.get("works") or [] if isinstance(w, dict)
                     and is_same_work(code, Found("avbase", "", number=str(w.get("work_id") or "")))]


def avbase(code: str, web: Web) -> Found:
    works = []
    for spelling in codes.search_spellings(code) or (code,):
        works = _avbase_works(code, spelling, web)
        if works:
            break
    if not works:
        raise Missing("avbase: no such work")
    work = works[0]
    products = [p for p in work.get("products") or [] if isinstance(p, dict)]
    own = [p for p in products if is_same_work(code, Found("avbase", "", content_id=str(p.get("product_id") or "")))]
    if not own:
        own = [p for p in products if _squeeze(p.get("title")) == _squeeze(work.get("title"))]
    order = {"fanza": 0, "mgstage": 1, "duga": 2}
    own.sort(key=lambda p: order.get(p.get("source"), 3))
    first = lambda pick: next((v for v in map(pick, own) if v), "")
    name = lambda v: _squeeze(v.get("name")) if isinstance(v, dict) else ""
    from .covers import looks_like_thumbnail, names_other_work
    covers = [str(p.get("image_url") or "") for p in own]
    key = f"{work['prefix']}:{work['work_id']}" if work.get("prefix") else str(work.get("work_id"))
    return Found("avbase", "https://www.avbase.net/works/" + quote(key, safe=":"), number=str(work.get("work_id") or ""),
                 title=first(lambda p: _squeeze(p.get("title"))) or _squeeze(work.get("title")),
                 cast=[{"name": name(a)} for a in work.get("actors") or [] if name(a)],
                 maker=first(lambda p: name(p.get("maker"))), label=first(lambda p: name(p.get("label"))),
                 series=first(lambda p: name(p.get("series"))),
                 released=_avbase_date(own[0].get("date") if own else work.get("min_date")),
                 covers=list(dict.fromkeys(u for u in covers if u.startswith("https://") and not looks_like_thumbnail(u)
                                           and not names_other_work(code, u))))


# ------------------------------------------------------------------ JavBus
def javbus(code: str, web: Web) -> Found:
    url = "https://www.javbus.com/" + quote(code)
    page = _soup(web.fetch(url, headers={"Cookie": "existmag=mag; age=verified; dv=1"}, referer="https://www.javbus.com/").text())
    cells = {}
    for p in page.select(".info p"):
        head = p.select_one("span.header")
        if head is not None:
            label = _words(head).rstrip(":：")
            cells[label] = _words(p)[len(_words(head)):].strip()
    shown = cells.get("識別碼", "").replace(" ", "")
    if not shown:
        raise Unreachable("javbus: not a work page")
    heading = _words(page.select_one("h3"))
    big = page.select_one("a.bigImage")
    found = Found("javbus", url, number=shown, title=heading[len(shown):].strip() if heading.upper().startswith(shown.upper()) else heading,
                  cast=[{"name": _words(a)} for a in page.select(".star-name a")], maker=cells.get("製作商", ""),
                  label=cells.get("發行商", ""), series=cells.get("系列", ""), released=cells.get("發行日期", ""),
                  covers=[urljoin(url, big.get("href"))] if big is not None and big.get("href") else [])
    if not codes.same_work(code, shown):
        raise Missing("javbus: other work")
    return found


# ------------------------------------------------------------------ JavDB
_KANA_KANJI = re.compile(r"[぀-ヿ一-鿿]")


def javdb(code: str, web: Web) -> Found:
    search = web.fetch("https://javdb.com/search?q=" + quote(code) + "&f=all", referer="https://javdb.com/")
    if "/login" in search.url:
        raise Unreachable("javdb: login wall")
    target = None
    for box in _soup(search.text()).select(".movie-list a.box"):
        shown = _words(box.select_one(".video-title strong"))
        if shown and (codes.same_work(code, shown) or is_same_work(code, Found("javdb", "", number=shown))):
            target = box.get("href")
            break
    if not target:
        raise Missing("javdb: no such work")
    url = urljoin("https://javdb.com/", target)
    detail = web.fetch(url + "?locale=zh", referer=search.url)
    if "/login" in detail.url:
        raise Unreachable("javdb: login wall")
    page = _soup(detail.text())
    cells = {}
    for block in page.select(".panel-block"):
        label, value = block.select_one("strong"), block.select_one(".value")
        if label is not None and value is not None:
            cells[_words(label).rstrip(":：")] = value
    text = lambda key: _words(cells.get(key))
    shown = text("番號").replace(" ", "")
    if not (codes.same_work(code, shown) or is_same_work(code, Found("javdb", "", number=shown))):
        raise Unreachable("javdb: detail number differs")
    cast = []
    if "演員" in cells:
        for a in cells["演員"].select("a"):
            if "actor-female" in (a.get("class") or []) or (a.find_next_sibling("strong") is not None and "female" in (a.find_next_sibling("strong").get("class") or [])):
                ident = re.search(r"/actors/([A-Za-z0-9]+)", a.get("href") or "")
                cast.append({"name": _words(a), "javdb": ident.group(1) if ident else ""})
    makers = [p.strip() for p in text("片商").split(",") if p.strip()]
    cover = page.select_one("img.video-cover, .video-cover img, .cover img")
    return Found("javdb", url, number=shown, title=_words(page.select_one(".current-title")), cast=cast,
                 maker=next((p for p in makers if _KANA_KANJI.search(p)), makers[0] if makers else ""),
                 label=text("發行"), series=text("系列"), released=text("日期"),
                 tags=list(dict.fromkeys(_words(a) for a in cells["類別"].select("a"))) if "類別" in cells else [],
                 covers=[cover.get("src")] if cover is not None and str(cover.get("src") or "").startswith("https://") else [],
                 raw={"download_names": [_words(n) for n in page.select(".magnet-name .name")]})


# ------------------------------------------------------------------ AVSOX
def avsox(code: str, web: Web) -> Found:
    base = "https://avsox.click"
    home = web.fetch(base + "/cn/", referer=base + "/")
    token = re.search(r'name="csrf-token" content="([^"]+)"', home.text())
    head = {"Accept": "application/json, text/plain, */*", "Content-Type": "application/json", "Origin": base,
            "X-Requested-With": "XMLHttpRequest", **({"X-CSRF-Token": token.group(1)} if token else {})}

    def call(method, args, referer):
        data = web.fetch(f"{base}/javu/data/api/{method}", method="POST", body=json.dumps(args).encode(),
                         headers=head, referer=referer).json()
        return data.get("data") if isinstance(data, dict) and data.get("code") == 200 else None

    rows = call("search", [{"search": code, "lang": "ja"}, 60, 1], f"{base}/ja/search/{quote(code, safe='')}")
    movie_id = None
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and codes.same_work(code, str(row.get("movieFanHao") or "")) and row.get("movieId"):
            movie_id = str(row["movieId"])
            break
    if not movie_id:
        raise Missing("avsox: no such work")
    url = f"{base}/ja/movies/{movie_id}"
    movie = call("getMovie", [movie_id, "ja"], url)
    if not isinstance(movie, dict):
        raise Unreachable("avsox: no detail")

    def named(entity, stem):
        entity = entity[0] if isinstance(entity, list) and entity else entity
        if not isinstance(entity, dict):
            return ""
        return next((str(entity[k]).strip() for k in (f"{stem}Name", f"{stem}Name_ja", f"{stem}Name_en", f"{stem}Name_cn")
                     if isinstance(entity.get(k), str) and entity[k].strip()), "")
    found = Found("avsox", url, number=str(movie.get("movieFanHao") or ""),
                  title=next((str(movie[k]).strip() for k in ("title", "title_ja", "title_en") if str(movie.get(k) or "").strip()), ""),
                  cast=[{"name": n} for n in (named(s, "star") for s in movie.get("star") or []) if n],
                  maker=named(movie.get("studio"), "studio"), label=named(movie.get("label"), "label"),
                  series=named(movie.get("series"), "series"), released=str(movie.get("releaseDate") or ""),
                  tags=[n for n in (named(g, "genre") for g in movie.get("genre") or []) if n],
                  covers=[str(movie["posterLarge"])] if movie.get("posterLarge") else [])
    if not codes.same_work(code, found.number):
        raise Missing("avsox: other work")
    return found


# ------------------------------------------------------------------ FC2 family
_FC2_THUMB = re.compile(r"^https?://contents-thumbnail\d*\.fc2\.com/w\d+/(storage[\w.-]+\.fc2\.com/.+)$", re.I)


def fc2_article(code: str) -> str:
    m = codes.FC2_FORM.fullmatch(str(code or "").strip())
    return m.group(1) if m else ""


def fc2_original(url: str) -> str:
    text = str(url or "").strip()
    if re.search(r"/no-image\.\w+$", text):
        return ""
    m = _FC2_THUMB.match(text)
    return "https://" + m.group(1) if m else text


def _fc2_found(site, article, url, **kw) -> Found:
    kw.setdefault("maker", "FC2-PPV")
    return Found(site, url, number="FC2-PPV-" + article, content_id=article, **kw)


def fc2(code: str, web: Web) -> Found:
    article = fc2_article(code)
    if not article:
        raise Missing("fc2: not an FC2 number")
    url = f"https://adult.contents.fc2.com/article/{article}/"
    page = _soup(web.fetch(url, referer="https://adult.contents.fc2.com/").text())
    product = None
    for node in page.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(node.string or "")
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("@type") == "Product":
            product = data
    if product is None or str(product.get("sku") or "").strip() != article:
        raise Missing("fc2: article not available")
    image = product.get("image") if isinstance(product.get("image"), dict) else {}
    seller = page.select_one('.items_article_headerInfo a[href*="/users/"]')
    sold = re.search(r"販売日\s*[:：]\s*(\d{4})/(\d{2})/(\d{2})", page.get_text(" ", strip=True))
    return _fc2_found("fc2", article, url, title=_squeeze(product.get("name")),
                      label=_words(seller) or str((product.get("brand") or {}).get("url") or ""),
                      released="-".join(sold.groups()) if sold else "",
                      tags=list(dict.fromkeys(_words(a) for a in page.select(".items_article_TagArea a") if _words(a))),
                      covers=[u for u in [fc2_original(image.get("url"))] if u])


def _inertia(text: str) -> dict:
    for node in _soup(text).find_all("script", type="application/json"):
        try:
            data = json.loads(node.string or "")
        except ValueError:
            continue
        if isinstance(data, dict) and isinstance(data.get("props"), dict):
            return data
    blob = re.search(r'data-page="([^"]+)"', text)
    if blob:
        import html as _html
        try:
            return json.loads(_html.unescape(blob.group(1)))
        except ValueError:
            pass
    return {}


def fc2cmadb(code: str, web: Web) -> Found:
    article = fc2_article(code)
    if not article:
        raise Missing("fc2cmadb: not an FC2 number")
    url = f"https://fc2cmadb.com/articles/{article}"
    reply = web.fetch(url, referer="https://fc2cmadb.com/")
    page = _inertia(reply.text())
    item = (page.get("props") or {}).get("article")
    if not isinstance(item, dict) or str(item.get("video_id") or "").strip() != article:
        raise Missing("fc2cmadb: no such article")
    writer = item.get("writer") if isinstance(item.get("writer"), dict) else {}
    found = _fc2_found("fc2cmadb", article, url, title=_squeeze(item.get("title")), label=_squeeze(writer.get("name")),
                       released=str(item.get("release_date") or "").strip(),
                       tags=[_squeeze((t or {}).get("name")) for t in item.get("tags") or [] if _squeeze((t or {}).get("name"))],
                       covers=[u for u in [fc2_original(item.get("image_url"))] if u])
    version = str(page.get("version") or "")
    if version and page.get("component"):
        try:
            extra = web.fetch(url, referer=url, headers={"X-Inertia": "true", "X-Inertia-Version": version,
                                                          "X-Inertia-Partial-Component": str(page["component"]),
                                                          "X-Inertia-Partial-Data": "actresses",
                                                          "Accept": "text/html, application/xhtml+xml"}).json()
            people = ((extra or {}).get("props") or {}).get("actresses") or []
            found.cast = [{"name": _squeeze(p.get("name")), "id": str(p.get("id") or "")}
                          for p in people if isinstance(p, dict) and _squeeze(p.get("name"))]
        except (Missing, Unreachable):
            pass
    return found


def fc2ppvdb(code: str, web: Web) -> Found:
    article = fc2_article(code)
    if not article:
        raise Missing("fc2ppvdb: not an FC2 number")
    url = f"https://fc2ppv-db.com/ja/videos/{article}"
    reply = web.fetch(url, referer="https://fc2ppv-db.com/")
    page = _soup(reply.text())
    title = _words(page.select_one("main h1") or page.select_one("h1"))
    if not re.search(rf"FC2-PPV-{article}(?!\d)", title):
        raise Missing("fc2ppvdb: no such article")
    cast = []
    for a in page.select('a[href*="/actresses/"]'):
        img = a.select_one("img[alt]")
        name = (img.get("alt") if img is not None else "") or _words(a)
        if name and name != "情報がありません" and name not in [c["name"] for c in cast]:
            cast.append({"name": name})
    released = ""
    for p in page.find_all("p"):
        if _words(p) == "販売日":
            released = _date_from(_words(p.find_next_sibling("p")))
    return _fc2_found("fc2ppvdb", article, url, title=re.sub(rf"^.*?FC2-PPV-{article}\s*", "", title).strip(),
                      cast=cast, released=released)


def javten(code: str, web: Web) -> Found:
    article = fc2_article(code)
    if not article:
        raise Missing("javten: not an FC2 number")
    search = web.fetch(f"https://javten.com/search?kw={article}", referer="https://javten.com/")
    link = re.search(rf"https?://javten\.com/video/\d+/id{article}/[^\"'\s#?]*", search.text())
    page_reply = search if link is None and f"id{article}" in search.url else (
        web.fetch(link.group(0).replace("http://", "https://"), referer=search.url) if link else None)
    if page_reply is None:
        raise Missing("javten: no such article")
    page = _soup(page_reply.text())
    if _words(page.select_one("h1.fc2-id")).upper() != f"FC2-PPV-{article}":
        raise Missing("javten: other article")
    meta = lambda key: str((page.select_one(f'meta[property="{key}"]') or page.select_one(f'meta[name="{key}"]') or {}).get("content") or "")
    image = meta("og:image")
    return _fc2_found("javten", article, page_reply.url, title=re.sub(r"^\s*\[?FC2[-_ ]?PPV[-_ ]?\d+\]?\s*", "", meta("og:title")),
                      released=meta("videos:published_time")[:10], tags=[_words(a) for a in page.select('a.badge[href*="/tag/"]')],
                      covers=[fc2_original("https:" + image if image.startswith("//") else image)] if image else [])


def javarchive(code: str, web: Web) -> Found:
    article = fc2_article(code)
    if not article:
        raise Missing("javarchive: not an FC2 number")
    search = web.fetch("https://javarchive.com/search?q=" + quote("FC2-PPV-" + article), referer="https://javarchive.com/", timeout=25)
    edge = re.compile(rf"(?<!\d){article}(?!\d)")
    from urllib.parse import unquote
    hrefs = [h for h in dict.fromkeys(re.findall(r'href="(/\d+-[^"]+\.html)"', search.text())) if edge.search(unquote(h))]
    if not hrefs:
        raise Missing("javarchive: no such article")
    url = "https://javarchive.com" + quote(hrefs[0], safe="/%")
    page = _soup(web.fetch(url, referer=search.url, timeout=25).text())
    heading = _words(page.select_one("h1"))
    if not edge.search(heading):
        raise Missing("javarchive: other article")
    covers = []
    for sel in ("div.fisrst_sc img[src]", 'img[itemprop="image"][src]'):
        for img in page.select(sel):
            src = str(img.get("src") or "").strip()
            if src and not re.search(r"_s\.(?:jpe?g|png)$", src, re.I) and src not in covers:
                covers.append(src)
    info = str(page.select_one("div.news") or "")
    tags = re.search(r"标签\s*[:：]\s*([^<]*)", info)
    sold = re.search(r"日期\s*[:：]\s*(\d{4})/(\d{2})/(\d{2})", info)
    return _fc2_found("javarchive", article, url,
                      title=re.sub(rf"^\s*\[?\s*FC2[-_. ]?(?:PPV)?[-_. ]?{article}\s*\]?\s*[-—:：]?\s*", "", heading, flags=re.I),
                      released="-".join(sold.groups()) if sold else "",
                      tags=[t.strip() for t in re.split(r"[｜|]", tags.group(1)) if t.strip() and t.strip() != "--"] if tags else [],
                      covers=covers)


# ------------------------------------------------------------------ 1pondo
def onepondo(code: str, web: Web) -> Found:
    m = re.fullmatch(r"(\d{6})[-_](\d{2,4})", str(code or "").strip())
    if not m or not codes.is_uncensored_number(f"{m.group(1)}_{m.group(2)}"):
        raise Missing("1pondo: not a 1pondo number")
    movie = f"{m.group(1)}_{m.group(2)}"
    data = web.fetch(f"https://www.1pondo.tv/dyn/phpauto/movie_details/movie_id/{movie}.json",
                     referer="https://www.1pondo.tv/").json()
    if not isinstance(data, dict) or str(data.get("MovieID") or "") != movie:
        raise Missing("1pondo: other work")
    names = [str(n).strip() for n in data.get("ActressesJa") or [] if str(n).strip()] or ([str(data["Actor"]).strip()] if data.get("Actor") else [])
    cover = next((str(data[k]) for k in ("ThumbUltra", "ThumbHigh", "ThumbMed", "ThumbLow", "MovieThumb") if data.get(k)), "")
    return Found("1pondo", f"https://www.1pondo.tv/movies/{movie}/", number=movie, content_id=movie,
                 title=_squeeze(data.get("Title")), cast=[{"name": n} for n in names], maker="一本道",
                 series=_squeeze(data.get("Series")), released=str(data.get("Release") or "").strip(),
                 tags=[str(t).strip() for t in data.get("UCNAME") or [] if str(t).strip()], covers=[cover] if cover else [])


READERS = {"r18dev": r18dev, "dmm": dmm, "makers": studio, "mgstage": mgstage, "prestige": prestige, "faleno": faleno,
           "dahlia": dahlia, "avbase": avbase, "javbus": javbus, "javdb": javdb, "avsox": avsox, "fc2": fc2,
           "fc2cmadb": fc2cmadb, "fc2ppvdb": fc2ppvdb, "javten": javten, "javarchive": javarchive, "1pondo": onepondo, "jav321": jav321, "missav": missav, "3xplanet": three_x, "aircontrol": aircontrol}
