"""One reviewed display-name table. Never infers identity or translates a name."""
import json
from importlib.resources import files

_DATA = json.loads(files('se_catalog').joinpath('data/actor-names.json').read_text())
_CHARS = json.loads(files('se_catalog').joinpath('data/orthography.json').read_text())['characters']

def name_key(name):
    return ''.join(_CHARS.get(c, c) for c in str(name or '').strip())

TRUSTED = {}
for _entry in _DATA['entries']:
    _key = name_key(_entry['original'])
    if _key in TRUSTED and TRUSTED[_key] != _entry['chinese']:
        raise ValueError('conflicting reviewed Chinese name')
    TRUSTED[_key] = _entry['chinese']

def trusted_chinese(name):
    return TRUSTED.get(name_key(name), '')

def cast_display(names):
    return [{'name': n, 'name_zh': trusted_chinese(n) or None} for n in dict.fromkeys(names) if n]
