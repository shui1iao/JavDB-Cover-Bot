"""Explicit deterministic HTTP fixtures for adapter conformance (network impossible)."""
import base64
import json
from pathlib import Path
from .catalog.web import Web, Reply, Missing, Spacer

class ResponseWeb(Web):
    def __init__(self, path):
        super().__init__(spacer=Spacer(default=0, gaps={}))
        self.responses = json.loads(Path(path).read_text())['responses']
        self.calls = []
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.close()
    def fetch(self, url, *, method='GET', body=None, **options):
        self.calls.append([method, url, (body or b'').decode()])
        key = method + ' ' + url + (' ' + body.decode() if body else '')
        item = self.responses.get(key)
        if item is None:
            raise Missing('offline fixture missing')
        reply = Reply(item.get('status', 200), item.get('url', url),
                      base64.b64decode(item['base64']) if 'base64' in item else item.get('body', '').encode(), item.get('headers', {}))
        return self._judge(options.get('site', url), reply, options.get('ok', (200,)), options.get('image', False))
