import contextlib
import csv
from datetime import date
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('check_observations', Path(__file__).resolve().parents[1] / 'tools/check_observations.py')
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)
AS_OF = date(2026, 10, 18)


def row(record_id='a', **values):
    result = dict.fromkeys(checker.FIELDS, '')
    result.update(record_id=record_id, store='座間倉庫店', source_type='門市價牌', item_no='123',
                  name='テスト商品', price='1000', price_unit='件', period_from='2026-10-10',
                  period_to='2026-10-10', review_status='已查核')
    result.update(values)
    return result


class RulesTest(unittest.TestCase):
    def findings(self, rows, names=None, categories=None, downgrades=None):
        return checker.check_rows(rows, {'123'} if categories is None else categories,
                                  names or {}, AS_OF, {} if downgrades is None else downgrades)

    def assert_rule(self, rule, positive, negative, **kwargs):
        self.assertTrue(any(f['rule'] == rule for f in self.findings(positive, **kwargs)), rule + ' positive')
        self.assertFalse(any(f['rule'] == rule for f in self.findings(negative, **kwargs)), rule + ' negative')

    def test_e2_identifier(self):
        self.assert_rule('E2', [row(record_id='')], [row()])
        self.assert_rule('E2', [row(), row()], [row(), row('b')])

    def test_e3_status(self):
        self.assert_rule('E3', [row(review_status='OK')], [row(review_status='待確認')])
        self.assertFalse(any(f['rule'] == 'E3' for f in self.findings([row(review_status='待查核')])))

    def test_e4_store(self):
        self.assert_rule('E4', [row(store='unknown')], [row(store='線上商店')])

    def test_e5_price_and_unit(self):
        for invalid in ['0', '-1', '159.8', '1,000', 'abc', '１２３']:
            with self.subTest(invalid=invalid):
                self.assert_rule('E5', [row(price=invalid)], [row(price='1')])
        self.assert_rule('E5', [row(price_unit='kg')], [row(price_unit='100g')])
        self.assertFalse(any(f['rule'] == 'E5' for f in self.findings([row(price='')])))

    def test_e6_dates_strict(self):
        for changes in [{'period_from': ''}, {'period_to': '2026-02-30'}, {'period_to': '2026/10/10'},
                        {'period_from': '2026-10-11'}, {'period_to': '2026-10-19'}, {'promo_end': '2026/10/12'}]:
            with self.subTest(changes=changes):
                self.assert_rule('E6', [row(**changes)], [row(period_to='2026-10-18', promo_end='2026-10-20')])
                self.assertEqual(self.findings([row(**changes)])[0]['level'], 'error')

    def test_e7_item_number(self):
        self.assert_rule('E7', [row(item_no='12a')], [row(item_no='123')])
        self.assert_rule('E7', [row(item_no='１２３')], [row(item_no='')])

    def test_e8_regular_price(self):
        for regular in ['1000', '900', 'abc', '1100.5']:
            self.assert_rule('E8', [row(list_price=regular)], [row(list_price='1100')])
        self.assertFalse(any(f['rule'] == 'E8' for f in self.findings([row(list_price='')])))

    def test_w1_ratio_and_all_store_records(self):
        high = row('b', store='浜松倉庫店', price='2001')
        self.assert_rule('W1', [row(), high], [row(), {**high, 'price': '2000'}])
        hits = [f for f in self.findings([row(), high]) if f['rule'] == 'W1']
        self.assertEqual({f['record_id'] for f in hits}, {'a', 'b'})
        self.assertFalse(any(f['rule'] == 'W1' for f in self.findings([row(), {**high, 'store': '線上商店'}])))
        self.assertFalse(any(f['rule'] == 'W1' for f in self.findings([row(), {**high, 'price_unit': '100g'}])))
        # 舊的低價已被同店較新紀錄取代，不以全部歷史價格誤判。
        self.assertFalse(any(f['rule'] == 'W1' for f in self.findings([
            row(price='100'), row('new', price='1000', period_to='2026-10-12'), high | {'price': '1000'}])))

    def test_w2_change_and_promo_exclusion(self):
        newer = row('b', period_from='2026-10-11', period_to='2026-10-11', price='1401')
        self.assert_rule('W2', [row(), newer], [row(), {**newer, 'price': '1400'}])
        self.assert_rule('W2', [row(), {**newer, 'price': '599'}], [row(), {**newer, 'price': '600'}])
        for excluded in [{**newer, 'list_price': '1600'}, {**newer, 'period_to': '2026-10-10', 'period_from': '2026-10-10'},
                         {**newer, 'price_unit': '100g'}, {**newer, 'store': '浜松倉庫店'}]:
            self.assertFalse(any(f['rule'] == 'W2' for f in self.findings([row(), excluded])))

    def test_w3_official_latest_and_same_unit(self):
        online = row('online', store='線上商店', source_type='官網自動取得', price='2001')
        self.assert_rule('W3', [row(), online], [row(), {**online, 'price': '2000'}])
        self.assertFalse(any(f['rule'] == 'W3' for f in self.findings([row(), {**online, 'price_unit': '100g'}])))
        self.assertFalse(any(f['rule'] == 'W3' for f in self.findings([
            row(), online, row('new-online', store='線上商店', price='1000', period_to='2026-10-12')])))

    def test_w4_bilingual_note(self):
        self.assert_rule('W4', [row(note='說明')], [row(note='說明', note_ja='説明')])
        self.assert_rule('W4', [row(note_ja='説明')], [row()])

    def test_w5_category(self):
        self.assert_rule('W5', [row(item_no='456')], [row()])
        self.assertFalse(any(f['rule'] == 'W5' for f in self.findings([row(item_no='')])))

    def test_w6_discount_and_promotion_dates(self):
        self.assert_rule('W6', [row(list_price='1200', discount='100')], [row(list_price='1200', discount='200')])
        self.assert_rule('W6', [row(promo_end='2026-10-09')], [row(promo_end='2026-10-10')])
        self.assert_rule('W6', [row(discount='100')], [row()])

    def test_w7_uncertainty(self):
        for phrase in checker.UNCERTAINTY:
            self.assert_rule('W7', [row(note_ja=phrase)], [row(note_ja=phrase, review_status='待確認')])
        self.assertFalse(any(f['rule'] == 'W7' for f in self.findings([row(note='特別價格', note_ja='特別価格')])))

    def test_w8_normalized_names_and_official_canonical_name(self):
        self.assert_rule('W8', [row(name='ABC bread'), row('b', name='XYZ soap')],
                         [row(name='ＡＢＣ　bread'), row('b', name='abcBREAD')])
        self.assertFalse(any(f['rule'] == 'W8' for f in self.findings([row(name='食パンabc'), row('b', name='全粒食パンdef')])))
        rows = [row(name='食パンABC'), row('b', store='線上商店', name='unreliable extracted name')]
        self.assertTrue(any(f['rule'] == 'W8' for f in self.findings(rows)))
        self.assertFalse(any(f['rule'] == 'W8' for f in self.findings(rows, names={'123': '食パンDEF'})))
        self.assertEqual(sum(f['rule'] == 'W8' for f in self.findings([row(name='aaa'), row('b', name='bbb'), row('c', name='ccc')])), 3)

    def test_w9_duplicate_key(self):
        self.assert_rule('W9', [row(), row('b')], [row(), row('b', period_to='2026-10-11')])
        self.assert_rule('W9', [row(), row('b', review_status='待確認')], [row(), row('b', store='浜松倉庫店')])
        self.assertFalse(any(f['rule'] == 'W9' for f in self.findings([row(item_no=''), row('b', item_no='')])))

    def test_latest_same_day_ties_and_expired_promotion(self):
        records = [row('high', price='3000', review_status='待確認'), row('checked', price='1000'),
                   row('other', store='浜松倉庫店', price='1000')]
        self.assertFalse(any(f['rule'] == 'W1' for f in self.findings(records)))
        expired = row('sale', price='100', discount='900', list_price='1000',
                      period_from='2026-10-10', period_to='2026-10-15', promo_end='2026-10-11')
        current = row('current', price='1000', period_to='2026-10-12')
        self.assertFalse(any(f['rule'] == 'W1' for f in self.findings([expired, current, row('other', store='浜松倉庫店')])))

    def test_pure_and_downgrade_is_explicit(self):
        records = [row(period_to='2026-10-19')]
        copy = [dict(r) for r in records]
        result = self.findings(records, downgrades={'E6': 'test exception'})
        self.assertEqual(result[0]['level'], 'warning')
        self.assertIn('test exception', result[0]['detail'])
        self.assertEqual(records, copy)
        self.assertEqual(self.findings(records)[0]['level'], 'error')


class CliTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.file = self.folder / 'observations.csv'
        self.write('product_categories.csv', ['item_no', 'category', 'confidence', 'basis', 'checked'], [])
        self.write('product_names.csv', ['item_no', 'name_ja', 'name_en', 'checked'], [])

    def write(self, name, fields, rows):
        with (self.folder / name).open('w', encoding='utf-8', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    def check(self):
        return checker.check(self.file, AS_OF, downgrades={})

    def test_e1_valid_and_invalid_csv(self):
        self.write('observations.csv', checker.FIELDS, [row()])
        self.assertFalse(any(f['rule'] == 'E1' for f in self.check()))
        for text in ['wrong,header\na,b\n', ','.join(checker.FIELDS) + '\n"unclosed\n',
                     ','.join(checker.FIELDS) + '\na,b\n']:
            self.file.write_text(text)
            self.assertEqual(self.check()[0]['rule'], 'E1')
        self.file.unlink()
        self.assertEqual(self.check()[0]['rule'], 'E1')

    def test_e1_auxiliary_failure_is_not_a_zero_count(self):
        self.write('observations.csv', checker.FIELDS, [row()])
        (self.folder / 'product_categories.csv').unlink()
        self.assertEqual(self.check()[0]['rule'], 'E1')

    def test_warning_exit_zero_error_exit_one_and_csv_reports(self):
        self.write('observations.csv', checker.FIELDS, [row(note='only Chinese')])
        args = ['--csv', str(self.file), '--as-of', '2026-10-18', '--report', str(self.folder / 'out')]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(checker.main(args), 0)
        for rule in checker.RULES:
            self.assertIn(rule + ': error=', output.getvalue())
        warnings = list(csv.DictReader(io.StringIO((self.folder / 'out/warnings.csv').read_text(encoding='utf-8-sig'))))
        self.assertTrue(warnings)
        self.assertEqual(list(warnings[0]), checker.REPORT_FIELDS)
        self.assertEqual(list(csv.DictReader(io.StringIO((self.folder / 'out/errors.csv').read_text(encoding='utf-8-sig')))), [])
        self.write('observations.csv', checker.FIELDS, [row(record_id='')])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(checker.main(args), 1)
        errors = list(csv.DictReader(io.StringIO((self.folder / 'out/errors.csv').read_text(encoding='utf-8-sig'))))
        self.assertEqual(errors[0]['rule'], 'E2')

    def test_report_cannot_overwrite_input(self):
        self.write('warnings.csv', checker.FIELDS, [row()])
        file = self.folder / 'warnings.csv'
        before = file.read_bytes()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(checker.main(['--csv', str(file), '--report', str(self.folder)]), 1)
        self.assertEqual(file.read_bytes(), before)

    def test_bad_as_of_is_rejected(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            checker.main(['--as-of', '2026-02-30'])
        self.assertEqual(error.exception.code, 2)

    def test_japan_date_and_calendar_validation(self):
        self.assertIsInstance(checker.japan_today(), date)
        self.assertIsNone(checker.parse_date('2026-2-01'))
        self.assertEqual(checker.parse_date('2024-02-29'), date(2024, 2, 29))


if __name__ == '__main__':
    unittest.main()
