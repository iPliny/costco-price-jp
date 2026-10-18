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
            for rows in [[row, dict(row, discount_yen='300')], [dict(row, discount_yen='-1')], [dict(row, week_to='2026-02-30')],
                         [dict(row, source_url='https://example.com/')],
                         [dict(row, source_url='https://cds2.costcojapan.jp/cds/mail-images/other/pc_index.html')]]:
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

    def test_multiple_issues_merge_by_publication_date_and_migrate_legacy_units(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root).resolve()
            image = p / 'page.png'
            image.write_bytes(b'synthetic image fixture')
            row = dict(week_from='', week_to='2026-10-25', item_no='12', name_ja='商品',
                       discount_yen='200', price_after='', price_before='', scope='倉庫店', source='電子報',
                       source_url='https://cds2.costcojapan.jp/cds/mail-images/upz/261015_test/pc_index.html', evidence_file='page.png')
            def receipt(name, rows):
                file = p / name
                file.write_text(json.dumps(dict(complete=True, evidence={'page.png': hashlib.sha256(image.read_bytes()).hexdigest()}, rows=rows)), encoding='utf-8')
                return file
            old = receipt('old.json', [row, dict(row, item_no='13')])
            new = receipt('new.json', [dict(row, discount_yen='300', source_url=row['source_url'].replace('261015', '261018'), price_unit='100g')])
            output = p / 'out.csv'
            # Legacy archived data should survive the added unit column.
            with output.open('w', encoding='utf-8', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=module.LEGACY_COLS)
                writer.writeheader()
                archived = module.validate(dict(row, source_url=row['source_url'].replace('261015', '261009')), '2026-10-18T10:00:00+09:00')
                writer.writerow({k: archived[k] for k in module.LEGACY_COLS})
            for receipts in [[old, new], [new, old]]:
                self.assertEqual(module.run([image], receipts, output), 2)
                with output.open(encoding='utf-8', newline='') as f:
                    rows = list(csv.DictReader(f))
                self.assertEqual(len(rows), 3)
                self.assertEqual(rows[0]['price_unit'], '件')
                current = next(r for r in rows if '261018' in r['source_url'])
                self.assertEqual(current['discount_yen'], '300')
                self.assertEqual(current['price_unit'], '100g')

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

    def test_sunday_announces_next_week_without_erasing_current_offer(self):
        current = dict(source='電子報', source_url='https://cds2.costcojapan.jp/cds/mail-images/upz/261015_test/pc_index.html', week_from='')
        upcoming = dict(current, source_url=current['source_url'].replace('261015', '261018'), week_from='2026-10-19')
        self.assertEqual(module.issue_week(current), '2026-10-12')
        self.assertEqual(module.issue_week(upcoming), '2026-10-19')
        self.assertNotEqual(module.issue_week(current), module.issue_week(upcoming))
        reannounced = dict(current, source_url=current['source_url'].replace('261015', '261023'), week_from='2026-10-15')
        self.assertEqual(module.issue_week(reannounced), '2026-10-19')


if __name__ == '__main__':
    unittest.main()
