import csv
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('import_coupons', Path(__file__).resolve().parents[1] / 'tools/import_coupons.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportTest(unittest.TestCase):
    def test_offline_review_and_week_replacement(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root)
            evidence = p / 'page.png'
            evidence.write_bytes(b'private-test-evidence')
            facts = p / 'facts.json'
            output = p / 'coupons.csv'
            row = dict(week_from='', week_to='2026-10-25', item_no='12', name_ja='商品',
                       discount_yen='200', price_after='', price_before='', scope='倉庫店', source='電子報',
                       source_url='https://cds2.costcojapan.jp/cds/mail-images/upz/261016_test/pc_index.html', evidence_file='page.png')
            data = dict(complete=True, evidence={'page.png': hashlib.sha256(evidence.read_bytes()).hexdigest()}, rows=[row])
            def write():
                facts.write_text(json.dumps(data), encoding='utf-8')
            def read():
                with output.open(newline='', encoding='utf-8') as f:
                    return list(csv.DictReader(f))
            write()
            with self.assertRaises(ValueError):
                module.run([evidence], None, output)
            self.assertFalse(output.exists())
            module.run([evidence], facts, output)
            module.run([evidence], facts, output)
            self.assertEqual(len(read()), 1)
            self.assertEqual(read()[0]['price_after'], '')
            data['rows'] = [dict(row, item_no='13', source_url=row['source_url'].replace('261016', '261018'))]
            write()
            module.run([evidence], facts, output)
            self.assertEqual([r['item_no'] for r in read()], ['13'])
            data['rows'] = [dict(row, source_url=row['source_url'].replace('261016', '261023'))]
            write()
            module.run([evidence], facts, output)
            self.assertEqual(len(read()), 2)
            saved = output.read_bytes()
            for rows in [[row, row], [dict(row, discount_yen='-1')], [dict(row, week_to='2026-02-30')],
                         [dict(row, source_url='https://example.com/')]]:
                data['rows'] = rows
                write()
                with self.assertRaises(ValueError):
                    module.run([evidence], facts, output)
                self.assertEqual(output.read_bytes(), saved)
            evidence.write_bytes(b'changed')
            data['rows'] = [row]
            write()
            with self.assertRaises(ValueError):
                module.run([evidence], facts, output)
            self.assertEqual(output.read_bytes(), saved)

    def test_saved_html_local_assets_only(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root)
            (p / 'img.png').write_bytes(b'image')
            html = p / 'saved.html'
            html.write_text('<img src="img.png"><img src="https://example.com/never-fetch.png">')
            self.assertEqual(module.local_inputs([html]), {html.resolve(), (p / 'img.png').resolve()})
            html.write_text('<img src="../outside.png">')
            with self.assertRaises(ValueError):
                module.local_inputs([html])


if __name__ == '__main__':
    unittest.main()
