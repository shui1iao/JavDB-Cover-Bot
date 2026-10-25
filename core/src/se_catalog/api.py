"""Stable local adapters' common projection. No TG/client/database coupling."""
import base64
import hashlib
import json
from importlib.resources import files
from . import __version__, codes
from .catalog.chain import lookup
from .names import cast_display


def build_info():
    return json.loads(files('se_catalog').joinpath('data/build.json').read_text())


def public_result(code, hints=(), **options):
    code = codes.canonical(code)
    outcome = lookup(code, hints, **options)
    cast = cast_display(outcome.fields.get('performers', []))
    source = outcome.fields.get('field_sources', {}).get('performers')
    source_cast = next((f.cast for f in outcome.found if f.site == source), [])
    for actor in cast:
        details = next((a for a in source_cast if a.get('name') == actor['name']), {})
        actor.update({k: v for k, v in details.items() if k != 'name' and v})
    cover = None
    if outcome.cover:
        data, url, size = outcome.cover
        cover = {'url': url, 'size': list(size), 'sha256': hashlib.sha256(data).hexdigest(),
                 'data': base64.b64encode(data).decode('ascii')}
    return {'core': build_info(), 'code': code, 'identity': codes.identity(code), 'family': codes.family(code, *hints),
            'metadata': outcome.fields, 'cast': cast, 'sources': outcome.sources,
            'problems': outcome.problems, 'state': outcome.state, 'cover': cover, 'cover_state': outcome.cover_state}
