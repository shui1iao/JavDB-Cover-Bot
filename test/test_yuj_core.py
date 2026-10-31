"""Synthetic, offline identity regressions; no captured pages or user data."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from se_catalog import codes
from se_catalog.api import public_result
from se_catalog.catalog import chain
from se_catalog.catalog.found import Found, is_same_work
from se_catalog.catalog.sites import javdb
from se_catalog.catalog.web import Missing
from se_catalog.testing import ResponseWeb


class YujCore(unittest.TestCase):
    def test_ambiguous_yuj_uses_existing_strict_route(self):
        for code in ('YUJ-038', 'YUJ-066', 'YUJ-0038'):
            self.assertFalse(codes.is_mib(code))
            self.assertEqual(codes.family(code), 'censored')
            self.assertTrue(chain.route(code))
        self.assertIn('YUJ', codes.MIB_PREFIXES)  # lexical vocabulary retained

    def test_all_other_mib_prefixes_keep_their_branch(self):
        for prefix in codes.MIB_PREFIXES - {'YUJ'}:
            for number in ('066', '0066'):
                with self.subTest(prefix=prefix, number=number):
                    code = prefix + '-' + number
                    self.assertTrue(codes.is_mib(code))
                    self.assertEqual(codes.family(code), 'kmib')
                    self.assertEqual(chain.route(code), [])

    def test_filename_recognition_is_not_removed(self):
        for prefix in codes.MIB_PREFIXES:
            for marker in ('', '[K-MIB] ', '[KMIB] '):
                name = marker + prefix + '-0066 scene.mp4'
                self.assertEqual(codes.read_filename(name), prefix + '-066')
                self.assertEqual(codes.scan_message(name, '')['code'], prefix + '-066')
        self.assertEqual(codes.family('IPX-900'), 'censored')
        self.assertEqual(codes.family('FC2-PPV-1234567'), 'fc2')

    def test_exact_identity_and_known_shop_whitelist(self):
        self.assertTrue(codes.same_work('YUJ-038', 'yuj00038'))
        self.assertFalse(codes.same_work('YUJ-038', 'YUJ-039'))
        self.assertTrue(codes.same_work('GANA-123', '200GANA-123'))
        self.assertFalse(codes.same_work('GANA-123', '999GANA-123'))
        self.assertFalse(codes.same_work('HOI-367', '420HOI-367'))

    def test_printed_code_conflicts_are_still_rejected(self):
        for fields in ({'number': 'YUJ-039'}, {'content_id': 'yuj00039'}):
            self.assertFalse(is_same_work('YUJ-038', Found('synthetic',
                'https://example.test/YUJ-038', **fields)))
        self.assertTrue(is_same_work('YUJ-038', Found('synthetic',
            'https://example.test/YUJ-039', number='YUJ-038')))
        with patch.dict(chain.READERS, {'javdb': lambda code, web: Found(
                'javdb', 'https://example.test/YUJ-038', number='YUJ-039', title='Wrong work')}):
            with self.assertRaises(Missing):
                chain._ask('javdb', 'YUJ-038', SimpleNamespace())

    def test_synthetic_reader_and_public_projection(self):
        detail = ('<div class="current-title">Synthetic YUJ work</div>'
            '<div class="panel-block"><strong>番號:</strong><span class="value">YUJ-038</span></div>'
            '<div class="panel-block"><strong>片商:</strong><span class="value">Synthetic Studio</span></div>'
            '<div class="panel-block"><strong>日期:</strong><span class="value">2026-01-01</span></div>'
            '<div class="panel-block"><strong>演員:</strong><span class="value"><a class="actor-female" href="/actors/synthetic">Synthetic Actor</a></span></div>'
            '<div class="panel-block"><strong>類別:</strong><span class="value"><a href="/tags/synthetic">Synthetic Genre</a></span></div>')
        search = ('<div class="movie-list"><a class="box" href="/v/synthetic-yuj">'
            '<div class="video-title"><strong>YUJ-038</strong></div></a></div>')
        fixture_data = {'responses': {
            'GET https://javdb.com/search?q=YUJ-038&f=all': {'body': search},
            'GET https://javdb.com/v/synthetic-yuj?locale=zh': {'body': detail}}}
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / 'responses.json'
            fixture.write_text(json.dumps(fixture_data))
            with ResponseWeb(fixture) as web:
                found = javdb('YUJ-038', web)
                self.assertTrue(is_same_work('YUJ-038', found))
                self.assertEqual(found.number, 'YUJ-038')
            with ResponseWeb(fixture) as web:
                result = public_result('YUJ-038', web=web)
                self.assertEqual(result['state'], 'matched')
                self.assertEqual(result['metadata']['studio'], 'Synthetic Studio')
                self.assertEqual(result['metadata']['title'], 'Synthetic YUJ work')
                self.assertTrue(web.calls)


if __name__ == '__main__':
    unittest.main(verbosity=2)
