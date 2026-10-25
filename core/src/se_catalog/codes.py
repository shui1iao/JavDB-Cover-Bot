"""Release numbers ("番号") in Telegram filenames and captions.

Everything here is pure string work: reading a canonical number out of a
filename or caption, folding numbers into a comparable work identity, deciding
which family a number belongs to, and spotting part/edition markers that the
playback grouping needs.  No network, no database.
"""
from __future__ import annotations

import hashlib
import json
import re

# ---------------------------------------------------------------- vocabulary
_MMDDYY = r"(?:0[1-9]|1[012])(?:0[1-9]|[12]\d|3[01])\d\d"
_TLDS = "com|net|la|xyz|cc|me|top|vip|club|info|org|tv|app|co|pw|gg|cn"
# Forum/repost watermark labels that look like "letters+digits" once the TLD is gone.
WATERMARK_LABELS = frozenset("""
    18my 22sht 7mmtv 7sht 91home 98t aavv333 bbsxv bei88 big2048 fuckbe gc2048 hhd800 hjd2048
    huachishe javday javme jitumi kfa11 kfa33 madoubt mtfdz nyap2p ses23 supjav thz thzu u3c3 yy2048
""".split())
# Korean MIB performer prefixes: never Japanese releases even though they look like one.
MIB_PREFIXES = frozenset("""
    WX AR JH CA IY JA MY SH HA MH DB JI ES SR SY CD YH UY NN SA JE YR
    CHU ENS ERI HAL HNL MIJ MIN SAR SEY SIA SOY SRN SUY SYN YUJ
    CY DK JM JW RA RI SJ UB YL
    AIN GUL HRI JIE KJI MGL MOI MOR SEI SEO XIA YEL YJI YNS YWN
    MOSA MOSY NOAH SJSK
""".split())
# Bare letter stems that only describe a file, never a label.
FILE_WORDS = frozenset({"IMG", "NO", "PART", "VID", "VIDEO"})
# Numeric shop prefixes that are known to be the same work as the bare number.
SAME_WORK_PREFIX = frozenset({
    ("200", "GANA"), ("259", "LUXU"), ("7", "BAZX"), ("49", "HA"), ("230", "ORETD"), ("278", "GYAN"), ("336", "KBI"),
    ("345", "SIMM"), ("413", "INST"), ("428", "SUKE"), ("435", "MFC"), ("476", "MLA"), ("762", "FKOS"),
})
# Search spellings with a shop prefix for bare numbers (query expansion only).
SHOP_PREFIX = {
    "ARA": "261", "ENE": "550", "FKOS": "762", "GANA": "200", "GYAN": "278", "HHH": "451", "INST": "413",
    "JAC": "390", "JNT": "390", "KAI": "308", "KBI": "336", "LUXU": "259", "MAAN": "300", "MFC": "435",
    "MIUM": "300", "MLA": "476", "NTK": "300", "NTR": "348", "ORETD": "230", "OTIM": "393", "SIMM": "345",
    "SUKE": "428",
}

_I = re.I
_rx = re.compile
DATED = _rx(_MMDDYY + r"[-_]\d{2,4}")                       # 1pondo/carib style, separator kept
DATED_BARE = _rx(_MMDDYY + r"\d{2,4}")
DATED_IN_TEXT = _rx(r"(?<!\d)(" + _MMDDYY + r")([-_])(\d{3})(?!\d)")
STUDIO = _rx(r"[A-Z]{2,8}-\d{2,5}")
SHOP = _rx(r"\d{3}[A-Z]{2,8}-\d{2,5}")
KIRARI = _rx(r"MKB?D-S\d{2,4}")
FC2_FORM = _rx(r"(?:FC2(?:[-_. ]?PPV)?[-_. ]?|FC[-_])(\d{5,})", _I)
NUMBER_BODY = _rx(r"(?:\d{3})?[A-Za-z]{2,8}[-_. ]?\d{2,5}")
TH_SITE = r"tokyo[-_. ]?hot"
TH_BODY = _rx(r"(?:([nk])(\d{3,5})|red[-_]?(\d{2,4}))", _I)
TH_LEAD = _rx(r"^" + TH_SITE + r"[-_. ]*", _I)
TH_START = _rx(r"^(?:[nk]\d{4}|red[-_]\d{3})(?![0-9])", _I)
TH_ANYWHERE = _rx(r"(?<![a-z0-9])((?:[nk]\d{3,5}|red[-_]?\d{2,4}))(?![a-z0-9])", _I)
TH_NAMED = _rx(r"(?<![a-z0-9])" + TH_SITE + r"(?![a-z0-9])", _I)
HEYZO_EXACT = _rx(r"HEYZO-\d{2,5}", _I)
HEYZO_NAME = _rx(r"(?<![A-Z0-9])heyzo[-_ ]*(?:hd|lt|sd|fhd)?[-_ ]*(\d{3,5})(?![0-9])", _I)
MIB_NAME = _rx(r"^(?:\[K-?MIB\]\s*)?([A-Za-z]{2,4})[-_](\d{3,4})(?=$|[\s(\[._-])", _I)
DELIVERY_NAME = _rx(r"^\d{4}([A-Za-z]{2,8}\d{2,5})[-_](?:h264|h265|hhb|mhb|dmb|dm|hq|sd|hd|mhbw|dmbw)$", _I)
UUID = _rx(r"[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}", _I)
ASSET_SUFFIX = _rx(r"\.(?:mp4|mkv|avi|wmv|ts|mov|m4v|jpg|jpeg|png|webp)$", _I)
VIDEO_SUFFIX = _rx(r"\.(?:mp4|mkv|avi|wmv|mov|m4v|webm|ts|m2ts|mts|mpg|mpeg|flv|rm|rmvb|iso)$", _I)
DOMAIN = r"(?:www\.)?[a-z0-9][a-z0-9-]{1,30}\.(?:" + _TLDS + r")"
DOMAIN_RX = _rx(DOMAIN, _I)
BARE_DOMAIN = r"(?:www\.)?[a-z0-9]{2,31}\.(?:" + _TLDS + r")"
_OPEN, _CLOSE = r"[\[【(（]", r"[\]】)）]"
PROMO_HEAD = _rx(r"^(?:" + _OPEN + r"\s*(?:" + DOMAIN + r")\s*" + _CLOSE + r"|(?:" + BARE_DOMAIN + r"))[-_@.\s]*", _I)
PROMO_TAIL = _rx(r"[-_@.\s]*(?:" + _OPEN + r"\s*(?:" + DOMAIN + r")\s*" + _CLOSE + r"|(?:" + BARE_DOMAIN + r"))$", _I)
QUALITY_LEAD = _rx(r"^(?:hd|fhd|sd|uhd|4k|2160p?|1080p?|720p?)[-_. ]+", _I)
EDITION_TAIL = _rx(r"[-_. ]?(?:" + "|".join(("ch", "sub", "uc", "fhd", "4k", "hd", "c", "u")) + r")$", _I)
FILE_WORD_LEAD = _rx(r"^(?:" + "|".join(sorted(FILE_WORDS, key=lambda w: (-len(w), w))) + r")(?![A-Za-z])", _I)
WESTERN_TOKEN = _rx(r"^([A-Za-z][A-Za-z0-9]{1,23})\.(\d{4}|\d{2})\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])(?![0-9])")
WESTERN_SPLIT = _rx(r"[\s_@\[\]【】()（）]+")
TRAILING_NOISE = _rx(r"(?:[-_. ]?(?:1080p?|720p?|2160p?|4k|fhd|hd|uc|sub|ch|c|u)|[-_. ]\d{1,2}|\(\d{1,2}\)|[a-z])+$", _I)
STANDALONE = _rx(r"[-_ ]|\d{3}")
PART_TAIL = _rx(
    r"(?:^|[^a-z0-9]|(?<=\d)(?=[a-h]\.|part|pt|cd|disc|disk|dvd|vol))"
    r"(?:part|pt|cd|disc|disk|dvd|vol|fhd)?[-_ ]?(0|0?[1-9]|[1-9]\d|[a-h])(?=\.[a-z0-9]{2,4}$)", _I)
CIRCLED_TAIL = _rx(r"[-_ ]([①-⑳])[^.]*\.[a-z0-9]{2,4}$", _I)
MAKER_SITES_IN_NAME = _rx(
    r"(?<![A-Z0-9])(?:carib(?:bean(?:com)?(?:pr)?)?|1pon(?:do)?|10mu(?:sume)?|heyzo|pacopacomama|paco|muramura|"
    + TH_SITE + r")(?![A-Z0-9])", _I)
GLUED = r"(?:CH|C|SUB|UC|U)"
SPACEY = _rx(r"[\s._\-]+")

# ------------------------------------------------------------ small helpers


def _squash_label(value) -> str:
    text = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
    m = re.fullmatch(r"([a-z]+)(\d+)", text)
    return m.group(1) + str(int(m.group(2))) if m else text


def is_watermark(value) -> bool:
    text = str(value or "").strip()
    return bool(text) and (DOMAIN_RX.fullmatch(text) is not None or _squash_label(text) in WATERMARK_LABELS)


def _only_file_word(value) -> bool:
    return re.sub(r"[^A-Za-z]", "", str(value or "")).upper() in FILE_WORDS


def tokyo_hot(value) -> str:
    """Canonical Tokyo-Hot id (lowercase, padded) or ''."""
    m = TH_BODY.fullmatch(TH_LEAD.sub("", str(value or "").strip()))
    if not m:
        return ""
    if m.group(3):
        return "red-%03d" % int(m.group(3))
    return "%s%04d" % (m.group(1).lower(), int(m.group(2)))


def western_scene(value) -> str:
    """'SITE.YYYY-MM-DD' for western dated scene names, else ''."""
    stem = ASSET_SUFFIX.sub("", str(value or "").strip())
    for token in WESTERN_SPLIT.split(stem):
        m = WESTERN_TOKEN.match(token)
        if m:
            site, year, month, day = m.groups()
            if len(year) == 2:
                year = ("20" if int(year) < 70 else "19") + year
            return f"{site.upper()}.{year}-{month}-{day}"
    return ""


def without_promo(name) -> str:
    """Drop advertising domains glued to the start/end of a name (repeatedly)."""
    first = str(name or "")
    text = first
    while True:
        nxt = PROMO_TAIL.sub("", PROMO_HEAD.sub("", text, count=1), count=1)
        if nxt == text:
            break
        text = nxt
    return first if text == first else text.strip(" ._-—@")


# ------------------------------------------------------- canonical numbers


def canonical(code) -> str:
    """Display/cache spelling: upper case, single hyphen, three-digit minimum."""
    raw = str(code or "").upper().strip()
    th = tokyo_hot(raw)
    if th:
        return th
    if DATED.fullmatch(raw):
        return raw
    text = raw.replace("_", "-").replace(" ", "-").strip()
    if not text:
        return ""
    if is_watermark(text):
        return text
    if text.startswith("FC2"):
        digits = re.search(r"\d{5,}", text)
        return "FC2-PPV-" + digits.group(0) if digits else text
    m = FC2_FORM.fullmatch(text)
    if m:
        return "FC2-PPV-" + m.group(1)
    m = re.fullmatch(r"(\d{3})?([A-Z]+)-?(\d+)", text)
    if not m:
        return text
    return "%s%s-%03d" % (m.group(1) or "", m.group(2), int(m.group(3)))


def looks_like_number(code) -> bool:
    text = str(code or "").upper().strip()
    if not text or is_watermark(text) or _only_file_word(text):
        return False
    if text.startswith("FC2"):
        return re.search(r"\d{5,}", text) is not None
    return any(p.fullmatch(text) for p in (STUDIO, SHOP, DATED, KIRARI)) or bool(tokyo_hot(text))


def identity(code) -> str:
    """Work identity: numbers that name the same release fold to one string."""
    upper = str(code or "").upper().strip()
    raw = re.sub(r"^H_(?=\d)", "", upper)
    th = tokyo_hot(raw)
    if th:
        return th
    if DATED.fullmatch(raw):
        return raw
    scene = western_scene(raw)
    if scene:
        return scene
    flat = SPACEY.sub("", raw)
    if not flat:
        return ""
    if flat.startswith("FC2"):
        digits = re.search(r"\d{5,}", flat[3:])
        return "FC2-%d" % int(digits.group(0)) if digits else flat
    if DATED_BARE.fullmatch(flat):
        return flat
    m = re.fullmatch(r"(\d{1,4})?([A-Z]{2,8})0*(\d{1,5})([A-Z]?)", flat)
    if not m:
        return flat
    shop, letters, number = m.group(1) or "", m.group(2), m.group(3)
    if (shop, letters) in SAME_WORK_PREFIX or upper.startswith("H_"):
        shop = ""
    return "%s%s-%d" % (shop, letters, int(number))


def same_work(a, b) -> bool:
    x, y = identity(a), identity(b)
    if not x or not y:
        return False
    if x == y:
        return True
    for bare, other in ((x, y), (y, x)):
        if DATED_BARE.fullmatch(bare) and DATED.fullmatch(other) and re.sub(r"[-_]", "", other) == bare:
            return True
    for fc2, other in ((x, y), (y, x)):
        if fc2.startswith("FC2-") and other.isdigit():
            return fc2 == "FC2-%d" % int(other)
    return False


def search_spellings(code) -> tuple[str, ...]:
    """Canonical spelling first, then the shop-prefixed / bare alternative."""
    first = canonical(code)
    if not first:
        return ()
    if first.startswith("FC2"):
        return (first,)
    m = re.fullmatch(r"(\d{3})([A-Z]{2,8})-(\d{2,5})", first)
    if m:
        return (first, f"{m.group(2)}-{m.group(3)}")
    if STUDIO.fullmatch(first):
        prefix = SHOP_PREFIX.get(first.split("-", 1)[0])
        if prefix:
            return (first, prefix + first)
    return (first,)


def letter_stem(code) -> str:
    value = canonical(code)
    if not value or value.startswith("FC2"):
        return ""
    return re.sub(r"[^A-Z]", "", value.split("-", 1)[0]).lower()


# ------------------------------------------------------------ reading names


def _tokyo_in(text: str) -> str:
    head = TH_START.match(text)
    if head:
        return tokyo_hot(head.group(0))
    if TH_NAMED.search(text):
        inner = TH_ANYWHERE.search(text)
        if inner:
            return tokyo_hot(inner.group(1))
    return ""


def read_text(value):
    """Canonical number for a short piece of text (folder, stem, token) or None."""
    text = str(value or "").strip()
    if not text or UUID.search(text):
        return None
    text = ASSET_SUFFIX.sub("", text)
    if is_watermark(text) or western_scene(text):
        return None
    text = without_promo(text)
    m = FC2_FORM.fullmatch(text)
    if m:
        return canonical("FC2-PPV-" + m.group(1))
    th = _tokyo_in(text)
    if th:
        return th
    if FILE_WORD_LEAD.match(text):
        return None
    m = DATED_IN_TEXT.search(text)
    if m:
        return m.group(1) + m.group(2) + m.group(3)
    body = EDITION_TAIL.sub("", QUALITY_LEAD.sub("", text))
    if not NUMBER_BODY.fullmatch(body) or _only_file_word(body):
        return None
    value = canonical(body)
    return value if looks_like_number(value) else None


def read_filename(name):
    """Like read_text, but tolerant of part counters and quality junk on file names."""
    full = str(name or "").strip()
    stem = ASSET_SUFFIX.sub("", full)
    if western_scene(stem):
        return None
    trimmed = TRAILING_NOISE.sub("", without_promo(ASSET_SUFFIX.sub("", PART_TAIL.sub("", full))))
    found = read_text(stem) or (read_text(trimmed) if STANDALONE.search(trimmed) else None)
    if found:
        return found
    m = DELIVERY_NAME.match(stem)
    if m:
        return canonical(m.group(1))
    m = HEYZO_NAME.search(stem)
    if m:
        return canonical("HEYZO-" + m.group(1))
    m = MIB_NAME.match(stem)
    if m and m.group(1).upper() in MIB_PREFIXES:
        return canonical(f"{m.group(1)}-{m.group(2)}")
    return None


_LINKS = _rx(r"https?://\S+|(?<!\w)@\w+")
_PIECES = _rx(r"[^\s\[\]()（）【】{}、,，/|+]+")
_HUNTERS = (
    _rx(r"(?<![A-Za-z0-9])(?:" + NUMBER_BODY.pattern + r")(?![A-Za-z0-9])", _I),
    _rx(r"(?<![A-Za-z0-9])(?:" + FC2_FORM.pattern + r")(?![A-Za-z0-9])", _I),
    DATED_IN_TEXT,
)


def numbers_in(value, *, as_filename=False) -> list[str]:
    """Every distinct canonical number mentioned by a filename or caption, in reading order."""
    text = _LINKS.sub(" ", value or "")
    readers = (read_filename, read_text) if as_filename else (read_text,)
    seen: list[str] = []

    def take(piece):
        for reader in readers:
            got = reader(piece)
            if got and got not in seen:
                seen.append(got)

    for chunk in (text, *text.splitlines()):
        take(chunk)
    pieces = _PIECES.findall(text)
    for hunter in _HUNTERS:
        pieces += [m.group(0) for m in hunter.finditer(text)]
    for piece in pieces:
        if any(sep in piece for sep in "-_. ") or piece.upper().startswith("FC2"):
            take(piece)
    return seen


def scan_message(title, caption) -> dict:
    """Identification record for one Telegram video message."""
    from_name = numbers_in(title, as_filename=True)
    from_text = numbers_in(caption)
    found = list(dict.fromkeys(from_name + from_text))
    works = {identity(c) for c in found}
    state = "unidentified" if not works else ("identified" if len(works) == 1 else "ambiguous")
    code = (from_name or from_text)[0] if state == "identified" else ""
    return {"state": state, "code": code, "identity": identity(code), "candidates": found,
            "evidence": {"filename": from_name, "caption": from_text},
            "content_type": family(code, title, caption) if code else "unknown"}


def message_fingerprint(title, caption, document_id) -> str:
    """Change detector for a stored message (format shared with existing rows)."""
    return hashlib.sha256(json.dumps([title, caption, document_id], ensure_ascii=False).encode()).hexdigest()


# --------------------------------------------------------------- families

FAMILIES = ("censored", "amateur", "uncensored", "fc2", "kmib", "other", "unsure", "unknown")
_MGS_SERIES = _rx(r"(?:SIRO|STP|STN)-?\d+")
_FC_SHORT = _rx(r"FC-\d{5,}", _I)
_LETTERS_DIGITS = _rx(r"([A-Z]+)-?0*(\d+)")
_NON_JAPANESE_MARKS = ("国产", "國產", "网红", "網紅", "兔子先生", "麻豆")
_WESTERN_PREFIX = r"(?<![a-z])(?:[a-z]{2,}[-_]){2,}"


def is_mib(code) -> bool:
    m = re.fullmatch(r"([A-Z]{2,4})-\d+", canonical(code))
    return bool(m and m.group(1) in MIB_PREFIXES)


def is_uncensored_number(code) -> bool:
    text = str(code or "").strip()
    return bool(DATED.fullmatch(text) or HEYZO_EXACT.fullmatch(text) or TH_BODY.fullmatch(text))


def is_shop_number(code) -> bool:
    return SHOP.fullmatch(str(code or "").upper().strip()) is not None


def uncensored_release(name, code) -> bool:
    return is_uncensored_number(code) or MAKER_SITES_IN_NAME.search(str(name or "")) is not None


def family(code, *hints) -> str:
    """Which catalogue family a number belongs to; hints are local filename/caption text."""
    value = str(code or "").strip()
    if not value:
        return "unknown"
    if is_mib(value):
        return "kmib"
    if value.upper().startswith("FC2") or _FC_SHORT.fullmatch(value):
        return "fc2"
    if is_uncensored_number(value):
        return "uncensored"
    upper = value.upper()
    if is_shop_number(value) or _MGS_SERIES.fullmatch(upper):
        return "amateur"
    m = _LETTERS_DIGITS.fullmatch(upper)
    texts = [str(h) for h in hints if h]
    if not m or not texts:
        return "censored"
    letters, digits = m.group(1), str(int(m.group(2)))
    blob = "\n".join(texts)
    if re.search(r"(?<![A-Z0-9])\d{3}" + letters + "-0*" + digits + r"(?!\d)", blob, _I):
        return "amateur"
    if any(mark in blob for mark in _NON_JAPANESE_MARKS):
        return "other"
    spelled = r"(?<![A-Z])" + letters + r"[-_ ]?0*" + digits + r"(?!\d)(?:[A-Z]{0,3})(?![A-Z])"
    if re.search(_WESTERN_PREFIX + spelled, blob, _I):
        return "other"
    if re.search(spelled, blob, _I):
        return "censored"
    return "unsure" if re.search(r"(?<![A-Z])" + letters, blob, _I) else "censored"


# ---------------------------------------------------- parts and editions


def part_suffix(title):
    """Match object for an explicit trailing part counter (group 1 is the counter)."""
    return PART_TAIL.search(title or "") or CIRCLED_TAIL.search(title or "")


def _spelling_pattern(code) -> str:
    value = canonical(code)
    m = re.fullmatch(r"FC2-PPV-(\d+)", value)
    if m:
        return r"FC2(?:[-_ ]?PPV)?[-_ ]*0*" + re.escape(m.group(1))
    m = re.fullmatch(r"(\d{3})?([A-Z]+)-(\d+)", value)
    if m:
        return re.escape(m.group(1) or "") + re.escape(m.group(2)) + r"[-_ ]*0*" + re.escape(str(int(m.group(3))))
    m = TH_BODY.fullmatch(value)
    if m:
        return (r"red[-_ ]*0*%d" % int(m.group(3))) if m.group(3) else (r"%s0*%d" % (m.group(1), int(m.group(2))))
    m = re.fullmatch(r"(\d{6})[-_](\d{2,4})", value)
    if m:
        return re.escape(m.group(1)) + r"[-_ ]*" + re.escape(m.group(2))
    return ""


_CRACK = _rx(r"无码\s*破解|無碼\s*破解|AI\s*去码|(?:^|[-_.\s\[])破解(?:$|[-_.\s\]])", _I)
_UNCEN_MARK = _rx(r"(?:^|[-_.\s\[])(?:uc|un|u|uncen(?:sored)?|uncensored|无码|無碼)(?:$|[-_.\s\]])", _I)
_SUB_MARK = _rx(r"(?:^|[-_.\s\[])(?:c|ch|sub|中字|中文字幕)(?:$|[-_.\s\]])", _I)


def edition_marks(name, code) -> list[str]:
    """Edition badges implied by a filename: subtitle and uncensored/cracked markers."""
    text = VIDEO_SUFFIX.sub("", str(name or ""))
    pattern = _spelling_pattern(code)
    tail = ""
    if pattern:
        m = re.search(r"(?:^|[^A-Z0-9])" + pattern + r"((?:" + GLUED + r")?(?:[^A-Z0-9].*)?)$", text, _I)
        tail = (m.group(1) or "") if m else ""
    cracked = _CRACK.search(text) is not None
    marks = []
    if _SUB_MARK.search(tail):
        marks.append("中字")
    if cracked:
        marks.append("无码破解")
    elif uncensored_release(name, code) or _UNCEN_MARK.search(tail):
        marks.append("无码")
    return marks
