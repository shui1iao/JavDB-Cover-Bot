"""Japanese studio websites that publish their own work pages.

Facts only: which official site sells which label prefixes, and the studio name
we record for it.  All of these sites run the same storefront software, so one
page reader serves them all.
"""
from __future__ import annotations

# (site host, recorded studio name or "" to read it from the page, label prefixes)
STUDIO_SITES = (
    ("s1s1s1.com", "S1 NO.1 STYLE", "sivr ssis ssni snis soe oned one onsd ofje sps tksoe"),
    ("moodyz.com", "MOODYZ", "mdvr midv mide midd mibd mimk miid migd mifd miae miad miaa mdl mdj mdi mdg mdf mde mdld "
                             "mded mizd mird mdjd rmid mdid mdmd mimu mdpd mivd mdud mdgd mdvd mias miqd mint rmpd mdrd "
                             "tkmide tkmidd kmide tkmigd mdfd rmwd miab"),
    ("www.madonna-av.com", "マドンナ", "juvr jusd juq juy jux jul juk juc jukd oba roeb roe ure mdon obe jums"),
    ("www.wanz-factory.com", "WANZ FACTORY", "wavr waaa bmw wanz"),
    ("ideapocket.com", "IDEAPOCKET", "ipvr ipx ipz iptd ipsd idbd supd ipit and hpd tkipz ipzz cosd anpd dan alad kipx"),
    ("kirakira-av.com", "", "kivr blk kibd kifd kird kisd set"),
    ("www.av-e-body.com", "", "ebvr ebod mkck eyan"),
    ("bi-av.com", "", "cjvr cjod bbi bib cjob beb bid bist bwb"),
    ("premium-beauty.com", "PREMIUM（プレミアム）", "prvr pgd pred pbd pjd prtd pxd pid ptv"),
    ("miman.jp", "", "mmvr mmnd mmxd aom"),
    ("tameikegoro.jp", "", "mevr meyd mbyd mdyd mnyd"),
    ("fitch-av.com", "Fitch", "fcvr jufe jufd jfb juny nyb finh gcf nima"),
    ("kawaiikawaii.jp", "kawaii*", "kavr cawd kwbd kawd kwsr kwsd kane"),
    ("befreebe.com", "BeFree", "bf"),
    ("muku.tv", "無垢", "mucd mudr mukd smcd mukc"),
    ("attackers.net", "ATTACKERS（アタッカーズ）", "atvr rbk rbd same shkd atid adn atkd jbd sspd atad azsd"),
    ("mko-labo.net", "", "mvr mism emlb"),
    ("dasdas.jp", "ダスッ！", "dsvr dass dazd dasd pla"),
    ("mvg.jp", "MVG", "mvbd mvsd"),
    ("av-opera.jp", "", "opvr opbd opud"),
    ("oppai-av.com", "OPPAI（おっぱい）", "ppvr pppe ppbd pppd ppsd ppfd"),
    ("v-av.com", "", "vvvd vicd vizd vspd"),
    ("to-satsu.com", "", "clvr stol club"),
    ("bibian-av.com", "ビビアン", "bbvr bban"),
    ("honnaka.jp", "本中", "hnvr hmn hndb hnd krnd hnky hnjc hnse"),
    ("rookie-av.jp", "ROOKIE", "rvr rbb rki"),
    ("nanpa-japan.jp", "", "njvr nnpj npjb"),
    ("hajimekikaku.com", "", "hjbb hjmo avgl"),
    ("hhh-av.com", "HHH", "huntb hunta hunt hunbl royd tysf"),
)

BY_PREFIX: dict[str, tuple[str, str]] = {}
for _host, _studio, _prefixes in STUDIO_SITES:
    for _p in _prefixes.split():
        BY_PREFIX.setdefault(_p, (_host, _studio))

# Studios with their own (non-shared) storefronts, recognised from the label prefix or local text.
OWN_STORE_EVIDENCE = {
    "prestige": (("ABF", "ABP", "ABS", "ABW", "AKA", "DIC", "DOCP", "FIR", "FIV", "HRV", "JBS", "KBI", "LXVS",
                  "ONEZ", "PPT", "PXH", "SGA", "TRE", "YRH", "YRZ"), ("prestige", "プレステージ")),
    "faleno": (("FSDSS", "FCDSS", "FNS", "MGOLD", "JIMMY"), ("faleno",)),
    "dahlia": (("DLDSS",), ("dahlia",)),
}


def studio_site(code: str) -> tuple[str, str] | None:
    """(host, studio) of the official storefront for a censored number, if we know one."""
    letters = "".join(ch for ch in str(code or "").split("-", 1)[0].lower() if ch.isalpha())
    return BY_PREFIX.get(letters)


def own_store_sites(code: str, *texts) -> tuple[str, ...]:
    head = str(code or "").strip().upper()
    letters = ""
    for ch in head:
        if ch.isalpha():
            letters += ch
        else:
            break
    blob = " ".join(str(t or "") for t in texts).casefold()
    return tuple(name for name, (prefixes, words) in OWN_STORE_EVIDENCE.items()
                 if letters in prefixes or any(w.casefold() in blob for w in words))
