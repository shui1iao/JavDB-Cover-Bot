"""Outbound HTTP for public catalogue lookups.

Rules enforced on every hop (redirects are followed by hand so each hop is
checked): https only, port 443, a dotted public host name that is not a local
suffix, every resolved address globally routable, no credentials in the URL.
Each lookup gets a request/byte/time budget, hosts are spaced apart, and a
site that refuses us (401/403/challenge) or rate-limits us (429) is put on hold
for a while in a small state directory shared between processes.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import socket
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36")
LOCAL_SUFFIXES = ("localhost", "local", "internal", "intranet", "lan", "home.arpa")
HOLD_REFUSED = 3600
HOLD_THROTTLED = 300
MAX_BODY = 8 * 1048576
HOP_LIMIT = 5

# site name -> page/API hosts it owns (hold bookkeeping).  Image CDNs are deliberately not listed:
# a refused storefront must not stop us from loading pictures that other sites link to.
SITE_HOSTS = {
    "r18dev": ("r18.dev",), "dmm": ("api.video.dmm.co.jp", "video.dmm.co.jp", "www.dmm.co.jp", "www.dmm.com"),
    "prestige": ("www.prestige-av.com",), "mgstage": ("www.mgstage.com",), "fc2": ("fc2.com",), "fc2cmadb": ("fc2cmadb.com",), "fc2ppvdb": ("fc2ppv-db.com",),
    "javten": ("javten.com",), "javarchive": ("javarchive.com", "javstore.net"), "avbase": ("avbase.net",),
    "javbus": ("javbus.com",), "javdb": ("javdb.com",), "1pondo": ("1pondo.tv",),
    "faleno": ("faleno.jp",), "dahlia": ("dahlia-av.jp",), "avsox": ("avsox.click",), "jav321": ("jav321.com",),
    "gfriends": ("githubusercontent.com",),
    "aircontrol": ("i-dol.tv",), "missav": ("missav.ai", "missav.com"), "3xplanet": ("3xplanet.com",),
}
SPACING = {"javdb.com": 3.0}
DEFAULT_SPACING = 2.0
_CHALLENGE = re.compile(("<title[^>]*>\\s*(?:Just a moment\\.\\.\\.|Attention Required! \\| Cloudflare|请稍候)").encode(), re.I)


class Missing(LookupError):
    """The site answered and does not have this item."""


class Unreachable(RuntimeError):
    """The site did not give a usable answer this time (network, 5xx, parse trouble)."""


class Refused(Unreachable):
    """The site refused us (auth wall, geo block, challenge, rate limit)."""


class Stopped(RuntimeError):
    """The surrounding job asked us to stop."""


def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().rstrip(".")


def under(host: str, domains) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains)


def site_of(url: str) -> str:
    host = host_of(url)
    return next((name for name, hosts in SITE_HOSTS.items() if under(host, hosts)), host)


def literal_ok(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme != "https" or not host or parts.username or parts.password or "." not in host:
        return False
    try:
        if parts.port not in (None, 443):
            return False
    except ValueError:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not under(host, LOCAL_SUFFIXES)


def addresses(host: str) -> list[str]:
    try:
        return [info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)]
    except (OSError, UnicodeError):
        return []


def all_public(host: str) -> bool:
    found = addresses(host)
    if not found:
        return False
    for value in found:
        try:
            if not ipaddress.ip_address(value).is_global:
                return False
        except ValueError:
            return False
    return True


def safe_target(url: str) -> bool:
    return literal_ok(url) and all_public(host_of(url))


def looks_like_challenge(body: bytes) -> bool:
    return _CHALLENGE.search(body[:4096]) is not None


class HoldBook:
    """Per-site 'do not ask until' marks, persisted as tiny JSON files."""

    def __init__(self, root: Path | None):
        self.root = Path(root) if root else None
        self._memory: dict[str, float] = {}

    def _file(self, site: str) -> Path:
        return self.root / ("hold-" + hashlib.sha256(site.encode()).hexdigest()[:24] + ".json")

    def until(self, site: str) -> float:
        if self.root is None:
            return self._memory.get(site, 0.0)
        try:
            return float(json.loads(self._file(site).read_text()).get("until", 0))
        except (OSError, ValueError, TypeError, AttributeError):
            return 0.0

    def hold(self, site: str, seconds: float) -> None:
        stamp = time.time() + seconds
        if self.root is None:
            self._memory[site] = max(self._memory.get(site, 0.0), stamp)
            return
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        target = self._file(site)
        temp = target.with_name(target.name + f".{os.getpid()}.tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump({"site": site, "until": stamp}, handle)
        os.replace(temp, target)


class Spacer:
    """Minimum delay between two requests to the same host (shared across threads)."""

    def __init__(self, gaps=None, default=DEFAULT_SPACING, clock=time.monotonic, sleep=time.sleep):
        self.gaps = dict(SPACING if gaps is None else gaps)
        self.default = default
        self.clock, self.sleep = clock, sleep
        self._next: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, url: str) -> None:
        host = host_of(url)
        with self._lock:
            now = self.clock()
            delay = self._next.get(host, 0.0) - now
            if delay > 0:
                self.sleep(delay)
                now = self.clock()
            self._next[host] = now + self.gaps.get(host, self.default)


@dataclass
class Reply:
    status: int
    url: str
    body: bytes
    headers: dict = field(default_factory=dict)

    def text(self) -> str:
        found = re.search(r"charset=([\w-]+)", self.headers.get("content-type", ""), re.I)
        meta = re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", self.body[:4096], re.I)
        for name in [found.group(1) if found else None, meta.group(1).decode("ascii", "ignore") if meta else None, "utf-8"]:
            if not name:
                continue
            try:
                return self.body.decode(name)
            except (LookupError, UnicodeDecodeError):
                continue
        return self.body.decode("utf-8", "replace")

    def json(self):
        try:
            return json.loads(self.body)
        except ValueError:
            raise Unreachable("not json") from None


class Web:
    """One lookup's worth of outbound HTTP."""

    def __init__(self, *, holds: HoldBook | None = None, spacer: Spacer | None = None, stop=None,
                 max_requests=100, max_bytes=48 * 1048576, seconds=120.0, client: httpx.Client | None = None):
        self.holds = holds or HoldBook(None)
        self.spacer = spacer or Spacer()
        self.stop = stop
        self.left_requests, self.left_bytes = max_requests, max_bytes
        self.deadline = time.monotonic() + seconds
        self.client = client or httpx.Client(trust_env=False, follow_redirects=False,
                                             headers={"User-Agent": BROWSER_UA, "Accept-Language": "ja,en;q=0.8"})
        self.log: list[tuple[str, int]] = []

    def close(self) -> None:
        self.client.close()

    def _check_stop(self):
        if self.stop is not None and self.stop.is_set():
            raise Stopped()

    def fetch(self, url: str, *, method="GET", body: bytes | None = None, headers=None, referer="",
              limit=4 * 1048576, ok=(200,), byte_range: tuple[int, int] | None = None, timeout=12.0,
              site: str | None = None, image: bool = False) -> Reply:
        """Request with all guards; 404/410 -> Missing, refusals -> Refused, other trouble -> Unreachable."""
        name = site or site_of(url)
        if self.holds.until(name) > time.time():
            raise Refused(f"{name} on hold")
        sent = dict(headers or {})
        if referer:
            sent["Referer"] = referer
        if byte_range:
            sent["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
        target = url
        for _ in range(HOP_LIMIT + 1):
            self._check_stop()
            if not safe_target(target):
                raise Unreachable("unsafe address")
            if self.left_requests <= 0 or self.left_bytes <= 0 or time.monotonic() >= self.deadline:
                raise Refused("lookup budget spent")
            self.spacer.wait(target)
            self._check_stop()
            self.left_requests -= 1
            cap = min(limit, MAX_BODY, self.left_bytes)
            try:
                with self.client.stream(method, target, headers=sent, content=body,
                                        timeout=max(1.0, min(timeout, self.deadline - time.monotonic()))) as r:
                    status, location = r.status_code, r.headers.get("location")
                    if status in (301, 302, 303, 307, 308) and location:
                        nxt = urljoin(target, location)
                        if host_of(nxt) != host_of(target):
                            sent.pop("Cookie", None)
                        if nxt.startswith("http://") and host_of(nxt) == host_of(target):
                            nxt = "https://" + nxt[7:]
                        if status == 303 or (status in (301, 302) and method not in ("GET", "HEAD")):
                            method, body = "GET", None
                        target = nxt
                        continue
                    data = bytearray()
                    for piece in r.iter_bytes():
                        data += piece
                        if len(data) > cap:
                            raise Unreachable("response too large")
                    reply = Reply(status, str(r.url), bytes(data), {k.lower(): v for k, v in r.headers.items()})
            except httpx.HTTPError as error:
                raise Unreachable(type(error).__name__) from None
            self.left_bytes -= len(reply.body)
            self.log.append((name, reply.status))
            return self._judge(name, reply, ok, image)
        raise Unreachable("too many redirects")

    def _judge(self, name: str, reply: Reply, ok, image=False) -> Reply:
        if image and reply.status in (401, 403):
            # image buckets answer 403 for keys that do not exist; that is "no such picture", not a refusal
            raise Missing(f"{name} image {reply.status}")
        if reply.status in (401, 403) or (reply.status in (200, 503) and looks_like_challenge(reply.body)):
            self.holds.hold(name, HOLD_REFUSED)
            raise Refused(f"{name} refused ({reply.status})")
        if reply.status == 429:
            self.holds.hold(name, HOLD_THROTTLED)
            raise Refused(f"{name} throttled")
        if reply.status in (404, 410):
            raise Missing(f"{name} {reply.status}")
        if re.search(r"now_?printing", reply.url, re.I):
            raise Missing("placeholder image")
        if reply.status not in ok:
            raise Unreachable(f"{name} HTTP {reply.status}")
        return reply
