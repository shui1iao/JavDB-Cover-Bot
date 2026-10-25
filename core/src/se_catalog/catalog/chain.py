"""Looking up one work: which sites to ask, in which order, when to stop, and how to merge.

Only the public work number goes out.  Each family has its own ordered route;
official sources come first, the community indexes last.  Fields are taken
first-come per field; the walk stops once title, cast, studio, date and tags are
all known.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from .. import codes
from . import covers as cover_rules
from .found import Found, is_same_work
from .fallbacks import cover_lookup, three_x, title_key
from .makers import own_store_sites
from .sites import READERS
from .web import HoldBook, Missing, Refused, Spacer, Stopped, Unreachable, Web

KEY_FIELDS = ("title", "performers", "studio", "release_date", "tags")
COMMUNITY = ("avbase", "javbus", "javdb")
FC2_SITES = ("fc2", "fc2cmadb", "fc2ppvdb", "javten", "javarchive")
OFFICIAL_STORES = ("prestige", "faleno", "dahlia", "makers", "mgstage")
LOOKUP_SECONDS = 105
FALLBACKS = ("jav321", "missav", "3xplanet")


def route(code: str, *hints) -> list[tuple[str, tuple[str, ...]]]:
    """Ordered stages for a work: [(stage name, sites in that stage)]."""
    fam = codes.family(code, *hints)
    if fam == "censored":
        stores = own_store_sites(code, *hints)
        if codes.letter_stem(code) in ("oae", "ome"):
            stores = ("aircontrol",)
        elif codes.letter_stem(code).upper() in cover_rules.MGS_FOLDERS:
            stores = tuple(dict.fromkeys([*stores, "mgstage"]))
        return [("official", stores or ("makers",)), ("r18dev", ("r18dev",)), ("dmm", ("dmm",)), ("community", COMMUNITY), ("fallback", FALLBACKS)]
    if fam == "amateur":
        return [("official", ("mgstage",)), ("community", COMMUNITY), ("r18dev", ("r18dev",)), ("fallback", FALLBACKS)]
    if fam == "uncensored":
        stages = []
        blob = " ".join(str(h or "") for h in hints).lower()
        if any(mark in blob for mark in ("1pon", "一本道", "1pondo")):
            stages.append(("1pondo", ("1pondo",)))
        return stages + [("community", COMMUNITY), ("avsox", ("avsox",)), ("fallback", FALLBACKS)]
    if fam == "fc2":
        return [("fc2", FC2_SITES), ("community", ("javdb",)), ("fallback", FALLBACKS)]
    if fam == "unsure":
        return [("community", COMMUNITY), ("fallback", FALLBACKS)]
    return []


@dataclass
class Outcome:
    fields: dict = field(default_factory=dict)
    sources: list = field(default_factory=list)
    problems: list = field(default_factory=list)
    found: list = field(default_factory=list)
    state: str = "not_found"
    cover: tuple | None = None          # (bytes, url, (w, h))
    cover_state: str = "not_found"


def _ask(site: str, code: str, web: Web) -> Found:
    found = READERS[site](code, web)
    if not is_same_work(code, found):
        raise Missing(f"{site}: other work")
    return found


def lookup(code: str, hints=(), *, holds: HoldBook | None = None, spacer: Spacer | None = None, stop=None,
           want_cover=True, web: Web | None = None) -> Outcome:
    code = codes.canonical(code)
    own_web = web is None
    web = web or Web(holds=holds, spacer=spacer, stop=stop)
    out = Outcome()
    field_from: dict[str, str] = {}
    deadline = time.monotonic() + LOOKUP_SECONDS
    asked = set()
    try:
        for stage, sites in route(code, *hints):
            if stop is not None and stop.is_set():
                raise Stopped()
            got, trouble, missing = [], [], []
            for site in sites:
                asked.add(site)
                try:
                    got.append(_ask(site, code, web))
                except Missing:
                    missing.append(site)
                except Stopped:
                    raise
                except (Unreachable, Refused, OSError, ValueError, KeyError, TypeError, AttributeError) as error:
                    trouble.append((site, error))
                if time.monotonic() >= deadline:
                    break
                if got and stage == "fc2":
                    break
            if not got and trouble:
                out.problems.append({"source": stage, "kind": "Refused" if any(isinstance(e, Refused) for _, e in trouble) else "Unavailable"})
            for f in got:
                values = f.field_values()
                out.found.append(f)
                for key, value in values.items():
                    if not out.fields.get(key):
                        out.fields[key], field_from[key] = value, f.site
                out.sources.append({"name": f.site, "url": f.url, "returned_id": str(f.number or f.content_id or ""),
                                    "fields": sorted(values), "checked_at": time.time()})
            if all(out.fields.get(k) for k in KEY_FIELDS):
                break
            if time.monotonic() >= deadline:
                out.problems.append({"source": "budget", "kind": "deadline"})
                break
        if out.fields:
            out.fields["field_sources"] = field_from
        if want_cover and out.found:
            _cover(code, hints, web, out, asked)
        out.fields["field_sources"] = field_from if out.fields else {}
        has = any(out.fields.get(k) for k in KEY_FIELDS)
        out.state = ("matched" if all(out.fields.get(k) for k in KEY_FIELDS) else "partial") if has else \
            ("temporary_error" if out.problems else "not_found")
        return out
    finally:
        if own_web:
            web.close()


def _cover(code, hints, web, out: Outcome, asked) -> None:
    fam = codes.family(code, *hints)
    extra: list[Found] = []
    have = {f.site for f in out.found}
    # Official image hosts give the largest art; look them up even when metadata was already complete.
    wanted = []
    if fam == "censored":
        if own_store_sites(code, *hints) and "prestige" not in have:
            wanted.append("prestige")
        if "dmm" not in have and "dmm" not in asked:
            wanted.append("dmm")
        if "r18dev" not in have and "r18dev" not in asked:
            wanted.append("r18dev")
    elif fam == "amateur" and "mgstage" not in have and "mgstage" not in asked:
        wanted.append("mgstage")
    trouble = False
    for site in wanted:
        if site == "r18dev" and any(f.site == "dmm" for f in extra):
            continue
        try:
            extra.append(_ask(site, code, web))
        except Missing:
            pass
        except Stopped:
            raise
        except (Unreachable, Refused, OSError, ValueError, KeyError, TypeError, AttributeError):
            trouble = True
    try:
        try:
            chosen = cover_rules.choose(web, code, [*out.found, *extra])
        except (Unreachable, Refused):
            trouble, chosen = True, None
        if chosen is None or chosen[1][0] < cover_rules.WIDE:
            for site in (*COMMUNITY, *FALLBACKS):
                if site in asked or (web.stop is not None and web.stop.is_set()):
                    continue
                if time.monotonic() >= web.deadline:
                    break
                asked.add(site)
                try:
                    extra.append(_ask(site, code, web))
                except Missing:
                    continue
                except (Unreachable, Refused, OSError, ValueError, KeyError, TypeError, AttributeError):
                    trouble = True
                    continue
            # A rigorously observed prefixed title relationship may nominate
            # cover evidence only. Do NOT add this record's fields or cast.
            for source in [*out.found, *extra]:
                lookup_hint = cover_lookup(source, code)
                if not lookup_hint:
                    continue
                full_code, expected_title = lookup_hint
                try:
                    full = three_x(full_code, web)
                    if title_key(full.title, full_code).startswith(expected_title):
                        extra.append(Found("3xplanet", full.url, number=full.number,
                                           covers=full.covers, raw={"cover_only_relationship": {"from": code, "to": full_code}}))
                except (Missing, Unreachable, OSError, ValueError):
                    pass
                break
            previous = chosen
            try:
                chosen = cover_rules.choose(web, code, [*out.found, *extra])
            except (Unreachable, Refused):
                # Download outages cannot discard bytes already safely chosen.
                # Conflicting new image evidence still returns None, never bypassed.
                if previous is None:
                    raise
                chosen = previous
    except Stopped:
        raise
    except (Unreachable, Refused):
        out.cover_state = "temporary_error"
        return
    if chosen is None:
        out.cover_state = "temporary_error" if trouble else "not_found"
        return
    pick, size, data = chosen
    if cover_rules.is_javdb(pick.url):
        out.cover_state = "not_found"
        return
    out.cover, out.cover_state = (data, pick.url, size), "available"
