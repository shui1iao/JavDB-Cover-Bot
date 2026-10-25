"""What a catalogue site told us about one work, and whether it is really that work."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from .. import codes


@dataclass
class Found:
    site: str
    url: str
    number: str = ""              # the work number as printed by the site
    content_id: str = ""          # shop/catalogue id (DMM cid, FC2 article id, ...)
    title: str = ""
    cast: list = field(default_factory=list)      # [{"name": str, "id": str, "image": str}]
    maker: str = ""
    label: str = ""
    series: str = ""
    released: str = ""
    tags: list | None = None
    covers: list = field(default_factory=list)
    raw: dict = field(default_factory=dict)

    def field_values(self) -> dict:
        """Project into the stored metadata vocabulary."""
        out = {"title": self.title.strip(), "studio": self.maker.strip(), "series": self.series.strip(),
               "release_date": self.released.strip()}
        names = []
        for person in self.cast:
            name = str(person.get("name") or "").strip()
            if name and name not in names:
                names.append(name)
        out["performers"] = names[:100]
        out["tags"] = list(dict.fromkeys(t.strip() for t in (self.tags or []) if isinstance(t, str) and t.strip()))[:100]
        return {k: v for k, v in out.items() if v}


_TOKEN = re.compile(r"[A-Za-z0-9_]+(?:-[A-Za-z0-9]+)*")


def _writings(found: Found) -> list[str]:
    values = [found.number, found.content_id]
    parts = urlsplit(found.url or "")
    for chunk in (parts.path.replace("/", " ") + " " + parts.query.replace("&", " ")).split():
        values += _TOKEN.findall(chunk)
        if "=" in chunk:
            values.append(chunk.split("=", 1)[1])
    return [v for v in values if v]


def is_same_work(code: str, found: Found) -> bool:
    """A printed full number is authoritative; never strip unknown shop prefixes.

    URL tokens are evidence only when no printed number/content id was supplied.
    In particular a requested URL must not legitimize a conflicting returned id.
    """
    if found.number:
        return codes.same_work(code, found.number)
    if found.content_id:
        return codes.same_work(code, found.content_id)
    return any(codes.same_work(code, value) for value in _writings(found))
