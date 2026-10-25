"""Choosing a cover image for a work.

Order of preference:
1. the largest official image (studio site, DMM/r18 jacket, FC2 storage original, MGStage) at least 700px wide;
2. a community image that two independent image origins agree on (perceptual hash, or ORB feature matches
   for re-cropped copies) -- or, when every community image comes from a single origin, its largest copy;
3. an official image of at least 240px.
JavDB-hosted images are only ever used as corroboration, never installed.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from PIL import Image

from .. import codes
from .web import Missing, Refused, Unreachable, Web, host_of, under

WIDE = 700
NARROW = 240
PROBE = 64 * 1024
FULL_LIMIT = 16 * 1048576
JAVDB_HOSTS = ("javdb.com", "jdbstatic.com", "jdbimgs.com", "tp.spfcas.com")
_THUMB = re.compile(r"(thumb|small|icon|/ts/|-s\d|_s\.)", re.I)
_FC2_LARGE = re.compile(r"https://contents-thumbnail\d*\.fc2\.com/w(?:7\d\d|[89]\d\d|\d{4,})/", re.I)
_IMAGE = re.compile(r"https?://[^\"'\\ )]+?\.(?:jpg|jpeg|png|webp)", re.I)
_DMM_PATH = re.compile(r"/(?:pics_dig/|dig/)?(?P<kind>digital/(?:video|amateur)|mono/movie)(?:/adult)?/(?P<cid>[^/]+)/", re.I)


@dataclass(frozen=True)
class Pick:
    url: str
    referer: str
    rank: int = 1     # 0 sample still, 1 cover, 2 package art


def is_javdb(url: str) -> bool:
    return under(host_of(url), JAVDB_HOSTS)


def looks_like_thumbnail(url: str) -> bool:
    return bool(_THUMB.search(url or "")) and not _FC2_LARGE.match(url or "")


def _referer(url: str) -> str:
    host = host_of(url)
    if under(host, ("mgstage.com",)):
        return "https://www.mgstage.com/"
    if under(host, ("prestige-av.com",)):
        return "https://www.prestige-av.com/"
    if under(host, ("javbus.com",)):
        return "https://www.javbus.com/"
    if under(host, JAVDB_HOSTS):
        return "https://javdb.com/"
    if under(host, ("dmm.co.jp", "dmm.com")):
        return "https://www.dmm.co.jp/"
    return f"https://{host}/" if host else ""


def pick(url: str) -> Pick:
    name = urlsplit(url).path.rsplit("/", 1)[-1].lower()
    rank = 1
    if under(host_of(url), ("mgstage.com",)):
        if name.startswith(("pb_e_", "pake-03_")):
            rank = 2
        elif "popsample" in name:
            rank = 0
    return Pick(url, _referer(url), rank)


def dmm_variants(url: str) -> list[str]:
    """The DMM CDN serves one package image under several paths; try them all."""
    clean = (url or "").split("?", 1)[0]
    out = [clean] if _IMAGE.fullmatch(clean) else []
    m = _DMM_PATH.search(urlsplit(clean).path)
    if m:
        kind, cid = m.group("kind").lower(), m.group("cid").lower()
        out += [f"https://awsimgsrc.dmm.com/dig/{kind}/{cid}/{cid}pl.jpg",
                f"https://awsimgsrc.dmm.co.jp/pics_dig/{kind}/{cid}/{cid}pl.jpg"]
    return list(dict.fromkeys(out))


def content_id_variants(cid: str) -> list[str]:
    cid = (cid or "").strip().lower()
    if not cid:
        return []
    ids = [cid]
    m = re.match(r"^(\d{2,4})?([a-z]+)(\d+)$", cid)
    if m:
        ids += [f"{m.group(2)}{int(m.group(3)):05d}", f"{m.group(2)}{m.group(3)}"]
    out = []
    for one in dict.fromkeys(ids):
        out += [f"https://awsimgsrc.dmm.com/dig/digital/video/{one}/{one}pl.jpg",
                f"https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/{one}/{one}pl.jpg"]
    return out


def names_other_work(code: str, url: str) -> bool:
    """True when the image path itself says it belongs to a different work."""
    key = codes.canonical(code)
    if key.startswith("FC2"):
        wanted = re.search(r"(\d+)\D*$", key)
        name = re.sub(r"[0-9a-f]{13,}", "", urlsplit(url or "").path.rsplit("/", 1)[-1], flags=re.I)
        seen = {int(n) for n in re.findall(r"(?<!\d)\d{5,7}(?!\d)", name)}
        if wanted and seen and int(wanted.group(1)) not in seen:
            return True
    stem = codes.letter_stem(code)
    m = _DMM_PATH.search(urlsplit(url or "").path)
    if not stem or m is None:
        return False
    cid = m.group("cid").lower()
    if stem not in cid:
        return True
    want, got = re.search(r"(\d+)\D*$", code or ""), re.search(r"(\d+)[a-z]*$", cid)
    return bool(want and got) and int(want.group(1)) != int(got.group(1))


# MGStage storefront image folders, observed on images already in the library: letters -> (folder, shop digits)
MGS_FOLDERS = {
    "ABW": ("prestige", ""), "ABP": ("prestige", ""), "ABF": ("prestige", ""), "ABS": ("prestige", ""),
    "FSDSS": ("faleno", "406"), "FNS": ("faleno", "406"), "DLDSS": ("dahlia", "513"), "KBI": ("kanbi", "336"),
    "STARS": ("sodcreate", "107"), "FCT": ("kurofune", "326"), "LUXU": ("luxutv", "259"), "SIRO": ("shirouto", ""),
    "MIUM": ("prestigepremium", "300"), "MAAN": ("prestigepremium", "300"), "NTK": ("prestigepremium", "300"),
    "SRTD": ("itteq", "324"),
}


def mgstage_guesses(code: str) -> list[Pick]:
    """Package images on MGStage's public image host for numbers that store sells (checked by download later)."""
    m = re.fullmatch(r"(\d{3})?([A-Z]+)-(\d+)", codes.canonical(code))
    if not m or m.group(2) not in MGS_FOLDERS:
        return []
    folder, shop = MGS_FOLDERS[m.group(2)]
    stem = ((m.group(1) or shop) + m.group(2)).lower()
    out = []
    for num in dict.fromkeys([m.group(3), m.group(3).zfill(4)]):
        out += [pick(f"https://image.mgstage.com/images/{folder}/sp/{stem}/{num}/pake-03_sp-{stem}-{num}.jpg"),
                pick(f"https://image.mgstage.com/images/{folder}/{stem}/{num}/pb_e_{stem}-{num}.jpg")]
    return out


def official_picks(code: str, found_list) -> list[Pick]:
    """Candidate images from official records already fetched for this work."""
    urls: list[str] = []
    for f in found_list:
        if f.site in ("r18dev", "dmm"):
            for u in f.covers:
                if _IMAGE.fullmatch(u.strip()) and not looks_like_thumbnail(u):
                    urls += dmm_variants(u.strip())
            urls += content_id_variants(f.content_id)
        elif f.site in ("makers", "prestige", "faleno", "dahlia", "mgstage", "1pondo", "aircontrol"):
            urls += [u for u in f.covers if isinstance(u, str)]
        elif f.site in ("fc2", "fc2cmadb", "fc2ppvdb", "javten", "javarchive"):
            from .sites import fc2_original
            urls += [o for o in (fc2_original(u) for u in f.covers) if host_of(o).endswith(".contents.fc2.com")]
    return usable(code, [pick(u) for u in urls])


def usable(code: str, picks) -> list[Pick]:
    seen, out = set(), []
    for p in picks:
        if not p.url or p.url in seen or looks_like_thumbnail(p.url) or names_other_work(code, p.url):
            continue
        seen.add(p.url)
        out.append(p)
    return out


def _probe(web: Web, p: Pick) -> tuple[int, int]:
    head = web.fetch(p.url, referer=p.referer, byte_range=(0, PROBE - 1), limit=PROBE * 2, ok=(200, 206), image=True)
    with Image.open(io.BytesIO(head.body)) as im:
        return im.size


def _download(web: Web, p: Pick) -> tuple[bytes, tuple[int, int]]:
    data = web.fetch(p.url, referer=p.referer, limit=FULL_LIMIT, image=True).body
    with Image.open(io.BytesIO(data)) as im:
        if getattr(im, "is_animated", False):
            raise ValueError("animated")
        im.load()
        return data, im.size


def best_official(web: Web, code: str, picks, *, min_width=WIDE):
    """(pick, size, bytes) of the largest official image wide enough, else raise Missing/Unreachable."""
    measured, trouble, answered = [], 0, 0
    for p in picks:
        try:
            w, h = _probe(web, p)
            answered += 1
        except Missing:
            answered += 1
            continue
        except (Unreachable, OSError, ValueError, Image.DecompressionBombError) as error:
            trouble += 1
            if isinstance(error, (OSError, ValueError)):
                answered += 1
            continue
        if w >= min_width:
            measured.append((w * h, p, (w, h)))
    if not measured:
        if trouble and not answered:
            raise Unreachable("image hosts unreachable")
        raise (Unreachable if trouble else Missing)("no usable official image")
    measured.sort(key=lambda item: (item[1].rank > 0, item[0], item[1].rank), reverse=True)
    for _, p, size in measured:
        try:
            data, actual = _download(web, p)
        except (Missing, Unreachable, OSError, ValueError, Image.DecompressionBombError):
            continue
        if actual == size and actual[0] >= min_width:
            return p, actual, data
    raise Unreachable("official images did not download")


# -------------------------------------------------------- community check
def _origin(url: str) -> str:
    host = host_of(url)
    for name, domains in (("dmm", ("dmm.co.jp", "dmm.com")), ("duga", ("duga.jp",)), ("mgstage", ("mgstage.com",)),
                          ("javbus", ("javbus.com",)), ("javdb", JAVDB_HOSTS)):
        if under(host, domains):
            return name
    return host


def dhash(im: Image.Image) -> int:
    grey = im.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    px = list(grey.tobytes())
    value = 0
    for y in range(8):
        for x in range(8):
            value = (value << 1) | (px[y * 9 + x] > px[y * 9 + x + 1])
    return value


def same_scene(a: bytes, b: bytes, *, need=60, side=400) -> bool:
    """Feature-based match for the same photo cropped or resized differently."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return False

    def features(data):
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
        if img is None or not img.size:
            return None
        scale = side / max(img.shape)
        if scale < 1:
            img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        return cv2.ORB_create(1000).detectAndCompute(img, None)

    fa, fb = features(a), features(b)
    if not fa or not fb or fa[1] is None or fb[1] is None:
        return False
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(fa[1], fb[1], k=2)
    good = [m for pair in pairs if len(pair) == 2 for m, n in [pair] if m.distance < 0.75 * n.distance]
    if len(good) < need:
        return False
    src = np.float32([fa[0][m.queryIdx].pt for m in good])
    dst = np.float32([fb[0][m.trainIdx].pt for m in good])
    _, mask = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4)
    return mask is not None and int(mask.sum()) >= need


@dataclass
class Shot:
    pick: Pick
    data: bytes
    size: tuple[int, int]
    hash: int

    @property
    def area(self):
        return self.size[0] * self.size[1]


def _alike(a: Shot, b: Shot) -> bool:
    ra, rb = a.size[0] / a.size[1], b.size[0] / b.size[1]
    if abs(ra - rb) <= 0.04 * ra and bin(a.hash ^ b.hash).count("1") <= 10:
        return True
    return same_scene(a.data, b.data)


def corroborated(web: Web, code: str, community_found, *, reference: Shot | None = None):
    """(pick, size, bytes) of a community image confirmed by a second origin (or single-origin fallback)."""
    picks = usable(code, [Pick(u, _referer(u)) for f in community_found for u in f.covers if isinstance(u, str)])
    if not picks:
        raise Missing("no community images")
    shots, fetched = ([reference] if reference else []), 0
    for p in picks:
        try:
            data, size = _download(web, p)
            fetched += 1
            if size[0] < NARROW:
                continue
            with Image.open(io.BytesIO(data)) as im:
                shots.append(Shot(p, data, size, dhash(im)))
        except (Missing, Unreachable, OSError, ValueError, Image.DecompressionBombError):
            continue
    best = None
    for s in shots:
        if is_javdb(s.pick.url):
            continue
        origins = {_origin(o.pick.url) for o in shots if o is s or _alike(s, o)}
        if len(origins) >= 2 and (best is None or s.area > best.area):
            best = s
    if best is None:
        community = [s for s in shots if s is not reference]
        if not community:
            raise (Missing if fetched else Unreachable)("community images unusable")
        if len({_origin(s.pick.url) for s in shots}) > 1:
            raise Missing("community images disagree")
        allowed = [s for s in community if not is_javdb(s.pick.url)]
        if not allowed:
            raise Missing("only watermarked images")
        best = max(allowed, key=lambda s: s.area)
    return best.pick, best.size, best.data


def choose(web: Web, code: str, found_list, *, extra_official=()) -> tuple[Pick, tuple[int, int], bytes] | None:
    """Full cover decision for one work.  Returns None when nothing qualifies; raises Unreachable on trouble only."""
    if codes.is_mib(code):
        return None
    official = usable(code, [*official_picks(code, found_list), *extra_official, *mgstage_guesses(code)])
    trouble = False
    if official:
        try:
            return best_official(web, code, official)
        except Missing:
            pass
        except (Unreachable, Refused):
            trouble = True
    community = [f for f in found_list if f.site in ("avbase", "javbus", "javdb", "avsox", "jav321", "missav", "3xplanet")]
    if community:
        try:
            chosen = corroborated(web, code, community)
            if not is_javdb(chosen[0].url):
                return chosen
        except Missing:
            pass
        except (Unreachable, Refused):
            trouble = True
    if official:
        try:
            return best_official(web, code, official, min_width=NARROW)
        except Missing:
            pass
        except (Unreachable, Refused):
            trouble = True
    if trouble:
        raise Unreachable("cover sources did not answer")
    return None
