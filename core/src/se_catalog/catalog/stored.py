"""Compatibility for persisted e44 source descriptors, never for new collection.

The e44 chain wrote `content_id or number` into returned_id. For DMM/r18
this means a shop CID, NOT a printed product number. The current chain writes
number first. Do not reuse this decoder in `_ask`, readers, covers, or codes.
A source's URL and CID must agree before a legacy field may be adopted.
"""
from __future__ import annotations
import re
from urllib.parse import urlsplit, parse_qs, unquote
from .. import codes
from .found import Found, is_same_work

# Store CID namespaces present in the original adopted records. These are
# catalogue identifier prefixes, not product-number aliases. Unknown prefixes
# stay unsupported; in particular 422ION is not silently stripped to ION.
# Numbers/n_ encode a DMM shop/publisher namespace in the legacy CID field.
_LEGACY_SHOP = frozenset({'1', '12', '41', '118', '301', '5433'})
_CID = re.compile(r'(?:(?P<namespace>[hn]_\d+|\d{1,6}))?(?P<stem>[a-z]{2,8})(?P<serial>\d{1,5})(?P<edition>[a-z]?)')
_NUMBER = re.compile(r'(?P<stem>[A-Z]{2,8})-(?P<serial>\d{2,5})')


def _cid_matches_bare_number(code: str, cid: str) -> bool:
    # A full printed numeric-label number is not a CID. Case/separators are
    # deliberately constrained to the historical content_id representation.
    printed, content = _NUMBER.fullmatch(code), _CID.fullmatch(cid)
    if not printed or not content:
        return False
    namespace = content.group('namespace') or ''
    if namespace and namespace not in _LEGACY_SHOP and not re.fullmatch(r'[hn]_\d+', namespace):
        return False
    return (printed.group('stem').lower() == content.group('stem')
            and int(printed.group('serial')) == int(content.group('serial')))


def is_same_stored_source(code: str, found: Found) -> bool:
    """Read an already-adopted source descriptor without relaxing new lookups.

    Caller must retain e44's identified/work/identity/state/field-source gates.
    No URLs are fetched and no metadata/source row is rewritten here.
    """
    if found.site not in ('r18dev', 'dmm'):
        return is_same_work(code, found)
    try:
        parts = urlsplit(found.url)
        if parts.scheme != 'https' or parts.username or parts.password or parts.port not in (None, 443) or parts.fragment:
            return False
        if found.site == 'r18dev':
            if parts.hostname != 'r18.dev' or parts.query:
                return False
            route = re.fullmatch(r'/videos/vod/movies/detail/-/dvd_id=([^/]+)/json', parts.path)
            if not route or not codes.same_work(code, unquote(route.group(1))):
                return False
        else:
            if parts.hostname != 'video.dmm.co.jp' or parts.path != '/av/content/':
                return False
            query = parse_qs(parts.query, keep_blank_values=True)
            if set(query) != {'id'} or query['id'] != [found.content_id]:
                return False
        # An explicit printed number is never overridden by a CID decoder.
        if found.number and not codes.same_work(code, found.number):
            return False
        if codes.same_work(code, found.content_id):
            return True
        return _cid_matches_bare_number(str(code or '').upper(), found.content_id)
    except (TypeError, ValueError):
        return False
